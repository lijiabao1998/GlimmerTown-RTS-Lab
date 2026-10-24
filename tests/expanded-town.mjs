import assert from 'node:assert/strict';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, TER_ROAD, TER_MUD, UK_INFANTRY } from '../src/sim/world.ts';
import { applyMap } from '../src/sim/maps.ts';
import { MAP_TOWN, TOWN_N, TOWN_CENTRE, inTownSpawn } from '../src/sim/expandedMap.ts';
import { findPath } from '../src/sim/path.ts';
import { step, runLog } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
import { buildTown } from '../src/render/buildings.ts';
import { startOrderText } from '../src/ui/startOrder.ts';
const make = (seed = 1944) => { const w = createWorld(seed); applyMap(w, MAP_TOWN, 1); return w; };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
const only = process.argv.find(x => x.startsWith('--group='))?.split('=')[1];
const group = (name, fn) => { if (!only || only === name) { fn(); console.log('OK expanded-town ' + name); } };

group('generation', () => {
  let min = Infinity, max = 0;
  for (let seed = 0; seed < 10; seed++) {
    const w = make(seed), old = createWorld(seed); applyMap(old, 2, 1);
    assert.equal(w.n, 96, 'generation: actual 96x96 grid');
    assert.equal(TOWN_N, 96);
    assert(w.blds.length >= old.blds.length * 2, 'generation: at least twice the 64-map buildings');
    min = Math.min(min, w.blds.length); max = Math.max(max, w.blds.length);
    const occupied = new Int32Array(96 * 96); let central = 0, outside = 0;
    for (const b of w.blds) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      assert(x >= 0 && z >= 0 && x < 96 && z < 96, 'generation: building stays inside grid');
      const c = cellIdx(w, x, z);
      assert(!occupied[c], 'generation: buildings do not overlap'); occupied[c] = b.id;
      assert.equal(w.occ[c], b.id, 'generation: collision grid belongs to the real building');
      assert(w.ter[c] !== TER_ROAD && w.ter[c] !== TER_MUD, 'generation: roads and river remain clear');
      assert(!inTownSpawn(x, z), 'generation: two 12x12 spawn corners stay clear');
      if (x >= TOWN_CENTRE.lo && x <= TOWN_CENTRE.hi && z >= TOWN_CENTRE.lo && z <= TOWN_CENTRE.hi) central++; else outside++;
    }
    assert(central * (96 * 96 - 48 * 48) > outside * 48 * 48, 'generation: dense centre and sparse outskirts');
    assert.equal(w.units.length, 30, 'generation: symmetric existing armoured companies');
    for (const u of w.units) assert(!w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))], 'generation: units stand on passable cells');
    const start = w.units[0], sx = cellOf(start.x), sz = cellOf(start.z);
    for (const [x, z] of [[1, 1], [0, 95], [95, 0], [48, 48], [19, 18], [77, 22], [17, 60]]) {
      const p = findPath(w, sx, sz, x, z);
      assert(p.length && p.at(-1) === z * 96 + x, `generation: connected road/village (${x},${z})`);
      assert(p.every(c => c >= 0 && c < 96 * 96 && !w.occ[c]), 'generation: paths do not cross intact buildings');
    }
    const count = w.vegetation.cells.reduce((a, x) => a + !!x, 0); assert(count <= 64);
  }
  console.log(`96x96 seeds 0-9: ${min}-${max} buildings`);
});

group('lifecycle', () => {
  const direct = make(), commanded = createWorld(1944);
  step(direct, []); step(commanded, [{ t: 'map', id: 3, vegetation: 1 }]);
  assert.equal(hashWorld(commanded), hashWorld(direct), 'lifecycle: map command preserves explicit vegetation and RNG');
  const w = make(); step(w, [ECO]);
  assert.equal(w.eco.pop, 40, 'lifecycle: new town retains population 40');
  assert(w.eco.hq.every(id => id > 0), 'lifecycle: both HQs fit');
  assert.equal(w.units.filter(u => u.kind === UK_INFANTRY).length, 2);
  const late = createWorld(7); step(late, []); const before = hashWorld(late); applyMap(late, 3, 1);
  assert.equal(hashWorld(late), before, 'lifecycle: map cannot reset a battle after tick zero');
  const existing = createWorld(7); applyMap(existing, 1, 1); const rye = hashWorld(existing); applyMap(existing, 3, 1);
  assert.equal(hashWorld(existing), rye, 'lifecycle: existing map cannot be overwritten in place');
  assert.match(startOrderText(3, true, '普通').place, /96×96/);
});

group('boundary', () => {
  const w = make(); w.blds = []; w.occ.fill(0); w.ter.fill(0); w.units = [w.units[0]];
  const u = w.units[0]; u.id = 1; u.x = center(85); u.z = center(84);
  step(w, [{ t: 'move', side: 0, ids: [1], x: 999, z: 999 }]);
  assert(u.path.length && u.path.every(c => c >= 0 && c < 9216), 'boundary: move path uses the 96-grid');
  for (let i = 0; i < 400; i++) step(w, []);
  assert(u.x >= 85 * SUB && u.z >= 84 * SUB && u.x < 96 * SUB && u.z < 96 * SUB, 'boundary: movement stays inside the expanded edge');
});

group('replay', () => {
  const log = [{ tick: 0, cmd: { t: 'map', id: 3, vegetation: 1 } }, { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 2 } }, { tick: 1, cmd: { t: 'move', side: 0, ids: [1, 2], x: 48, z: 48 } }];
  const a = runLog(createWorld(1944), log, 1200), json = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 1200);
  const half = runLog(createWorld(1944), log, 600), copy = structuredClone(half); runLog(copy, log, 1200);
  assert.equal(hashWorld(a), hashWorld(json), 'replay: JSON commands reproduce town battle');
  assert.equal(hashWorld(a), hashWorld(copy), 'replay: structuredClone continues the town battle');
  console.log('town replay1200', hashWorld(a));
  const zlog = [{ tick: 0, cmd: { t: 'map', id: 3, vegetation: 1 } }, { tick: 0, cmd: { t: 'zombies' } }, { tick: 0, cmd: ECO }];
  const z = runLog(createWorld(1944), zlog, 1801), zcopy = runLog(createWorld(1944), JSON.parse(JSON.stringify(zlog)), 1801);
  assert.equal(z.zombies.wave, 2, 'replay: zombie waves work on 96'); assert.equal(z.eco.hq[1], 0);
  assert.equal(hashWorld(z), hashWorld(zcopy), 'replay: zombie JSON commands reproduce the expanded map');
  console.log('town zombies1801', hashWorld(z));
});

group('legacy', () => {
  // 從 main 62d04bd9 的原始 sim 檔直接執行取得，與受測函式分開保存。
  const frozen = { 0: ['22afb3f3', '3827e691'], 1: ['e4055f88', '1b3ea055'], 2: ['b725bc02', '87415341'] };
  for (const map of [0, 1, 2]) {
    const w = createWorld(1944); step(w, [{ t: 'map', id: map, vegetation: 1 }, ECO, { t: 'ai', side: 1, level: 2 }]);
    assert.equal(hashWorld(w), frozen[map][0], `legacy: map${map} tick1 unchanged`);
    while (w.tick < 600) step(w, []);
    assert.equal(hashWorld(w), frozen[map][1], `legacy: map${map} tick600 unchanged`);
  }
  assert.equal(hashWorld(runScript()), 'eea1d59b', 'legacy: golden unchanged');
});

group('geometry', () => {
  const w = make(), before = hashWorld(w), full = buildTown(w), middle = buildTown(w, undefined, 1), far = buildTown(w, undefined, 2);
  assert(middle.triangles < full.triangles && far.triangles < middle.triangles, 'geometry: real level-of-detail reduction');
  const local = buildTown(w, b => b.x < 35 || b.z < 35 || b.x > 51 || b.z > 51);
  assert(local.triangles > 0 && local.triangles < full.triangles, 'geometry: region omits distant buildings');
  assert.equal(hashWorld(w), before, 'geometry: renderer does not mutate world or RNG');
});
