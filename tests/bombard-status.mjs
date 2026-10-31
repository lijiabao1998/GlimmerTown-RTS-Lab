import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, hashWorld, ORD_FIRE_AT, ORD_IDLE, SHELL_SMOKE, SUB, bldAt, UNIT_KINDS } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { bombardStatus } from '../src/ui/bombardStatus.ts';
const w=createWorld(1944), selected=new Set([4]);
const u=w.units[3];
assert.match(bombardStatus(w,selected),/無進行中任務/);
const before=structuredClone(w);bombardStatus(w,selected);assert.deepEqual(w,before);
// Shape/eligibility cases exercise real Unit fields, never display-local counters.
u.order=ORD_FIRE_AT;u.target=4;
assert.match(bombardStatus(w,selected),/剩餘合計 4 發/);
u.target=1;assert.match(bombardStatus(w,selected),/剩餘合計 1 發/);
u.holdFire=1;u.path=[1];u.pathIdx=0;assert.match(bombardStatus(w,selected),/停火待命 1 門；行進中 1 門/);
u.target=0;u.fireAmmo=SHELL_SMOKE;assert.match(bombardStatus(w,selected),/收尾 1 門/);
const b=w.blds.find(b=>b.hp>0);u.tx=b.x;u.tz=b.z;delete u.fireAmmo;
assert.match(bombardStatus(w,selected),/建築目標 1 門/);
u.fireAmmo=SHELL_SMOKE;assert.match(bombardStatus(w,selected),/收尾/);delete u.fireAmmo;
u.order=ORD_IDLE;assert.match(bombardStatus(w,selected),/無進行中任務/);
for(const id of [5,9,999])assert.equal(bombardStatus(w,new Set([id])),'');
u.alive=false;assert.equal(bombardStatus(w,selected),'');u.alive=true;
assert.equal(bombardStatus(w,selected,false),'');assert.equal(bombardStatus(w,new Set()),'');
// Live simulation: choose a valid empty cell, hold before issuing, then release.
const live=createWorld(1944), gun=live.units[3];
let aim;
for(let z=0;z<live.n&&!aim;z++)for(let x=0;x<live.n;x++) {
 const d=Math.hypot((x+.5)*SUB-gun.x,(z+.5)*SUB-gun.z),k=UNIT_KINDS[gun.kind];
 if(d>k.minRange+SUB&&d<k.range-SUB&&!bldAt(live,x,z)){aim={x,z};break;}
}
assert(aim);
const log=[];const advance=(commands=[])=>{for(const cmd of commands)log.push({tick:live.tick,cmd});step(live,commands);};
advance([{t:'fireDiscipline',side:0,ids:[4],hold:true},{t:'fireAt',side:0,ids:[4],...aim}]);
assert.equal(gun.target,4);assert.match(bombardStatus(live,selected),/剩餘合計 4 發/);
for(let i=0;i<30;i++)advance();assert.equal(gun.target,4);
advance([{t:'fireDiscipline',side:0,ids:[4],hold:false}]);
assert.equal(gun.target,3);assert.match(bombardStatus(live,selected),/剩餘合計 3 發/);
let shots=1;while(gun.order===ORD_FIRE_AT&&live.tick<1000){const n=gun.target;advance();if(gun.order===ORD_FIRE_AT&&gun.target<n)shots++;const snapshot=structuredClone(live);bombardStatus(live,selected);assert.deepEqual(live,snapshot);}
assert.equal(shots,4);assert.equal(gun.order,ORD_IDLE);assert.match(bombardStatus(live,selected),/無進行中任務/);
assert.equal(hashWorld(live),hashWorld(runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),live.tick)));
const clone=structuredClone(live);step(clone,[]);advance();assert.equal(hashWorld(clone),hashWorld(live));
// Real source mutation: nominal count instead of remaining count must fail assertion.
let source=fs.readFileSync(new URL('../src/ui/bombardStatus.ts',import.meta.url),'utf8');
source=source.replace(/from '(\.\.\/sim\/[^']+)'/g,(_,p)=>`from '${new URL('../src/ui/'+p,import.meta.url).href}'`).replace('rounds += u.target','rounds += 4');
// Node strips TS from file modules, so use a temporary sibling .ts with guaranteed cleanup.
const mutant=new URL('../src/ui/.r145-negative.ts',import.meta.url);fs.writeFileSync(mutant,source);
try{const {bombardStatus:bad}=await import(mutant.href+'?negative');const m=createWorld(1944);m.units[3].order=ORD_FIRE_AT;m.units[3].target=1;assert.throws(()=>assert.match(bad(m,selected),/剩餘合計 1 發/),assert.AssertionError);}finally{fs.unlinkSync(mutant);}
console.log('OK R145 real remaining counts, eligibility, hold/release, completion, pure reads, JSON replay/clone and nominal-round negative');
