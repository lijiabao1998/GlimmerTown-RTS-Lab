// R139: real command replay, not fabricated stage/impact events.
import assert from 'node:assert/strict';
import {createWorld,hashWorld,stageOf,SHELL_AP,SHELL_HE} from '../src/sim/world.ts';
import {step,runLog} from '../src/sim/step.ts';
import {runScript} from '../src/sim/script.ts';
import {BattleView} from '../src/render/battle.ts';
import {setDamageDetails,setWalls} from '../src/render/buildings.ts';
const log=[{tick:0,cmd:{t:'fireAt',side:0,ids:[1,2,3,4],x:18,z:9}}];
const marks=v=>Array.from(v.holes.live).flatMap((live,i)=>live?[Object.fromEntries(['bld','kind','x','y','z','nx','nz','w','h','r','g','b'].map(k=>[k,v.holes[k][i]]))]:[]);
function replay(on,r014=true,r138=true,r120=true){
 setDamageDetails(r138);setWalls(r120);const w=createWorld(1944),v=new BattleView(w,true,false,true,true,true,true,true,r014,true,true,true,true,true,true,on);
 const saved={},events=[];let clone;
 try{for(let k=0;k<600;k++){
  v.snapshot();step(w,k===0?log[0].cmd?[log[0].cmd]:[]:[]);const before=JSON.stringify(w);v.onEvents(w.events,w.tick/20);v.update(0,w.tick/20,new Set());assert.equal(JSON.stringify(w),before,'readonly: full world unchanged by render');
  if(w.tick===180)clone=structuredClone(w);
  if([0,180,198,199,202,600].includes(w.tick))saved[w.tick]={marks:marks(v),world:before,hash:hashWorld(w)};
  if(w.tick===199||w.tick===202)events.push({tick:w.tick,events:structuredClone(w.events)});
 }
 for(let k=180;k<600;k++)step(clone,[]);
 assert.deepEqual(w,clone,'history: halfway structuredClone continues identically');
 assert.deepEqual(w,runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),600),'history: complete JSON command replay identical');
 return{saved,events,instances:v.holeInstances};
 }finally{v.dispose();}
}
const old=replay(false),fixed=replay(true);
assert.deepEqual(fixed.events,old.events,'same simulation events on/off');
assert.equal(fixed.events[0].events[0].e,'stage','fixture: actual stage event first');
assert.equal(fixed.events[0].events[0].stage,2,'fixture: actual lethal AP turns building to rubble');
assert(fixed.events[0].events.some(e=>e.e==='impact'&&e.kind===SHELL_AP&&e.bld===12),'fixture: lethal AP follows stage');
assert(fixed.events[1].events.some(e=>e.e==='impact'&&e.kind===SHELL_AP&&e.bld===12),'fixture: later in-flight AP hits same rubble');
for(const tick of[199,202,600])assert.equal(fixed.saved[tick].marks.filter(h=>h.bld===12).length,0,`rubble lifecycle: tick ${tick} must not rebuild a wall-plane mark`);
assert.equal(old.saved[199].marks.filter(h=>h.bld===12).length,1,'rollback: same-tick legacy mark restored');
assert.equal(old.saved[202].marks.filter(h=>h.bld===12).length,2,'rollback: in-flight legacy mark restored');
for(const tick of[180,198]){
 assert.deepEqual(fixed.saved[tick].marks,old.saved[tick].marks,'living AP/HE marks byte-for-byte unchanged');
 assert(fixed.saved[tick].marks.some(h=>h.kind===0)&&fixed.saved[tick].marks.some(h=>h.kind===1),'fixture exercises living AP and HE');
}
for(const tick of[180,198,199,202,600])assert.equal(fixed.saved[tick].world,old.saved[tick].world,'valve: complete world unchanged');
for(const r138 of[true,false])for(const r120 of[true,false]){
 const a=replay(true,true,r138,r120),b=replay(false,true,r138,r120),off=replay(true,false,r138,r120);
 assert.equal(a.saved[600].marks.filter(h=>h.bld===12).length,0,'combination: no dead civilian marks');
 assert.equal(b.saved[600].marks.filter(h=>h.bld===12).length,2,'combination: independent rollback');
 assert.equal(off.instances,0,'R014-off has no instances');
 assert.equal(a.saved[600].world,b.saved[600].world,'combination: complete world unchanged');
}
assert.deepEqual(replay(true).saved,fixed.saved,'deterministic: all marks and history repeat');
assert.equal(hashWorld(runScript()),'eea1d59b','golden unchanged');setDamageDetails(false);setWalls(true);
console.log('OK R139 real lethal/in-flight AP, live AP/HE, independent rollback, R014/R138/R120 combinations, readonly world and replay/golden');
