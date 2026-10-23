// R042：地圖大小是世界自己的欄位 w.n。靜態掃描 src/ 不再用常數 N、idx、inMap（含別名匯入）；
// 在守衛自己拼的 64×64 空場地上逐處驗改看 w.n 的地方：尋路、推擠、隊形、視線、直射與高爆落點、掩護、聲測分區、
// 電腦的搜索點、指揮部與出生格、布陣半場、牆與鐵絲網、畫面緩衝與鏡頭、小地圖、介面邊界、音效；
// 再打一場 600 步的仗，雜湊凍結在 7ca34b19，指令紀錄經 JSON 來回重播、中途 structuredClone 接著跑，雜湊都要相同。
// 距離、時間都從 UNIT_KINDS 推；用法：node tests/map-size.mjs [群組名]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorld, hashWorld, SUB, center, cellOf, cellIdx, gridLimit, speedPct, wireAt, UNIT_KINDS, ORD_IDLE, ORD_MOVE,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, UK_HEAVY, BK_HOUSE, BK_COTTAGE, BK_WIRE, BK_WALL_BRICK, SHELL_HE,
  STAGE_RUBBLE, bldMaxHp, SIDE_PLAYER, SIDE_ENEMY,
} from '../src/sim/world.ts';
import { step, runLog, lineCells, firstBlock, spotted, FIRE_AT_ROUNDS } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { territory, buildError, applyBuild, enemyPlan, footprint } from '../src/sim/build.ts';
import { trenchError, trenchAt } from '../src/sim/trenches.ts';
import { startEco, produce } from '../src/sim/eco.ts';
import { setAi, aiThink } from '../src/sim/ai.ts';
import { vegetationAt, clearVegetation, VEG_NONE, VEG_WOOD, VEGETATION_VERSION } from '../src/sim/vegetation.ts';
import { sandboxPlaceError } from '../src/sim/sandbox.ts';
import { counterbatteryAreas } from '../src/sim/counterbattery.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { BattleView } from '../src/render/battle.ts';
import { vegetationGeometry } from '../src/render/vegetation.ts';
import { TRENCH_MINI_COLORS } from '../src/render/trenches.ts';
import { BattleAudio } from '../src/render/audio.ts';
import { miniGeo, toMini, initMinimap } from '../src/ui/minimap.ts';
import { bombardTarget, bombardCommand } from '../src/ui/commandMenu.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { drawCounterbattery } from '../src/ui/counterbattery.ts';

const N64 = 64, OLD = 32;   // 新的邊長；舊的固定邊長只用來確認「超過舊邊界」
const only = process.argv[2]; let groups = 0;
async function group(name, fn) { if (only && only !== name) return; groups++; await fn(); console.log(`OK map-size/${name}`); }

// 64×64 空場地：拿 createWorld 的世界，照 64 重配地形／建築／彈坑格表（地形全是草地），清掉建築、單位、砲彈
function field(seed = 4242) {
  const w = createWorld(seed);
  w.n = N64; w.ter = new Uint8Array(N64 * N64); w.occ = new Int32Array(N64 * N64); w.crater = new Uint8Array(N64 * N64);
  w.blds = []; w.units = []; w.shells = []; w.events = []; w.winner = -1;
  return w;
}
// 跟 createWorld 的 spawn 同一個形狀
function addUnit(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind], d = side === SIDE_PLAYER ? -SUB : SUB;
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(k.armored ? { hullX: d, hullZ: d } : {}) };
  w.units.push(u); return u;
}
function addBld(w, x, z, bw = 1, bd = 1, kind = BK_HOUSE, floors = 2) {
  const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
  w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = id;
  return w.blds[id - 1];
}
const decode = c => [c % N64, (c - (c % N64)) / N64];
const adjacent = (a, b) => { const [ax, az] = decode(a), [bx, bz] = decode(b); return Math.max(Math.abs(ax - bx), Math.abs(az - bz)) === 1; };
const H = (i, s) => ((Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca6b)) >>> 0) % N64;   // 固定抽樣，不用亂數
// 一格要走幾步的上界：field() 全是草地，用它的地形速度（speedPct）＋斜走一格
const GRASS = speedPct(field(), 0, 0);
const ticksPerCell = kind => Math.ceil((SUB * 3 / 2) / Math.max(1, Math.floor((UNIT_KINDS[kind].speed * GRASS) / 100))) + 1;

await group('static', () => {
  // src/ 除了 world.ts 自己的定義（舊守衛專用的 N／idx／inMap，以及 createWorld 的預設大小）以外，不准出現這三個名字；
  // 比對名字而不是呼叫，別名匯入（import { inMap as onMap }）也抓得到
  const root = fileURLToPath(new URL('../src', import.meta.url)), bad = [];
  const allowed = [/^export const N = 32;/, /^export const idx = /, /^export const inMap = /, /^ {4}seed: seed >>> 0, tick: 0, rng: seed >>> 0, n: N,$/, /^ {4}ter: new Uint8Array\(N \* N\), occ: new Int32Array\(N \* N\), crater: new Uint8Array\(N \* N\),$/];
  const used = allowed.map(() => 0);
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(ts|js|mjs)$/.test(e.name)) continue;
    const rel = path.relative(root, p).split(path.sep).join('/');
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (!/\bN\b|\bidx\b|\binMap\b/.test(line)) return;
      const k = rel === 'sim/world.ts' ? allowed.findIndex(r => r.test(line)) : -1;
      if (k >= 0) used[k]++; else bad.push(`src/${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  } };
  walk(root);
  assert.deepEqual(bad, [], 'static: src/ no longer uses the fixed N, idx( or inMap(');
  assert.deepEqual(used, allowed.map(() => 1), 'static: world.ts keeps exactly the legacy definitions');
});

await group('path', () => {
  const w = field(), wall = [];
  for (let z = 30; z < 60; z++) wall.push(addBld(w, 45, z));   // 一道 x=45 的牆，逼尋路繞過 z≥60 的那一頭
  for (const [sx, sz, gx, gz] of [[2, 2, 60, 61], [40, 50, 50, 40], [63, 0, 0, 63], [33, 33, 63, 63]]) {
    const p = findPath(w, sx, sz, gx, gz);
    assert.equal(p.at(-1), cellIdx(w, gx, gz), `path: reaches (${gx},${gz}) beyond the old ${OLD}×${OLD} edge`);
    assert(p.every((c, i) => adjacent(i ? p[i - 1] : cellIdx(w, sx, sz), c)), 'path: every step is one 64-grid neighbor');
    assert(p.every(c => !w.occ[c]), 'path: detours around standing buildings beyond x,z > 32');
    if (sx === 40) assert(p.some(c => decode(c)[1] >= 60), 'path: wall forces a detour through z ≥ 60');
  }
  const t = addUnit(w, SIDE_PLAYER, UK_TANK, 40, 50);
  step(w, [{ t: 'move', side: SIDE_PLAYER, ids: [t.id], x: 50, z: 40 }]);
  const need = t.path.length * ticksPerCell(UK_TANK);
  for (let i = 0; i < need && t.order === ORD_MOVE; i++) step(w, []);
  assert.deepEqual([t.x, t.z], [center(50), center(40)], 'path: a tank walks there in the derived time');
  // 推擠夾在 64 的邊界以內：疊在 (50,50) 的兩台車推開一步，仍在原地附近
  const m = field(), p = addUnit(m, SIDE_PLAYER, UK_TANK, 50, 50), q = addUnit(m, SIDE_PLAYER, UK_TANK, 50, 50);
  step(m, []);
  assert((p.x !== q.x || p.z !== q.z) && [p, q].every(u => cellOf(u.x) === 50 && cellOf(u.z) === 50), 'path: overlapping tanks beyond 32 are pushed apart in place');
  // 隊形：第二台車的隊形格在 32 以外照樣成立
  step(m, [{ t: 'move', side: SIDE_PLAYER, ids: [p.id, q.id], x: 55, z: 40 }]);
  assert.deepEqual([p.tx, p.tz], [55, 40], 'path: the first tank takes the ordered cell beyond 32');
  assert((q.tx !== 55 || q.tz !== 40) && Math.abs(q.tx - 55) <= 2 && Math.abs(q.tz - 40) <= 2, 'path: the second tank takes a formation slot beyond 32');
});

await group('los', () => {
  const w = field();
  for (let i = 0; i < 40; i++) { const x = H(i, 1), z = H(i, 2); if (!w.occ[cellIdx(w, x, z)]) addBld(w, x, z); }
  let rays = 0, seen = 0;
  const reach = Math.floor(UNIT_KINDS[UK_OBSERVER].sight / SUB / 2) * 2, span = 2 * reach + 1;   // 抽在觀測員視野內的兩點
  for (let i = 0; i < 1000 && rays < 200; i++) {
    const ax = H(i, 3), az = H(i, 4), bx = ax + (H(i, 5) % span) - reach, bz = az + (H(i, 6) % span) - reach;
    if (bx < 0 || bz < 0 || bx >= N64 || bz >= N64 || (ax === bx && az === bz)) continue;
    if (w.occ[cellIdx(w, ax, az)] || w.occ[cellIdx(w, bx, bz)]) continue;
    const ab = lineCells(ax, az, bx, bz, w.n), ba = lineCells(bx, bz, ax, az, w.n);
    assert.deepEqual(ab, [...ba].reverse(), 'los: A→B and B→A cross the same 64-grid cells');
    assert.equal(ab[0], cellIdx(w, ax, az), 'los: ray starts at A'); assert.equal(ab.at(-1), cellIdx(w, bx, bz), 'los: ray ends at B');
    assert(ab.every((c, k) => !k || adjacent(ab[k - 1], c)), 'los: ray cells are 64-grid neighbors');
    const A = [center(ax), center(az)], B = [center(bx), center(bz)];
    assert.equal(firstBlock(w, ...A, ...B) < 0, firstBlock(w, ...B, ...A) < 0, 'los: physical block is symmetric');
    const a = addUnit(w, SIDE_PLAYER, UK_OBSERVER, ax, az), b = addUnit(w, SIDE_ENEMY, UK_OBSERVER, bx, bz);
    const ok = spotted(w, SIDE_PLAYER, b.x, b.z);
    assert.equal(ok, spotted(w, SIDE_ENEMY, a.x, a.z), 'los: observers see each other symmetrically');
    if (ok) seen++;
    w.units.length = 0; rays++;
  }
  assert(rays === 200 && seen > 0 && seen < rays, `los: sampled ${rays} rays mix visible and blocked (${seen})`);
  const v = field(), sight = UNIT_KINDS[UK_OBSERVER].sight / SUB, x0 = N64 - 2 - Math.floor(sight), z = 50;
  const a = addUnit(v, SIDE_PLAYER, UK_OBSERVER, x0, z), b = addUnit(v, SIDE_ENEMY, UK_OBSERVER, x0 + Math.floor(sight), z);
  assert(spotted(v, SIDE_PLAYER, b.x, b.z), 'los: open ground beyond 32 is visible within sight');
  const house = addBld(v, x0 + 3, z);
  assert.equal(firstBlock(v, a.x, a.z, b.x, b.z), cellIdx(v, house.x, house.z), 'los: the 64-grid house cell is the block');
  assert(!spotted(v, SIDE_PLAYER, b.x, b.z) && !spotted(v, SIDE_ENEMY, a.x, a.z), 'los: a house beyond 32 blocks both ways');
  assert(spotted(v, SIDE_PLAYER, center(house.x), center(house.z)), 'los: the blocking house beyond 32 is itself visible');
  // 直射被 32 以外的房子擋住：砲彈落在那棟房子的格子上
  const f = field(), reachT = Math.floor(UNIT_KINDS[UK_TANK].range / SUB), gx = 50, wall = addBld(f, gx + (reachT >> 1), 50);
  const shooter = addUnit(f, SIDE_PLAYER, UK_TANK, gx, 50), foe = addUnit(f, SIDE_ENEMY, UK_TANK, gx + reachT - 1, 50);
  step(f, [{ t: 'attack', side: SIDE_PLAYER, ids: [shooter.id], target: foe.id }]);
  for (let i = 0; i < 2 * UNIT_KINDS[UK_TANK].reload && !f.shells.length; i++) step(f, []);
  assert.deepEqual(f.shells.map(s => [s.hitBld, s.ex, s.ez]), [[wall.id, center(wall.x), center(wall.z)]], 'los: a direct shot blocked beyond 32 lands on that house cell');
});

await group('shell', () => {
  const w = field(), k = UNIT_KINDS[UK_HOWITZER], span = Math.floor((k.minRange + k.range) / (2 * SUB));
  const guns = [addUnit(w, SIDE_PLAYER, UK_HOWITZER, N64 - 1 - span, N64 - 1), addUnit(w, SIDE_PLAYER, UK_HOWITZER, N64 - 1, N64 - 1 - span)];
  step(w, [{ t: 'fireAt', side: SIDE_PLAYER, ids: guns.map(g => g.id), x: N64 - 1, z: N64 - 1 }]);
  const landed = [], limit = gridLimit(w), until = FIRE_AT_ROUNDS * k.reload + 20 + 2 * (span + 2);
  for (let t = 0; t < until && (landed.length < 2 * FIRE_AT_ROUNDS || w.shells.length); t++) {
    for (const s of w.shells) { assert(s.ex >= 0 && s.ez >= 0 && s.ex <= limit && s.ez <= limit, 'shell: HE landing clamped inside 64 * SUB - 1'); }
    for (const e of w.events) if (e.e === 'impact') landed.push([e.x, e.z]);
    step(w, []);
  }
  assert.equal(landed.length, 2 * FIRE_AT_ROUNDS, 'shell: every ordered round lands');
  assert.equal(limit, N64 * SUB - 1);
  assert(landed.every(([x, z]) => x > OLD * SUB && z > OLD * SUB), 'shell: rounds land beyond the old 32-cell clamp');
  assert(w.crater[cellIdx(w, N64 - 1, N64 - 1)] + w.crater[cellIdx(w, N64 - 2, N64 - 1)] + w.crater[cellIdx(w, N64 - 1, N64 - 2)] + w.crater[cellIdx(w, N64 - 2, N64 - 2)] > 0, 'shell: craters dug in the 64-grid corner');
});

// 敵方三門砲在 64×64 的三個角落附近開火，我方聽到；我方在 (40,40) 有一段戰壕（給小地圖）
function heard() {
  const w = field(), k = UNIT_KINDS[UK_HOWITZER], span = Math.floor((k.minRange + k.range) / (2 * SUB));
  const spots = [[55, 58], [5, 60], [60, 5]];
  const guns = spots.map(([x, z]) => addUnit(w, SIDE_ENEMY, UK_HOWITZER, x, z));
  step(w, [...guns.map(g => ({ t: 'fireAt', side: SIDE_ENEMY, ids: [g.id], x: Math.floor(g.x / SUB) + (g.x < OLD * SUB ? span : -span), z: Math.floor(g.z / SUB) })),
    { t: 'trench', side: SIDE_PLAYER, kind: 0, x: 40, z: 40 }]);
  return { w, guns, spots };
}

await group('counterbattery', () => {
  const { w, guns, spots } = heard(), zones = Math.ceil(N64 / 8);
  const reports = w.counterbattery ?? [];
  assert.equal(reports.length, spots.length, 'counterbattery: each gun is heard');
  const want = spots.map(([x, z]) => Math.floor(z / 8) * zones + Math.floor(x / 8)).sort((a, b) => a - b);
  assert.deepEqual(reports.map(r => r.zone).sort((a, b) => a - b), want, 'counterbattery: zone ids index the 8×8 zones of a 64×64 map');
  assert(reports.every(r => r.side === SIDE_PLAYER && r.zone >= 0 && r.zone < zones * zones), 'counterbattery: zones stay inside 64×64');
  const areas = counterbatteryAreas(w, SIDE_PLAYER);
  assert.equal(areas.length, spots.length);
  for (const g of guns) assert(areas.some(a => Math.abs(a.x - g.x) <= 8 * SUB && Math.abs(a.z - g.z) <= 8 * SUB), 'counterbattery: projected area surrounds the real gun');
  const ops = [], ctx = { save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {}, stroke() {}, setLineDash() {}, moveTo: (x, z) => ops.push([x, z]), lineTo: (x, z) => ops.push([x, z]) };
  drawCounterbattery(ctx, w, (x, z) => [x, z], true, w.n);
  assert.deepEqual(ops.slice(0, 4), [[0, 0], [N64, 0], [N64, N64], [0, N64]], 'counterbattery: clip polygon is the 64×64 map');
  // 雙方同一步開火：粗區編號正好差 32×32 地圖的 16 區，各自仍是一筆（鍵要用 64 的粗區數）
  const k = UNIT_KINDS[UK_HOWITZER], span = Math.floor((k.minRange + k.range) / (2 * SUB)), both = field(), zoneOf = u => Math.floor(cellOf(u.z) / 8) * zones + Math.floor(cellOf(u.x) / 8);
  const eg = addUnit(both, SIDE_ENEMY, UK_HOWITZER, 55, 58), pg = addUnit(both, SIDE_PLAYER, UK_HOWITZER, 50, 42);
  assert.equal(zoneOf(eg) - zoneOf(pg), (OLD / 8) ** 2);
  step(both, [eg, pg].map(g => ({ t: 'fireAt', side: g.side, ids: [g.id], x: cellOf(g.x) - span, z: cellOf(g.z) })));
  assert.deepEqual((both.counterbattery ?? []).map(r => [r.side, r.zone]), [[SIDE_PLAYER, zoneOf(eg)], [SIDE_ENEMY, zoneOf(pg)]], 'counterbattery: both sides keep their own report on 64');
});

// 小地圖整條接線：最小的 DOM 替身，畫一幀、點一下
await group('minimap', () => {
  const { w } = heard(), log = { fills: 0, clips: [], taps: [], strokes: [] }, handlers = {};
  assert(trenchAt(w, 40, 40), 'minimap: fixture has a trench beyond 32');
  const ctx = { path: [], setTransform() {}, clearRect() {}, fillRect() {}, drawImage() {}, save() {}, restore() {}, setLineDash() {}, closePath() {},
    stroke() { log.strokes.push(this.strokeStyle); },
    beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); }, lineTo(x, y) { this.path.push([x, y]); }, fill() { log.fills++; }, clip() { log.clips.push(this.path); } };
  const canvas = () => ({ style: {}, width: 0, height: 0, getContext: () => ctx, addEventListener: (type, fn) => { handlers[type] = fn; }, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  const saved = { document: globalThis.document, innerWidth: globalThis.innerWidth, devicePixelRatio: globalThis.devicePixelRatio };
  Object.assign(globalThis, { document: { createElement: canvas, getElementById: () => null, body: { appendChild() {} } }, innerWidth: 1000, devicePixelRatio: 1 });
  try {
    let cur = w;
    const m = initMinimap({ world: () => cur, visible: () => true, view: () => [], tap: (x, z) => log.taps.push([x, z]) });
    m.frame(1000);
    const g = miniGeo(200, N64);
    assert.equal(log.fills, N64 * N64, 'minimap: base paints every one of the 64×64 cells');
    assert(log.strokes.includes(TRENCH_MINI_COLORS[0]), 'minimap: a trench beyond 32 is drawn');
    assert.deepEqual(log.clips[0], [[g.w / 2, 0], [g.w, g.h / 2], [g.w / 2, g.h], [0, g.h / 2]], 'minimap: counterbattery clip is the whole 64-map diamond');
    const [px, py] = toMini(g, 60.5, 61.5);
    handlers.pointerup({ clientX: px, clientY: py, stopPropagation() {} });
    assert.equal(log.taps.length, 1, 'minimap: tap beyond 32 jumps the camera');
    assert(Math.abs(log.taps[0][0] - 60.5) < 1e-9 && Math.abs(log.taps[0][1] - 61.5) < 1e-9);
    // 換到 32×32 的世界（同樣的畫布寬）：小地圖照新的邊長重算幾何，點擊落在 32 的座標上
    cur = createWorld(1944); m.frame(2000);
    const [sx, sy] = toMini(miniGeo(200, OLD), 20.5, 21.5);
    handlers.pointerup({ clientX: sx, clientY: sy, stopPropagation() {} });
    assert(log.taps.length === 2 && Math.abs(log.taps[1][0] - 20.5) < 1e-9 && Math.abs(log.taps[1][1] - 21.5) < 1e-9, 'minimap: switching to a 32 world recomputes the geometry');
  } finally { Object.assign(globalThis, saved); }
});

// 電腦對手：開局的目標是 64 地圖上對方的角落；到了看不到人就換搜索點（中央 → 另外兩角）
await group('ai', () => {
  const w = field(), e = addUnit(w, SIDE_ENEMY, UK_TANK, N64 - 6, N64 - 6);
  addUnit(w, SIDE_PLAYER, UK_TANK, 2, 2);   // 遠在視野外
  setAi(w, SIDE_ENEMY, 1);
  const st = w.ai[0], at = () => [cellOf(st.ox), cellOf(st.oz)];
  assert.deepEqual(at(), [N64 - 6, N64 - 6], 'ai: enemy AI starts by heading for the player corner of the 64 map');
  aiThink(w, st, spotted);
  assert.deepEqual(at(), [N64 >> 1, N64 >> 1], 'ai: next search point is the middle of the 64 map');
  e.x = st.ox; e.z = st.oz; aiThink(w, st, spotted);
  assert.deepEqual(at(), [N64 - 6, 5], 'ai: then a far side corner of the 64 map');
});

await group('hq', () => {
  const w = field();
  addUnit(w, SIDE_PLAYER, UK_TANK, 40, 40); addUnit(w, SIDE_ENEMY, UK_TANK, 20, 20);
  startEco(w, 1);
  const [mine, theirs] = w.eco.hq.map(id => w.blds[id - 1]);
  assert(Math.abs(mine.x + 1 - (N64 - 1)) + Math.abs(mine.z + 1 - (N64 - 1)) <= 2, `hq: player HQ sits in the (63,63) corner, got (${mine.x},${mine.z})`);
  assert(Math.abs(theirs.x + 1) + Math.abs(theirs.z + 1) <= 4, 'hq: enemy HQ sits in the (0,0) corner');
  const inf = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_INFANTRY), hx = mine.x + 1, mid = N64 >> 1;
  const rally = Math.max(0, Math.min(N64 - 1, hx + Math.sign(mid - hx) * 4));
  assert(inf && inf.order === ORD_MOVE && inf.tx === rally && inf.tz === rally, 'hq: new squad rallies toward the 64-map middle');
  // 指揮部在角落時 16 和 32 落在同一側，分不出來：把指揮部搬到 (20,40)，新車要從最靠 64 地圖中央的那一格出來、往中央集結
  const occupy = id => { for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.occ[cellIdx(w, mine.x + dx, mine.z + dz)] = id; };
  occupy(0); mine.x = 20; mine.z = 40; occupy(mine.id);
  produce(w, SIDE_PLAYER, UK_TANK);
  const before = w.units.length;
  for (let i = 0; i < UNIT_KINDS[UK_TANK].buildTicks + 2 && w.units.length === before; i++) step(w, []);
  const fresh = w.units[before], ring = [];
  for (let z = mine.z - 1; z <= mine.z + 2; z++) for (let x = mine.x - 1; x <= mine.x + 2; x++) if (!w.occ[cellIdx(w, x, z)]) ring.push(Math.abs(x - mid) + Math.abs(z - mid));
  assert(fresh && fresh.kind === UK_TANK, 'hq: the moved HQ produces a tank');
  assert.equal(Math.abs(cellOf(fresh.x) - mid) + Math.abs(cellOf(fresh.z) - mid), Math.min(...ring), 'hq: a new unit spawns on the HQ cell nearest the 64-map middle');
  assert.deepEqual([fresh.tx, fresh.tz], [mine.x + 1 + 4, mine.z + 1 - 4], 'hq: and rallies toward the 64-map middle');
});

// 32 以外的格子查詢：戰壕、彈坑掩護、植被、鐵絲網、沙盒放置
await group('cover', () => {
  const w = field(), gun = addUnit(w, SIDE_PLAYER, UK_HOWITZER, 5, 60), splash = Math.ceil(UNIT_KINDS[UK_HOWITZER].splash / SUB);
  step(w, [{ t: 'trench', side: SIDE_PLAYER, kind: 0, x: 40, z: 50 }]);
  assert(trenchAt(w, 40, 50), 'cover: a trench dug beyond 32 is found');
  w.crater[cellIdx(w, 50, 40)] = 1;
  // 三台同樣的車各吃一發正中的高爆（彼此隔得比破片半徑遠）：戰壕、彈坑裡的少掉血比空地少
  const spots = [[40, 50], [50, 40], [50, 40 + 3 * splash + 4]], ts = spots.map(([x, z]) => addUnit(w, SIDE_ENEMY, UK_HEAVY, x, z));
  for (const t of ts) w.shells.push({ id: w.nextShell++, side: SIDE_PLAYER, kind: SHELL_HE, shooter: gun.id, sx: gun.x, sz: gun.z, ex: t.x, ez: t.z, t: 0, T: 1, target: 0, hitBld: 0 });
  step(w, []);
  const [trench, crater, open] = ts.map(t => UNIT_KINDS[t.kind].hp - t.hp);
  assert(open > 0 && trench < open, 'cover: a trench beyond 32 gives cover');
  assert(crater < open, 'cover: an old crater beyond 32 gives cover');
  // 植被：守衛直接放一格小樹林在 (40,40)
  const v = field();
  v.vegetation = { version: VEGETATION_VERSION, cells: new Uint8Array(N64 * N64) }; v.vegetation.cells[cellIdx(v, 40, 40)] = VEG_WOOD;
  assert.equal(vegetationAt(v, 40, 40), VEG_WOOD, 'cover: vegetation beyond 32 is found');
  assert.equal(vegetationGeometry(v).cells, 1, 'cover: vegetation beyond 32 is drawn');
  clearVegetation(v, 40, 40, 1, 1);
  assert.equal(vegetationAt(v, 40, 40), VEG_NONE, 'cover: vegetation beyond 32 can be cleared');
  // 鐵絲網：布在 32 以外，查得到
  addUnit(v, SIDE_PLAYER, UK_TANK, 50, 50); addUnit(v, SIDE_ENEMY, UK_TANK, 3, 3);
  const wire = { t: 'build', side: SIDE_PLAYER, kind: BK_WIRE, x: 44, z: 40 };
  assert.equal(buildError(v, wire), null, 'cover: wire may be laid beyond 32'); applyBuild(v, wire);
  assert(wireAt(v, 45, 40), 'cover: wire laid beyond 32 is found');
  // 沙盒：64 世界上 32 以外也能放，64 以外不行
  v.sandbox = { version: 1, running: false, frame: 0 };
  assert.equal(sandboxPlaceError(v, { t: 'sandboxPlace', side: SIDE_PLAYER, kind: UK_TANK, x: 56, z: 56 }), null, 'cover: sandbox places beyond 32');
  assert.equal(sandboxPlaceError(v, { t: 'sandboxPlace', side: SIDE_PLAYER, kind: UK_TANK, x: N64, z: 56 }), 'map');
});

await group('territory', () => {
  assert.equal(territory(SIDE_PLAYER, 34, 32, N64), true, 'territory: x+z ≥ 64+2 is ours');
  assert.equal(territory(SIDE_PLAYER, 20, 20, N64), false, 'territory: x+z = 40 is not ours on 64');
  assert.equal(territory(SIDE_ENEMY, 20, 20, N64), true, 'territory: x+z ≤ 64−4 is theirs');
  assert.equal(territory(SIDE_ENEMY, 31, 30, N64), false, 'territory: no man\'s land in between');
  const w = field();
  addUnit(w, SIDE_PLAYER, UK_TANK, 60, 60); addUnit(w, SIDE_ENEMY, UK_TANK, 3, 3);
  assert.equal(buildError(w, { t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x: 20, z: 20 }), 'foreign', 'territory: building at x+z=40 is enemy ground on 64');
  assert.equal(buildError(w, { t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x: 33, z: 33 }), null, 'territory: building at x+z=66 is legal on 64');
  assert.equal(trenchError(w, { t: 'trench', side: SIDE_PLAYER, kind: 0, x: 20, z: 20 }), 'foreign', 'territory: trenches follow the 64 half');
  assert.equal(trenchError(w, { t: 'trench', side: SIDE_PLAYER, kind: 0, x: 40, z: 40 }), null);
  const plan = enemyPlan(w);
  assert(plan.length > 0, 'territory: enemy still plans on 64');
  for (const c of plan) { const f = footprint(c); for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) assert(territory(SIDE_ENEMY, x, z, N64), 'territory: enemy plan stays in its 64 half'); }
  // 敵軍在 (40,3)、我軍在 (60,40)：敵方布陣朝我軍那一側，落在 x > 32 的地方
  const side = field(); addUnit(side, SIDE_PLAYER, UK_TANK, 60, 40); addUnit(side, SIDE_ENEMY, UK_TANK, 40, 3);
  assert(enemyPlan(side).some(c => c.x > OLD), 'territory: enemy plan scans the whole 64 map');
  // 牆把 32 以外的一格空口袋 (60,60) 封死：不准
  const pocket = field(); addUnit(pocket, SIDE_PLAYER, UK_TANK, 50, 50); addUnit(pocket, SIDE_ENEMY, UK_TANK, 3, 3);
  for (const [x, z] of [[59, 59], [60, 59], [61, 59], [59, 60], [61, 60], [59, 61]]) addBld(pocket, x, z);
  assert.equal(buildError(pocket, { t: 'build', side: SIDE_PLAYER, kind: BK_WALL_BRICK, x: 60, z: 61 }), 'blocked', 'territory: a wall may not seal an open pocket beyond 32');
  // Rye 是 32×32 的資料表：64×64 的世界不套，世界不變
  const before = hashWorld(w); applyMap(w, MAP_RYE);
  assert.equal(w.map, undefined, 'territory: Rye table only applies to 32×32 worlds'); assert.equal(hashWorld(w), before);
});

await group('render', () => {
  const w = field(), PX = 8;
  const a = addUnit(w, SIDE_PLAYER, UK_TANK, 50, 50), b = addUnit(w, SIDE_PLAYER, UK_TANK, 51, 50);
  addUnit(w, SIDE_ENEMY, UK_TANK, 10, 10);
  const v = new BattleView(w, true);
  const sized = (view, n, label) => {
    assert.equal(view.groundTex.image.width, n * PX, `${label}: ground texture width`); assert.equal(view.groundTex.image.height, n * PX);
    assert.equal(view.groundPx.length, n * PX * n * PX * 4, `${label}: ground pixels`); assert.equal(view.tracks.length, n * PX * n * PX, `${label}: track buffer`);
    assert.equal(view.visStamp.length, n * n, `${label}: visibility cache`); assert.equal(view.dirtyList.length, n * n, `${label}: dirty list`);
    assert.equal(view.trench118.kinds.length, n * n, `${label}: trench raster`);
    assert.equal(Math.max(...view.ground.geometry.attributes.position.array), n, `${label}: ground quad covers the map`);
    assert.equal(view.sun.shadow.camera.right, n * 0.8, `${label}: shadow camera covers the map`);
    assert.deepEqual([view.target.x, view.target.z], [n * 0.62, n * 0.62], `${label}: default focus follows map size`);
  };
  sized(v, N64, 'render');
  assert.equal(v.groundPx[v.groundPx.length - 1], 255, 'render: the far 64-grid corner is painted');
  // 平移、縮放夾在 64 的邊界（零位移＝只看夾值）
  v.target.set(N64 - 2, 0, N64 - 2); v.pan(0, 0, 860);
  assert.deepEqual([v.target.x, v.target.z], [N64 - 2, N64 - 2], 'render: panning is clamped to the 64 map');
  v.layout(412, 860); v.zoomAt(1, 206, 430, 412, 860);
  assert(Math.abs(v.target.x - (N64 - 2)) < 1e-6 && Math.abs(v.target.z - (N64 - 2)) < 1e-6, 'render: zooming is clamped to the 64 map');
  const sel = new Set([a.id, b.id]), ground0 = v.groundPx.slice();
  step(w, [{ t: 'move', side: SIDE_PLAYER, ids: [a.id, b.id], x: 58, z: 50 }]);
  for (let i = 0; i < 4 * ticksPerCell(UK_TANK); i++) {
    v.snapshot(); step(w, []); v.onEvents(w.events, w.tick / 20); v.update(1, w.tick / 20, sel);
    if (i) continue;
    const d = v.dashDbg, xs = []; for (let k = 0; k < d.n; k++) if (d.unit[k] === a.id) xs.push(d.x[k]);
    assert(xs.length > 0 && xs.every(x => x > OLD), 'render: path dashes are drawn on the 64 grid beyond 32');
  }
  let far = 0; for (let i = OLD * PX * N64 * PX; i < v.tracks.length; i++) far += v.tracks[i];
  assert(far > 0, 'render: tracks are pressed into ground pixels beyond the old edge');
  let repainted = 0; for (let i = OLD * PX * N64 * PX * 4; i < ground0.length; i++) if (ground0[i] !== v.groundPx[i]) repainted++;
  assert(repainted > 0, 'render: cells with fresh tracks beyond 32 are repainted');
  assert(v.vis(a.x / SUB, a.z / SUB), 'render: fog cache sees our tank beyond 32');
  assert(v.visibleAt(a.x, a.z) && v.multi122.contains(a.x / SUB, a.z / SUB), 'render: multi-range plane covers the 64 map');
  assert.equal(v.range113.mesh.material.uniforms.mapSize.value, N64, 'render: range preview clips to the 64 map');
  const small = createWorld(1944);
  v.setWorld(small); sized(v, OLD, 'render 64→32'); assert.equal(v.world, small);
  v.setWorld(w, SIDE_PLAYER); sized(v, N64, 'render 32→64');
  // 布陣底色：(20,20) 在 64 上是對方半場（偏紅），(45,45) 是我方（偏藍）
  const rgb = (x, z) => { const o = ((z * PX + 3) * N64 * PX + x * PX + 3) * 4; return v.groundPx.slice(o, o + 3); };
  assert(rgb(20, 20)[0] > rgb(20, 20)[2] && rgb(45, 45)[2] > rgb(45, 45)[0], 'render: build-phase halves follow the 64 map');
  // 同一個世界在 tick0 換大小（R043 的 map 指令）：下一次事件就照新大小重配
  const grow = createWorld(7); v.setWorld(grow); sized(v, OLD, 'render same-world');
  Object.assign(grow, { n: N64, ter: new Uint8Array(N64 * N64), occ: new Int32Array(N64 * N64), crater: new Uint8Array(N64 * N64), blds: [] });
  v.onEvents([], 0); sized(v, N64, 'render same-world resize');
  v.dispose();
});

await group('ui', () => {
  const w = field(), gun = addUnit(w, SIDE_PLAYER, UK_HOWITZER, 40, 40), tank = addUnit(w, SIDE_PLAYER, UK_TANK, 41, 41);
  const g = miniGeo(200, N64), [cx, cy] = toMini(g, N64, N64);
  assert.equal(g.s, 200 / (2 * N64)); assert(cx <= g.w && cy <= g.h + 1e-9, 'ui: minimap diamond fits the 64 map');
  const hit = (x, z) => ({ unit: 0, building: null, ground: { x, z } });
  assert.deepEqual(bombardTarget(w, hit(60.4, 61.7)), { x: 60, z: 61 }, 'ui: long-press target beyond 32 is on the map');
  assert.equal(bombardTarget(w, hit(N64 + 0.2, 3)), null, 'ui: outside 64 is rejected');
  assert(bombardCommand(w, [gun.id], { x: 60, z: 61 }, 'he'), 'ui: bombard command accepted beyond 32');
  assert.deepEqual(routeBattleOrder(w, [tank.id], false, 'he', hit(50.5, 47.2))?.commands, [{ t: 'move', side: SIDE_PLAYER, ids: [tank.id], x: 50, z: 47 }], 'ui: move order beyond 32 is routed');
});

// 音效：32 以外的彈著有聲音，64 以外的不收（最小的 AudioContext 替身）
await group('audio', async () => {
  const w = field(); addUnit(w, SIDE_PLAYER, UK_TANK, 50, 50);
  const node = () => ({ gain: { value: 0 }, connect() {}, disconnect() {} });
  const ctx = { state: 'suspended', currentTime: 0, destination: {}, onstatechange: null, createGain: node, createBuffer: (c, length) => ({ length, copyToChannel() {} }),
    resume() { this.state = 'running'; return Promise.resolve(); }, suspend() { this.state = 'suspended'; return Promise.resolve(); }, close() { return Promise.resolve(); } };
  const audio = new BattleAudio(() => {}, () => ctx);
  audio.setActive(true); audio.toggleFromGesture();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(audio.status().state, 'on');
  const all = { visibleUnit: () => true, visibleAt: () => true };
  audio.enqueue(w, [{ e: 'impact', kind: SHELL_HE, x: center(60), z: center(61), bld: 0 }, { e: 'impact', kind: SHELL_HE, x: N64 * SUB, z: center(3), bld: 0 }], all);
  assert.equal(audio.debug().pending, 1, 'audio: an impact beyond 32 is heard, one outside 64 is not');
  const ruin = addBld(w, 50, 52, 2, 2); ruin.hp = 0;
  audio.enqueue(w, [{ e: 'stage', bld: ruin.id, stage: STAGE_RUBBLE }], all);
  assert.equal(audio.debug().pending, 2, 'audio: a collapse beyond 32 is heard');
  audio.dispose();
});

await group('replay', () => {
  // 雙方在 x、z 都超過 32 的地方開打；電腦指揮敵方、雙方有補給
  const make = () => {
    const w = field(1944);
    for (const [x, z, bw, bd] of [[40, 44, 2, 1], [45, 38, 1, 2], [50, 52, 2, 2], [36, 50, 1, 1], [52, 36, 1, 1]]) addBld(w, x, z, bw, bd);
    for (const [kind, x, z] of [[UK_TANK, 48, 46], [UK_TANK, 46, 48], [UK_HEAVY, 49, 49], [UK_HOWITZER, 56, 56], [UK_OBSERVER, 47, 47], [UK_MORTAR, 52, 50]]) addUnit(w, SIDE_PLAYER, kind, x, z);
    for (const [kind, x, z] of [[UK_TANK, 34, 36], [UK_TANK, 36, 34], [UK_TANK, 35, 35], [UK_HOWITZER, 30, 30], [UK_OBSERVER, 37, 37], [UK_INFANTRY, 38, 33]]) addUnit(w, SIDE_ENEMY, kind, x, z);
    return w;
  };
  const LOG = [
    { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } },
    { tick: 0, cmd: { t: 'ai', side: SIDE_ENEMY, level: 3 } },
    { tick: 0, cmd: { t: 'move', side: SIDE_PLAYER, ids: [1, 2, 3], x: 42, z: 42 } },
    { tick: 0, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [4], x: 36, z: 36 } },
    { tick: 150, cmd: { t: 'attack', side: SIDE_PLAYER, ids: [1, 2, 3], target: 7 } },
    { tick: 220, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [4], x: 39, z: 37, ammo: 'smoke' } },
    { tick: 300, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_TANK } },
    { tick: 360, cmd: { t: 'move', side: SIDE_PLAYER, ids: [1, 2, 3, 5], x: 38, z: 40 } },
  ];
  const TICKS = 600, HALF_WAY = 300;
  const w = make(); let fired = 0, hits = 0, smokeFar = 0;
  while (w.tick < TICKS) {
    runLog(w, LOG, w.tick + 1);
    for (const e of w.events) { if (e.e === 'fire') fired++; if (e.e === 'impact') hits++; }
    for (const u of w.units) assert(u.x >= 0 && u.z >= 0 && u.x <= gridLimit(w) && u.z <= gridLimit(w), 'replay: every unit stays inside the 64 map');
    for (const c of w.smoke?.clouds ?? []) {
      assert(c.x >= 0 && c.z >= 0 && c.x <= gridLimit(w) && c.z <= gridLimit(w), 'replay: smoke drifts inside the 64 map');
      if (c.x > OLD * SUB && c.z > OLD * SUB) smokeFar++;
    }
  }
  const hp = w.units.filter(u => u.hp < UNIT_KINDS[u.kind].hp).length;
  assert(fired > 0 && hits > 0 && hp > 0, `replay: the sides actually fight (${fired} shots, ${hits} impacts, ${hp} damaged)`);
  assert(smokeFar > 0, 'replay: the smoke screen fired beyond 32 lies beyond 32');
  assert(w.eco && w.blds.some(b => b.x > OLD && b.z > OLD && b.id === w.eco.hq[SIDE_PLAYER]), 'replay: player HQ stands in the far 64 corner');
  const direct = hashWorld(w);
  // 這個場地＋這份紀錄在 64×64 上的黃金雜湊。模擬有意改變時（黃金雜湊 eea1d59b 也會變）照實際輸出更新，卡面寫舊→新
  assert.equal(direct, '7ca34b19', 'replay: 64×64 battle hash is the frozen 7ca34b19');
  assert.equal(hashWorld(runLog(make(), JSON.parse(JSON.stringify(LOG)), TICKS)), direct, 'replay: JSON round-trip replay hash matches');
  const w1 = runLog(make(), LOG, HALF_WAY), w2 = structuredClone(w1);
  runLog(w1, LOG, TICKS); runLog(w2, LOG, TICKS);
  assert.equal(hashWorld(w1), direct, 'replay: uninterrupted resume hash matches'); assert.equal(hashWorld(w2), direct, 'replay: structuredClone mid-run hash matches');
  console.log(`  600 steps on 64×64: ${fired} shots, ${hits} impacts, ${hp} damaged, smoke ${smokeFar} cloud-steps beyond 32, hash ${direct}`);
});

assert(groups > 0, `unknown group ${only}`);
console.log(`map-size: ${groups} groups OK`);
