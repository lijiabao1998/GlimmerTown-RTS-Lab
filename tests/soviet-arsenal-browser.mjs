// Real browser gate. No replacement screenshots or DOM mocks count as a pass.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { build } from 'vite';
import { withBrowser, shot, ROOT, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
const log=[{tick:0,cmd:{t:'eco',soviet:1}},{tick:800,cmd:{t:'produce',side:0,kind:14}}];
const expected=hashWorld(runLog(createWorld(1944),log,1300));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soviet-browser-'));
try {
await build({root:ROOT,logLevel:'error',build:{outDir:temp}});
for(const [name,width,height,port] of [['desktop',1280,800,18611],['mobile',412,860,18631]]){
 await withBrowser({width,height,port,root:temp},async({open,page})=>{
  await open('');
  const got=await page.evaluate(`__rts.playLog(1944,${JSON.stringify(log)},1300)`);assert.equal(got,expected);
  await page.evaluate('__rts.pause(true)');
  await page.evaluate("document.body.classList.remove('r901-bar-off'); const c=document.querySelector('#pb-catalog');c.value='蘇式坦克';c.dispatchEvent(new Event('change')); ");
  await sleep(100);
  const info=await page.evaluate(`(()=>{const root=document.querySelector('#prodbar');const bs=[...root.querySelectorAll('button')].filter(b=>!b.hidden);return {labels:bs.map(b=>b.textContent),rects:bs.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}}),info:__rts.info()}})()`);
  assert.equal(info.labels.length,6);assert.ok(info.labels.some(s=>s.includes('T-34/85')));
  assert.ok(info.rects.every(r=>r.w>=44&&r.h>=44&&r.x>=0&&r.right<=width&&r.y>=0&&r.bottom<=height));
  assert.ok(info.info.calls<=20&&info.info.triangles<=80000);
  await shot(page,path.join(ROOT,'shots',`soviet-${name}-tanks.png`));
  for(const group of ['蘇式支援','通用裝備','蘇式支援'])await page.evaluate(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));})()`);
  assert.equal(await page.evaluate("[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden).length"),5);
  await shot(page,path.join(ROOT,'shots',`soviet-${name}-support.png`));
  assert.equal(page.errors.length,0,page.errors.join('\n'));
 });
}
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log('OK soviet desktop/mobile: replay parity, category navigation, 44px targets, screen bounds, render budget, screenshots');
