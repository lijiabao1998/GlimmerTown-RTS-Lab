// Independent review guard: live original R014 decals must remain backed by actual damaged walls.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const imp=p=>import(pathToFileURL(path.join(root,p)));
import * as T from 'three';
const {createWorld,stageOf,hashWorld}=await imp('src/sim/world.ts');
const {step}=await imp('src/sim/step.ts');
const {BattleView}=await imp('src/render/battle.ts');
const {Geo}=await imp('src/render/geo.ts');
const {buildingGeo,setDamageDetails}=await imp('src/render/buildings.ts');
const samples=[];
for(const on of [false,true]){
 setDamageDetails(on);const w=createWorld(1944),v=new BattleView(w,true,false);
 try{
  for(let i=0;i<180;i++){v.snapshot();step(w,i===0?[{t:'fireAt',side:0,ids:[1,2,3,4],x:18,z:9}]:[]);v.onEvents(w.events,w.tick/20);v.update(0,w.tick/20,new Set());}
  const b=w.blds[11],H=v.holes;assert.equal(stageOf(b),1,'fixture: real roofless building after fireAt replay');
  const before=JSON.stringify(w),mesh=new T.Mesh(buildingGeo(new Geo(),b,stageOf(b)).geometry(),new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld();
  let decals=0,points=0;
  for(let i=0;i<H.live.length;i++){
   if(!H.live[i]||H.bld[i]!==b.id)continue;decals++;
   const scale=H.kind[i]===0?1.55:1;
   for(const a of[-1,0,1])for(const c of[-1,0,1]){
    const x=H.x[i]+(H.nz[i]?a*H.w[i]*scale/2:0),z=H.z[i]+(H.nx[i]?a*H.w[i]*scale/2:0),y=H.y[i]+c*H.h[i]*scale/2;
    if(y<=0)continue;points++;
    const ray=new T.Raycaster(new T.Vector3(x+H.nx[i]*.02,y,z+H.nz[i]*.02),new T.Vector3(-H.nx[i],0,-H.nz[i]),0,.04);
    assert(ray.intersectObject(mesh).length>0,`decals: original R014 extent unsupported (on=${on}, hole=${i}, sample=${a},${c}, position=${x},${y},${z})`);
   }
  }
  assert(decals>=3&&points>=27,'fixture: real HE/AP decals and extent samples exercised');assert.equal(JSON.stringify(w),before,'readonly: geometry/raycast leaves replay untouched');
  samples.push({on,tick:w.tick,hash:hashWorld(w),decals,points});mesh.geometry.dispose();mesh.material.dispose();
 }finally{v.dispose();}
}
assert.equal(samples[0].hash,samples[1].hash,'same world under both valves');setDamageDetails(false);
console.log('OK R138 actual R014 decal support',JSON.stringify(samples));
