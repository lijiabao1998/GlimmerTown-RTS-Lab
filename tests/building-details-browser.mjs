import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r134-native-')), metrics=[];
const fixture={name:'r134-native-review',transform(code,id){if(path.relative(root,id.split('?')[0]).replaceAll('\\','/')!=='src/main.ts')return;return code+`\nwindow.__r134Review=(x,z,zoom)=>{paused=true;view.fogOn=false;view.target.set(x,0,z);view.zoom=zoom;};`;}};
try{
 await build({root,logLevel:'error',plugins:[fixture],build:{outDir:tmp}});
 await withBrowser({root:tmp,width:1440,height:900,port:9974},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  for(const [width,height,mobile] of [[1440,900,false],[412,860,true]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   const pair={};
   for(const off of [true,false]){
    await open('map=96&seed=1944'+(off?'&noR134=1':''));await E('__rts.pause(true)');
    assert.equal(await E('__rts.blds().length'),284);assert.equal(await E('__rts.runScript()'),'eea1d59b');
    for(const [scene,x,z,zoom] of [['opening',7,7,1],['village',18,18,2],['near',18,18,4],['full',48,48,0.16]]){
     await E(`__r134Review(${x},${z},${zoom})`);await frames();
     const info=await E('__rts.info()'),state=await E('({hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick()})');
     assert(info.calls<=20&&info.triangles<=80000,`budget ${width} ${scene}: ${JSON.stringify(info)}`);
     const key=width+'-'+scene;if(off)pair[key]=state;else assert.deepEqual(state,pair[key],'same native view and simulation');
     const name=`r134-${width}-${scene}-${off?'before':'after'}`;metrics.push({name,...info,...state});console.log('R134 capture',JSON.stringify(metrics.at(-1)));await shot(page,path.join(root,'shots',name+'.png'));
    }
    // Real simulation, deterministic fixed steps. Existing battle budget is unchanged.
    await E("document.getElementById('bb-start').click();__rts.pause(true)");await E('__rts.stepN(600-__rts.tick());__r134Review(48,48,2)');await frames();
    const info=await E('__rts.info()');assert(info.calls<=22&&info.triangles<=80000,`battle budget: ${JSON.stringify(info)}`);
    const battleHash=await E('__rts.hash()');if(off)pair.battle=battleHash;else assert.equal(battleHash,pair.battle,'battle replay invariant');metrics.push({name:`r134-${width}-battle-${off?'before':'after'}`,...info,hash:battleHash});
    await shot(page,path.join(root,'shots',`r134-${width}-battle-${off?'before':'after'}.png`));
   }
  }
  await open('map=96&noR131=1');await frames();await page.send('Emulation.setDeviceMetricsOverride',{width:412,height:860,deviceScaleFactor:2,mobile:true});await open('map=96');await E('__r134Review(18,18,2)');await frames();const hi=await E('__rts.info()');assert(hi.calls<=20&&hi.triangles<=80000);metrics.push({name:'r134-phone-dpr2',...hi});await shot(page,path.join(root,'shots','r134-phone-dpr2.png'));assert.deepEqual(page.errors,[],'zero console errors');
 });
 console.log('R134 Chromium metrics',JSON.stringify(metrics));fs.writeFileSync(path.join(root,'shots','r134-metrics.json'),JSON.stringify(metrics,null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
