// R116 integration: new terrain must work with the unchanged Claude AI and old replay path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, SUB, UK_TANK, SIDE_ENEMY, BK_HQ } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { enemyPlan, BUILD_KINDS_24, stillConnected } from '../src/sim/build.ts';
import { aiThink } from '../src/sim/ai.ts';

const seeds = [1944, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const CAP = 12000;
const enabledMap = id => ({ t: 'map', id, vegetation: 1 });
const tankDist = w => {
  const ts = w.units.filter(u => u.alive && u.side === SIDE_ENEMY && u.kind === UK_TANK);
  if (!ts.length) return Infinity;
  const x = ts.reduce((n, u) => n + u.x, 0) / ts.length, z = ts.reduce((n, u) => n + u.z, 0) / ts.length;
  return Math.hypot(x - 26.5 * SUB, z - 26.5 * SUB) / SUB;
};
function play(seed, level, enabled, map = 0, economy = false, audit = false) {
  const w = createWorld(seed), setup = [];
  if (enabled) setup.push(enabledMap(map));
  if (economy) {
    const preview = createWorld(seed); applyMap(preview, map, 1);
    setup.push(...enemyPlan(preview, BUILD_KINDS_24), { t: 'eco', inf: 1, guns: 1, tanks: 1 });
  }
  setup.push({ t: 'ai', side: SIDE_ENEMY, level });
  step(w, setup);
  const a = { initial: tankDist(w), nearest: Infinity, attacks: 0, peeks: 0, rngWrites: 0, splitFocus: 0, fires: 0 };
  while (w.winner < 0 && w.tick < CAP) {
    if (audit && w.ai?.[0] && w.tick >= w.ai[0].next) {
      const c = structuredClone(w), rng = c.rng, commands = aiThink(c, c.ai[0], spotted), targets = new Set();
      a.rngWrites += Number(c.rng !== rng);
      for (const command of commands) if (command.t === 'attack') {
        a.attacks++;
        const target = c.units[command.target - 1];
        a.peeks += Number(!spotted(c, SIDE_ENEMY, target.x, target.z));
        if (command.ids.some(id => c.units[id - 1].kind === UK_TANK)) targets.add(command.target);
      }
      a.splitFocus += Number(targets.size > 1);
    }
    step(w, []);
    for (const event of w.events) if (event.e === 'fire' && w.units[event.unit - 1].side === SIDE_ENEMY) a.fires++;
    if (w.tick <= 1200) a.nearest = Math.min(a.nearest, tankDist(w));
  }
  return { w, a };
}

// Planning uses a private draft: clearing foliage beneath planned houses must never leak.
for (const map of [0, MAP_RYE]) for (const seed of seeds) {
  const w = createWorld(seed); applyMap(w, map, 1);
  assert(w.vegetation?.cells.includes(1) && w.vegetation.cells.includes(2), `setup: both terrain types, map=${map} seed=${seed}`);
  assert(stillConnected(w, -1, -1, 0, 0), `setup: original movement connectivity, map=${map} seed=${seed}`);
  const before = structuredClone(w), hash = hashWorld(w), plan = enemyPlan(w, BUILD_KINDS_24);
  assert.deepEqual(w, before, `planning: enemyPlan leaves actual vegetation and world unchanged, map=${map} seed=${seed}`);
  assert.equal(hashWorld(w), hash, 'planning: unchanged world hash');
  const replay = createWorld(seed); step(replay, [enabledMap(map), ...plan, { t: 'eco', inf: 1, guns: 1, tanks: 1 }]);
  assert.equal(replay.blds.filter(b => b.builtBy === SIDE_ENEMY && b.kind !== BK_HQ).length, plan.length, 'planning: every original planned building still fits');
  assert(replay.eco.hq.every(id => id > 0), 'planning: both headquarters still fit');
  assert(stillConnected(replay, -1, -1, 0, 0), 'planning: constructed world stays connected');
  for (let i = 0; i < replay.vegetation.cells.length; i++) assert(!replay.occ[i] || !replay.vegetation.cells[i], 'planning: completed houses/HQ clear their own footprint');
}
console.log('OK R116 integration: 24 map/seed planning, HQ and connectivity cases');

const legacy = [1, 2, 3].map(level => seeds.map(seed => play(seed, level, false).w.winner).filter(winner => winner === SIDE_ENEMY).length);
assert.deepEqual(legacy, [7, 11, 11], 'legacy: original 12-seed difficulty wins remain exactly 7/11/11 (R104 armor facing, R036 hard AI turns to face)');
const results = [1, 2, 3].map(level => seeds.map(seed => ({ seed, ...play(seed, level, true, 0, false, seed === 1944 && level === 2) })));
const wins = results.map(row => row.filter(({ w }) => w.winner === SIDE_ENEMY).length);
assert(wins[2] >= wins[1] && wins[1] >= wins[0] && wins[2] > wins[0], `difficulty: enabled terrain keeps hard>=normal>=easy and hard>easy; wins=${wins}`);
console.log(`OK R116 integration: legacy wins ${legacy}; vegetation wins ${wins}`);
for (let level = 0; level < results.length; level++) console.log(`R116 enabled level ${level + 1}: ${results[level].map(({ seed, w }) => `${seed}:${w.winner}@${w.tick}`).join(' ')}`);
const normal = results[1][0];
assert.equal(normal.w.winner, SIDE_ENEMY, 'normal: enabled seed1944 wins within original 12000-tick cap');
assert(normal.a.initial - normal.a.nearest >= 6 && normal.a.fires > 0, 'normal: unchanged AI advances six cells within 60 seconds and fires');
assert(normal.a.attacks > 0 && normal.a.peeks === 0 && normal.a.rngWrites === 0 && normal.a.splitFocus === 0, 'normal: no hidden-target attacks, RNG writes or split tank focus');
console.log(`OK R116 integration: normal1944 winner ${normal.w.winner}@${normal.w.tick}; audit ${JSON.stringify(normal.a)}`);

const rye = play(1944, 2, true, MAP_RYE, true, true);
assert.equal(rye.w.winner, SIDE_ENEMY, 'Rye: enabled full construction/economy/normal AI wins within original 12000-tick cap');
assert(rye.a.attacks > 0 && rye.a.peeks === 0 && rye.a.rngWrites === 0 && rye.a.splitFocus === 0, 'Rye: unchanged AI retains visibility/RNG/focus contracts');
console.log(`OK R116 integration: Rye full battle winner ${rye.w.winner}@${rye.w.tick}; audit ${JSON.stringify(rye.a)}`);

for (const map of [0, MAP_RYE]) {
  const preview = createWorld(1944); applyMap(preview, map, 1);
  const commands = [enabledMap(map), ...enemyPlan(preview, BUILD_KINDS_24), { t: 'eco', inf: 1, guns: 1, tanks: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 2 }];
  const log = commands.map(cmd => ({ tick: 0, cmd }));
  const direct = runLog(createWorld(1944), log, 2000), replay = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 2000);
  const half = runLog(createWorld(1944), log, 1000), clone = structuredClone(half);
  runLog(half, log, 2000); runLog(clone, log, 2000);
  assert.deepEqual(replay, direct, 'replay: optional terrain setup JSON log preserves complete integrated world');
  assert.deepEqual(half, direct, 'replay: continuation matches integrated world');
  assert.deepEqual(clone, direct, 'replay: midbattle clone matches integrated world');
  console.log(`OK R116 integration: map${map} new-game log/clone hash ${hashWorld(direct)}`);
}

// These deliberately damage only test scenarios/audit inputs in an isolated copy.
// They verify the integration guards; production terrain mutations live in vegetation.mjs.
// Claude's AI implementation is never edited, even for these negative controls.
if (process.argv.includes('--mutations')) {
  const self = fileURLToPath(import.meta.url), source = fs.readFileSync(self, 'utf8');
  const mutations = [
    ['setup', 'const w = createWorld(seed); applyMap(w, map, 1);', 'const w = createWorld(seed); applyMap(w, map);', 'setup: both terrain types'],
    ['difficulty', 'const w = createWorld(seed), setup = [];', 'if (enabled) level = 1; const w = createWorld(seed), setup = [];', 'difficulty: enabled terrain'],
    ['normal', "setup.push({ t: 'ai', side: SIDE_ENEMY, level });", "setup.push({ t: 'ai', side: SIDE_ENEMY, level: enabled && !economy && seed === 1944 && level === 2 ? 0 : level });", 'normal: enabled seed1944 wins'],
    ['audit', 'a.rngWrites += Number(c.rng !== rng);', 'c.rng++; a.rngWrites += Number(c.rng !== rng);', 'normal: no hidden-target attacks'],
    ['rye', "setup.push({ t: 'ai', side: SIDE_ENEMY, level });", "setup.push({ t: 'ai', side: SIDE_ENEMY, level: economy ? 0 : level });", 'Rye: enabled full construction'],
    ['replay', 'JSON.parse(JSON.stringify(log)), 2000)', 'JSON.parse(JSON.stringify(log)).map(e => e.cmd.t === "map" ? { ...e, cmd: { t: "map", id: e.cmd.id } } : e), 2000)', 'replay: optional terrain setup JSON log'],
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r116-integration-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests')); fs.symlinkSync(path.resolve(path.dirname(self), '../src'), path.join(dir, 'src'), 'dir');
    for (const [name, from, to, message] of mutations) {
      assert(source.includes(from), `${name}: scenario mutation anchor`);
      const file = path.join(dir, 'tests', `${name}.mjs`); fs.writeFileSync(file, source.replace(from, to));
      const child = spawnSync(process.execPath, ['--no-warnings', file], { encoding: 'utf8', timeout: 60000 });
      const output = child.stdout + child.stderr, first = output.match(/AssertionError[^\n]*:[^\n]*/)?.[0] ?? '';
      assert.equal(child.status, 1, `${name}: scenario must fail, output=${output}`);
      assert(first.includes(message), `${name}: intended assertion is first red, actual=${first}; output=${output}`);
      assert(!/(?:ReferenceError|TypeError|SyntaxError)/.test(output), `${name}: runtime errors cannot pass a negative control`);
      console.log(`RED R116 integration ${name}: ${first}`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
