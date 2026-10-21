// R125: independent expected text, actual production/replay, isolated exact-first-red mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, TICK_HZ, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, SIDE_PLAYER, SIDE_ENEMY, N, idx, inMap } from '../src/sim/world.ts';
import { startEco, ecoStep, hqAlive, ECO_POP } from '../src/sim/eco.ts';
import { step, runLog } from '../src/sim/step.ts';
const url = new URL('../src/ui/productionCountdown.ts', import.meta.url), source = fs.readFileSync(url, 'utf8');
const signature = 'export function productionCountdown(w: World, enabled = true): string {';
const finalReturn = 'return `${labels[kind]}：${status} · 後續 ${queue.length - 1}`;';
const cacheEdits = [[signature, `let lastTick = -1, lastText = '';\n${signature}\n  if (w.tick === lastTick) return lastText;\n  lastTick = w.tick;`], [finalReturn, finalReturn.replace('return ', 'return lastText = ')]];
const mutations = {};
function mutation(name, group, from, to, message) { mutations[name] = { group, edits: [[from, to]], message }; }
const labels = [[UK_TANK,'坦克'],[UK_HOWITZER,'榴彈砲'],[UK_OBSERVER,'觀測員'],[UK_INFANTRY,'步兵'],[UK_ATGUN,'反戰車砲'],[UK_MORTAR,'迫擊砲'],[UK_LIGHT,'輕坦克'],[UK_HEAVY,'重坦克']];
for (const [kind,label] of labels) mutation(`label_${kind}`, 'labels', `'${label}'`, `'錯誤'`, `kind ${kind} uses its own localized production label`);
mutation('no_eco', 'no_eco', signature, `${signature}\n  if (!w.eco) return '製造剩餘 0 遊戲秒';`, 'non-economic world has no countdown');
mutation('empty', 'empty', "if (!queue.length) return '';", "if (!queue.length) return '製造剩餘 0 遊戲秒';", 'empty friendly queue clears stale countdown');
mutation('enemy_queue', 'enemy', 'w.eco.queue[SIDE_PLAYER]', 'w.eco.queue[SIDE_ENEMY]', 'enemy queue and progress never affect friendly countdown');
mutation('enemy_progress', 'enemy', 'w.eco.prog[SIDE_PLAYER]', 'w.eco.prog[SIDE_ENEMY]', 'enemy queue and progress never affect friendly countdown');
mutation('winner', 'winner', 'w.winner >= 0 || ', '', 'every terminal winner state clears countdown');
mutation('hq', 'hq', ' || !hqAlive(w, SIDE_PLAYER)', '', 'destroyed friendly headquarters clears countdown before another step');
mutation('first', 'first', 'UNIT_KINDS[kind].buildTicks - w.eco.prog[SIDE_PLAYER]', 'UNIT_KINDS[kind].buildTicks + 1 - w.eco.prog[SIDE_PLAYER]', 'first manufacturing tick uses the full nominal build duration');
mutation('ceil', 'last_tick', 'Math.ceil(remaining / TICK_HZ)', 'Math.floor(remaining / TICK_HZ)', 'one remaining tick displays one game second');
mutation('rounding', 'rounding', 'Math.ceil(remaining / TICK_HZ)', 'Math.round(remaining / TICK_HZ)', 'one tick beyond a whole second rounds upward');
mutation('nominal', 'progress', ' - w.eco.prog[SIDE_PLAYER]', '', 'remaining time subtracts stored progress');
mutation('head', 'head', 'const kind = queue[0]', 'const kind = queue[queue.length - 1]', 'only the current head determines manufacturing time');
mutation('tail', 'tail', '${queue.length - 1}', '${queue.length}', 'following count excludes the current head');
mutation('waiting', 'waiting', 'remaining > 0', 'remaining >= 0', 'completed manufacturing waits for deployment instead of zero seconds');
mutation('overrun', 'overrun', "'等待部署'", "'已到場'", 'legacy overrun progress still waits rather than promising arrival');
mutation('units', 'units', ' 遊戲秒`', ' 秒`', 'manufacturing seconds explicitly identify simulation time');
mutation('paused', 'paused', signature, `${signature}\n  if (w.eco) w.eco.prog[SIDE_PLAYER] += TICK_HZ;`, 'paused repeated reads do not advance the countdown');
mutation('wall_clock', 'wall_clock', 'remaining / TICK_HZ', '(remaining - Date.now()) / TICK_HZ', 'wall clock changes do not change manufacturing seconds');
mutation('speed', 'speed', 'remaining / TICK_HZ', 'remaining / (TICK_HZ * 2)', 'simulation batching does not redefine a game second');
for (const [group,message] of [['freshness','same-tick queue replacement reads current data'],['restart','replacement world at reused tick reads its own production'],['restored','restored world at reused tick reads its own progress']]) mutations[`cache_${group}`] = { group, edits: cacheEdits, message };
mutation('valve', 'valve', '!enabled || ', '', 'disabled countdown clears immediately');
mutation('readonly_world', 'readonly_world', signature, `${signature}\n  w.rng ^= 1;`, 'countdown preserves the entire World including RNG and events');
mutation('readonly_queue', 'readonly_queue', signature, `${signature}\n  if (w.eco) w.eco.queue[SIDE_PLAYER].reverse();`, 'countdown preserves queue order and contents');
mutation('population', 'population', "'等待部署'", "'已到場'", 'population cap preserves a waiting deployment without countdown');
mutation('blocked', 'blocked', "'等待部署'", "'已到場'", 'blocked headquarters exits preserve waiting deployment');
mutation('actual', 'actual', ' - w.eco.prog[SIDE_PLAYER]', '', 'actual issued production reports its elapsed simulation progress');
// Add the enemy constant only to the isolated mutant module; production has no reason to import it.
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9), selected = process.env.R125_COUNTDOWN_GROUP;
let code = source;
if (mutant) {
  const m = mutations[mutant]; assert.ok(m, 'known mutant');
  for (const [from,to] of m.edits) { assert.equal(code.split(from).length-1,1,`${mutant}: unique mutation anchor`); code=code.replace(from,to); }
  code = code.replace('import { SIDE_PLAYER,', 'import { SIDE_ENEMY, SIDE_PLAYER,');
}
const js = stripTypeScriptTypes(code).replace(/from '([^']+)'/g, (_,s) => `from '${new URL(s,url).href}'`);
const { productionCountdown: read } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function fixture(kind=UK_TANK, remaining=2*TICK_HZ) {
  const w=createWorld(1944); w.units=[]; startEco(w,1,1,1); w.units=[];
  assert.ok(hqAlive(w,0) && hqAlive(w,1),'fixture has both live headquarters');
  w.eco.queue[0]=[kind]; w.eco.prog[0]=UNIT_KINDS[kind].buildTicks-remaining; return w;
}
const text=(label='坦克',seconds=2,tail=0)=>`${label}：製造剩餘 ${seconds} 遊戲秒 · 後續 ${tail}`;
const wait=(label='坦克',tail=0)=>`${label}：等待部署 · 後續 ${tail}`;
let groups=0;
function group(name,fn) { if(selected && selected!==name)return; try { fn(); groups++; console.log(`OK production-countdown: ${name}`); } catch(e) { console.error(`FIRST_PRODUCTION_FAILURE=${JSON.stringify({group:name,name:e.name,message:e.message.split('\n')[0]})}`); throw e; } }
group('labels',()=>{for(const [kind,label] of labels) assert.equal(read(fixture(kind)),text(label),`kind ${kind} uses its own localized production label`);});
group('no_eco',()=>{assert.equal(read(createWorld(1944)),'','non-economic world has no countdown');});
group('empty',()=>{const w=fixture();read(w);w.eco.queue[0]=[];assert.equal(read(w),'','empty friendly queue clears stale countdown');w.eco.queue[1]=[UK_HEAVY];assert.equal(read(w),'','enemy-only queue stays hidden');});
group('enemy',()=>{const w=fixture();w.eco.queue[1]=[UK_HEAVY,UK_OBSERVER];w.eco.prog[1]=7;assert.equal(read(w),text(),'enemy queue and progress never affect friendly countdown');w.blds[w.eco.hq[1]-1].hp=0;assert.equal(read(w),text(),'enemy HQ does not hide friendly queue before winner is set');});
group('winner',()=>{for(const winner of [0,1,2]){const w=fixture();read(w);w.winner=winner;assert.equal(read(w),'','every terminal winner state clears countdown');}});
group('hq',()=>{const w=fixture();read(w);w.blds[w.eco.hq[0]-1].hp=0;assert.equal(read(w),'','destroyed friendly headquarters clears countdown before another step');w.eco.hq[0]=0;assert.equal(read(w),'','missing headquarters has no countdown');});
group('first',()=>{for(const [kind,label] of labels){const ticks=UNIT_KINDS[kind].buildTicks;const w=fixture(kind,ticks);assert.equal(read(w),text(label,Math.ceil(ticks/TICK_HZ)),'first manufacturing tick uses the full nominal build duration');w.eco.prog[0]=1;assert.equal(read(w),text(label,Math.ceil((ticks-1)/TICK_HZ)),'first progressed tick is derived from the unit duration');}});
group('last_tick',()=>assert.equal(read(fixture(UK_TANK,1)),text('坦克',1),'one remaining tick displays one game second'));
group('rounding',()=>{const w=fixture(UK_TANK,TICK_HZ+1);assert.equal(read(w),text('坦克',2),'one tick beyond a whole second rounds upward');for(const remaining of [TICK_HZ-1,TICK_HZ]){w.eco.prog[0]=UNIT_KINDS[0].buildTicks-remaining;assert.equal(read(w),text('坦克',1),'whole-second boundary stays one');}});
group('progress',()=>assert.equal(read(fixture(UK_HOWITZER,3*TICK_HZ)),text('榴彈砲',3),'remaining time subtracts stored progress'));
group('head',()=>{const w=fixture();w.eco.queue[0].push(UK_HEAVY);assert.equal(read(w),text('坦克',2,1),'only the current head determines manufacturing time');});
group('tail',()=>{for(let n=1;n<=5;n++){const w=fixture();w.eco.queue[0]=Array(n).fill(UK_TANK);assert.equal(read(w),text('坦克',2,n-1),'following count excludes the current head');}});
group('waiting',()=>assert.equal(read(fixture(UK_TANK,0)),wait(),'completed manufacturing waits for deployment instead of zero seconds'));
group('overrun',()=>assert.equal(read(fixture(UK_TANK,-TICK_HZ)),wait(),'legacy overrun progress still waits rather than promising arrival'));
group('units',()=>assert.match(read(fixture()),/ 遊戲秒 · 後續 /,'manufacturing seconds explicitly identify simulation time'));
group('paused',()=>{const w=fixture();for(let i=0;i<100;i++)assert.equal(read(w),text(),'paused repeated reads do not advance the countdown');w.tick+=TICK_HZ*100;assert.equal(read(w),text(),'world tick is not a substitute for stored manufacturing progress');});
group('wall_clock',()=>{const w=fixture(),now=Date.now;try{for(const ms of [0,1000,999999]){Date.now=()=>ms;assert.equal(read(w),text(),'wall clock changes do not change manufacturing seconds');}}finally{Date.now=now;}});
group('speed',()=>{const a=fixture(UK_TANK,3*TICK_HZ),b=structuredClone(a);for(let i=0;i<TICK_HZ;i++){ecoStep(a);a.tick++;read(a);}for(let batch=0;batch<4;batch++)for(let i=0;i<TICK_HZ/4;i++){ecoStep(b);b.tick++;}assert.equal(read(a),text(),'simulation batching does not redefine a game second');assert.equal(read(b),text(),'fewer presentation frames preserve the same countdown');assert.equal(hashWorld(a),hashWorld(b),'different read frequencies preserve identical simulation');});
group('freshness',()=>{const w=fixture();assert.equal(read(w),text());w.eco.queue[0]=[UK_HEAVY];w.eco.prog[0]=UNIT_KINDS[UK_HEAVY].buildTicks-3*TICK_HZ;assert.equal(read(w),text('重坦克',3),'same-tick queue replacement reads current data');});
group('restart',()=>{assert.equal(read(fixture()),text());assert.equal(read(fixture(UK_HOWITZER)),text('榴彈砲'),'replacement world at reused tick reads its own production');assert.equal(read(createWorld(1944)),'','restart with no economy removes previous text');});
group('restored',()=>{const w=fixture();assert.equal(read(w),text());const restored=structuredClone(w);restored.eco.prog[0]=UNIT_KINDS[0].buildTicks-1;assert.equal(read(restored),text('坦克',1),'restored world at reused tick reads its own progress');});
group('valve',()=>{const w=fixture();assert.equal(read(w),text());assert.equal(read(w,false),'','disabled countdown clears immediately');assert.equal(read(w,true),text(),'reenabling reconstructs live countdown');});
group('readonly_world',()=>{const w=fixture(),before=structuredClone(w),hash=hashWorld(w);read(w);assert.deepEqual(w,before,'countdown preserves the entire World including RNG and events');read(w,false);assert.equal(hashWorld(w),hash,'valve preserves simulation hash');Object.freeze(w);assert.equal(read(w),text(),'frozen world is readable');});
group('readonly_queue',()=>{const w=fixture();w.eco.queue[0].push(UK_HEAVY,UK_HOWITZER);const before=structuredClone(w.eco);read(w);assert.deepEqual(w.eco,before,'countdown preserves queue order and contents');for(const q of w.eco.queue)Object.freeze(q);Object.freeze(w.eco.queue);Object.freeze(w.eco.prog);Object.freeze(w.eco);assert.equal(read(w),text('坦克',2,2),'deeply frozen economy is readable');});
group('population',()=>{const w=fixture(UK_TANK,0);const sample=createWorld(1944).units.find(u=>u.kind===UK_OBSERVER);w.units=Array.from({length:ECO_POP},(_,i)=>({...structuredClone(sample),id:i+1,side:0}));for(let i=0;i<3*TICK_HZ;i++){ecoStep(w);w.tick++;assert.equal(read(w),wait(),'population cap preserves a waiting deployment without countdown');}assert.equal(w.eco.prog[0],UNIT_KINDS[0].buildTicks,'cap does not consume more manufacturing ticks');w.units[0].alive=false;ecoStep(w);assert.equal(read(w),'','released population deploys and removes the current item');assert.equal(w.units.length,ECO_POP+1,'released cap actually spawns queued unit');});
group('blocked',()=>{const w=fixture(UK_TANK,0),hq=hqAlive(w,0),ring=[];for(let z=hq.z-1;z<=hq.z+hq.d;z++)for(let x=hq.x-1;x<=hq.x+hq.w;x++)if(inMap(x,z)&&!w.occ[idx(x,z)]){ring.push(idx(x,z));w.occ[idx(x,z)]=hq.id;}assert.ok(ring.length>0,'fixture has exits to block');for(let i=0;i<TICK_HZ;i++){ecoStep(w);w.tick++;assert.equal(read(w),wait(),'blocked headquarters exits preserve waiting deployment');}for(const cell of ring)w.occ[cell]=0;ecoStep(w);assert.equal(read(w),'','cleared exit allows actual deployment');assert.equal(w.units.length,1,'clear exit spawns the finished unit');});
group('actual',()=>{const log=[{tick:0,cmd:{t:'eco'}},{tick:1,cmd:{t:'produce',side:0,kind:UK_OBSERVER}}];const w=createWorld(1944),elapsed=TICK_HZ+1;for(let t=0;t<=elapsed;t++)step(w,log.filter(e=>e.tick===t).map(e=>e.cmd));assert.deepEqual(w.eco.queue[0],[UK_OBSERVER],'actual produce command was accepted');assert.equal(w.eco.prog[0],elapsed,'actual simulation advanced queued production');const expected=text('觀測員',Math.ceil((UNIT_KINDS[UK_OBSERVER].buildTicks-elapsed)/TICK_HZ));assert.equal(read(w),expected,'actual issued production reports its elapsed simulation progress');const replay=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),w.tick);assert.equal(hashWorld(replay),hashWorld(w),'JSON command replay retains identical World hash');assert.equal(read(replay),expected,'replay reconstructs exact countdown');const resumed=structuredClone(w);for(let i=0;i<TICK_HZ;i++){step(w,[]);step(resumed,[]);read(w);}assert.equal(hashWorld(resumed),hashWorld(w),'cloned continuation is not affected by rendering');assert.equal(read(resumed),read(w),'cloned continuation reports identical countdown');});
if(process.argv.includes('--mutations')){
  assert.equal(new Set(Object.values(mutations).map(m=>m.group)).size,groups,'every positive group has an isolated negative');
  for(const [name,m] of Object.entries(mutations)){
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--mutant=${name}`],{encoding:'utf8',timeout:25000,env:{...process.env,R125_COUNTDOWN_GROUP:m.group}}),output=`${child.stdout}\n${child.stderr}`;
    assert.equal(child.error,undefined,`${name}: child finishes`);assert.notEqual(child.status,0,`${name}: mutant must fail`);
    const first=output.match(/^FIRST_PRODUCTION_FAILURE=(.*)$/m);assert.ok(first,`${name}: semantic guard reached, not syntax/import error\n${output}`);
    assert.deepEqual(JSON.parse(first[1]),{group:m.group,name:'AssertionError',message:m.message},`${name}: exact intended first failure\n${output}`);
    assert.equal((output.match(/^FIRST_PRODUCTION_FAILURE=/gm)||[]).length,1,`${name}: only intended group fails`);console.log(`OK production-countdown negative: ${name} -> ${m.message}`);
  }
  console.log(`production-countdown: ${Object.keys(mutations).length} isolated negatives OK`);
}
assert.ok(groups>0,'at least one production-countdown guard executes');
console.log(`production-countdown: ${groups} groups OK`);
