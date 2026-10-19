// R113：正式模型、實際BufferGeometry與BattleView整合；--mutations 每個語意負控制隔離子行程。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createWorld, hashWorld, N, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_MORTAR,
  UK_OBSERVER, SIDE_PLAYER, SIDE_ENEMY, ORD_IDLE, ORD_MOVE, ORD_ATTACK, ORD_FIRE_AT,
  SHELL_HE, SHELL_SMOKE, BK_HOUSE, center, idx,
} from '../src/sim/world.ts';
import { step, spotted } from '../src/sim/step.ts';
import { SMOKE_LIFETIME } from '../src/sim/smoke.ts';

const mutations = {
  armed_only_count: { group: 'selection', from: 'unit = u; count++;', to: 'if (UNIT_KINDS[u.kind].range > 0) { unit = u; count++; }', message: 'gun plus unarmed observer is still multiple selection' },
  exhausted_ground: { group: 'eligibility', from: '(unit.target <= 0 && (!bld || bld.hp <= 0))', to: '(unit.target < 0 && (!bld || bld.hp <= 0))', message: 'exhausted ground task has no scatter' },
  exclusive_max: { group: 'distance', from: 'if (d > k.range)', to: 'if (d >= k.range)', message: 'exact maximum integer distance is inclusive' },
  stale_calibration: { group: 'dispersion', from: 'r.x === unit.x && ', to: '', message: 'stale x cannot calibrate a new solution' },
  smoke_calibration: { group: 'dispersion', from: 'if (!smoke && r && ', to: 'if (r && ', message: 'smoke ignores stored HE calibration' },
  no_blind_double: { group: 'dispersion', from: 'if (s.blind) offset *= 2;', to: 'if (s.blind) offset *= 1;', message: 'true obscured spotting doubles calibrated scatter' },
  missing_diagonal_bound: { group: 'geometry', from: 's.scatterRadius = Math.SQRT2 * offset / SUB;', to: 's.scatterRadius = offset / SUB;', message: 'all analytic independent-axis corners fit inside the actual inner polygon' },
  inscribed_polygon: { group: 'geometry', from: '(s.scatterRadius + EDGE_MARGIN) / COS_HALF', to: '(s.scatterRadius + EDGE_MARGIN)', message: 'inner polygon sides conservatively contain the radial upper bound' },
  endpoint_bound: { group: 'endpoints', from: 's.scatterRadius = Math.SQRT2 * offset / SUB;', to: 's.scatterRadius = offset / SUB;', message: 'actual step endpoint must be inside scatter inner polygon' },
  clip_right: { group: 'clipping', from: ' || worldXZ.x > mapSize', to: '', message: 'fragment beyond right map edge must be discarded' },
  clamp_vertices: { group: 'clipping', from: 'this.positions[at] = x + COS[i] * r;', to: 'this.positions[at] = Math.max(0, Math.min(N, x + COS[i] * r));', message: 'ring vertices retain circular radii instead of false border chords' },
  world_write: { group: 'readonly_pool', from: 'const s = this.state;', to: 'const s = this.state; w.rng = (w.rng + 1) >>> 0;', message: 'preview preserves the complete World including events and RNG' },
  stale_draw: { group: 'readonly_pool', from: 'this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0);', to: 'this.mesh.visible = false;', message: 'invalid state clears the old circle draw range' },
  double_pass: { group: 'readonly_pool', from: 'material.forceSinglePass = true;', to: 'material.forceSinglePass = false;', message: 'transparent double-sided ring must use one draw pass' },
  integration_disable: { group: 'integration', file: 'battle', from: 'this.range113?.update(w, selected, showRanges);', to: 'this.range113?.update(w, selected, false);', message: 'BattleView updates the formal range overlay' },
};
const sourceURL = new URL('../src/render/rangePreview.ts', import.meta.url);
const source = fs.readFileSync(sourceURL, 'utf8');
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
const selectedGroup = process.env.R113_GROUP ?? (mutant ? mutations[mutant]?.group : undefined);
async function loadModule(url, mutation) {
  if (!mutation) return import(url.href);
  const original = fs.readFileSync(url, 'utf8');
  assert.equal(original.split(mutation.from).length - 1, 1, 'mutation must have a unique production source anchor');
  const changed = original.replace(mutation.from, mutation.to);
  const compiled = stripTypeScriptTypes(changed).replace(/from '([^']+)'/g, (_, spec) => `from '${spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec)}'`);
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
if (mutant) assert.ok(mutations[mutant], 'known mutant');
const m = mutations[mutant];
const { RangePreview, RANGE_SEGMENTS, RANGE_WIDTH } = await loadModule(sourceURL, m?.file ? undefined : m);
const { BattleView } = await loadModule(new URL('../src/render/battle.ts', import.meta.url), m?.file === 'battle' ? m : undefined);
let groups = 0;
function group(name, fn) {
  if (selectedGroup && selectedGroup !== name) return;
  try { fn(); groups++; console.log(`OK range-preview: ${name}`); }
  catch (error) { console.error(`NG range-preview: ${name}`); throw error; }
}
function addUnit(w, kind, x, z, side = SIDE_PLAYER) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, kind, x: center(x), z: center(z), side,
    hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0,
    path: [], pathIdx: 0, cooldown: 100000, aimX: SUB, aimZ: 0 };
  w.units.push(u); return u;
}
function fixture({ kind = UK_HOWITZER, seen = true, tx, tz = 3, x = 2, z = 3 } = {}) {
  const w = createWorld(1944);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.shells = [];
  w.events = []; w.winner = -1; w.tick = 100;
  const k = UNIT_KINDS[kind];
  tx ??= x + Math.floor((k.minRange + k.range) / (2 * SUB));
  const gun = addUnit(w, kind, x, z);
  gun.order = ORD_FIRE_AT; gun.tx = tx; gun.tz = tz; gun.target = 4;
  const observer = addUnit(w, UK_OBSERVER, tx, tz); observer.alive = seen;
  const enemy = addUnit(w, UK_OBSERVER, N - 1, N - 1, SIDE_ENEMY);
  return { w, gun, observer, enemy, selected: new Set([gun.id]), view: new RangePreview() };
}
function ranging(gun, seen) {
  gun.ranging = { x: gun.x, z: gun.z, ax: center(gun.tx), az: center(gun.tz), target: 0, epoch: 8, seen };
}
function building(w, x, z) {
  const b = { id: w.blds.length + 1, kind: BK_HOUSE, x, z, w: 1, d: 1, floors: 1, hp: 200, maxHp: 200 };
  w.blds.push(b); w.occ[idx(x, z)] = b.id; return b;
}
const refresh = f => f.view.update(f.w, f.selected);
function innerPolygon(view, slot = view.solution.count - 1) {
  const positions = view.mesh.geometry.attributes.position.array;
  const stride = 2 * (RANGE_SEGMENTS + 1) * 3, start = slot * stride;
  return Array.from({ length: RANGE_SEGMENTS }, (_, i) => [positions[start + i * 6], positions[start + i * 6 + 2]]);
}
function contains(poly, x, z) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-7) return false;
  }
  return true;
}
const snapshotGeometry = view => ({ indices: [...view.mesh.geometry.index.array], positions: [...view.mesh.geometry.attributes.position.array], colors: [...view.mesh.geometry.attributes.color.array], count: view.mesh.geometry.drawRange.count, visible: view.mesh.visible });
const clampSub = n => Math.max(0, Math.min(N * SUB - 1, n));

group('selection', () => {
  const f = fixture(), { view, w, gun, observer, enemy, selected } = f;
  assert.equal(refresh(f).count, 3, 'armed single selection has max/min/scatter circles');
  assert.equal(view.solution.range, UNIT_KINDS[gun.kind].range / SUB);
  assert.equal(view.solution.minRange, UNIT_KINDS[gun.kind].minRange / SUB);
  selected.add(observer.id);
  assert.equal(refresh(f).count, 0, 'gun plus unarmed observer is still multiple selection');
  assert.match(view.solution.legend, /單選/);
  selected.clear(); selected.add(observer.id); assert.equal(refresh(f).count, 0, 'unarmed selection has no circles');
  selected.clear(); selected.add(enemy.id); assert.equal(refresh(f).count, 0, 'enemy-only selection has no circles');
  selected.clear(); assert.equal(refresh(f).count, 0, 'empty selection has no circles');
  selected.add(gun.id); gun.alive = false; assert.equal(refresh(f).count, 0, 'dead selection has no circles');
  gun.alive = true; observer.alive = false; selected.add(observer.id);
  assert.equal(refresh(f).count, 3, 'stale dead selected ID does not count as a live friendly');
  assert.equal(view.update(w, selected, false).count, 0); assert.equal(view.solution.legend, '', 'build/disabled removes the legend');
  for (const [kind, k] of UNIT_KINDS.entries()) {
    gun.kind = kind; gun.order = ORD_IDLE;
    const s = refresh(f);
    assert.equal(s.count, k.range > 0 ? 1 + Number(k.minRange > 0) : 0, 'nominal rings derive from every weapon table row');
    if (k.range > 0) { assert.equal(s.range, k.range / SUB); assert.equal(s.minRange, k.minRange / SUB); }
  }
  view.dispose();
});

group('eligibility', () => {
  const f = fixture(), { gun, view, w } = f;
  gun.target = 0;
  assert.equal(refresh(f).count, 2, 'exhausted ground task has no scatter');
  assert.match(view.solution.legend, /失效/);
  const b = building(w, gun.tx, gun.tz);
  assert.equal(refresh(f).count, 3, 'standing building remains a valid HE task without ground rounds');
  b.hp = 0; assert.equal(refresh(f).count, 2, 'rubble cannot sustain an exhausted task');
  gun.target = 2; assert.equal(refresh(f).count, 3, 'positive remaining rounds can target rubble');
  gun.path = [idx(3, 3)]; gun.pathIdx = 0;
  assert.equal(refresh(f).count, 2, 'moving artillery never predicts a landing area'); assert.match(view.solution.legend, /移動/);
  gun.pathIdx = gun.path.length; assert.equal(refresh(f).count, 3, 'completed path is stationary');
  for (const order of [ORD_IDLE, ORD_MOVE, ORD_ATTACK]) { gun.order = order; assert.equal(refresh(f).count, 2, 'automatic and unit-target orders have no scatter prediction'); }
  gun.order = ORD_FIRE_AT; gun.target = 0; b.hp = 200; gun.fireAmmo = SHELL_SMOKE;
  assert.equal(refresh(f).count, 2, 'exhausted smoke does not inherit HE building persistence');
  gun.target = 1; assert.equal(refresh(f).count, 3, 'remaining smoke round can target a standing building');
  gun.tx = N; assert.equal(refresh(f).count, 2, 'out-of-map task has no scatter');
  gun.kind = UK_TANK; gun.tx = b.x;
  assert.equal(refresh(f).count, 1, 'direct fire only draws nominal maximum range'); assert.match(view.solution.legend, /直射/);
  view.dispose();
});

group('distance', () => {
  for (const kind of [UK_HOWITZER, UK_MORTAR]) {
    const f = fixture({ kind, tx: N - 2 }), { gun, view } = f, k = UNIT_KINDS[kind];
    const ax = center(gun.tx), az = center(gun.tz);
    gun.x = ax - k.range; gun.z = az;
    assert.equal(refresh(f).count, 3, 'exact maximum integer distance is inclusive');
    gun.z = az - 1;
    assert.ok(Math.hypot(ax - gun.x, az - gun.z) > k.range, 'fixture lies beyond the exact Euclidean radius');
    assert.equal(refresh(f).count, 3, 'floor integer distance, not floating distance, controls maximum eligibility');
    gun.z = az; gun.x--;
    assert.equal(refresh(f).reason, 'too-far', 'one integer unit beyond maximum is out');
    gun.x = ax - k.minRange;
    assert.equal(refresh(f).count, 3, 'exact minimum integer distance is inclusive');
    gun.x++;
    assert.equal(refresh(f).reason, 'too-near', 'one integer unit below minimum is out');
    view.dispose();
  }
});

group('dispersion', () => {
  const f = fixture(), { w, gun, view, observer } = f;
  const distance = Math.floor(Math.hypot(center(gun.tx) - gun.x, center(gun.tz) - gun.z));
  const raw = Math.floor(distance / 12);
  ranging(gun, 2); gun.ranging.x--;
  assert.equal(refresh(f).offset, raw, 'stale x cannot calibrate a new solution');
  for (const field of ['z', 'ax', 'az', 'target']) {
    ranging(gun, 2); gun.ranging[field]++;
    assert.equal(refresh(f).offset, raw, `stale ${field} cannot calibrate a new solution`);
  }
  for (const seen of [0, 1, 2, 5, 20]) {
    ranging(gun, seen); let expected = raw;
    for (let i = 0; i < seen; i++) expected = Math.max(1, Math.floor(expected / 2));
    assert.equal(refresh(f).offset, expected, 'observed HE uses sequential floor-halving with lower bound one');
  }
  ranging(gun, 3); gun.fireAmmo = SHELL_SMOKE;
  assert.equal(refresh(f).offset, raw, 'smoke ignores stored HE calibration');
  assert.equal(view.solution.ammo, SHELL_SMOKE); assert.match(view.solution.legend, /煙幕散布上界/);
  delete gun.fireAmmo; ranging(gun, 5);
  observer.alive = false;
  let reduced = raw; for (let i = 0; i < 5; i++) reduced = Math.max(1, Math.floor(reduced / 2));
  assert.equal(spotted(w, SIDE_PLAYER, center(gun.tx), center(gun.tz)), false);
  assert.equal(refresh(f).offset, reduced * 2, 'true obscured spotting doubles calibrated scatter');
  assert.equal(view.solution.blind, true); assert.match(view.solution.legend, /盲射/);
  observer.alive = true;
  w.smoke = { windX: 1, windZ: 0, clouds: [{ id: 1, side: 0, x: center(gun.tx), z: center(gun.tz), born: 0, expires: SMOKE_LIFETIME }] };
  assert.equal(refresh(f).offset, reduced * 2, 'real smoke occlusion is used even when a visual fog valve is off');
  delete w.smoke;
  assert.equal(refresh(f).offset, reduced, 'visibility updates at the same world tick');
  const before = structuredClone(view.solution), pending = [{ t: 'fireAt', side: 0, ids: [gun.id], x: gun.tx + 1, z: gun.tz, ammo: 'smoke' }];
  const toolbar = { ammo: 'smoke', pending }; toolbar.ammo = 'he';
  assert.deepEqual(refresh(f), before, 'toolbar/pending state cannot replace the applied world solution');
  assert.ok(!/機率|爆炸範圍|命中率/.test(view.solution.legend), 'legend must not describe scatter as probability or blast');
  view.dispose();
});

group('geometry', () => {
  for (const target of [[19, 3], [0, 0], [N - 1, N - 1]]) {
    const f = fixture({ tx: target[0], tz: target[1], x: target[0] === 19 ? 4 : 16, z: target[1] ? 16 : 0 }), { gun, view } = f;
    // 大多邊形與高度校準的小圈都必須包住解析方形的四角。
    for (const seen of [0, 1, 6, 20]) {
      ranging(gun, seen); refresh(f);
      assert.equal(view.solution.count, 3, 'geometry fixture is a valid three-circle solution');
      const d = Math.floor(Math.hypot(center(gun.tx) - gun.x, center(gun.tz) - gun.z));
      let independentOffset = Math.floor(d / 12);
      for (let i = 0; i < seen; i++) independentOffset = Math.max(1, Math.floor(independentOffset / 2));
      const polygon = innerPolygon(view);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = center(gun.tx) + sx * independentOffset, z = center(gun.tz) + sz * independentOffset;
        assert.ok(contains(polygon, x / SUB, z / SUB), 'all analytic independent-axis corners fit inside the actual inner polygon');
        assert.ok(contains(polygon, clampSub(x) / SUB, clampSub(z) / SUB), 'map-clamped scatter corners remain inside the same inner polygon');
      }
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length], dx = b[0] - a[0], dz = b[1] - a[1];
        const sideDistance = Math.abs(dx * (a[1] - center(gun.tz) / SUB) - dz * (a[0] - center(gun.tx) / SUB)) / Math.hypot(dx, dz);
        assert.ok(sideDistance >= Math.SQRT2 * independentOffset / SUB - 0.000002, 'inner polygon sides conservatively contain the radial upper bound');
      }
      const g = view.mesh.geometry, a = g.attributes.position.array;
      assert.equal(g.drawRange.count, 3 * 96 * 6); assert.equal(g.drawRange.count / 3, 576);
      assert.ok(g.index.array.every(i => i < g.attributes.position.count));
      assert.ok(a.every(Number.isFinite));
      for (let c = 0; c < 3; c++) {
        const base = c * 2 * (RANGE_SEGMENTS + 1) * 3;
        assert.ok(Math.abs(a[base] - a[base + RANGE_SEGMENTS * 6]) < 1e-6, 'ring closes without a seam');
        const width = Math.hypot(a[base + 3] - a[base], a[base + 5] - a[base + 2]);
        assert.ok(Math.abs(width - RANGE_WIDTH) < 0.00001, 'actual ring width matches the readable fixed cell width');
      }
    }
    view.dispose();
  }
});

group('endpoints', () => {
  let shots = 0;
  for (const smoke of [false, true]) for (const visible of [false, true]) for (const edge of [false, true]) {
    for (let seed = 1; seed <= 128; seed++) {
      const f = fixture({ tx: edge ? 0 : 19, tz: edge ? 0 : 3, x: edge ? 16 : 2, z: edge ? 0 : 3, seen: visible });
      const { w, gun, view } = f;
      w.rng = Math.imul(seed, 2654435761) >>> 0;
      gun.cooldown = 0; ranging(gun, seed % 3);
      if (smoke) gun.fireAmmo = SHELL_SMOKE;
      refresh(f); const polygon = innerPolygon(view);
      const before = structuredClone(w); step(w, []);
      const shell = w.shells.find(s => s.shooter === gun.id);
      assert.ok(shell, 'real simulation fixture must produce a shell'); shots++;
      assert.equal(shell.kind, smoke ? SHELL_SMOKE : SHELL_HE);
      assert.ok(contains(polygon, shell.ex / SUB, shell.ez / SUB), 'actual step endpoint must be inside scatter inner polygon');
      assert.ok(shell.ex >= 0 && shell.ex < N * SUB && shell.ez >= 0 && shell.ez < N * SUB);
      // 反向檢查正式step改動RNG，讓測試不會只驗到未發射的預覽資料。
      assert.notEqual(w.rng, before.rng, 'real shot consumes simulation RNG after the read-only preview');
      view.dispose();
    }
  }
  console.log(`  ${shots} actual HE/smoke, seen/blind, center/edge step endpoints`);
});

group('clipping', () => {
  const f = fixture({ x: 0, z: 0, tx: 18, tz: 0 }), { view } = f;
  refresh(f);
  const material = view.mesh.material;
  assert.equal(material.uniforms.mapSize.value, N);
  assert.match(material.vertexShader, /worldXZ\s*=\s*\(modelMatrix\s*\*\s*vec4\(position,\s*1\.0\)\)\.xz/, 'fragment clipping uses world-space map positions');
  const expression = material.fragmentShader.match(/if\s*\(([^;]+)\)\s*discard;/)?.[1];
  assert.ok(expression, 'actual fragment shader contains a map clip predicate');
  const discards = new Function('x', 'z', 'mapSize', `return ${expression.replaceAll('worldXZ.x', 'x').replaceAll('worldXZ.y', 'z')};`);
  assert.equal(discards(N + 0.001, N / 2, N), true, 'fragment beyond right map edge must be discarded');
  for (const [x, z] of [[-0.001, 1], [1, -0.001], [1, N + 0.001], [-1, N + 1]]) assert.equal(discards(x, z, N), true, 'every out-of-map side is clipped');
  for (const [x, z] of [[0, 0], [N, N], [N / 2, N / 2]]) assert.equal(discards(x, z, N), false, 'map interior/boundary is preserved');
  const p = view.mesh.geometry.attributes.position.array;
  const radius = UNIT_KINDS[UK_HOWITZER].range / SUB - RANGE_WIDTH / 2;
  for (let i = 0; i <= RANGE_SEGMENTS; i++) {
    assert.ok(Math.abs(Math.hypot(p[i * 6] - 0.5, p[i * 6 + 2] - 0.5) - radius) < 0.00001, 'ring vertices retain circular radii instead of false border chords');
  }
  assert.ok(p.some(n => n < 0), 'off-map geometry is discarded per fragment rather than turned into border lines');
  view.dispose();
});

group('readonly_pool', () => {
  const f = fixture(), { view, w, gun, selected } = f;
  w.events.push({ e: 'impact', kind: SHELL_HE, x: center(4), z: center(4), bld: 0 });
  const log = [{ tick: w.tick, cmd: { t: 'fireAt', side: 0, ids: [gun.id], x: gun.tx, z: gun.tz } }];
  const before = structuredClone(w), oldLog = structuredClone(log), oldHash = hashWorld(w);
  refresh(f);
  assert.deepEqual(w, before, 'preview preserves the complete World including events and RNG');
  assert.deepEqual(log, oldLog); assert.equal(hashWorld(w), oldHash);
  const geometry = view.mesh.geometry, position = geometry.attributes.position, color = geometry.attributes.color, index = geometry.index;
  const state = view.solution, drawn = snapshotGeometry(view);
  for (let i = 0; i < 40; i++) {
    assert.equal(refresh(f), state, 'solution object is reused');
    assert.equal(view.mesh.geometry, geometry); assert.equal(geometry.attributes.position, position);
    assert.equal(geometry.attributes.color, color); assert.equal(geometry.index, index);
  }
  assert.deepEqual(snapshotGeometry(view), drawn, 'same-world frame repetitions are exact');
  const fresh = new RangePreview(); fresh.update(w, selected);
  assert.deepEqual(snapshotGeometry(fresh), drawn, 'new renderer reconstructs exact geometry without event history');
  assert.deepEqual(fresh.solution, view.solution);
  assert.equal(view.mesh.castShadow, false); assert.equal(view.mesh.receiveShadow, false);
  assert.equal(view.mesh.material.forceSinglePass, true, 'transparent double-sided ring must use one draw pass');
  assert.equal(geometry.groups.length, 0, 'one material and no groups means one draw call');
  assert.equal(Array.isArray(view.mesh.material), false);
  selected.clear(); refresh(f);
  assert.equal(geometry.drawRange.count, 0, 'invalid state clears the old circle draw range'); assert.equal(view.mesh.visible, false);
  assert.equal(view.solution.scatterRadius, 0); assert.equal(view.solution.aimX, 0); assert.equal(view.solution.legend, '');
  selected.add(gun.id); refresh(f); view.update(w, selected, false);
  assert.equal(view.mesh.visible, false); assert.equal(geometry.drawRange.count, 0); assert.equal(view.solution.legend, '');
  assert.deepEqual(w, before, 'repeated renders/disabled state preserve all world fields');
  assert.ok(!/structuredClone|JSON\.parse|Math\.random|Date\.now|performance\.now|applyCommand|randSym/.test(source), 'production preview cannot clone worlds, consume RNG or issue commands');
  let disposedGeometry = 0, disposedMaterial = 0;
  geometry.addEventListener('dispose', () => disposedGeometry++); view.mesh.material.addEventListener('dispose', () => disposedMaterial++);
  view.dispose(); fresh.dispose(); assert.equal(disposedGeometry, 1); assert.equal(disposedMaterial, 1);
});

group('integration', () => {
  const f = fixture(), { w, selected, gun } = f;
  const view = new BattleView(w, true), off = new BattleView(w, true, true, true, true, true, true, true, true, true, true, false);
  const before = structuredClone(w);
  view.update(0, w.tick / 20, selected);
  assert.equal(view.range113?.solution.count, 3, 'BattleView updates the formal range overlay');
  assert.equal(view.rangeInfo, view.range113.solution.legend); assert.equal(view.range113.mesh.parent, view.scene);
  assert.equal(off.range113, null, 'noR113 omits the overlay mesh'); assert.equal(off.rangeInfo, '');
  const oldRings = view.rings.count, oldDashes = view.dash.count;
  off.update(0, w.tick / 20, selected);
  assert.equal(off.rings.count, oldRings, 'valve preserves old selected rings'); assert.equal(off.dash.count, oldDashes, 'valve preserves command route capacity');
  const geometry = snapshotGeometry(view.range113);
  view.update(0.9, 12345, selected);
  assert.deepEqual(snapshotGeometry(view.range113), geometry, 'alpha/display time cannot change the range solution');
  const noFog = new BattleView(w, true, false); noFog.update(0, 0, selected);
  assert.deepEqual(noFog.range113.solution, view.range113.solution, 'noR100 visual visibility cannot change true spotting scatter');
  gun.path = [idx(4, 4)]; view.update(0, 0, selected);
  assert.match(view.rangeInfo, /移動/, 'same-tick movement updates the legend without a one-second wait');
  gun.path = [];
  view.update(0, 0, selected, false); assert.equal(view.range113.mesh.visible, false); assert.equal(view.rangeInfo, '', 'build phase clears circles and legend');
  view.update(0, 0, selected); assert.equal(view.range113.solution.count, 3, 'returning to battle reconstructs the same circles');
  assert.deepEqual(w, before, 'BattleView overlay integration does not change the simulation');
  const sceneBudget = v => {
    let calls = 0, triangles = 0;
    v.scene.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const instances = o.isInstancedMesh ? o.count : 1; if (!instances) return;
      const g = o.geometry, n = Math.min(g.drawRange.count, g.index?.count ?? g.attributes.position.count), shadow = o.castShadow ? 2 : 1;
      calls += shadow; triangles += instances * n / 3 * shadow;
    });
    return { calls, triangles };
  };
  const onBudget = sceneBudget(view), offBudget = sceneBudget(off);
  assert.equal(onBudget.calls - offBudget.calls, 1); assert.equal(onBudget.triangles - offBudget.triangles, 576);
  assert.ok(onBudget.calls <= 22 && onBudget.triangles <= 80000, 'selected battle upper-bound budget remains unchanged');
  console.log(`  selected fixture structural upper bound ${onBudget.calls} calls / ${onBudget.triangles} triangles; actual GPU/browser verification is separate`);
  view.dispose(); off.dispose(); noFog.dispose(); f.view.dispose();
});

if (process.argv.includes('--mutations')) {
  for (const [name, mutation] of Object.entries(mutations)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 25000, env: { ...process.env, R113_GROUP: mutation.group } });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, `${name}: mutant must fail`);
    assert.match(output, /AssertionError/, `${name}: failure must be an assertion, not startup/import/syntax`);
    assert.ok(output.includes(`NG range-preview: ${mutation.group}`), `${name}: first red must be in its intended guard group`);
    assert.ok(output.includes(mutation.message), `${name}: first red must be the intended semantic assertion\n${output}`);
    console.log(`OK range-preview negative: ${name} → ${mutation.group}: ${mutation.message}`);
  }
}
assert.ok(groups > 0, 'at least one guard group must execute');
console.log(`range-preview: ${groups} groups OK`);
