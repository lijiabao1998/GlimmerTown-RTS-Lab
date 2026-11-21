// R019 補給與生產：指揮部、補給、生產佇列、出生與集結、有指揮部時的勝負。整數、決定性、不抽 World.rng。
import { trenchAt } from './trenches.ts';
import { clearVegetation } from './vegetation.ts';
import { findPath } from './path.ts';
import { stillConnected, keepsFootPaths } from './build.ts';
import { MAP_LARGE, LARGE_POP } from './largeMap.ts';
import { MAP_TOWN } from './expandedMap.ts'; import { MAP_HYTHE } from './hytheMap.ts';
import { incomeTicks } from './rules.ts';
import { locked50, income50, tech50Step, SUPPLY_TICKS50 } from './tech50.ts';   // R050
import { PLATOON_ITEM, PLATOON_COST, PLATOON_SECTIONS, FORMATION_PLA, startPlatoons, ticksOf, popOf } from './platoon.ts';
import {
  INTERNATIONAL_KINDS, SOVIET_KINDS, SUB, cellIdx, inGrid, cellOf, center, blocks, wireAt, bldMaxHp, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_MG, UK_SNIPER, UK_AT91, UK_TRUCK, UK_HALFTRACK, UK_AA, UK_ENGINEER, UK_FLAME, BK_HQ, TER_ROAD,
  ORD_IDLE, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY, type World, type Building,
} from './world.ts';

export const ECO_START = 60;          // 開局補給
export const ECO_INCOME_TICKS = 20;   // 每 20 步（1 秒）+1
export const ECO_QUEUE = 5;           // 佇列最多幾個
export const ECO_POP = 16;            // 每方同時活著最多幾台（R043 大地圖寫進 eco.pop＝40）
export const PRODUCIBLE = [...INTERNATIONAL_KINDS, ...SOVIET_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_MG, UK_SNIPER, UK_AT91, UK_TRUCK, UK_HALFTRACK, UK_AA, UK_ENGINEER, UK_FLAME];
export const ARMOR2 = [UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT];   // R044：eco 帶 armor2 才能出

const corner = (w: World, side: number) => (side === SIDE_PLAYER ? w.n - 1 : 0);

// 從自己的角落往外，找第一個放得下 2×2 指揮部的地方：不上路、不疊、跟別的建築隔一格、不壓單位、不堵死通路
function hqSpot(w: World, side: number): [number, number] | null {
  const c = corner(w, side), cand: [number, number, number][] = [];
  for (let z = 0; z + 1 < w.n; z++) for (let x = 0; x + 1 < w.n; x++) cand.push([Math.abs(2 * x + 1 - 2 * c) + Math.abs(2 * z + 1 - 2 * c), x, z]);   // 佔地中心到角落的曼哈頓距離（兩倍座標）
  const m = w.sym && side === SIDE_ENEMY ? -1 : 1;   // R084：左上那一方平手時照鏡像（佔地 (x,z) 的鏡像是 (n−2−x, n−2−z)，所以先比大的 z、再比大的 x）
  cand.sort((a, b) => a[0] - b[0] || m * (a[2] - b[2]) || m * (a[1] - b[1]));
  const unitCells = new Set(w.units.filter(u => u.alive).map(u => cellIdx(w, cellOf(u.x), cellOf(u.z))));
  for (const [, x, z] of cand) {
    let ok = true;
    for (let dz = -1; dz <= 2 && ok; dz++) for (let dx = -1; dx <= 2 && ok; dx++) {
      const cx = x + dx, cz = z + dz, inner = dx >= 0 && dz >= 0 && dx < 2 && dz < 2;
      if (!inGrid(w, cx, cz)) { if (inner) ok = false; continue; }
      const i = cellIdx(w, cx, cz);
      if (w.occ[i]) ok = false;
      if (wireAt(w, cx, cz)) ok = false;
      if (inner && (w.ter[i] === TER_ROAD || unitCells.has(i) || trenchAt(w, cx, cz))) ok = false;
    }
    if (ok && stillConnected(w, x, z, 2, 2) && keepsFootPaths(w, x, z, 2, 2)) return [x, z];
  }
  return null;
}

// eco 指令：只在第 0 步有效；雙方各放一座指揮部、開始累積補給
export function startEco(w: World, inf = 0, guns = 0, tanks = 0, armor2 = 0, soviet = 0, international = 0, end = 0, mg = 0, pla = 0, sw = 0, tp = 0, air = 0, tech = 0, bag = 0): void {
  if (w.eco || w.tick !== 0) return;
  const hq = [0, 0];
  for (const side of (w.zombies ? [SIDE_PLAYER] : [SIDE_PLAYER, SIDE_ENEMY])) {
    const at = hqSpot(w, side);
    if (!at) continue;
    const id = w.blds.length + 1, maxHp = bldMaxHp(BK_HQ, 2, 2, 1);
    const b: Building = { id, kind: BK_HQ, x: at[0], z: at[1], w: 2, d: 2, floors: 1, hp: maxHp, maxHp, builtBy: side };
    w.blds.push(b);
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.occ[cellIdx(w, at[0] + dx, at[1] + dz)] = id;
    clearVegetation(w, b.x, b.z, b.w, b.d);
    w.events.push({ e: 'build', bld: id });
    hq[side] = id;
  }
  w.eco = { supply: [ECO_START, w.zombies ? 0 : ECO_START], hq, queue: [[], []], prog: [0, 0], ...(inf ? { inf: 1 } : {}), ...(guns ? { guns: 1 } : {}), ...(tanks ? { tanks: 1 } : {}), ...(armor2 ? { armor2: 1 } : {}), ...(soviet ? { soviet: 1 } : {}), ...(international ? { international: 1 } : {}), ...((w.map === MAP_LARGE || w.map === MAP_TOWN || w.map === MAP_HYTHE) ? { pop: LARGE_POP } : {}), ...(end ? { end: 1 } : {}), ...(mg ? { mg: mg >= 2 ? 2 : 1 } : {}) };   // R081：mg 存版本（1 或 2）   // R077 end：勝負判定第二版（step.ts checkWinner）
  if (inf) for (const side of [SIDE_PLAYER, SIDE_ENEMY]) { const b = hqAlive(w, side); if (b) spawnUnit(w, side, UK_INFANTRY, b); }   // R021：雙方各一班步兵
  if (pla) startPlatoons(w);   // R095：步兵排的旗標、人口上限 24／56／64
  if (mg) for (const side of [SIDE_PLAYER, SIDE_ENEMY]) { const b = hqAlive(w, side); if (b) spawnUnit(w, side, UK_MG, b); }   // R080：雙方各一組機槍組（mg 旗標；也是可以生產它的開關）
  if (sw) w.eco.sw = sw === 2 ? 2 : 1;   // R091：步兵支援（狙擊手、反戰車小組）可以生產；開局不送兵。R1002：2＝再加工兵、火焰噴射器
  if (tp) w.eco.tp = tp === 2 ? 2 : 1;   // R092：運輸可以生產；開局不送車。R030：2＝被拒絕的攻擊、射擊不卸砲
  if (air) w.eco.air = 1;   // R093：空中支援與防空；開局不送兵、不送飛機
  if (tech && w.eco.sw === 2) w.eco.tech = 1;   // R050：建造與科技；開局不送建築。要跟 sw＝2 一起送（沒有工兵蓋不了，被鎖的兵種會永遠出不來）
  if (bag && w.eco.tech && !w.zombies) w.eco.bag = 1;   // R1007：沙包；要 tech 先存了（tech 又要 sw＝2）：沒有工兵、沒有「建造」一組就沒有沙包；喪屍防守不存
}

export const hqAlive = (w: World, side: number): Building | null => {
  const id = w.eco?.hq[side] ?? 0, b = id ? w.blds[id - 1] : null;
  return b && b.hp > 0 ? b : null;
};

// produce 指令：補給夠、佇列沒滿、指揮部還在才接
export function produce(w: World, side: number, kind: number): void {
  const e = w.eco;
  if (kind === PLATOON_ITEM) { if (e?.pla && e.inf && (side === 0 || side === 1) && hqAlive(w, side) && e.supply[side] >= PLATOON_COST && e.queue[side].length < ECO_QUEUE) { e.supply[side] -= PLATOON_COST; e.queue[side].push(kind); } return; }   // R095 步兵排：佔一格
  if ((kind === UK_SNIPER || kind === UK_AT91) && (!e?.sw || w.zombies)) return;   // R091：要 sw；喪屍防守不開放（打喪屍一發 2 點、反戰車小組不打喪屍）
  if ((kind === UK_TRUCK || kind === UK_HALFTRACK) && (!e?.tp || w.zombies)) return;   // R092：要 tp；喪屍防守不開放（喪屍挑目標不跳過車上的人）
  if (kind === UK_AA && (!e?.air || w.zombies)) return;   // R093：要 air；喪屍防守不開放
  if ((kind === UK_ENGINEER || kind === UK_FLAME) && (e?.sw !== 2 || w.zombies)) return;   // R1002：要 sw＝2；喪屍防守不開放
  if (locked50(w, side, kind)) return;   // R050：tech 開著時，兵營、車廠蓋好才造得出那幾種
  if (!e || (side !== 0 && side !== 1) || !PRODUCIBLE.includes(kind) || (INTERNATIONAL_KINDS.includes(kind) && !e.international) || (SOVIET_KINDS.includes(kind) && !e.soviet) || !hqAlive(w, side) || (kind === UK_INFANTRY && !e.inf) || ((kind === UK_ATGUN || kind === UK_MORTAR) && !e.guns) || ((kind === UK_LIGHT || kind === UK_HEAVY) && !e.tanks) || (ARMOR2.includes(kind) && !e.armor2) || (kind === UK_MG && !e.mg)) return;
  const cost = UNIT_KINDS[kind].cost;
  if (e.supply[side] < cost || e.queue[side].length >= ECO_QUEUE) return;
  e.supply[side] -= cost; e.queue[side].push(kind);
}

// 每一步：補給進帳、生產進度、做好就出生並走向集結點（往地圖中央 4 格）
export function ecoStep(w: World): void {
  const e = w.eco;
  if (!e) return;
  if (w.tech) tech50Step(w);   // R050：打成瓦礫的工地拿掉
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) {
    const hq = hqAlive(w, side);
    if (!hq) { e.queue[side] = []; e.prog[side] = 0; continue; }
    if (w.tick % (incomeTicks(w) || ECO_INCOME_TICKS) === 0) e.supply[side]++;   // R046：補給速度可由 rules 指令改（慢 40、快 10）
    if (e.tech && w.tick % SUPPLY_TICKS50 === 0) e.supply[side] += income50(w, side);   // R050：補給站（每座每 40 步多 1，最多算兩座）
    const q = e.queue[side];
    if (!q.length) continue;
    if (e.prog[side] < ticksOf(q[0])) { e.prog[side]++; continue; }   // R095：排的記號不是單位種類，經過 ticksOf
    if (w.units.filter(u => u.alive && u.side === side).length + popOf(q[0]) > (e.pop ?? ECO_POP)) continue;   // 人數滿了：做好的先等著（排要空出 3 格）
    if (!spawnCell(w, hq)) continue;
    const kind = q.shift()!;
    e.prog[side] = 0;
    if (kind === PLATOON_ITEM) spawnPlatoon(w, side, hq); else spawnUnit(w, side, kind, hq);
  }
}

// 在指揮部旁出生、走向集結點（往地圖中央 4 格）
function spawnUnit(w: World, side: number, kind: number, hq: Building, j = 0): void {
  const spot = spawnCell(w, hq);
  if (!spot) return;
  const id = w.units.length + 1;
  w.units.push({ id, side, kind, x: center(spot[0]), z: center(spot[1]), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: side === SIDE_PLAYER ? -SUB : SUB, aimZ: side === SIDE_PLAYER ? -SUB : SUB, ...(UNIT_KINDS[kind].armored ? { hullX: side === SIDE_PLAYER ? -SUB : SUB, hullZ: side === SIDE_PLAYER ? -SUB : SUB } : {}) });
  const mir = !!w.sym && hq.builtBy === SIDE_ENEMY;   // R084：左上那一方的「指揮部朝中央那一欄」是 hq.x（右下那一方是 hq.x＋1），中央用兩倍座標比
  const u = w.units[id - 1], hx = mir ? hq.x : hq.x + 1, hz = mir ? hq.z : hq.z + 1, mid = w.n >> 1;
  const rx = Math.max(0, Math.min(w.n - 1, hx + (w.sym ? Math.sign(w.n - 1 - 2 * hx) : Math.sign(mid - hx)) * 4)), rz = Math.max(0, Math.min(w.n - 1, hz + (w.sym ? Math.sign(w.n - 1 - 2 * hz) : Math.sign(mid - hz)) * 4));
  const [ox, oz] = j ? FORMATION_PLA[j] : [0, 0], fm = w.sym && side === SIDE_ENEMY ? -1 : 1;   // R095：排的第 j 班集結在集結點＋隊形的第 j 格（對稱時鏡像），不疊在同一格
  const tx = Math.max(0, Math.min(w.n - 1, rx + fm * ox)), tz = Math.max(0, Math.min(w.n - 1, rz + fm * oz));
  const p = findPath(w, spot[0], spot[1], tx, tz, 0, 0, kind);
  if (p.length) { u.order = ORD_MOVE; u.tx = tx; u.tz = tz; u.path = p; u.pathIdx = 0; }
}

// R095：一個排＝同一步出三個步兵班，排號是第一班的 id
function spawnPlatoon(w: World, side: number, hq: Building): void {
  const first = w.units.length + 1;
  for (let j = 0; j < PLATOON_SECTIONS; j++) { const before = w.units.length; spawnUnit(w, side, UK_INFANTRY, hq, j); if (w.units.length > before) w.units[w.units.length - 1].pl = first; }
}

// 指揮部旁一圈的空格，挑沒有車停著、離地圖中央最近的（決定性）
function spawnCell(w: World, hq: Building): [number, number] | null {
  let best: [number, number] | null = null, bd = 0;
  const mid = w.n >> 1;
  for (let z = hq.z - 1; z <= hq.z + hq.d; z++) for (let x = hq.x - 1; x <= hq.x + hq.w; x++) {
    if (!inGrid(w, x, z) || blocks(w, x, z) || w.occ[cellIdx(w, x, z)] || wireAt(w, x, z)) continue;
    if (w.units.some(u => u.alive && UNIT_KINDS[u.kind].radius > 0 && Math.abs(u.x - center(x)) < SUB && Math.abs(u.z - center(z)) < SUB)) continue;
    const d = w.sym ? Math.abs(2 * x + 1 - w.n) + Math.abs(2 * z + 1 - w.n) : Math.abs(x - mid) + Math.abs(z - mid);   // R084：離真的中央（兩倍座標）
    if (!best || d < bd || (w.sym && d === bd && hq.builtBy === SIDE_ENEMY)) { best = [x, z]; bd = d; }   // R084：左上那一方平手時挑後掃到的（＝鏡像裡先掃到的）
  }
  return best;
}
