// Frozen pre-R138 vertex/normal/colour hashes from b43e7cb; no renderer output is its own oracle.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorld,hashWorld,STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE,BK_HQ,BK_PILLBOX,BK_WALL_BRICK,BK_WALL_STONE,BK_WALL_CONCRETE} from '../src/sim/world.ts';
import {applyMap} from '../src/sim/maps.ts';
import {buildingGeo,buildTown,setMaterials,setDamageDetails,setWalls} from '../src/render/buildings.ts';
import {Geo} from '../src/render/geo.ts';
const expected={
  "false-0": "c4f3493653bf6f14cfe9ce214887e238d658516d3292a7faea14c1621592fa6c",
  "false-1": "69a57b5232fbff31dd248cebd7b6785affd9bcbdec9903349c59aee5dade3076",
  "false-2": "8c7ecfd1492873e00997e630a08526959432e951d1c6984d0793546fbead423f",
  "false-3": "dcb58660f1e1053bb37771378a27fd5931612cb47f859da9919f56beb6d0ff7a",
  "true-0": "1d163e7def861e263391cc2dda5858509627130e4c04d5ef31c1b564441e1a9b",
  "true-1": "1a1ed5968b95ca7e0ccecdba18b742cb1ce37b4f6e3f3127efb5c558c911d7c7",
  "true-2": "3518ad5e9a115b0a3a7eb0dad193d95ba580556255eab02f26263a9e2849a984",
  "true-3": "851eb10f7f5cf74b1b3f89cb853eccf9974902e9ef1cc38cb6ee525a477d0412"
}
;
const fp=g=>createHash('sha256').update(JSON.stringify([g.pos,g.nor,g.col])).digest('hex');
let changed=0,maxAdded=0;const metrics=[];
for(const materials of [false,true]){setMaterials(materials);for(const map of [0,1,2,3]){
 const w=createWorld(1944);if(map)applyMap(w,map,1);const before=JSON.stringify(w),hash=hashWorld(w),off=createHash('sha256');
 for(const b of w.blds)for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]){
  setDamageDetails(false);const old=buildingGeo(new Geo(),b,stage);off.update(JSON.stringify([old.pos,old.nor,old.col]));
  setDamageDetails(true);const g=buildingGeo(new Geo(),b,stage);
  if(stage===STAGE_INTACT||b.kind>4){assert.equal(fp(g),fp(old),'scope: non-civilian and intact unchanged');continue;}
  assert.notEqual(fp(g),fp(old),'enabled: every civilian damaged mesh changes');changed++;
  assert.equal(fp(g),fp(buildingGeo(new Geo(),b,stage)),'deterministic: fixed input geometry');
  assert.equal(g.pos.length%9,0,'layout: complete triangles');assert.equal(g.pos.length,g.nor.length,'layout: normals');assert.equal(g.pos.length,g.col.length,'layout: colours');
  assert([...g.pos,...g.nor,...g.col].every(Number.isFinite),'finite: geometry');
  for(let i=0;i<g.pos.length;i+=3){assert(g.pos[i]>=b.x-1e-9&&g.pos[i]<=b.x+b.w+1e-9&&g.pos[i+2]>=b.z-1e-9&&g.pos[i+2]<=b.z+b.d+1e-9,'footprint: native occupied cells');assert(Math.abs(Math.hypot(...g.nor.slice(i,i+3))-1)<1e-9,'normal: unit length');}
  for(let i=0;i<g.pos.length;i+=9){const [ax,ay,az,bx,by,bz,cx,cy,cz]=g.pos.slice(i,i+9);assert(Math.hypot((by-ay)*(cz-az)-(bz-az)*(cy-ay),(bz-az)*(cx-ax)-(bx-ax)*(cz-az),(bx-ax)*(cy-ay)-(by-ay)*(cx-ax))>1e-10,'triangle: nondegenerate');}
  maxAdded=Math.max(maxAdded,g.triangles-old.triangles);assert(g.triangles-old.triangles<=50,'budget: at most 50 added triangles per damaged building');
 }
 assert.equal(off.digest('hex'),expected[materials+'-'+map],'rollback: exact pre-R138 geometry');
 setDamageDetails(true);buildTown(w);assert.equal(JSON.stringify(w),before,'readonly: complete world and RNG');assert.equal(hashWorld(w),hash,'readonly: world hash');metrics.push({materials,map,buildings:w.blds.length});
}}
// Types not populated on every initial map must also stay outside the candidate.
for(const walls of [false,true])for(const kind of [BK_HQ,BK_PILLBOX,BK_WALL_BRICK,BK_WALL_STONE,BK_WALL_CONCRETE])for(const stage of [0,1,2]){
 setWalls(walls);const b={id:88,kind,x:2,z:2,w:2,d:1,floors:1,hp:50,maxHp:100};setDamageDetails(false);const off=fp(buildingGeo(new Geo(),b,stage));setDamageDetails(true);assert.equal(fp(buildingGeo(new Geo(),b,stage)),off,'scope: special buildings unchanged');
}
assert(changed>0,'enabled: candidate exercised');setDamageDetails(false);setMaterials(true);setWalls(true);
console.log('OK R138 geometry',JSON.stringify({changed,maxAdded,metrics}));
