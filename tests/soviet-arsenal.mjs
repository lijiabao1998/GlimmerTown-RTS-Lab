import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS as K, SOVIET_KINDS, center, SUB, ORD_IDLE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { produce, startEco, ecoStep } from '../src/sim/eco.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { productionCountdown } from '../src/ui/productionCountdown.ts';
import { vehicleDurability } from '../src/ui/vehicleDurability.ts';
import { BattleView } from '../src/render/battle.ts';
import { runScript } from '../src/sim/script.ts';
assert.equal(hashWorld(runScript()), 'eea1d59b');
assert.deepEqual(SOVIET_KINDS, [12,13,14,15,16,17,18,19,20,21,22]);
assert.equal(new Set(SOVIET_KINDS.map(i=>JSON.stringify(K[i]))).size, 11);
assert.equal(K[11].name, 'zombie');
for (const kind of SOVIET_KINDS) {
  const old = createWorld(1944); startEco(old,1,1,1,1); old.eco.supply[0]=999;
  const before=hashWorld(old); produce(old,0,kind); assert.equal(hashWorld(old),before);
  assert.equal(productionBlockReason(old,kind),'本局未開放此單位');
  const w=createWorld(1944); startEco(w,1,1,1,1,1); w.eco.supply[0]=999;
  produce(w,0,kind); assert.deepEqual(w.eco.queue[0],[kind]); assert.equal(w.eco.supply[0],999-K[kind].cost);
  assert.ok(productionCountdown(w).startsWith(K[kind].name));
  w.eco.prog[0]=K[kind].buildTicks; ecoStep(w); assert.ok(w.units.some(u=>u.kind===kind));
  const spawned=w.units.find(u=>u.kind===kind); assert.equal(vehicleDurability(w,new Set([spawned.id])),`車輛耐久：${K[kind].hp}/${K[kind].hp}`);
  w.eco.supply[1]=999; produce(w,1,kind); assert.deepEqual(w.eco.queue[1],[kind]);
  const log=[{tick:0,cmd:{t:'eco',soviet:1}},{tick:1000,cmd:{t:'produce',side:0,kind}}];
  const total=1002+K[kind].buildTicks;
  const a=runLog(createWorld(1944),log,total), b=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),total);
  const half=runLog(createWorld(1944),log,1001), clone=structuredClone(half);
  runLog(half,log,total); runLog(clone,log,total);
  assert.equal(hashWorld(a),hashWorld(b)); assert.equal(hashWorld(a),hashWorld(half)); assert.equal(hashWorld(a),hashWorld(clone));
}
// Every new weapon fires and damages a target using the real combat step, not a catalogue mock.
for (const kind of SOVIET_KINDS) {
 const w=createWorld(7); w.blds=[]; w.occ.fill(0); w.ter.fill(0); w.units=[];
 const add=(k,side,x)=>{w.units.push({id:w.units.length+1,kind:k,side,x:center(x),z:center(12),hp:K[k].hp,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:0,aimX:SUB,aimZ:0});};
 const gap=Math.max(3,Math.ceil(K[kind].minRange/SUB)+1); add(kind,0,8);add(7,1,8+gap);w.units[1].cooldown=99999;
 let fired=false;for(let i=0;i<K[kind].reload*4+200;i++){step(w,[]);fired ||= w.events.some(e=>e.e==='fire'&&e.unit===1);}
 assert.ok(fired,`${K[kind].name} fires`);assert.ok(w.units[1].hp<K[7].hp,`${K[kind].name} deals damage`);
}
// Model batches exist for all 11 IDs; drawing cannot mutate simulation.
const w=createWorld(7);w.units=[];w.blds=[];w.occ.fill(0);
for(const [i,kind] of SOVIET_KINDS.entries())w.units.push({id:i+1,kind,side:0,x:center(8+i%4*2),z:center(8+Math.floor(i/4)*2),hp:K[kind].hp,alive:true,order:0,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:0,aimX:SUB,aimZ:0});
const before=hashWorld(w),v=new BattleView(w,{fx:false,fog:false});v.update(0,0,new Set());assert.equal(hashWorld(w),before);
assert.equal(v.hull.count,9);assert.equal(v.gun.count,2);v.dispose();
// Semantic trade-offs: speed, protection, anti-armour vs demolition, open-top vulnerability.
assert.ok(K[12].speed>K[14].speed && K[12].hp<K[14].hp);
assert.ok(K[16].hp>K[15].hp && K[16].speed<K[15].speed);
assert.ok(K[19].range>K[18].range && K[19].soft<K[18].soft);
assert.ok(K[20].dmgBld>K[19].dmgBld && K[20].reload>K[19].reload);
assert.equal(K[18].openTop,true);assert.equal(K[19].openTop,false);
console.log('OK soviet arsenal: 11 production, combat, replay, clone, legacy hash, render and trade-off guards');
