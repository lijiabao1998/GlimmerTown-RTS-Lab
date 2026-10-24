import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE, BK_HOUSE } from '../src/sim/world.ts';
import { applyMap } from '../src/sim/maps.ts';
import { buildingGeo, buildTown, setBuildingDetails } from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';
const fp = g => createHash('sha256').update(JSON.stringify([g.pos,g.nor,g.col])).digest('hex');
const valid = (g,b) => {
 assert.equal(g.pos.length%9,0,'triangles'); assert.equal(g.pos.length,g.nor.length,'normal count'); assert.equal(g.pos.length,g.col.length,'colour count');
 assert(g.pos.every(Number.isFinite)&&g.nor.every(Number.isFinite)&&g.col.every(Number.isFinite),'finite');
 for(let i=0;i<g.pos.length;i+=3){assert(g.pos[i]>=b.x-1e-9&&g.pos[i]<=b.x+b.w+1e-9&&g.pos[i+2]>=b.z-1e-9&&g.pos[i+2]<=b.z+b.d+1e-9,'footprint');assert(Math.abs(Math.hypot(...g.nor.slice(i,i+3))-1)<1e-9,'unit normal');}
};
let changed=0, maxAdded=0; const metrics=[];
for(const map of [0,1,2,3]) {
 const w=createWorld(1944); if(map)applyMap(w,map,1);const before=hashWorld(w), data=JSON.stringify(w);
 setBuildingDetails(false); const old=fp(buildTown(w));
 for(const b of w.blds) for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]) {
  setBuildingDetails(false);const a=buildingGeo(new Geo(),b,stage);setBuildingDetails(true);const c=buildingGeo(new Geo(),b,stage);
  assert.equal(fp(c),fp(buildingGeo(new Geo(),b,stage)),'fixed input');
  if(stage!==STAGE_INTACT)assert.equal(fp(a),fp(c),'damage stages unchanged');
  else {
   // Existing one-cell church tower already projects 0.03 cells beyond its grid.
   // Keep that immutable legacy envelope; added details may not expand it.
   const xs=a.pos.filter((_,i)=>i%3===0), zs=a.pos.filter((_,i)=>i%3===2);
   const x=Math.min(b.x,...xs),z=Math.min(b.z,...zs);
   valid(c,{...b,x,z,w:Math.max(b.x+b.w,...xs)-x,d:Math.max(b.z+b.d,...zs)-z}); if(fp(a)!==fp(c))changed++;maxAdded=Math.max(maxAdded,c.triangles-a.triangles); }
 }
 setBuildingDetails(false);assert.equal(fp(buildTown(w)),old,'valve restores full geometry');
 setBuildingDetails(true);const on=buildTown(w);assert.equal(hashWorld(w),before);assert.equal(JSON.stringify(w),data,'no world/RNG writes');
 if(map===3)assert.equal(w.blds.length,284);metrics.push({map,buildings:w.blds.length,off:old,on:fp(on),fullUnculledTriangles:on.triangles});
}
assert(changed>0);assert(maxAdded<=250,'bounded per-building detail geometry');
const b={id:1,kind:BK_HOUSE,x:1,z:1,w:2,d:2,floors:2,hp:100,maxHp:100};setBuildingDetails(true);const good=buildingGeo(new Geo(),b,STAGE_INTACT);valid(good,b);
const faults=[g=>g.pos[0]=NaN,g=>g.nor[0]=20,g=>g.pos[0]=b.x-1,g=>g.col.pop(),g=>g.pos.push(0)];
for(const fault of faults){const g=structuredClone(good);fault(g);assert.throws(()=>valid(g,b),'single-fault negative detected');}
setBuildingDetails(false);console.log('R134 geometry',JSON.stringify({changed,maxAdded,negativeControls:faults.length,metrics}));
