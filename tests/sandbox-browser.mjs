// 真實 Chrome／滑鼠／觸控，沿用 repo CDP；不加瀏覽器依賴。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, shot, sleep } from '../tools/cdp.mjs';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
process.env.R128_IMPORT_ONLY='1';
const {sandboxLog}=await import('./sandbox.mjs');
delete process.env.R128_IMPORT_ONLY;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'r128-browser-'));
const strictCI=process.env.GITHUB_ACTIONS==='true'||!!process.env.GITHUB_RUN_ID||!!process.env.CI;
const summary=[],record=s=>{summary.push(s);console.log(s);};
const M=name=>`new URLSearchParams(location.search).get('__r128mutant') === '${name}'`;
const plugin={name:'r128-probe-and-semantic-mutants',enforce:'pre',transform(code,id){
 const rel=path.relative(ROOT,id).replaceAll('\\','/');
 const replace=(from,to)=>{assert.equal(code.split(from).length-1,1,'unique browser test anchor: '+from);code=code.replace(from,to);};
 if(rel==='src/main.ts'){
  replace('(window as unknown as { __rts: typeof rts }).__rts = rts;',`(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r128={world:()=>JSON.stringify(w), pending:()=>JSON.stringify(pending), cloneContinue:(lg:any,n:number)=>hashWorld(runLog(structuredClone(w),lg,n))};`);
  replace('if (r128) sandboxBar = initSandbox({',`if (r128 || ${M('valve')}) sandboxBar = initSandbox({`);
  replace('w = sandbox ? createSandboxWorld(s) : createWorld(s);',`w = sandbox && !(${M('entry')}) ? createSandboxWorld(s) : createWorld(s);`);
  replace('issue(cmd);\n  // 運行中放兵',`if (!(${M('dispatch')}) || cmd.t !== 'sandboxPlace') issue(cmd);
  // 運行中放兵`);
  replace('paused = false; reset(); },',`paused = false; if (!(${M('exit')})) reset(); },`);
  replace("if (!paused && phase === 'battle') acc",`if ((!paused || ${M('frozen')}) && phase === 'battle') acc`);
  replace("sandboxHint = err ? why[err] : '已下放置指令。';",`sandboxHint = err ? (${M('capacity')} && err === 'capacity' ? '' : why[err]) : '已下放置指令。';`);
  replace("if (now.some(c => c.t === 'sandboxReset'))",`if (!(${M('fxreset')}) && now.some(c => c.t === 'sandboxReset'))`);
 }
 if(rel==='src/ui/sandbox.ts')replace('entry.hidden = s.active; panel.hidden = !s.active;',`entry.hidden = s.active; panel.hidden = !s.active; if (${M('layout')}) panel.style.width='2000px'; if (${M('entryLayout')}) entry.style.top='116px';`);
 return code;
}};

async function main(){
 const out=path.join(temp,'dist');
 await build({root:ROOT,logLevel:'silent',plugins:[plugin],build:{outDir:out,emptyOutDir:true}});
 await withBrowser({root:out,width:412,height:860,mobile:true,port:33401,settle:100},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  let mobile=true;
  const viewport=async(w=412,h=860,touch=true)=>{mobile=touch;await page.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:touch});await page.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});};
  const click=async id=>{
   const b=await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e};})()`);
   assert(b.w>=44&&b.h>=44&&b.hit,'ui: native target is reachable and 44px '+id);
   if(mobile)await touchTap(page,b.x,b.y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:b.x,y:b.y});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:b.x,y:b.y});}
   await frames();
  };
  const image=name=>shot(page,path.join(ROOT,'shots',`r128-${name}.png`));
  const world=async()=>JSON.parse(await E('__r128.world()'));
  const fresh=async(mutant='',query='')=>{await open(query+(mutant?'&__r128mutant='+mutant:''));await frames();};
  const enter=async(mutant='')=>{await fresh(mutant);await click('sb-enter');assert.equal(await E('!!__rts.sandbox()'),true,'ui: entry creates explicit sandbox');const w=await world();assert.equal(w.units.length,0,'ui: entry army empty');assert.equal(w.tick,0,'ui: entry battle time zero');assert.equal(w.ai,undefined,'ui: no AI');assert.equal(w.eco,undefined,'ui: no economy');assert.equal(w.sandbox.running,false,'ui: entry paused');};
  const at=async(x,z)=>{await E(`__rts.focus(${x+.5},${z+.5},1.5)`);await frames();const p=await E(`__rts.screenOfCell(${x},${z})`);assert.equal(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName`),'CANVAS','ui: cell is on canvas');if(mobile)await touchTap(page,...p);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:p[0],y:p[1]});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p[0],y:p[1]});}await frames();};
  const layout=async()=>{
   const bad=await E(`(()=>{const els=[...document.querySelectorAll('#sandbox-panel button,#sandbox-panel,#sb-hint')];return els.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {id:e.id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:r.width,h:r.height,scroll:e.scrollWidth,client:e.clientWidth};}).filter(r=>r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight||r.scroll>r.client+1);})()`);
   assert.deepEqual(bad,[],'ui: controls fit viewport');
   for(const id of ['sb-run','sb-reset','sb-exit','sb-player','sb-enemy','sb-tank','sb-howitzer','sb-command']){const b=await E(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return [r.width,r.height];})()`);assert(b[0]>=44&&b[1]>=44,'ui: 44px control '+id);}
  };
  const placement=async(mutant='')=>{
   await enter(mutant);await at(24,26);assert.equal((await world()).units.length,1,'ui: placement dispatches through step');
   await click('sb-enemy');await at(26,26);await click('sb-howitzer');await at(22,24);await click('sb-player');await at(29,29);
   assert.deepEqual((await world()).units.map(u=>[u.side,u.kind]),[[0,0],[1,0],[1,1],[0,1]],'ui: both sides and kinds');
   assert.equal(await E('__rts.tick()'),0,'ui: placement never runs battle');
   await at(29,29);assert.match(await E('document.getElementById("sb-hint").textContent'),/已有單位/,'ui: occupied cell feedback');
   const lg=await E('__rts.log()'),s=await E('__rts.sandbox()');
   assert.equal(await E('__rts.hash()'),hashWorld(runLog(createSandboxWorld(1944),lg,s.frame)),'ui: native placement Node replay');
   return {lg,s};
  };
  const frozen=async(mutant='')=>{await enter(mutant);const before=await E('__r128.world()');await sleep(250);await frames();assert.equal(await E('__r128.world()'),before,'ui: paused wall time freezes world');};
  const entryLayout=async(mutant='')=>{
   await viewport(360,780,true);await fresh(mutant,'noR006=1');await E('__rts.pause(true)');await frames();
   assert.equal(await E(`(()=>{const a=document.getElementById('sb-enter').getBoundingClientRect(),b=document.querySelector('#hud .top').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;})()`),false,'ui: narrow entry clears status bar');
  };
  const capacity=async(mutant='')=>{
   await enter(mutant);
   const w=createSandboxWorld(1944),cmds=[];
   for(let z=0;z<32&&cmds.length<32;z++)for(let x=0;x<32&&cmds.length<32;x++)if(!w.occ[z*32+x])cmds.push({t:'sandboxPlace',side:cmds.length%2,kind:cmds.length%2,x,z});
   await E(`for(const c of ${JSON.stringify(cmds)})__rts.issue(c);__rts.stepN(1);__rts.pause(true)`);await frames();
   assert.equal((await world()).units.length,32,'ui: capacity fixture accepted by commands');await at(24,26);
   assert.match(await E('document.getElementById("sb-hint").textContent'),/32 輛上限.*重置/,'ui: capacity feedback');
   assert.equal((await world()).units.length,32,'ui: capacity no extra unit');
   await layout();const info=await E('__rts.info()');assert(info.calls<=20&&info.triangles<=80000,'ui: capacity mobile budget');record('MEASURE sandbox 32 units '+JSON.stringify(info));
   await image('mobile-capacity');
   await click('sb-run');await E('__rts.stepN(5)');await frames();const hot=await E('__rts.info()');assert(hot.calls<=22&&hot.triangles<=80000,'ui: capacity combat budget');record('MEASURE sandbox 32 combat '+JSON.stringify(hot));await image('mobile-capacity-running');await click('sb-run');
  };
  const exit=async(mutant='',shots=false)=>{
   await fresh(mutant);const baseline=await E('__rts.hash()');await click('sb-enter');await at(24,26);await click('sb-exit');
   assert.equal(await E('__rts.sandbox()'),null,'ui: exit restores ordinary mode');assert.equal(await E('__rts.phase()'),'build','ui: exit restores build phase');assert.equal(await E('__rts.hash()'),baseline,'ui: ordinary initial state restored');
   assert.deepEqual(await E('__rts.selected()'),[],'ui: exit clears selection');assert.equal(await E('document.getElementById("sandbox-panel").hidden'),true,'ui: exit hides tool panel');
   if(shots)await image('mobile-return-build');await click('bb-start');await E('__rts.pause(true)');await frames();
   assert.equal((await world()).sandbox,undefined,'ui: ordinary battle has no sandbox');assert.equal(await E('__rts.phase()'),'battle','ui: ordinary start still works');
   assert((await E('__rts.log()')).every(c=>!c.cmd.t.startsWith('sandbox')),'ui: no sandbox commands leak');if(shots)await image('mobile-return-battle');
  };
  const reset=async(mutant='',shots=false)=>{
   await enter(mutant);const zeroFx=await E('__rts.fxDigest()');
   await E(`__rts.playLog(1944,${JSON.stringify(sandboxLog)},3,true);__rts.pause(true)`);await frames();
   const before=await E('__rts.sandbox()');assert.notEqual(await E('__rts.fxDigest()'),zeroFx,'ui: combat effect fixture active');
   await click('sb-reset');const w=await world(),expected=createSandboxWorld(1944);expected.sandbox.frame=before.frame+1;
   assert.equal(await E('__rts.hash()'),hashWorld(expected),'ui: reset world fully cleared');assert.equal(await E('__rts.paused()'),true,'ui: reset stays paused');
   assert.equal(await E('__r128.pending()'),'[]','ui: reset clears pending commands');assert.equal(await E('__rts.fxDigest()'),zeroFx,'ui: reset clears rendered effects');
   // 時間回到 0 會暫藏未來的舊粒子；空局重開後也不能復現它們。
   await click('sb-run');await click('sb-run');await frames();assert.equal(await E('__rts.fxDigest()'),zeroFx,'ui: reset clears rendered effects');
   await click('sb-reset');
   assert.equal(w.units.length,0,'ui: reset empty army');if(shots)await image('mobile-reset');
  };
  await viewport();await fresh();assert.match(await E('location.href'),/^http:\/\/127\.0\.0\.1:33401\//,'page: identity URL');assert.match(await E('document.title'),/二戰 RTS/,'page: identity title');assert.match(await E('document.body.textContent'),/微光小鎮/,'page: meaningful content');assert.equal(await E('!!document.querySelector("vite-error-overlay")'),false,'page: no framework overlay');
  await enter();await layout();const initialInfo=await E('__rts.info()');assert(initialInfo.calls<=20&&initialInfo.triangles<=80000,'ui: empty mobile budget');record('MEASURE empty sandbox '+JSON.stringify(initialInfo));await image('mobile-empty');
  await placement();await E('__rts.focus(25,26,1.3)');await frames();await image('mobile-placed');
  // 真實選取／移動仍走舊指令；暫停下令後沒有位置變動，開始後才動。
  await click('sb-command');await E('__rts.focus(24.5,26.5,1.5)');await frames();
  const pos=await E('__rts.screenOf(1)');await touchTap(page,...pos);await frames();assert.deepEqual(await E('__rts.selected()'),[1],'ui: original unit selection');
  await at(23,26);const command=(await E('__rts.log()')).at(-1);assert.equal(command.cmd.t,'move','ui: original move command');
  const beforeRun=(await world()).units[0];await click('sb-run');await sleep(200);await click('sb-run');await frames();
  assert(await E('__rts.tick()')>0,'ui: native start advances combat');assert.equal(await E('__rts.paused()'),true,'ui: native pause');assert.notEqual((await world()).units[0].x,beforeRun.x,'ui: started movement occurs');await image('mobile-paused');
  const frozenState=await E('__r128.world()');await sleep(250);await frames();assert.equal(await E('__r128.world()'),frozenState,'ui: paused battle state freezes');
  // Node、Chrome、JSON 與瀏覽器深拷貝接續；重置後步序仍可繼續。
  const json=JSON.parse(JSON.stringify(sandboxLog)),expected=hashWorld(runLog(createSandboxWorld(1944),json,200));
  assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(json)},200,true)`),expected,'replay: Node equals Chrome JSON');
  const prefix=hashWorld(runLog(createSandboxWorld(1944),json,90));
  assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(json)},90,true)`),prefix,'replay: Node equals Chrome before reset');
  const clones=await E(`(()=>{__rts.playLog(1944,${JSON.stringify(json)},62,true);return [__r128.cloneContinue(${JSON.stringify(json)},90),__r128.cloneContinue(${JSON.stringify(json)},200)];})()`);
  assert.deepEqual(clones,[prefix,expected],'replay: Chrome deep clone continuation');record('PASS Node/Chrome/JSON/clone sandbox hashes before reset '+prefix+' final '+expected);
  await E(`__rts.playLog(1944,${JSON.stringify(json)},44,true)`);await frames();await image('mobile-running');await E('__rts.pause(true)');
  await capacity();await reset('',true);await exit('',true);
  for(let i=0;i<3;i++){await enter();await at(24,26);await click('sb-reset');assert.equal((await world()).units.length,0,'ui: repeated mobile reset');await click('sb-exit');assert.equal(await E('__rts.phase()'),'build','ui: repeated mobile return');}record('PASS mobile native placement/start/pause/reset/return x3');
  for(const[w,h]of [[860,412],[360,780],[1280,800]]){await viewport(w,h,w!==1280);await enter();await layout();await image(`${w}x${h}-controls`);}
  await entryLayout();await image('360x780-ordinary-entry');
  await viewport(1280,800,false);await placement();await E('__rts.focus(25.5,26.5,1.2)');await frames();await image('desktop-placed');
  await viewport();await fresh('', 'noR128=1');assert.equal(await E('document.getElementById("sb-enter")'),null,'valve: no entry DOM');const off=await E('__rts.runScript()');await fresh();assert.equal(await E('__rts.runScript()'),off,'valve: legacy hash unchanged');assert.equal(off,'eea1d59b','valve: golden hash');
  assert.equal(page.errors.length,0,'page: no runtime or console errors');record('PASS Chrome positive flows, layout, budgets, valve and ordinary return');
  const cases={
   entry:()=>enter('entry'), dispatch:()=>placement('dispatch'), frozen:()=>frozen('frozen'), capacity:()=>capacity('capacity'), exit:()=>exit('exit'), fxreset:()=>reset('fxreset'),
   layout:async()=>{await enter('layout');await layout();}, entryLayout:()=>entryLayout('entryLayout'),
   valve:async()=>{await fresh('valve','noR128=1');assert.equal(await E('document.getElementById("sb-enter")'),null,'valve: no entry DOM');},
  };
  const targets={entry:'ui: entry creates explicit sandbox',dispatch:'ui: placement dispatches through step',frozen:'ui: paused wall time freezes world',capacity:'ui: capacity feedback',exit:'ui: exit restores ordinary mode',fxreset:'ui: reset clears rendered effects',layout:'ui: controls fit viewport',entryLayout:'ui: narrow entry clears status bar',valve:'valve: no entry DOM'};
  for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;let fail;try{await run();}catch(e){fail=e;}assert(fail instanceof assert.AssertionError&&fail.message.startsWith(targets[name]),'negative '+name+': target must be first red, got '+(fail?.stack??'no failure'));assert.equal(page.errors.length,errors,'negative '+name+': no runtime error');record('RED Chrome '+name+': '+targets[name]);}
 });
}
try{await main();}catch(error){const msg=String(error?.stack??error);record('FAIL '+msg);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg)&&!strictCI){console.error('NOT RUN R128 Chrome: local browser/socket unavailable; CI required.');process.exitCode=77;}else{console.error(error);process.exitCode=1;}}
finally{fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r128-browser.txt'),summary.join('\n')+'\n');assert.equal(path.resolve(temp,'..'),path.resolve(os.tmpdir()),'cleanup: temporary directory stays inside OS temp');fs.rmSync(temp,{recursive:true,force:true});}
