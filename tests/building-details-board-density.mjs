// Owner visual correction: only intact FAC_BOARD when R134 is enabled may change.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorld,STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE,hashWorld} from '../src/sim/world.ts';
import {applyMap} from '../src/sim/maps.ts';
import {Geo} from '../src/render/geo.ts';
import * as current from '../src/render/buildings.ts';
const file=path.resolve(import.meta.dirname,'../src/render/buildings.ts'),tmp=file.replace('.ts',`.board-proof-${process.pid}.ts`);
const source=fs.readFileSync(file,'utf8'),anchor='const calmBoards = buildingDetailsOn;';
assert.equal(source.split(anchor).length,2);
const data=g=>JSON.stringify([g.pos,g.nor,g.col]);let changed=0,saved=0;
try{
 fs.writeFileSync(tmp,source.replace(anchor,'const calmBoards = false;'));
 const old=await import(pathToFileURL(tmp));
 for(const map of [0,1,2,3]){
  const w=createWorld(1944);if(map)applyMap(w,map,1);const hash=hashWorld(w),snapshot=JSON.stringify(w);
  for(const b of w.blds)for(const on of [false,true])for(const stage of [STAGE_INTACT,STAGE_ROOFLESS,STAGE_RUBBLE]){
   old.setBuildingDetails(on);current.setBuildingDetails(on);
   const a=old.buildingGeo(new Geo(),b,stage),c=current.buildingGeo(new Geo(),b,stage);
   if(!on||stage!==STAGE_INTACT||current.facadeStyle(b)!==current.FAC_BOARD)assert.equal(data(c),data(a),'all accepted non-board details, damage and rollback identical');
   else {assert(c.triangles<a.triangles,'board repetition reduced');assert.equal(data(c),data(current.buildingGeo(new Geo(),b,stage)));changed++;saved+=a.triangles-c.triangles;}
  }
  assert.equal(hashWorld(w),hash);assert.equal(JSON.stringify(w),snapshot);
 }
 assert(changed>0&&saved>0);console.log('R134 board density',JSON.stringify({changed,saved,oldSpacing:.05,newSpacing:.12,oldContrast:1,newContrast:.22}));
 // Source negative controls reject lost rollback, excessive frequency, lost contrast and too-thin seams.
 const gate=s=>{assert(s.includes('const calmBoards = buildingDetailsOn;'));assert(s.includes('calmBoards ? 0.12 : 0.05'));assert(s.includes('calmBoards ? 0.012 : 0.006'));assert(s.includes('.lerp(BOARD_D, 0.22)'));};
 gate(source);for(const [a,b]of [['const calmBoards = buildingDetailsOn;','const calmBoards = true;'],['? 0.12 :','? 0.05 :'],['? 0.012 :','? 0.006 :'],['BOARD_D, 0.22','BOARD_D, 1']])assert.throws(()=>gate(source.replace(a,b)));
}finally{fs.rmSync(tmp,{force:true});current.setBuildingDetails(false);}
