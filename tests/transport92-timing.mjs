// R092 #23 paired transport/tank fixture. Add --measure on an idle machine for five timed pairs.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createWorld, center, cellOf, inGrid, TER_MUD, UNIT_KINDS, ORD_IDLE, SUB, UK_TRUCK, UK_HALFTRACK, UK_TANK, UK_INFANTRY, UK_ATGUN } from '../src/sim/world.ts';
import { freeNear } from '../src/sim/ai.ts';
import { ARMOUR_FORCE } from '../src/sim/mapCommon.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from '../tools/duel.mjs';

function addUnit(world, side, kind, [x, z]) {
  const aim = side ? SUB : -SUB;
  const unit = { id: world.units.length + 1, side, kind, x: center(x), z: center(z), hp: UNIT_KINDS[kind].hp,
    alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: aim, aimZ: aim,
    ...(UNIT_KINDS[kind].armored ? { hullX: aim, hullZ: aim } : {}) };
  world.units.push(unit);
  return unit;
}

function reserveCell(world, originX, originZ, occupied) {
  for (let radius = 0; radius < world.n; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = originX + dx, z = originZ + dz, cell = z * world.n + x;
      if (inGrid(world, x, z) && !occupied.has(cell) && !world.occ[cell] && world.ter[cell] !== TER_MUD && !world.vegetation.cells[cell]) {
        occupied.add(cell);
        return [x, z];
      }
    }
  }
  throw new Error('no free cell for the starting force');
}

function tripleStartingForce(world, occupied) {
  // The game's force multiplier applies to the map roster, before the economy grants its units.
  const initialCount = world.units.length, original = world.units.slice(0, 2 * ARMOUR_FORCE.length);
  for (const side of [0, 1]) {
    assert.deepEqual(original.filter(u => u.side === side).map(u => u.kind), ARMOUR_FORCE.map(([kind]) => kind));
  }
  for (let copy = 0; copy < 2; copy++) for (const u of original) {
    addUnit(world, u.side, u.kind, reserveCell(world, cellOf(u.x), cellOf(u.z), occupied));
  }
  assert.equal(world.units.length, initialCount + 2 * original.length);
}

function run(variant, ticks) {
  const world = createWorld(31);
  step(world, [{ t: 'map', id: 3, vegetation: 1, sym: 1, more: 1 },
    { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, ...(variant === 'off' ? {} : { tp: 1 }) },
    { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]);
  const occupied = new Set(world.units.map(u => cellOf(u.z) * world.n + cellOf(u.x)));
  tripleStartingForce(world, occupied);
  const pairs = [];
  const tanks = variant === 'tanks', empty = variant === 'empty';
  if (variant !== 'on' && variant !== 'off') for (const side of [0, 1]) {
    const hq = world.blds[world.eco.hq[side] - 1], direction = side ? 1 : -1;
    for (let i = 0; i < 8; i++) {
      const start = reserveCell(world, hq.x + direction * (4 + i % 4 * 2), hq.z + direction * (4 + Math.floor(i / 4) * 3), occupied);
      const end = freeNear(world, start[0], start[1] + direction * 8);
      assert(end);
      const vehicle = addUnit(world, side, tanks ? UK_TANK : i < 4 ? UK_TRUCK : UK_HALFTRACK, start);
      const payload = addUnit(world, side, i < 4 ? UK_INFANTRY : UK_ATGUN, start);
      pairs.push({ vehicle, payload, start, end });
    }
  }
  const elapsed = [];
  let riding = 0, towing = 0;
  for (let i = 0; i < ticks; i++) {
    const cmds = [];
    if (i % 200 === 0) for (const { vehicle, payload, start, end } of pairs) {
      const [x, z] = i % 400 === 0 ? end : start;
      const ids = (empty ? [vehicle] : [vehicle, payload]).filter(u => u.alive).map(u => u.id);
      if (ids.length) cmds.push({ t: 'move', side: vehicle.side, ids, x, z });
    }
    const before = performance.now();
    step(world, cmds);
    elapsed.push(performance.now() - before);
    for (const { payload } of pairs) {
      if (payload.ride) riding++;
      if (payload.towBy) towing++;
    }
    if (i === 0) for (const { vehicle, payload } of pairs) {
      const carrier = payload.kind === UK_INFANTRY ? payload.ride : payload.towBy;
      assert.equal(carrier ?? 0, tanks || empty ? 0 : vehicle.id, 'every scripted pair enters its intended state');
      assert(vehicle.path.length > 0, 'each vehicle actually moves');
      if (tanks) assert(payload.path.length > 0, 'the control payload moves independently');
    }
  }
  assert.equal(world.tick, ticks + 1, 'both scenarios must cover the full interval');
  if (variant === 'loaded') assert(riding >= Math.min(80, ticks) && towing >= Math.min(80, ticks), 'passengers and towed units spend time in transit');
  else assert.equal(riding + towing, 0, 'the control carries no payload');
  elapsed.sort((a, b) => a - b);
  return { p99: elapsed[Math.floor(ticks * 0.99)], mean: elapsed.reduce((sum, ms) => sum + ms, 0) / ticks, riding, towing };
}

const variants = ['on', 'off', 'loaded', 'empty', 'tanks'];
if (process.argv.includes('--measure')) {
  const results = Object.fromEntries(variants.map(key => [key, []]));
  // Warm both flag paths before recording the first paired sample.
  for (const key of variants) run(key, 200);
  for (let i = 0; i < 5; i++) {
    for (const key of (i % 2 ? variants.toReversed() : variants)) results[key].push(run(key, 3000));
  }
  const median = (runs, key) => runs.map(sample => sample[key]).sort((a, b) => a - b)[2];
  for (const [name, runs] of Object.entries(results)) {
    console.log(`${name} (3000 ticks × 5): p99 ${median(runs, 'p99').toFixed(3)} ms, mean ${median(runs, 'mean').toFixed(3)} ms`);
    if (name === 'loaded') console.log(`payload-ticks: riding ${runs[0].riding}, towing ${runs[0].towing}`);
  }
  for (const key of ['p99', 'mean']) {
    const ratio = median(results.on, key) / median(results.off, key);
    console.log(`AI-only on/off ${key}: ${ratio.toFixed(3)}`);
    assert(ratio <= 1.10, `AI-only ${key} exceeds 1.10×: ${ratio}`);
  }
} else {
  for (const key of variants) run(key, 2);
}
