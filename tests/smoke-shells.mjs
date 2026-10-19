// R107 pure-simulation guards. Each group runs alone for isolated negative controls.
import assert from 'node:assert/strict';
import { createWorld, hashWorld, N, SUB, center, idx, blocks, speedPct, UNIT_KINDS,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_MORTAR, BK_HOUSE, ORD_IDLE, ORD_MOVE, ORD_ATTACK, ORD_FIRE_AT,
  SHELL_HE, SHELL_AP, SHELL_SMOKE } from '../src/sim/world.ts';
import { applyCommand, step, runLog, spotted, firstBlock, FIRE_AT_ROUNDS } from '../src/sim/step.ts';
import { SMOKE_RADIUS, SMOKE_LIFETIME, SMOKE_CAP, smokeBlocks, spawnSmoke } from '../src/sim/smoke.ts';
import { SCRIPT, SCRIPT_SEED, runScript } from '../src/sim/script.ts';
import { randInt, randSym } from '../src/sim/rng.ts';
import { findPath } from '../src/sim/path.ts';

const only = process.argv[2]; let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; groups++; fn(); console.log(`OK smoke-shells/${name}`); };
const K = UNIT_KINDS[UK_HOWITZER], HOLD = K.reload * 1000;
const DIST_CELLS = Math.floor((K.minRange + K.range) / (2 * SUB)), TARGET_X = 2 + DIST_CELLS;
const blank = (seed = 1944) => { const w = createWorld(seed); w.blds = []; w.occ.fill(0); w.crater.fill(0); w.ter.fill(0); w.units = []; w.shells = []; w.events = []; w.winner = -1; return w; };
const add = (w, side, kind, x, z) => { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: 100000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: HOLD, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
const building = (w, x, z) => { const b = { id: w.blds.length + 1, kind: BK_HOUSE, x, z, w: 1, d: 1, floors: 1, hp: 100000, maxHp: 100000 }; w.blds.push(b); w.occ[idx(x, z)] = b.id; return b; };
const setup = () => { const w = blank(), gun = add(w, 0, UK_HOWITZER, 2, 2); gun.cooldown = 0; return { w, gun }; };
const fire = id => ({ t: 'fireAt', side: 0, ids: [id], x: TARGET_X, z: 2, ammo: 'smoke' });
const run = (w, n) => { for (let i = 0; i < n; i++) step(w, []); return w; };
const queue = (w, gun, x, z, kind = SHELL_SMOKE, T = 1) => { const shell = { id: w.nextShell++, side: gun.side, kind, shooter: gun.id, sx: gun.x, sz: gun.z, ex: x, ez: z, t: 0, T, target: 0, hitBld: 0 }; w.shells.push(shell); return shell; };
const cloud = (w, x, z, extra = {}) => { w.smoke = { windX: 1, windZ: 0, clouds: [{ id: 90, side: 0, x, z, born: w.tick, expires: w.tick + SMOKE_LIFETIME, ...extra }] }; return w.smoke.clouds[0]; };

// Independent, frozen seven-command fixture: never derive legacy commands from production SCRIPT.
// R115 adds only counterbattery memory. Keep the historical combat hashes as independent anchors;
// strip that one new informational field from a shallow copy, never from the tested world.
const legacyCombatHash = w => { const old = { ...w }; delete old.counterbattery; return hashWorld(old); };
const LEGACY_SCRIPT = [
  { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } },
  { tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [1, 2], target: 5 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [3], target: 6 } },
  { tick: 500, cmd: { t: 'move', side: 1, ids: [5, 6, 7], x: 14, z: 12 } },
  { tick: 700, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 9, z: 9 } },
  { tick: 900, cmd: { t: 'fireAt', side: 0, ids: [4], x: 6, z: 6 } },
];

group('commands', () => {
  const { w, gun } = setup(), tank = add(w, 0, UK_TANK, 3, 3), mortar = add(w, 0, UK_MORTAR, 4, 4), observer = add(w, 0, UK_OBSERVER, 5, 5), foe = add(w, 1, UK_HOWITZER, 6, 6), dead = add(w, 0, UK_HOWITZER, 7, 7); dead.alive = false;
  building(w, TARGET_X, 2);
  applyCommand(w, { ...fire(gun.id), ids: [gun.id, gun.id, tank.id, mortar.id, observer.id, foe.id, dead.id, 0, 999] });
  assert.equal(gun.fireAmmo, SHELL_SMOKE, 'eligible howitzer accepts smoke'); assert.equal(gun.target, FIRE_AT_ROUNDS, 'building smoke order remains finite');
  for (const u of [tank, mortar, observer, foe, dead]) { assert.equal(u.order, ORD_IDLE, 'mixed/wrong-side/dead unit is unchanged'); assert.equal(u.fireAmmo, undefined); }
  const before = structuredClone(gun);
  for (const bad of [{ ...fire(gun.id), x: 2, z: 2 }, { ...fire(gun.id), ammo: 'unknown' }, { t: 'attack', side: 0, ids: [gun.id], target: tank.id }]) { applyCommand(w, bad); assert.deepEqual(gun, before, 'invalid replacement preserves accepted smoke order'); }
  foe.x = center(TARGET_X); foe.z = center(2);
  for (const cmd of [{ t: 'stop', side: 0, ids: [gun.id] }, { t: 'move', side: 0, ids: [gun.id], x: 4, z: 3 }, { t: 'attack', side: 0, ids: [gun.id], target: foe.id }, { t: 'fireAt', side: 0, ids: [gun.id], x: TARGET_X, z: 2 }]) {
    applyCommand(w, fire(gun.id)); applyCommand(w, cmd); assert.equal(gun.fireAmmo, undefined, `${cmd.t} clears smoke ammo`);
  }
  const v = setup(); step(v.w, [{ ...fire(v.gun.id), ammo: undefined }]); assert.equal(v.w.shells[0].kind, SHELL_HE, 'missing ammo keeps HE');
});

group('ballistics', () => {
  const { w, gun } = setup(); gun.ranging = { x: gun.x, z: gun.z, ax: center(TARGET_X), az: center(2), target: 0, epoch: 17, seen: 8 };
  const observer = add(w, 0, UK_OBSERVER, TARGET_X, 3), expected = { rng: w.rng }, r = Math.floor(DIST_CELLS * SUB / 12);
  const ex = center(TARGET_X) + randSym(expected, r), ez = center(2) + randSym(expected, r);
  applyCommand(w, fire(gun.id)); gun.ranging.seen = 8; // stale saved correction must never sharpen smoke
  step(w, []); const shot = w.shells[0];
  assert.equal(shot.kind, SHELL_SMOKE); assert.equal(shot.ex, ex, 'smoke never uses HE ranging accuracy'); assert.equal(shot.ez, ez); assert.equal(shot.rangingEpoch, undefined, 'smoke shell never carries HE ranging epoch');
  assert.equal(shot.T, 20 + 2 * DIST_CELLS, 'same howitzer flight time'); assert.equal(gun.cooldown, K.reload, 'same howitzer reload'); assert.equal(w.smoke, undefined, 'launch does not choose wind'); assert.equal(w.rng, expected.rng, 'only normal dispersion is drawn before landing');
  observer.alive = false;
  const v = setup(); v.gun.x = center(0); v.gun.z = center(0);
  const cmd = { ...fire(v.gun.id), x: N - 1, z: N - 1 };
  assert(Math.hypot(center(N - 1) - v.gun.x, center(N - 1) - v.gun.z) > K.range, 'fixture begins outside weapon range');
  let fired = false;
  const cap = Math.ceil(3 * N * SUB * 100 / (K.speed * 45));
  for (let i = 0; i < cap && !fired; i++) {
    step(v.w, i ? [] : [cmd]);
    if (v.w.events.some(e => e.e === 'fire')) { fired = true; assert.equal(v.gun.pathIdx, v.gun.path.length, 'must stop before firing'); const d = Math.floor(Math.hypot(center(N - 1) - v.gun.x, center(N - 1) - v.gun.z)); assert(d >= K.minRange && d <= K.range, 'original range bounds'); }
    else if (v.gun.pathIdx < v.gun.path.length) assert.equal(v.w.shells.length, 0, 'cannot shoot on the move');
  }
  assert(fired, 'out-of-range order approaches and fires');
});

group('volley', () => {
  for (const atBuilding of [false, true]) {
    const { w, gun } = setup(); if (atBuilding) building(w, TARGET_X, 2);
    const fired = [], kinds = [];
    for (let i = 0; i < K.reload * (FIRE_AT_ROUNDS + 2); i++) { step(w, i ? [] : [fire(gun.id)]); if (w.events.some(e => e.e === 'fire' && e.unit === gun.id)) { fired.push(w.tick); kinds.push(w.shells.at(-1).kind); } }
    assert.equal(fired.length, FIRE_AT_ROUNDS, 'smoke finishes four rounds including standing buildings'); assert(kinds.every(k => k === SHELL_SMOKE));
    assert.deepEqual(fired, Array.from({ length: FIRE_AT_ROUNDS }, (_, i) => 1 + i * K.reload), 'exact original reload cadence');
    assert.equal(gun.order, ORD_IDLE); assert.equal(gun.fireAmmo, undefined, 'completion cannot leak ammo into automatic fire'); assert.equal(gun.target, 0);
    if (atBuilding) assert.equal(w.blds[0].hp, w.blds[0].maxHp);
    const enemy = add(w, 1, UK_TANK, TARGET_X, 2); add(w, 0, UK_OBSERVER, TARGET_X, 3);
    run(w, SMOKE_LIFETIME + K.reload); assert(w.shells.every(s => s.kind !== SHELL_SMOKE), 'subsequent automatic fire is never smoke'); assert(enemy.hp < 100000, 'ordinary HE automatic fire resumes');
  }
});

group('harmless', () => {
  for (const withBuilding of [false, true]) {
    const { w, gun } = setup(); gun.cooldown = HOLD; const target = add(w, 1, UK_TANK, TARGET_X, 2); add(w, 0, UK_OBSERVER, TARGET_X, 3); if (withBuilding) building(w, TARGET_X, 2);
    gun.order = ORD_FIRE_AT; gun.fireAmmo = SHELL_SMOKE; gun.target = FIRE_AT_ROUNDS; gun.tx = TARGET_X; gun.tz = 2;
    gun.ranging = { x: gun.x, z: gun.z, ax: target.x, az: target.z, target: 0, epoch: 8, seen: 3 };
    const s = queue(w, gun, target.x, target.z); s.rangingEpoch = 8;
    const hp = w.units.map(u => u.hp), blds = structuredClone(w.blds), craters = w.crater.slice(); step(w, []);
    assert.deepEqual(w.units.map(u => u.hp), hp, 'smoke damage must be zero'); assert.deepEqual(w.blds, blds, 'smoke cannot damage houses'); assert.deepEqual(w.crater, craters, 'smoke never digs a crater');
    assert.equal(gun.ranging.seen, 3, 'smoke impacts never calibrate high explosive'); assert(!w.events.some(e => e.e === 'impact' || e.e === 'stage' || e.e === 'kill'), 'no explosion or damage events'); assert.equal(w.smoke.clouds.length, 1);
  }
  const { w, gun } = setup(); gun.cooldown = HOLD; const target = add(w, 1, UK_TANK, TARGET_X, 2); queue(w, gun, target.x, target.z, SHELL_HE); step(w, []);
  assert(target.hp < 100000, 'HE damage remains live'); assert.equal(w.crater[idx(TARGET_X, 2)], 1, 'HE crater remains live');
});

group('ranging_transition', () => {
  for (const switchBack of [false, true]) {
    const { w, gun } = setup(); add(w, 0, UK_OBSERVER, TARGET_X, 3);
    step(w, [{ ...fire(gun.id), ammo: undefined }]); const old = w.shells[0], epoch = gun.ranging.epoch;
    gun.ranging.seen = 5; gun.cooldown = HOLD;
    applyCommand(w, { ...fire(gun.id), z: 4 });
    assert(gun.ranging.epoch > epoch, 'entering smoke invalidates old HE generation'); assert.equal(gun.ranging.seen, 0, 'smoke resets existing HE correction');
    if (switchBack) { applyCommand(w, { ...fire(gun.id), ammo: undefined }); step(w, []); assert(gun.ranging.epoch > epoch, 'returning to old aim cannot reuse old shell epoch'); }
    old.ex = center(TARGET_X); old.ez = center(2); old.T = old.t + 1; step(w, []);
    assert.equal(gun.ranging.seen, 0, 'old in-flight HE cannot calibrate smoke or resumed HE');
  }
});

group('lifecycle', () => {
  assert.equal(SMOKE_RADIUS, 2 * SUB); assert.equal(SMOKE_LIFETIME, 400); assert.equal(SMOKE_CAP, 8);
  const { w, gun } = setup(); gun.cooldown = HOLD; const before = w.rng; queue(w, gun, -1, center(2)); step(w, []); assert.equal(w.smoke, undefined, 'invalid landing never sets wind'); assert.equal(w.rng, before);
  const expected = { rng: w.rng }, direction = randInt(expected, 4), born = w.tick, shell = queue(w, gun, center(10), center(10)); step(w, []);
  const s = w.smoke, c = s.clouds[0], want = [[1, 0], [-1, 0], [0, 1], [0, -1]][direction];
  assert.deepEqual([s.windX, s.windZ], want, 'seeded cardinal wind'); assert.equal(w.rng, expected.rng, 'first valid landing draws wind exactly once');
  assert.deepEqual(c, { id: shell.id, side: 0, x: center(10) + want[0], z: center(10) + want[1], born, expires: born + 400 });
  const windRng = w.rng; queue(w, gun, center(14), center(14)); step(w, []); assert.equal(w.rng, windRng, 'later landings preserve wind and RNG');
  while (w.tick < c.expires - 1) step(w, []); assert(w.smoke.clouds.some(x => x.id === c.id), 'exists just before expiry'); step(w, []); assert(!w.smoke.clouds.some(x => x.id === c.id), 'gone on exact expiry tick');
  run(w, SMOKE_LIFETIME); assert.equal(w.smoke.clouds.length, 0); const savedWind = [w.smoke.windX, w.smoke.windZ]; queue(w, gun, center(16), center(16)); step(w, []); assert.deepEqual([w.smoke.windX, w.smoke.windZ], savedWind, 'wind persists across empty intervals'); assert.equal(w.rng, windRng);
  for (const [windX, windZ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const v = blank(), edge = windX + windZ > 0 ? N * SUB - 1 : 0; cloud(v, edge, edge); v.smoke.windX = windX; v.smoke.windZ = windZ; run(v, 10);
    assert.deepEqual([v.smoke.clouds[0].x, v.smoke.clouds[0].z], [edge, edge], 'drift clamps at map edge');
  }
  const v = setup(); v.gun.cooldown = HOLD; for (let i = 0; i < SMOKE_CAP + 3; i++) queue(v.w, v.gun, center(10), center(10)); step(v.w, []);
  assert.equal(v.w.smoke.clouds.length, 8); assert.deepEqual(v.w.smoke.clouds.map(c => c.id), [4, 5, 6, 7, 8, 9, 10, 11], 'same-tick cap drops oldest landings');
});

group('geometry', () => {
  const w = blank(), c = cloud(w, center(10), center(10)), R = 2 * SUB;
  assert(smokeBlocks(w, c.x - 4 * SUB, c.z + R, c.x + 4 * SUB, c.z + R), 'exact tangent blocks');
  assert(!smokeBlocks(w, c.x - 4 * SUB, c.z + R + 1, c.x + 4 * SUB, c.z + R + 1), 'one integer outside tangent clears');
  assert(smokeBlocks(w, c.x, c.z, c.x, c.z), 'zero-length point inside blocks'); assert(!smokeBlocks(w, c.x + R + 1, c.z, c.x + R + 1, c.z), 'zero-length outside clears');
  let pairs = 0;
  for (let ax = 1; ax < N; ax += 5) for (let az = 1; az < N; az += 5) for (let bx = 0; bx < N; bx += 5) for (let bz = 0; bz < N; bz += 5) {
    const a = [center(ax), center(az)], b = [center(bx), center(bz)], dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((c.x - a[0]) * dx + (c.z - a[1]) * dz) / len)) : 0;
    const distance = Math.hypot(c.x - a[0] - t * dx, c.z - a[1] - t * dz), got = smokeBlocks(w, ...a, ...b);
    assert.equal(got, smokeBlocks(w, ...b, ...a), 'segment direction is symmetric'); assert.equal(got, distance <= R + 1e-9, 'independent closest-point oracle'); pairs++;
  }
  const limit = N * SUB - 1; let maxCross2 = 0;
  for (const ax of [0, limit]) for (const az of [0, limit]) for (const bx of [0, limit]) for (const bz of [0, limit]) for (const cx of [0, limit]) for (const cz of [0, limit]) {
    c.x = cx; c.z = cz; const cross = (cx - ax) * (bz - az) - (cz - az) * (bx - ax); maxCross2 = Math.max(maxCross2, cross * cross); assert(Number.isSafeInteger(cross * cross)); assert.equal(smokeBlocks(w, ax, az, bx, bz), smokeBlocks(w, bx, bz, ax, az));
  }
  console.log(`  ${pairs} independent geometry pairs; max cross² ${maxCross2} < ${Number.MAX_SAFE_INTEGER}`);
});

group('visibility', () => {
  const w = blank(), a = add(w, 0, UK_TANK, 4, 10), b = add(w, 1, UK_TANK, 12, 10), c = cloud(w, center(8), center(10));
  assert.equal(spotted(w, 0, b.x, b.z), false, 'smoke blocks target'); assert.equal(spotted(w, 1, a.x, a.z), false, 'both sides share smoke visibility');
  assert.equal(spotted(w, 0, c.x, c.z), false, 'cloud center does not reveal enemies'); assert.equal(spotted(w, 0, c.x, c.z, c.id), true, 'surface-only ignore can draw cloud');
  w.smoke.clouds.push({ ...c, id: 91, x: center(6) }); assert.equal(spotted(w, 0, c.x, c.z, c.id), false, 'surface ignore does not ignore other clouds'); w.smoke.clouds.pop();
  step(w, []); assert.equal(w.shells.length, 0, 'occluded target is not automatically fired upon');
  const sideView = add(w, 0, UK_TANK, 12, 5); assert.equal(spotted(w, 0, b.x, b.z), true, 'another friendly angle reopens observation'); sideView.alive = false;
  a.x = c.x; a.z = c.z; assert.equal(spotted(w, 0, b.x, b.z), false, 'inside observer cannot see outward'); a.x = center(4); b.x = c.x; b.z = c.z; assert.equal(spotted(w, 0, b.x, b.z), false, 'inside target stays hidden');
  const before = hashWorld(w); for (let i = 0; i < 30; i++) spotted(w, 0, b.x, b.z); assert.equal(hashWorld(w), before, 'visibility is a pure query');
  const v = blank(), va = add(v, 0, UK_TANK, 4, 10), vb = add(v, 1, UK_TANK, 12, 10), vc = cloud(v, center(8), center(10) + SMOKE_RADIUS - 1); v.smoke.windX = 0; v.smoke.windZ = 1;
  assert.equal(spotted(v, 0, vb.x, vb.z), false); run(v, 2); assert.equal(spotted(v, 0, vb.x, vb.z), true, 'drift immediately restores old ray'); vc.x = center(8); vc.z = center(10); vc.expires = v.tick + 1;
  assert.equal(spotted(v, 0, vb.x, vb.z), false); step(v, []); assert.equal(spotted(v, 0, vb.x, vb.z), true, 'expiry immediately restores ray'); assert(va.alive);
});

group('physical', () => {
  const w = blank(), tank = add(w, 0, UK_TANK, 4, 10), enemy = add(w, 1, UK_TANK, 12, 10); tank.cooldown = 0;
  const path = findPath(w, 4, 10, 12, 10), speed = speedPct(w, 8, 10); cloud(w, center(8), center(10));
  assert.equal(firstBlock(w, tank.x, tank.z, enemy.x, enemy.z), -1, 'smoke never blocks physical rays'); assert.equal(blocks(w, 8, 10), false); assert.equal(speedPct(w, 8, 10), speed); assert.deepEqual(findPath(w, 4, 10, 12, 10), path, 'pathfinding unchanged');
  step(w, [{ t: 'attack', side: 0, ids: [tank.id], target: enemy.id }]); assert.equal(w.shells[0].kind, SHELL_AP, 'explicit last-coordinate blind fire remains possible');
  const lastX = tank.tx, lastZ = tank.tz; enemy.x += SUB; step(w, []); assert.equal(tank.tx, lastX, 'hidden movement cannot update last known x'); assert.equal(tank.tz, lastZ);
  const shot = w.shells[0]; enemy.x = shot.ex; enemy.z = shot.ez; const hp = enemy.hp; run(w, shot.T); assert(enemy.hp < hp, 'physical AP crosses smoke and still damages');
  const wall = building(w, 6, 10); assert.equal(firstBlock(w, tank.x, tank.z, enemy.x, enemy.z), idx(6, 10), 'real building ray remains unchanged');
  tank.cooldown = 0; step(w, [{ t: 'attack', side: 0, ids: [tank.id], target: enemy.id }]); assert.equal(w.shells[0].hitBld, wall.id); const wallHp = wall.hp; run(w, w.shells[0].T); assert(wall.hp < wallHp, 'real wall still catches AP');
});

group('hashing', () => {
  const { w, gun } = setup(); applyCommand(w, fire(gun.id)); cloud(w, center(10), center(10)); const before = hashWorld(w);
  for (const key of ['windX', 'windZ']) { const c = structuredClone(w); c.smoke[key]++; assert.notEqual(hashWorld(c), before, `hash includes ${key}`); }
  for (const key of ['id', 'side', 'x', 'z', 'born', 'expires']) { const c = structuredClone(w); c.smoke.clouds[0][key]++; assert.notEqual(hashWorld(c), before, `hash includes cloud ${key}`); }
  { const c = structuredClone(w); c.smoke.clouds.push({ ...c.smoke.clouds[0], id: 91 }); assert.notEqual(hashWorld(c), before, 'hash includes cloud count and order'); }
  { const c = structuredClone(w); c.units[0].fireAmmo++; assert.notEqual(hashWorld(c), before, 'hash includes pending ammo'); }
  { const c = structuredClone(w); delete c.smoke; assert.notEqual(hashWorld(c), before, 'hash includes optional smoke presence'); }
  const v = blank(), noSmoke = hashWorld(v); v.smoke = { windX: 1, windZ: 0, clouds: [] }; assert.notEqual(hashWorld(v), noSmoke, 'retained wind without clouds is persistent state');
});

group('replay', () => {
  const log = [{ tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 24, z: 24, ammo: 'smoke' } }, { tick: 510, cmd: { t: 'stop', side: 0, ids: [4] } }];
  const a = runLog(createWorld(SCRIPT_SEED), log, 650), b = runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(log)), 650), halfway = runLog(createWorld(SCRIPT_SEED), log, 200), copied = structuredClone(halfway);
  assert(halfway.smoke?.clouds.length, 'clone fixture contains live smoke'); runLog(halfway, log, 650); runLog(copied, log, 650);
  assert.deepEqual([hashWorld(a), hashWorld(b), hashWorld(halfway), hashWorld(copied)], Array(4).fill(hashWorld(a)), 'JSON, fresh rerun and mid-smoke clone agree');
  const legacy = createWorld(SCRIPT_SEED); assert.equal(legacy.smoke, undefined); assert(legacy.units.every(u => u.fireAmmo === undefined)); runLog(legacy, LEGACY_SCRIPT, 350); const saved = structuredClone(legacy); runLog(legacy, LEGACY_SCRIPT, 600); runLog(saved, LEGACY_SCRIPT, 600); assert.equal(hashWorld(legacy), hashWorld(saved), 'old worlds need no migration'); assert.equal(legacy.smoke, undefined, 'no smoke order never initializes state');
});

group('legacy_script', () => {
  assert.equal(LEGACY_SCRIPT.length, 7); assert.equal(legacyCombatHash(runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, 600)), '14108ab2', 'independent seven-command 600 baseline');
  assert.equal(legacyCombatHash(runLog(createWorld(SCRIPT_SEED), LEGACY_SCRIPT, 1200)), 'd22b1d45', 'independent seven-command 1200 baseline');
  assert.deepEqual(SCRIPT.filter(e => e.cmd.ammo !== 'smoke'), LEGACY_SCRIPT, 'new script preserves every original command verbatim');
  assert(SCRIPT.some(e => e.tick === 500 && e.cmd.t === 'fireAt' && e.cmd.side === 0 && e.cmd.ids[0] === 4 && e.cmd.x === 24 && e.cmd.z === 24 && e.cmd.ammo === 'smoke'), 'late smoke scenario present');
  const w = runScript(600); assert(w.smoke?.clouds.some(c => c.expires > w.tick), 'existing CI 30-second snapshot actually includes persistent smoke'); console.log(`  legacy 14108ab2/d22b1d45; new 600 ${hashWorld(w)}, 1200 ${hashWorld(runScript(1200))}`);
});
assert(groups > 0, `unknown group ${only}`); console.log(`smoke-shells: ${groups} groups passed`);
