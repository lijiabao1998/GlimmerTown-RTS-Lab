// R108: winner timing is independent of harmless smoke. Groups run alone for source-mutation controls.
import assert from 'node:assert/strict';
import { createWorld, hashWorld, center, idx, N, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER,
  UK_INFANTRY, BK_HQ, ORD_IDLE, SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SMOKE_LIFETIME } from '../src/sim/smoke.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS, runScript } from '../src/sim/script.ts';

const only = process.argv[2]; let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; groups++; fn(); console.log(`OK smoke-winner/${name}`); };
const HOW = UNIT_KINDS[UK_HOWITZER], HOLD = HOW.reload * 1000;
const DIST = Math.floor((HOW.minRange + HOW.range) / (2 * SUB)), TARGET_X = 2 + DIST;
const AP_DIST = Math.floor(HOW.minRange / SUB) + 1, AP_T = Math.max(2, AP_DIST), SMOKE_T = 20 + 2 * DIST;
const SMALL_T = Math.max(1, Math.floor(DIST / 3)), LAST_T = AP_T + SMALL_T;
const blank = () => {
  const w = createWorld(1944); w.blds = []; w.occ.fill(0); w.crater.fill(0); w.ter.fill(0);
  w.units = []; w.shells = []; w.events = []; w.winner = -1; return w;
};
const add = (w, side, kind, x, z, hp = 1) => {
  const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp, alive: true,
    order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: HOLD, aimX: SUB, aimZ: 0 };
  w.units.push(u); return u;
};
const hq = (w, side, x, z) => {
  const b = { id: w.blds.length + 1, kind: BK_HQ, x, z, w: 1, d: 1, floors: 1, hp: 1, maxHp: 1200, builtBy: side };
  w.blds.push(b); w.occ[idx(x, z)] = b.id; return b;
};
const queue = (w, from, target, kind, T, hitBld = 0) => {
  const s = { id: w.nextShell++, side: from.side, kind, shooter: from.id, sx: from.x, sz: from.z,
    ex: target.x, ez: target.z, t: 0, T, target: target.id, hitBld };
  w.shells.push(s); return s;
};
const cloud = w => {
  w.smoke = { windX: 1, windZ: 0, clouds: [{ id: 999, side: 0, x: center(15), z: center(15), born: w.tick, expires: w.tick + SMOKE_LIFETIME }] };
};
const duel = (mode, kind = UK_HOWITZER) => {
  const w = blank(), a = add(w, 0, kind, 2, 2, mode === 'HQ' ? 100000 : 1), b = add(w, 1, UK_TANK, TARGET_X, 2, mode === 'HQ' ? 100000 : 1);
  let targets = [a, b], bases = [];
  if (mode === 'HQ') {
    bases = [hq(w, 0, 3, 5), hq(w, 1, TARGET_X, 5)];
    w.eco = { supply: [0, 0], hq: bases.map(b => b.id), queue: [[], []], prog: [0, 0] };
    targets = bases.map(b => ({ id: 0, x: center(b.x), z: center(b.z) }));
  }
  const hit = (side, from, kind, T) => queue(w, from, targets[side], kind, T, bases[side]?.id ?? 0);
  const dead = side => mode === 'HQ' ? bases[side].hp === 0 : ![a, b][side].alive;
  return { w, a, b, bases, targets, hit, dead };
};
const finishSides = (d, winner) => {
  if (winner !== 0) d.hit(0, d.b, SHELL_AP, 1);
  if (winner !== 1) d.hit(1, d.a, SHELL_AP, 1);
};
const natural = (smoke = true) => {
  const w = blank(), gun = add(w, 0, UK_HOWITZER, 2, 2, UNIT_KINDS[UK_TANK].dmgUnit), tank = add(w, 1, UK_TANK, 2 + AP_DIST, 2, UNIT_KINDS[UK_TANK].hp);
  gun.cooldown = smoke ? 0 : HOLD; tank.cooldown = 0; return w;
};
const NATURAL_LOG = [{ tick: 0, cmd: { t: 'fireAt', side: 0, ids: [1], x: TARGET_X, z: 2, ammo: 'smoke' } }];
const until = (w, tick) => { while (w.tick < tick) step(w, []); return w; };
const damageState = w => ({ hp: w.units.map(u => u.hp), blds: structuredClone(w.blds), crater: w.crater.slice() });

group('outcomes', () => {
  let cases = 0;
  for (const mode of ['units', 'HQ']) for (const winner of [0, 1, 2]) for (const reverse of [false, true]) {
    const d = duel(mode); finishSides(d, winner);
    const smoke = queue(d.w, d.a, d.targets[1], SHELL_SMOKE, SMOKE_T);
    if (reverse) d.w.shells.reverse();
    step(d.w, []);
    assert.equal(d.w.winner, winner, `${mode}: smoke-only flight must resolve ${winner} on the lethal step`);
    assert.equal(d.w.tick, 1); assert.equal(d.dead(0), winner !== 0); assert.equal(d.dead(1), winner !== 1);
    assert.deepEqual(d.w.shells, [smoke], 'only the undamaged smoke projectile remains');
    assert.equal(smoke.t, 1); assert.equal(smoke.T, SMOKE_T); assert.equal(d.w.smoke, undefined);
    if (mode === 'HQ') assert(d.w.units.every(u => u.alive), 'HQ result is independent of surviving armies');
    cases++;
  }
  for (const withSmoke of [false, true]) {
    const w = natural(withSmoke); let deathTick = null, winnerTick = null;
    for (let i = 0; i < SMOKE_T; i++) {
      step(w, !i && withSmoke ? NATURAL_LOG.map(e => e.cmd) : []);
      if (!w.units[0].alive && deathTick === null) deathTick = w.tick;
      if (w.winner >= 0) { winnerTick = w.tick; break; }
    }
    assert.equal(deathTick, AP_T, 'natural AP kills the final howitzer on its original flight tick');
    assert.equal(winnerTick, AP_T, 'natural smoke command must not postpone victory until smoke lands');
    assert.equal(w.winner, 1);
    if (withSmoke) {
      assert.equal(w.shells.length, 1); assert.equal(w.shells[0].kind, SHELL_SMOKE);
      assert.equal(w.shells[0].t, AP_T); assert.equal(w.shells[0].T, SMOKE_T);
    }
  }
  console.log(`  ${cases} immediate unit/HQ outcomes; natural death/winner tick ${AP_T}, smoke lands tick ${SMOKE_T}`);
});

group('harmful', () => {
  const kinds = [[SHELL_HE, UK_HOWITZER, 'HE'], [SHELL_AP, UK_TANK, 'AP'], [SHELL_SMALL, UK_INFANTRY, 'SMALL']];
  const miss = { id: 0, x: center(N - 2), z: center(N - 2) };
  for (const mode of ['units', 'HQ']) for (const [kind, shooter, name] of kinds) for (const side of [0, 1]) {
    const d = duel(mode, shooter); finishSides(d, 1);
    queue(d.w, [d.a, d.b][side], miss, kind, AP_T);
    while (d.w.tick < AP_T - 1) { step(d.w, []); assert.equal(d.w.winner, -1, `${mode}/${name}: harmful shell on either side still delays victory`); }
    assert(d.dead(0)); assert(!d.dead(1)); step(d.w, []);
    assert.equal(d.w.winner, 1, `${mode}/${name}: resolves on the last harmful landing`); assert.equal(d.w.shells.length, 0);
  }
  for (const mode of ['units', 'HQ']) for (const [kind, shooter, name] of kinds.slice(0, 2)) for (const withSmoke of [false, true]) {
    const d = duel(mode, shooter); d.hit(0, d.b, SHELL_AP, 1); d.hit(1, d.a, kind, AP_T);
    if (withSmoke) queue(d.w, d.a, d.targets[1], SHELL_SMOKE, SMOKE_T);
    while (d.w.tick < AP_T - 1) {
      step(d.w, []); assert(d.dead(0)); assert(!d.dead(1));
      assert.equal(d.w.winner, -1, `${mode}/${name}: lethal retaliation must be allowed to land`);
    }
    step(d.w, []); assert(d.dead(1), `${mode}/${name}: retaliation actually destroys the opposing side`);
    assert.equal(d.w.winner, 2, `${mode}/${name}: retaliatory draw resolves with smoke still airborne`);
    assert.equal(d.w.shells.length, withSmoke ? 1 : 0);
  }
  for (const mode of ['units', 'HQ']) for (const reverse of [false, true]) {
    const d = duel(mode); finishSides(d, 1);
    queue(d.w, d.a, miss, SHELL_HE, SMALL_T); queue(d.w, d.b, miss, SHELL_AP, AP_T);
    queue(d.w, d.b, miss, SHELL_SMALL, LAST_T); queue(d.w, d.a, miss, SHELL_SMOKE, SMOKE_T);
    if (reverse) d.w.shells.reverse();
    while (d.w.tick < LAST_T - 1) {
      step(d.w, []);
      assert.equal(d.w.winner, -1, `${mode}: mixed flight waits for any harmful shell, not every shell`);
    }
    step(d.w, []); assert.equal(d.w.winner, 1, `${mode}: mixed flight resolves at the last harmful tick`);
    assert.equal(d.w.tick, LAST_T); assert.deepEqual(d.w.shells.map(s => s.kind), [SHELL_SMOKE]);
  }
  console.log(`  HE/AP/SMALL wait; real HE/AP retaliatory draws at ${AP_T}; mixed last harmful tick ${LAST_T}`);
});

group('boundaries', () => {
  for (const mode of ['units', 'HQ']) for (const winner of [0, 1, 2]) {
    const d = duel(mode); finishSides(d, winner); cloud(d.w); step(d.w, []);
    assert.equal(d.w.winner, winner, `${mode}: an active cloud never delays a result`);
    assert.equal(d.w.smoke.clouds.length, 1, 'result leaves the active cloud intact');
    assert.equal(d.w.smoke.clouds[0].x, center(15) + 1);
  }
  for (const mode of ['units', 'HQ']) for (const winner of [0, 1, 2]) {
    const d = duel(mode); d.w.winner = winner;
    // Choose a subsequent battlefield outcome that disagrees with every saved winner.
    finishSides(d, (winner + 1) % 3); cloud(d.w);
    queue(d.w, d.a, d.targets[1], SHELL_SMOKE, AP_T);
    until(d.w, AP_T + 1);
    assert.equal(d.w.winner, winner, `${mode}: existing winner ${winner} stays locked after later steps and landings`);
  }
  for (const defeated of [[0], [1], [0, 1]]) for (const smoke of [false, true]) {
    const d = duel('HQ');
    for (const side of defeated) { const u = [d.a, d.b][side]; u.alive = false; u.hp = 0; }
    if (smoke) { queue(d.w, d.a, d.targets[1], SHELL_SMOKE, AP_T); cloud(d.w); }
    until(d.w, AP_T + 1);
    assert.equal(d.w.winner, -1, 'two living HQs keep battle running even after either or both armies are gone');
    assert(d.bases.every(b => b.hp > 0));
  }
  const d = duel('units'); queue(d.w, d.a, d.targets[1], SHELL_SMOKE, AP_T); until(d.w, AP_T + 1);
  assert.equal(d.w.winner, -1, 'smoke alone cannot end a battle with both armies alive');
});

// Independent mulberry32 reference: no tested RNG/smoke function supplies expected draws.
const draw = state => {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0; let v = state.rng;
  v = Math.imul(v ^ (v >>> 15), v | 1); v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
};
group('lifecycle', () => {
  const w = natural(), expected = { rng: w.rng }, radius = 2 * Math.floor(DIST * SUB / 12);
  const ex = center(TARGET_X) + Math.floor(draw(expected) * (2 * radius + 1)) - radius;
  const ez = center(2) + Math.floor(draw(expected) * (2 * radius + 1)) - radius;
  step(w, NATURAL_LOG.map(e => e.cmd));
  const smoke = w.shells.find(s => s.kind === SHELL_SMOKE), shot = structuredClone(smoke);
  assert(smoke, 'natural command launches a smoke shell');
  assert.deepEqual([smoke.ex, smoke.ez, smoke.T, smoke.t], [ex, ez, SMOKE_T, 1], 'smoke dispersion and original flight remain unchanged');
  assert.equal(w.rng, expected.rng, 'launch draws dispersion only');
  until(w, AP_T); assert.equal(w.winner, 1); const afterDeath = damageState(w);
  while (w.tick < SMOKE_T - 1) {
    step(w, []); assert.equal(w.winner, 1); assert.equal(w.smoke, undefined, 'no cloud before scheduled landing');
    assert.equal(w.rng, expected.rng, 'no RNG draw while settled smoke is airborne');
    assert.deepEqual(w.shells, [{ ...shot, t: w.tick }], 'settled battle preserves every smoke flight field');
  }
  const direction = Math.floor(draw(expected) * 4), [windX, windZ] = [[1, 0], [-1, 0], [0, 1], [0, -1]][direction];
  step(w, []); assert.equal(w.shells.length, 0, 'smoke lands on its original tick after winner is set');
  const born = SMOKE_T - 1, expires = born + SMOKE_LIFETIME;
  assert.deepEqual(w.smoke, { windX, windZ, clouds: [{ id: smoke.id, side: 0, x: ex + windX, z: ez + windZ, born, expires }] }, 'post-result landing keeps seeded wind, drift and exact lifetime');
  assert.equal(w.rng, expected.rng, 'first landing draws exactly one wind value');
  assert.deepEqual(damageState(w), afterDeath, 'smoke remains harmless after the result');
  assert(!w.events.some(e => ['impact', 'stage', 'kill'].includes(e.e)), 'landing produces no damage events');
  until(w, expires - 1);
  assert.equal(w.smoke.clouds.length, 1, 'cloud survives until one tick before its original expiry');
  const limit = N * SUB - 1, age = w.tick - born;
  assert.deepEqual([w.smoke.clouds[0].x, w.smoke.clouds[0].z], [Math.max(0, Math.min(limit, ex + age * windX)), Math.max(0, Math.min(limit, ez + age * windZ))], 'post-result cloud keeps drifting normally');
  step(w, []); assert.equal(w.smoke.clouds.length, 0, 'cloud expires on its original tick');
  const second = queue(w, w.units[0], { id: 0, x: center(15), z: center(15) }, SHELL_SMOKE, 1); step(w, []);
  assert.equal(w.smoke.clouds[0].id, second.id, 'later smoke still lands after an empty-cloud interval');
  assert.deepEqual([w.smoke.windX, w.smoke.windZ], [windX, windZ]);
  assert.equal(w.rng, expected.rng, 'retained wind never consumes a replacement draw'); assert.equal(w.winner, 1);
});

const trace = (w, log, end, useRunLog = false, rows = []) => {
  while (w.tick < end) {
    if (useRunLog) runLog(w, log, w.tick + 1);
    else step(w, log.filter(e => e.tick === w.tick).map(e => e.cmd));
    rows.push({ tick: w.tick, winner: w.winner, hash: hashWorld(w) });
  }
  return { w, rows };
};
group('replay', () => {
  const end = SMOKE_T + SMOKE_LIFETIME + 1;
  const a = trace(natural(), NATURAL_LOG, end), again = trace(natural(), NATURAL_LOG, end);
  const json = trace(natural(), JSON.parse(JSON.stringify(NATURAL_LOG)), end, true);
  assert.deepEqual(again.rows, a.rows, 'repeat preserves every winner tick and world hash');
  assert.deepEqual(json.rows, a.rows, 'JSON commands through runLog preserve every winner tick and world hash');
  assert.equal(a.rows.find(r => r.winner >= 0)?.tick, AP_T, 'replay must preserve the corrected victory tick');
  for (const checkpoint of [AP_T - 1, AP_T, SMOKE_T + 1]) {
    const mid = trace(natural(), NATURAL_LOG, checkpoint), copy = structuredClone(mid.w);
    assert.equal(mid.w.winner, checkpoint < AP_T ? -1 : 1);
    if (checkpoint < SMOKE_T) assert(mid.w.shells.some(s => s.kind === SHELL_SMOKE), 'clone contains airborne smoke');
    else assert(mid.w.smoke.clouds.length, 'clone contains an active post-result cloud');
    const restored = trace(copy, NATURAL_LOG, end, true, mid.rows.slice()); trace(mid.w, NATURAL_LOG, end, false, mid.rows);
    assert.deepEqual(restored.rows, a.rows, `clone at tick ${checkpoint} preserves every winner tick and hash`);
    assert.deepEqual(mid.rows, a.rows, 'original branch also matches uninterrupted execution');
  }
  for (const mode of ['units', 'HQ']) {
    const d = duel(mode); d.hit(0, d.b, SHELL_AP, 1); d.hit(1, d.a, SHELL_HE, AP_T); queue(d.w, d.a, d.targets[1], SHELL_SMOKE, SMOKE_T);
    const first = trace(structuredClone(d.w), [], SMOKE_T + 1), repeat = trace(structuredClone(d.w), [], SMOKE_T + 1);
    assert.deepEqual(first.rows, repeat.rows, `${mode}: fixed mixed fixture replays identically`);
    assert.equal(first.rows.find(r => r.winner >= 0)?.tick, AP_T); assert.equal(first.w.winner, 2);
    const changed = structuredClone(first.w); changed.winner = 1;
    assert.notEqual(hashWorld(changed), hashWorld(first.w), 'world hash must distinguish the recorded winner');
  }
});

// Independent frozen seven-command fixture, never derived from the current SCRIPT.
const LEGACY_SCRIPT = [
  { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } },
  { tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [1, 2], target: 5 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [3], target: 6 } },
  { tick: 500, cmd: { t: 'move', side: 1, ids: [5, 6, 7], x: 14, z: 12 } },
  { tick: 700, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 9, z: 9 } },
  { tick: 900, cmd: { t: 'fireAt', side: 0, ids: [4], x: 6, z: 6 } },
];
group('compatibility', () => {
  for (const [tick, expected] of [[600, '34478c82'], [1200, '0c40171b']]) {
    const w = runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, tick);
    assert.equal(hashWorld(w), expected, `independent seven-command legacy hash at ${tick}`);
    assert.equal(w.smoke, undefined, 'legacy worlds need no smoke-state migration');
  }
  assert.deepEqual(SCRIPT.filter(e => e.cmd.ammo !== 'smoke'), LEGACY_SCRIPT, 'current SCRIPT preserves every legacy command');
  assert.equal(hashWorld(runScript(SCRIPT_TICKS)), '79fc3ae3', 'existing smoke SCRIPT golden is unchanged by result-only fix');
  console.log('  legacy 600/1200 = 34478c82/0c40171b; existing SCRIPT 1200 = 79fc3ae3');
});
assert(groups > 0, `unknown smoke-winner group ${only}`);
console.log(`smoke-winner: ${groups} groups passed`);
