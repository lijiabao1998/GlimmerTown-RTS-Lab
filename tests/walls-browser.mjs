// R120: native construction, original-log replay, actual projectile damage and visible wall fallback.
// One temporary Vite build contains read-only observation and dormant semantic faults; production is untouched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, N, SUB, BK_COTTAGE, BK_HQ, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE,
  isWallKind, UNIT_KINDS, UK_TANK, UK_HOWITZER, ORD_IDLE, SHELL_AP, SHELL_HE, stageOf } from '../src/sim/world.ts';
import { applyBuild, pointsUsed } from '../src/sim/build.ts';
import { applyTrench } from '../src/sim/trenches.ts';
import { applyMap } from '../src/sim/maps.ts';
import { step, runLog } from '../src/sim/step.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r120-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const fixtureOnly = process.argv.includes('--fixture-only'), buildOnly = process.argv.includes('--build-only');
const summary = [], record = s => { summary.push(s); console.log(s); };
const digest = s => createHash('sha256').update(s).digest('hex');
const canonical = commands => commands.map(c => ({ ...c, rot: c.rot ?? 0 }));
const walls = [BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE];
const opening = createWorld(1944); applyMap(opening, 1, 1);
// Deliberately fixed, independently chosen legal coordinates. Never search away a regression.
const network = [
  { t: 'build', side: 0, kind: 7, x: 18, z: 26 },
  { t: 'build', side: 0, kind: 8, x: 20, z: 26 },
  { t: 'build', side: 0, kind: 9, x: 22, z: 26, rot: 1 },
  { t: 'trench', side: 0, kind: 0, x: 18, z: 23, rot: 0 },
  { t: 'build', side: 0, kind: BK_COTTAGE, x: 26, z: 23 },
];
const maxCoordinates = [
  [[18,26],[20,26],[22,26],[18,27],[20,27],[22,27],[18,28],[20,28]],
  [[4,0],[6,0],[8,0],[4,1],[6,1],[8,1],[4,2],[6,2]],
];
const maxWalls = maxCoordinates.map((coords, side) => coords.map(([x,z]) => ({ t:'build',side,kind:7,x,z })));
const mixedTrenches = [ [[17,17],[21,17],[21,20],[18,23]], [[16,0],[25,0],[16,1],[4,2]] ];
const maxMixed = maxWalls.map((p,side) => [...p.slice(0,4), ...mixedTrenches[side].map(([x,z]) => ({t:'trench',side,kind:2,x,z,rot:0}))]);
function applyPlan(s, plan) {
  for (const c of plan) assert.equal(c.t === 'trench' ? applyTrench(s,c) : applyBuild(s,c), null, `fixture: fixed ${JSON.stringify(c)} is legal`);
  return s;
}
const preview = applyPlan(structuredClone(opening), network);
// Each log independently fits both eight-point budgets and includes all materials/rotations.
const dualRotationCases = [0,1].map(rot => {
  const commands=[];
  for(let i=0;i<3;i++)for(const side of [0,1])commands.push({t:'build',side,kind:7+i,x:side?4+2*i:18+2*i,z:side?0:26,rot});
  commands.splice(2,0,{t:'trench',side:0,kind:0,x:18,z:23,rot:0});
  commands.push({t:'trench',side:1,kind:2,x:16,z:0,rot:0});
  applyPlan(structuredClone(opening),commands);
  const log=[{tick:0,cmd:{t:'map',id:1,vegetation:1}},...commands.map(cmd=>({tick:0,cmd}))];
  return {rot,log,world:runLog(createWorld(1944),log,1)};
});
const budgetCases = [['walls', maxWalls], ['mixed', maxMixed]].map(([name, plans]) => {
  const preview = applyPlan(structuredClone(opening), plans[0]);
  const both = applyPlan(structuredClone(preview), plans[1]);
  const log = [{tick:0,cmd:{t:'map',id:1,vegetation:1}}, ...plans.flat().map(cmd=>({tick:0,cmd})), {tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}}];
  return {name,plans,preview,both,log,battle:runLog(createWorld(1944),log,1)};
});

// Real AP/HE land() damage, not assigned test HP. Widely spaced walls avoid cross-target HE splash.
function galleryWorld(empty = false) {
  const s = createWorld(1944);
  s.ter.fill(0); s.occ.fill(0); s.crater.fill(0); s.blds=[]; s.units=[]; s.shells=[]; s.events=[];
  if (!empty) for (let i=0;i<3;i++) applyBuild(s,{t:'build',side:0,kind:7+i,x:18+i*4,z:20,rot:i===1?1:0});
  for (const [side,kind,x,z] of [[1,UK_TANK,18,16],[1,UK_HOWITZER,18,14],[0,UK_TANK,22,23]]) {
    s.units.push({id:s.units.length+1,side,kind,x:(x+.5)*SUB,z:(z+.5)*SUB,hp:1000000,alive:true,order:ORD_IDLE,
      target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:1000000,aimX:SUB,aimZ:0});
  }
  s.events=[];
  return s;
}
function queueImpacts(s, stage) {
  const shell = stage===1?SHELL_AP:SHELL_HE, shooter=s.units[stage===1?0:1], dmg=UNIT_KINDS[shooter.kind].dmgBld;
  for (const b of s.blds) {
    const count=stage===1?Math.ceil(b.maxHp*3/(10*dmg)):Math.ceil(b.hp/dmg);
    for(let n=0;n<count;n++)s.shells.push({id:s.nextShell++,side:1,kind:shell,shooter:shooter.id,sx:shooter.x,sz:shooter.z,
      ex:(b.x+.5)*SUB,ez:(b.z+.5)*SUB,t:0,T:1,target:0,hitBld:shell===SHELL_AP?b.id:0});
  }
}
const stages=[galleryWorld()];
for(let stage=1;stage<=2;stage++){const s=structuredClone(stages.at(-1));queueImpacts(s,stage);step(s,[]);stages.push(s);}
const expectedDamaged=[130,220,360].map(hp=>hp-Math.ceil(hp*3/(10*UNIT_KINDS[UK_TANK].dmgBld))*UNIT_KINDS[UK_TANK].dmgBld);
function fixtures() {
  assert.deepEqual(walls,[7,8,9],'fixture: immutable wall kind contract');
  assert.equal(pointsUsed(preview,0),8,'fixture: three materials, trench and cottage share exactly eight');
  assert.deepEqual(preview.blds.filter(b=>isWallKind(b.kind)).map(b=>[b.kind,b.w,b.d,b.hp]),[[7,2,1,130],[8,2,1,220],[9,1,2,360]],'fixture: connected mixed dimensions and HP');
  for(const c of budgetCases){assert.deepEqual([pointsUsed(c.both,0),pointsUsed(c.both,1)],[8,8],'fixture: each maximum side spends exactly eight');assert.equal(c.battle.eco.hq.length,2,'fixture: maximum battle includes both HQ entries');for(const [side,id]of c.battle.eco.hq.entries()){const hq=c.battle.blds[id-1];assert(id>0&&hq?.id===id&&hq.kind===BK_HQ&&hq.builtBy===side&&hq.hp>0,'fixture: both nonzero HQ IDs identify live side-owned headquarters');}}
  assert.equal(budgetCases[0].both.blds.filter(b=>isWallKind(b.kind)).length,16,'fixture: maximum affordable sixteen wall segments');
  assert.deepEqual(stages.map(s=>s.blds.map(stageOf)),[[0,0,0],[1,1,1],[2,2,2]],'fixture: actual AP then HE produces all three damage stages');
  assert.deepEqual(stages[1].blds.map(b=>b.hp),expectedDamaged,'fixture: concrete takes ordinary AP damage');
  assert.deepEqual(stages[2].blds.map(b=>b.hp),[0,0,0],'fixture: HE really destroys all three walls');
  for(const kind of walls)for(const rot of [0,1])applyPlan(structuredClone(opening),[{t:'build',side:0,kind,x:20,z:26,rot}]);
  record(`R120 Node fixtures: connected8 ${hashWorld(preview)}; maximum16 walls and mixed both-side8; actual AP HP ${expectedDamaged}, HE HP0; gallery hashes ${stages.map(hashWorld).join('/')}`);
}

const instrumentation = `
import { ORD_IDLE, SHELL_AP, stageOf } from './sim/world.ts';
${galleryWorld.toString()}
${queueImpacts.toString()}
(window as any).__r120test = {
  inspect: () => ({tick:w.tick,hash:hashWorld(w),rng:w.rng,phase,plan:structuredClone(plan),log:structuredClone(log),left:pointsLeft(),
    pickKind,pickRot,pickTrench,trenchRot,blds:structuredClone(w.blds),shown:structuredClone(view.world.blds),
    shownHash:hashWorld(view.world),trenches:structuredClone(w.trenches??null),stages:w.blds.filter(b=>isWallKind(b.kind)).map(stageOf),
    vertices:(view as any).town.geometry.attributes.position.count,meshes:(()=>{let n=0;view.scene.traverse(o=>{if((o as any).isMesh)n++;});return n;})()}),
  world: () => JSON.stringify(w),
  gallery: (empty=false) => { reset(1944,false,false,false,false,false);w=galleryWorld(empty);phase='battle';plan=[];pending=[];log=[];acc=0;paused=true;
    view.setWorld(w,-1);view.snapshot();stats=newStats(w);minimap?.dirty();ui();return hashWorld(w); },
  impact: (stage:number) => {queueImpacts(w,stage);tick();return hashWorld(w);},
  maximum: (p:PlanCmd[]) => {reset(1944,true,false,false,true,true);plan=structuredClone(p);refreshPreview();paused=true;ui();},
  mutation: (name:string) => { (globalThis as any).__r120mutation=name;
    if(name==='layout'){const b=document.getElementById('bb-k7')!;b.style.cssText='min-width:30px;max-width:30px;width:30px;min-height:30px;max-height:30px;height:30px;padding:0';} },
};`;
function isolatedPlugin(hits) {
  const is = name => `(globalThis as any).__r120mutation === '${name}'`;
  return {name:'r120-isolated-observation-and-faults',enforce:'pre',transform(code,id){
    const rel=path.relative(ROOT,id.split('?')[0]).replaceAll('\\','/');
    const replace=(from,to,label)=>{assert.equal(code.split(from).length-1,1,`fixture: unique R120 anchor ${label}`);code=code.replace(from,to);hits.add(label);};
    if(rel==='src/main.ts'){
      replace("const r120 = q.get('noR120') !== '1';","const r120 = q.get('__r120mutant') === 'valve' || q.get('noR120') !== '1';",'valve');
      replace('pickRot = 1 - pickRot;',`pickRot = ${is('rotation')} ? pickRot : 1 - pickRot;`,'rotation');
      replace('plan.splice(k, 1);',`if (!(${is('remove')})) plan.splice(k, 1);`,'remove-mesh');
      replace('plan.splice(wallIndex, 1);',`if (!(${is('remove')})) plan.splice(wallIndex, 1);`,'remove-footprint');
      replace('if (plan.pop())',`if (!(${is('undo')}) && plan.pop())`,'undo');
      replace('for (const c of plan) issue(c);',`for (const c of plan) if (!(c.t==='build' && isWallKind(c.kind) && (${is('record')}))) issue(c);`,'record');
      replace("pickTrench = -1; pickKind = kind;",`if(!(${is('selection')})) pickTrench = -1; pickKind = kind; if(${is('leak')}){const p=view.screenOf(20.5,0,26.5,innerWidth,innerHeight);placeAt(p[0],p[1]);}`,'leak');
      replace('while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick) issue(lg[i].cmd); i++; }',"while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick && !(q.get('__r120mutant') === 'replay' && !r120 && lg[i].cmd.t === 'build' && isWallKind((lg[i].cmd as BuildCmd).kind))) issue(lg[i].cmd); i++; }",'replay');
      code+=instrumentation;hits.add('observation');
    }
    if(rel==='src/sim/step.ts')replace('if (b.hp <= 0 || dmg <= 0) return;',`if (b.hp <= 0 || dmg <= 0) return; if (${is('damage')} && b.kind===9) dmg >>= 2;`,'damage');
    if(rel==='src/render/buildings.ts')replace('if (!wallsOn && isWallKind(b.kind)) b = { ...b, kind: BK_HOUSE };',`if (!wallsOn && isWallKind(b.kind)) { if (${is('fallback')}) return g; b = { ...b, kind: BK_HOUSE }; }`,'fallback');
    return code;
  }};
}

async function main(){
  fixtures();if(fixtureOnly)return;
  const started=Date.now(),out=path.join(temp,'site'),hits=new Set();
  await build({root:ROOT,logLevel:'error',plugins:[isolatedPlugin(hits)],build:{outDir:out}});
  assert.equal(hits.size,11,'fixture: observational hook and every dormant fault compiled');
  record('R120 isolated fixture/semantic-fault bundle compiled; this is not a real Chrome pass');if(buildOnly)return;
  await withBrowser({root:out,port:8440,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:50},async({open,page})=>{
    const send=page.send.bind(page),evaluate=page.evaluate.bind(page);
    const bounded=async(p,label)=>{let timer;const ms=Math.min(8000,110000-(Date.now()-started));if(ms<=0)throw Error('R120 operational deadline');try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout: '+label)),ms);})]);}finally{clearTimeout(timer);}};
    page.send=(m,a)=>bounded(send(m,a),m);page.evaluate=e=>bounded(evaluate(e),'evaluate');
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const settle=async()=>{await sleep(75);await frames();},inspect=()=>E('__r120test.inspect()');
    const viewport=async mobile=>{await page.send('Emulation.setDeviceMetricsOverride',{width:mobile?412:1280,height:mobile?860:800,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});};
    const fresh=async(q='')=>{await open('seed=1944&noR018=1&noR016=1&'+q);await E('__rts.pause(true)');await settle();assert(await E('!!window.__r120test'),'fixture: real production initialized');};
    const click=async(x,y,mobile)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
    const button=async(id,mobile,checkLeak=true)=>{
      const before=checkLeak?await inspect():null;
      const p=await E(`(()=>{const b=document.getElementById(${JSON.stringify(id)});if(!b)return null;const r=b.getBoundingClientRect(),points=[[r.x+r.width/2,r.y+r.height/2],[r.left+5,r.top+5],[r.right-5,r.top+5],[r.left+5,r.bottom-5],[r.right-5,r.bottom-5]];return[r.x+r.width/2,r.y+r.height/2,r.width,r.height,!b.hidden&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&points.every(([x,y])=>b.contains(document.elementFromPoint(x,y)))]})()`);
      assert(p&&p[4]&&p[2]>=44&&p[3]>=44,`layout: ${id} is a visible unobstructed 44px target at center and corners`);
      await click(p[0],p[1],mobile);
      if(checkLeak){const after=await inspect();assert.deepEqual(after.plan,before.plan,'input: picker and rotation clicks never leak map placements');assert.equal(after.hash,before.hash,'input: picker clicks preserve the actual world');}
    };
    const focus=async(x=21,z=25,zoom=1.25)=>{await E(`__rts.focus(${x},${z},${zoom})`);await settle();};
    const cell=async(x,z,mobile)=>{await focus(x+.5,z+.5);const p=await E(`__rts.screenOfCell(${x},${z})`);assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: native map target is unobstructed');await click(p[0],p[1],mobile);await frames();};
    const choose=async(c,mobile)=>{
      if(c.t==='trench'){await button('bb-trench',mobile);await button('bb-t'+c.kind,mobile);assert(await E("document.getElementById('bb-walls').hidden"),'selection: trench selection hides wall row');}
      else{if(isWallKind(c.kind))await button('bb-wall',mobile);await button('bb-k'+c.kind,mobile);assert.equal((await inspect()).pickTrench,-1,'selection: ordinary/wall selection clears trench mode');if(isWallKind(c.kind))assert(await E("document.getElementById('bb-trenches').hidden"),'selection: wall selection hides trench row');}
      const s=await inspect(),rot=c.t==='trench'?s.trenchRot:s.pickRot;
      if(rot!==(c.rot??0))await button('bb-rot',mobile);
    };
    const place=async(c,mobile)=>{await choose(c,mobile);await cell(c.x,c.z,mobile);};
    const planCheck=async expected=>assert.deepEqual(canonical((await inspect()).plan),canonical(expected),'placement: native wall plan preserves exact kinds, anchors and rotations');
    const removeCheck=async()=>assert.deepEqual((await inspect()).plan,[],'remove: either footprint cell removes the whole wall and refunds its cost');
    const recordCheck=async expected=>{const s=await inspect();assert.deepEqual(canonical(s.log.filter(e=>e.cmd.side===0&&(e.cmd.t==='build'||e.cmd.t==='trench')).map(e=>e.cmd)),canonical(expected),'record: start writes the entire mixed plan in its original order');return s;};
    const pickerLayout=async()=>{const r=await E(`(()=>{const b=document.getElementById('buildbar').getBoundingClientRect(),h=document.getElementById('hint').getBoundingClientRect(),m=document.getElementById('minimap').getBoundingClientRect();return{b:b.toJSON(),h:h.toJSON(),m:m.toJSON(),width:innerWidth,height:innerHeight}})()`);assert(r.b.left>=0&&r.b.right<=r.width&&r.b.top>=r.m.bottom&&r.b.bottom<=r.h.top-6&&r.h.bottom<=r.height,'layout: expanded picker clears minimap, hint and viewport');};
    const sample=async()=>{const s=await E(`({state:__r120test.inspect(),info:__rts.info(),scene:document.querySelector('body>canvas').toDataURL()})`);s.pixel=digest(s.scene);delete s.scene;return s;};
    const shot=async name=>{const png=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(png.data,'base64'));};
    const budget=(s,opening,label)=>assert(s.info.calls<=(opening?20:22)&&s.info.triangles<=80000,`budget: ${label} retains ${opening?20:22}/80000 (${s.info.calls}/${s.info.triangles})`);
    const exactWorld=async(expected,label)=>{assert.equal(await E('__r120test.world()'),JSON.stringify(expected),label+': full Node/Chrome world equality');};
    const impactCheck=async()=>{await E('__r120test.impact(1)');const s=await inspect();assert.deepEqual(s.blds.map(b=>b.hp),expectedDamaged,'damage: Chrome AP gives ordinary building damage to all three materials');assert.equal(s.hash,hashWorld(stages[1]),'damage: AP full Node/Chrome hash agrees');await exactWorld(stages[1],'damage AP');};
    const fallbackCheck=async()=>{const s=await inspect();assert(s.vertices>0,'fallback: recorded walls retain nonempty visible ordinary-building geometry');assert.deepEqual(s.blds.map(b=>b.kind),[7,8,9],'fallback: presentation keeps recorded material identities');};
    const valveCheck=async()=>assert(await E("!document.getElementById('bb-wall')&&!document.getElementById('bb-k7')&&!document.getElementById('bb-k8')&&!document.getElementById('bb-k9')"),'valve: noR120 removes only the wall construction choices');
    let recorded;
    for(const mobile of [true,false]){
      const label=mobile?'mobile':'desktop',errors=page.errors.length;await viewport(mobile);await fresh();
      const pristine=await inspect();assert.equal(pristine.pickKind,BK_COTTAGE,'legacy: initial selected building remains cottage');assert.equal(pristine.hash,hashWorld(opening),'fixture: real opening matches Node');
      await button('bb-wall',mobile);await pickerLayout();
      for(let i=0;i<3;i++){
        await button('bb-k'+walls[i],mobile);const detail=await E("document.getElementById('bb-detail').textContent");
        assert(new RegExp(`建材\\s+${i+1}(?:\\s|·|$)`).test(detail)&&new RegExp(`耐久\\s+${[130,220,360][i]}(?:\\s|·|$)`).test(detail),'detail: exact wall cost and HP are explicit');
        for(const term of ['可破壞建築','不可射越','可駐守'])assert(detail.includes(term),'detail: actual tactical limits are explicit');
      }
      // All three kinds and both rotations are really placed; remove through the non-anchor cell.
      for(const kind of walls)for(const rot of [0,1]){
        const c={t:'build',side:0,kind,x:20,z:26,rot};await place(c,mobile);await planCheck([c]);
        await cell(c.x+(rot?0:1),c.z+(rot?1:0),mobile);await removeCheck();assert.equal((await inspect()).left,8,'remove: full material refund');
      }
      const pillbox={t:'build',side:0,kind:6,x:20,z:26};await place(pillbox,mobile);await planCheck([pillbox]);await button('bb-undo',mobile,false);await removeCheck();
      await place(network[0],mobile);await button('bb-undo',mobile,false);await removeCheck();
      for(const c of network)await place(c,mobile);await planCheck(network);
      const built=await inspect();assert.equal(built.left,0,'budget: native mixed eight-point plan');assert.equal(built.hash,pristine.hash,'preview: actual full world remains isolated');assert.equal(built.rng,pristine.rng,'preview: RNG is untouched');assert.deepEqual(built.shown,preview.blds,'preview: rendered buildings match Node accepted placements');
      await button('bb-wall',mobile);await pickerLayout();await focus();const nativePreview=await sample();budget(nativePreview,true,label+' native mixed preview');assert.equal(nativePreview.state.meshes,pristine.meshes,'render: preview adds no mesh');await shot(`r120-${label}-mixed-preview.png`);
      await button('bb-undo',mobile,false);assert.equal((await inspect()).left,1,'undo: shared cottage point refunds');await place(network.at(-1),mobile);await planCheck(network);
      await button('bb-start',mobile,false);await E('__rts.pause(true)');await focus();const started=await recordCheck(network),battle=await sample();recorded=started;budget(battle,false,label+' native battle');
      const expected=runLog(createWorld(1944),started.log,started.tick);assert.equal(started.hash,hashWorld(expected),'replay: native mixed log agrees with Node');await exactWorld(expected,'native original log');await shot(`r120-${label}-mixed-battle.png`);
      await E(`__rts.playLog(1944,${JSON.stringify(started.log)},${started.tick});__rts.pause(true)`);await focus();assert.equal((await inspect()).hash,started.hash,'replay: untouched original log reproduces complete state');await exactWorld(expected,'Chrome replay');
      await button('b-restart',mobile,false);assert.equal((await inspect()).hash,pristine.hash,'reset: no wall or trench state survives restart');assert.deepEqual((await inspect()).plan,[],'reset: planned construction cleared');
      for(const c of dualRotationCases){await E(`__rts.playLog(1944,${JSON.stringify(c.log)},1);__rts.pause(true)`);await exactWorld(c.world,`both-side all-material rotation${c.rot} original log`);}
      for(const c of budgetCases){
        await E(`__r120test.maximum(${JSON.stringify(c.plans[0])})`);await focus();const max=await sample();assert.equal(max.state.left,0,'budget: maximum preview spends exactly eight');assert.deepEqual(max.state.shown,c.preview.blds,'budget: every maximum wall displayed');budget(max,true,label+' maximum '+c.name+' opening');
        await E(`__rts.playLog(1944,${JSON.stringify(c.log)},1);__rts.pause(true)`);await focus();const two=await sample();assert.equal(two.state.hash,hashWorld(c.battle),'budget: both-side maximum and HQs match Node');budget(two,false,label+' maximum '+c.name+' battle');
        record(`R120 ${label} maximum ${c.name}: opening ${max.info.calls}/${max.info.triangles}, both-side combat ${two.info.calls}/${two.info.triangles}`);
        if(mobile)await shot(`r120-mobile-maximum-${c.name}-open${max.info.calls}c-${max.info.triangles}t-battle${two.info.calls}c-${two.info.triangles}t.png`);
      }
      await E('__r120test.gallery()');await focus(22,20,1);const intact=await sample();await exactWorld(stages[0],'intact gallery');budget(intact,false,label+' intact');await shot(`r120-${label}-three-materials-intact.png`);
      await impactCheck();await settle();const damaged=await sample();assert.notEqual(damaged.pixel,intact.pixel,'display: actual AP damage changes wall pixels');budget(damaged,false,label+' damaged');await shot(`r120-${label}-three-materials-damaged.png`);
      await E('__r120test.impact(2)');await settle();const rubble=await sample();await exactWorld(stages[2],'HE rubble');assert.deepEqual(rubble.state.stages,[2,2,2],'damage: HE collapses brick, stone and concrete');assert.notEqual(rubble.pixel,damaged.pixel,'display: actual collapse changes wall pixels');budget(rubble,false,label+' rubble');await shot(`r120-${label}-three-materials-rubble.png`);
      await frames();assert.equal((await inspect()).hash,rubble.state.hash,'render: drawing and effects never mutate world or RNG');
      await fresh('noR120=1');await valveCheck();assert(await E("!!document.getElementById('bb-k1')&&!!document.getElementById('bb-k6')&&!!document.getElementById('bb-trench')"),'legacy: noR120 keeps cottage, pillbox and trench controls');
      assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(started.log)},${started.tick})`),started.hash,'valve: untouched original mixed log retains exact hash with noR120');await E('__rts.pause(true)');await exactWorld(expected,'noR120 original log');
      await E('__r120test.gallery()');await focus(22,20,1);await fallbackCheck();const off=await sample();assert.equal(off.state.hash,intact.state.hash,'valve: fallback has identical simulation');assert.notEqual(off.pixel,intact.pixel,'display: disabled wall art uses different visible ordinary buildings');assert.equal(off.info.calls,intact.info.calls,'render: wall art adds no draw calls');await shot(`r120-${label}-noR120-fallback.png`);
      await E('__r120test.gallery(true)');await focus(22,20,1);assert.notEqual((await sample()).pixel,off.pixel,'fallback: ordinary recorded walls are visibly different from empty ground');
      await E('__r120test.gallery()');await focus(22,20,1);await impactCheck();await E('__r120test.impact(2)');await settle();await fallbackCheck();await exactWorld(stages[2],'noR120 destroyed recorded walls');await shot(`r120-${label}-noR120-rubble.png`);
      await fresh('noR105=1&noR024=1');await button('bb-wall',mobile);await pickerLayout();assert(await E("!document.getElementById('bb-k6')"),'legacy: noR024 still hides only the pillbox');
      await place(network[2],mobile);await planCheck([network[2]]);await E('__r120test.gallery()');await focus(22,20,1);await impactCheck();await E('__r120test.impact(2)');await settle();await exactWorld(stages[2],'noR105/noR024 gallery');budget(await sample(),false,label+' existing valves');await shot(`r120-${label}-noR105-noR024-rubble.png`);
      assert.equal(page.errors.length,errors,label+': no unrelated runtime errors');record(`R120 ${label}: native three kinds/both rotations/connect/remove/undo/start/original replay/reset; all three AP/HE stages, noR120 visible fallback and existing valves`);
    }
    // Every negative must reach its named semantic assertion. Startup/JS errors never count.
    await viewport(true);await fresh();
    const mutation=name=>E(`__r120test.mutation(${JSON.stringify(name)})`);
    const negative=async(name,run,prefix)=>{const errors=page.errors.length;let failure;try{await run();}catch(e){failure=e;}assert(failure instanceof assert.AssertionError&&failure.message.startsWith(prefix),`negative ${name}: expected semantic first red, got ${failure?.stack??'no failure'}`);assert.equal(page.errors.length,errors,`negative ${name}: runtime errors cannot count as a semantic red`);record('RED real Chrome '+name+': '+prefix);};
    await mutation('rotation');await negative('rotation',async()=>{const c={...network[2],x:20,z:26};await place(c,true);await planCheck([c]);},'placement: native wall plan preserves');
    await mutation('');await button('b-restart',true,false);await place(network[0],true);await mutation('remove');await negative('remove',async()=>{await cell(19,26,true);await removeCheck();},'remove: either footprint cell removes');
    await mutation('');await button('b-restart',true,false);await place(network[0],true);await mutation('undo');await negative('undo',async()=>{await button('bb-undo',true,false);await removeCheck();},'remove: either footprint cell removes');
    await mutation('');await button('b-restart',true,false);await place(network[0],true);await mutation('record');await negative('record',async()=>{await button('bb-start',true,false);await E('__rts.pause(true)');await recordCheck([network[0]]);},'record: start writes the entire mixed plan');
    await mutation('');await button('b-restart',true,false);await button('bb-trench',true);await mutation('selection');await negative('selection',async()=>{await button('bb-wall',true);assert.equal((await inspect()).pickTrench,-1,'selection: ordinary/wall selection clears trench mode');},'selection: ordinary/wall selection clears trench mode');
    await mutation('');await button('b-restart',true,false);await mutation('leak');await negative('leak',async()=>{await button('bb-wall',true);},'input: picker and rotation clicks never leak');
    await mutation('');await button('b-restart',true,false);await button('bb-wall',true);await mutation('layout');await negative('layout',async()=>{await button('bb-k7',true);},'layout: bb-k7 is a visible unobstructed 44px target');
    await fresh();await E('__r120test.gallery()');await mutation('damage');await negative('damage',impactCheck,'damage: Chrome AP gives ordinary building damage');await mutation('');
    await fresh('noR120=1');await mutation('fallback');await E('__r120test.gallery()');await negative('fallback',fallbackCheck,'fallback: recorded walls retain nonempty visible');
    await fresh('noR120=1&__r120mutant=valve');await negative('valve',valveCheck,'valve: noR120 removes only the wall');
    await fresh('noR120=1&__r120mutant=replay');await negative('replay',async()=>assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(recorded.log)},${recorded.tick})`),recorded.hash,'valve: untouched original mixed log retains exact hash with noR120'),'valve: untouched original mixed log retains exact hash');
    assert(page.requests.every(r=>r.startsWith('http://127.0.0.1:8440/')||r.startsWith('data:')||r==='about:blank'),'resources: no external models, textures or fonts');
    assert.equal(page.errors.length,0,'runtime: complete positive and negative suite has zero unrelated errors');
  });
  record(`R120 real Chrome complete in ${Date.now()-started}ms; 120-second child limit unchanged`);
}
try{await main();fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r120-browser.txt'),summary.join('\n')+'\n');if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### R120 wall browser guards\n'+summary.map(s=>'- '+s).join('\n')+'\n');}
catch(error){const message=String(error?.stack??error);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message)&&!strictCI){console.error('NOT RUN R120 real Chrome guards: local socket restriction; CI must execute them.');console.error(error.message);process.exitCode=77;}else{console.error(error);console.error('R120 browser FAIL: '+String(error.message).split('\n')[0]);process.exitCode=1;}}
finally{fs.rmSync(temp,{recursive:true,force:true});}
