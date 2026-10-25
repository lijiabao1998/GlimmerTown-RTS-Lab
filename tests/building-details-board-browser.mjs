// Same-build, same-camera owner density correction, including native shadows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {withBrowser,shot} from '../tools/cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r134-board-')),results=[];
const fixture={name:'r134-board-proof',transform(code,id){
 const file=path.relative(root,id.split('?')[0]).replaceAll('\\','/');
 if(file==='src/render/buildings.ts'){const anchor='const calmBoards = buildingDetailsOn;';assert.equal(code.split(anchor).length,2);return code.replace(anchor,"const calmBoards = buildingDetailsOn && !new URLSearchParams(location.search).has('r134DenseBoards');");}
 if(file==='src/main.ts')return code+'\nwindow.__r134Shadow=(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);};';
}};
try{
 await build({root,logLevel:'error',plugins:[fixture],build:{outDir:tmp}});
 await withBrowser({root:tmp,width:1440,height:900,port:9976},async({open,page})=>{
  const E=s=>page.evaluate(s),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  for(const [width,height,mobile]of [[1440,900,false],[412,860,true]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
   for(const [map,x,z,zoom]of [['96',18,18,3],['96',18,18,2]]){
    const pair=[];
    for(const unculled of [true,false]){
     await open(`map=${map}&seed=1944&noR100=1`+(unculled?'&r134DenseBoards=1':''));await E(`__r134Shadow(${x},${z},${zoom})`);await frames();
     const state=await E('({hash:__rts.hash(),camera:__rts.cam(),mapSize:__rts.mapSize(),tick:__rts.tick()})'),info=await E('__rts.info()');
     assert.equal(state.mapSize,Number(map));const name=`r134-board-${map}-${width}-zoom${zoom}-${unculled?'dense-before':'calm-after'}`;
     await shot(page,path.join(root,'shots',name+'.png'));const png=fs.readFileSync(path.join(root,'shots',name+'.png'));
     pair.push({name,state,info,png: createHash('sha256').update(png).digest('hex')});
    }
    assert.deepEqual(pair[0].state,pair[1].state,'same world and camera');assert.deepEqual(pair[0].info.town,pair[1].info.town,'same visible buildings and LOD');assert.deepEqual(pair[0].info.rt,pair[1].info.rt,'same native resolution');assert.equal(pair[0].info.calls,pair[1].info.calls);assert(pair[1].info.triangles<=pair[0].info.triangles);
    results.push({pair,pngByteIdentical:pair[0].png===pair[1].png});console.log('R134 SHADOW PAIR',JSON.stringify(results.at(-1)));
   }
  }
  assert.deepEqual(page.errors,[]);
  const compact=results.map(({pair,pngByteIdentical})=>({pngByteIdentical,pair:pair.map(({name,state,info,png})=>({name,...state,calls:info.calls,triangles:info.triangles,rt:info.rt,town:info.town,png}))}));
  const report='R134 native zoom=2/3 board density A/B diagnostic, NOT gameplay\n\n'+compact.map(p=>JSON.stringify(p)).join('\n\n');
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:2200,deviceScaleFactor:1,mobile:false});
  await E(`(()=>{const p=document.createElement('pre');p.style='position:fixed;inset:0;z-index:999999;background:white;color:black;font:15px monospace;white-space:pre-wrap;margin:0;padding:20px';p.textContent=${JSON.stringify(report)};document.body.append(p)})()`);await frames();await shot(page,path.join(root,'shots','r134-board-receipt.png'));
 });
 fs.writeFileSync(path.join(root,'shots','r134-board-metrics.json'),JSON.stringify(results,null,2));
}catch(e){console.error('R134 SHADOW FAILURE '+e.stack);process.exitCode=1;}finally{fs.rmSync(tmp,{recursive:true,force:true});}
