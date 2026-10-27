import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS, UK_OBSERVER, UK_TANK, UK_HOWITZER, SUB, center, cellOf, idx, ORD_IDLE } from '../src/sim/world.ts';
import { step, spotted, runLog } from '../src/sim/step.ts';
import { BattleView } from '../src/render/battle.ts';
const w = createWorld(1944), observerKind = UNIT_KINDS[UK_OBSERVER];
assert.deepEqual(w.units.filter(u => u.kind === UK_OBSERVER).map(u => [u.id,u.side]), [[9,0],[10,1]]);
assert(observerKind.sight > UNIT_KINDS[UK_TANK].sight);
assert(observerKind.hp < UNIT_KINDS[UK_HOWITZER].hp);
const blank = () => { const w = createWorld(1944); w.blds=[];w.occ.fill(0);w.shells=[];w.ter.fill(0); for(const u of w.units){u.alive=false;u.cooldown=10000;}w.winner=-1;return w; };
const activate = (w,id,x,z) => {const u=w.units[id-1];u.alive=true;u.x=center(x);u.z=center(z);u.hp=UNIT_KINDS[u.kind].hp;return u;};
const house = (w,x,z,bw=2,bd=2) => {const b={id:w.blds.length+1,kind:0,x,z,w:bw,d:bd,floors:1,hp:100,maxHp:100};w.blds.push(b);for(let dz=0;dz<bd;dz++)for(let dx=0;dx<bw;dx++)w.occ[idx(x+dx,z+dz)]=b.id;return b;};
const move = (u,x,z) => ({t:'move',side:u.side,ids:[u.id],x,z});
{
 const w=blank(),o=activate(w,9,3,4),t=activate(w,1,3,5);house(w,6,4);
 step(w,[move(o,7,4),move(t,7,5)]);for(let i=0;i<180;i++)step(w,[]);
 assert.equal(cellOf(o.x),7,'observer enters building');assert.equal(cellOf(o.z),4);
 assert.equal(w.occ[idx(cellOf(t.x),cellOf(t.z))],0,'tank cannot enter');
 t.alive=false;
 assert.equal(spotted(w,0,center(3),center(4)),true,'observer sees through own building interior');
 assert.equal(spotted(w,0,center(9),center(4)),true,'observer sees out of own building');
 house(w,9,4,1,1);
 assert.equal(spotted(w,0,center(10),center(4)),false,'other building blocks observer');
 o.alive=false;assert.equal(spotted(w,0,center(8),center(4)),false,'dead observer has no sight');o.alive=true;
 step(w,[move(o,4,4)]);for(let i=0;i<180;i++)step(w,[]);
 assert.equal(cellOf(o.x),4,'observer exits building');assert.equal(cellOf(o.z),4);
}
{
 const w=blank(),o=activate(w,9,3,3),t=activate(w,5,4,3);t.cooldown=10000;o.cooldown=0;
 step(w,[{t:'attack',side:0,ids:[9],target:5},{t:'fireAt',side:0,ids:[9],x:4,z:3}]);
 assert.equal(w.shells.length,0,'observer never shoots');assert.equal(o.order,ORD_IDLE);
}
{
 const hit = (covered,collapse=false) => {const w=blank(),o=activate(w,9,6,6);activate(w,5,4,6);let b;if(covered)b=house(w,6,6);if(collapse)b.hp=1;
 w.shells=[{id:1,side:1,kind:0,shooter:5,sx:center(4),sz:center(6),ex:o.x,ez:o.z,t:0,T:1,target:collapse?0:9,hitBld:collapse?b.id:0}];step(w,[]);return o;};
 assert.equal(hit(false).alive,false,'fragile outside cover');
 assert.equal(hit(true).hp,30-Math.floor(UNIT_KINDS[UK_TANK].dmgUnit/2),'cover halves damage');
 assert.equal(hit(true,true).hp,10,'collapse causes 20 damage after protection ends');
}
{
 const shot = visible => {const w=blank(),gun=activate(w,4,2,2);gun.cooldown=0; if(visible)activate(w,9,15,2);
 step(w,[{t:'fireAt',side:0,ids:[4],x:20,z:2}]);return w.shells[0];};
 const seen=shot(true),blind=shot(false),r=Math.floor(18*SUB/12);
 assert(seen && blind,'both accurate and blind fire still possible');
 assert(Math.abs(seen.ex-center(20))<=r && Math.abs(seen.ez-center(2))<=r,'spotted dispersion bound');
 assert(Math.abs(blind.ex-center(20))>r || Math.abs(blind.ez-center(2))>r,'fixed blind sample exceeds spotted bound');
}
{
 const log=[{tick:0,cmd:{t:'move',side:0,ids:[9],x:20,z:20}},{tick:50,cmd:{t:'move',side:1,ids:[10],x:12,z:12}}];
 const a=runLog(createWorld(1944),log,300),b=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),300);
 assert.equal(hashWorld(a),hashWorld(b),'observer command replay');
 const c=runLog(createWorld(1944),log,150),d=structuredClone(c);runLog(c,log,300);runLog(d,log,300);
 assert.equal(hashWorld(c),hashWorld(a));assert.equal(hashWorld(d),hashWorld(a));
 const h=hashWorld(a),v=new BattleView(a, { fx: false, fog: true, observerDetails: true }),off=new BattleView(a, { fx: false, fog: true, observerDetails: false });
 v.update(0,0,new Set([9]));off.update(0,0,new Set([9]));assert(v.observerMesh.count>=1);assert.equal(hashWorld(a),h,'detail valve is render-only');
 assert(v.observerMesh.geometry.attributes.position.count>off.observerMesh.geometry.attributes.position.count,'detail valve removes detail');v.dispose();off.dispose();
}
console.log('observer: spawn, sight, entry/exit, noncombat, cover/collapse, artillery, replay and render valve passed');

{
 const w=blank(),o=activate(w,9,6,6),b=house(w,6,6,1,1),v=new BattleView(w, { fx: false });
 assert(Math.abs(v.unitHeight(o)-0.78)<1e-5,'garrison marker feet meet actual house ridge');
 b.hp=70;v.onEvents([{e:'stage',bld:1,stage:1}],0);
 assert(v.unitHeight(o)<0.2,'roof loss moves marker to actual interior floor/beam');
 v.dispose();
}
