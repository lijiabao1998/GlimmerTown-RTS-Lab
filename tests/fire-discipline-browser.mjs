import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { build } from 'vite';
import { withBrowser, shot, ROOT, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'discipline-browser-'));
try {
 await build({root:ROOT,logLevel:'error',build:{outDir:temp}});
 for(const [name,width,height,port] of [['desktop',1280,800,18731],['mobile',412,860,18751],['narrow',360,860,18771],['landscape',860,412,18791],['landscape-small',640,360,18811]]) {
  await withBrowser({width,height,mobile:name!=='desktop',port,root:temp},async({open,page})=>{
   const until = async expression => {
    const end=Date.now()+10000;
    while(Date.now()<end){if(await page.evaluate(expression))return;await sleep(100);}
    assert.fail('DOM did not settle: '+expression);
   };
   await open('noR069=1');
   await page.evaluate('__rts.playLog(1944,[],1);__rts.pause(true);__rts.select([1,4])');
   await sleep(100);
   const click = async selector => {
    const before=selector==='#b-discipline'?await page.evaluate('__rts.log().length'):null;
    const p=await page.evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if(name!=='desktop') await touchTap(page,p.x,p.y);
    else {await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});}
    // CDP input acknowledgement can precede the compatibility click task. Consume only after its real command exists.
    if(before!==null) await until(`__rts.log().length===${before+1}`);
   };
   if(width<=480){
    await click('#r901-top');
    assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#fire-discipline")).display==="none"'),false,'left rail action stays available with top toolbar folded');
    await click('#r901-top');
   }
   const toolbar=await page.evaluate('[...document.querySelectorAll("#hud .btns button")].filter(b=>!b.hidden).map(b=>{const r=b.getBoundingClientRect();return{id:b.id,x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}})');
   assert.ok(toolbar.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=width&&r.y>=0&&r.bottom<=height),JSON.stringify(toolbar));
   let label=await page.evaluate('document.querySelector("#b-discipline").getAttribute("aria-label")');
   assert.ok(label.includes('車砲停火 0/2'),label);
   // Actual click dispatch through UI; paused commands remain queued and a rapid second click cancels deliberately.
   await click('#b-discipline');
   assert.ok((await page.evaluate('document.querySelector("#b-discipline").getAttribute("aria-label")')).includes('待模擬執行'));
   await click('#b-discipline');await page.evaluate('__rts.stepN(1)');
   let log=await page.evaluate('__rts.log()');
   assert.deepEqual(log.slice(-2).map(x=>x.cmd.hold),[true,false]);
   assert.equal(await page.evaluate('__rts.hash()'),hashWorld(runLog(createWorld(1944),log,2)));
   await click('#b-discipline');await page.evaluate('__rts.stepN(1)');
   await until('!document.querySelector("#b-discipline").getAttribute("aria-label").includes("待模擬執行")');
   label=await page.evaluate('document.querySelector("#b-discipline").getAttribute("aria-label")');
   assert.ok(label.includes('車砲停火 2/2')&&!label.includes('待模擬執行'),label);
   const info=await page.evaluate('(()=>{const b=document.querySelector("#b-discipline"),r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,disabled:b.disabled,hidden:b.hidden,scene:__rts.info()}})()');
   assert.ok(!info.disabled&&!info.hidden&&info.w>=44&&info.h>=44&&info.x>=0&&info.right<=width&&info.y>=0&&info.bottom<=height,JSON.stringify(info));
   const hit=await page.evaluate('(()=>{const b=document.querySelector("#b-discipline"),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})()');
   assert.equal(hit,true,'control is topmost, not covered by another overlay');
   const overlaps=await page.evaluate(`(()=>{const a=document.querySelector('#fire-discipline').getBoundingClientRect();return ['#hud .top','#minimap','#sb-enter','#r901-chrome','#hud .btns'].filter(s=>{const e=document.querySelector(s);if(!e||e.hidden)return false;const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top})})()`);
   assert.deepEqual(overlaps,[],'contextual control must not obscure status, minimap, or sandbox entry');
   if(width<=480) {
    const below=await page.evaluate('(()=>{const a=document.querySelector("#b-discipline").getBoundingClientRect(),b=document.querySelector("#r901-box").getBoundingClientRect();return Math.abs(a.left-b.left)<1&&a.top-b.bottom>=6&&a.top-b.bottom<=8})()');
    assert.equal(below,true,'R144 fire action aligned immediately below box selection');
    // Real regression: reinstate R143 position, then the new alignment predicate must fail.
    const negative=await page.evaluate('(()=>{const e=document.querySelector("#fire-discipline");const old=e.getAttribute("style");e.style.setProperty("left","100px","important");e.style.setProperty("top","156px","important");const a=document.querySelector("#b-discipline").getBoundingClientRect(),b=document.querySelector("#r901-box").getBoundingClientRect();const ok=Math.abs(a.left-b.left)<1&&a.top-b.bottom>=6&&a.top-b.bottom<=8;if(old===null)e.removeAttribute("style");else e.setAttribute("style",old);return ok})()');
    assert.equal(negative,false,'original floating layout must fail new guard');
   }
   assert.ok(info.scene.calls<=20&&info.scene.triangles<=80000,JSON.stringify(info.scene));
   await shot(page,path.join(ROOT,'shots',`fire-discipline-${name}-held.png`));
   // Change selection and create mixed hold state, then action must hold all, not silently release half.
   await page.evaluate('__rts.select([1])');await sleep(100);await click('#b-discipline');await page.evaluate('__rts.stepN(1);__rts.select([1,4])');
   await until('document.querySelector("#b-discipline").getAttribute("aria-label").includes("車砲停火 1/2")');
   assert.ok((await page.evaluate('document.querySelector("#b-discipline").getAttribute("aria-label")')).includes('車砲停火 1/2'));
   await click('#b-discipline');await page.evaluate('__rts.stepN(1)');
   await until('!document.querySelector("#b-discipline").getAttribute("aria-label").includes("待模擬執行")');
   assert.equal(await page.evaluate('document.querySelector("#b-discipline").textContent'),'開火');
   log=await page.evaluate('__rts.log()');
   const ticks=await page.evaluate('__rts.tick()');
   assert.equal(await page.evaluate('__rts.hash()'),hashWorld(runLog(createWorld(1944),log,ticks)));
   await shot(page,path.join(ROOT,'shots',`fire-discipline-${name}-mixed-resolved.png`));
   await page.evaluate('__rts.select([999])');await until('document.querySelector("#b-discipline").disabled');
   assert.equal(await page.evaluate('document.querySelector("#b-discipline").disabled'),true);
   await open('noR069=1&noR143=1');
   assert.equal(await page.evaluate('document.querySelector("#b-discipline")===null'),true);
   assert.equal(await page.evaluate(`__rts.playLog(1944,${JSON.stringify(log)},${ticks})`),hashWorld(runLog(createWorld(1944),log,ticks)),'valve never changes recorded simulation');
   assert.equal(page.errors.length,0,page.errors.join('\n'));
  });
 }
}catch(error){console.error('R143 FIRST RED '+String(error.stack??error).replaceAll('\n',' | '));process.exitCode=1;}finally{fs.rmSync(temp,{recursive:true,force:true});}
if(!process.exitCode) console.log('OK R143 desktop/mobile actual UI: queued repeated clicks, mixed selection, disabled selection, 44px bounds/budget, valve replay, ten screenshots incl landscape');
