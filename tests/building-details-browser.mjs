import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { BK_HQ, createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { withBrowser, shot } from '../tools/cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r134-native-')), metrics=[];
const fixture={name:'r134-native-review',transform(code,id){if(path.relative(root,id.split('?')[0]).replaceAll('\\','/')!=='src/main.ts')return;return code+`\nwindow.__r134Review=(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);};window.__r134NativeZoom=(factor)=>{view.zoomBy(factor);return view.zoom;};`;}};
try{
 await build({root,logLevel:'error',plugins:[fixture],build:{outDir:tmp}});
 await withBrowser({root:tmp,width:1440,height:900,port:9974},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  for(const [width,height,mobile] of [[1440,900,false],[412,860,true]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   const pair={};
   for(const off of [true,false]){
    await open('map=96&seed=1944'+(off?'&noR134=1':''));await E('__rts.pause(true)');await frames();await shot(page,path.join(root,'shots',`r134-${width}-default-fog-${off?'before':'after'}.png`));
    assert.equal(await E('__r134NativeZoom(100)'),3,'native upper clamp');assert.equal(await E('__r134NativeZoom(0.001)'),0.55,'native lower clamp');
    await open('map=96&seed=1944&noR100=1'+(off?'&noR134=1':''));await E('__rts.pause(true)');
    assert.equal(await E('__rts.blds().length'),284);
    for(const [scene,x,z,zoom] of [['opening',87,87,1],['village',18,18,2],['near',18,18,3],['wide-native',48,48,0.55]]){
     await E(`__r134Review(${x},${z},${zoom})`);await frames();
     const info=await E('__rts.info()'),state=await E('({hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick(),mapSize:__rts.mapSize(),buildings:__rts.blds().length,seed:__rts.seed()})');
     assert.equal(state.mapSize,96,'capture actual 96 grid');assert.equal(state.buildings,284,'capture actual building count');assert(info.calls<=20&&info.triangles<=80000,`budget ${width} ${scene}: ${JSON.stringify(info)}`);
     const key=width+'-'+scene;if(off)pair[key]=state;else assert.deepEqual(state,pair[key],'same native view and simulation');
     const name=`r134-${width}-${scene}-${off?'before':'after'}`;metrics.push({name,...info,...state});console.log('R134 capture',JSON.stringify(metrics.at(-1)));await shot(page,path.join(root,'shots',name+'.png'));
    }
    // Real simulation, deterministic fixed steps. Existing battle budget is unchanged.
    await E("document.getElementById('bb-start').click();__rts.pause(true)");await E('__rts.stepN(600-__rts.tick());__r134Review(48,48,2)');await frames();
    const info=await E('__rts.info()');assert(info.calls<=22&&info.triangles<=80000,`battle budget: ${JSON.stringify(info)}`);
    assert.equal(await E('__rts.mapSize()'),96);const replay=runLog(createWorld(await E('__rts.seed()')),await E('__rts.log()'),600);assert.deepEqual(await E('__rts.blds()'),replay.blds,'actual enemy deployment and HQ match independent Node replay');assert.equal(await E('__rts.hash()'),hashWorld(replay),'complete world matches Node replay');assert.equal(await E(`__rts.blds().filter(b=>b.kind===${BK_HQ}).length`),2,'two native eco HQ');const battleHash=await E('__rts.hash()');if(off)pair.battle=battleHash;else assert.equal(battleHash,pair.battle,'battle replay invariant');metrics.push({name:`r134-${width}-battle-${off?'before':'after'}`,...info,hash:battleHash,...await E('({mapSize:__rts.mapSize(),buildings:__rts.blds().length,seed:__rts.seed(),camera:__rts.cam(),tick:__rts.tick()})')});
    await shot(page,path.join(root,'shots',`r134-${width}-battle-${off?'before':'after'}.png`));
   }
  }
  await open('map=96&noR131=1');await frames();await page.send('Emulation.setDeviceMetricsOverride',{width:412,height:860,deviceScaleFactor:2,mobile:true});await open('map=96&seed=1944&noR100=1');await E('__r134Review(18,18,2)');await frames();const hi=await E('__rts.info()');assert(hi.calls<=20&&hi.triangles<=80000);metrics.push({name:'r134-phone-dpr2',...hi,...await E('({mapSize:__rts.mapSize(),buildings:__rts.blds().length,seed:__rts.seed(),camera:__rts.cam(),tick:__rts.tick(),hash:__rts.hash()})')});await shot(page,path.join(root,'shots','r134-phone-dpr2.png'));assert.equal(await E('__rts.runScript()'),'eea1d59b');assert.deepEqual(page.errors,[],'zero console errors');
  // Native screenshots above remain untouched. This last Chromium screenshot is an explicit diagnostic report, not a game preview.
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1800,deviceScaleFactor:1,mobile:false});
  const report=['R134 TRUE CHROMIUM DIAGNOSTIC METRICS — not gameplay art', ...metrics.map(({name,calls,triangles,rt,hash,mapSize,buildings,seed,camera})=>JSON.stringify({name,calls,triangles,rt,hash,mapSize,buildings,seed,camera}))].join('\n\n');
  await E(`const pre=document.createElement('pre');pre.style='position:fixed;inset:0;z-index:2147483647;margin:0;background:white;color:black;font:18px monospace;white-space:pre-wrap;padding:24px';pre.textContent=${JSON.stringify(report)};document.body.append(pre)`);await frames();await shot(page,path.join(root,'shots','r134-diagnostic-metrics.png'));
 });
 console.log('R134 Chromium metrics',JSON.stringify(metrics));fs.writeFileSync(path.join(root,'shots','r134-metrics.json'),JSON.stringify(metrics,null,2));
}catch(error){console.error('R134 FAILED: '+error.message);process.exitCode=1;}finally{fs.rmSync(tmp,{recursive:true,force:true});}
