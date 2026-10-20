import assert from 'node:assert/strict';
import {Geo} from '../src/render/geo.ts';
import {wireGeo,setWireDetail,buildTown} from '../src/render/buildings.ts';
import {createWorld,BK_WIRE,hashWorld} from '../src/sim/world.ts';
const heights=[];
for(const rot of [0,1])for(const hp of [60,30,0]){
 const b={id:1,kind:BK_WIRE,x:20,z:20,w:rot?1:2,d:rot?2:1,floors:1,hp,maxHp:60,builtBy:0};
 const w=createWorld(1944);w.wires={version:1,segments:[b]};const hash=hashWorld(w);
 setWireDetail(true);const full=wireGeo(new Geo(),b);setWireDetail(false);const low=wireGeo(new Geo(),b);
 assert(low.pos.length>0&&full.pos.length>low.pos.length,'geometry: each stage and rotation has visible lower-detail fallback');
 const xs=full.pos.filter((_,i)=>i%3===0),ys=full.pos.filter((_,i)=>i%3===1),zs=full.pos.filter((_,i)=>i%3===2);
 assert(Math.abs(Math.max(...xs)-Math.min(...xs)-(rot?.14:2))<1e-9,'geometry: exact wire footprint horizontal');
 assert(Math.abs(Math.max(...zs)-Math.min(...zs)-(rot?2:.14))<1e-9,'geometry: exact wire footprint vertical');
 heights.push(Math.max(...ys));assert(Math.max(...ys)<.34,'geometry: wire is below wall and soldiers');
 const withWire=buildTown(w).pos.length;delete w.wires;assert(withWire>buildTown(w).pos.length,'geometry: merged town actually includes fallback wire');w.wires={version:1,segments:[b]};assert.equal(hashWorld(w),hash,'geometry: renderer does not mutate simulation');
}
assert(heights[2]<heights[1]&&heights[5]<heights[4],'geometry: ruined wire lies near ground');setWireDetail(true);console.log('OK wire-view: stages, rotations, fallback integration and read-only geometry');
