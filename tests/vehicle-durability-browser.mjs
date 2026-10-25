// R135: native Chromium input and layout, test-only damage fixtures, no production hooks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { runLog } from '../src/sim/step.ts';
import { createWorld, hashWorld, UNIT_KINDS, SUB, SIDE_PLAYER, UK_HOWITZER, UK_ATGUN, UK_MORTAR } from '../src/sim/world.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r135-browser-'));
const receipts=[];
const summary=[],record=s=>{summary.push(s);console.log(s);};
const eligible=u=>u.alive&&u.side===SIDE_PLAYER&&(UNIT_KINDS[u.kind].armored||[UK_HOWITZER,UK_ATGUN,UK_MORTAR].includes(u.kind));
const plugin={name:'r135-fixture-only',enforce:'pre',transform(code,id){
 if(path.relative(ROOT,id).replaceAll('\\','/')!=='src/main.ts')return;
 const anchor='(window as unknown as { __rts: typeof rts }).__rts = rts;';
 assert.equal(code.split(anchor).length-1,1,'unique browser fixture anchor');
 return code.replace(anchor,anchor+`\n(window as any).__r135={world:()=>JSON.stringify(w),damage:(id:number,hp:number)=>{w.units[id-1].hp=hp;},dead:(id:number)=>{w.units[id-1].alive=false;},clear:()=>{selected.clear();}};`);
}};
async function main(){
 await build({root:ROOT,logLevel:'error',plugins:[plugin],build:{outDir:temp}});
 if(process.argv.includes('--prepare-only')){record('PREPARED R135 test build; Chromium not run');return;}
 await withBrowser({root:temp,port:8465,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:50},async({open,page})=>{
  const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const text=()=>E('document.getElementById("hint").textContent');
  const state=()=>E('({world:__r135.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
  const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
  const tap=async(x,y,mobile)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
  const button=async(id,mobile)=>{const p=await E(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})()`);assert(p[2],'native '+id+' reachable');await tap(p[0],p[1],mobile);};
  const layout=async()=>{const g=await E(`(()=>{const h=document.getElementById('hint'),r=h.getBoundingClientRect();return {r:r.toJSON(),overflow:h.scrollWidth-h.clientWidth,overflowY:h.scrollHeight-h.clientHeight,width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('#hud .btns button,#prodbar button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {r:r.toJSON(),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`);assert(g.r.top>=0&&g.r.bottom<=g.height&&g.r.left>=0&&g.r.right<=g.width&&g.overflow<=0&&g.overflowY<=0,'layout: full hint readable without overflow');assert(g.buttons.every(b=>b.hit&&b.r.width>=44&&b.r.height>=44&&b.r.top>=0&&b.r.bottom<=g.height),'layout: original controls remain reachable');const prod=await E(`(()=>{const p=document.getElementById('prodbar');return p&&!p.hidden?{r:p.getBoundingClientRect().toJSON(),overflow:p.scrollWidth-p.clientWidth,overflowY:p.scrollHeight-p.clientHeight}:null})()`);if(prod)assert(prod.r.top>=0&&prod.r.bottom<=g.r.top-6&&prod.overflow<=0&&prod.overflowY<=0,'layout: full production bar stays above hint');return {...g,prod};};
  for(const mobile of [false,true]){
   const width=mobile?412:1440,height=mobile?860:900;
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
   const results=[];
   for(const off of [false,true]){
    const errors=page.errors.length;
    await open('noR018=1&noR016=1&noR006=1'+(off?'&noR135=1':''));await E('__rts.pause(true);__rts.playLog(1944,[],0);__rts.pause(true)');await frames();
    assert.equal(await E('__rts.hash()'),hashWorld(createWorld(1944)),'initial Node and Chrome full hash');
    const world=JSON.parse((await state()).world),tank=world.units.find(eligible);assert(tank,'native own vehicle fixture');
    await E(`__rts.focus(${tank.x/SUB},${tank.z/SUB},2)`);await frames();
    const p=await E(`__rts.screenOf(${tank.id})`);assert(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName==='CANVAS'`),'selection point is visible native canvas');
    const beforeSelect=await state();await tap(p[0],p[1],mobile);assert.deepEqual(await E('__rts.selected()'),[tank.id],'real input selects exact own vehicle');assert.deepEqual(await state(),beforeSelect,'selection changes no world or command');
    await E(`__r135.damage(${tank.id},1)`);await frames();
    assert.equal((await text()).includes('車輛耐久'),!off,'valve: durability visibility');
    if(!off)assert((await text()).includes(`1/${UNIT_KINDS[tank.kind].hp}`),'single: exact current / kind maximum');
    const damaged=await state();await sleep(80);await frames();assert.deepEqual(await state(),damaged,'paused frames preserve complete world, log, tick and hash');
    await layout();await shot(`r135-${width}-single-${off?'off':'on'}.png`);
    // Real existing all-select control, not a new input path.
    await button('b-all',mobile);const ids=await E('__rts.selected()');assert(ids.length>1,'native mixed selection fixture');
    const own=world.units.filter(eligible);assert(own.length>1,'mixed eligible vehicles');
    if(!off)assert((await text()).includes(`車輛耐久：${own.length} 輛；最低 ${Math.floor(100/UNIT_KINDS[tank.kind].hp)}%`),'mixed: exact eligible count and lowest remaining proportion');
    else assert((await text()).includes('血量 '),'rollback: original average remains');
    const info=await E('__rts.info()');assert(info.calls<=20&&info.triangles<=80000,'original opening mobile budget unchanged');
    const g=await layout();await shot(`r135-${width}-mixed-${off?'off':'on'}.png`);record('R135 native '+JSON.stringify({width,off,selected:ids.length,eligible:own.length,hint:await text(),info,layout:g}));
    receipts.push({width,off,eligible:own.length,calls:info.calls,triangles:info.triangles,hash:await E('__rts.hash()'),health:(await text()).match(/車輛耐久[^。]*/)?.[0]??'off'});
    results.push({state:await state(),calls:info.calls,triangles:info.triangles});
    // Same-tick clear must not leave stale appended text.
    await E('__r135.clear()');await frames();assert(!(await text()).includes('車輛耐久'),'same-tick clear removes summary');
    await button('b-pause',mobile);assert.equal(await E('__rts.paused()'),false,'native pause button resumes');await button('b-pause',mobile);assert.equal(await E('__rts.paused()'),true,'native pause button pauses');
    await button('b-all',mobile);assert((await E('__rts.selected()')).length>0,'restart starts with actual nonempty selection');if(!off)assert((await text()).includes('車輛耐久'),'restart starts with visible summary');
    await button('b-restart',mobile);await frames();assert.deepEqual(await E('__rts.selected()'),[],'native restart clears actual selection');assert.equal(await E('__rts.tick()'),0,'native restart resets tick');assert(!(await text()).includes('車輛耐久'),'native restart clears old selection summary');
    const ecoLog=[{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}},{tick:1,cmd:{t:'produce',side:0,kind:tank.kind}}];
    await E(`__rts.playLog(1944,${JSON.stringify(ecoLog)},2);__rts.pause(true)`);await frames();assert.equal(await E('__rts.hash()'),hashWorld(runLog(createWorld(1944),ecoLog,2)),'economy fixture uses independent Node replay');
    assert(await E('!document.getElementById("prodbar").hidden'),'real economy production bar visible');assert(await E('!document.getElementById("pb-countdown").hidden && document.getElementById("pb-countdown").textContent.length>0'),'real production countdown visible');await button('b-all',mobile);await E(`__r135.damage(${tank.id},1)`);await frames();const ecoLayout=await layout();assert(ecoLayout.prod,'economy layout includes actual production');await shot(`r135-${width}-economy-${off?'off':'on'}.png`);record('R135 economy '+JSON.stringify({width,off,layout:ecoLayout,hint:await text()}));
    assert.equal(page.errors.length,errors,'no native browser errors');
   }
   assert.deepEqual(results[0],results[1],'on/off exact world and render budget parity');
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await E(`(()=>{const e=document.createElement('pre');e.style.cssText='position:fixed;inset:0;margin:0;padding:20px;z-index:99999;background:white;color:black;font:14px monospace;white-space:pre-wrap;overflow:auto';e.textContent=${JSON.stringify('R135 measured Chromium receipt (test output, not gameplay UI)\n'+JSON.stringify(receipts,null,2))};document.body.appendChild(e);})()`);await shot('r135-measured-receipt.png');
 });
 record('OK R135 native selection, health freshness, on/off parity, pause, restart, layout and original budgets');
}
try{await main();}catch(error){record('FAIL '+String(error?.stack??error));if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(String(error))&&!process.env.CI&&!process.env.GITHUB_ACTIONS){console.error('NOT RUN: local browser unavailable; official CI required.');process.exitCode=77;}else process.exitCode=1;}
finally{fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r135-browser.txt'),summary.join('\n')+'\n');fs.rmSync(temp,{recursive:true,force:true});}
