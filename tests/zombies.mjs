// R045：卡面契約、真故障回歸；可傳群組名跑負控的第一個語意紅燈。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS, UK_ZOMBIE, UK_OBSERVER, UK_TANK, SUB, center, cellOf, cellIdx, blocks, BK_WALL_BRICK, SIDE_PLAYER } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { startZombies } from '../src/sim/zombies.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { runScript } from '../src/sim/script.ts';
import { makeReport, newStats } from '../src/ui/report.ts';
import { startOrderText } from '../src/ui/startOrder.ts';
import { zombiesBest } from '../src/ui/zombiesMode.ts';
import { buildError } from '../src/sim/build.ts';
import { trenchError } from '../src/sim/trenches.ts';
const only = process.argv[2]; let groups = 0;
function group(name, fn) { if (only && only !== name) return; groups++; fn(); console.log(`OK zombies/${name}`); }
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
const opening = (id = 1) => { const w = createWorld(1944); step(w, [{ t: 'map', id, vegetation: 1 }, { t: 'zombies' }, ECO]); return w; };
const living = w => w.units.filter(u => u.alive && u.kind === UK_ZOMBIE);
const unit = (w, side, kind, x, z) => { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: UNIT_KINDS[kind].hp, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
function blank() { const w = createWorld(1944); w.blds = []; w.units = []; w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); startZombies(w); w.zombies.next = 1e8; return w; }

group('activation', () => {
  assert.equal(UK_ZOMBIE, 11); const k = UNIT_KINDS[11];
  assert.equal(k.men, 6); assert.equal(k.hp, 60); assert(k.speed < UNIT_KINDS[3].speed); assert.equal(k.range, SUB);
  for (const map of [1, 2]) {
    const ref = createWorld(1944); step(ref, [{ t: 'map', id: map, vegetation: 1 }]);
    const friends = ref.units.filter(u => u.side === 0).map(u => [u.id, u.x, u.z, u.hp]);
    const w = opening(map);
    assert.deepEqual(w.units.filter(u => u.side === 0 && u.kind !== 3).map(u => [u.id, u.x, u.z, u.hp]), friends, 'activation: original player ids and state survive');
    assert(w.units.every((u, i) => u.id === i + 1), 'activation: id-addressed slots never compact or collide');
    assert.equal(w.units.filter(u => u.alive && u.side === 1).length, 0);
    assert(w.eco.hq[0] > 0); assert.equal(w.eco.hq[1], 0); assert.equal(w.eco.supply[1], 0);
    step(w, [{ t: 'ai', side: 1, level: 3 }, { t: 'produce', side: 1, kind: UK_TANK }]);
    assert.equal(w.ai, undefined); assert.equal(w.eco.queue[1].length, 0); assert.equal(w.winner, -1, 'empty enemy is not victory');
    const before = hashWorld(w), twin = structuredClone(w); step(w, [{ t: 'zombies' }]); step(twin, []); assert.equal(hashWorld(w), hashWorld(twin), 'activation: late command is inert'); assert.notEqual(before, hashWorld(w));
  }
  const w = createWorld(1944); startZombies(w); const h = hashWorld(w); startZombies(w); assert.equal(hashWorld(w), h);
  const late = createWorld(1944); step(late, []); const twin = structuredClone(late);
  step(late, [{ t: 'zombies' }]); step(twin, []); assert.equal(hashWorld(late), hashWorld(twin), 'activation: late first command is inert');
  const defense = blank(); unit(defense, 0, UK_OBSERVER, 26, 26);
  const build = { t: 'build', side: 1, kind: 1, x: 0, z: 0 }, trench = { t: 'trench', side: 1, kind: 0, x: 0, z: 2 };
  assert.equal(buildError(defense, build), null, 'fixture: tick-zero enemy building is otherwise legal');
  assert.equal(trenchError(defense, trench), null, 'fixture: tick-zero enemy trench is otherwise legal');
  step(defense, [build, trench]);
  assert.equal(defense.blds.length, 0, 'activation: enemy construction is rejected');
  assert.equal(defense.trenches?.segments.length ?? 0, 0, 'activation: enemy trenches are rejected');
  const sb = createSandboxWorld(1944); startZombies(sb); assert.equal(sb.zombies, undefined);
});

group('waves', () => {
  for (const map of [1, 2]) {
    const w = opening(map); for (const u of w.units) if (u.side === 0) { u.kind = UK_OBSERVER; u.hp = 1e8; }
    w.tick = 899; step(w, []); assert.equal(w.zombies.wave, 0, 'waves: no first wave before tick 900');
    for (const [tick, wave, count] of [[900, 1, 6], [1800, 2, 8], [2700, 3, 10]]) {
      w.tick = tick; const total = w.zombies.spawned; step(w, []);
      assert.equal(w.zombies.wave, wave, 'waves: scheduled wave tick'); assert.equal(w.zombies.spawned - total, count, 'waves: exact 4+2k groups');
      const hq = w.blds[w.eco.hq[0] - 1];
      for (const e of w.events.filter(e => e.e === 'spawn')) {
        const x = cellOf(e.x), z = cellOf(e.z); assert(x === 0 || z === 0 || x === w.n - 1 || z === w.n - 1, 'spawn: perimeter only');
        assert((e.x - center(hq.x)) ** 2 + (e.z - center(hq.z)) ** 2 >= (w.n * SUB / 2) ** 2, 'spawn: at least half-map from headquarters');
      }
    }
    w.zombies.pending = 100; w.zombies.next = 1e8; step(w, []);
    assert.equal(living(w).length, 48, 'waves: simultaneous cap is 48'); const pending = w.zombies.pending;
    const dead = living(w)[0]; dead.alive = false; dead.hp = 0; step(w, []);
    assert.equal(living(w).length, 48); assert.equal(w.zombies.pending, pending - 1, 'waves: pending group fills next available slot');
    for (const u of living(w)) { u.alive = false; u.hp = 0; } w.zombies.pending = 0; w.tick = 3000; step(w, []);
    assert.equal(w.zombies.next, 3200, 'waves: clear advances next wave by 200 ticks');
    assert.equal(w.winner, -1);
  }
});

group('combat', () => {
  const damage = (kind, gap) => { const w = blank(), t = unit(w, 0, kind, 12, 12), z = unit(w, 1, UK_ZOMBIE, 11, 12); z.x = t.x - gap; t.cooldown = 100; const before = t.hp; step(w, []); return { w, z, lost: before - t.hp }; };
  const near = damage(UK_OBSERVER, SUB), armor = damage(UK_TANK, SUB), far = damage(UK_OBSERVER, SUB + 20);
  assert(near.lost > armor.lost && armor.lost > 0, 'combat: armor receives scratches, infantry full melee');
  assert.equal(far.lost, 0, 'combat: no damage outside one cell');
  assert(!near.w.shells.some(s => s.shooter === near.z.id), 'combat: melee has no flying shell');
  assert(near.w.events.some(e => e.e === 'impact' && e.kind === 4), 'combat: distinct same-tick melee impact');
  const garrison = blank(), soldier = unit(garrison, 0, 3, 5, 5); unit(garrison, 1, UK_ZOMBIE, 4, 5);
  garrison.blds = [{ id: 1, kind: 0, x: 5, z: 5, w: 1, d: 1, floors: 1, hp: 90, maxHp: 90 }]; garrison.occ[cellIdx(garrison, 5, 5)] = 1;
  step(garrison, []); assert.equal(soldier.hp, 60, 'combat: cannot bite garrison through intact wall'); assert(garrison.blds[0].hp < 90, 'combat: attacks the protecting wall first');
  const w = blank(), t = unit(w, 0, UK_OBSERVER, 30, 26), z = unit(w, 1, UK_ZOMBIE, 2, 26);
  const wall = { id: 1, kind: BK_WALL_BRICK, x: 10, z: 0, w: 1, d: 32, floors: 1, hp: 120, maxHp: 120 }; w.blds.push(wall); for (let q = 0; q < 32; q++) w.occ[cellIdx(w, 10, q)] = 1;
  for (let i = 0; i < 1800 && wall.hp; i++) { step(w, []); assert(!blocks(w, cellOf(z.x), cellOf(z.z)), 'combat: never walks through a standing obstacle'); }
  assert.equal(wall.hp, 0, 'combat: blocked path destroys its wall'); assert(t.alive);
  const hidden = blank(); unit(hidden, 0, UK_OBSERVER, 4, 4); const h = unit(hidden, 1, UK_ZOMBIE, 1, 4);
  hidden.blds = [{ ...wall, hp: 120, x: 2, z: 0 }]; for (let q = 0; q < 32; q++) hidden.occ[cellIdx(hidden, 2, q)] = 1;
  step(hidden, []); assert.equal(h.target, 0, 'vision: hidden player does not become chase target');
  const edge = blank(); step(edge, [{ t: 'eco' }]); const hq = edge.blds[edge.eco.hq[0] - 1];
  const off = unit(edge, 1, UK_ZOMBIE, hq.x - 1, hq.z); off.x -= 20;
  const hp = hq.hp; for (let i = 0; i < 100; i++) step(edge, []);
  assert(hq.hp < hp, 'combat: finishes last cell center to reach headquarters');
});

group('replay', () => {
  for (const map of [1, 2]) {
    const log = [{ tick: 0, cmd: { t: 'map', id: map, vegetation: 1 } }, { tick: 0, cmd: { t: 'zombies' } }, { tick: 0, cmd: ECO }, { tick: 1200, cmd: { t: 'produce', side: 0, kind: UK_TANK } }];
    const a = runLog(createWorld(1944), log, 2400), b = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 2400);
    const half = runLog(createWorld(1944), log, 1100), copy = structuredClone(half); runLog(half, log, 2400); runLog(copy, log, 2400);
    assert.equal(hashWorld(a), hashWorld(b)); assert.equal(hashWorld(a), hashWorld(copy)); assert.equal(hashWorld(a), hashWorld(half), 'replay: clone and JSON retain complete state');
    for (const key of ['version', 'wave', 'next', 'pending', 'spawned', 'killed', 'lost']) { const c = structuredClone(a); c.zombies[key]++; assert.notEqual(hashWorld(c), hashWorld(a), `hash: ${key} is persistent`); }
  }
  assert.equal(hashWorld(runScript()), 'eea1d59b', 'legacy: golden unchanged');
});

group('natural', () => {
  for (const map of [1, 2]) {
    const w = opening(map), first = []; let cleared = -1;
    while (w.winner < 0 && w.zombies.wave <= 10 && w.tick < 15000) {
      step(w, []); if (w.zombies.wave === 1 && !first.length) first.push(...living(w));
      if (first.length && cleared < 0 && first.every(u => !u.alive)) cleared = w.tick;
    }
    assert.equal(first.length, 6); assert(cleared > 0 && cleared < w.tick, 'natural: defeats first wave before loss');
    assert.equal(w.winner, 1, 'natural: headquarters falls'); assert(w.zombies.wave <= 10, 'natural: unattended defense falls within ten waves');
    const report = makeReport(w, newStats(w)); assert.deepEqual(report.zombies, { wave: w.zombies.wave, killed: w.zombies.killed, lost: w.zombies.lost });
    console.log(`  map ${map}: first cleared ${cleared}, lost tick ${w.tick}, wave ${w.zombies.wave}, killed ${w.zombies.killed}`);
  }
  const noHQ = blank(); unit(noHQ, 1, UK_ZOMBIE, 0, 0); step(noHQ, []); assert.equal(noHQ.winner, 1, 'no HQ: no player units means loss');
  const unplaced = blank(), friend = unit(unplaced, 0, UK_OBSERVER, 26, 26);
  unplaced.eco = { hq: [0, 0], supply: [0, 0], queue: [[], []], prog: [0, 0] };
  step(unplaced, []); assert.equal(unplaced.winner, -1, 'no HQ: empty eco slot falls back to surviving player units');
  friend.alive = false; friend.hp = 0; step(unplaced, []); assert.equal(unplaced.winner, 1);
});

group('text-storage', () => {
  assert.match(startOrderText(2, true, '普通', true).goal, /喪屍從地圖邊緣湧來。守住指揮部，撐越多波越好。/);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); const data = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) } });
    assert.equal(zombiesBest(3), 3); assert.equal(zombiesBest(2), 3); assert.equal(data.get('gtrts.v1.zombies.best'), '3');
    data.set('gtrts.v1.zombies.best', 'broken'); assert.equal(zombiesBest(4), 4);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked'); } }); assert.equal(zombiesBest(5), 5);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
});
assert(groups > 0, `unknown group ${only}`);
console.log(`zombies: ${groups} groups OK`);
