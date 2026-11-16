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
    const both = ids => { const v = createWorld(1944); step(v, ids.map(id => ({ t: 'map', id, vegetation: 1 }))); return v.map; };
    assert.deepEqual([both([1, 4]), both([4, 1]), both([2, 4]), both([4, 2])], [1, 4, 2, 4], 'shape: within one step the first map command wins, as for the older maps');
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
    assert.equal(path[path.length - 1], cellIdx(w, b.x + b.w, b.z + b.d), `fair: a tank can drive from one headquarters to the other (${path.length} cells)`);
    for (const u of w.units) assert(!w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))], 'fair: nobody starts inside a building');
  },
  // 稜線真的擋得住：只放一個我方觀測員，隔著稜線的幾對格子（都在它看得到的距離內）互相看不到；拿掉高度表就看得到。站上稜線頂兩邊的山腳都看得到
  blocks() {
    const alone = (cx, cz, level = false) => { const v = open(); v.units = []; if (level) delete v.height; const k = UNIT_KINDS[UK_OBSERVER]; v.units.push({ id: 1, side: SIDE_PLAYER, kind: UK_OBSERVER, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: 0, aimZ: 0 }); return v; };
    const pairs = [[[27, 11], [20, 5]], [[4, 20], [11, 26]], [[21, 16], [14, 10]], [[10, 15], [17, 21]]];   // 後兩對靠近隘口的肩；每一對的鏡像也在裡面
    for (const [[ox, oz], [tx, tz]] of pairs) {
      assert(!spotted(alone(ox, oz), SIDE_PLAYER, center(tx), center(tz)), `blocks: across the crest an observer at ${ox},${oz} does not see ${tx},${tz}`);
      assert(spotted(alone(ox, oz, true), SIDE_PLAYER, center(tx), center(tz)), `fixture: with the height table removed ${ox},${oz} does see ${tx},${tz} (only the ridge is in the way)`);
    }
    const near = [26, 11], far = [20, 5];   // 稜線兩邊山腳下的兩格，跟稜線頂的 (23,8) 在同一條垂直稜線的線上
    assert.deepEqual([hillHeight(...near), hillHeight(...far), hillHeight(23, 8)], [0, 0, 3], 'fixture: two cells at the foot of the ridge, one on either side, and the crest between them');
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

// ---- 介面（不在隔離副本裡跑）：地圖的名字；開始選單記住的地圖 ----
{
  const { saveTitle } = await import('../src/ui/saveGame.ts');
  const { replayTitle } = await import('../src/ui/replayStore.ts');
  const { startOrderText } = await import('../src/ui/startOrder.ts');
  const w = open();
  assert(saveTitle({ world: w }).startsWith('丘陵 32×32'), `names: the saved battle is called 丘陵 (${saveTitle({ world: w })})`);
  assert.equal(replayTitle({ meta: { map: 4, n: 32, winner: 0, seconds: 61 }, seed: 1, at: '' }).label, '勝利 · 丘陵 32×32', 'names: so is a replay');
  assert(startOrderText(4, true, '普通').place.startsWith('英格蘭東南的丘陵'), 'names: the start banner names the hills');
  const { restoreSetup, initSkirmish, saveSetup, loadSetup } = await import('../src/ui/skirmish.ts');
  const memory = saved => { const m = new Map(); const s = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; if (saved) saveSetup(s, { v: 1, map: saved, mode: 'battle', ai: 2, force: 2, supply: 2, seed: 7 }); return s; };
  const at = map => { const v = createWorld(7); if (map) v.map = map; return v; };
  // R026 的閥關著（沒有萊伊）：丘陵跟村莊一樣不給選，網址帶 map=hills 也不算
  { const q = restoreSetup(new URLSearchParams('noR026=1&map=hills'), memory()), sk = initSkirmish(q, false);
    assert.deepEqual([sk.canHills, sk.hills], [false, false], 'menu: without Rye (?noR026=1) 丘陵 is not offered, like 村莊'); }
  // 這一頁不能選丘陵（noR055）：記著的丘陵不洗掉；在這一頁選了別的地圖才換掉，之後再選萊伊就記萊伊
  { const store = memory('hills'), q = restoreSetup(new URLSearchParams('noR055=1'), store), sk = initSkirmish(q, true);
    assert.equal(sk.hills, false, 'fixture: the valve-off page does not start the hills');
    sk.start(at(1)); assert.equal(loadSetup(store).map, 'hills', 'memory: a valve-off page that falls back to Rye keeps the remembered 丘陵');
    sk.start(at(2)); assert.equal(loadSetup(store).map, '64', 'memory: choosing another map on that page replaces it');
    sk.start(at(1)); assert.equal(loadSetup(store).map, 'rye', 'memory: and a later 萊伊 is then remembered as 萊伊'); }
  // 兩個閥都關著（沒有萊伊、也不能選丘陵）：開出來的是村莊，記著的丘陵照樣不洗掉
  { const store = memory('hills'), q = restoreSetup(new URLSearchParams('noR026=1&noR055=1'), store), sk = initSkirmish(q, false);
    sk.start(at(0)); assert.equal(loadSetup(store).map, 'hills', 'memory: when the fallback is the village the remembered 丘陵 is kept too'); }
  // 能選的頁：選了丘陵就記丘陵；選村莊就不是丘陵（兩張是同一格的兩張圖）
  { const store = memory(), q = restoreSetup(new URLSearchParams(''), store), sk = initSkirmish(q, true);
    sk.set({ hills: true }); assert.deepEqual([sk.hills, sk.village], [true, false], 'menu: choosing 丘陵 is a map choice');
    sk.start(at(4)); assert.equal(loadSetup(store).map, 'hills', 'memory: a hills battle is remembered as 丘陵');
    sk.set({ village: true }); assert.deepEqual([sk.hills, sk.village], [false, true], 'menu: choosing 村莊 leaves 丘陵'); }
  console.log('OK hill-map/interface');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r055-map-negative-'));
const mutants = [
  ['not_dispatched', 'shape', 'maps.ts', 'if (id === MAP_HILLS) { applyHills(w, vegetation); return; }', '', 'shape: map 4 is the hill map'],
  ['four_levels', 'shape', 'hillMap.ts', 'let h = d <= 1 ? 3 : d <= 3 ? 2', 'let h = d <= 1 ? 4 : d <= 3 ? 2', 'shape: the highest ground is three levels'],
  ['no_vegetation_flag', 'shape', 'step.ts', 'applyMap(w, MAP_HILLS, m.vegetation);', 'applyMap(w, MAP_HILLS, undefined);', 'shape: with the flag it grows its woods and hedges'],
  ['lopsided', 'symmetry', 'hillMap.ts', 'put(x, z); put(n - x - bw, n - z - bd);', 'put(x, z); put(n - x - bw, z);', 'symmetry: the ground at'],
  ['no_pass', 'fair', 'hillMap.ts', '  if (x === 15 || x === 16) h = Math.min(h, 1);\n  else if (x === 14 || x === 17) h = Math.min(h, 2);\n', '  if (x === 14 || x === 17) h = Math.min(h, 2);\n', 'fair: the pass road is no higher than one level'],
  ['barn_in_the_corner', 'fair', 'hillMap.ts', 'bld(BK_BARN, 2, 22, 2, 1, 1);', 'bld(BK_BARN, 24, 24, 2, 1, 1);', 'fair: the spawn corners are empty and flat'],
  ['no_ridge', 'blocks', 'hillMap.ts', 'let h = d <= 1 ? 3 : d <= 3 ? 2 : d <= 5 ? 1 : 0;', 'let h = 0;', 'blocks: across the crest an observer at 27,11 does not see 20,5'],
  ['hills_always_win', 'shape', 'step.ts', "cmds.find(c => c.t === 'map')", "cmds.find(c => c.t === 'map' && c.id === MAP_HILLS)", 'shape: within one step the first map command wins'],
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
