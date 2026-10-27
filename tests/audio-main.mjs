// R117: execute real main lifecycle/loop snippets in an isolated VM, with no DOM or audio device.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const plain = s => stripTypeScriptTypes(s);
const extract = (s, name) => {
  const result = s.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert(result, `fixture: ${name} exists`); return result;
};
const groups = {
  activity(s) {
    const calls = [], c = vm.createContext({ battleAudio: { setActive: a => calls.push(a) }, phase: 'battle', paused: false, reportShown: false, audioHelpActive: false, document: { hidden: false }, audioPageActive: true });
    vm.runInContext(plain(extract(s, 'syncBattleAudio')), c);
    for (let mask = 0; mask < 64; mask++) {
      c.phase = mask & 1 ? 'build' : 'battle'; c.paused = !!(mask & 2); c.reportShown = !!(mask & 4); c.audioHelpActive = !!(mask & 8); c.document.hidden = !!(mask & 16); c.audioPageActive = !(mask & 32);
      c.syncBattleAudio();
      assert.equal(calls.at(-1), mask === 0, `activity: all independent lifecycle gates are mandatory (mask ${mask})`);
    }
    c.battleAudio = undefined; assert.doesNotThrow(() => c.syncBattleAudio(), 'activity: valve-off path needs no audio object');
  },
  loop(s) {
    const begin = s.indexOf('  syncBattleAudio();\n  let steps = 0;'), end = s.indexOf('  const alpha =', begin);
    assert(begin >= 0 && end > begin, 'fixture: real animation loop source located');
    const chunk = plain(s.slice(begin, end));
    for (const [elapsed, count] of [[0,0],[0.151,3],[0.6,8]]) {
      const calls = [], w = { tick: 7, events: [] }, view = {};
      const c = vm.createContext({ acc: elapsed, TICK_HZ: 20, w, view,
        syncBattleAudio: () => calls.push('sync'),
        tick: () => { w.tick++; w.events = [{ tick: w.tick }]; calls.push(`tick:${w.tick}`); },
        battleAudio: { enqueue: (world,events,visible) => { assert.equal(world,w); assert.equal(visible,view); assert.equal(events,w.events); calls.push(`enqueue:${events[0].tick}`); }, flush: () => calls.push('flush') },
      });
      vm.runInContext(chunk,c);
      const want = ['sync']; for(let i=1;i<=count;i++)want.push(`tick:${7+i}`,`enqueue:${7+i}`);want.push('flush');
      assert.deepEqual(calls,want,'loop: every live tick contributes only its fresh events, then exactly one frame flush');
      if(count===8)assert.equal(c.acc,0,'loop: old maximum-eight-step catch-up rule is unchanged');
    }
  },
  bulk(s) {
    const calls = [], w = { tick: 0 }, c = vm.createContext({ w, window: {}, battleAudio: { silence: () => calls.push('silence'), enqueue: () => calls.push('unexpected enqueue') }, tick: () => { calls.push('tick'); w.tick++; } });
    vm.runInContext(plain(s.slice(s.indexOf('const rts = {'))),c);
    assert.equal(c.window.__rts.stepN(3),3);
    assert.deepEqual(calls,['silence','tick','tick','tick','silence'],'bulk: historical stepN clears voices before and after and never queues events');
    calls.length=0;c.tick=()=>{calls.push('tick');throw Error('fixture tick failure');};
    assert.throws(()=>c.window.__rts.stepN(2),/fixture tick failure/);
    assert.deepEqual(calls,['silence','tick','silence'],'bulk: failed batch still clears audio in finally');
  },
  help(s) {
    const begin=s.indexOf('const help = initHelp('),end=s.indexOf('\nbuildBar =',begin);assert(begin>=0&&end>begin);
    const calls=[],c=vm.createContext({V:{r109:true},audioHelpActive:false,pausedBeforeHelp:false,paused:false,clearGestureInput:()=>calls.push('gesture'),hud:{update:()=>calls.push('hud')},syncBattleAudio:()=>calls.push(`sync:${c.audioHelpActive}:${c.paused}`),initHelp:a=>{c.actions=a;return a;}});
    vm.runInContext(plain(s.slice(begin,end)),c);c.actions.open();
    assert.equal(c.audioHelpActive,true,'help: opening sets an independent audio gate before synchronization');
    assert.deepEqual(calls,['gesture','sync:true:true','hud'],'help: existing gesture cleanup precedes gated sound synchronization');
    // Existing Space can change paused while help stays open; the independent gate must remain.
    c.paused=false;assert.equal(c.audioHelpActive,true,'help: unrelated pause state cannot remove the help audio gate');
    calls.length=0;c.actions.close();assert.equal(c.audioHelpActive,false,'help: closing clears only the help gate');
    assert.deepEqual(calls,['sync:false:false','hud'],'help: closing reconciles actual restored pause state');
  },
};
for(const [name,run] of Object.entries(groups)){run(source);console.log(`OK audio-main ${name}`);}
const mutations=[
  ['phase','activity',"phase === 'battle' && ",'','activity:'],
  ['pause','activity','!paused && ','','activity:'],
  ['report','activity','!reportShown && ','','activity:'],
  ['help','activity','!audioHelpActive && ','','activity:'],
  ['hidden','activity','!document.hidden && ','','activity:'],
  ['page','activity',' && audioPageActive','','activity:'],
  ['fresh-events','loop','tick(); battleAudio?.enqueue(w, w.events, view);','tick();','loop:'],
  ['frame-flush','loop','  battleAudio?.flush();','','loop:'],
  ['bulk-entry','bulk','    battleAudio?.silence();\n    try {','    try {','bulk: historical'],
  ['bulk-finally','bulk','finally { battleAudio?.silence(); }','finally {}','bulk: historical'],
  ['help-open','help','audioHelpActive = true; pausedBeforeHelp','audioHelpActive = false; pausedBeforeHelp','help: opening'],
  ['help-close','help','audioHelpActive = false; paused = pausedBeforeHelp','audioHelpActive = true; paused = pausedBeforeHelp','help: closing'],
];
for(const [name,group,from,to,prefix] of mutations){
  const target=group==='activity'?extract(source,'syncBattleAudio'):source;
  assert.equal(target.split(from).length-1,1,`fixture: unique ${name} source anchor`);let failure;
  const broken=group==='activity'?source.replace(target,target.replace(from,to)):source.replace(from,to);
  try{groups[group](broken);}catch(e){failure=e;}
  assert(failure instanceof assert.AssertionError&&failure.message.startsWith(prefix),`negative ${name}: first red must be ${prefix}, got ${failure?.stack??'no failure'}`);
  console.log(`RED audio-main ${name}: ${prefix}`);
}
console.log(`OK audio-main ${Object.keys(groups).length} groups / ${mutations.length} semantic negatives; VM-only, not browser evidence`);
