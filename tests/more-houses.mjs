// R087 更多房屋（模擬）：map 指令的 more＝1、src/sim/moreHouses.ts 放房子、三種新房型。
// 用法：node tests/more-houses.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/more-houses.mjs <群組名>   只跑那一群（隔離副本裡用）
// 畫法在 tests/more-houses-art.mjs；真的 Chrome（預算、頁面雜湊、連線）在 tests/more-houses-browser.mjs。
// 凍結的數字都是在動 src/sim 之前（139f2fb）量的，見卡面 docs/tasks/R087-更多房屋.md。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import {
  createWorld, hashWorld, cellIdx, inGrid, cellOf, blocks, bldMaterial, bldMaxHp, stageOf, SIDE_PLAYER, SIDE_ENEMY, UK_INFANTRY, UK_ZOMBIE, UNIT_KINDS, ORD_IDLE, center,
  TER_ROAD, TER_MUD, TER_GRASS, TER_FIELD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_HQ, BK_OAST, BK_MILL, BK_WAREHOUSE, BM_WOOD, BM_BRICK,
  STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE,
} from '../src/sim/world.ts';
import { step, runLog, commandTick } from '../src/sim/step.ts';
import { applyMap, applyMoreHouses, MAP_RYE, MAP_HILLS } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { RYE_MILL, RYE_QUAYS } from '../src/sim/moreHouses.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { runScript } from '../src/sim/script.ts';
import { enemyPlan, buildError, BUILD_KINDS, BUILD_KINDS_24, WALL_KINDS, WIRE_KIND, BUILD_POINTS } from '../src/sim/build.ts';
import { startZombies } from '../src/sim/zombies.ts';
import { makeSave, checkSave } from '../src/ui/saveGame.ts';
import { initSkirmish } from '../src/ui/skirmish.ts';

const MAPS = [0, MAP_RYE, MAP_LARGE, MAP_TOWN, MAP_HILLS], SEEDS = Array.from({ length: 50 }, (_, i) => i);
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1, mg: 2 };
const NEW = new Set([BK_OAST, BK_MILL, BK_WAREHOUSE]);
// 第 0 步之後的世界（more：帶不帶旗標；extra：同一步的其他指令）
const opened = (map, seed, more, extra = [], sym = 0) => { const w = createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, ...(sym ? { sym: 1 } : {}), ...(more ? { more: 1 } : {}) }, ...extra]); return w; };
// 新加的建築：有 more 的世界比沒 more 的多出來的那幾棟（eco 之前；第 0 步只套地圖時兩邊的指揮部都還沒放）
const pairOf = (map, seed) => { const a = opened(map, seed, false), b = opened(map, seed, true); return { a, b, added: b.blds.slice(a.blds.length) }; };
const gap = (a, b) => Math.max(Math.max(a.x - (b.x + b.w - 1), b.x - (a.x + a.w - 1), 0), Math.max(a.z - (b.z + b.d - 1), b.z - (a.z + a.d - 1), 0));
const TOWN_BOX = { [MAP_LARGE]: [19, 44], [MAP_TOWN]: [24, 71] };

// 在 139f2fb（動 src/sim 之前）量的：電腦對電腦（第三版對第三版、種子 1944、3000 步）、照頁面開局送的紀錄的第 600 步、enemyPlan 輸出的摘要
const FROZEN_SOAK = { '0/0': ['63561481', 3000, 35], '0/1': ['341e4185', 3000, 35], '1/0': ['2767d323', 2371, 48], '1/1': ['647d0ce0', 2320, 48], '2/0': ['906393b8', 3000, 83], '2/1': ['fa2bc856', 3000, 83], '3/0': ['a4eeda27', 3000, 286], '3/1': ['163c0bf6', 3000, 286], '4/0': ['26600b30', 2889, 18], '4/1': ['13d9884a', 3000, 18] };
const LOG_MAP = map => ({ tick: 0, cmd: { t: 'map', id: map, vegetation: 1, sym: 1 } });
export const FROZEN_LOGS = {
  skirmish0: [[LOG_MAP(0), { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 2, v: 2 } }], 'e38456dc'],
  skirmish1: [[LOG_MAP(1), { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 2, v: 2 } }], '01c9e14d'],
  skirmish2: [[LOG_MAP(2), { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 2, v: 2 } }], '829619a0'],
  skirmish3: [[LOG_MAP(3), { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 2, v: 2 } }], '04bc2c51'],
  skirmish4: [[LOG_MAP(4), { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 2, v: 2 } }], '5b8873a5'],
  zombies1: [[LOG_MAP(1), { tick: 0, cmd: { t: 'zombies' } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 3, v: 3 } }], '585cfc00'],
  zombies2: [[LOG_MAP(2), { tick: 0, cmd: { t: 'zombies' } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 3, v: 3 } }], 'f41bea23'],
  versus1: [[LOG_MAP(1), { tick: 0, cmd: ECO }, { tick: 120, cmd: { t: 'move', side: 0, ids: [1, 2], x: 2000, z: 2000 } }, { tick: 240, cmd: { t: 'move', side: 1, ids: [5, 6], x: 1800, z: 1800 } }], '0cff3aa6'],
};
const FROZEN_PLAN = 'aed4449e6ba7482d';
const replay600 = log => { const w = createWorld(1944); for (let t = 0; t <= 600 && w.winner < 0; t++) step(w, log.filter(e => e.tick === t).map(e => e.cmd)); return hashWorld(w); };
const soak = (map, sym, more, ticks = 3000, v = 3, seed = 1944) => {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, ...(sym ? { sym: 1 } : {}), ...(more ? { more: 1 } : {}) }, ECO, { t: 'ai', side: SIDE_PLAYER, level: 3, v }, { t: 'ai', side: SIDE_ENEMY, level: 3, v }]);
  let garrisons = 0;
  const added = more ? new Set(w.blds.filter(b => NEW.has(b.kind) || (map === MAP_RYE && b.kind === BK_WAREHOUSE) || b.id > opened(map, seed, false).blds.length).filter(b => b.kind !== BK_HQ).map(b => b.id)) : new Set();
  const inside = new Set();
  while (w.tick < ticks && w.winner < 0) {
    step(w, []);
    for (const u of w.units) if (u.alive && UNIT_KINDS[u.kind].garrison) {
      const b = blocks(w, cellOf(u.x), cellOf(u.z)) ? w.blds[w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))] - 1] : null, key = u.id;
      if (b && added.has(b.id)) { if (!inside.has(key)) { garrisons++; inside.add(key); } } else inside.delete(key);
    }
  }
  return { hash: hashWorld(w), tick: w.tick, blds: w.blds.length, garrisons };
};
// 原本的（不用表、照定義一棟一棟比）規矩，拿來對照 moreHouses.ts 的快版
function ruleBreaks(w, b, others) {
  const n = w.n, c = n === 32 ? 10 : 12, why = [];   // 開局角落：守衛自己的數字，不拿施工那份的（審查 R087-guard-corner；卡面的 8×8 是下限）
  if (b.x < 2 || b.z < 2 || b.x + b.w > n - 2 || b.z + b.d > n - 2) why.push('edge');
  for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) {
    const x = b.x + dx, z = b.z + dz, i = cellIdx(w, x, z);
    if (w.ter[i] === TER_ROAD) why.push('road'); if (w.ter[i] === TER_MUD) why.push('mud'); if (w.vegetation?.cells[i]) why.push('vegetation');
    if ((x < c && z < c) || (x >= n - c && z >= n - c)) why.push('corner');
  }
  for (const o of others) if (o.id !== b.id && gap(o, b) < 2) why.push(`ring ${o.id}`);
  for (const u of w.units) if (u.alive && gap({ x: cellOf(u.x), z: cellOf(u.z), w: 1, d: 1 }, b) < 2) why.push(`unit ${u.id}`);
  const box = TOWN_BOX[w.map ?? 0], inBox = (x, z) => box && x >= box[0] && x <= box[1] && z >= box[0] && z <= box[1];
  const cells = []; for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) cells.push([b.x + dx, b.z + dz]);
  const near = (t, r) => { for (let z = b.z - r; z < b.z + b.d + r; z++) for (let x = b.x - r; x < b.x + b.w + r; x++) if (inGrid(w, x, z) && w.ter[cellIdx(w, x, z)] === t) return true; return false; };
  if (b.kind === BK_MILL) {
    if (!cells.every(([x, z]) => [TER_GRASS, TER_FIELD].includes(w.ter[cellIdx(w, x, z)]))) why.push('mill ground');
    for (const o of others) if (o.id !== b.id && (o.kind === BK_CHURCH || o.kind === BK_MILL) && gap(o, b) < 6) why.push(`mill near ${o.id}`);
  } else if (b.kind === BK_OAST) {
    if (cells.some(([x, z]) => inBox(x, z))) why.push('oast in town');
    if (!others.some(o => (o.kind === BK_BARN || o.kind === BK_COTTAGE) && gap(o, b) <= 4)) why.push('oast far from a farm');
  } else if (b.kind === BK_WAREHOUSE) {
    if (!cells.every(([x, z]) => inBox(x, z))) why.push('quay out of town');
    if (!near(TER_MUD, 3)) why.push('quay far from the river');
  } else if (!near(TER_ROAD, 3) && !others.some(o => o.id !== b.id && [BK_HOUSE, BK_COTTAGE, BK_SHOP].includes(o.kind) && gap(o, b) <= 2)) why.push('infill far from roads and homes');
  return why;
}
// 從一格往外（八方向、不切角）走得到的格
function reach(w, sx, sz) {
  const n = w.n, seen = new Uint8Array(n * n), q = [cellIdx(w, sx, sz)], blocked = (x, z) => !inGrid(w, x, z) || blocks(w, x, z);
  seen[q[0]] = 1;
  while (q.length) {
    const cur = q.pop(), x = cur % n, z = (cur - x) / n;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (blocked(nx, nz) || (dx && dz && (blocked(x + dx, z) || blocked(x, z + dz)))) continue;
      const i = cellIdx(w, nx, nz); if (!seen[i]) { seen[i] = 1; q.push(i); }
    }
  }
  return seen;
}
// 佔地加一圈裡沒有建築（布陣規矩的最後一條；先篩掉，才不會每一格都走一次通路檢查。第 0 步還沒有圍牆，所以篩掉的一定不合法）
const ringFree = (w, x, z, bw, bd) => { for (let dz = -1; dz <= bd; dz++) for (let dx = -1; dx <= bw; dx++) if (inGrid(w, x + dx, z + dz) && w.occ[cellIdx(w, x + dx, z + dz)]) return false; return true; };
const hqCells = w => [0, 1].map(s => { const b = w.blds[w.eco.hq[s] - 1]; return b ? [b.x, b.z] : null; });

export const groups = {
  // 舊的一模一樣：黃金雜湊、動模擬之前凍結的電腦對電腦表、照頁面開局的紀錄
  old() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'old: the golden script battle is unchanged');
    for (const map of MAPS) for (const sym of [0, 1]) {
      const r = soak(map, sym, false), want = FROZEN_SOAK[`${map}/${sym}`];
      assert.deepEqual([r.hash, r.tick, r.blds], want, `old: AI against AI without the flag is bit for bit what it was before R087 (map ${map}, sym ${sym})`);
    }
    for (const [name, [log, want]] of Object.entries(FROZEN_LOGS)) assert.equal(replay600(log), want, `old: a log recorded before R087 replays to the same tick-600 hash (${name})`);
  },
  // 旗標：第 0 步的第一個 map 指令帶 more＝1 才有；折進雜湊；指令檢查與存檔編碼
  flag() {
    assert.equal(opened(MAP_HILLS, 1944, true).more, 1, 'flag: a map command with more 1 at step 0 sets it');
    assert.equal(opened(MAP_HILLS, 1944, false).more, undefined, 'fixture: without it there is no flag');
    const late = opened(MAP_HILLS, 1944, false), n0 = late.blds.length; step(late, [{ t: 'map', id: MAP_HILLS, more: 1 }]);
    assert.deepEqual([late.more, late.blds.length], [undefined, n0], 'flag: a later map command does not set it or add houses');
    { const t = opened(MAP_HILLS, 1944, false), n = t.blds.length; applyMoreHouses(t); assert.deepEqual([t.more, t.blds.length], [undefined, n], 'flag: the pass itself refuses a world past step 0'); }
    { const two = createWorld(1944); step(two, [{ t: 'map', id: MAP_HILLS }, { t: 'map', id: MAP_HILLS, more: 1 }]);
      assert.equal(two.more, undefined, 'flag: only the first map command at step 0 counts'); }
    assert.notEqual(hashWorld(opened(MAP_HILLS, 1944, true)), hashWorld(opened(MAP_HILLS, 1944, false)), 'flag: the flag is in the hash');
    { const a = opened(MAP_HILLS, 1944, true), b = structuredClone(a); delete b.more; assert.notEqual(hashWorld(a), hashWorld(b), 'flag: the flag itself (not only the houses) is in the hash'); }
    assert.deepEqual([isCommand({ t: 'map', id: 0, more: 1 }), isCommand({ t: 'map', id: 0, more: 'x' }), isCommand({ t: 'map', id: 0, more: 1.5 })], [true, false, false], 'flag: the command check takes 1 and refuses text and fractions');
    const w = opened(MAP_TOWN, 1944, true), back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert.equal(hashWorld(back), hashWorld(w), 'flag: the world codec round-trips a world with more');
    assert.equal(back.more, 1, 'flag: the codec keeps the flag');
    assert.equal(decodeWorld({ ...JSON.parse(JSON.stringify(encodeWorld(w))), more: 2 }), null, 'flag: the codec refuses a flag that is not 1');
    { const sb = createWorld(1944); sb.sandbox = { version: 1, running: false, frame: 0 }; applyMoreHouses(sb); assert.equal(sb.more, undefined, 'flag: a sandbox world gets no houses'); }
  },
  // 不抽世界的亂數；地形、植被、彈坑、既有的建築都不動（萊伊那三棟改成倉庫的除外）
  rng() {
    for (const map of MAPS) for (const seed of SEEDS) {
      const { a, b } = pairOf(map, seed);
      assert.equal(b.rng, a.rng, `rng: the pass draws nothing from World.rng (map ${map}, seed ${seed})`);
      assert.deepEqual([Buffer.from(b.ter).equals(Buffer.from(a.ter)), Buffer.from(b.crater).equals(Buffer.from(a.crater)), Buffer.from(b.vegetation?.cells ?? []).equals(Buffer.from(a.vegetation?.cells ?? [])), Buffer.from(b.height ?? []).equals(Buffer.from(a.height ?? []))], [true, true, true, true], `rng: ground, craters, vegetation and heights are untouched (map ${map}, seed ${seed})`);
      const quays = map === MAP_RYE ? new Set(RYE_QUAYS.map(([x, z]) => a.occ[cellIdx(a, x, z)])) : new Set();
      a.blds.forEach((o, i) => {
        const nb = b.blds[i];
        if (quays.has(o.id)) assert.deepEqual([nb.id, nb.x, nb.z, nb.w, nb.d, nb.kind, nb.floors, nb.hp, nb.maxHp], [o.id, o.x, o.z, o.w, o.d, BK_WAREHOUSE, 3, 210, 210], `rng: the three Strand barns become 3-storey warehouses in place (building ${o.id})`);
        else assert.deepEqual(nb, o, `rng: an existing building is unchanged (map ${map}, seed ${seed}, building ${o.id})`);
      });
      assert.deepEqual(JSON.stringify(b.units), JSON.stringify(a.units), `rng: units are untouched (map ${map}, seed ${seed})`);
    }
  },
  // 數量（種子 1944 與種子 0–49 的最少值）、成對、丘陵整個點對稱
  counts() {
    const want = { 0: [6, 6], [MAP_RYE]: [1, 1], [MAP_LARGE]: [12, 12], [MAP_TOWN]: [22, 20], [MAP_HILLS]: [4, 4] };
    for (const map of MAPS) {
      const at1944 = pairOf(map, 1944).added.length, least = Math.min(...SEEDS.map(s => pairOf(map, s).added.length));
      console.log(`  map ${map}: +${at1944} at seed 1944, at least +${least} over seeds 0-49`);
      assert.equal(at1944, want[map][0], `counts: seed 1944 adds the card's number of houses (map ${map})`);
      assert(least >= want[map][1], `counts: every seed 0-49 adds at least ${want[map][1]} (map ${map}: ${least})`);
    }
    { const { added } = pairOf(MAP_RYE, 1944); assert.deepEqual(added.map(b => [b.kind, b.x, b.z, b.w, b.d, b.floors]), [[BK_MILL, ...RYE_MILL, 1, 1, 3]], 'counts: Rye gets one smock mill on the west-bank field'); }
    for (const map of [0, MAP_LARGE, MAP_TOWN]) for (const seed of SEEDS) {
      const { b, added } = pairOf(map, seed);
      for (const o of added) assert(added.some(p => p !== o && p.kind === o.kind && p.w === o.w && p.d === o.d && p.floors === o.floors && p.x === b.n - o.x - o.w && p.z === b.n - o.z - o.d), `counts: every new house has a point-symmetric twin (map ${map}, seed ${seed}, building ${o.id})`);
      if (map === MAP_TOWN) for (const k of [BK_MILL, BK_OAST]) assert(added.some(o => o.kind === k), `counts: the 96 map gets the landmark kind ${k} (seed ${seed})`);
    }
    for (const seed of [1944, 7]) {
      const w = opened(MAP_HILLS, seed, true), key = b => [b.kind, b.x, b.z, b.w, b.d, b.floors].join();
      const set = new Set(w.blds.map(key));
      for (const b of w.blds) assert(set.has(key({ ...b, x: w.n - b.x - b.w, z: w.n - b.z - b.d })), `counts: Hills stays fully point-symmetric (building ${b.id})`);
    }
  },
  // 放得安全：每一條規矩（照定義重算）、從兩邊的指揮部都走得到、指揮部的格子不變、開局的單位不在房子裡
  rules() {
    for (const map of MAPS) for (const seed of SEEDS) {
      const { a, b, added } = pairOf(map, seed);
      for (const o of added) {   // 萊伊、丘陵的表也照同一套規矩檢查
        const why = ruleBreaks(a, o, b.blds.filter(p => p.id !== o.id));
        assert.deepEqual(why, [], `rules: a new house follows every placement rule (map ${map}, seed ${seed}, building ${o.id} kind ${o.kind} at ${o.x},${o.z})`);
      }
    }
    for (const map of MAPS) for (const sym of [0, 1]) for (const seed of SEEDS.concat([1944])) {
      const w = opened(map, seed, true, [ECO], sym), off = opened(map, seed, false, [ECO], sym);
      assert.deepEqual(hqCells(w), hqCells(off), `rules: the headquarters stand on the same cells with and without the flag (map ${map}, sym ${sym}, seed ${seed})`);
      const added = w.blds.filter(b => b.id > off.blds.length - 2 && b.kind !== BK_HQ);
      for (const s of [0, 1]) {
        const hq = w.blds[w.eco.hq[s] - 1];
        let start = null;
        for (let dz = -1; dz <= hq.d && !start; dz++) for (let dx = -1; dx <= hq.w && !start; dx++) { const x = hq.x + dx, z = hq.z + dz; if (inGrid(w, x, z) && !blocks(w, x, z)) start = [x, z]; }
        const seen = reach(w, ...start);
        for (const o of added) {
          let ok = false;
          for (let dz = -1; dz <= o.d && !ok; dz++) for (let dx = -1; dx <= o.w && !ok; dx++) { const x = o.x + dx, z = o.z + dz; if (inGrid(w, x, z) && seen[cellIdx(w, x, z)]) ok = true; }
          assert(ok, `rules: every new house can be reached from both headquarters (map ${map}, seed ${seed}, side ${s}, building ${o.id})`);
        }
      }
    }
    for (const map of MAPS) for (const force of [1, 3]) for (const seed of [1944, 3]) {
      const w = opened(map, seed, true, [{ t: 'rules', force }, ECO]);
      for (const u of w.units) if (u.alive) { const b = w.blds[w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))] - 1]; assert(!b || !NEW.has(b.kind), `rules: no unit starts inside a new house (map ${map}, force ${force}, unit ${u.id})`); }
    }
    for (const map of [MAP_RYE, MAP_LARGE]) {   // 喪屍：一夜裡冒出來的不卡在新房子裡
      const w = createWorld(1944); step(w, [{ t: 'map', id: map, vegetation: 1, more: 1 }, { t: 'zombies' }]);
      for (let t = 0; t < 1500; t++) step(w, []);
      for (const u of w.units) if (u.alive && u.kind === UK_ZOMBIE) { const b = w.blds[w.occ[cellIdx(w, cellOf(u.x), cellOf(u.z))] - 1]; assert(!b || !NEW.has(b.kind) || b.hp <= 0, `rules: zombies do not spawn inside a new house (map ${map}, unit ${u.id})`); }
    }
  },
  // 布陣還有地方：電腦的布陣花完 8 點的種子數不比沒帶時少；每一種能布的東西在每張地圖上至少 20 個合法的我方位置；沒帶時逐位一樣
  planner() {
    const h = createHash('sha256');
    for (const map of MAPS) for (const table of [BUILD_KINDS, BUILD_KINDS_24]) {
      let full = [0, 0];
      for (const seed of SEEDS) for (const more of [false, true]) {
        const w = opened(map, seed, more); w.tick = 0;
        const plan = enemyPlan(w, table);
        if (!more) h.update(JSON.stringify(plan));
        if (plan.reduce((s, c) => s + table.find(k => k.kind === c.kind).cost, 0) === BUILD_POINTS) full[more ? 1 : 0]++;
      }
      assert(full[1] >= full[0], `planner: with the flag the computer spends all 8 points in as many seeds as without (map ${map}, table ${table.length}: ${full[1]} vs ${full[0]})`);
    }
    assert.equal(h.digest('hex').slice(0, 16), FROZEN_PLAN, 'planner: without the flag the computer plans exactly what it planned before R087');
    for (const map of MAPS) {
      const w = opened(map, 1944, true); w.tick = 0;
      for (const k of [...BUILD_KINDS_24, ...WALL_KINDS, WIRE_KIND]) {
        let legal = 0;   // 從我方角落往外數，數到 20 個就停（每一個合法的位置都要走一次通路檢查）
        scan: for (let z = w.n - 1; z >= 0; z--) for (let x = w.n - 1; x >= 0; x--) for (const rot of k.w === k.d ? [0] : [0, 1]) if (ringFree(w, x, z, rot ? k.d : k.w, rot ? k.w : k.d) && buildError(w, { t: 'build', side: SIDE_PLAYER, kind: k.kind, x, z, rot }) === null && ++legal >= 20) break scan;
        assert(legal >= 20, `planner: the player still has at least 20 places for a ${k.name} (map ${map}: ${legal})`);
      }
    }
  },
  // 模擬的性質：材質與耐久、三段損壞、擋路、駐守、布陣不收新種類、存檔
  props() {
    assert.deepEqual([bldMaterial(BK_OAST), bldMaterial(BK_MILL), bldMaterial(BK_WAREHOUSE)], [BM_BRICK, BM_WOOD, BM_WOOD], 'props: the oast is brick, the mill and the warehouse are wood');
    assert.deepEqual([bldMaxHp(BK_OAST, 2, 1, 2), bldMaxHp(BK_MILL, 1, 1, 3), bldMaxHp(BK_WAREHOUSE, 1, 2, 3), bldMaxHp(BK_WAREHOUSE, 2, 2, 3)], [210, 120, 210, 390], 'props: durability follows the material rule');
    const w = opened(MAP_TOWN, 1944, true);
    for (const b of w.blds.filter(b => NEW.has(b.kind))) {
      assert.equal(b.maxHp, bldMaxHp(b.kind, b.w, b.d, b.floors), `props: a placed house has its material's durability (building ${b.id})`);
      assert(blocks(w, b.x, b.z), `props: an intact new house blocks (building ${b.id})`);
      const c = { ...b }; c.hp = Math.floor(c.maxHp * 0.7); assert.equal(stageOf(c), STAGE_ROOFLESS); c.hp = 0; assert.equal(stageOf(c), STAGE_RUBBLE); assert.equal(stageOf(b), STAGE_INTACT);
    }
    { const r = createWorld(1944); applyMap(r, MAP_RYE, 1);   // 第 0 步之前（布陣的時候）
      for (const kind of [BK_OAST, BK_MILL, BK_WAREHOUSE]) assert.equal(buildError(r, { t: 'build', side: SIDE_PLAYER, kind, x: 20, z: 26, rot: 0 }), 'kind', `props: the new kinds cannot be built in the deployment phase (kind ${kind})`); }
    assert.deepEqual([BUILD_KINDS.length, BUILD_KINDS_24.length, WALL_KINDS.length], [3, 4, 3], 'props: the build tables keep their length');
    // 駐守：步兵走進風車
    { const r = createWorld(1944); step(r, [{ t: 'map', id: MAP_RYE, vegetation: 1, more: 1 }]);
      const mill = r.blds.find(b => b.kind === BK_MILL), k = UNIT_KINDS[UK_INFANTRY], id = r.units.length + 1;
      r.units.push({ id, side: SIDE_PLAYER, kind: UK_INFANTRY, x: center(mill.x - 2), z: center(mill.z + 1), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: 0, aimZ: 0 });
      step(r, [{ t: 'move', side: SIDE_PLAYER, ids: [id], x: mill.x, z: mill.z }]);   // move 的座標是格
      for (let t = 0; t < 400; t++) step(r, []);
      const u = r.units[id - 1];
      assert.deepEqual([cellOf(u.x), cellOf(u.z)], [mill.x, mill.z], 'props: infantry can garrison the mill like any house'); }
    // 存檔：R087 的局第 300 步存、讀回來雜湊一樣
    { const s = createWorld(1944), log = [{ tick: 0, cmd: { t: 'map', id: MAP_LARGE, vegetation: 1, sym: 1, more: 1 } }, { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 3 } }];
      runLog(s, log, 300);
      const text = makeSave(s, log, null, '2026-11-18T00:00:00.000Z'), back = checkSave(text);
      assert(back.ok, 'props: an R087 save at tick 300 reads back');
      assert.equal(hashWorld(back.save.world), hashWorld(s), 'props: an R087 save at tick 300 reloads with the same hash');
      const cont = createWorld(1944); runLog(cont, log, 600); const resumed = back.save.world; for (let t = 300; t < 600; t++) step(resumed, []);
      assert.equal(hashWorld(resumed), hashWorld(cont), 'props: the reloaded R087 battle carries on exactly'); }
  },
  // 頁面等於重播：在沙盒裡跑 main.ts 真的 reset() 與 issue()、真的遭遇戰設定（skirmish.start 多放房子），第 0 步之後跟 runLog 一樣
  page() {
    const source = stripTypeScriptTypes(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
    const reset = source.match(/function reset\([^]*?\n\}/)?.[0], issue = source.match(/function issue\([^]*?\n\}/)?.[0];
    assert(reset && issue, 'fixture: the real reset() and issue() exist');
    for (const map of MAPS) for (const sym of [0, 1]) for (const force of [1, 2, 3]) for (const zombies of map === MAP_RYE || map === MAP_LARGE ? [false, true] : [false]) for (const r087 of [true, false]) {
      if (zombies && force !== 2) continue;
      const q = new URLSearchParams(`map=${map === 0 ? 'village' : map === MAP_HILLS ? 'hills' : 'rye'}&force=${force}${zombies ? '&mode=zombies' : ''}${r087 ? '' : '&noR087=1'}`);
      const c = vm.createContext({
        setViewSide() {}, clearGestureInput() {}, battleAudio: undefined, createWorld, createSandboxWorld: createWorld, applyMap, applyMoreHouses, startZombies, MAP_RYE, MAP_HILLS, MAP_LARGE, MAP_TOWN, SIDE_ENEMY, seed: 1944,
        V: { r006: false, r018: true, r019: true, r026: true, r045: true, r057: true, r078: true, r084: !!sym, r087, r109: false },
        large: map === MAP_LARGE, expanded: map === MAP_TOWN, q, skirmish: initSkirmish(q, true), netLive: () => false, commandTick, pending: [],
        makeView() {}, view: { target: { set() {} } }, selected: new Set(), newStats: () => ({}), reportView: undefined, planner: { clear() {}, refreshPreview() {} }, ui() {}, syncBattleAudio() {},
        ecoCmd: () => ECO, aiLevel: 2,
      });
      vm.runInContext(reset + issue, c); c.reset();
      const page = c.w, log = JSON.parse(JSON.stringify(c.log));
      assert.equal(log[0].cmd.more, r087 ? 1 : undefined, `page: a new battle sends more 1 exactly when R087 is on (map ${map})`);
      step(page, log.map(e => e.cmd));
      const replay = runLog(createWorld(1944), log, 1);
      const tag = `map ${map}, sym ${sym}, force ${force}, zombies ${zombies}, r087 ${r087}`;
      assert.equal(hashWorld(page), hashWorld(replay), `page: the opening on the page equals the replay of its own log (${tag})`);
      // 欄位順序：R084 的 sym 在頁面上比 rules 晚折（R084 就是這樣，跟 R087 無關）；拿掉 sym 之後一模一樣，more 緊跟在地圖的欄位後面
      const keys = o => Object.keys(o).filter(k => k !== 'sym');
      assert.deepEqual(keys(page), keys(replay), `page: the world's own field order matches the replay (${tag})`);
      if (r087) { const kp = keys(page), ref = keys(opened(map, 1944, true)), i = kp.indexOf('more'); assert(i > 0 && kp[i - 1] === ref[ref.indexOf('more') - 1], `page: more sits right after the map's own fields (${tag})`); }   // 審查 R087-guard-key-order：跟只套了地圖的世界比
    }
    // 沒有遭遇戰設定（?noR046=1，main.ts 不建 skirmish）：新房子跟著遭遇戰設定放，這時新開的局沒有新房子、map 指令也不帶 more；頁面照樣等於重播（審查 R087-wiring-r046）
    for (const map of [MAP_RYE, MAP_LARGE]) {
      const q = new URLSearchParams('noR046=1');
      const c = vm.createContext({
        setViewSide() {}, clearGestureInput() {}, battleAudio: undefined, createWorld, createSandboxWorld: createWorld, applyMap, applyMoreHouses, startZombies, MAP_RYE, MAP_HILLS, MAP_LARGE, MAP_TOWN, SIDE_ENEMY, seed: 1944,
        V: { r006: false, r018: true, r019: true, r026: true, r045: true, r057: true, r078: true, r084: true, r087: true, r109: false },
        large: map === MAP_LARGE, expanded: false, q, skirmish: undefined, netLive: () => false, commandTick, pending: [],
        makeView() {}, view: { target: { set() {} } }, selected: new Set(), newStats: () => ({}), reportView: undefined, planner: { clear() {}, refreshPreview() {} }, ui() {}, syncBattleAudio() {},
        ecoCmd: () => ECO, aiLevel: 2,
      });
      vm.runInContext(reset + issue, c); c.reset();
      const log = JSON.parse(JSON.stringify(c.log));
      assert.deepEqual([c.w.more, log[0].cmd.more], [undefined, undefined], `page: without the skirmish setup (?noR046=1) a new battle has no new houses and sends no more (map ${map})`);
      step(c.w, log.map(e => e.cmd));
      assert.equal(hashWorld(c.w), hashWorld(runLog(createWorld(1944), log, 1)), `page: without the skirmish setup the page still equals the replay (map ${map})`);
    }
  },
  // 效能：96 圖 applyMoreHouses 的中位數 ≤ 30 毫秒
  perf() {
    const ts = [];
    for (let k = 0; k < 15; k++) { const w = createWorld(1944 + k); applyMap(w, MAP_TOWN, 1); const t0 = performance.now(); applyMoreHouses(w); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b);
    console.log(`  applyMoreHouses on the 96 map: median ${ts[7].toFixed(1)} ms`);
    assert(ts[7] <= 30, `perf: the pass takes at most 30 ms on the 96 map (median ${ts[7].toFixed(1)} ms)`);
  },
  // 長跑：地圖 0–4、種子 1–3、6000 步、more：第二版對第二版、第三版對第三版；不出錯、跑兩次一樣；新房子被駐守了幾次
  soak() {
    const out = [];
    for (const map of MAPS) for (const v of [2, 3]) for (const seed of [1, 2, 3]) {
      const a = soak(map, 1, true, 6000, v, seed);
      if (seed === 1) assert.equal(soak(map, 1, true, 6000, v, seed).hash, a.hash, `soak: two runs give the same hash (map ${map}, v${v}, seed ${seed})`);   // 跑兩次只做種子 1（時間）
      out.push(`${map}/v${v}/${seed}:${a.tick}t,${a.garrisons}g`);
    }
    console.log(`  soak (map/version/seed: ticks, times a new house was garrisoned): ${out.join(' ')}`);
  },
  // 接線：新開的局送 more（閥關掉不送）；閥在表上
  wiring() {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(main, /function issue\(cmd: Command\) \{ if \(cmd\.t === 'map' && w\.more && !w\.tick\) cmd = \{ \.\.\.cmd, more: 1 \};/, 'wiring: the page sends more 1 exactly when its world already has the houses');
    assert.match(readFileSync(new URL('../src/ui/skirmish.ts', import.meta.url), 'utf8'), /start: w => \{\n {6}if \(!w\.sandbox && w\.tick === 0 && valves\(q\)\.r087\) applyMoreHouses\(w\);/, 'wiring: a new battle places the houses right after the map, before the rules');
    assert.match(readFileSync(new URL('../src/valves.ts', import.meta.url), 'utf8'), /get r087\(\) \{ return on\('087'\); \}/, 'wiring: the valve is on the table');
    assert(main.split('\n').length <= 673, 'wiring: main.ts stays within its line budget');
  },
};

// 直接跑這支：快的群組（布陣在 more-houses-planner.mjs、長跑在 more-houses-soak.mjs、故意弄壞在 more-houses-negative.mjs；每支都要在 tools/unit.mjs 的 120 秒內）
export const QUICK = ['old', 'flag', 'rng', 'counts', 'rules', 'props', 'page', 'perf', 'wiring'];   // planner 在 more-houses-planner.mjs
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`more-houses/${only}: OK`); process.exit(0); }
  for (const name of QUICK) { const t0 = performance.now(); groups[name](); console.log(`OK more-houses/${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`); }
  console.log('more-houses: all groups OK');
}
