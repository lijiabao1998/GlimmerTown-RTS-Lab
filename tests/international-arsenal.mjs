import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS as K, INTERNATIONAL_KINDS, center, SUB, ORD_IDLE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { produce, startEco, ecoStep } from '../src/sim/eco.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { productionCountdown } from '../src/ui/productionCountdown.ts';
import { vehicleDurability } from '../src/ui/vehicleDurability.ts';
import { BattleView } from '../src/render/battle.ts';
import { createHash } from 'node:crypto';
import { runScript } from '../src/sim/script.ts';
assert.equal(hashWorld(runScript()), 'eea1d59b');
assert.equal(createHash('sha256').update(JSON.stringify(K.slice(0,23))).digest('hex'),'cd5d6da0a899f4a75a014065129017e3b983da74dbe60370078421f29a0dab80','all 23 legacy unit definitions unchanged');
assert.deepEqual(INTERNATIONAL_KINDS, Array.from({length:18},(_,i)=>23+i));
assert.equal(new Set(INTERNATIONAL_KINDS.map(i=>JSON.stringify(K[i]))).size, 18);
assert.equal(K[11].name, 'zombie');
for (const kind of INTERNATIONAL_KINDS) {
  const old = createWorld(1944); startEco(old,1,1,1,1); old.eco.supply[0]=999;
  const before=hashWorld(old); produce(old,0,kind); assert.equal(hashWorld(old),before);
  assert.equal(productionBlockReason(old,kind),'本局未開放此單位');
  const w=createWorld(1944); startEco(w,1,1,1,1,1,1); w.eco.supply[0]=999;
  produce(w,0,kind); assert.deepEqual(w.eco.queue[0],[kind]); assert.equal(w.eco.supply[0],999-K[kind].cost);
  assert.ok(productionCountdown(w).startsWith(K[kind].name));
  w.eco.prog[0]=K[kind].buildTicks; ecoStep(w); assert.ok(w.units.some(u=>u.kind===kind));
  const spawned=w.units.find(u=>u.kind===kind); assert.equal(vehicleDurability(w,new Set([spawned.id])),`車輛耐久：${K[kind].hp}/${K[kind].hp}`);
  w.eco.supply[1]=999; produce(w,1,kind); assert.deepEqual(w.eco.queue[1],[kind]);
  const log=[{tick:0,cmd:{t:'eco',international:1}},{tick:1000,cmd:{t:'produce',side:0,kind}}];
  const total=1002+K[kind].buildTicks;
  const a=runLog(createWorld(1944),log,total), b=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),total);
  const half=runLog(createWorld(1944),log,1001), clone=structuredClone(half);
  runLog(half,log,total); runLog(clone,log,total);
  assert.equal(hashWorld(a),hashWorld(b)); assert.equal(hashWorld(a),hashWorld(half)); assert.equal(hashWorld(a),hashWorld(clone));
}
// Every new weapon fires and damages a target using the real combat step, not a catalogue mock.
for (const kind of INTERNATIONAL_KINDS) {
 const w=createWorld(7); w.blds=[]; w.occ.fill(0); w.ter.fill(0); w.units=[];
 const add=(k,side,x)=>{w.units.push({id:w.units.length+1,kind:k,side,x:center(x),z:center(12),hp:K[k].hp,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:0,aimX:SUB,aimZ:0});};
 const gap=Math.max(3,Math.ceil(K[kind].minRange/SUB)+1); add(kind,0,8);add(7,1,8+gap);w.units[1].cooldown=99999;
 let fired=false;for(let i=0;i<K[kind].reload*4+200;i++){step(w,[]);fired ||= w.events.some(e=>e.e==='fire'&&e.unit===1);}
 assert.ok(fired,`${K[kind].name} fires`);assert.ok(w.units[1].hp<K[7].hp,`${K[kind].name} deals damage`);
}
// Model batches exist for all 11 IDs; drawing cannot mutate simulation.
const w=createWorld(7);w.units=[];w.blds=[];w.occ.fill(0);
for(const [i,kind] of INTERNATIONAL_KINDS.entries())w.units.push({id:i+1,kind,side:0,x:center(8+i%4*2),z:center(8+Math.floor(i/4)*2),hp:K[kind].hp,alive:true,order:0,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:0,aimX:SUB,aimZ:0});
const before=hashWorld(w),v=new BattleView(w,{fx:false,fog:false});v.update(0,0,new Set());assert.equal(hashWorld(w),before);
assert.equal(v.hull.count,15);assert.equal(v.gun.count,3);v.dispose();
// Independent role trade-offs; no model strictly upgrades every dimension.
assert.ok(K[26].speed>K[25].speed && K[26].hp<K[25].hp && K[26].openTop);
assert.ok(K[32].hp>K[31].hp && K[32].speed<K[31].speed && K[32].cost>K[31].cost);
assert.ok(K[35].cost<K[38].cost && K[35].hp<K[38].hp);
assert.ok(K[27].indirect && K[27].minRange>0 && K[27].armored);
assert.ok(K[34].range>K[28].range && K[34].speed<K[28].speed);
assert.ok(K[36].dmgBld>K[37].dmgBld && K[36].pierce<K[37].pierce);
console.log('OK international arsenal: 18 production/combat/replay/clone/render checks and tactical trade-offs');
