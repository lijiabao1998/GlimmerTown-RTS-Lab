// R134: optimization proof. Only inward facade backs on opaque intact walls may vanish.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorld, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE} from '../src/sim/world.ts';
import {applyMap} from '../src/sim/maps.ts';
import {Geo} from '../src/render/geo.ts';
import * as optimized from '../src/render/buildings.ts';
const file=path.resolve(import.meta.dirname,'../src/render/buildings.ts');
const baseline=file.replace(/\.ts$/,`.r134-proof-${process.pid}.ts`);
const source=fs.readFileSync(file,'utf8'), anchor='if (!buildingDetailsOn) {';
assert.equal(source.split(anchor).length,2,'unique optimization gate');
const triangles=g=>{const m=new Map();for(let i=0;i<g.pos.length;i+=9){const t=JSON.stringify([g.pos.slice(i,i+9),g.nor.slice(i,i+9),g.col.slice(i,i+9)]);m.set(t,(m.get(t)||0)+1);}return m;};
const equal=(a,b)=>assert.deepEqual([a.pos,a.nor,a.col],[b.pos,b.nor,b.col]);
try {
 fs.writeFileSync(baseline,source.replace(anchor,'if (true) {'));
 const original=await import(pathToFileURL(baseline));const totals=[];
 for(const map of [0,1,2,3]){
  const w=createWorld(1944);if(map)applyMap(w,map,1);let removed=0;
  for(const b of w.blds){
   for(const on of [false,true])for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]){
    original.setBuildingDetails(on);optimized.setBuildingDetails(on);
    const a=original.buildingGeo(new Geo(),b,stage),c=optimized.buildingGeo(new Geo(),b,stage);
    if(!on||stage!==STAGE_INTACT){equal(a,c);continue;}
    const left=triangles(a);
    for(const [key,count]of triangles(c)){assert((left.get(key)||0)>=count,'no changed or added visible triangle');left.set(key,left.get(key)-count);}
    for(const [key,count]of left)if(count){
     const [p,n]=JSON.parse(key); const x0=b.x+.1,x1=b.x+b.w-.1,z0=b.z+.1,z1=b.z+b.d-.1;
     const onPlane=(axis,v)=>[0,3,6].every(i=>Math.abs(p[i+axis]-v)<1e-10);
     assert((onPlane(0,x0)&&n[0]===1)||(onPlane(0,x1)&&n[0]===-1)||(onPlane(2,z0)&&n[2]===1)||(onPlane(2,z1)&&n[2]===-1),'removed triangle is only inward wall-plane back');
     for(let i=0;i<9;i+=3)assert(p[i]>=x0-1e-10&&p[i]<=x1+1e-10&&p[i+2]>=z0-1e-10&&p[i+2]<=z1+1e-10&&p[i+1]>=0&&p[i+1]<=optimized.wallHeight(b)+1e-10,'removed face within opaque wall volume');
     removed+=count;
    }
   }
  }
  assert(removed>0,'optimization actually exercised');totals.push({map,removed});
 }
 console.log('R134 hidden faces: exact exterior triangle multiset, rollback and damage unchanged',JSON.stringify(totals));
}finally{fs.rmSync(baseline,{force:true});}
