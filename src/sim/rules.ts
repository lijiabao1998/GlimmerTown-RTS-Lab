// R046 遭遇戰設定：一局開打前可以改的規則，由 rules 指令在第 0 步套一次。整數、決定性、不抽 World.rng。
// 兩個欄位都是標準值時不留任何狀態：世界雜湊跟沒送這條指令逐位相同（舊紀錄、黃金雜湊不變）。
// 之後 G 段「專業戰爭模擬」的規則旗標（穿甲、士氣、彈藥……）都加在這條指令與 World.rules 上，只加不改。
import { ARMOUR_FORCE } from './mapCommon.ts';
import {
  SUB, cellIdx, inGrid, center, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY, TER_MUD, type World,
} from './world.ts';

export interface RulesCmd { t: 'rules'; force?: number; income?: number }

export const FORCE_LEAN = 1;      // 精簡：起手留一半左右
export const FORCE_DOUBLE = 3;    // 加倍：標準那一批原地不動，再加同樣的一批
export const INCOME_SLOW = 1;     // 慢：每 40 步 +1
export const INCOME_FAST = 3;     // 快：每 10 步 +1
const INCOME_TICKS: Record<number, number> = { [INCOME_SLOW]: 40, [INCOME_FAST]: 10 };

// 32×32（萊伊、村莊）的標準起手，我方的格；敵方是點對稱。數字照 createWorld 抄（id 順序不同：這裡我方在前）。
export const VILLAGE_FORCE: [number, number, number][] = [
  [UK_TANK, 24, 26], [UK_TANK, 26, 24], [UK_TANK, 26, 27], [UK_HOWITZER, 29, 29], [UK_OBSERVER, 24, 24],
];
const LEAN_32 = [0, 1, 4];                    // 坦克 2、觀測員 1
const LEAN_ARMOUR = [0, 1, 2, 6, 8, 10, 13];  // ARMOUR_FORCE 裡的：中坦克 3、輕坦克 1、重坦克 1、榴彈砲 1、觀測員 1

// 補給每幾步 +1（eco.ts 用）；沒有規則的世界回傳 0，由 eco.ts 用它自己的標準值
export const incomeTicks = (w: World): number => (w.rules?.income ? INCOME_TICKS[w.rules.income] ?? 0 : 0);

// (x, z) 由近到遠（同一圈先小 z 再小 x）第一個站得住的格：在圖內、沒有建築或瓦礫、不是泥灘、沒有植被、沒有別的起手單位
function freeCell(w: World, x: number, z: number, taken: Set<number>): number {
  for (let r = 0; r < w.n; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !inGrid(w, x + dx, z + dz)) continue;
    const i = cellIdx(w, x + dx, z + dz);
    if (!w.occ[i] && w.ter[i] !== TER_MUD && !w.vegetation?.cells[i] && !taken.has(i)) return i;
  }
  return cellIdx(w, x, z);   // 整張圖都滿了才會到這裡
}

// 起手單位整批重排：我方 id 在前、敵方在後（跟 R043 大地圖一樣）
function deploy(w: World, force: number): void {
  const small = w.n === 32, base = small ? VILLAGE_FORCE : ARMOUR_FORCE, off = small ? 0 : w.n - 64;   // ARMOUR_FORCE 以 64×64 的座標記，河鎮（96）整批平移
  const list = force === FORCE_LEAN ? (small ? LEAN_32 : LEAN_ARMOUR).map(i => base[i]) : [...base, ...base.map(([k, x, z]): [number, number, number] => [k, x + 1, z + 1])];
  const taken = new Set<number>();
  w.units = [];
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (const [kind, px, pz] of list) {
    const x = px + off, z = pz + off, mine = side === SIDE_PLAYER;
    const i = freeCell(w, mine ? x : w.n - 1 - x, mine ? z : w.n - 1 - z, taken), k = UNIT_KINDS[kind], d = mine ? -SUB : SUB;
    taken.add(i);
    w.units.push({ id: w.units.length + 1, side, kind, x: center(i % w.n), z: center(Math.floor(i / w.n)), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(k.armored ? { hullX: d, hullZ: d } : {}) });
  }
}

// rules 指令：只在第 0 步、還沒有指揮部、還沒進喪屍模式、不是沙盒時套，而且只套一次
export function applyRules(w: World, cmd: { force?: number; income?: number }): void {
  if (w.tick !== 0 || w.rules || w.sandbox || w.eco || w.zombies) return;
  const force = cmd.force === FORCE_LEAN || cmd.force === FORCE_DOUBLE ? cmd.force : 0;
  const income = cmd.income === INCOME_SLOW || cmd.income === INCOME_FAST ? cmd.income : 0;
  if (!force && !income) return;
  w.rules = { ...(force ? { force } : {}), ...(income ? { income } : {}) };
  if (force) deploy(w, force);
}
