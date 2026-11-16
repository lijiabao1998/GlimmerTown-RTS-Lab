// R055 丘陵（地圖 4）：第一張有高度的地圖。形狀、點對稱、出生角落公平、稜線真的擋得住、開局雜湊寫死。
// 用法：node tests/hill-map.mjs            全部跑，另外把地圖故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/hill-map.mjs <群組名>   只跑那一群（隔離副本裡用）
// 高度與視線的規則本身在 tests/terrain.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY, TER_ROAD, UK_OBSERVER } from '../src/sim/world.ts';
import { step, spotted } from '../src/sim/step.ts';
import { applyMap, MAP_HILLS } from '../src/sim/maps.ts';
import { hillHeight, HILLS_N, HILLS_SPAWN, HILLS_KNOLLS } from '../src/sim/hillMap.ts';
import { HEIGHT_MAX } from '../src/sim/terrain.ts';
import { hqAlive } from '../src/sim/eco.ts';
import { findPath } from '../src/sim/path.ts';
import { MAP_ENTRIES } from '../src/sim/mapRegistry.ts';

const N = HILLS_N, E = N - 1;
const open = (seed = 1944, extra = {}) => { const w = createWorld(seed); step(w, [{ t: 'map', id: MAP_HILLS, vegetation: 1, ...extra }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1, mg: 1 }]); return w; };
const inSpawn = (x, z) => (x < HILLS_SPAWN && z < HILLS_SPAWN) || (x >= N - HILLS_SPAWN && z >= N - HILLS_SPAWN);

const groups = {
  // map 指令帶 4：32×32、有高度表、決定性；帶 vegetation 才長植被；登記表有它
  shape() {
    const w = open();
    assert.deepEqual([MAP_HILLS, w.map, w.n, w.height?.length], [4, 4, 32, 32 * 32], 'shape: map 4 is the hill map — 32 by 32, with a height table');
    assert.deepEqual([Math.max(...w.height), HEIGHT_MAX], [3, 3], 'shape: the highest ground is three levels');
    assert.equal(hashWorld(open()), hashWorld(w), 'shape: the same seed builds the same map');
    const bare = createWorld(1944); step(bare, [{ t: 'map', id: MAP_HILLS }]);
    const count = v => (v.vegetation ? Array.from(v.vegetation.cells).filter(Boolean).length : 0);
    assert.deepEqual([count(bare) > 0, count(w) >= 16], [false, true], `shape: with the flag it grows its woods and hedges (${count(w)} cells), without it none`);
    assert.deepEqual(MAP_ENTRIES.find(m => m.id === MAP_HILLS), { id: 4, n: 32, label: '地圖：丘陵' }, 'shape: the registry lists it');
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) assert.equal(w.height[cellIdx(w, x, z)], hillHeight(x, z), `shape: the table at ${x},${z} is what hillHeight says`);
    { const late = createWorld(3); step(late, []); applyMap(late, MAP_HILLS, 1); assert.equal(late.height, undefined, 'shape: it only applies at step 0'); }
  },
  // 高度、地形、房子、植被都是點對稱的
  symmetry() {
    const w = open();
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const a = cellIdx(w, x, z), b = cellIdx(w, E - x, E - z);
      assert.equal(w.height[a], w.height[b], `symmetry: the height at ${x},${z} equals the height at its mirror`);
      assert.equal(w.ter[a], w.ter[b], `symmetry: the ground at ${x},${z} equals the ground at its mirror`);
      assert.equal(w.vegetation.cells[a], w.vegetation.cells[b], `symmetry: the vegetation at ${x},${z} equals its mirror`);
    }
    const town = w.blds.filter(b => b.id !== w.eco.hq[0] && b.id !== w.eco.hq[1]), key = b => `${b.kind}@${b.x},${b.z}:${b.w}x${b.d}x${b.floors}`;
    const mirrored = new Set(town.map(b => key({ ...b, x: N - b.x - b.w, z: N - b.z - b.d })));
    assert(town.length >= 12 && town.every(b => mirrored.has(key(b))), `symmetry: every building has its mirror (${town.length} buildings)`);
  },
  // 公平與走得通：出生角落平而且空、隘口的大路不高、指揮部放得下、兩邊走得到
  fair() {
    const w = open();
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (inSpawn(x, z)) {
      const occ = w.occ[cellIdx(w, x, z)], hq = occ === w.eco.hq[0] || occ === w.eco.hq[1];
      assert(w.height[cellIdx(w, x, z)] === 0 && (!occ || hq) && !w.vegetation.cells[cellIdx(w, x, z)], `fair: the spawn corners are empty and flat (${x},${z})`);
    }
    for (let z = 4; z <= 27; z++) for (const x of [15, 16]) {
      assert.equal(w.ter[cellIdx(w, x, z)], TER_ROAD, `fixture: the main road runs through ${x},${z}`);
      assert(w.height[cellIdx(w, x, z)] <= 1, `fair: the pass road is no higher than one level (${x},${z} is ${w.height[cellIdx(w, x, z)]})`);
    }
    const a = hqAlive(w, SIDE_PLAYER), b = hqAlive(w, SIDE_ENEMY);
    assert(a && b, 'fair: both headquarters found a place');
    const path = findPath(w, a.x - 1, a.z - 1, b.x + b.w, b.z + b.d, 0, 0, 0);
    assert(path.length > 20, `fair: a tank can drive from one headquarters to the other (${path.length} cells)`);
    for (const u of w.units) assert(!w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))], 'fair: nobody starts inside a building');
  },
  // 稜線真的擋得住：開局雙方互相看不到對方的角落；站上稜線兩邊的山腳都看得到
  blocks() {
    const w = open();
    for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const theirs = side === SIDE_PLAYER ? x < HILLS_SPAWN && z < HILLS_SPAWN : x >= N - HILLS_SPAWN && z >= N - HILLS_SPAWN;
      if (theirs) assert(!spotted(w, side, center(x), center(z)), `blocks: at the start side ${side} sees nothing of the other corner (${x},${z})`);
    }
    // 把雙方的單位都拿掉，只放一個我方觀測員：在山腳下看不到稜線另一邊；站上稜線頂兩邊都看得到
    const alone = (cx, cz) => { const v = open(); v.units = []; const k = UNIT_KINDS[UK_OBSERVER]; v.units.push({ id: 1, side: SIDE_PLAYER, kind: UK_OBSERVER, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: 0, aimZ: 0 }); return v; };
    const near = [26, 11], far = [20, 5];   // 稜線兩邊山腳下的兩格，跟稜線頂的 (23,8) 在同一條垂直稜線的線上
    assert.deepEqual([hillHeight(...near), hillHeight(...far)], [0, 0], 'fixture: two cells at the foot of the ridge, one on either side');
    assert(hillHeight(23, 8) >= 2, 'blocks: there is high ground between the two sides');
    const below = alone(27, 11), top = alone(23, 8);
    assert(spotted(below, SIDE_PLAYER, center(near[0]), center(near[1])) && !spotted(below, SIDE_PLAYER, center(far[0]), center(far[1])), 'blocks: from the foot of the ridge the far side is hidden');
    assert(spotted(top, SIDE_PLAYER, center(near[0]), center(near[1])) && spotted(top, SIDE_PLAYER, center(far[0]), center(far[1])), 'blocks: from the crest both feet of the ridge are seen');
    for (const [cx, cz] of HILLS_KNOLLS) assert.equal(hillHeight(cx, cz), 2, 'fixture: the two knolls are two levels high');
  },
  // 開局的世界雜湊寫死：之後要改這張圖就得改這個數字
  pinned() {
    assert.equal(hashWorld(open()), '5aac0414', 'pinned: the opening hash is the one written down');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`hill-map/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK hill-map/${name}`); }

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r055-map-negative-'));
const mutants = [
  ['not_dispatched', 'shape', 'maps.ts', 'if (id === MAP_HILLS) { applyHills(w, vegetation); return; }', '', 'shape: map 4 is the hill map'],
  ['four_levels', 'shape', 'hillMap.ts', 'let h = d <= 1 ? 3 : d <= 3 ? 2', 'let h = d <= 1 ? 4 : d <= 3 ? 2', 'shape: the highest ground is three levels'],
  ['no_vegetation_flag', 'shape', 'step.ts', 'c.id === 4 || c.id === 0 || c.id === 1', 'c.id === 0 || c.id === 1', 'shape: with the flag it grows its woods and hedges'],
  ['lopsided', 'symmetry', 'hillMap.ts', 'put(x, z); put(n - x - bw, n - z - bd);', 'put(x, z); put(n - x - bw, z);', 'symmetry: the ground at'],
  ['no_pass', 'fair', 'hillMap.ts', '  if (x === 15 || x === 16) h = Math.min(h, 1);\n  else if (x === 14 || x === 17) h = Math.min(h, 2);\n', '  if (x === 14 || x === 17) h = Math.min(h, 2);\n', 'fair: the pass road is no higher than one level'],
  ['barn_in_the_corner', 'fair', 'hillMap.ts', 'bld(BK_BARN, 2, 22, 2, 1, 1);', 'bld(BK_BARN, 24, 24, 2, 1, 1);', 'fair: the spawn corners are empty and flat'],
  ['no_ridge', 'blocks', 'hillMap.ts', 'let h = d <= 1 ? 3 : d <= 3 ? 2 : d <= 5 ? 1 : 0;', 'let h = 0;', 'blocks: there is high ground between the two sides'],
  ['knolls_moved', 'pinned', 'hillMap.ts', '[[7, 15], [24, 16]]', '[[7, 14], [24, 17]]', 'pinned: the opening hash is the one written down'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/hill-map.mjs'), join(dir, 'tests/hill-map.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/hill-map.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK hill-map-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`hill-map: all groups OK, ${mutants.length} isolated mutants rejected`);
