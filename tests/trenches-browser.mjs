// R118: native mobile/desktop construction, real ground/minimap pixels and same-log simulation.
// Observation, fixed-CPU minimap measurement and controlled mutations exist only in temporary builds.
// Exact RGBA checks normalize the 2D raster backend; automatic backend transitions are not tested.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, N, SUB, UK_TANK, UK_HOWITZER, ORD_IDLE, SHELL_AP, BK_COTTAGE, UNIT_KINDS } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyMap } from '../src/sim/maps.ts';
import { applyBuild, buildError, pointsUsed } from '../src/sim/build.ts';
import { applyTrench, trenchError, trenchCells } from '../src/sim/trenches.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r118-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const buildOnly = process.argv.includes('--build-only'), fixtureOnly = process.argv.includes('--fixture-only');
const summary = [], record = s => { summary.push(s); console.log(s); };
const digest = s => createHash('sha256').update(s).digest('hex');
function pngRGBA(width,height,pixels) {
  const crc=buffer=>{let c=0xffffffff;for(const b of buffer){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),data.length+8);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc((width*4+1)*height),source=Buffer.from(pixels);for(let y=0;y<height;y++)source.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const canonical = plan => plan.map(c => ({ ...c, rot: c.rot ?? 0 }));
const opening = createWorld(1944); applyMap(opening, 1, 1);

// Independently selected connected shapes. Fixed coordinates keep failures reproducible;
// legality is checked below, never silently searched away when implementation changes.
const network = [
  { t: 'trench', side: 0, kind: 2, x: 18, z: 23, rot: 0 },
  { t: 'trench', side: 0, kind: 0, x: 22, z: 23, rot: 0 },
  { t: 'trench', side: 0, kind: 1, x: 18, z: 24, rot: 1 },
  { t: 'trench', side: 0, kind: 3, x: 20, z: 24, rot: 0 },
  { t: 'build', side: 0, kind: BK_COTTAGE, x: 24, z: 23 },
  { t: 'build', side: 0, kind: BK_COTTAGE, x: 26, z: 23 },
];
const preview = structuredClone(opening);
for (const cmd of network) assert.equal(cmd.t === 'trench' ? applyTrench(preview, cmd) : applyBuild(preview, cmd), null, 'fixture: every fixed connected placement is legal');
const maximumPlan = [[28,6],[17,17],[21,17],[17,20],[21,20],[21,22],[26,22],[18,23]].map(([x,z])=>({t:'trench',side:0,kind:2,x,z,rot:0}));
const maximumEnemy = [[4,0],[8,0],[12,0],[16,0],[25,0],[4,1],[8,1],[16,1]].map(([x,z])=>({t:'trench',side:1,kind:2,x,z,rot:0}));
const maximumPreview = structuredClone(opening);
for(const c of maximumPlan) assert.equal(applyTrench(maximumPreview,c),null,'fixture: maximum 32-cell player plan is legal');
const maximumBoth = structuredClone(maximumPreview);
for(const c of maximumEnemy) assert.equal(applyTrench(maximumBoth,c),null,'fixture: maximum 64-cell two-side plan is legal');
const maximumLog=[{tick:0,cmd:{t:'map',id:1,vegetation:1}},...[...maximumPlan,...maximumEnemy].map(cmd=>({tick:0,cmd}))];
const maximumBattle=runLog(createWorld(1944),maximumLog,1);

function trenchFixture(mode = 'cover', kind = UK_TANK) {
  const s = createWorld(1944);
  s.ter.fill(0); s.occ.fill(0); s.crater.fill(0); s.blds = []; s.units = []; s.shells = []; s.events = [];
  applyTrench(s, { t: 'trench', side: 0, kind: 3, x: 20, z: 20, rot: 0 });
  applyTrench(s, { t: 'trench', side: 0, kind: 2, x: 22, z: 20, rot: 0 });
  const add = (side, k, x, z) => s.units.push({ id: s.units.length + 1, side, kind: k, x: (x + 0.5) * SUB, z: (z + 0.5) * SUB,
    hp: 1000000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1000000, aimX: SUB, aimZ: 0 });
  if (mode === 'cover') {
    add(1, UK_TANK, 17, 20); add(0, UK_TANK, 20, 20);
    const [g, t] = s.units;
    s.shells.push({ id: s.nextShell++, side: g.side, kind: SHELL_AP, shooter: g.id, sx: g.x, sz: g.z, ex: t.x, ez: t.z, t: 0, T: 1, target: t.id, hitBld: 0 });
  } else { add(0, kind, 18, 20); add(1, UK_TANK, 2, 2); }
  return s;
}
const cover = trenchFixture(), hit = structuredClone(cover); step(hit, []);
const k = UNIT_KINDS[UK_TANK], expectedDamage = Math.floor(Math.floor(k.dmgUnit * k.pierce / 100) * k.armor * 50 / 10000);
const movement = new Map();
for (const kind of [UK_TANK, UK_HOWITZER]) {
  const s = trenchFixture('move', kind), cmd = { t: 'move', side: 0, ids: [1], x: 26, z: 20 };
  const ticks = Math.ceil(9 * SUB * 100 / (UNIT_KINDS[kind].speed * 70)) + 8;
  step(s, [cmd]); for (let n = 1; n < ticks; n++) step(s, []);
  movement.set(kind, { ticks, cmd, hash: hashWorld(s), position: [s.units[0].x, s.units[0].z] });
}

function fixtures() {
  assert.equal(pointsUsed(preview, 0), 8, 'fixture: network and two cottages exhaust exactly eight shared points');
  assert.equal(maximumPlan.length,8,'fixture: eight cheapest four-cell segments maximize one side footprint');
  assert.equal(new Set(maximumBoth.trenches.segments.flatMap(s=>trenchCells(s).map(([x,z])=>z*N+x))).size,64,'fixture: both sides reach independent 64-cell bound');
  assert.deepEqual([pointsUsed(maximumBoth,0),pointsUsed(maximumBoth,1)],[8,8],'fixture: maximum network respects both eight-point budgets');
  assert.equal(trenchError(preview, {t:'trench',side:0,kind:0,x:22,z:24,rot:0}), 'points', 'fixture: extra native trench is rejected only for exhausted budget');
  assert.deepEqual(preview.trenches.segments.map(s => s.kind), [2, 0, 1, 3], 'fixture: all four templates are present in original order');
  assert.equal(cover.units[1].hp - hit.units[1].hp, expectedDamage, 'fixture: independent reinforced impact damage');
  assert(expectedDamage > 0, 'fixture: meaningful projectile damage');
  for (const [kind, state] of movement) assert.deepEqual(state.position, [26.5 * SUB, 20.5 * SUB], `fixture: unit kind ${kind} crosses both trench segments`);
  record(`R118 fixtures: network ${hashWorld(preview)}, eight points; cover ${hashWorld(cover)} -> ${hashWorld(hit)}, damage ${expectedDamage}; tank/artillery traversal verified in Node`);
}

const instrumentation = `
import { ORD_IDLE, SHELL_AP } from './sim/world.ts';
${trenchFixture.toString()}
(window as any).__r118test = {
  inspect: () => ({tick:w.tick,hash:hashWorld(w),shownHash:hashWorld(view.world),paintWorldCurrent:(globalThis as any).__r118paintWorld===view.world,phase,log:JSON.parse(JSON.stringify(log)),plan:JSON.parse(JSON.stringify(planner.plan)),
    trenches:JSON.parse(JSON.stringify(w.trenches??null)),shown:JSON.parse(JSON.stringify(view.world.trenches??null)),
    units:w.units.map(u=>({id:u.id,x:u.x,z:u.z,hp:u.hp})),left:planner.pointsLeft()}),
  ground: () => Array.from((view as any).groundPx),
  maximumPreview: () => { reset(1944,true,false,false,true,true);planner.plan=${JSON.stringify(maximumPlan)};planner.refreshPreview();paused=true;ui(); },
  fixture: (mode='cover',kind=UK_TANK) => {
    reset(1944,false,false,false,false,false); w=trenchFixture(mode,kind); phase='battle';planner.plan=[];pending=[];log=[];acc=0;paused=true;
    view.setWorld(w,-1);view.snapshot();stats=newStats(w);minimap?.dirty();ui();return hashWorld(w);
  },
  command: (c:Command) => issue(c),
  mutation: (name:string) => { (globalThis as any).__r118mutation=name; },
};`;

function plugin(broken, hits) {
  const is = name => `(globalThis as any).__r118mutation === '${name}'`;
  return { name: broken ? 'r118-isolated-mutants' : 'r118-observation', enforce: 'pre', transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
    const replace = (from, to, label) => { assert.equal(code.split(from).length-1,1,`unique R118 isolated anchor: ${label}`);code=code.replace(from,to);hits.add(label); };
    if (rel === 'src/main.ts') {
      const need = (mod, names) => { const miss = names.filter(n => !new RegExp(`import \\{[^}]*\\b${n}\\b[^}]*\\} from '${mod.replace(/[./]/g, '\\$&')}'`).test(code)); if (miss.length) code = `import { ${miss.join(', ')} } from '${mod}';\n` + code; };   // R062：布陣搬出 main.ts 後 main 不再 import 這些；注入的觀測程式還要用，缺的才補
      need('./sim/trenches.ts', ['applyTrench']);
      if (broken) {
        replace("const V = valves(q);", "const V = Object.defineProperty(valves(q), 'r118', { get: () => q.get('__r118mutant') === 'valve' || q.get('noR118') !== '1' });", 'valve');   // R060：閥從閥表來
        replace('for (const c of planner.plan) issue(c);', `for (const c of planner.plan) if (!(c.t === 'trench' && (${is('record')}))) issue(c);`, 'record');
        replace('while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick) issue(lg[i].cmd); i++; }', "while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick && !(q.get('__r118mutant') === 'replay' && !V.r118 && lg[i].cmd.t === 'trench')) issue(lg[i].cmd); i++; }", 'replay');
      }
      code += instrumentation; hits.add('observation');
    }
    if (broken && rel === 'src/ui/buildPlanner.ts') {   // R062：布陣計畫搬出 main.ts
      replace("if (trenchIndex >= 0) { this.plan.splice(trenchIndex, 1);", `if (trenchIndex >= 0) { if (!(${is('remove')})) this.plan.splice(trenchIndex, 1);`, 'remove');
      replace('this.trenchRot = (this.trenchRot + 1) % 4;', `this.trenchRot = (this.trenchRot + (${is('rotation')} ? 0 : 1)) % 4;`, 'rotation');
    }
    if (broken && rel === 'src/sim/trenches.ts') {
      replace('return s ? trenchKind(s.kind)!.cover : 100;', `return s && !(${is('cover')}) ? trenchKind(s.kind)!.cover : 100;`, 'cover');
    }
    if (rel === 'src/ui/minimap.ts') {
      // Request the same readback-oriented raster path from each context's FIRST creation.
      // This is measurement normalization, not a production change or a claimed game defect fix.
      // No forced redraw, pixel tolerance, extra settling or successful-path pixel tracing.
      replace("const ctx = base.getContext('2d')!;", "const ctx = base.getContext('2d', { willReadFrequently: true })!; (globalThis as any).__r118baseContextAttributes=ctx.getContextAttributes();", 'base-raster-fixture');
      replace("const ctx = cvs.getContext('2d')!;", "const ctx = cvs.getContext('2d', { willReadFrequently: true })!; (globalThis as any).__r118screenContextAttributes=ctx.getContextAttributes();", 'screen-raster-fixture');
      if (broken) replace('if (kind < 0 || w.occ[i]) continue;', `if (kind < 0 || w.occ[i] || (${is('minimap_pixels')})) continue;`, 'minimap-pixels');
      // One read-only last-painted marker; no per-draw wrappers or successful-path readback.
      replace('const poly = a.view();', "const poly = a.view(); (globalThis as any).__r118paintWorld=w; (globalThis as any).__r118paintMeta={time:t,tick:w.tick,poly:poly.map(p=>[...p]),width:cvs.width,height:cvs.height};", 'paint-observation');
    }
    return code;
  }};
}

async function main() {
  fixtures(); if (fixtureOnly) return;
  const started = Date.now(), baseline = path.join(temp,'baseline'), broken = path.join(temp,'broken');
  const goodHits=new Set(),badHits=new Set();
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false,goodHits)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true,badHits)],build:{outDir:broken}});
  const fixtureHits=['observation','paint-observation','base-raster-fixture','screen-raster-fixture'];
  assert.deepEqual([...goodHits].sort(),fixtureHits.sort(),'fixture: baseline only observes and normalizes minimap raster contexts');
  assert.deepEqual([...badHits].sort(),[...fixtureHits,'valve','remove','rotation','record','replay','cover','minimap-pixels'].sort(),'fixture: seven isolated semantic mutations and four measurement hooks compile');
  record('R118 isolated baseline/mutant builds compiled; this is not a Chrome pass'); if(buildOnly)return;
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8438,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:60},async({open,page})=>{
    const send=page.send.bind(page),evaluate=page.evaluate.bind(page);
    const bounded=async(p,label)=>{let timer;const ms=Math.min(8000,110000-(Date.now()-started));if(ms<=0)throw Error('R118 browser operational deadline');try{return await Promise.race([p,new Promise((_,r)=>{timer=setTimeout(()=>r(Error('CDP timeout: '+label)),ms)})]);}finally{clearTimeout(timer);}};
    page.send=(m,a)=>bounded(send(m,a),m);page.evaluate=e=>bounded(evaluate(e),'evaluate');
    const E=e=>page.evaluate(e), frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const settle=async()=>{await sleep(115);await frames();};
    const inspect=()=>E('__r118test.inspect()');
    const viewport=async mobile=>{await page.send('Emulation.setDeviceMetricsOverride',{width:mobile?412:1280,height:mobile?860:800,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});};
    const fresh=async(query='')=>{await open('seed=1944&noR018=1&noR016=1&'+query);await E('__rts.pause(true)');await settle();assert(await E('!!window.__r118test'),'fixture: production and isolated observation ready');assert.deepEqual(await E('[globalThis.__r118baseContextAttributes?.willReadFrequently,globalThis.__r118screenContextAttributes?.willReadFrequently]'),[true,true],'fixture: both minimap contexts retain the requested CPU-readback attributes');};
    const click=async(x,y,mobile)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
    const button=async(id,mobile)=>{const p=await E(`(()=>{const b=document.getElementById(${JSON.stringify(id)});if(!b)return null;const r=b.getBoundingClientRect(),points=[[r.x+r.width/2,r.y+r.height/2],[r.left+5,r.top+5],[r.right-5,r.top+5],[r.left+5,r.bottom-5],[r.right-5,r.bottom-5]];return[r.x+r.width/2,r.y+r.height/2,r.width,r.height,!b.hidden&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&points.every(([x,y])=>b.contains(document.elementFromPoint(x,y)))]})()`);assert(p&&p[4]&&p[2]>=44&&p[3]>=44,`layout: ${id} is a visible unobstructed 44px native target`);await click(p[0],p[1],mobile);};
    const cell=async(x,z,mobile)=>{await E(`__rts.focus(${x+.5},${z+.5},1.25)`);await settle();const p=await E(`__rts.screenOfCell(${x},${z})`);assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: native placement reaches unobstructed ground');await click(p[0],p[1],mobile);await settle();};
    const choose=async(cmd,mobile)=>{const before=(await inspect()).plan;if(cmd.t==='trench'){await button('bb-trench',mobile);await button('bb-t'+cmd.kind,mobile);for(let n=0;n<(cmd.rot??0);n++)await button('bb-rot',mobile);}else await button('bb-k'+cmd.kind,mobile);assert.deepEqual((await inspect()).plan,before,'input: construction controls do not leak map commands');};
    const place=async(cmd,mobile)=>{await choose(cmd,mobile);await cell(cmd.x,cmd.z,mobile);};
    const sample=()=>E(`(()=>{const c=document.getElementById('minimap'),copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,0,0);return{ground:__r118test.ground(),mini:Array.from(ctx.getImageData(0,0,copy.width,copy.height).data),miniWidth:c.width,miniHeight:c.height,paint:globalThis.__r118paintMeta,scene:document.querySelector('body>canvas').toDataURL(),state:__r118test.inspect(),calls:__rts.info().calls,triangles:__rts.info().triangles,cam:__rts.cam()}})()`);
    const shot=async name=>{const png=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(png.data,'base64'));};
    const equalPixels=(a,b,label)=>{
      assert(Buffer.from(a.ground).equals(Buffer.from(b.ground)),label+': exact ground pixels');
      const same=Buffer.from(a.mini).equals(Buffer.from(b.mini));let detail='';
      if(!same){
        const differences=[],diff=Buffer.alloc(a.mini.length);let count=0,max=0;
        for(let i=0;i<a.mini.length;i+=4){let delta=0;for(let k=0;k<4;k++)delta=Math.max(delta,Math.abs(a.mini[i+k]-b.mini[i+k]));diff[i]=delta?255:0;diff[i+3]=255;if(delta){count++;max=Math.max(max,delta);if(differences.length<24)differences.push({x:(i/4)%a.miniWidth,y:Math.floor(i/4/a.miniWidth),actual:a.mini.slice(i,i+4),reference:b.mini.slice(i,i+4)});}}
        const info={label,count,max,first:differences,actualPaint:a.paint,referencePaint:b.paint,actualCam:a.cam,referenceCam:b.cam,actualHash:a.state.hash,referenceHash:b.state.hash,actualShownHash:a.state.shownHash,referenceShownHash:b.state.shownHash,actualPaintWorldCurrent:a.state.paintWorldCurrent,referencePaintWorldCurrent:b.state.paintWorldCurrent};
        detail=' '+JSON.stringify(info);record('R118 minimap mismatch:'+detail);
        const name=`r118-failure-${a.miniWidth}-${label.split(':')[0]}`,dir=path.join(ROOT,'shots');fs.mkdirSync(dir,{recursive:true});
        fs.writeFileSync(path.join(dir,name+'-actual.png'),pngRGBA(a.miniWidth,a.miniHeight,a.mini));fs.writeFileSync(path.join(dir,name+'-reference.png'),pngRGBA(b.miniWidth,b.miniHeight,b.mini));fs.writeFileSync(path.join(dir,name+'-diff.png'),pngRGBA(a.miniWidth,a.miniHeight,diff));
        fs.writeFileSync(path.join(dir,name+'-state.json'),JSON.stringify({info,actualState:a.state,referenceState:b.state},null,2));
      }
      assert(same,label+': exact minimap pixels'+detail);
    };
    const budget=(s,opening,label)=>assert(s.calls<=(opening?20:22)&&s.triangles<=80000,`${label}: existing ${opening?20:22}/80000 budget (${s.calls}/${s.triangles})`);
    const focus=async(cam={x:21,z:24,zoom:1.25})=>{await E(`__rts.focus(${cam.x},${cam.z},${cam.zoom})`);await settle();};
    const pickerLayout=async()=>{const s=await E(`(()=>{const b=document.getElementById('buildbar').getBoundingClientRect(),h=document.getElementById('hint').getBoundingClientRect(),m=document.getElementById('minimap').getBoundingClientRect();return{b:b.toJSON(),h:h.toJSON(),m:m.toJSON(),width:innerWidth,height:innerHeight}})()`);assert(s.b.left>=0&&s.b.right<=s.width&&s.b.top>=s.m.bottom&&s.b.bottom<=s.h.top-6&&s.h.bottom<=s.height,'layout: construction row clears minimap, hint and viewport');};
    const planCheck=async expected=>assert.deepEqual(canonical((await inspect()).plan),canonical(expected),'placement: native plan preserves template, anchor and rotation');
    const removeCheck=async expected=>assert.deepEqual(canonical((await inspect()).plan),canonical(expected),'remove: any trench cell removes the whole planned segment');
    const coverCheck=async()=>{await E("__r118test.fixture('cover')");const before=await inspect();await E('__rts.stepN(1)');const after=await inspect();assert.equal(before.units[1].hp-after.units[1].hp,expectedDamage,'cover: actual Chrome projectile uses independent reinforced damage');assert.equal(after.hash,hashWorld(hit),'cover: full Node/Chrome state agrees after impact');};
    const startedCheck=async expected=>{const s=await inspect();assert.deepEqual(s.log.filter(e=>e.cmd.t==='trench').map(e=>e.cmd),expected.filter(c=>c.t==='trench'),'record: native start records every trench in exact original order');return s;};

    let recorded,nativeReference;
    for(const mobile of [true,false]){
      const label=mobile?'mobile':'desktop',errors=page.errors.length;await viewport(mobile);await fresh();await focus();const pristine=await sample();
      assert.equal(pristine.state.hash,hashWorld(opening),'fixture: ordinary opening matches Node');
      await button('bb-trench',mobile);await pickerLayout();
      for(let i=0;i<4;i++){await button('bb-t'+i,mobile);assert.equal((await inspect()).plan.length,0,'input: shape selection alone does not place terrain');}
      await place(network[2],mobile);await planCheck([network[2]]);
      const [rx,rz]=trenchCells(network[2])[0];await cell(rx,rz,mobile);await removeCheck([]);await focus();equalPixels(await sample(),pristine,'remove: full refund restores original terrain');
      await place(network[0],mobile);await button('bb-undo',mobile);await planCheck([]);await focus();equalPixels(await sample(),pristine,'undo: exact preview cancellation');
      for(const cmd of network)await place(cmd,mobile);
      await planCheck(network);const built=await inspect();assert.equal(built.left,0,'budget: native mixed plan spends exactly eight');assert.equal(built.hash,hashWorld(opening),'preview: complete actual world and RNG remain unchanged');assert.deepEqual(built.shown,preview.trenches,'preview: displayed segments match Node application');
      await place({t:'trench',side:0,kind:0,x:22,z:24,rot:0},mobile);await planCheck(network);assert((await E("document.getElementById('hint').textContent")).includes('建材不夠'),'budget: native ninth point is refused with an explanation');
      await pickerLayout();await focus();const mixed=await sample();budget(mixed,true,label+' mixed network');await shot(`r118-${label}-network.png`);
      await button('bb-undo',mobile);assert.equal((await inspect()).left,1,'undo: mixed last building refunds one point');await place(network[5],mobile);await planCheck(network);
      await button('bb-start',mobile);await E('__rts.pause(true)');await focus();const started=await startedCheck(network),native=await sample();budget(native,false,label+' battle');
      recorded=started;nativeReference=native;
      assert.equal(started.hash,hashWorld(runLog(createWorld(1944),started.log,started.tick)),'replay: native plan and battle match Node log');
      await E(`__rts.playLog(1944,${JSON.stringify(started.log)},${started.tick});__rts.pause(true)`);await focus(native.cam);const replay=await sample();assert.equal(replay.state.hash,started.hash,'replay: same log gives exact Chrome hash');equalPixels(replay,native,'replay: native start and replay');await shot(`r118-${label}-battle.png`);
      await button('b-restart',mobile);await focus();const reset=await sample();assert.equal(reset.state.hash,pristine.state.hash,'reset: new world excludes previous trenches');equalPixels(reset,pristine,'reset: no stale network');
      await E('__r118test.maximumPreview()');await settle();const max=await sample();assert.deepEqual(max.state.shown,maximumPreview.trenches,'budget: Chrome displays all 32 cells in maximum affordable opening');assert.equal(max.state.left,0,'budget: maximum-footprint preview spends eight points');budget(max,true,label+' maximum 32-cell opening');
      await E(`__rts.playLog(1944,${JSON.stringify(maximumLog)},1);__rts.pause(true)`);await settle();const maxBattle=await sample();assert.equal(maxBattle.state.hash,hashWorld(maximumBattle),'budget: Chrome maximum 64-cell world matches Node');budget(maxBattle,false,label+' maximum 64-cell battle');
      await coverCheck();await focus({x:22,z:20,zoom:1.25});const on=await sample();budget(on,false,label+' impact');await shot(`r118-${label}-cover-on.png`);
      for(const [kind,expected]of movement){await E(`__r118test.fixture('move',${kind});__r118test.command(${JSON.stringify(expected.cmd)});__rts.stepN(${expected.ticks})`);const s=await inspect();assert.deepEqual([s.units[0].x,s.units[0].z],expected.position,'movement: tank/artillery crosses continuous trench terrain');assert.equal(s.hash,expected.hash,'movement: exact Node/Chrome traversal state');}
      await fresh('noR118=1');assert(await E("!document.getElementById('bb-trench')&&!document.getElementById('bb-t0')"),'valve: noR118 removes all new construction choices');
      assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(started.log)},${started.tick})`),started.hash,'valve: actual native mixed recorded log retains its complete hash under noR118');await E('__rts.pause(true)');assert.deepEqual((await inspect()).trenches,started.trenches,'valve: recorded trench fields survive display-off replay');
      await coverCheck();await focus({x:22,z:20,zoom:1.25});const off=await sample();assert.equal(off.state.hash,on.state.hash,'valve: same impact fixture retains complete simulation hash');assert(!Buffer.from(off.ground).equals(Buffer.from(on.ground)),'display: enabled trenches alter actual ground pixels');assert(!Buffer.from(off.mini).equals(Buffer.from(on.mini)),'display: enabled trenches alter actual minimap pixels');assert.notEqual(digest(off.scene),digest(on.scene),'display: enabled trenches are visible in rendered canvas');assert.equal(off.calls,on.calls,'budget: trench texture adds no draw calls');await shot(`r118-${label}-cover-off.png`);
      assert.equal(page.errors.length,errors,label+': no unrelated runtime errors');record(`R118 ${label}: native four-shape plan/removal/undo/start/replay/reset, cover/traversal/valve; maximum32 opening ${max.calls}/${max.triangles}, maximum64 battle ${maxBattle.calls}/${maxBattle.triangles}, native battle ${native.calls}/${native.triangles}`);
    }

    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));await viewport(true);await fresh();
    const mutation=name=>E(`__r118test.mutation(${JSON.stringify(name)})`);
    const negatives=[
      ['rotation',async()=>{await place(network[2],true);await planCheck([network[2]]);},'placement: native plan preserves template, anchor and rotation'],
      ['remove',async()=>{await button('b-restart',true);await place(network[0],true);await cell(network[0].x+1,network[0].z,true);await removeCheck([]);},'remove: any trench cell removes the whole planned segment'],
      ['record',async()=>{await button('b-restart',true);await place(network[0],true);await button('bb-start',true);await E('__rts.pause(true)');await startedCheck([network[0]]);},'record: native start records every trench in exact original order'],
      ['cover',coverCheck,'cover: actual Chrome projectile uses independent reinforced damage'],
    ];
    for(const[name,run,expected]of negatives){const errors=page.errors.length;await mutation(name);let failure;try{await run();}catch(e){failure=e;}assert(failure instanceof assert.AssertionError&&failure.message.startsWith(expected),`negative ${name}: expected semantic first red, got ${failure?.stack??'no failure'}`);assert.equal(page.errors.length,errors,`negative ${name}: no runtime failure`);record('RED real Chrome '+name+': '+expected);await mutation('');}
    const valveErrors=page.errors.length;
    await fresh('noR118=1&__r118mutant=valve');let failure;try{assert(await E("!document.getElementById('bb-trench')&&!document.getElementById('bb-t0')"),'valve: noR118 removes all new construction choices');}catch(e){failure=e;}assert(failure instanceof assert.AssertionError&&failure.message.startsWith('valve: noR118 removes all new construction choices'),'negative valve: named first semantic red');assert.equal(page.errors.length,valveErrors,'negative valve: no unrelated runtime error');record('RED real Chrome valve: construction presentation disabled');
    const replayErrors=page.errors.length;
    await fresh('noR118=1&__r118mutant=replay');failure=undefined;try{assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(recorded.log)},${recorded.tick})`),recorded.hash,'valve: actual native mixed recorded log retains its complete hash under noR118');}catch(e){failure=e;}assert(failure instanceof assert.AssertionError&&failure.message.startsWith('valve: actual native mixed recorded log retains its complete hash under noR118'),'negative replay: named first semantic red');assert.equal(page.errors.length,replayErrors,'negative replay: no unrelated runtime error');record('RED real Chrome replay: display-off recorded trench commands remain active');
    // The original native desktop sample is the oracle. Only replay minimap marks disappear;
    // world, camera, ground and the exact-byte comparison itself remain unchanged.
    const pixelErrors=page.errors.length;
    await viewport(false);await fresh();await mutation('minimap_pixels');
    await E(`__rts.playLog(1944,${JSON.stringify(recorded.log)},${recorded.tick});__rts.pause(true)`);await focus(nativeReference.cam);
    const missingPixels=await sample();
    assert.equal(missingPixels.state.hash,nativeReference.state.hash,'negative minimap_pixels: omitted presentation preserves the complete simulation hash');
    assert.deepEqual(missingPixels.cam,nativeReference.cam,'negative minimap_pixels: original native camera is preserved');
    assert(missingPixels.state.paintWorldCurrent,'negative minimap_pixels: replay world has actually painted');
    const pixelLabel='negative-minimap-pixels: native start and replay',pixelExpected=pixelLabel+': exact minimap pixels';
    failure=undefined;try{equalPixels(missingPixels,nativeReference,pixelLabel);}catch(e){failure=e;}
    assert(failure instanceof assert.AssertionError&&failure.message.startsWith(pixelExpected),`negative minimap_pixels: expected exact-pixel first red, got ${failure?.stack??'no failure'}`);
    assert.equal(page.errors.length,pixelErrors,'negative minimap_pixels: no unrelated runtime error');
    record('RED real Chrome minimap_pixels: '+pixelExpected);await mutation('');
    assert(page.requests.every(r=>r.startsWith('http://127.0.0.1:8438/')||r.startsWith('data:')||r==='about:blank'),'resources: no external images, models or fonts');
  });
  record(`R118 real Chrome complete in ${Date.now()-started}ms (120s child limit unchanged)`);
}

try{await main();fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r118-browser.txt'),summary.join('\n')+'\n');if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### R118 trench browser guards\n'+summary.map(s=>'- '+s).join('\n')+'\n');}
catch(error){const message=String(error?.stack??error);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message)&&!strictCI){console.error('NOT RUN R118 real Chrome guards: local socket restriction; CI must execute them.');console.error(error.message);process.exitCode=77;}else{console.error(error);console.error('R118 browser FAIL: '+String(error.message).split('\n')[0]);process.exitCode=1;}}
finally{fs.rmSync(temp,{recursive:true,force:true});}
