// Additional R139 fixtures: recorded R120 wall kinds actually destroyed by fireAt.
// Initial fixtures use native bldMaxHp; no fabricated impacts/stages or post-shot HP changes.
import assert from 'node:assert/strict';
import {createWorld,bldMaxHp,idx,center,SUB,UNIT_KINDS,UK_TANK,UK_OBSERVER,ORD_IDLE,BK_WALL_BRICK,BK_WALL_STONE,BK_WALL_CONCRETE} from '../src/sim/world.ts';
import {step} from '../src/sim/step.ts';
import {BattleView} from '../src/render/battle.ts';
import {setWalls} from '../src/render/buildings.ts';
function replay(kind,rot,walls,on){
 setWalls(walls);const w=createWorld(1944);w.ter.fill(0);w.occ.fill(0);w.crater.fill(0);w.blds=[];w.units=[];w.shells=[];w.events=[];w.winner=-1;
 const bw=rot?1:2,bd=rot?2:1,maxHp=bldMaxHp(kind,bw,bd,1),b={id:1,kind,x:20,z:20,w:bw,d:bd,floors:1,hp:maxHp,maxHp};w.blds.push(b);
 for(let z=0;z<bd;z++)for(let x=0;x<bw;x++)w.occ[idx(b.x+x,b.z+z)]=b.id;
 const add=(side,kind,x,z)=>{const k=UNIT_KINDS[kind];w.units.push({id:w.units.length+1,side,kind,x:center(x),z:center(z),hp:k.hp,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:0,aimX:SUB,aimZ:0});};
 add(0,UK_TANK,16,20);add(0,UK_TANK,17,20);add(1,UK_OBSERVER,31,31);
 const v=new BattleView(w,true,false,true,true,true,true,true,true,true,true,true,true,true,true,on);
 let lethal=false,legacy=0,living=0;const end=(Math.ceil(maxHp/UNIT_KINDS[UK_TANK].dmgBld)+2)*UNIT_KINDS[UK_TANK].reload;
 try{for(let t=0;t<end;t++){
  v.snapshot();step(w,t?[]:[{t:'fireAt',side:0,ids:[1,2],x:20,z:20}]);const before=JSON.stringify(w);v.onEvents(w.events,w.tick/20);v.update(0,w.tick/20,new Set());assert.equal(JSON.stringify(w),before,'wall replay: rendering is readonly');
  if(b.hp>0)living=Math.max(living,v.holeCount);else{lethal=true;legacy=Math.max(legacy,v.holeCount);if(on||walls)assert.equal(v.holeCount,0,'wall rubble lifecycle: shown and noR120 fallback have no dead marks');}
 }assert(lethal&&living>0,'wall fixture: actual fireAt creates living marks then destroys target');if(!on&&!walls)assert(legacy>0,'wall rollback: noR120 restores the recorded old fallback defect');
 return JSON.stringify(w);
 }finally{v.dispose();}
}
for(const kind of[BK_WALL_BRICK,BK_WALL_STONE,BK_WALL_CONCRETE])for(const rot of[0,1])for(const walls of[true,false])assert.equal(replay(kind,rot,walls,true),replay(kind,rot,walls,false),'wall valves: full world unchanged');
setWalls(true);console.log('OK R139 24 real-fireAt wall replays, three kinds/two orientations, noR120 fallback and independent rollback');
