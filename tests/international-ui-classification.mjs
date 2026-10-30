import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createWorld, hashWorld, UNIT_KINDS, ORD_FIRE_AT } from '../src/sim/world.ts';
import { runScript } from '../src/sim/script.ts';
import { newStats, makeReport } from '../src/ui/report.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
import { coverDurability } from '../src/ui/coverDurability.ts';
const kinds = [23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40]; // independent expected roster
function fixture(kind, side = 0, cooldown = 0) {
  const w = createWorld(1944);
  w.units = [{ ...structuredClone(w.units[0]), id: 1, kind, side, alive: true, hp: UNIT_KINDS[kind].hp, cooldown }];
  return w;
}
function reportChecks(stats, report) {
  for (const kind of kinds) for (const side of [0,1]) {
    const w = fixture(kind, side), before = JSON.stringify(w), st = stats(w);
    const expected = ![28,34,40].includes(kind) ? [1,0,0,0] : [0,1,0,0];
    assert.deepEqual(st.start[side], expected, `kind ${kind} side ${side} counted once in correct column`);
    assert.deepEqual(report(w,st).left[side], expected);
    assert.equal(JSON.stringify(w), before, 'report reads without changing world');
    w.units[0].alive = false;
    const dead = report(w,st);
    assert.deepEqual(dead.left[side], [0,0,0,0]);
    assert.equal(dead.kills, side === 1 ? 1 : 0);
    assert.equal(dead.lost, side === 0 ? 1 : 0);
  }
}
const ready = '裝填完成 1／裝填中 0；裝填完成不代表可射擊';
function reloadChecks(reload) {
  for (const kind of kinds) {
    const w = fixture(kind), selected = new Set([1]);
    assert.equal(reload(w,selected),ready,`kind ${kind} ready`);
    w.units[0].cooldown = 21;
    assert.equal(reload(w,selected),'裝填完成 0／裝填中 1；剩餘 1.1 模擬秒；裝填完成不代表可射擊',`kind ${kind} loading`);
    const before=JSON.stringify(w);
    assert.equal(reload(w,selected,false),'');
    assert.equal(reload(w,new Set()),'');
    assert.equal(JSON.stringify(w),before); assert.deepEqual([...selected],[1]);
    w.units[0].alive=false;assert.equal(reload(w,selected),'');
    w.units[0].alive=true;w.units[0].side=1;assert.equal(reload(w,selected),'');
  }
  const w=fixture(28);w.units.push({...structuredClone(w.units[0]),id:2,kind:34,cooldown:40});
  assert.equal(reload(w,new Set([1,2])),'裝填完成 1／裝填中 1；剩餘 2.0 模擬秒；裝填完成不代表可射擊');
}
reportChecks(newStats,makeReport); reloadChecks(reloadStatus);
assert.equal(hashWorld(runScript()),'eea1d59b');
// Restore each original bug only in memory: new guards must reject both.
async function mutant(file,from,to) {
  const url=new URL(`../src/ui/${file}.ts`,import.meta.url), source=fs.readFileSync(url,'utf8');
  assert.equal(source.split(from).length-1,1,'unique negative-control anchor');
  const changed=source.replace(from,to).replace('../sim/world.ts',new URL('../src/sim/world.ts',import.meta.url).href);
  return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(changed)).toString('base64'));
}
const badReport=await mutant('report','INTERNATIONAL_KINDS.includes(kind)', 'false');
assert.throws(()=>reportChecks(badReport.newStats,badReport.makeReport),/counted once in correct column/);
const badReload=await mutant('reloadStatus','!INTERNATIONAL_KINDS.includes(u.kind) && ', '');
assert.throws(()=>reloadChecks(badReload.reloadStatus),/kind 28 ready/);
console.log('OK international UI: 36 side/kind report cases, 18 reload kinds, mixed guns, readonly state, legacy hash; both old bugs rejected');

function coverChecks(read) {
  for (const kind of [21,22,...kinds]) {
    const w=fixture(kind), b=w.blds.find(b=>b.hp>0);
    Object.assign(w.units[0],{order:ORD_FIRE_AT,target:0,tx:b.x,tz:b.z});
    const selected=new Set([1]), before=JSON.stringify(w);
    const value=read(w,selected);
    assert.ok(value.includes(`#${b.id}(${b.x},${b.z})`) && value.includes(`${b.hp}/${b.maxHp}`),`kind ${kind} building target durability`);
    assert.equal(JSON.stringify(w),before);assert.deepEqual([...selected],[1]);
    assert.equal(read(w,selected,false),'');assert.equal(read(w,new Set()),'');
    w.units[0].alive=false;assert.equal(read(w,selected),'');
    w.units[0].alive=true;w.units[0].side=1;assert.equal(read(w,selected),'');
  }
}
coverChecks(coverDurability);
const badCover=await mutant('coverDurability',' && !INTERNATIONAL_KINDS.includes(u.kind) && !SOVIET_KINDS.includes(u.kind)','');
assert.throws(()=>coverChecks(badCover.coverDurability),/kind 21 building target durability/);
console.log('OK international/Soviet cover target: 20 kinds, visibility filters, readonly state and omitted-gun negative control');
const badInternationalCover=await mutant('coverDurability',' && !INTERNATIONAL_KINDS.includes(u.kind)','');
assert.throws(()=>coverChecks(badInternationalCover.coverDurability),/kind 28 building target durability/);
