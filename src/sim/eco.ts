// R019 補給與生產：指揮部、補給、生產佇列、出生與集結、有指揮部時的勝負。整數、決定性、不抽 World.rng。
import { trenchAt } from './trenches.ts';
import { clearVegetation } from './vegetation.ts';
import { findPath } from './path.ts';
import { stillConnected, keepsFootPaths } from './build.ts';
import { MAP_LARGE, LARGE_POP } from './largeMap.ts';
import {
  SUB, cellIdx, inGrid, cellOf, center, blocks, wireAt, bldMaxHp, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, BK_HQ, TER_ROAD,
  ORD_IDLE, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY, type World, type Building,
} from './world.ts';

export const ECO_START = 60;          // 開局補給
export const ECO_INCOME_TICKS = 20;   // 每 20 步（1 秒）+1
export const ECO_QUEUE = 5;           // 佇列最多幾個
export const ECO_POP = 16;            // 每方同時活著最多幾台（R043 大地圖寫進 eco.pop＝40）
export const PRODUCIBLE = [UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT];
export const ARMOR2 = [UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT];   // R044：eco 帶 armor2 才能出

const corner = (w: World, side: number) => (side === SIDE_PLAYER ? w.n - 1 : 0);

// 從自己的角落往外，找第一個放得下 2×2 指揮部的地方：不上路、不疊、跟別的建築隔一格、不壓單位、不堵死通路
function hqSpot(w: World, side: number): [number, number] | null {
  const c = corner(w, side), cand: [number, number, number][] = [];
  for (let z = 0; z + 1 < w.n; z++) for (let x = 0; x + 1 < w.n; x++) cand.push([Math.abs(2 * x + 1 - 2 * c) + Math.abs(2 * z + 1 - 2 * c), x, z]);   // 佔地中心到角落的曼哈頓距離（兩倍座標）
  cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
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
export function startEco(w: World, inf = 0, guns = 0, tanks = 0, armor2 = 0): void {
  if (w.eco || w.tick !== 0) return;
  const hq = [0, 0];
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) {
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
  w.eco = { supply: [ECO_START, ECO_START], hq, queue: [[], []], prog: [0, 0], ...(inf ? { inf: 1 } : {}), ...(guns ? { guns: 1 } : {}), ...(tanks ? { tanks: 1 } : {}), ...(armor2 ? { armor2: 1 } : {}), ...(w.map === MAP_LARGE ? { pop: LARGE_POP } : {}) };
  if (inf) for (const side of [SIDE_PLAYER, SIDE_ENEMY]) { const b = hqAlive(w, side); if (b) spawnUnit(w, side, UK_INFANTRY, b); }   // R021：雙方各一班步兵
}

export const hqAlive = (w: World, side: number): Building | null => {
  const id = w.eco?.hq[side] ?? 0, b = id ? w.blds[id - 1] : null;
  return b && b.hp > 0 ? b : null;
};

// produce 指令：補給夠、佇列沒滿、指揮部還在才接
export function produce(w: World, side: number, kind: number): void {
  const e = w.eco;
  if (!e || (side !== 0 && side !== 1) || !PRODUCIBLE.includes(kind) || !hqAlive(w, side) || (kind === UK_INFANTRY && !e.inf) || ((kind === UK_ATGUN || kind === UK_MORTAR) && !e.guns) || ((kind === UK_LIGHT || kind === UK_HEAVY) && !e.tanks) || (ARMOR2.includes(kind) && !e.armor2)) return;
  const cost = UNIT_KINDS[kind].cost;
  if (e.supply[side] < cost || e.queue[side].length >= ECO_QUEUE) return;
  e.supply[side] -= cost; e.queue[side].push(kind);
}

// 每一步：補給進帳、生產進度、做好就出生並走向集結點（往地圖中央 4 格）
export function ecoStep(w: World): void {
  const e = w.eco;
  if (!e) return;
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) {
    const hq = hqAlive(w, side);
    if (!hq) { e.queue[side] = []; e.prog[side] = 0; continue; }
    if (w.tick % ECO_INCOME_TICKS === 0) e.supply[side]++;
    const q = e.queue[side];
    if (!q.length) continue;
    const k = UNIT_KINDS[q[0]];
    if (e.prog[side] < k.buildTicks) { e.prog[side]++; continue; }
    if (w.units.filter(u => u.alive && u.side === side).length >= (e.pop ?? ECO_POP)) continue;   // 人數滿了：做好的先等著
    if (!spawnCell(w, hq)) continue;
    const kind = q.shift()!;
    e.prog[side] = 0;
    spawnUnit(w, side, kind, hq);
  }
}

// 在指揮部旁出生、走向集結點（往地圖中央 4 格）
function spawnUnit(w: World, side: number, kind: number, hq: Building): void {
  const spot = spawnCell(w, hq);
  if (!spot) return;
  const id = w.units.length + 1;
  w.units.push({ id, side, kind, x: center(spot[0]), z: center(spot[1]), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: side === SIDE_PLAYER ? -SUB : SUB, aimZ: side === SIDE_PLAYER ? -SUB : SUB, ...(UNIT_KINDS[kind].armored ? { hullX: side === SIDE_PLAYER ? -SUB : SUB, hullZ: side === SIDE_PLAYER ? -SUB : SUB } : {}) });
  const u = w.units[id - 1], hx = hq.x + 1, hz = hq.z + 1, mid = w.n >> 1;
  const rx = Math.max(0, Math.min(w.n - 1, hx + Math.sign(mid - hx) * 4)), rz = Math.max(0, Math.min(w.n - 1, hz + Math.sign(mid - hz) * 4));
  const p = findPath(w, spot[0], spot[1], rx, rz, 0, 0, kind);
  if (p.length) { u.order = ORD_MOVE; u.tx = rx; u.tz = rz; u.path = p; u.pathIdx = 0; }
}

// 指揮部旁一圈的空格，挑沒有車停著、離地圖中央最近的（決定性）
function spawnCell(w: World, hq: Building): [number, number] | null {
  let best: [number, number] | null = null, bd = 0;
  const mid = w.n >> 1;
  for (let z = hq.z - 1; z <= hq.z + hq.d; z++) for (let x = hq.x - 1; x <= hq.x + hq.w; x++) {
    if (!inGrid(w, x, z) || blocks(w, x, z) || w.occ[cellIdx(w, x, z)] || wireAt(w, x, z)) continue;
    if (w.units.some(u => u.alive && UNIT_KINDS[u.kind].radius > 0 && Math.abs(u.x - center(x)) < SUB && Math.abs(u.z - center(z)) < SUB)) continue;
    const d = Math.abs(x - mid) + Math.abs(z - mid);
    if (!best || d < bd) { best = [x, z]; bd = d; }
  }
  return best;
}
