// R121 real production UI/controller + Node/Chrome replay, fixed geometry budget and valve.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {withBrowser,touchTap,sleep} from '../tools/cdp.mjs';
import {createWorld,hashWorld,BK_WIRE} from '../src/sim/world.ts';
import {runLog} from '../src/sim/step.ts';
import {applyBuild} from '../src/sim/build.ts';
import {applyMap} from '../src/sim/maps.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'r121-browser-'));
const strict=process.env.GITHUB_ACTIONS==='true'||!!process.env.CI;
const plan=[{t:'build',side:0,kind:BK_WIRE,x:18,z:26},{t:'build',side:0,kind:BK_WIRE,x:20,z:26,rot:1}];
const log=[{tick:0,cmd:{t:'map',id:1,vegetation:1}},...plan.map(cmd=>({tick:0,cmd}))];
const expected=runLog(createWorld(1944),log,1);
assert.equal(expected.wires.segments.length,2,'fixture: both fixed native positions legal');
const max=createWorld(1944);applyMap(max,1,1);
for(const [side,coords]of [[0,[[18,26],[20,26],[22,26],[18,27],[20,27],[22,27],[18,28],[20,28]]],[1,[[4,0],[6,0],[8,0],[4,1],[6,1],[8,1],[4,2],[6,2]]]])for(const[x,z]of coords)assert.equal(applyBuild(max,{t:'build',side,kind:BK_WIRE,x,z}),null,'fixture: sixteen maximum-cost wires legal');
// Transport fixture data explicitly; JSON alone destroys typed array iteration/length.
const pack=s=>JSON.stringify(s,(_k,v)=>ArrayBuffer.isView(v)?Array.from(v):v);
function hydrate(s){s.ter=Uint8Array.from(s.ter);s.occ=Int32Array.from(s.occ);s.crater=Uint8Array.from(s.crater);if(s.vegetation)s.vegetation.cells=Uint8Array.from(s.vegetation.cells);return s;}
for(const fixture of [expected,max])assert.deepEqual(hydrate(JSON.parse(pack(fixture))),fixture,'fixture: faithful world transport including typed arrays');
const summary=[];const record=s=>{summary.push(s);console.log(s)};
const instrumentation=`
const hydrateWireFixture = ${hydrate.toString()};
(window as any).__wiretest={
 inspect:()=>({hash:hashWorld(w),tick:w.tick,plan:structuredClone(planner.plan),log:structuredClone(log),shownHash:hashWorld(view.world),wires:structuredClone(view.world.wires??null),left:planner.pointsLeft(),pickKind:planner.pickKind,pickRot:planner.pickRot,vertices:(view as any).town.geometry.attributes.position.count}),
 load:(s:any)=>{reset(1944,false,false,false,false,false);w=hydrateWireFixture(s);phase='battle';pending=[];log=[];planner.plan=[];acc=0;paused=true;view.setWorld(w,-1);view.snapshot();stats=newStats(w);ui();},
 damage:(hp:number)=>{for(const b of w.wires?.segments??[])b.hp=hp;w.events=[{e:'wire'}];view.onEvents(w.events,simT());},
};`;
async function main(){
 const out=path.join(temp,'site');let hits=0;
 await build({root:ROOT,logLevel:'error',plugins:[{name:'r121-test-observation',enforce:'pre',transform(code,id){if(id.split('?')[0]===path.join(ROOT,'src/main.ts')){hits++;return code+instrumentation;}}}],build:{outDir:out}});
 assert.equal(hits,1);record('R121 isolated production fixture built; not browser pass');if(process.argv.includes('--build-only'))return;
 await withBrowser({root:out,port:8441,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:50},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const inspect=()=>E('__wiretest.inspect()');const fresh=async(q='')=>{await open('seed=1944&noR018=1&noR016=1&'+q);await E('__rts.pause(true)');await frames()};
  const button=async id=>{const p=await E(`(()=>{const b=document.getElementById('${id}');if(!b)return null;const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,r.width,r.height,r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&[[r.x+r.width/2,r.y+r.height/2],[r.left+5,r.top+5],[r.right-5,r.bottom-5]].every(([x,y])=>b.contains(document.elementFromPoint(x,y)))]})()`);assert(p&&p[4]&&p[2]>=44&&p[3]>=44,'layout: native wire control is visible and hittable');await touchTap(page,p[0],p[1]);await frames()};
  const cell=async(x,z)=>{await E(`__rts.focus(${x+.5},${z+.5},1.2)`);await sleep(100);await frames();const p=await E(`__rts.screenOfCell(${x},${z})`);assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: map touch unobstructed');await touchTap(page,p[0],p[1]);await frames()};
  const shot=async name=>{const p=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(p.data,'base64'))};
  const budget=async label=>{await frames();const i=await E('__rts.info()');assert(i.calls<=20&&i.triangles<=80000,'budget: maximum wire world within unchanged mobile opening limits');record(`${label}: ${i.calls} calls / ${i.triangles} triangles`)};
  await fresh();await button('bb-k10');assert.equal((await inspect()).plan.length,0,'input: choosing wire does not place');assert.equal((await inspect()).pickKind,BK_WIRE,'input: real wire button selects wire');
  assert((await E("document.getElementById('bb-detail').textContent")).includes('榴彈砲可清除'),'detail: destruction limitation explicit');
  await cell(18,26);assert.equal((await inspect()).plan.length,1,'placement: actual native touch places wire');await cell(19,26);assert.equal((await inspect()).plan.length,0,'removal: either footprint cell removes wire');
  await cell(18,26);await button('bb-rot');await cell(20,26);let s=await inspect();assert.equal(s.wires.segments.length,2,'preview: real world shows both wires');assert.deepEqual(s.wires.segments.map(b=>[b.w,b.d]),[[2,1],[1,2]],'rotation: actual native rotated footprint');assert.equal(s.left,6,'budget: native shared cost');await shot('r121-mobile-native-preview.png');
  await button('bb-start');await E('__rts.pause(true)');s=await inspect();assert.equal(s.hash,hashWorld(runLog(createWorld(1944),s.log,s.tick)),'replay: actual native recording equals Node');const original=s;
  await fresh('noR121=1');assert.equal(await E("document.getElementById('bb-k10')"),null,'valve: noR121 removes new selection');assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(original.log)},${original.tick})`),original.hash,'valve: untouched native log same hash');
  await E(`__wiretest.load(${pack({...expected,wires:undefined})})`);await frames();const bare=await inspect();await E(`__wiretest.load(${pack(expected)})`);await E('__rts.focus(20,26,1.3)');await frames();const fallback=await inspect();assert(fallback.vertices>bare.vertices,'fallback: wire adds visible geometry beyond ordinary town');await shot('r121-mobile-fallback.png');
  await fresh();await E(`__wiretest.load(${pack(expected)})`);await E('__rts.focus(20,26,1.3)');await frames();const intact=await inspect();assert.equal(intact.hash,fallback.hash,'valve: display only');assert(intact.vertices>fallback.vertices,'valve: details actually disabled');await shot('r121-mobile-intact.png');
  await E('__wiretest.damage(30)');await frames();const damaged=await inspect();assert.notEqual(damaged.vertices,intact.vertices,'render: damaged wire geometry changes');await shot('r121-mobile-damaged.png');
  await E('__wiretest.damage(0)');await frames();await shot('r121-mobile-destroyed.png');
  await E(`__wiretest.load(${pack(max)})`);await E('__rts.focus(20,26,1)');await budget('mobile sixteen wire segments');await shot('r121-mobile-maximum.png');
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await frames();await shot('r121-desktop-maximum.png');
  // Real layout negative: a 30px control must fail this suite's hit-target assertion.
  await page.send('Emulation.setDeviceMetricsOverride',{width:412,height:860,deviceScaleFactor:1,mobile:true});await fresh();await E("document.getElementById('bb-k10').style.cssText='min-width:30px;max-width:30px;width:30px;min-height:30px;max-height:30px;height:30px;padding:0'");let failure;try{await button('bb-k10')}catch(e){failure=e}assert(failure instanceof assert.AssertionError&&failure.message.startsWith('layout: native wire'),'negative: layout guard fails semantically');record('RED real Chrome layout: native wire control is visible and hittable');
  assert.equal(page.errors.length,0,'runtime: no browser exceptions');record('R121 native selection/rotation/placement/removal/shared budget/replay/noR121/geometry/budget passed');
 });
}
try{await main();fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r121-browser.txt'),summary.join('\n')+'\n');}
catch(e){const text=String(e?.stack??e);console.error(text);if(!strict&&/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(text)){console.error('NOT RUN R121 Chrome: socket restriction; CI required');process.exitCode=77;}else process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});}
