// R139 native game render: real fireAt only; read-only inspection, no fake scene or damage.
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createHash} from 'node:crypto';import {build} from 'vite';import {withBrowser} from '../tools/cdp.mjs';
import {createWorld,hashWorld} from '../src/sim/world.ts';import {runLog} from '../src/sim/step.ts';import {runScript} from '../src/sim/script.ts';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r139-browser-')),metrics=[],lifecycleFailures=[];
const strictCI=!!(process.env.CI||process.env.GITHUB_ACTIONS||process.env.GITHUB_RUN_ID),commands=[{tick:0,cmd:{t:'fireAt',side:0,ids:[1,2,3,4],x:18,z:9}}];
const digest=x=>createHash('sha256').update(x).digest('hex');
const plugin={name:'r139-readonly-review',enforce:'pre',transform(code,id){
 if(path.relative(root,id.split('?')[0]).replaceAll('\\','/')!=='src/main.ts')return;
 const anchor='(window as unknown as { __rts: typeof rts }).__rts = rts;';assert.equal(code.split(anchor).length,2,'unique readonly anchor');
 return code.replace(anchor,anchor+`\n(window as any).__r139Read=()=>({world:JSON.stringify(w),marks:Array.from(view.holes.live).flatMap((live,i)=>live?[{bld:view.holes.bld[i],kind:view.holes.kind[i],x:view.holes.x[i],y:view.holes.y[i],z:view.holes.z[i]}]:[])});`);
}};
try{
 await build({root,logLevel:'error',plugins:[plugin],build:{outDir:tmp}});
 if(process.argv.includes('--prepare-only'))console.log('PREPARED R139 browser build; Chromium NOT RUN');
 else await withBrowser({root:tmp,width:412,height:860,mobile:true,port:9893,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const capture=async(name)=>{const r=await page.send('Page.captureScreenshot',{format:'png'}),png=Buffer.from(r.data,'base64');assert.equal(png.subarray(1,4).toString(),'PNG');fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots',name+'.png'),png);return digest(png);};
  for(const size of[32,64,96])for(const off of[true,false]){
   await open(`seed=1944&map=${size}${off?'&noR139=1':''}`);await E('__rts.pause(true)');await frames();
   const info=await E('__rts.info()');assert.equal(await E('__rts.mapSize()'),size);assert(info.calls<=20&&info.triangles<=80000,'opening unchanged 20 / 80000 budget');
   const name=`r139-phone-${size}-opening-${off?'before':'after'}`;metrics.push({name,info,png:await capture(name)});
  }
  for(const[width,height,mobile]of[[1440,900,false],[412,860,true],[390,844,true]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});const pairs={};
   for(const off of[true,false]){
    await open(`seed=1944&noR100=1&noR018=1${off?'&noR139=1':''}`);await E('__rts.pause(true)');
    for(const[name,tick]of[['intact',0],['roofless',180],['lethal',199],['inflight',202],['rubble',600]]){
     const expected=runLog(createWorld(1944),commands,tick);
     await E(`__rts.playLog(1944,${JSON.stringify(commands)},${tick});__rts.pause(true);__rts.focus(18.5,9.5,3)`);await frames();
     const s=await E('({...__r139Read(),hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick(),info:__rts.info()})');
     assert.deepEqual(JSON.parse(s.world),JSON.parse(JSON.stringify(expected)),'complete browser world equals independent Node');assert.equal(s.hash,hashWorld(expected),'hash equals Node');assert(s.info.calls<=22&&s.info.triangles<=80000,'battle unchanged 22 / 80000 budget');
     const pixels=await E('document.querySelector("body>canvas").toDataURL()'),state={world:s.world,hash:s.hash,camera:s.camera,tick:s.tick};
     if(off)pairs[name]={state,pixels,marks:s.marks};else{assert.deepEqual(state,pairs[name].state,'same full world/tick/camera');if(tick<=180){assert.equal(pixels,pairs[name].pixels,'living pixels unchanged');assert.deepEqual(s.marks,pairs[name].marks,'living AP/HE marks unchanged');}else if(tick===600&&pixels===pairs[name].pixels)lifecycleFailures.push(`${width}/${name}: rendered pixels did not change`);}
     const dead=s.marks.filter(h=>expected.blds[h.bld-1].hp<=0);
     if(tick>=199){if(off)assert.equal(dead.length,tick===199?1:2,'rollback actual old bug');else if(dead.length!==0)lifecycleFailures.push(`${width}/${name}: ${dead.length} dead-building wall marks`);}
     const shot=`r139-${width}-${name}-${off?'before':'after'}`;metrics.push({name:shot,...s,world:digest(s.world),dead,png:await capture(shot)});console.log('R139 measurement',JSON.stringify(metrics.at(-1)));
    }
    assert.equal(await E('__rts.runScript()'),hashWorld(runScript()),'Chrome golden matches Node');assert.equal(await E('__rts.hash()'),'eea1d59b','frozen golden');
   }
  }
  // Separate, clearly labelled evidence sheet; gameplay PNGs above remain untouched raw viewport images.
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:2200,deviceScaleFactor:1,mobile:false});
  const report=['R139 CHROMIUM DIAGNOSTIC — measured results, NOT gameplay art',...metrics.map(m=>JSON.stringify({name:m.name,calls:m.info.calls,triangles:m.info.triangles,tick:m.tick,hash:m.hash,deadMarks:m.dead?.length,worldSHA256:m.world})),...lifecycleFailures].join('\n\n');
  await E(`document.body.replaceChildren();const pre=document.createElement('pre');pre.style='margin:0;padding:20px;background:white;color:black;font:14px monospace;white-space:pre-wrap;line-height:1.3';pre.textContent=${JSON.stringify(report)};document.body.append(pre)`);await frames();const reportHeight=await E('Math.ceil(document.querySelector("pre").getBoundingClientRect().bottom)');await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:Math.max(2200,reportHeight),deviceScaleFactor:1,mobile:false});await frames();assert(await E('document.querySelector("pre").getBoundingClientRect().bottom<=innerHeight'),'diagnostic: all measured rows fit');await capture('r139-diagnostic');
  assert.deepEqual(page.errors,[],'zero browser errors');assert.deepEqual(page.requests.filter(u=>!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:|chrome)/.test(u)),[],'zero external requests');
  assert.deepEqual(lifecycleFailures,[],'rubble lifecycle: actual rendered lethal/in-flight marks removed');
 });
 if(!process.argv.includes('--prepare-only'))console.log('OK R139 native raw three-viewport replay, living unchanged, lethal/in-flight removal, golden and original budgets');
}catch(e){console.error(e);const unavailable=/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(String(e));process.exitCode=unavailable&&!strictCI?77:1;console.error(process.exitCode===77?'NOT RUN local Chromium unavailable; official CI required':'R139 browser failed');}
finally{fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots/r139-metrics.json'),JSON.stringify(metrics,null,2));fs.rmSync(tmp,{recursive:true,force:true});}
