// R123: healthbars keep the R009 draw order and geometry while using one draw.
// Run --mutations for isolated, production-source negative controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createWorld, UNIT_KINDS, UK_TANK, SIDE_PLAYER, ORD_FIRE_AT, SUB } from '../src/sim/world.ts';
const url = new URL('../src/render/battle.ts', import.meta.url);
const source = fs.readFileSync(url, 'utf8');
const mutations = {
  extra_mesh: ['topology', 'if (!r123) { this.barFill', 'if (true) { this.barFill', 'batch owns only one healthbar mesh'],
  missing_matrices: ['overlap', 'bg.instanceMatrix.array.copyWithin(this.nb9 * 16, offset * 16, (offset + this.nf9) * 16);', 'void 0;', 'overlapping bars preserve background-then-fill matrices'],
  missing_colors: ['ghost', 'bg.instanceColor.array.copyWithin(this.nb9 * 3, offset * 3, (offset + this.nf9) * 3);', 'void 0;', 'damage ghosts preserve background-then-fill colors'],
  notch_removed: ['building', 'if (notch > 0 && this.nf9 < capF)', 'if (false && notch > 0 && this.nf9 < capF)', 'one targeted building adds one fill and one threshold notch'],
  dead_included: ['casualties', 'if (!u.alive || (u.hp >= max', 'if (false || (u.hp >= max', 'dead units have no healthbar'],
  ignored_r009: ['valves', 'if (r009) {', 'if (true) {', 'noR009 allocates no healthbar meshes'],
  stale_count: ['repeat', 'bg.count = this.nb9 + this.nf9;', 'bg.count = Math.max(bg.count, this.nb9 + this.nf9);', 'empty frames clear the physical batch count'],
  short_capacity: ['capacity', '(r123 ? 3 : 1) * (MAX_UNITS + 64)', '(r123 ? 2 : 1) * (MAX_UNITS + 64)', 'batch reserves backgrounds plus two fills per logical bar'],
  lost_dispose: ['disposal', 'this.scene.traverse(o => {', 'this.scene.traverse(o => { if (o === this.barBg) return;', 'batch mesh geometry and material are disposed exactly once'],
  world_write: ['readonly', 'this.nb9 = 0; this.nf9 = 0; dbg.n = 0;', 'this.w.rng ^= 1; this.nb9 = 0; this.nf9 = 0; dbg.n = 0;', 'healthbar updates preserve every World field'],
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
const selectedGroup = process.env.R123_BAR_GROUP;
async function load() {
  if (!mutant) return import(url.href);
  const [, from, to] = mutations[mutant];
  assert.equal(source.split(from).length, 2, `${mutant}: unique source anchor`);
  const js = stripTypeScriptTypes(source.replace(from, to)).replace(/from '([^']+)'/g, (_, spec) => `from '${spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec)}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { BattleView } = await load();
let groups = 0;
function group(name, fn) {
  if (selectedGroup && selectedGroup !== name) return;
  try { fn(); groups++; console.log(`OK healthbar-batch: ${name}`); }
  catch (e) { console.error(`FIRST_BAR_FAILURE=${JSON.stringify({ group: name, name: e.name, message: e.message.split('\n')[0] })}`); throw e; }
}
function fixture(n = 2, options = {}) {
  const w = createWorld(1944), template = w.units.find(u => u.kind === UK_TANK && u.side === SIDE_PLAYER);
  w.units = Array.from({ length: n }, (_, i) => ({ ...structuredClone(template), id: i + 1, x: 8 * SUB, z: 8 * SUB, hp: UNIT_KINDS[UK_TANK].hp }));
  const oldWorld = structuredClone(w);
  const make = (world, enabled) => new BattleView(world, options.fx ?? true, false, true, false, false, options.r009 ?? true, false, false, false, false, false, false, false, enabled);
  const batch = make(w, true), old = make(oldWorld, false), selected = new Set(w.units.map(u => u.id));
  return { w, oldWorld, batch, old, selected, update(t = 1) { batch.update(1, t, selected, false); old.update(1, t, selected, false); }, both(fn) { fn(w); fn(oldWorld); }, dispose() { batch.dispose(); old.dispose(); } };
}
const array = (mesh, key, n = mesh.count) => Array.from(mesh[key].array.subarray(0, n * (key === 'instanceMatrix' ? 16 : 3)));
function compare(f, label) {
  assert.deepEqual(array(f.batch.barBg, 'instanceMatrix'), [...array(f.old.barBg, 'instanceMatrix'), ...array(f.old.barFill, 'instanceMatrix')], `${label} preserve background-then-fill matrices`);
  assert.deepEqual(array(f.batch.barBg, 'instanceColor'), [...array(f.old.barBg, 'instanceColor'), ...array(f.old.barFill, 'instanceColor')], `${label} preserve background-then-fill colors`);
  assert.deepEqual(f.batch.bars, f.old.bars, `${label}: logical counts match old renderer`);
  for (const key of ['id', 'frac', 'ghost', 'r', 'g']) assert.deepEqual(Array.from(f.batch.barDbg[key].subarray(0, f.batch.barDbg.n)), Array.from(f.old.barDbg[key].subarray(0, f.old.barDbg.n)), `${label}: debug ${key}`);
  assert.equal(f.batch.barDbg.n, f.old.barDbg.n);
}
function length(mesh, index) { const a = mesh.instanceMatrix.array, i = index * 16; return Math.hypot(a[i], a[i + 1], a[i + 2]); }
function close(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} versus ${expected}`); }

group('topology', () => {
  const f = fixture();
  try {
    assert.ok(f.batch.barFill === null, 'batch owns only one healthbar mesh');
    assert.ok(f.old.barFill?.isInstancedMesh, 'noR123 restores the old second mesh');
    assert.ok(f.batch.scene.children.includes(f.batch.barBg));
    assert.ok(f.old.scene.children.includes(f.old.barFill));
    for (const mesh of [f.batch.barBg, f.old.barBg, f.old.barFill]) {
      assert.equal(mesh.material.depthTest, false); assert.equal(mesh.material.depthWrite, false); assert.equal(mesh.material.toneMapped, false);
      assert.equal(mesh.castShadow, false);
    }
    assert.equal(f.batch.barBg.renderOrder, f.old.barBg.renderOrder);
    assert.ok(f.old.barFill.renderOrder > f.old.barBg.renderOrder);
    f.update(); assert.deepEqual(f.batch.bars, { bg: 2, fill: 2 }); assert.equal(f.batch.barBg.count, 4);
  } finally { f.dispose(); }
});
group('overlap', () => {
  const f = fixture();
  try {
    f.both(w => { w.units[1].hp = Math.floor(UNIT_KINDS[UK_TANK].hp / 2); }); f.update(1); f.update(1.6); compare(f, 'overlapping bars');
    assert.deepEqual(f.batch.bars, { bg: 2, fill: 2 });
    close(length(f.batch.barBg, 0), 0.54, 'first dark background width'); close(length(f.batch.barBg, 1), 0.54, 'second dark background precedes fills');
    close(length(f.batch.barBg, 2), 0.5, 'full health fill width');
    close(length(f.batch.barBg, 3), 0.5 * f.w.units[1].hp / UNIT_KINDS[UK_TANK].hp, 'fractional health fill width');
  } finally { f.dispose(); }
});
group('ghost', () => {
  const f = fixture();
  try {
    f.update(1); f.both(w => { w.units[0].hp = Math.floor(UNIT_KINDS[UK_TANK].hp / 4); }); f.update(2); compare(f, 'damage ghosts');
    assert.deepEqual(f.batch.bars, { bg: 2, fill: 3 });
    assert.deepEqual(array(f.batch.barBg, 'instanceColor').slice(6, 9), [1, 1, 1], 'ghost white precedes damaged color');
    close(length(f.batch.barBg, 2), 0.5, 'ghost initially retains pre-hit width');
    f.update(2.25); compare(f, 'decaying ghosts');
    assert.ok(f.batch.barDbg.ghost[0] > f.batch.barDbg.frac[0] && f.batch.barDbg.ghost[0] < 1);
    f.update(2.6); compare(f, 'expired ghosts'); assert.deepEqual(f.batch.bars, { bg: 2, fill: 2 });
  } finally { f.dispose(); }
});
group('building', () => {
  const f = fixture();
  try {
    f.both(w => { const b = w.blds.find(b => b.w === 1 && b.d === 1); b.hp = Math.floor(b.maxHp * 0.6); for (const u of w.units) { u.order = ORD_FIRE_AT; u.target = 0; u.tx = b.x; u.tz = b.z; } });
    f.selected.clear(); f.update();
    assert.deepEqual(f.batch.bars, { bg: 1, fill: 2 }, 'one targeted building adds one fill and one threshold notch');
    compare(f, 'building notch'); assert.ok(f.batch.barDbg.id[0] < 0);
    close(length(f.batch.barBg, 2), 0.025, 'threshold notch width stays unchanged');
    const a = f.batch.barBg.instanceMatrix.array;
    close(Math.hypot(a[44] - a[28], a[45] - a[29], a[46] - a[30]), 0.75 * 0.7, 'threshold notch stays at seventy percent');
    f.both(w => { w.blds[-f.batch.barDbg.id[0] - 1].hp = 0; }); f.update(); assert.deepEqual(f.batch.bars, { bg: 0, fill: 0 });
  } finally { f.dispose(); }
});
group('casualties', () => {
  const f = fixture();
  try {
    f.update(); f.both(w => { w.units[0].alive = false; w.units[0].hp = 0; }); f.update(2);
    assert.equal(f.batch.barDbg.n, 1, 'dead units have no healthbar');
    assert.equal(f.batch.barDbg.id[0], 2); compare(f, 'casualties');
    f.both(w => { w.units = []; }); f.update(3); compare(f, 'removed units'); assert.equal(f.batch.barBg.count, 0);
  } finally { f.dispose(); }
});
group('valves', () => {
  const off = fixture(2, { r009: false }), fxOff = fixture(2, { fx: false });
  try {
    assert.ok(off.batch.barBg === null, 'noR009 allocates no healthbar meshes'); assert.equal(off.batch.barFill, null); assert.equal(off.old.barBg, null); assert.equal(off.old.barFill, null);
    off.update(); assert.deepEqual(off.batch.bars, { bg: 0, fill: 0 });
    fxOff.update(); assert.deepEqual(fxOff.batch.bars, { bg: 2, fill: 2 }, 'fx off preserves existing healthbar information'); compare(fxOff, 'fx off');
  } finally { off.dispose(); fxOff.dispose(); }
});
group('repeat', () => {
  const f = fixture();
  try {
    f.update(); f.selected.clear(); f.update(); assert.equal(f.batch.barBg.count, 0, 'empty frames clear the physical batch count');
    f.selected.add(2); f.update(); compare(f, 'reselected bars');
    const before = array(f.batch.barBg, 'instanceMatrix'); const buffers = [f.batch.barBg.instanceMatrix.array, f.batch.barBg.instanceColor.array];
    for (let i = 0; i < 12; i++) { f.update(); compare(f, 'paused frames'); }
    assert.deepEqual(array(f.batch.barBg, 'instanceMatrix'), before);
    assert.equal(f.batch.barBg.instanceMatrix.array, buffers[0]); assert.equal(f.batch.barBg.instanceColor.array, buffers[1]);
    f.both(w => { for (const u of w.units) u.hp = 0; }); f.update(3); f.update(3.6);
    assert.deepEqual(f.batch.bars, { bg: 2, fill: 0 }, 'zero fill compaction retains only current backgrounds');
    assert.equal(f.batch.barBg.count, 2); compare(f, 'zero fill frames');
  } finally { f.dispose(); }
});
group('capacity', () => {
  const f = fixture(400);
  try {
    const cap = f.batch.barDbg.id.length;
    assert.equal(f.batch.barBg.instanceMatrix.count, cap * 3, 'batch reserves backgrounds plus two fills per logical bar');
    f.update(1); f.both(w => { for (const u of w.units) u.hp = Math.floor(UNIT_KINDS[UK_TANK].hp / 2); }); f.update(2);
    assert.deepEqual(f.batch.bars, { bg: 400, fill: 800 }); compare(f, 'overlapping staging ranges');
    // Stress the bounded writer separately from the simulation's unit limit.
    for (const v of [f.batch, f.old]) {
      v.nb9 = 0; v.nf9 = 0; v.barDbg.n = 0;
      for (let i = 0; i < cap + 9; i++) v.bar9(i, i, 1, 0, 0.5, 0.4, 1, new THREE.Color(0xff0000), 0);
      assert.equal(v.nb9, cap); assert.equal(v.nf9, cap * 2); assert.equal(v.barDbg.n, cap);
    }
    assert.deepEqual(Array.from(f.batch.barBg.instanceMatrix.array.subarray(cap * 16)), Array.from(f.old.barFill.instanceMatrix.array), 'full staging capacity retains every fill matrix');
    assert.deepEqual(Array.from(f.batch.barBg.instanceColor.array.subarray(cap * 3)), Array.from(f.old.barFill.instanceColor.array), 'full staging capacity retains every fill color');
  } finally { f.dispose(); }
});
group('disposal', () => {
  const f = fixture(); const counts = [0, 0, 0];
  [f.batch.barBg, f.batch.barBg.geometry, f.batch.barBg.material].forEach((resource, i) => resource.addEventListener('dispose', () => counts[i]++));
  f.update(); f.dispose();
  assert.deepEqual(counts, [1, 1, 1], 'batch mesh geometry and material are disposed exactly once');
});
group('readonly', () => {
  const f = fixture();
  try { const before = structuredClone(f.w), selected = [...f.selected]; f.update(); assert.deepEqual(f.w, before, 'healthbar updates preserve every World field'); assert.deepEqual([...f.selected], selected); }
  finally { f.dispose(); }
});
if (process.argv.includes('--mutations')) {
  assert.equal(new Set(Object.values(mutations).map(m => m[0])).size, groups, 'every guard group has a negative control');
  for (const [name, [group, , , message]] of Object.entries(mutations)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 30000, env: { ...process.env, R123_BAR_GROUP: group } });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0, `${name} must fail`);
    const first = `${result.stdout}\n${result.stderr}`.match(/^FIRST_BAR_FAILURE=(.*)$/m);
    assert.ok(first, `${name} must fail inside semantic guard, not import or syntax: ${result.stderr.slice(0, 2000)}`);
    assert.deepEqual(JSON.parse(first[1]), { group, name: 'AssertionError', message }, `${name} fails first at intended guard`);
    console.log(`OK healthbar-batch negative: ${name} → ${group}`);
  }
}
assert.ok(groups > 0); console.log(`healthbar-batch: ${groups} groups OK`);
