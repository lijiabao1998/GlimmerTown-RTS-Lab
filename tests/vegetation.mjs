// R116：可獨跑的語意群組；固定舊世界指紋來自 main f5d4211，而非受測實作。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, N, SUB, idx, cellOf, center, blocks, speedPct, bldMaxHp,
  UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_INFANTRY, UK_OBSERVER, UK_HEAVY, ORD_IDLE,
  BK_HOUSE, BK_COTTAGE, BK_PILLBOX, BK_HQ, SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE, TER_ROAD, TER_MUD } from '../src/sim/world.ts';
import { step, runLog, spotted, firstBlock, lineCells } from '../src/sim/step.ts';
import { applyMap } from '../src/sim/maps.ts';
import { applyBuild, buildError, enemyPlan, stillConnected, BUILD_KINDS_24 } from '../src/sim/build.ts';
import { startEco } from '../src/sim/eco.ts';
import { findPath } from '../src/sim/path.ts';
import { SCRIPT, SCRIPT_SEED } from '../src/sim/script.ts';
import { randSym } from '../src/sim/rng.ts';
import { VEG_NONE, VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION, VEGETATION_MAX, vegetationAt, vegetationBlocks } from '../src/sim/vegetation.ts';
const only = process.argv[2]; let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; groups++; fn(); console.log(`OK vegetation/${name}`); };
const seeds = [1944, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const blank = () => { const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = []; w.winner = -1; w.vegetation = { version: 1, cells: new Uint8Array(N * N) }; return w; };
const put = (w, x, z, v = VEG_HEDGE) => { w.vegetation.cells[idx(x, z)] = v; };
const add = (w, side, kind, x, z) => { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: 1000000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1000000, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
const building = (w, kind, x = 10, z = 10, width = 1, depth = 1, hp) => { const maxHp = bldMaxHp(kind, width, depth, 1), b = { id: w.blds.length + 1, kind, x, z, w: width, d: depth, floors: 1, hp: hp ?? maxHp, maxHp }; w.blds.push(b); for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) w.occ[idx(x + dx, z + dz)] = b.id; return b; };
const queue = (w, g, t, kind = SHELL_AP, hitBld = 0) => w.shells.push({ id: w.nextShell++, side: g.side, kind, shooter: g.id, sx: g.x, sz: g.z, ex: t.x, ez: t.z, t: 0, T: 1, target: hitBld ? 0 : t.id, hitBld });
const hit = (w, g, t, kind = SHELL_AP, hitBld = 0) => { const hp = t.hp; queue(w, g, t, kind, hitBld); step(w, []); return hp - t.hp; };
const expected = (gun, target, cover) => { const k = UNIT_KINDS[gun], t = UNIT_KINDS[target]; return Math.floor(Math.floor(k.dmgUnit * (t.armored && !(t.openTop && k.men > 0) ? k.pierce : k.soft) / 100) * t.armor * cover / 10000); }; // R044：開頂車被步兵打照軟目標算
const worldAt = (seed, map) => { const w = createWorld(seed); applyMap(w, map, 1); return w; };

group('generation', () => {
  assert.deepEqual([VEG_NONE, VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION, VEGETATION_MAX], [0, 1, 2, 1, 64], 'generation: published schema constants');
  const counts = [];
  for (const map of [0, 1]) for (const seed of seeds) {
    const w = createWorld(seed), old = structuredClone(w); applyMap(old, map); const rng = w.rng; applyMap(w, map, 1);
    assert.equal(w.rng, rng, 'generation: never draws World.rng');
    assert(w.vegetation?.cells instanceof Uint8Array, 'generation: enabled typed cell data');
    const cells = w.vegetation.cells, nonzero = [...cells].filter(Boolean);
    assert(nonzero.includes(1) && nonzero.includes(2), 'generation: both hedges and woods on each fixed map/seed');
    assert(nonzero.length <= 64, 'generation: maximum 64 occupied cells'); assert.equal(cells.length, N * N);
    assert(nonzero.every(v => v === 1 || v === 2), 'generation: integer species only');
    for (let c = 0; c < cells.length; c++) if (cells[c]) {
      assert(!w.occ[c] && w.ter[c] !== TER_ROAD && w.ter[c] !== TER_MUD, 'generation: avoids road, mud and all building footprints');
      assert(!w.units.some(u => idx(cellOf(u.x), cellOf(u.z)) === c), 'generation: avoids every initial unit cell');
      assert.equal(blocks(w, c % N, Math.floor(c / N)), false, 'generation: vegetation does not block traversal');
      assert.equal(speedPct(w, c % N, Math.floor(c / N)), speedPct(old, c % N, Math.floor(c / N)), 'generation: speed unchanged');
    }
    assert(stillConnected(w, -9, -9, 0, 0), 'generation: all starting units remain connected');
    assert.deepEqual(findPath(w, 24, 26, 7, 5), findPath(old, 24, 26, 7, 5), 'generation: same original route');
    const vegetation = w.vegetation; delete w.vegetation; assert.deepEqual(w, old, 'generation: entire original world otherwise unchanged'); w.vegetation = vegetation;
    assert.deepEqual(w, worldAt(seed, map), 'generation: same seed/map repeats');
    const before = hashWorld(w), ref = w.vegetation; applyMap(w, map, 1); assert.equal(hashWorld(w), before, 'generation: same activation is idempotent'); assert.equal(w.vegetation, ref);
    counts.push(nonzero.length);
  }
  const occupied = createWorld(1944); occupied.units[0].x = center(1); occupied.units[0].z = center(11); applyMap(occupied, 0, 1);
  assert.equal(vegetationAt(occupied, 1, 11), 0, 'generation: custom initial unit excludes an otherwise valid candidate');
  const w = blank(); put(w, 31, 0); for (const [x, z] of [[-1, 1], [32, 0], [31, -1], [31, 32], [1.5, 0], [NaN, 0]]) assert.equal(vegetationAt(w, x, z), 0, 'generation: invalid cell cannot alias valid vegetation');
  put(w, 10, 10, 3); assert.equal(vegetationAt(w, 10, 10), 0, 'generation: unknown species is not cover'); w.vegetation.version = 2; assert.equal(vegetationAt(w, 31, 0), 0, 'generation: unknown schema is inactive');
  console.log(`  24 map/seed cases, ${Math.min(...counts)}–${Math.max(...counts)} occupied cells`);
});

group('activation', () => {
  for (const map of [0, 1]) for (const value of [undefined, 0, 2, -1, true, '1', null, 1.1]) {
    const w = createWorld(1944); applyMap(w, map, value); assert.equal(w.vegetation, undefined, 'activation: only numeric one enables');
    const command = createWorld(1944); step(command, [{ t: 'map', id: map, vegetation: value }]); assert.equal(command.vegetation, undefined, 'activation: command validates exact optional value');
  }
  for (const id of [-1, 3, 1.5, NaN, '1', null]) {
    const w = createWorld(1944); applyMap(w, id, 1); assert.equal(w.vegetation, undefined, 'activation: helper rejects invalid map id');
    step(w, [{ t: 'map', id, vegetation: 1 }]); assert.equal(w.vegetation, undefined, 'activation: command cannot coerce invalid id into enabled terrain');
  }
  for (const map of [0, 1]) {
    const w = createWorld(1944); w.tick = 1; applyMap(w, map, 1); assert.equal(w.vegetation, undefined, 'activation: helper rejects post-start enable');
    step(w, [{ t: 'map', id: map, vegetation: 1 }]); assert.equal(w.vegetation, undefined, 'activation: command rejects post-start enable');
    const pre = createWorld(1944), raw = createWorld(1944); applyMap(pre, map); applyMap(pre, map, 1); step(pre, [{ t: 'map', id: map, vegetation: 1 }]); step(raw, [{ t: 'map', id: map, vegetation: 1 }]); assert.deepEqual(pre, raw, 'activation: pre-applied legacy map plus enable matches fresh recorded map');
  }
  const rye = createWorld(1944); applyMap(rye, 1); applyMap(rye, 0, 1); assert.equal(rye.vegetation, undefined, 'activation: incompatible map request cannot enable current terrain');
  const switched = worldAt(1944, 0); applyMap(switched, 1, 1); assert.deepEqual(switched, worldAt(1944, 1), 'activation: map transition filters against final terrain');
});

group('legacy', () => {
  // SHA256 covers every tick's complete hash and RNG, not just the final checkpoint.
  const fixtures = [
    ['script', SCRIPT, '2e4bcf04bc6870f8f4f3fd9a2049b7273e24797dcdc638d3c37093eb1ff53254', ['d7b3572f', 'eea1d59b']],
    ['rye', [{ tick: 0, cmd: { t: 'map', id: 1 } }, ...SCRIPT], '475b3ca00a36bd18248d5eb1f6c843e8fdb0b9606cd95cd01de89befdd4b9c1f', ['0a324ceb', '204c47a5']],
    ['seven', SCRIPT.filter(v => !v.cmd.ammo), '15d34cb8c67198687508372646a048c5170467d58251162f7f484f852d3c4039', ['de5a5f8d', '5eb07503']],
  ];
  for (const [name, input, wanted, hashes] of fixtures) {
    const w = createWorld(SCRIPT_SEED), log = JSON.parse(JSON.stringify(input)), digest = createHash('sha256'); let copy;
    assert.equal(w.vegetation, undefined, 'legacy: createWorld never enables new terrain');
    for (let tick = 0; tick < 1200; tick++) {
      const cmds = log.filter(c => c.tick === tick).map(c => c.cmd); step(w, cmds); if (copy) { step(copy, cmds); assert.deepEqual(copy, w, 'legacy: missing-state midgame clone remains identical'); }
      digest.update(`${hashWorld(w)}:${w.rng};`);
      assert.equal(w.vegetation, undefined, 'legacy: old log never creates new persistent field');
      if (w.tick === 600 || w.tick === 1200) {
        assert.equal(hashWorld(w), hashes[w.tick === 600 ? 0 : 1], `legacy: ${name} frozen complete checkpoint`);
        if (name === 'seven') { const historical = structuredClone(w); delete historical.counterbattery; assert.equal(hashWorld(historical), w.tick === 600 ? '34478c82' : '0c40171b', 'legacy: historical seven-command combat hash'); }
      }
      if (w.tick === 600) copy = structuredClone(w);
    }
    assert.equal(digest.digest('hex'), wanted, `legacy: ${name} every-tick main f5d4211 world/RNG fingerprint`);
  }
});

group('los', () => {
  let rays = 0;
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const w = blank(), a = add(w, 0, UK_OBSERVER, 10, 10), b = add(w, 1, UK_OBSERVER, 10 + dx, 10 + dz), path = lineCells(10, 10, 10 + dx, 10 + dz);
    put(w, 10, 10); put(w, 10 + dx, 10 + dz, VEG_WOOD);
    assert(spotted(w, 0, b.x, b.z) && spotted(w, 1, a.x, a.z), 'los: same, adjacent and endpoint vegetation remain visible both ways');
    assert.equal(vegetationBlocks(w, path), false, 'los: endpoints excluded from vegetation ray');
    for (let i = 1; i + 1 < path.length; i++) {
      const c = path[i]; w.vegetation.cells[c] = 1;
      assert(!spotted(w, 0, b.x, b.z) && !spotted(w, 1, a.x, a.z), 'los: middle vegetation blocks symmetrically');
      assert(vegetationBlocks(w, path) && vegetationBlocks(w, [...path].reverse()), 'los: same supplied symmetric ray');
      assert.equal(firstBlock(w, a.x, a.z, b.x, b.z), -1, 'los: foliage never returns nonexistent building impact');
      w.vegetation.cells[c] = 0;
    }
    rays++;
  }
  const w = blank(), u = add(w, 0, UK_OBSERVER, 10, 10), b = building(w, BK_HOUSE, 10, 10, 2, 1); put(w, 12, 10);
  assert(!spotted(w, 0, center(15), center(10)), 'los: garrison cannot see through intervening foliage'); w.vegetation.cells.fill(0);
  assert(spotted(w, 0, center(15), center(10)), 'los: own multiceIl garrison remains exempt');
  const wall = building(w, BK_HOUSE, 13, 10); assert(spotted(w, 0, center(13), center(10)), 'los: blocking building itself remains visible'); assert(!spotted(w, 0, center(15), center(10)), 'los: original house still blocks behind itself'); wall.hp = 0;
  assert(spotted(w, 0, center(15), center(10)), 'los: rubble does not block');
  w.smoke = { windX: 0, windZ: 0, clouds: [{ id: 7, side: 1, x: center(13), z: center(10), born: 0, expires: 100 }] };
  assert(!spotted(w, 0, center(15), center(10)), 'los: smoke remains opaque'); assert(spotted(w, 0, center(15), center(10), 7), 'los: existing ignore-smoke query still works'); put(w, 12, 10);
  assert(!spotted(w, 0, center(15), center(10), 7), 'los: ignoring one smoke cloud never ignores foliage');
  delete w.smoke; w.vegetation.cells.fill(0); b.hp = 0;
  const far = u.x + UNIT_KINDS[u.kind].sight + 1; assert(!spotted(w, 0, far, u.z), 'los: observation distance still enforced');
  console.log(`  ${rays} symmetric rays plus smoke/building/garrison/range cases`);
});

// 只攔測試的 Array.push，按堆疊辨認原 lineCells 配置；不往正式模擬加入探針。
group('allocations', () => {
  const counts = [];
  for (const enabled of [false, true]) {
    const w = blank(); add(w, 0, UK_OBSERVER, 6, 10); if (!enabled) delete w.vegetation;
    const arrays = new Set(), push = Array.prototype.push;
    try {
      Array.prototype.push = function (...values) {
        if (new Error().stack.includes('at lineCells')) arrays.add(this);
        return Reflect.apply(push, this, values);
      };
      for (let i = 0; i < 100; i++) assert(spotted(w, 0, center(10), center(10)), 'allocations: fixture is clear in both worlds');
    } finally { Array.prototype.push = push; }
    counts.push(arrays.size);
  }
  assert.equal(counts[0], 100, 'allocations: original clear LOS creates one ray per query');
  assert.equal(counts[1], counts[0], 'allocations: enabled clear LOS reuses original single ray');
  console.log(`  100 clear queries: legacy ${counts[0]} ray arrays / enabled ${counts[1]}`);
});

group('cover', () => {
  let cases = 0;
  for (const side of [0, 1]) for (let kind = 0; kind < UNIT_KINDS.length; kind++) for (const vegetation of [0, 1, 2]) for (const crater of [0, 3]) for (const home of [null, BK_HOUSE, BK_PILLBOX]) for (const [gun, shell] of [[UK_TANK, SHELL_AP], [UK_HOWITZER, SHELL_HE], [UK_INFANTRY, SHELL_SMALL]]) {
    const w = blank(), g = add(w, 1 - side, gun, 3, 3), t = add(w, side, kind, 10, 10); put(w, 10, 10, vegetation); w.crater[idx(10, 10)] = crater;
    if (home !== null) building(w, home);
    const ground = vegetation ? 50 : crater ? 75 : 100, pct = UNIT_KINDS[kind].garrison && home !== null ? Math.min(ground, home === BK_PILLBOX ? 25 : 50) : ground;
    assert.equal(hit(w, g, t, shell), expected(gun, kind, pct), 'cover: strongest vegetation/crater/garrison protection without stacking'); cases++;
  }
  for (const kind of [BK_HOUSE, BK_PILLBOX]) {
    const w = blank(), g = add(w, 1, UK_TANK, 3, 3), t = add(w, 0, UK_OBSERVER, 10, 10), b = building(w, kind, 10, 10, 1, 1, 1); put(w, 10, 10); w.crater[idx(10, 10)] = 3;
    assert.equal(hit(w, g, t, SHELL_AP, b.id), Math.floor(20 * UNIT_KINDS[t.kind].armor / 100), 'cover: collapse bypasses all terrain protection');
  }
  for (const vegetation of [0, 1, 2]) for (const [gun, shell] of [[UK_TANK, SHELL_AP], [UK_HOWITZER, SHELL_HE]]) {
    const w = blank(), g = add(w, 1, gun, 3, 3), t = add(w, 0, UK_OBSERVER, 10, 10), b = building(w, BK_HOUSE); put(w, 10, 10, vegetation); const hp = b.hp;
    hit(w, g, t, shell, shell === SHELL_AP ? b.id : 0); assert.equal(hp - b.hp, UNIT_KINDS[gun].dmgBld, 'cover: building itself takes unchanged damage');
  }
  const w = blank(), g = add(w, 1, UK_HOWITZER, 3, 3), t = add(w, 0, UK_TANK, 10, 10); put(w, 10, 10); const before = w.vegetation.cells.slice(); assert.equal(hit(w, g, t, SHELL_SMOKE), 0, 'cover: smoke does not damage'); assert.equal(w.crater[idx(10, 10)], 0); assert.deepEqual(w.vegetation.cells, before, 'cover: smoke does not clear vegetation');
  console.log(`  ${cases} side/unit/species/crater/home/projectile combinations`);
});

group('rounding', () => {
  const gun = UNIT_KINDS[UK_HOWITZER], R = gun.splash; let distinguished = 0;
  for (let offset = 0; offset < R; offset++) {
    const w = blank(), g = add(w, 1, UK_HOWITZER, 3, 3), t = add(w, 0, UK_HEAVY, 10, 10); t.x += offset; put(w, cellOf(t.x), cellOf(t.z)); queue(w, g, t, SHELL_HE); w.shells.at(-1).ex = center(10); const hp = t.hp; step(w, []);
    const falloff = Math.floor(gun.dmgUnit * (R - offset) / R), pierced = Math.floor(falloff * gun.pierce / 100), wanted = Math.floor(pierced * UNIT_KINDS[t.kind].armor * 50 / 10000);
    assert.equal(hp - t.hp, wanted, 'rounding: blast falloff then piercing then one armor/cover floor');
    if (wanted !== Math.floor(Math.floor(pierced * 50 / 100) * UNIT_KINDS[t.kind].armor / 100)) distinguished++;
  }
  assert(distinguished > 0, 'rounding: fixture exposes early cover rounding');
  for (const [x, z, covered] of [[10 * SUB - 1, center(10), false], [10 * SUB, center(10), true], [11 * SUB - 1, center(10), true], [11 * SUB, center(10), false], [center(10), 10 * SUB - 1, false], [center(10), 10 * SUB, true], [center(10), 11 * SUB - 1, true], [center(10), 11 * SUB, false]]) {
    const w = blank(), g = add(w, 1, UK_TANK, 3, 3), t = add(w, 0, UK_TANK, 10, 10); t.x = x; t.z = z; put(w, 10, 10); assert.equal(hit(w, g, t), expected(g.kind, t.kind, covered ? 50 : 100), 'rounding: current cell boundary controls cover');
  }
  const w = blank(), g = add(w, 1, UK_TANK, 3, 3), t = add(w, 0, UK_OBSERVER, 9, 10); put(w, 10, 10); const seen = new Set();
  step(w, [{ t: 'move', side: 0, ids: [t.id], x: 11, z: 10 }]);
  const cap = Math.ceil(4 * SUB * 100 / (UNIT_KINDS[t.kind].speed * 85)) + 20;
  for (let i = 0; i < cap; i++) { const hp = t.hp; queue(w, g, t); step(w, []); const x = cellOf(t.x); seen.add(x); assert.equal(hp - t.hp, expected(g.kind, t.kind, x === 10 ? 50 : 100), 'rounding: target gets current impact cell cover after movement'); }
  assert(seen.has(9) && seen.has(10) && seen.has(11), 'rounding: target actually enters and exits vegetation');
});

group('construction', () => {
  for (const side of [0, 1]) for (const kind of [BK_COTTAGE, BK_HOUSE, BK_PILLBOX]) for (const rot of [0, 1]) {
    const w = blank(), x = side ? 5 : 24, z = side ? 5 : 24, cmd = { t: 'build', side, kind, x, z, rot }; w.vegetation.cells.fill(1); const initial = structuredClone(w), preview = structuredClone(w);
    assert.equal(buildError(w, cmd), null, 'construction: vegetation adds no build restriction'); assert.equal(applyBuild(preview, cmd), null);
    assert.deepEqual(w, initial, 'construction: discarded preview never mutates real world'); const b = preview.blds.at(-1);
    for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) assert.equal(vegetationAt(preview, x + dx, z + dz), 0, 'construction: successful build clears every footprint cell');
    assert.equal(vegetationAt(preview, x - 1, z), 1, 'construction: neighboring vegetation preserved');
    const replay = structuredClone(w); step(replay, [cmd]); step(preview, []); assert.deepEqual({ ...replay, events: [] }, { ...preview, events: [] }, 'construction: shared preview and command apply identically');
    b.hp = 0; preview.tick = 0; applyMap(preview, 0, 1); assert.equal(vegetationAt(preview, x, z), 0, 'construction: collapse and repeated activation do not regrow');
    const invalid = structuredClone(w), hash = hashWorld(invalid); assert.equal(applyBuild(invalid, { ...cmd, x: -1 }), 'map'); assert.equal(hashWorld(invalid), hash, 'construction: rejected build never clears foliage');
  }
  const hq = blank(); hq.vegetation.cells.fill(2); startEco(hq); assert(hq.eco.hq.every(Boolean), 'construction: both HQ placements succeed');
  for (const b of hq.blds) { assert.equal(b.kind, BK_HQ); for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) assert.equal(vegetationAt(hq, x, z), 0, 'construction: HQ helper clears footprint'); }
  const actual = blank(); actual.vegetation.cells.fill(2); step(actual, [{ t: 'eco' }]); step(hq, []); assert.deepEqual({ ...actual, events: [] }, { ...hq, events: [] }, 'construction: direct HQ preview and actual eco command agree');
  for (const map of [0, 1]) {
    const w = worldAt(1944, map); w.vegetation.cells.fill(1); const before = structuredClone(w), p = enemyPlan(w, BUILD_KINDS_24), old = structuredClone(w); delete old.vegetation;
    assert(p.length > 0, 'construction: enemy preview actually places buildings'); assert.deepEqual(w, before, 'construction: enemyPlan trial copy never clears caller vegetation'); assert.deepEqual(p, enemyPlan(old, BUILD_KINDS_24), 'construction: vegetation never changes planning decisions');
  }
});

group('ranging_sound', () => {
  const make = hidden => { const w = blank(), gun = add(w, 0, UK_HOWITZER, 2, 10), spotter = add(w, 0, UK_OBSERVER, 12, 10), listener = add(w, 1, UK_OBSERVER, 2, 14); gun.cooldown = 0; if (hidden) for (let z = 0; z < N; z++) put(w, 13, z); return { w, gun, spotter, listener }; };
  const fire = { t: 'fireAt', side: 0, ids: [1], x: 17, z: 10 }, clear = make(false), hidden = make(true);
  for (const scene of [clear, hidden]) {
    const rng = { rng: scene.w.rng }, d = 15 * SUB, radius = Math.floor(d / 12) * (scene === hidden ? 2 : 1), ex = center(17) + randSym(rng, radius), ez = center(10) + randSym(rng, radius);
    step(scene.w, [fire]); assert.equal(scene.w.shells[0].ex, ex, 'ranging_sound: foliage-hidden target doubles old blind-fire spread'); assert.equal(scene.w.shells[0].ez, ez);
    for (const u of scene.w.units) u.cooldown = 1000000;
    while (scene.w.shells.length) step(scene.w, []);
  }
  assert.equal(clear.gun.ranging.seen, 1, 'ranging_sound: clear impact calibrates'); assert.equal(hidden.gun.ranging.seen, 0, 'ranging_sound: vegetation-hidden impact cannot calibrate');
  const audible = make(false), muffled = make(false); for (let x = 0; x < N; x++) put(muffled.w, x, 12);
  assert(!spotted(muffled.w, 1, muffled.gun.x, muffled.gun.z), 'ranging_sound: listener really cannot see through hedge');
  step(audible.w, [fire]); step(muffled.w, [fire]); assert.deepEqual(muffled.w.counterbattery, audible.w.counterbattery, 'ranging_sound: sound reports independent of blocked visual LOS'); assert(muffled.w.counterbattery?.length, 'ranging_sound: real fire produced report');
});

group('replay_hash', () => {
  for (const map of [0, 1]) {
    const setup = worldAt(1944, map), plan = enemyPlan(setup, BUILD_KINDS_24), log = [{ tick: 0, cmd: { t: 'map', id: map, vegetation: 1 } }, ...plan.map(cmd => ({ tick: 0, cmd })), { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }, ...SCRIPT];
    const a = runLog(createWorld(1944), log, 1200), b = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 1200), half = runLog(createWorld(1944), log, 600), copy = structuredClone(half);
    runLog(half, log, 1200); runLog(copy, log, 1200); runLog(setup, log, 1200);
    for (const other of [b, half, copy, setup]) assert.deepEqual(other, a, 'replay_hash: enabled JSON/clone/preapplied replay matches entire world');
    const before = hashWorld(a);
    for (const mutate of [w => w.vegetation.version++, w => w.vegetation.cells[idx(10, 10)] = 2, w => w.vegetation.cells = w.vegetation.cells.slice(1), w => { delete w.vegetation; }]) { const c = structuredClone(a); mutate(c); assert.notEqual(hashWorld(c), before, 'replay_hash: version, cell values, size and presence are persistent hashed state'); }
    console.log(`  enabled map${map} 1200 hash ${before}`);
  }
  const w = createWorld(1944), before = hashWorld(w); w.vegetation = { version: 1, cells: new Uint8Array(N * N) }; assert.notEqual(hashWorld(w), before, 'replay_hash: empty retained state prevents regrowth and is hashed');
});
assert(groups > 0, `unknown group ${only}`); console.log(`vegetation: ${groups} groups passed`);
