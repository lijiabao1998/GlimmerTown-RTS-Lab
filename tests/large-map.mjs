// R043 大地圖守衛：64×64 鄉間（map 指令 id 2）。用法：node tests/large-map.mjs [群組名]
// 地圖：種子 0–49 的大小、建築數、出生角落、單位站位、全部單位互相走得到、河上至少兩座橋、雙方起手兵力；
// 指揮部與人口上限 40；電腦（普通）60 秒內推過中線；只在新開世界的第 0 步有效；JSON 重播與中途 structuredClone；
// 舊地圖（id 0、1）的雜湊跟 R043 之前逐位相同（凍結值在 main e0c6348 上算的）。
import assert from 'node:assert/strict';
import {
  createWorld, hashWorld, cellIdx, cellOf, blocks, UNIT_KINDS, TER_ROAD, TER_MUD, SIDE_PLAYER, SIDE_ENEMY,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_LIGHT, UK_HEAVY, BK_HQ,
} from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { applyMap } from '../src/sim/maps.ts';
import { MAP_LARGE, LARGE_N, LARGE_POP, LARGE_CORNER, LARGE_FORCE, inSpawnCorner } from '../src/sim/largeMap.ts';
import { ECO_POP } from '../src/sim/eco.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { startOrderText } from '../src/ui/startOrder.ts';

const only = process.argv[2]; let groups = 0;
function group(name, fn) { if (only && only !== name) return; groups++; fn(); console.log(`OK large-map/${name}`); }
const large = (seed, veg = 1) => { const w = createWorld(seed); step(w, [{ t: 'map', id: MAP_LARGE, ...(veg ? { vegetation: veg } : {}) }]); return w; };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };

// 橋：路格往上下（或左右）走到第一個不是路的格，兩頭都是泥灘＝這一格在河上；四方向相連的算同一座橋
function bridges(w) {
  const n = w.n, t = (x, z) => (x < 0 || z < 0 || x >= n || z >= n ? -1 : w.ter[cellIdx(w, x, z)]);
  const end = (x, z, dx, dz) => { while (t(x, z) === TER_ROAD) { x += dx; z += dz; } return t(x, z); };
  const on = new Uint8Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    if (t(x, z) !== TER_ROAD) continue;
    if ((end(x, z, 0, -1) === TER_MUD && end(x, z, 0, 1) === TER_MUD) || (end(x, z, -1, 0) === TER_MUD && end(x, z, 1, 0) === TER_MUD)) on[cellIdx(w, x, z)] = 1;
  }
  let count = 0;
  const seen = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (!on[i] || seen[i]) continue;
    count++;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const c = stack.pop(), x = c % n, z = (c - x) / n;
      for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = cellIdx(w, nx, nz);
        if (on[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
  }
  return count;
}

group('generate', () => {
  let minB = Infinity, maxB = 0, minBridge = Infinity;
  for (let seed = 0; seed < 50; seed++) {
    const w = large(seed), why = `種子 ${seed}`;
    assert.equal(w.n, LARGE_N, `${why}：邊長 64`);
    assert.equal(w.map, MAP_LARGE, `${why}：記下套了哪張圖`);
    assert.equal(w.ter.length, LARGE_N * LARGE_N, `${why}：地形表照 64 重配`);
    minB = Math.min(minB, w.blds.length); maxB = Math.max(maxB, w.blds.length);
    for (const b of w.blds) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      assert(!inSpawnCorner(x, z), `${why}：出生角落 ${LARGE_CORNER}×${LARGE_CORNER} 不蓋房子（${b.id} 在 ${x},${z}）`);
      assert.notEqual(w.ter[cellIdx(w, x, z)], TER_ROAD, `${why}：房子不蓋在路上`);
      assert.notEqual(w.ter[cellIdx(w, x, z)], TER_MUD, `${why}：房子不蓋在泥灘上`);
    }
    // 兵力：我方 1–15、敵方 16–30，點對稱
    assert.equal(w.units.length, 2 * LARGE_FORCE.length, `${why}：雙方各 ${LARGE_FORCE.length} 個單位`);
    w.units.forEach((u, i) => assert.equal(u.id, i + 1, `${why}：單位 id 從 1 起連號`));
    for (const side of [SIDE_PLAYER, SIDE_ENEMY]) {
      const count = k => w.units.filter(u => u.side === side && u.kind === k).length;
      assert.deepEqual([count(UK_TANK), count(UK_LIGHT), count(UK_HEAVY), count(UK_HOWITZER), count(UK_OBSERVER)], [6, 2, 2, 3, 2], `${why}：中坦克 6、輕 2、重 2、榴彈砲 3、觀測員 2`);
    }
    for (let i = 0; i < LARGE_FORCE.length; i++) {
      const a = w.units[i], b = w.units[i + LARGE_FORCE.length];
      assert(a.side === SIDE_PLAYER && b.side === SIDE_ENEMY && a.kind === b.kind && cellOf(a.x) + cellOf(b.x) === LARGE_N - 1 && cellOf(a.z) + cellOf(b.z) === LARGE_N - 1, `${why}：雙方起手點對稱（${a.id}↔${b.id}）`);
    }
    for (const u of w.units) {
      const x = cellOf(u.x), z = cellOf(u.z);
      assert(inSpawnCorner(x, z), `${why}：起手都在自己的出生角落（${u.id}）`);
      assert(!blocks(w, x, z) && w.ter[cellIdx(w, x, z)] !== TER_MUD, `${why}：單位不站在建築或泥灘上（${u.id}）`);
    }
    // 走得到：1 號走得到其他每一個單位（格子路網是無向的，所以每個單位都走得到每個敵人）
    const a = w.units[0];
    for (const u of w.units.slice(1)) assert(findPath(w, cellOf(a.x), cellOf(a.z), cellOf(u.x), cellOf(u.z), 0, 0, a.kind).length > 0, `${why}：1 號走得到 ${u.id} 號`);
    const nb = bridges(w);
    minBridge = Math.min(minBridge, nb);
    assert(nb >= 2, `${why}：河上至少兩座橋（${nb}）`);
    // 植被：只長在允許的格上、總數不超過渲染上限
    let veg = 0;
    for (let i = 0; i < w.vegetation.cells.length; i++) if (w.vegetation.cells[i]) { veg++; assert(!w.occ[i] && w.ter[i] !== TER_ROAD && w.ter[i] !== TER_MUD, `${why}：植被不長在房子、路、泥灘上`); }
    assert(veg > 0 && veg <= 64, `${why}：植被 1–64 格（${veg}）`);
  }
  assert(minB >= 70 && maxB <= 100, `建築數在 70–100（實際 ${minB}–${maxB}）`);
  console.log(`  種子 0–49：建築 ${minB}–${maxB} 棟；橋最少 ${minBridge} 座`);
  // 同種子同圖、換種子不同；不帶 vegetation 就沒有植被
  assert.equal(hashWorld(large(7)), hashWorld(large(7)), '同種子同圖');
  assert.notEqual(hashWorld(large(7)), hashWorld(large(8)), '換種子不同圖');
  assert.equal(large(7, 0).vegetation, undefined, '沒要植被就不長');
});

group('once', () => {
  // 只在新開世界的第 0 步有效：第 1 步送、已套過 Rye、沙盒、重複送，都不改世界
  const late = createWorld(5); step(late, []); const before = hashWorld(late);
  step(late, [{ t: 'map', id: MAP_LARGE, vegetation: 1 }]);
  assert.equal(late.n, 32, '第 1 步送：不換');
  const ref = createWorld(5); step(ref, []); step(ref, []);
  assert.equal(hashWorld(late), hashWorld(ref), '第 1 步送：世界跟沒送一樣');
  assert.notEqual(before, hashWorld(late), '（有走一步）');
  const rye = createWorld(5); step(rye, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'map', id: MAP_LARGE, vegetation: 1 }]);
  assert(rye.n === 32 && rye.map === 1, '已經套了 Rye：大地圖不再套');
  const lg = createWorld(5); step(lg, [{ t: 'map', id: MAP_LARGE, vegetation: 1 }, { t: 'map', id: 1, vegetation: 1 }, { t: 'map', id: MAP_LARGE }]);
  assert.equal(hashWorld(lg), hashWorld(large(5)), '大地圖之後再送 Rye 或大地圖：不動');
  const sb = createSandboxWorld(5); applyMap(sb, MAP_LARGE, 1);
  assert(sb.n === 32 && !sb.map, '沙盒世界不套大地圖');
});

group('eco', () => {
  const w = createWorld(1944);
  step(w, [{ t: 'map', id: MAP_LARGE, vegetation: 1 }, ECO]);
  const hq = [0, 1].map(s => w.blds[w.eco.hq[s] - 1]);
  assert(hq.every(b => b && b.kind === BK_HQ), '雙方指揮部都放得下');
  assert(hq[0].x + hq[0].z > LARGE_N && hq[1].x + hq[1].z < LARGE_N, '指揮部各在自己那一側');
  assert.equal(w.eco.pop, LARGE_POP, '大地圖寫進人口上限 40');
  assert.equal(ECO_POP, 16, '一般地圖仍是 16');
  const old = createWorld(1944); step(old, [{ t: 'map', id: 1, vegetation: 1 }, ECO]);
  assert.equal(old.eco.pop, undefined, '萊伊不帶 pop（雜湊不變）');
  // 補給給足、一直排觀測員（最快出的）：活著的我方單位長到 40 就停，不會超過
  w.eco.supply[SIDE_PLAYER] = 100000;
  let most = 0;
  for (let k = 0; k < 6000 && most < LARGE_POP + 1; k++) {
    step(w, w.eco.queue[SIDE_PLAYER].length < 5 ? [{ t: 'produce', side: SIDE_PLAYER, kind: UK_OBSERVER }] : []);
    most = Math.max(most, w.units.filter(u => u.alive && u.side === SIDE_PLAYER).length);
  }
  assert.equal(most, LARGE_POP, `我方活著的單位最多到 40（實際 ${most}）`);
});

group('ai', () => {
  // 電腦（普通）接手敵方、玩家不動：60 秒（1200 步）內有敵方單位推過中線（x+z ≥ 64）
  for (const seed of [1944, 3, 11]) {
    const w = createWorld(seed);
    step(w, [{ t: 'map', id: MAP_LARGE, vegetation: 1 }, ECO, { t: 'ai', side: SIDE_ENEMY, level: 2 }]);
    let crossed = -1;
    while (w.tick < 1200 && crossed < 0) {
      step(w, []);
      if (w.units.some(u => u.alive && u.side === SIDE_ENEMY && cellOf(u.x) + cellOf(u.z) >= LARGE_N)) crossed = w.tick;
    }
    assert(crossed > 0, `種子 ${seed}：電腦 60 秒內推過中線`);
    console.log(`  種子 ${seed}：第 ${crossed} 步推過中線`);
  }
});

group('replay', () => {
  const log = [
    { tick: 0, cmd: { t: 'map', id: MAP_LARGE, vegetation: 1 } },
    { tick: 0, cmd: { t: 'build', side: SIDE_PLAYER, kind: 1, x: 48, z: 50 } },
    { tick: 0, cmd: ECO },
    { tick: 0, cmd: { t: 'ai', side: SIDE_ENEMY, level: 3 } },
    { tick: 0, cmd: { t: 'ai', side: SIDE_PLAYER, level: 2 } },
    { tick: 40, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_TANK } },
    { tick: 200, cmd: { t: 'move', side: SIDE_PLAYER, ids: [1, 2, 3], x: 40, z: 40 } },
  ];
  const a = runLog(createWorld(1944), log, 1200);
  const b = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 1200);
  assert.equal(hashWorld(a), hashWorld(b), 'JSON 來回重播雜湊相同');
  const half = runLog(createWorld(1944), log, 600), copy = structuredClone(half);
  for (const w of [half, copy]) runLog(w, log, 1200);
  assert(hashWorld(half) === hashWorld(a) && hashWorld(copy) === hashWorld(a), '600 步 structuredClone 接著跑雜湊相同');
  assert(a.blds.some(x => x.builtBy === SIDE_PLAYER && x.x === 48 && x.z === 50), '大地圖上照樣能布陣');
  console.log(`  1200 步：${hashWorld(a)}`);
});

group('old-maps', () => {
  // 在 main e0c6348（R043 之前）上算的：地圖、指揮部、雙方電腦，第 0 步與第 600 步
  const FROZEN = {
    '0/-': ['a5da9f5a', 'ffdc25ef'], '0/1': ['aa6bafbc', 'f0ec5d85'], '1/-': ['6d6b257b', 'e2027ede'], '1/1': ['a09c426b', 'a05053ba'],
  };
  for (const [key, [h0, h600]] of Object.entries(FROZEN)) {
    const [id, veg] = key.split('/'), w = createWorld(1944);
    step(w, [{ t: 'map', id: +id, ...(veg === '1' ? { vegetation: 1 } : {}) }, ECO, { t: 'ai', side: SIDE_ENEMY, level: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 2 }]);
    assert.equal(hashWorld(w), h0, `舊地圖 ${key}：第 0 步雜湊不變`);
    for (let i = 0; i < 599; i++) step(w, []);
    assert.equal(hashWorld(w), h600, `舊地圖 ${key}：第 600 步雜湊不變`);
  }
  const w = createWorld(1944); step(w, [{ t: 'map', id: 3 }]);
  assert.equal(hashWorld(w), '7c7c811f', '不認得的 id 3：世界照舊');
});

group('text', () => {
  assert.match(startOrderText(MAP_LARGE, true, '普通').place, /英格蘭東南鄉間（64×64）/, '開戰命令條的地點');
  assert.match(startOrderText(1, true, undefined).place, /萊伊/, '萊伊照舊');
  assert.equal(UNIT_KINDS.length >= 11, true);
});

assert(groups > 0, `沒有群組叫 ${only}`);
console.log('large-map: all OK');
