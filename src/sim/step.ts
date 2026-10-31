// 一步＝1/20 秒。順序固定：套指令 → 全部單位移動 → 車輛推擠（R005）→ 全部單位開火 → 砲彈飛行與落地 → 判勝負。
import { isqrt, dist } from './math.ts';
import { fireDisciplineEligible } from './fireDiscipline.ts';
import { armorPct } from './armor.ts';
import { findPath } from './path.ts';
import { randSym } from './rng.ts';
import { smokeBlocks, advanceSmoke, spawnSmoke } from './smoke.ts';
import { updateCounterbattery } from './counterbattery.ts';
import { applyTrench, trenchCover, type TrenchCmd } from './trenches.ts';
import { applyBuild, type BuildCmd } from './build.ts';
import { aiThink, setAi, AI_THINK } from './ai.ts';
import { applyMap } from './maps.ts';
import { vegetationAt, vegetationBlocks } from './vegetation.ts';
import { startEco, produce, ecoStep, hqAlive } from './eco.ts';
import { applySandbox, type SandboxCommand, type SandboxError } from './sandbox.ts';
import { startZombies, zombiesStep, finishZombiesStep, zombieAim } from './zombies.ts';
import {
  SUB, HALF, cellIdx, inGrid, gridLimit, cellOf, center, blocks, wireBlocks, bldAt, speedPct, stageOf,
  UNIT_KINDS, UK_OBSERVER, UK_HOWITZER, UK_ZOMBIE, BK_PILLBOX, SHELL_SMALL, ORD_IDLE, ORD_MOVE, ORD_ATTACK, ORD_FIRE_AT, SHELL_AP, SHELL_HE, SHELL_SMOKE, SHELL_MELEE, SIDE_PLAYER, SIDE_ENEMY,
  type World, type Unit, type Building, type Shell,
} from './world.ts';

export type Command =
  | SandboxCommand
  | { t: 'zombies' }
  | { t: 'move'; side: number; ids: number[]; x: number; z: number }
  | { t: 'attack'; side: number; ids: number[]; target: number }
  | { t: 'fireAt'; side: number; ids: number[]; x: number; z: number; ammo?: 'smoke' }
  | { t: 'fireDiscipline'; side: number; ids: number[]; hold: boolean }
  | { t: 'stop'; side: number; ids: number[] }
  | TrenchCmd
  | BuildCmd   // R006：只在第 0 步有效，由 step() 先套（見 build.ts）
  | { t: 'ai'; side: number; level: number }   // R018：讓電腦接手那一方（1 簡單、2 普通、3 困難）
  | { t: 'map'; id: number; vegetation?: number }                   // R026：第 0 步換成手排地圖（比布陣先套）
  | { t: 'eco'; inf?: number; guns?: number; tanks?: number; armor2?: number; soviet?: number; international?: number }   // R019：第 0 步放雙方指揮部、開始補給（R021 inf＝1：各送一班步兵、可出步兵；R022 guns＝1：可出反戰車砲、迫擊砲；R023 tanks＝1：可出輕／重坦克；R044 armor2＝1：可出裝甲車、驅逐戰車、突擊砲）
  | { t: 'produce'; side: number; kind: number };   // R019：花補給排進生產佇列

export interface LoggedCommand { tick: number; cmd: Command }
// 舊紀錄的 tick 語意不變；沙盒以獨立步序記錄暫停中的編輯。
export const commandTick = (w: World): number => w.sandbox?.frame ?? w.tick;

export const FIRE_AT_ROUNDS = 4;      // 對空地射擊打幾發就停（對建築：打到變瓦礫為止）
const AP_HIT_RADIUS = 180;            // 穿甲彈落點離目標多近算命中（位置單位）
const FORMATION: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [2, 0], [0, 2]];

const unitById = (w: World, id: number): Unit | null => (id >= 1 && id <= w.units.length ? w.units[id - 1] : null);

// 指令只認：屬於下指令那一方、還活著的單位；座標夾進地圖；攻擊目標要是活著的敵人
export function applyCommand(w: World, cmd: Command): SandboxError | null | void {
  if (cmd.t === 'sandboxPlace' || cmd.t === 'sandboxRun' || cmd.t === 'sandboxReset') return applySandbox(w, cmd);
  if (w.sandbox && cmd.t !== 'move' && cmd.t !== 'attack' && cmd.t !== 'fireAt' && cmd.t !== 'stop' && cmd.t !== 'fireDiscipline') return;
  if (cmd.t === 'zombies') return; // 地圖後、eco 前在 step() 開頭套。
  if (w.zombies && 'side' in cmd && cmd.side === SIDE_ENEMY) return;
  if (cmd.t === 'build' || cmd.t === 'trench' || cmd.t === 'map') return;   // 布陣、地圖（R026）指令只在 step() 開頭套
  if (cmd.t === 'ai') { setAi(w, cmd.side | 0, cmd.level | 0); return; }
  if (cmd.t === 'eco') { startEco(w, cmd.inf ? 1 : 0, cmd.guns ? 1 : 0, cmd.tanks ? 1 : 0, cmd.armor2 ? 1 : 0, cmd.soviet ? 1 : 0, cmd.international ? 1 : 0); return; }
  if (cmd.t === 'produce') { produce(w, cmd.side | 0, cmd.kind | 0); return; }
  const seen = new Set<number>(), us: Unit[] = [];
  for (const id of cmd.ids) {
    const u = unitById(w, id | 0);
    if (u && u.alive && u.side === cmd.side && !seen.has(u.id)) { seen.add(u.id); us.push(u); }
  }
  us.sort((a, b) => a.id - b.id);
  const cx = (v: number) => Math.max(0, Math.min(w.n - 1, v | 0));
  us.forEach((u, k) => {
    const ux = cellOf(u.x), uz = cellOf(u.z);
    if (cmd.t === 'fireDiscipline') {
      if (fireDisciplineEligible(u) && typeof cmd.hold === 'boolean') { if (cmd.hold) u.holdFire = 1; else delete u.holdFire; }
      return;
    }
    if (cmd.t === 'stop') { delete u.fireAmmo; u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }
    if (cmd.t === 'move') {
      delete u.fireAmmo;
      let gx = cx(cmd.x), gz = cx(cmd.z);
      // 觀測員照舊不排隊形；R021 步兵點到房子時直接進去、點地面照隊形
      const garr = UNIT_KINDS[u.kind].garrison, intoBld = garr && blocks(w, gx, gz);
      const [ox, oz] = u.kind === UK_OBSERVER || intoBld ? [0, 0] : FORMATION[k % FORMATION.length];
      if (inGrid(w, gx + ox, gz + oz) && !blocks(w, gx + ox, gz + oz) && !wireBlocks(w, gx + ox, gz + oz, u.kind)) { gx += ox; gz += oz; }
      u.order = ORD_MOVE; u.tx = gx; u.tz = gz; u.target = 0;
      u.path = findPath(w, ux, uz, gx, gz, garr ? (bldAt(w, gx, gz)?.id ?? 0) : 0, garr ? (bldAt(w, ux, uz)?.id ?? 0) : 0, u.kind); u.pathIdx = 0;
      if (!u.path.length) u.order = ORD_IDLE;
      return;
    }
    if (UNIT_KINDS[u.kind].range === 0) return; // unarmed (observer); old command format stays intact
    if (cmd.t === 'attack') {
      const t = unitById(w, cmd.target | 0);
      if (!t || !t.alive || t.side === u.side || tooClose(u, t.x, t.z)) return;
      delete u.fireAmmo;
      u.order = ORD_ATTACK; u.target = t.id; u.tx = t.x; u.tz = t.z;
      u.path = inRange(u, t.x, t.z) ? [] : findPath(w, ux, uz, cellOf(t.x), cellOf(t.z), 0, 0, u.kind); u.pathIdx = 0;
      return;
    }
    // fireAt：對還站著的建築＝打到變瓦礫；對空地或瓦礫＝打 FIRE_AT_ROUNDS 發（只有間接射擊的砲接，坦克打空地沒有用）
    if (cmd.ammo !== undefined && cmd.ammo !== 'smoke') return;
    const smoke = cmd.ammo === 'smoke';
    if (smoke && u.kind !== UK_HOWITZER) return;
    const gx = cx(cmd.x), gz = cx(cmd.z), standing = blocks(w, gx, gz);
    if (!standing && !UNIT_KINDS[u.kind].indirect) return;
    if (tooClose(u, center(gx), center(gz))) return;                // 榴彈砲：最小射程內不接
    if (smoke) {
      u.fireAmmo = SHELL_SMOKE;
      // 換彈種也換射擊解；保留遞增 epoch，舊高爆在飛也不能替後來的任務校準。
      const r = u.ranging;
      if (r) { r.epoch++; r.seen = 0; r.x = u.x; r.z = u.z; r.ax = -1; r.az = -1; r.target = 0; }
    } else delete u.fireAmmo;
    u.order = ORD_FIRE_AT; u.tx = gx; u.tz = gz;
    u.target = smoke || !standing ? FIRE_AT_ROUNDS : 0;
    u.path = inRange(u, center(gx), center(gz)) ? [] : findPath(w, ux, uz, gx, gz, 0, 0, u.kind); u.pathIdx = 0;
  });
}

function tooClose(u: Unit, x: number, z: number): boolean {
  return dist(u.x, u.z, x, z) < UNIT_KINDS[u.kind].minRange;
}

function inRange(u: Unit, x: number, z: number): boolean {
  const k = UNIT_KINDS[u.kind], d = dist(u.x, u.z, x, z);
  return d <= k.range && d >= k.minRange;
}

// 兩格之間的直線（Bresenham）。一律從格索引小的那一端畫，需要時再反轉：A→B 與 B→A 經過同一組格，視線才對稱
// n＝地圖邊長（格索引＝z*n+x）；src/ 一律傳 w.n，預設 32 只給舊守衛的四參數呼叫（R042）
export function lineCells(x0: number, z0: number, x1: number, z1: number, n = 32): number[] {
  const flip = z0 * n + x0 > z1 * n + x1;
  if (flip) { const tx = x0, tz = z0; x0 = x1; z0 = z1; x1 = tx; z1 = tz; }
  const dx = Math.abs(x1 - x0), dz = -Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  const out = [z0 * n + x0];
  let x = x0, z = z0, err = dx + dz;
  while (x !== x1 || z !== z1) {
    const e2 = 2 * err;
    if (e2 >= dz) { err += dz; x += sx; }
    if (e2 <= dx) { err += dx; z += sz; }
    out.push(z * n + x);
  }
  if (flip) out.reverse();
  return out;
}

// 從 (ax,az) 到 (bx,bz)（位置單位），回傳第一個擋住的建築格（不含起點格）；沒有擋就回傳 -1
export function firstBlock(w: World, ax: number, az: number, bx: number, bz: number, ignoreBuilding = 0): number {
  return firstBlockCells(w, lineCells(cellOf(ax), cellOf(az), cellOf(bx), cellOf(bz), w.n), ignoreBuilding);
}

// LOS 與實體彈道共用原建築掃描；spotted 已有射線時不再配置第二份格陣列。
function firstBlockCells(w: World, cells: readonly number[], ignoreBuilding = 0): number {
  for (let i = 1; i < cells.length; i++) { const c = cells[i]; if (w.occ[c] && w.occ[c] !== ignoreBuilding && w.blds[w.occ[c] - 1].hp > 0) return c; }
  return -1;
}

// 每 tick 查當前世界，不保留快取。阻擋建築本身可見，後方不可見；瓦礫不擋。
export function spotted(w: World, side: number, x: number, z: number, ignoreSmokeId = 0): boolean {
  if (!inGrid(w, cellOf(x), cellOf(z))) return false;
  for (const u of w.units) {
    if (!u.alive || u.side !== side || dist(u.x, u.z, x, z) > UNIT_KINDS[u.kind].sight) continue;
    if (smokeBlocks(w, u.x, u.z, x, z, ignoreSmokeId)) continue;
    const cells = lineCells(cellOf(u.x), cellOf(u.z), cellOf(x), cellOf(z), w.n);
    if (w.vegetation && vegetationBlocks(w, cells)) continue;
    const home = UNIT_KINDS[u.kind].garrison ? bldAt(w, cellOf(u.x), cellOf(u.z)) : null;
    const block = firstBlockCells(w, cells, home?.id ?? 0);
    if (block < 0 || block === cellIdx(w, cellOf(x), cellOf(z))) return true;
  }
  return false;
}

function moveUnit(w: World, u: Unit): void {
  if (u.order === ORD_ATTACK) {
    const t = unitById(w, u.target);
    if (!t || !t.alive || tooClose(u, t.x, t.z)) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }   // 目標死了或鑽進最小射程：放棄，回到自己找目標
    // 舊指令可盲射最後座標；失去視野後不追蹤敵人的新位置。
    if (spotted(w, u.side, t.x, t.z)) { u.tx = t.x; u.tz = t.z; }
    if (inRange(u, u.tx, u.tz)) { u.path = []; u.pathIdx = 0; return; }
    if (u.pathIdx >= u.path.length || (w.tick + u.id) % 40 === 0) { u.path = findPath(w, cellOf(u.x), cellOf(u.z), cellOf(u.tx), cellOf(u.tz), 0, 0, u.kind); u.pathIdx = 0; }
  }
  if (u.order === ORD_FIRE_AT && inRange(u, center(u.tx), center(u.tz))) { u.path = []; u.pathIdx = 0; }
  if (u.pathIdx >= u.path.length) {
    if (u.order === ORD_MOVE) u.order = ORD_IDLE;
    else if (u.order === ORD_FIRE_AT && !inRange(u, center(u.tx), center(u.tz))) u.order = ORD_IDLE;   // 走到底還打不到：放棄
    return;
  }
  const oldX = u.x, oldZ = u.z;
  const c = u.path[u.pathIdx], n = w.n, gx = center(c % n), gz = center((c - (c % n)) / n);
  const k = UNIT_KINDS[u.kind];
  const spd = Math.max(1, Math.floor((k.speed * speedPct(w, cellOf(u.x), cellOf(u.z))) / 100));
  const dx = gx - u.x, dz = gz - u.z, d = isqrt(dx * dx + dz * dz);
  if (d <= spd) { u.x = gx; u.z = gz; u.pathIdx++; }
  else if (k.radius > 0) stepVehicle(w, u, u.x + Math.trunc((dx * spd) / d), u.z + Math.trunc((dz * spd) / d), spd);
  else { u.x += Math.trunc((dx * spd) / d); u.z += Math.trunc((dz * spd) / d); }
  if (k.armored && (u.x !== oldX || u.z !== oldZ)) { u.hullX = u.x - oldX; u.hullZ = u.z - oldZ; }
  if (u.pathIdx >= u.path.length && u.order === ORD_MOVE) u.order = ORD_IDLE;
}

const freeAt = (w: World, x: number, z: number) => !blocks(w, cellOf(x), cellOf(z));

// 車輛走一步（R005）：被推離格子中心之後，直線走向下一個路點可能擦進牆角。
// 會撞進還站著的建築就沿牆滑（只走 x 或只走 z）；兩軸都撞就先回到自己這一格的中心；已經在中心還過不去就重找路。
// 沒被推過的車永遠走在格子中心的連線上，不會走到這些分支。
function stepVehicle(w: World, u: Unit, nx: number, nz: number, spd: number): void {
  if (freeAt(w, nx, nz)) { u.x = nx; u.z = nz; return; }
  if (nx !== u.x && freeAt(w, nx, u.z)) { u.x = nx; return; }
  if (nz !== u.z && freeAt(w, u.x, nz)) { u.z = nz; return; }
  const cx = center(cellOf(u.x)), cz = center(cellOf(u.z));
  if (u.x !== cx || u.z !== cz) {
    u.x += Math.max(-spd, Math.min(spd, cx - u.x)); u.z += Math.max(-spd, Math.min(spd, cz - u.z));
    return;
  }
  const end = u.path[u.path.length - 1];
  u.path = findPath(w, cellOf(u.x), cellOf(u.z), end % w.n, (end - (end % w.n)) / w.n, 0, 0, u.kind); u.pathIdx = 0;
}

// 車輛碰撞（R005）：全部單位移動之後，中心距離小於兩者半徑和的車輛沿連線推開。
// - 先算完所有推擠量再一起套用：結果跟處理順序無關；距離為 0 時用兩者 id 決定方向。
// - 有一方在走：連線轉 26.6°，交會的車各自往同一側讓開（繞過去，不是對頂）。
// - 架好的榴彈砲（間接射擊、沒有在走的路）不被會動的車推，推擠全部算在另一方：R102 的試射校準才不會被推掉。兩門都架好就照常互推。
// - 每個單位每一步最多被推「這一步車速的一半」：正在走的車永遠比推擠快，窄巷對向也擠得過去，不會卡死。
// - 不推進還站著的建築、不推出地圖；某一軸會撞就只推另一軸。半徑 0（步兵）與殘骸不參與。
const SPLIT: [number, number][] = [[256, 0], [181, 181], [0, 256], [-181, 181], [-256, 0], [-181, -181], [0, -256], [181, -181]];
const moving = (u: Unit) => u.pathIdx < u.path.length;
const anchored = (u: Unit) => (UNIT_KINDS[u.kind].indirect || UNIT_KINDS[u.kind].setup) && !moving(u);

function separate(w: World): void {
  const vs = w.units.filter(u => u.alive && UNIT_KINDS[u.kind].radius > 0);
  if (vs.length < 2) return;
  const px: number[] = vs.map(() => 0), pz: number[] = vs.map(() => 0);
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    const a = vs[i], b = vs[j], minD = UNIT_KINDS[a.kind].radius + UNIT_KINDS[b.kind].radius;
    let dx = b.x - a.x, dz = b.z - a.z;
    if (dx >= minD || dx <= -minD || dz >= minD || dz <= -minD) continue;
    const d = isqrt(dx * dx + dz * dz);
    if (d >= minD) continue;
    if (d === 0) [dx, dz] = SPLIT[(a.id * 3 + b.id) % SPLIT.length];
    else if (moving(a) || moving(b)) { const rx = 2 * dx - dz, rz = 2 * dz + dx; dx = rx; dz = rz; }
    const len = isqrt(dx * dx + dz * dz), over = minD - d;
    const fa = anchored(a) && !anchored(b), fb = anchored(b) && !anchored(a);
    const sa = fa ? 0 : fb ? over : over >> 1, sb = over - sa;
    px[i] -= Math.trunc((dx * sa) / len); pz[i] -= Math.trunc((dz * sa) / len);
    px[j] += Math.trunc((dx * sb) / len); pz[j] += Math.trunc((dz * sb) / len);
  }
  const top = gridLimit(w), lim = (v: number) => Math.max(0, Math.min(top, v));
  vs.forEach((u, i) => {
    let qx = px[i], qz = pz[i];
    if (!qx && !qz) return;
    const spd = Math.max(1, Math.floor((UNIT_KINDS[u.kind].speed * speedPct(w, cellOf(u.x), cellOf(u.z))) / 100)), cap = Math.max(1, spd >> 1);
    const q = isqrt(qx * qx + qz * qz);
    if (q > cap) { qx = Math.trunc((qx * cap) / q); qz = Math.trunc((qz * cap) / q); }
    const nx = lim(u.x + qx), nz = lim(u.z + qz);
    if (freeAt(w, nx, nz)) { u.x = nx; u.z = nz; }
    else if (freeAt(w, nx, u.z)) u.x = nx;
    else if (freeAt(w, u.x, nz)) u.z = nz;
  });
}

// 找目標：攻擊指令 → 那個單位；射擊指令 → 那一格；其他時候自己找最近、射得到的敵人
function pickAim(w: World, u: Unit): { x: number; z: number; unit: Unit | null; bld: Building | null } | null {
  const k = UNIT_KINDS[u.kind];
  if (u.order === ORD_ATTACK) {
    const t = unitById(w, u.target);
    return t && t.alive ? { x: u.tx, z: u.tz, unit: t, bld: null } : null;
  }
  if (u.order === ORD_FIRE_AT) {
    if (u.target > 0) return { x: center(u.tx), z: center(u.tz), unit: null, bld: null };   // 對地面：還有發數
    if (u.fireAmmo === SHELL_SMOKE) { u.order = ORD_IDLE; delete u.fireAmmo; return null; }
    const b = bldAt(w, u.tx, u.tz);
    if (!b || b.hp <= 0) { u.order = ORD_IDLE; return null; }         // 建築已經是瓦礫，或對地面打完了：停火
    return { x: center(u.tx), z: center(u.tz), unit: null, bld: b };
  }
  let best: Unit | null = null, bestD = 0;
  for (const t of w.units) {
    if (!t.alive || t.side === u.side) continue;
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > k.range || d < k.minRange) continue;
    if (!spotted(w, u.side, t.x, t.z) || (!k.indirect && firstBlock(w, u.x, u.z, t.x, t.z, homeOf(w, u)) >= 0)) continue;
    if (!best || d < bestD || (d === bestD && t.id < best.id)) { best = t; bestD = d; }
  }
  return best ? { x: best.x, z: best.z, unit: best, bld: null } : null;
}

// The solution is invalidated every tick, including during reload or movement.
function syncRanging(w: World, u: Unit, aim: { x: number; z: number; unit: Unit | null } | null): void {
  const r = u.ranging;
  const target = aim?.unit?.id ?? 0;
  const movedTarget = r?.target ? unitById(w, r.target) : null;
  if (r && (r.x !== u.x || r.z !== u.z || (movedTarget && (!movedTarget.alive || movedTarget.x !== r.ax || movedTarget.z !== r.az)))) {
    if (r) { r.seen = 0; r.epoch++; r.x = u.x; r.z = u.z; r.ax = -1; r.az = -1; r.target = 0; }
  }
  if (!aim) return;
  if (!r || r.x !== u.x || r.z !== u.z || r.ax !== aim.x || r.az !== aim.z || r.target !== target) {
    u.ranging = { x: u.x, z: u.z, ax: aim.x, az: aim.z, target, epoch: (r?.epoch ?? 0) + 1, seen: 0 };
  }
}

function zombieVision(w: World, u: Unit, target: Unit): boolean {
  if (dist(u.x, u.z, target.x, target.z) > UNIT_KINDS[UK_ZOMBIE].sight || !spotted(w, SIDE_PLAYER, u.x, u.z) || smokeBlocks(w, u.x, u.z, target.x, target.z)) return false;
  const ray = lineCells(cellOf(u.x), cellOf(u.z), cellOf(target.x), cellOf(target.z), w.n);
  if (w.vegetation && vegetationBlocks(w, ray)) return false;
  const block = firstBlockCells(w, ray);
  return block < 0 || block === cellIdx(w, cellOf(target.x), cellOf(target.z));
}

function fireUnit(w: World, u: Unit): void {
  if (u.kind === UK_ZOMBIE) {
    if (u.cooldown > 0) u.cooldown--;
    const aim = zombieAim(w, u, (a, b) => zombieVision(w, a, b));
    if (!aim || u.cooldown > 0) return;
    u.cooldown = UNIT_KINDS[UK_ZOMBIE].reload; u.aimX = aim.x - u.x; u.aimZ = aim.z - u.z;
    w.events.push({ e: 'fire', unit: u.id, x: u.x, z: u.z });
    if (aim.unit) damageUnit(w, aim.unit, pierced(UNIT_KINDS[UK_ZOMBIE], aim.unit, UNIT_KINDS[UK_ZOMBIE].dmgUnit));
    else if (aim.bld && aim.wire) { aim.bld.hp = Math.max(0, aim.bld.hp - UNIT_KINDS[UK_ZOMBIE].dmgBld); w.events.push({ e: 'wire' }); }
    else if (aim.bld) damageBld(w, aim.bld, UNIT_KINDS[UK_ZOMBIE].dmgBld);
    w.events.push({ e: 'impact', kind: SHELL_MELEE, x: aim.x, z: aim.z, bld: aim.bld?.id ?? 0 });
    return;
  }
  if (UNIT_KINDS[u.kind].range === 0) return;   // 觀測員沒有武裝
  if (u.cooldown > 0) u.cooldown--;
  const k = UNIT_KINDS[u.kind];
  if (u.holdFire === 1 && fireDisciplineEligible(u)) { if (k.indirect) syncRanging(w, u, null); return; }
  if (u.order !== ORD_FIRE_AT) delete u.fireAmmo;
  const smoke = u.fireAmmo === SHELL_SMOKE;
  const aim = pickAim(w, u);
  if (k.indirect) syncRanging(w, u, smoke ? null : aim);
  if ((k.indirect || k.setup) && u.pathIdx < u.path.length) return;     // 榴彈砲、迫擊砲、反戰車砲（R022）移動中不能打
  if (!aim) return;
  const dx = aim.x - u.x, dz = aim.z - u.z, d = isqrt(dx * dx + dz * dz);
  if (d > k.range || d < k.minRange) return;
  if (dx || dz) { u.aimX = dx; u.aimZ = dz; }
  if (u.cooldown > 0) return;
  u.cooldown = k.reload;
  if (u.order === ORD_FIRE_AT && !aim.bld) u.target--;
  w.events.push({ e: 'fire', unit: u.id, x: u.x, z: u.z });
  const sh: Shell = { id: w.nextShell++, side: u.side, kind: smoke ? SHELL_SMOKE : k.indirect ? SHELL_HE : k.men ? SHELL_SMALL : SHELL_AP, shooter: u.id, sx: u.x, sz: u.z, ex: aim.x, ez: aim.z, t: 0, T: 2, target: aim.unit ? aim.unit.id : 0, hitBld: 0 };
  if (!k.indirect) {
    const blockCell = firstBlock(w, u.x, u.z, aim.x, aim.z, homeOf(w, u));   // R021：從自己待的房子往外打
    if (blockCell >= 0) { sh.hitBld = w.occ[blockCell]; sh.ex = center(blockCell % w.n); sh.ez = center((blockCell - (blockCell % w.n)) / w.n); sh.target = 0; }
    sh.T = sh.kind === SHELL_SMALL ? Math.max(1, Math.floor(dist(u.x, u.z, sh.ex, sh.ez) / (3 * SUB))) : Math.max(2, Math.floor(dist(u.x, u.z, sh.ex, sh.ez) / SUB));
  } else {
    let r = Math.floor(d / 12);
    if (!smoke) {
      for (let i = 0; i < (u.ranging?.seen ?? 0); i++) r = Math.max(1, Math.floor(r / 2));
      sh.rangingEpoch = u.ranging?.epoch;
    }
    if (!spotted(w, u.side, aim.x, aim.z)) r *= 2;               // 沒有友軍看得到：盲射，散布加倍
    sh.ex = Math.max(0, Math.min(gridLimit(w), aim.x + randSym(w, r)));
    sh.ez = Math.max(0, Math.min(gridLimit(w), aim.z + randSym(w, r)));
    sh.T = 20 + 2 * Math.floor(d / SUB);
  }
  w.shells.push(sh);
  if (smoke && u.target <= 0) { u.order = ORD_IDLE; delete u.fireAmmo; }
}

// R021：打裝甲目標時只剩穿甲率那一部分（坦克、榴彈砲的穿甲率是 100＝跟以前一樣）；R022：打非裝甲目標剩 soft（既有兵種是 100＝不變）
// R044：開頂的車（驅逐戰車）被步兵打時照「打非裝甲目標」算（既有兵種沒有 openTop＝不變）
function pierced(k: { pierce: number; soft: number; men: number }, t: Unit, dmg: number): number { const tk = UNIT_KINDS[t.kind]; return Math.floor((dmg * (tk.armored && !(tk.openTop && k.men > 0) ? k.pierce : k.soft)) / 100); }
// R021：能進駐的單位待在還站著的房子裡時，射線不算自己這棟
function homeOf(w: World, u: Unit): number { if (!UNIT_KINDS[u.kind].garrison) return 0; const b = bldAt(w, cellOf(u.x), cellOf(u.z)); return b && b.hp > 0 ? b.id : 0; }

function damageUnit(w: World, u: Unit, dmg: number, allowGroundCover = true): void {
  if (!u.alive || dmg <= 0) return;
  const x = cellOf(u.x), z = cellOf(u.z);
  const home = UNIT_KINDS[u.kind].garrison && blocks(w, x, z) ? bldAt(w, x, z) : null;
  // R106：只用命中前已有的彈坑；建築掩護更強，不疊乘。倒塌傷害不吃地形掩護。
  const terrain = !allowGroundCover ? 100 : vegetationAt(w, x, z) ? 50 : inGrid(w, x, z) && w.crater[cellIdx(w, x, z)] > 0 ? 75 : 100;
  const ground = Math.min(terrain, allowGroundCover ? trenchCover(w, x, z) : 100);
  const cover = !home ? ground : Math.min(ground, home.kind === BK_PILLBOX ? 25 : 50);   // R024 碉堡裡只吃四分之一
  u.hp -= Math.floor((dmg * UNIT_KINDS[u.kind].armor * cover) / 10000);
  if (u.hp <= 0) { u.hp = 0; u.alive = false; u.path = []; u.pathIdx = 0; u.order = ORD_IDLE; w.events.push({ e: 'kill', unit: u.id }); }
}

function damageBld(w: World, b: Building, dmg: number): void {
  if (b.hp <= 0 || dmg <= 0) return;
  const before = stageOf(b);
  b.hp = Math.max(0, b.hp - dmg);
  const after = stageOf(b);
  if (after !== before) w.events.push({ e: 'stage', bld: b.id, stage: after });
  if (b.hp === 0) for (const u of w.units) {
    if (u.alive && UNIT_KINDS[u.kind].garrison && bldAt(w, cellOf(u.x), cellOf(u.z))?.id === b.id) damageUnit(w, u, 20, false);
  }
}

function land(w: World, s: Shell): void {
  if (s.kind === SHELL_SMOKE) { spawnSmoke(w, s); return; }
  const k = UNIT_KINDS[w.units[s.shooter - 1].kind];
  if (s.kind === SHELL_AP || s.kind === SHELL_SMALL) {
    if (s.hitBld) { const b = w.blds[s.hitBld - 1]; damageBld(w, b, b.kind === BK_PILLBOX ? k.dmgBld >> 2 : k.dmgBld); }   // R024 直射打碉堡只刮掉四分之一
    else {
      const t = unitById(w, s.target);
      if (t && t.alive && dist(t.x, t.z, s.ex, s.ez) <= AP_HIT_RADIUS) damageUnit(w, t, pierced(k, t, s.kind === SHELL_AP ? Math.floor(k.dmgUnit * armorPct(t, s.sx, s.sz) / 100) : k.dmgUnit));
    }
    w.events.push({ e: 'impact', kind: s.kind, x: s.ex, z: s.ez, bld: s.hitBld });
    return;
  }
  const gun = unitById(w, s.shooter), r = gun?.ranging;
  if (gun?.alive && r && s.rangingEpoch === r.epoch && gun.x === r.x && gun.z === r.z && spotted(w, s.side, s.ex, s.ez)) {
    const target = r.target ? unitById(w, r.target) : null;
    if (!r.target || (target?.alive && target.x === r.ax && target.z === r.az)) r.seen = Math.min(16, r.seen + 1);
  }
  const R = k.splash;
  for (const t of w.units) {
    if (!t.alive) continue;
    const d = dist(t.x, t.z, s.ex, s.ez);
    if (d < R) damageUnit(w, t, pierced(k, t, Math.floor((k.dmgUnit * (R - d)) / R)));
  }
  const cx = cellOf(s.ex), cz = cellOf(s.ez), rc = Math.floor(R / SUB) + 1, hit = new Set<number>();
  for (let z = cz - rc; z <= cz + rc; z++) for (let x = cx - rc; x <= cx + rc; x++) {
    const b = bldAt(w, x, z);
    if (!b || hit.has(b.id) || dist(center(x), center(z), s.ex, s.ez) > R + HALF) continue;
    hit.add(b.id);
    damageBld(w, b, k.dmgBld);
  }
  // R121：同一高爆半徑／建築傷害，但獨立障礙不參加房屋駐守、倒塌傷人或AI候選。
  for (const b of w.wires?.segments ?? []) {
    if (b.hp <= 0) continue;
    let reached = false;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (dist(center(x), center(z), s.ex, s.ez) <= R + HALF) reached = true;
    if (reached) { b.hp = Math.max(0, b.hp - k.dmgBld); w.events.push({ e: 'wire' }); }
  }
  if (inGrid(w, cx, cz) && !blocks(w, cx, cz)) { const i = cellIdx(w, cx, cz); if (w.crater[i] < 3) w.crater[i]++; }
  w.events.push(R < UNIT_KINDS[UK_HOWITZER].splash ? { e: 'impact', kind: s.kind, x: s.ex, z: s.ez, bld: 0, r: R } : { e: 'impact', kind: s.kind, x: s.ex, z: s.ez, bld: 0 });
}

function updateShells(w: World): void {
  const keep = [];
  for (const s of w.shells) {
    s.t++;
    if (s.t >= s.T) land(w, s); else keep.push(s);
  }
  w.shells = keep;
}

function checkWinner(w: World): void {
  if (w.zombies) {
    const hq = w.eco?.hq[SIDE_PLAYER] ?? 0;
    if (w.winner < 0 && (hq ? !hqAlive(w, SIDE_PLAYER) : !w.units.some(u => u.alive && u.side === SIDE_PLAYER))) w.winner = SIDE_ENEMY;
    return; // 沒有喪屍不算贏；指揮部失守立即結束。
  }
  if (w.winner >= 0 || w.shells.some(s => s.kind !== SHELL_SMOKE)) return; // 只等可能改變結局的砲彈；無傷害煙幕不拖延戰報
  if (w.eco) {   // R019：有指揮部時，指揮部塌了才輸（全軍覆沒但指揮部還在可以再出兵）
    const a = !!hqAlive(w, SIDE_PLAYER), b = !!hqAlive(w, SIDE_ENEMY);
    if (!a && !b) w.winner = 2; else if (!b) w.winner = SIDE_PLAYER; else if (!a) w.winner = SIDE_ENEMY;
    return;
  }
  let a = false, b = false;
  for (const u of w.units) if (u.alive) { if (u.side === SIDE_PLAYER) a = true; else if (u.side === SIDE_ENEMY) b = true; }
  if (!a && !b) w.winner = 2; else if (!b) w.winner = SIDE_PLAYER; else if (!a) w.winner = SIDE_ENEMY;
}

export function step(w: World, cmds: Command[], placementResults?: (SandboxError | null)[]): void {
  w.events = [];
  if (w.sandbox) {
    for (const c of cmds) {
      const result = applyCommand(w, c);
      // Presentation feedback only: ordered results from the actual application,
      // never stored in World or folded into replay/hash state.
      if (c.t === 'sandboxPlace') placementResults?.push(typeof result === 'string' ? result : null);
    }
    w.sandbox.frame++;
    if (!w.sandbox.running) return; // 不碰移動／裝填／砲彈／煙幕／聲測或戰鬥 tick。
  } else {
  for (const c of cmds) if (c.t === 'map') applyMap(w, c.id | 0, c.id === 0 || c.id === 1 || c.id === 2 || c.id === 3 ? c.vegetation : undefined);   // 地圖最先套；R130 id 3 也保留明確的植被旗標。
  for (const c of cmds) if (c.t === 'zombies') startZombies(w);
  if (w.zombies) cmds = cmds.filter(c => !('side' in c) || c.side === SIDE_PLAYER); // 布陣也走同一個敵方命令禁令。
  for (const c of cmds) { if (c.t === 'build') applyBuild(w, c); else if (c.t === 'trench') applyTrench(w, c); }   // R118：布陣保留相對順序，全部先於移動與 HQ
  for (const c of cmds) if (c.t !== 'build' && c.t !== 'trench' && c.t !== 'map') applyCommand(w, c);
  }
  ecoStep(w);   // R019：補給與生產（電腦想之前，剛出生的單位這一步就能被指揮）
  if (w.zombies) zombiesStep(w, (a, b) => zombieVision(w, a, b));
  // R018：電腦在玩家指令之後、單位移動之前想（每隔 AI_THINK 步想一次），下的指令跟玩家的一樣套用
  if (w.ai) for (const st of w.ai) if (w.tick >= st.next) {
    for (const c of aiThink(w, st, spotted)) applyCommand(w, c);
    st.next = w.tick + AI_THINK[st.level];
  }
  for (const u of w.units) if (u.alive) moveUnit(w, u);
  separate(w);
  for (const u of w.units) if (u.alive) fireUnit(w, u);
  updateShells(w);
  if (w.zombies) finishZombiesStep(w);
  if (!w.sandbox) checkWinner(w);
  w.tick++;
  advanceSmoke(w);
  updateCounterbattery(w);
}

// 從指令紀錄跑到第 ticks 步（重播與守衛用）。紀錄要照 tick 排好。
export function runLog(w: World, log: LoggedCommand[], ticks: number): World {
  let i = 0;
  while (commandTick(w) < ticks) {
    const now: Command[] = [];
    while (i < log.length && log[i].tick <= commandTick(w)) { if (log[i].tick === commandTick(w)) now.push(log[i].cmd); i++; }
    step(w, now);
  }
  return w;
}
