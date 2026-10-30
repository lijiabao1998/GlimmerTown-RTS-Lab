import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { build } from 'vite';
import { withBrowser, shot, ROOT, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'international-browser-'));
try {
await build({root:ROOT,logLevel:'error',build:{outDir:temp}});
for(const [name,width,height,port] of [['desktop',1280,800,18651],['mobile',412,860,18671]]){
 await withBrowser({width,height,port,root:temp},async({open,page})=>{
  await open('');
  for(const [group,tank,gun] of [['美式裝備',23,28],['德式裝備',29,34],['日式裝備',35,40]]) {
   const log=[{tick:0,cmd:{t:'eco',international:1}},{tick:800,cmd:{t:'produce',side:0,kind:tank}},{tick:1100,cmd:{t:'produce',side:0,kind:gun}}];
   const w=runLog(createWorld(1944),log,1600), ids=w.units.filter(u=>u.side===0&&u.alive&&(u.kind===tank||u.kind===gun)).map(u=>u.id);
   assert.equal(ids.length,2,'two representative units actually produced');
   assert.equal(await page.evaluate(`__rts.playLog(1944,${JSON.stringify(log)},1600)`),hashWorld(w));
   await page.evaluate(`__rts.pause(true);__rts.select(${JSON.stringify(ids)});document.body.classList.remove('r901-bar-off')`);
   for(const value of [group,'通用裝備',group]) await page.evaluate(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(value)};c.dispatchEvent(new Event('change'));})()`);
   await sleep(100);
   const info=await page.evaluate(`(()=>{const bs=[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden);return {labels:bs.map(b=>b.textContent),rects:bs.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}}),text:document.body.innerText,info:__rts.info()}})()`);
   assert.equal(info.labels.length,6);
   assert.ok(info.rects.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=width&&r.y>=0&&r.bottom<=height));
   assert.ok(info.info.calls<=20&&info.info.triangles<=80000);
   assert.ok(info.text.includes('裝填完成 2／裝填中 0'));
   await shot(page,path.join(ROOT,'shots',`international-${name}-${tank}.png`));
  }
  await open('noR142=1');
  assert.equal(await page.evaluate("[...document.querySelector('#pb-catalog').options].some(o=>o.value==='美式裝備')"),false);
  assert.equal(page.errors.length,0,page.errors.join('\n'));
 });
}
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log('OK international desktop/mobile: three repeated category flows, real production replay parity, reload, 44px bounds, budgets, valve, screenshots');
