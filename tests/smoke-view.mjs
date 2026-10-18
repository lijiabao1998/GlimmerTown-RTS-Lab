// R107：Node 場景守衛（不宣稱 WebGL 截圖／真機觸控）。每組可單獨執行，供隔離副本的負向突變驗證。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, hashWorld, SUB, N, idx, UNIT_KINDS, UK_TANK, BK_HOUSE, SHELL_HE, SHELL_SMOKE, SIDE_PLAYER } from '../src/sim/world.ts';
import { step, spotted, runLog } from '../src/sim/step.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';
import { SMOKE_CAP, SMOKE_RADIUS, SMOKE_LIFETIME } from '../src/sim/smoke.ts';
import { BattleView } from '../src/render/battle.ts';
import { SMOKE_PUFFS, smokeSurfaceVisible } from '../src/render/smoke.ts';

const selected = new Set();
const group = (name, fn) => {
  if (process.env.R107_VIEW_GROUP && process.env.R107_VIEW_GROUP !== name) return;
  try { fn(); console.log(`OK smoke-view: ${name}`); }
  catch (error) { console.error(`NG smoke-view: ${name}`); throw error; }
};
const view = (w, { fx = true, fog = true, r4 = true, r107 = true } = {}) => new BattleView(w, fx, fog, true, r4, true, true, true, true, true, r107);
const marker = v => {
  const mesh = v.puff?.mesh ?? v.fxMesh, n = v.smokeCounts.puffs;
  return { counts: v.smokeCounts, matrix: [...mesh.instanceMatrix.array.slice(0, n * 16)], colors: [...mesh.instanceColor.array.slice(0, n * 3)] };
};
function empty() {
  const w = createWorld(1944);
  w.blds = []; w.occ.fill(0); w.units = []; w.shells = []; w.events = []; w.tick = 100;
  return w;
}
const cloud = (id = 1, x = 12 * SUB, z = 10 * SUB) => ({ id, side: 0, x, z, born: 0, expires: SMOKE_LIFETIME });
const putClouds = (w, clouds) => { w.smoke = { windX: 1, windZ: 0, clouds }; };
function play(frames, r107 = true) {
  const w = createWorld(1944), v = view(w, { r107 }); let i = 0;
  while (w.tick < 600) {
    const commands = [];
    while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) commands.push(SCRIPT[i].cmd); i++; }
    v.snapshot(); step(w, commands); v.onEvents(w.events, w.tick / 20);
    for (let f = 0; f < frames; f++) v.update(f / frames, (w.tick + f / frames) / 20, selected);
  }
  v.update(0, 30, selected);
  return { w, v };
}

group('reconstruction', () => {
  const w = runScript(600), before = structuredClone(w), fresh = view(w);
  fresh.update(0, 30, selected);
  assert.ok(w.smoke.clouds.length > 0, 'script tick600 must contain live smoke');
  assert.ok(fresh.smokeCounts.clouds > 0, 'fresh view must reconstruct visible smoke without impact history');
  const once = marker(fresh);
  fresh.update(0.9, 30.045, selected); fresh.update(0, 30, selected);
  assert.deepEqual(marker(fresh), once, 'pause/alpha must not drift persistent smoke');
  assert.deepEqual(w, before, 'drawing must not mutate any world field or RNG');
  const a = play(1), b = play(3);
  assert.deepEqual(marker(a.v), once, 'incremental events and fresh view reconstruct the same marker');
  assert.deepEqual(marker(b.v), once, 'render frame rate must not alter smoke');
  assert.equal(hashWorld(a.w), hashWorld(w)); assert.equal(hashWorld(b.w), hashWorld(w));
  // 漂移只隨世界步進，不用畫面 dt 偷走一步。
  const x = w.smoke.clouds[0].x; fresh.snapshot(); step(w, []); fresh.update(0, w.tick / 20, selected);
  assert.equal(w.smoke.clouds[0].x - x, w.smoke.windX);
  assert.equal(marker(fresh).matrix[12], w.smoke.clouds[0].x / SUB);
  fresh.dispose(); a.v.dispose(); b.v.dispose();
});

group('valves', () => {
  const w = runScript(600), before = structuredClone(w), on = view(w), off = view(w, { r107: false }), old = view(w, { r4: false }), fxOff = view(w, { fx: false });
  for (const v of [on, off, old, fxOff]) v.update(0, 30, selected);
  assert.ok(on.smokeCounts.puffs > 0); assert.equal(off.smokeCounts.puffs, 0, 'noR107 must disable only new marker');
  assert.deepEqual(marker(old), marker(on), 'noR004 uses existing legacy mesh with identical smoke');
  assert.equal(fxOff.smokeCounts.puffs, 0, 'fx=off keeps effects disabled');
  assert.deepEqual(w, before, 'valves cannot change the world');
  const toggled = play(1, false); assert.equal(hashWorld(toggled.w), hashWorld(runLog(createWorld(1944), SCRIPT, 600)));
  for (const v of [on, off, old, fxOff, toggled.v]) v.dispose();
});

group('capacity', () => {
  const w = empty(); putClouds(w, Array.from({ length: SMOKE_CAP }, (_, i) => cloud(i + 1, (4 + i * 3) * SUB)));
  for (const r4 of [true, false]) {
    const clean = view(w, { fog: false, r4 }), busy = view(w, { fog: false, r4 });
    clean.update(0, 5, selected);
    // 兩條既有路徑都用實際爆炸事件灌滿，而非修改 pool 的容量或計數。
    for (let i = 0; i < 200; i++) busy.onEvents([{ e: 'impact', kind: SHELL_HE, x: 15 * SUB, z: 10 * SUB, bld: 0 }], 4.6);
    busy.update(0, 5, selected);
    assert.equal(busy.smokeCounts.clouds, SMOKE_CAP);
    assert.equal(busy.smokeCounts.puffs, SMOKE_CAP * SMOKE_PUFFS);
    assert.deepEqual(marker(busy), marker(clean), 'smoke must reserve first instances before full explosion pool');
    const mesh = busy.puff?.mesh ?? busy.fxMesh;
    assert.equal(mesh.count, mesh.instanceMatrix.count, 'stress fixture must actually saturate shared mesh');
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    assert.equal(triangles, 80); assert.equal(SMOKE_CAP * SMOKE_PUFFS * triangles, 3200);
    console.log(`  ${r4 ? 'puff' : 'legacy'} capacity ${mesh.count}; smoke 40 instances / 3200 triangles inside existing budget`);
    clean.dispose(); busy.dispose();
  }
});

group('fog', () => {
  const w = empty(), seed = createWorld(1944);
  const friendly = { ...seed.units[0], id: 1, x: 4 * SUB, z: 10 * SUB }, enemy = { ...seed.units[4], id: 2, x: 12 * SUB, z: 10 * SUB };
  w.units = [friendly, enemy]; const c = cloud(); putClouds(w, [c]);
  assert.equal(spotted(w, SIDE_PLAYER, c.x, c.z), false, 'cloud interior must block ordinary spotting');
  assert.equal(smokeSurfaceVisible(w, c), true, 'a visible smoke surface must not hide itself');
  const v = view(w); v.update(0, 5, selected);
  assert.equal(v.smokeCounts.clouds, 1); assert.equal(v.visibleUnit(enemy), false, 'surface exception must never reveal enemies');
  assert.equal(v.hull.count, 1, 'enemy mesh stays hidden');
  // 中心在視野外但最近表面在視野內，包括八方向之間的角度。
  const range = UNIT_KINDS[UK_TANK].sight, d = range + SMOKE_RADIUS - 8, angle = 0.19;
  c.x = friendly.x + Math.round(Math.cos(angle) * d); c.z = friendly.z + Math.round(Math.sin(angle) * d);
  assert.equal(spotted(w, SIDE_PLAYER, c.x, c.z, c.id), false);
  assert.equal(smokeSurfaceVisible(w, c), true, 'near surface at an arbitrary angle must remain visible');
  c.x = 12 * SUB; c.z = 10 * SUB;
  const blocker = cloud(2, 8 * SUB); w.smoke.clouds.unshift(blocker);
  assert.equal(smokeSurfaceVisible(w, c), false, 'other smoke must still occlude a rear cloud');
  v.update(0, 5, selected); assert.equal(v.smokeCounts.clouds, 1);
  w.smoke.clouds.shift();
  const wall = { id: 1, kind: BK_HOUSE, x: 8, z: 0, w: 1, d: N, floors: 1, hp: 100, maxHp: 100 }; w.blds = [wall];
  for (let z = 0; z < N; z++) w.occ[idx(8, z)] = 1;
  assert.equal(smokeSurfaceVisible(w, c), false, 'building wall must still occlude smoke');
  v.update(0, 5, selected); assert.equal(v.smokeCounts.puffs, 0);
  wall.hp = 0; assert.equal(smokeSurfaceVisible(w, c), true, 'rubble restores surface visibility');
  friendly.alive = false; v.update(0, 5, selected); assert.equal(v.smokeCounts.puffs, 0, 'no observers means no smoke cue');
  v.dispose();
});

group('trajectory', () => {
  for (const r4 of [true, false]) {
    const w = empty(), shell = { id: 1, side: 0, kind: SHELL_HE, shooter: 0, sx: 4 * SUB, sz: 10 * SUB, ex: 20 * SUB, ez: 10 * SUB, t: 5, T: 10, target: 0, hitBld: 0 };
    w.shells = [shell]; const v = view(w, { r4, fog: false });
    v.update(0, 5, selected); const high = [...v.shells.instanceMatrix.array.slice(0, 16)], color = [...v.shells.instanceColor.array.slice(0, 3)];
    assert.equal(high[13], Math.fround(0.3 + 16 * 0.22));
    shell.kind = SHELL_SMOKE; v.update(0, 5, selected);
    assert.deepEqual([...v.shells.instanceMatrix.array.slice(0, 16)], high, 'smoke follows HE arc, never AP straight line');
    assert.deepEqual([...v.shells.instanceColor.array.slice(0, 3)], color, 'smoke projectile is not an AP tracer');
    const before = structuredClone(w), shake = v.shakeT0;
    v.onEvents([{ e: 'impact', kind: SHELL_SMOKE, x: 20 * SUB, z: 10 * SUB, bld: 0 }], 5); v.update(0, 5.03, selected);
    assert.deepEqual(w, before); assert.equal(v.shakeT0, shake);
    assert.equal(v.fx.length, 0, 'legacy smoke landing must not spawn explosion');
    assert.equal(Object.values(v.pools).reduce((a, b) => a + b, 0), 0, 'smoke landing must not spawn sparks, shockwave, debris or blast puffs');
    assert.equal(v.holes.live.some(Boolean), false); v.dispose();
  }
});

group('lifecycle_budget', () => {
  const w = empty(), c = cloud(); putClouds(w, [c]);
  const on = view(w, { fog: false }), off = view(w, { fog: false, r107: false });
  const meshes = v => { const all = []; v.scene.traverse(o => { if (o.isMesh) all.push(o); }); return all; };
  assert.equal(meshes(on).length, meshes(off).length, 'R107 must not create any additional mesh/drawcall pool');
  w.tick = c.born - 1; on.update(0, 0, selected); assert.equal(on.smokeCounts.puffs, 0);
  w.tick = c.born; on.update(0, 0, selected); assert.equal(on.smokeCounts.puffs, SMOKE_PUFFS);
  w.tick = c.expires; on.update(0, 20, selected); assert.equal(on.smokeCounts.puffs, 0, 'expired smoke must disappear even before array cleanup');
  delete w.smoke; on.update(0, 0, selected); assert.equal(on.smokeCounts.puffs, 0, 'old worlds without smoke remain supported');
  const source = fs.readFileSync(new URL('../src/render/smoke.ts', import.meta.url), 'utf8');
  assert.ok(!/Math\.random|performance\.now|Date\.now|new Date\(/.test(source));
  const sample = view(runScript(600)); sample.update(0, 30, selected);
  let calls = 0, triangles = 0;
  for (const m of meshes(sample)) {
    if (!m.visible) continue;
    const n = m.isInstancedMesh ? m.count : 1; if (!n) continue;
    const g = m.geometry, count = Math.min(g.drawRange.count, g.index?.count ?? g.attributes.position.count), passes = m.castShadow ? 2 : 1;
    calls += passes; triangles += count / 3 * n * passes;
  }
  assert.ok(calls <= 22 && triangles <= 80000, 'conservative scene mesh/shadow count must stay in budget');
  console.log(`  tick600 structural upper bound ${calls} scene calls / ${triangles} triangles; actual WebGL stats remain CI-owned`);
  on.dispose(); off.dispose(); sample.dispose();
});

console.log('smoke-view: all OK');
