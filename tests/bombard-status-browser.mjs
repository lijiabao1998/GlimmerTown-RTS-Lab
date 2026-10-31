// R145: native selection -> longpress HE -> held four rounds -> resume -> completion.
// Only camera/seed setup uses existing harness APIs. Orders, selection, hold/release,
// speed and pause use real CDP input; real RAF-driven simulation completes the task.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { ROOT, withBrowser, sleep, touchTap, shot } from '../tools/cdp.mjs';
import { createWorld, hashWorld, ORD_FIRE_AT } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r145-native-'));
const plain=x=>JSON.parse(JSON.stringify(x));
const receipts=[];
try {
 assert.equal(hashWorld(runScript(1200)),JSON.parse(fs.readFileSync(path.join(ROOT,'tools/golden.json'),'utf8')).hash,'original golden unchanged');
 await build({root:ROOT,logLevel:'error',build:{outDir:temp},plugins:[{
  name:'r145-readonly-world',enforce:'pre',transform(code,id){
   if(path.relative(ROOT,id.split('?')[0]).replaceAll('\\','/')!=='src/main.ts')return;
   const anchor='(window as unknown as { __rts: typeof rts }).__rts = rts;';
   assert.equal(code.split(anchor).length,2,'single read-only inspection anchor');
   return code.replace(anchor,anchor+'\n(window as any).__r145world=()=>JSON.stringify(w);');
  }
 }]});
 if(process.argv.includes('--prepare-only'))console.log('PREPARED R145 native browser test; Chromium NOT RUN');
 else await withBrowser({root:temp,width:412,height:860,mobile:true,port:18931,settle:80},async({open,page})=>{
  const E=x=>page.evaluate(x);
  const until=async(expr,label,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await E(expr))return;await sleep(60);}assert.fail(label);};
  const frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const snapshot=()=>E('({world:JSON.parse(__r145world()),hash:__rts.hash(),log:__rts.log(),selected:__rts.selected(),hint:document.querySelector("#hint").textContent,paused:__rts.paused()})');
  const replay=s=>{const w=runLog(createWorld(1944),s.log,s.world.tick);assert.equal(s.hash,hashWorld(w),'Node/Chrome full hash');assert.deepEqual(s.world,plain(w),'complete Node/Chrome world');};
  for(const [name,width,height,mobile] of [['narrow',360,860,true],['mobile',412,860,true],['landscape',860,412,true],['desktop',1280,800,false]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
   const tap=async(x,y)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
   const button=async id=>{const b=await E(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}})()`);assert(b.hit&&b.w>=44&&b.h>=44,'reachable 44px '+id);await tap(b.x,b.y);};
   await open('noR069=1&noR018=1&noR006=1&noR016=1');
   await E('__rts.pause(true);__rts.runScript(0);__rts.focus(29,29,1)');await frames();
   const gun=async()=>{const p=await E('__rts.screenOf(4)');assert.equal(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName`),'CANVAS','native howitzer remains visible');await tap(p[0],p[1]);await until('__rts.selected().length===1&&__rts.selected()[0]===4','native howitzer selection');};
   await gun();
   await until('document.querySelector("#hint").textContent.includes("無進行中任務")','initial no-task state');
   await button('b-discipline');await until('__rts.log().some(e=>e.cmd.t==="fireDiscipline"&&e.cmd.hold)','native hold command logged');
   await E('__rts.stepN(1)');await frames();
   // Ground (24,24) is a real empty reserved spawn-zone cell, >howitzer min range.
   await E('__rts.focus(24.5,24.5,1)');await frames();
   const p=await E('__rts.screenOfCell(24,24)');
   assert.equal(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName`),'CANVAS','actual target is reachable canvas');
   await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p[0],y:p[1],id:1}]});
   await sleep(580);await until('!document.querySelector("#command-menu").hidden','native longpress opens menu');
   await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames();
   const before=(await snapshot()).log.length;
   await button('cm-he');await until(`__rts.log().length===${before+1}`,'native HE logged exactly once');
   assert.deepEqual((await snapshot()).log.at(-1).cmd,{t:'fireAt',side:0,ids:[4],x:24,z:24});
   // Resume by the real toolbar, then reselect the gun to dismiss transient command help.
   await button('b-pause');await until('!__rts.paused()&&JSON.parse(__r145world()).units[3].order==='+ORD_FIRE_AT,'native resume consumes task');
   await E('__rts.focus(29,29,1)');await frames();await gun();
   await until('document.querySelector("#hint").textContent.includes("剩餘合計 4 發")','held task reports true four remaining');
   let s=await snapshot();assert.equal(s.world.units[3].target,4);assert.equal(s.world.units[3].holdFire,1);replay(s);
   const heldLayout=await E('(()=>{const e=document.querySelector("#hint"),r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth,overlaps:["#fire-discipline","#r901-chrome","#minimap","#hud .btns"].filter(s=>{const b=document.querySelector(s)?.getBoundingClientRect();return b&&b.width>0&&b.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top})}})()');
   assert(heldLayout.x>=0&&heldLayout.y>=0&&heldLayout.right<=width&&heldLayout.bottom<=height&&heldLayout.overflow===0,'long active task text stays inside viewport');
   assert.deepEqual(heldLayout.overlaps,[],'long task hint does not cover left rail/minimap/toolbar');
   await shot(page,path.join(ROOT,'shots',`bombard-status-${name}-held.png`));
   await button('b-speed');await button('b-speed'); // actual 4x control, not a mocked clock
   await button('b-discipline');
   await until('document.querySelector("#hint").textContent.includes("剩餘合計 3 發")','native release fires first real shell');
   s=await snapshot();assert.equal(s.world.units[3].target,3);assert(s.world.nextShell>1);replay(s);
   await shot(page,path.join(ROOT,'shots',`bombard-status-${name}-active.png`));
   await until('JSON.parse(__r145world()).units[3].order!=='+ORD_FIRE_AT,'real simulation finishes all four rounds',25000);
   await button('b-pause');await until('__rts.paused()','native pause after completion');
   await until('document.querySelector("#hint").textContent.includes("無進行中任務")','completion clears active-task count without stale totals');
   s=await snapshot();assert.equal(s.world.units[3].target,0);assert(s.world.units[3].alive);replay(s);
   const layout=await E('(()=>{const e=document.querySelector("#hint"),r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth}})()');
   assert(layout.x>=0&&layout.y>=0&&layout.right<=width&&layout.bottom<=height&&layout.overflow===0,'task text stays inside viewport');
   await shot(page,path.join(ROOT,'shots',`bombard-status-${name}-completed.png`));
   receipts.push({name,tick:s.world.tick,hash:s.hash,commands:s.log.length,layout});
   // Same genuine native command log through valve-off replay: presentation only.
   await open('noR069=1&noR145=1');
   assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(s.log)},${s.world.tick});__rts.pause(true);__rts.hash()`),s.hash,'valve replay preserves exact simulation');
   await E('__rts.focus(29,29,1)');await frames();await gun();
   assert.equal((await snapshot()).hint.includes('砲擊任務：'),false,'noR145 removes only task summary');
   assert.equal(page.errors.length,0,page.errors.join('\n'));
  }
 });
 if(!process.argv.includes('--prepare-only'))console.log('OK R145 native selection/longpress/HE/hold/release/4x/completion, four viewports, replay+valve, twelve screenshots '+JSON.stringify(receipts));
}catch(e){console.error('R145 FIRST RED '+String(e.stack??e).replaceAll('\n',' | '));process.exitCode=1;}
finally{fs.rmSync(temp,{recursive:true,force:true});}
