// Real command replay only: no HP patches, fake draw calls or synthetic gameplay screenshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createHash}from'node:crypto';import{build}from'vite';
import{withBrowser}from'../tools/cdp.mjs';
import{createWorld,hashWorld,stageOf}from'../src/sim/world.ts';
import{runLog}from'../src/sim/step.ts';import{runScript}from'../src/sim/script.ts';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r138-browser-'));
const strictCI=!!(process.env.CI||process.env.GITHUB_ACTIONS||process.env.GITHUB_RUN_ID),metrics=[];
const commands=[{tick:0,cmd:{t:'fireAt',side:0,ids:[1,2,3,4],x:18,z:9}}];
const cases=[['intact',0,0],['roofless',180,1],['rubble',600,2]];
for(const[name,tick,stage]of cases)assert.equal(stageOf(runLog(createWorld(1944),commands,tick).blds[11]),stage,'fixture: actual fireAt produces '+name);
const digest=x=>createHash('sha256').update(x).digest('hex');
const plugin={name:'r138-readonly-review',enforce:'pre',transform(code,id){
 if(path.relative(root,id.split('?')[0]).replaceAll('\\','/')!=='src/main.ts')return;
 const anchor='(window as unknown as { __rts: typeof rts }).__rts = rts;';assert.equal(code.split(anchor).length,2,'unique read-only observation anchor');
 return code.replace(anchor,anchor+`\n(window as any).__r138World=()=>JSON.stringify(w);`);
}};
try{
 await build({root,logLevel:'error',plugins:[plugin],build:{outDir:tmp}});
 if(process.argv.includes('--prepare-only'))console.log('PREPARED R138 browser build; Chromium NOT RUN');
 else await withBrowser({root:tmp,width:412,height:860,mobile:true,port:9868,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const snapshot=()=>E('({world:__r138World(),hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick(),seed:__rts.seed(),info:__rts.info()})');
  const capture=async(name)=>{const raw=await page.send('Page.captureScreenshot',{format:'png'}),png=Buffer.from(raw.data,'base64');assert.equal(png.subarray(1,4).toString(),'PNG','actual Chromium PNG');fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots',name+'.png'),png);return digest(png);};
  // Native initial views of every supported map size, no camera or scene override.
  for(const size of [32,64,96])for(const off of [true,false]){
   await open(`seed=1944&map=${size}${off?'&noR138=1':''}`);await E('__rts.pause(true)');await frames();
   const s=await snapshot();assert.equal(await E('__rts.mapSize()'),size,'actual map size');assert(s.info.calls<=20&&s.info.triangles<=80000,'opening budget: original 20 calls / 80000 triangles');
   const name=`r138-phone-${size}-opening-${off?'before':'after'}`;metrics.push({name,...s,world:digest(s.world),png:await capture(name)});console.log('R138 measurement',JSON.stringify(metrics.at(-1)));
  }
  const pair={};
  for(const[width,height,mobile]of[[1440,900,false],[412,860,true]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   for(const off of [true,false]){
    await open(`seed=1944&noR100=1&noR018=1${off?'&noR138=1':''}`);await E('__rts.pause(true)');
    for(const[name,tick,stage]of cases){
     const expected=runLog(createWorld(1944),commands,tick);
     await E(`__rts.playLog(1944,${JSON.stringify(commands)},${tick});__rts.pause(true);__rts.focus(18.5,9.5,3)`);await frames();
     const s=await snapshot();assert.deepEqual(JSON.parse(s.world),JSON.parse(JSON.stringify(expected)),'replay: complete Chromium world equals independent Node');assert.equal(s.hash,hashWorld(expected),'replay: hash');
     assert.equal(stageOf((await E('__rts.blds()'))[11]),stage,'visible target actual damage stage');assert(s.info.calls<=22&&s.info.triangles<=80000,'battle budget: original 22 calls / 80000 triangles');
     const key=`${width}-${name}`,state={world:s.world,hash:s.hash,camera:s.camera,tick:s.tick,seed:s.seed};
     const pixels=await E('document.querySelector("body>canvas").toDataURL()');
     if(off)pair[key]={state,pixels};else{assert.deepEqual(state,pair[key].state,'same view: seed/tick/camera/full world');if(stage===0)assert.equal(pixels,pair[key].pixels,'scope: intact real rendered pixels unchanged');else assert.notEqual(pixels,pair[key].pixels,'valve: actual rendered damaged pixels differ');}
     const shot=`r138-${width}-${name}-${off?'before':'after'}`;metrics.push({name:shot,...s,world:digest(s.world),target:expected.blds[11],png:await capture(shot)});console.log('R138 measurement',JSON.stringify(metrics.at(-1)));
    }
    assert.equal(await E('__rts.runScript()'),hashWorld(runScript()),'golden: Chromium equals Node');assert.equal(await E('__rts.hash()'),'eea1d59b','golden: frozen hash');
   }
  }
  assert.deepEqual(page.errors,[],'zero browser errors');assert.deepEqual(page.requests.filter(u=>! /^(http:\/\/127\.0\.0\.1|data:|blob:|about:|chrome)/.test(u)),[],'zero external requests');
 });
 if(!process.argv.includes('--prepare-only'))console.log('OK R138 real replay, same-view independent valve, 32/64/96 opening and damaged mobile budgets');
}catch(e){console.error(e);const unavailable=/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(String(e));process.exitCode=unavailable&&!strictCI?77:1;console.error(process.exitCode===77?'NOT RUN local Chromium unavailable; official CI required':'R138 browser failed');}
finally{fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots/r138-metrics.json'),JSON.stringify(metrics,null,2));fs.rmSync(tmp,{recursive:true,force:true});}
