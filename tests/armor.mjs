// R104：面向、命中、主動移動／碰撞、舊世界、重播、選取提示；每組都可獨立紅燈。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld, hashWorld, center, SUB, UNIT_KINDS, UK_TANK, UK_HEAVY, UK_LIGHT, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, SHELL_AP, SHELL_HE, SHELL_SMALL, ORD_IDLE } from '../src/sim/world.ts';
import { armorPct } from '../src/sim/armor.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { ecoStep } from '../src/sim/eco.ts';
import { BattleView } from '../src/render/battle.ts';
const check = (ok, name) => { assert.ok(ok, name); console.log(`OK armor: ${name}`); };
const blank = () => { const w = createWorld(1944); w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.shells = []; return w; };
const add = (w, side, kind, x, z, hullX = SUB, hullZ = 0) => { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 100000, aimX: SUB, aimZ: 0, hullX, hullZ }; w.units.push(u); return u; };
{
  const w = blank(), u = add(w, 1, UK_TANK, 15, 15);
  for (const [hx,hz] of [[1,0],[0,1],[-1,0],[0,-1]]) {
    u.hullX = hx * SUB; u.hullZ = hz * SUB;
    const at = (f,s) => armorPct(u, u.x + (hx*f-hz*s)*SUB, u.z + (hz*f+hx*s)*SUB);
    assert.deepEqual([at(3,0),at(0,3),at(-3,0),at(3,3),at(-3,3),at(2,3),at(-2,-3)], [75,100,125,75,125,100,100]);
  }
  u.hullX = SUB; u.hullZ = SUB;
  assert.deepEqual([armorPct(u,u.x+SUB,u.z),armorPct(u,u.x,u.z+SUB),armorPct(u,u.x-SUB,u.z),armorPct(u,u.x,u.z-SUB)], [75,75,125,125]);
  assert.equal(armorPct(u,u.x,u.z),100);
  delete u.hullX; delete u.hullZ; assert.equal(armorPct(u,u.x+SUB,u.z),100);
  check(true, '整數錐體四向、對角、邊界對稱；零距離與舊世界中性');
}
const hit = (kind, shellKind, dx, dz, targetKind=UK_TANK) => {
  const w=blank(), a=add(w,0,kind,15+dx,15+dz), b=add(w,1,targetKind,15,15), hp=b.hp;
  w.shells=[{id:1,side:0,kind:shellKind,shooter:a.id,sx:a.x,sz:a.z,ex:b.x,ez:b.z,t:0,T:1,target:b.id,hitBld:0}]; step(w,[]); return hp-b.hp;
};
{
  const d=UNIT_KINDS[UK_TANK].dmgUnit;
  for(const kind of [UK_LIGHT,UK_TANK,UK_HEAVY]) {
    const got=[[3,0],[0,3],[-3,0]].map(([x,z])=>hit(UK_TANK,SHELL_AP,x,z,kind));
    assert.deepEqual(got,[75,100,125].map(p=>Math.floor(Math.floor(d*p/100)*UNIT_KINDS[kind].armor/100)));
    console.log(`armor damage kind ${kind}: ${got.join('/')}`);
  }
  assert.equal(hit(UK_LIGHT,SHELL_AP,-3,0),21); // 先 floor(24×125%)，再穿甲 70%；反過來會是 20
  const soft=[[3,0],[0,3],[-3,0]].map(([x,z])=>hit(UK_TANK,SHELL_AP,x,z,UK_HOWITZER));
  assert.deepEqual(soft,[d,d,d]);
  for (const [kind,sh] of [[UK_HOWITZER,SHELL_HE],[UK_INFANTRY,SHELL_SMALL]]) {
    const got=[[3,0],[0,3],[-3,0]].map(([x,z])=>hit(kind,sh,x,z));
    assert.equal(new Set(got).size,1);
  }
  check(true,'穿甲 75/100/125%；輕中重既有裝甲相乘；軟目標／高爆／步槍不套面向');
}
{
  const w=blank(), a=add(w,0,UK_TANK,8,8), b=add(w,0,UK_TANK,8,8);
  step(w,[]); assert.deepEqual([a.hullX,a.hullZ],[SUB,0]);
  assert.ok(a.x!==center(8)||a.z!==center(8));
  a.aimX=-SUB; a.aimZ=-SUB; step(w,[]); assert.deepEqual([a.hullX,a.hullZ],[SUB,0]);
  b.alive=false; const oldX=a.x,oldZ=a.z;
  step(w,[{t:'move',side:0,ids:[a.id],x:8,z:12}]);
  assert.deepEqual([a.hullX,a.hullZ],[a.x-oldX,a.z-oldZ]);
  const h=[a.hullX,a.hullZ]; step(w,[{t:'stop',side:0,ids:[a.id]}]); assert.deepEqual([a.hullX,a.hullZ],h);
  delete a.hullX; delete a.hullZ; step(w,[{t:'move',side:0,ids:[a.id],x:11,z:8}]); assert.ok(a.hullX||a.hullZ);
  check(true,'碰撞、瞄準、停車不改朝向；主動位移更新，舊世界移動後取得朝向');
}
{
  const w=createWorld(1944);
  assert.ok(w.units.filter(u=>UNIT_KINDS[u.kind].armored).every(u=>Number.isInteger(u.hullX)&&Number.isInteger(u.hullZ)&&(u.hullX||u.hullZ)));
  step(w,[{t:'eco',tanks:1}]);
  for (const kind of [UK_LIGHT,UK_TANK,UK_HEAVY]) {
    w.eco.supply[0]=1000; const n=w.units.length; step(w,[{t:'produce',side:0,kind}]);
    for(let i=0;i<UNIT_KINDS[kind].buildTicks+5 && w.units.length===n;i++) { ecoStep(w); w.tick++; }
    const u=w.units[n]; assert.ok(u&&u.kind===kind&&Number.isInteger(u.hullX)&&Number.isInteger(u.hullZ)&&(u.hullX||u.hullZ));
  }
  check(true,'新建與生產的輕中重坦克都有整數車體朝向');
}
{
  const a=runLog(createWorld(1944),SCRIPT,1200), b=runLog(createWorld(1944),JSON.parse(JSON.stringify(SCRIPT)),1200);
  const half=runLog(createWorld(1944),SCRIPT,600), copy=structuredClone(half); runLog(half,SCRIPT,1200); runLog(copy,SCRIPT,1200);
  assert.deepEqual([hashWorld(a),hashWorld(b),hashWorld(half),hashWorld(copy)],Array(4).fill(hashWorld(a)));
  const old=hashWorld(a); a.units[0].hullX=(a.units[0].hullX??0)+1; assert.notEqual(hashWorld(a),old);
  console.log(`armor replay ${hashWorld(b)}`);
  check(true,'原指令 JSON／重跑／深拷貝一致，車體方向折進雜湊');
}
{
  const w=blank(), a=add(w,0,UK_TANK,8,8), b=add(w,1,UK_TANK,9,8), c=add(w,0,UK_OBSERVER,7,8);
  const sel=new Set([a.id,b.id,c.id]), before=hashWorld(w), on=new BattleView(w,true), off=new BattleView(w,true,true,true,true,true,true,true,true,true,false), fxoff=new BattleView(w,false);
  for (const v of [on,off,fxoff]) v.update(0,0,sel);
  assert.equal(on.armorArcCount,2); assert.equal(off.armorArcCount,0); assert.equal(fxoff.armorArcCount,0);
  const m=new THREE.Matrix4(); on.armorArcs.getMatrixAt(0,m); const p=m.elements;
  assert.ok(Math.abs(p[0]-1)<1e-6&&Math.abs(p[2])<1e-6);
  const count=on.scene.children.length; a.aimX=0;a.aimZ=SUB; const beforeTurn=hashWorld(w); on.update(0,1,sel); assert.equal(hashWorld(w),beforeTurn);
  on.armorArcs.getMatrixAt(0,m); assert.ok(Math.abs(m.elements[0]-1)<1e-6); assert.equal(on.scene.children.length,count);
  a.aimX=SUB;a.aimZ=0; assert.equal(hashWorld(w),before);
  for (const [hx,hz,cx,sz] of [[0,SUB,0,1],[-SUB,0,-1,0]]) {
    a.hullX=hx; a.hullZ=hz; a.aimX=SUB; a.aimZ=0; on.update(0,2,sel);
    for (const [mesh,index,sign] of [[on.hull,0,1],[on.armorArcs,0,1],[on.armorArcs,1,-1]]) {
      mesh.getMatrixAt(index,m); assert.ok(Math.abs(m.elements[0]-cx*sign)<1e-6&&Math.abs(m.elements[2]-sz*sign)<1e-6);
    }
  }
  on.update(0,1,new Set()); assert.equal(on.armorArcCount,0);
  for(const v of [on,off,fxoff])v.dispose();
  check(true,'只提示選取的我方裝甲，跟車體不跟砲塔；逃生閥與 fx off 關閉、畫面不改世界');
}
console.log('armor: all OK');
