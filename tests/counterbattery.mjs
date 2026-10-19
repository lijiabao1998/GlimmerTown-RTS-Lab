// R115: each named semantic group can run alone; mutants run in isolated temporary copies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, N, SUB, TICK_HZ, center, idx, UNIT_KINDS, UK_HOWITZER, UK_MORTAR, UK_TANK, UK_INFANTRY, UK_OBSERVER, UK_ATGUN, ORD_IDLE, ORD_FIRE_AT, ORD_MOVE, SHELL_AP, SHELL_HE, SHELL_SMOKE, BK_HOUSE } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { COUNTERBATTERY_TTL, COUNTERBATTERY_CAP, COUNTERBATTERY_LEVELS, counterbatteryAreas, updateCounterbattery } from '../src/sim/counterbattery.ts';
import { SCRIPT, SCRIPT_SEED, runScript } from '../src/sim/script.ts';

const only = process.argv[2]; let groups = 0;
function group(name, fn) { if (only && only !== name) return; groups++; fn(); console.log(`OK counterbattery/${name}`); }
const HOLD = Math.max(...UNIT_KINDS.map(k => k.reload)) * 1000;
function blank() { const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = []; return w; }
function add(w, side, kind, x = 2, z = 2) { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: HOLD, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; }
const report = (side = 0, zone = 0, cell = 0, shots = 1, last = 1) => ({ side, zone, cell, shots, last });
const event = (gun, x = gun.x, z = gun.z) => ({ e: 'fire', unit: gun.id, x, z });
const aimDistance = kind => Math.floor((UNIT_KINDS[kind].range + UNIT_KINDS[kind].minRange) / (2 * SUB));
function shoot(w, gun, ammo) { gun.cooldown = 0; const x = Math.floor(gun.x / SUB) + aimDistance(gun.kind), z = Math.floor(gun.z / SUB); step(w, [{ t: 'fireAt', side: gun.side, ids: [gun.id], x, z, ...(ammo ? { ammo } : {}) }]); }
function hear(w, guns, tick = w.tick + 1) { w.tick = tick; w.events = guns.map(u => event(u)); updateCounterbattery(w); }
function strip(w) { const c = structuredClone(w); delete c.counterbattery; return c; }
function semantic(name, actual, expected) { assert.deepEqual(actual, expected, `R115:${name}`); }

// Frozen independently from the production script; changing SCRIPT cannot move the oracle.
const LEGACY_SCRIPT = [
  { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } },
  { tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [1, 2], target: 5 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [3], target: 6 } },
  { tick: 500, cmd: { t: 'move', side: 1, ids: [5, 6, 7], x: 14, z: 12 } },
  { tick: 500, cmd: { t: 'fireAt', side: 0, ids: [4], x: 24, z: 24, ammo: 'smoke' } },
  { tick: 700, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 9, z: 9 } },
  { tick: 900, cmd: { t: 'fireAt', side: 0, ids: [4], x: 6, z: 6 } },
];

group('launch', () => {
  for (const side of [0, 1]) for (const [kind, ammo] of [[UK_HOWITZER], [UK_MORTAR], [UK_HOWITZER, 'smoke']]) {
    const w = blank(), gun = add(w, side, kind); shoot(w, gun, ammo);
    assert.equal(w.events.filter(e => e.e === 'fire').length, 1, 'fixture really launches');
    semantic('launch', w.counterbattery, [report(1 - side, 0, 5, 1, 1)]);
    assert.equal(w.shells[0].kind, ammo ? SHELL_SMOKE : SHELL_HE);
    assert.notEqual(Math.floor(w.shells[0].ex / (8 * SUB)), 0, 'aim is not the recorded source zone');
    const clone = strip(w), before = structuredClone(clone); updateCounterbattery(clone);
    semantic('observational', strip(clone), before);
  }
});

group('no_phantom', () => {
  for (const mode of ['reload', 'move', 'near', 'far', 'invalid', 'dead', 'unarmed', 'idle']) {
    const w = blank(), gun = add(w, 0, mode === 'unarmed' ? UK_OBSERVER : UK_HOWITZER);
    let commands = [{ t: 'fireAt', side: 0, ids: [gun.id], x: 2 + aimDistance(UK_HOWITZER), z: 2 }];
    if (mode !== 'reload') gun.cooldown = 0;
    if (mode === 'move') { gun.order = ORD_FIRE_AT; gun.target = 1; gun.tx = N - 1; gun.tz = N - 1; gun.path = [idx(3, 2), idx(4, 2)]; commands = []; }
    if (mode === 'near') commands[0].x = 2;
    if (mode === 'far') { commands[0].x = N - 1; commands[0].z = N - 1; }
    if (mode === 'invalid') commands[0].side = 1;
    if (mode === 'dead') gun.alive = false;
    if (mode === 'idle') commands = [];
    step(w, commands); assert(!w.events.some(e => e.e === 'fire'), `fixture ${mode} must not fire`);
    semantic('no_phantom', w.counterbattery, undefined);
  }
  for (const kind of [UK_TANK, UK_INFANTRY, UK_ATGUN]) {
    const w = blank(), gun = add(w, 0, kind), x = 2 + aimDistance(kind); gun.cooldown = 0;
    w.blds.push({ id: 1, kind: BK_HOUSE, x, z: 2, w: 1, d: 1, floors: 1, hp: 1000, maxHp: 1000 }); w.occ[idx(x, 2)] = 1;
    step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x, z: 2 }]);
    assert(w.events.some(e => e.e === 'fire'), 'direct-fire control really fires');
    semantic('direct_filter', w.counterbattery, undefined);
  }
});

group('event_snapshot', () => {
  const w = blank(), gun = add(w, 0, UK_HOWITZER), enemy = add(w, 1, UK_TANK, 20, 20); gun.hp = 1;
  w.shells.push({ id: w.nextShell++, side: 1, kind: SHELL_AP, shooter: enemy.id, sx: enemy.x, sz: enemy.z, ex: gun.x, ez: gun.z, t: 0, T: 1, target: gun.id, hitBld: 0 });
  shoot(w, gun); assert(!gun.alive && w.events.some(e => e.e === 'fire') && w.events.some(e => e.e === 'kill'), 'fixture fires then dies in same step');
  semantic('dead_sound', w.counterbattery, [report(1, 0, 5)]);
  const v = blank(), moved = add(v, 1, UK_MORTAR, 2, 2); v.tick = 10; v.events = [event(moved)]; moved.x = center(27); moved.z = center(28);
  updateCounterbattery(v); semantic('event_source', v.counterbattery, [report(0, 0, 5, 1, 10)]);
});

group('convergence', () => {
  const w = blank(), gun = add(w, 0, UK_HOWITZER);
  for (const expected of [1, 2, 3, 3]) { shoot(w, gun); semantic('convergence', w.counterbattery, [report(1, 0, 5, expected, w.tick)]); }
  gun.x = center(4); shoot(w, gun); semantic('reset_cell', w.counterbattery, [report(1, 0, 6, 1, w.tick)]);
  gun.x = center(10); shoot(w, gun); semantic('keep_old_zone', w.counterbattery, [report(1, 0, 6, 1, w.tick - 1), report(1, 1, 5, 1, w.tick)]);
});

group('ordering', () => {
  const make = reverse => {
    const w = blank(), a = add(w, 1, UK_HOWITZER, 6, 6), b = add(w, 1, UK_MORTAR, 2, 2), c = add(w, 1, UK_HOWITZER, 3, 3), d = add(w, 0, UK_HOWITZER, 4, 4);
    w.counterbattery = [report(0, 0, 15, 3, 0)]; w.tick = 1;
    w.events = [event(a), event(b), event(c), event(d)];
    if (reverse) { w.events.reverse(); w.units.reverse(); for (const u of w.units) u.id += 10; for (const e of w.events) e.unit += 10; }
    updateCounterbattery(w); return w.counterbattery;
  };
  const expected = [report(0, 0, 5, 2), report(1, 0, 10)];
  semantic('ordering', make(false), expected); semantic('ordering', make(true), expected);
  const w = blank(), a = add(w, 1, UK_HOWITZER, 2, 2), b = add(w, 1, UK_MORTAR, 6, 6); hear(w, [a, a, a, a, b, b, b]);
  semantic('same_tick_cap', w.counterbattery, [report(0, 0, 5, 3)]);
});

group('capacity', () => {
  assert.equal(COUNTERBATTERY_CAP, 8);
  const w = blank(), guns = [];
  for (const side of [0, 1]) for (let zone = 15; zone >= 0; zone--) guns.push(add(w, side, UK_MORTAR, zone % 4 * 8, Math.floor(zone / 4) * 8));
  hear(w, guns, 10);
  const expected = [0, 1].flatMap(side => Array.from({ length: 8 }, (_, zone) => report(side, zone, 0, 1, 10)));
  semantic('capacity_tie', w.counterbattery, expected);
  const v = blank(), gun = add(v, 1, UK_MORTAR, 0, 0);
  for (let zone = 0; zone < 10; zone++) { gun.x = zone % 4 * 8 * SUB; gun.z = Math.floor(zone / 4) * 8 * SUB; hear(v, [gun], 1 + zone); }
  semantic('capacity_age', v.counterbattery, Array.from({ length: 8 }, (_, i) => report(0, i + 2, 0, 1, i + 3)));
  gun.x = 2 * 8 * SUB; gun.z = 0; hear(v, [gun], 11);
  gun.x = 2 * 8 * SUB; gun.z = 2 * 8 * SUB; hear(v, [gun], 12);
  semantic('refresh_priority', v.counterbattery.map(r => r.zone), [2, 4, 5, 6, 7, 8, 9, 10]);
  semantic('storage_order', v.counterbattery.map(r => [r.side, r.zone]), v.counterbattery.map(r => [r.side, r.zone]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
});

group('lifetime', () => {
  assert.equal(COUNTERBATTERY_TTL, 30 * TICK_HZ); assert.equal(COUNTERBATTERY_TTL, 600);
  const w = blank(), gun = add(w, 1, UK_MORTAR); hear(w, [gun], 1); w.events = [];
  const snapshot = structuredClone(w.counterbattery);
  for (const tick of [2, 300, 600]) { w.tick = tick; gun.x = center(25); gun.z = center(26); gun.alive = tick < 300; updateCounterbattery(w); semantic('history_stable', w.counterbattery, snapshot); }
  semantic('expiry_before', counterbatteryAreas(w, 0).length, 1);
  w.tick = 601; semantic('projection_expiry', counterbatteryAreas(w, 0), []); updateCounterbattery(w); semantic('expiry', w.counterbattery, undefined); semantic('expiry', counterbatteryAreas(w, 0), []);
  const v = blank(), b = add(v, 1, UK_MORTAR); hear(v, [b, b, b], 1); hear(v, [b], 601); semantic('expired_restart', v.counterbattery, [report(0, 0, 5, 1, 601)]);
});

group('geometry', () => {
  assert.equal(COUNTERBATTERY_LEVELS, 3); const w = blank(); w.tick = 1; let checked = 0;
  for (let gz = 0; gz < N; gz += 2) for (let gx = 0; gx < N; gx += 2) {
    const zone = Math.floor(gz / 8) * 4 + Math.floor(gx / 8), cell = Math.floor(gz % 8 / 2) * 4 + Math.floor(gx % 8 / 2);
    let prior = Infinity;
    for (const [shots, pitch, rx, rz] of [[1, 8, 8, 6], [2, 4, 4, 3], [3, 2, 2, 1.5]]) {
      w.counterbattery = [report(0, zone, cell, shots)]; const a = counterbatteryAreas(w, 0)[0];
      semantic('geometry', a, { x: (Math.floor(gx / pitch) * pitch + pitch / 2) * SUB, z: (Math.floor(gz / pitch) * pitch + pitch / 2) * SUB, rx: rx * SUB, rz: rz * SUB, level: shots });
      assert(a.rx * a.rz < prior, 'R115:area_shrinks'); prior = a.rx * a.rz;
      assert(Object.values(a).every(Number.isInteger), 'R115:integer_projection');
      // Every corner of the WHOLE public quantization cell, including boundary, is inside the ellipse.
      for (const dx of [-pitch * SUB / 2, pitch * SUB / 2]) for (const dz of [-pitch * SUB / 2, pitch * SUB / 2]) assert(dx * dx * a.rz * a.rz + dz * dz * a.rx * a.rx <= a.rx * a.rx * a.rz * a.rz, 'R115:enclosure');
      if (shots === 3) for (const x of [gx * SUB, (gx + 2) * SUB - 1]) for (const z of [gz * SUB, (gz + 2) * SUB - 1]) assert((x - a.x) ** 2 / a.rx ** 2 + (z - a.z) ** 2 / a.rz ** 2 <= 1, 'R115:two_cell_uncertainty');
      checked++;
    }
  }
  console.log(`  ${checked} all-map integer ellipse fixtures`);
});

group('privacy', () => {
  const w = blank(), gun = add(w, 1, UK_MORTAR); let expected;
  for (const x of [2 * SUB, 2 * SUB + 1, 3 * SUB, 4 * SUB - 1]) for (const z of [2 * SUB, 2 * SUB + 7, 3 * SUB, 4 * SUB - 1]) {
    const v = structuredClone(w); v.units[0].x = x; v.units[0].z = z; hear(v, v.units, 1);
    const result = [v.counterbattery, counterbatteryAreas(v, 0)]; if (!expected) expected = result;
    semantic('exact_position_private', result, expected);
  }
  // Cover all 256 source subcells, including all map edges, with opposite exact corners.
  for (let gz = 0; gz < N; gz += 2) for (let gx = 0; gx < N; gx += 2) {
    let corners;
    for (const x of [gx * SUB, (gx + 2) * SUB - 1]) for (const z of [gz * SUB, (gz + 2) * SUB - 1]) {
      const v = blank(), u = add(v, 1, UK_MORTAR); u.x = x; u.z = z; hear(v, [u]);
      const result = [v.counterbattery, counterbatteryAreas(v, 0)]; if (!corners) corners = result;
      semantic('all_subcell_corners', result, corners);
      semantic('all_subcell_index', v.counterbattery, [report(0, Math.floor(gz / 8) * 4 + Math.floor(gx / 8), Math.floor(gz % 8 / 2) * 4 + Math.floor(gx % 8 / 2))]);
    }
  }
  w.counterbattery = [report(0, 0, 0)]; w.tick = 1;
  const first = counterbatteryAreas(w, 0); semantic('public_keys', Object.keys(first[0]).sort(), ['level', 'rx', 'rz', 'x', 'z']);
  for (let cell = 0; cell < 16; cell++) { w.counterbattery[0].cell = cell; semantic('coarse_private', counterbatteryAreas(w, 0), first); }
  w.counterbattery[0].shots = 2; w.counterbattery[0].cell = 0; const second = counterbatteryAreas(w, 0);
  for (const cell of [0, 1, 4, 5]) { w.counterbattery[0].cell = cell; semantic('medium_private', counterbatteryAreas(w, 0), second); }
  w.counterbattery[0].shots = 3; w.counterbattery[0].cell = 0; const third = counterbatteryAreas(w, 0); w.counterbattery[0].cell = 1; assert.notDeepEqual(counterbatteryAreas(w, 0), third, 'R115:fine_resolves');
  Object.defineProperty(w, 'units', { get() { throw new Error('R115:projection_read_units'); } });
  assert.doesNotThrow(() => { semantic('projection_units_independent', counterbatteryAreas(w, 1), []); assert.equal(counterbatteryAreas(w, 0).length, 1); }, 'R115:projection_units_independent');
});

group('visibility', () => {
  const w = blank(), gun = add(w, 1, UK_HOWITZER, 2, 2), observer = add(w, 0, UK_OBSERVER, 30, 30); hear(w, [gun], 1);
  assert(!spotted(w, 0, gun.x, gun.z)); const expected = counterbatteryAreas(w, 0), reports = structuredClone(w.counterbattery);
  observer.x = gun.x; observer.z = gun.z; assert(spotted(w, 0, gun.x, gun.z));
  semantic('visibility_history', counterbatteryAreas(w, 0), expected); observer.alive = false; gun.x = center(25); gun.z = center(25); gun.alive = false;
  w.tick++; w.events = []; updateCounterbattery(w); semantic('visibility_history', w.counterbattery, reports); semantic('visibility_history', counterbatteryAreas(w, 0), expected);
  assert(!spotted(w, 0, gun.x, gun.z), 'sound never reveals hidden units');
  const other = blank(); other.tick = w.tick; semantic('world_replacement', counterbatteryAreas(other, 0), []);
});

group('hashing', () => {
  const w = blank(); w.tick = 1; w.counterbattery = [report()]; const before = hashWorld(w);
  for (const key of ['side', 'zone', 'cell', 'shots', 'last']) { const c = structuredClone(w); c.counterbattery[0][key]++; assert.notEqual(hashWorld(c), before, `R115:hash_${key}`); }
  const more = structuredClone(w); more.counterbattery.push(report(0, 1)); assert.notEqual(hashWorld(more), before, 'R115:hash_count');
  const reordered = structuredClone(more); reordered.counterbattery.reverse(); assert.notEqual(hashWorld(reordered), hashWorld(more), 'R115:hash_order');
  assert.notEqual(hashWorld(strip(w)), before, 'R115:hash_presence');
  const snap = structuredClone(w); for (let i = 0; i < 30; i++) counterbatteryAreas(w, i % 2); semantic('projection_pure', w, snap);
  const empty = strip(w), old = hashWorld(empty); empty.counterbattery = []; semantic('empty_legacy_hash', hashWorld(empty), old);
});

group('replay', () => {
  const a = runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, 1200), b = runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(LEGACY_SCRIPT)), 1200), halfway = runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, 300), copy = structuredClone(halfway);
  assert(halfway.counterbattery?.length, 'clone fixture contains persisted reports');
  runLog(halfway, LEGACY_SCRIPT, 1200); runLog(copy, LEGACY_SCRIPT, 1200);
  semantic('replay', [hashWorld(a), hashWorld(b), hashWorld(halfway), hashWorld(copy)], Array(4).fill(hashWorld(a)));
  const old = runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, 300); delete old.counterbattery;
  const saved = structuredClone(old); runLog(old, LEGACY_SCRIPT, 1200); runLog(saved, LEGACY_SCRIPT, 1200); semantic('old_world', hashWorld(old), hashWorld(saved)); assert(old.counterbattery?.length, 'old world resumes accepting new fire');
  const jsonReports = JSON.parse(JSON.stringify(a.counterbattery)); semantic('integer_records', jsonReports, a.counterbattery);
  for (const r of jsonReports) { semantic('record_keys', Object.keys(r).sort(), ['cell', 'last', 'shots', 'side', 'zone']); assert(Object.values(r).every(Number.isInteger), 'R115:integer_records'); }
});

group('legacy', () => {
  semantic('script_unchanged', SCRIPT, LEGACY_SCRIPT);
  const w = runScript(1200); assert(w.counterbattery?.length, 'new SCRIPT hash includes live reports');
  semantic('legacy', hashWorld(strip(w)), 'f3364bb6');
  const twice = runScript(1200); semantic('seed_repeat', hashWorld(w), hashWorld(twice));
  console.log(`  stripped 1200 f3364bb6; full 600 ${hashWorld(runScript(600))}; full 1200 ${hashWorld(w)}`);
});

// No production source is edited. A mutant must exit on its requested semantic assertion,
// not a loader/syntax/launch error; every control also has its isolated positive group above.
if (!only || only === 'negative_controls') {
  groups++; const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r115-counterbattery-'));
  const controls = [
    ['launch', 'counterbattery.ts', 'side = 1 - gun.side', 'side = gun.side', 'R115:launch'],
    ['launch', 'counterbattery.ts', 'last: w.tick', 'last: w.tick - 1', 'R115:launch'],
    ['no_phantom', 'counterbattery.ts', '!gun || !UNIT_KINDS[gun.kind].indirect', '!gun', 'R115:direct_filter'],
    ['no_phantom', 'counterbattery.ts', 'for (const e of w.events)', "for (const e of [...w.events, ...w.units.filter(u => u.order === 3).map(u => ({ e: 'fire', unit: u.id, x: u.x, z: u.z }))])", 'R115:no_phantom'],
    ['launch', 'counterbattery.ts', 'const heard = new Map<number, CounterbatteryReport>();', 'w.rng ^= 1; const heard = new Map<number, CounterbatteryReport>();', 'R115:observational'],
    ['event_snapshot', 'counterbattery.ts', '!gun || !UNIT_KINDS[gun.kind].indirect', '!gun || !gun.alive || !UNIT_KINDS[gun.kind].indirect', 'R115:dead_sound'],
    ['event_snapshot', 'counterbattery.ts', 'const gx = Math.floor(e.x / SUB), gz = Math.floor(e.z / SUB)', 'const gx = Math.floor(gun.x / SUB), gz = Math.floor(gun.z / SUB)', 'R115:event_source'],
    ['convergence', 'counterbattery.ts', 'old.shots + next.shots', 'old.shots', 'R115:convergence'],
    ['convergence', 'counterbattery.ts', 'old.cell === next.cell ?', 'true ?', 'R115:reset_cell'],
    ['convergence', 'counterbattery.ts', '} else reports.push(next);', '} else { reports.length = 0; reports.push(next); }', 'R115:keep_old_zone'],
    ['ordering', 'counterbattery.ts', 'cell < previous.cell', 'cell > previous.cell', 'R115:ordering'],
    ['ordering', 'counterbattery.ts', 'const gun = w.units.find(u => u.id === e.unit);', 'const gun = w.units[e.unit - 1];', 'R115:ordering'],
    ['capacity', 'counterbattery.ts', 'b.last - a.last || a.zone - b.zone', 'b.last - a.last || b.zone - a.zone', 'R115:capacity_tie'],
    ['capacity', 'counterbattery.ts', 'b.last - a.last || a.zone - b.zone', 'a.last - b.last || a.zone - b.zone', 'R115:capacity_age'],
    ['capacity', 'counterbattery.ts', 'count[r.side]++ < COUNTERBATTERY_CAP', 'count[r.side]++ < COUNTERBATTERY_CAP + 1', 'R115:capacity_tie'],
    ['lifetime', 'counterbattery.ts', 'const reports = (w.counterbattery ?? []).filter(r => w.tick - r.last < COUNTERBATTERY_TTL)', 'const reports = (w.counterbattery ?? []).filter(r => w.tick - r.last <= COUNTERBATTERY_TTL)', 'R115:expiry'],
    ['lifetime', 'counterbattery.ts', '.filter(r => r.side === side && w.tick - r.last < COUNTERBATTERY_TTL)', '.filter(r => r.side === side && w.tick - r.last <= COUNTERBATTERY_TTL)', 'R115:projection_expiry'],
    ['lifetime', 'counterbattery.ts', 'const reports = (w.counterbattery ?? []).filter', 'const reports = (w.units.some(u => u.alive) ? w.counterbattery ?? [] : []).filter', 'R115:history_stable'],
    ['geometry', 'counterbattery.ts', 'size = ZONE_CELLS >> (level - 1)', 'size = ZONE_CELLS', 'R115:geometry'],
    ['geometry', 'counterbattery.ts', 'size = ZONE_CELLS >> (level - 1)', 'size = CELL_CELLS', 'R115:geometry'],
    ['geometry', 'counterbattery.ts', 'area.rz = size * SUB * 3 / 4', 'area.rz = size * SUB / 4', 'R115:geometry'],
    ['privacy', 'counterbattery.ts', 'Math.floor(cx / size) * size', 'cx', 'R115:coarse_private'],
    ['privacy', 'counterbattery.ts', 'Math.floor(cx / size) * size', '(level === 2 ? cx : Math.floor(cx / size) * size)', 'R115:medium_private'],
    ['privacy', 'counterbattery.ts', 'Math.floor((gx % ZONE_CELLS) / CELL_CELLS);', 'Math.floor((gx % ZONE_CELLS) / CELL_CELLS) + e.x % SUB;', 'R115:exact_position_private'],
    ['privacy', 'counterbattery.ts', 'return (w.counterbattery ?? []).filter', 'void w.units.length; return (w.counterbattery ?? []).filter', 'R115:projection_units_independent'],
    ['privacy', 'counterbattery.ts', 'area.level = level;', 'area.level = level; (area as CounterbatteryArea & { cell: number }).cell = r.cell;', 'R115:public_keys'],
    ['visibility', 'counterbattery.ts', 'const heard = new Map<number, CounterbatteryReport>();', 'if (!w.events.length) { delete w.counterbattery; return; }\n  const heard = new Map<number, CounterbatteryReport>();', 'R115:visibility_history'],
    ...['side', 'zone', 'cell', 'shots', 'last'].map(key => ['hashing', 'world.ts', `f.int(r.side).int(r.zone).int(r.cell).int(r.shots).int(r.last);`, `f.int(${key === 'side' ? '0' : 'r.side'}).int(${key === 'zone' ? '0' : 'r.zone'}).int(${key === 'cell' ? '0' : 'r.cell'}).int(${key === 'shots' ? '0' : 'r.shots'}).int(${key === 'last' ? '0' : 'r.last'});`, `R115:hash_${key}`]),
    ['replay', 'counterbattery.ts', 'export function updateCounterbattery(w: World): void {', 'let hiddenCount = 0; export function updateCounterbattery(w: World): void { w.rng ^= hiddenCount++;', 'R115:replay'],
    ['replay', 'counterbattery.ts', 'last: w.tick', 'last: w.tick + 0.5', 'R115:integer_records'],
    ['legacy', 'step.ts', '  updateCounterbattery(w);', '  updateCounterbattery(w); w.rng ^= 1;', 'R115:legacy'],
  ];
  try {
    fs.cpSync(path.join(root, 'src', 'sim'), path.join(tmp, 'src', 'sim'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'tests'));
    fs.copyFileSync(fileURLToPath(import.meta.url), path.join(tmp, 'tests', 'counterbattery.mjs')); fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    for (let i = 0; i < controls.length; i++) {
      const [name, file, from, to, first] = controls[i], target = path.join(tmp, 'src', 'sim', file), original = fs.readFileSync(path.join(root, 'src', 'sim', file), 'utf8');
      assert(original.includes(from), `mutation anchor ${i} exists`); fs.writeFileSync(target, original.replaceAll(from, to));
      const r = spawnSync(process.execPath, [path.join(tmp, 'tests', 'counterbattery.mjs'), name], { encoding: 'utf8', timeout: 10000 }); fs.writeFileSync(target, original);
      const output = `${r.stdout}\n${r.stderr}`; assert.equal(r.error, undefined, `mutant ${i} launches`); assert.equal(r.status, 1, `mutant ${i} must fail exactly once: ${output}`);
      assert(output.includes('AssertionError') && output.includes(first), `mutant ${i} must first fail ${first}: ${output}`);
      const firstAssertion = output.slice(output.indexOf('AssertionError')); assert(firstAssertion.split('\n').slice(0, 3).join('\n').includes(first), `mutant ${i} wrong first assertion: ${output}`);
      console.log(`  negative ${i + 1}/${controls.length}: ${name} -> ${first}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`OK counterbattery/negative_controls (${controls.length} isolated first-red proofs)`);
}
assert(groups > 0, `unknown group ${only}`); console.log(`counterbattery: ${groups} groups passed`);
