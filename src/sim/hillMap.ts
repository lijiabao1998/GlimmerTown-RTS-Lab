// R055 丘陵（地圖 4，32×32）：第一張有高度的地圖。一道稜線斜斜橫在兩個出生角落之間，中央一個隘口，兩邊山腳各一個小丘。
// 地形、房子、路、植被全部點對稱（x → 31−x、z → 31−z），雙方一樣。不抽 World.rng（起手部隊是 createWorld 原本的那一批，位置不動）。
import { VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION } from './vegetation.ts';
import { cellIdx, bldMaxHp, TER_GRASS, TER_ROAD, TER_FIELD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, type World } from './world.ts';

export const MAP_HILLS = 4, HILLS_N = 32;
export const HILLS_SPAWN = 10;   // 兩個出生角落（各這麼寬）裡沒有房子、高度是 0
export const HILLS_KNOLLS: readonly [number, number][] = [[7, 15], [24, 16]];   // 兩個小丘的頂（給觀測員用）

// 這一格多高。稜線沿著 x＋z＝31（從左下到右上）：離軸線 1 格以內 3 階、3 格以內 2 階、5 格以內 1 階。
// 中央的大路（x＝15、16 那兩排）是隘口，切到 1 階；隘口兩側各一排的肩（x＝14、17）壓到 2 階；稜線兩頭靠地圖邊緣（|x−z| ≥ 27）降到 1 階。
export function hillHeight(x: number, z: number): number {
  const d = Math.abs(x + z - (HILLS_N - 1)), t = Math.abs(x - z);
  let h = d <= 1 ? 3 : d <= 3 ? 2 : d <= 5 ? 1 : 0;
  if (x === 15 || x === 16) h = Math.min(h, 1);
  else if (x === 14 || x === 17) h = Math.min(h, 2);
  if (t >= 27) h = Math.min(h, 1);
  for (const [cx, cz] of HILLS_KNOLLS) { const k = Math.max(Math.abs(x - cx), Math.abs(z - cz)); if (k <= 1) h = Math.max(h, 2); else if (k <= 2) h = Math.max(h, 1); }
  return h;
}

export function applyHills(w: World, vegetation?: number): void {
  if (w.tick !== 0 || w.map || w.n !== HILLS_N || w.sandbox || w.trenches?.segments.length || w.wires?.segments.length) return;
  const n = HILLS_N;
  w.ter.fill(TER_GRASS); w.occ.fill(0); w.crater.fill(0); w.blds = []; delete w.vegetation;
  w.height = new Uint8Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) w.height[cellIdx(w, x, z)] = hillHeight(x, z);
  const veg = vegetation === 1 ? new Uint8Array(n * n) : null;
  // 每一樣東西都放兩份：自己那一份，與點對稱的那一份（矩形的左上角換算過去）
  const twice = (x: number, z: number, bw: number, bd: number, put: (x: number, z: number) => void) => { put(x, z); put(n - x - bw, n - z - bd); };
  const ter = (t: number, x0: number, z0: number, x1: number, z1: number) => twice(x0, z0, x1 - x0 + 1, z1 - z0 + 1, (ax, az) => {
    for (let z = az; z <= az + z1 - z0; z++) for (let x = ax; x <= ax + x1 - x0; x++) w.ter[cellIdx(w, x, z)] = t;
  });
  const bld = (kind: number, x: number, z: number, bw: number, bd: number, floors: number) => twice(x, z, bw, bd, (ax, az) => {
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x: ax, z: az, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[cellIdx(w, ax + dx, az + dz)] = id;
  });
  const plant = (kind: number, x: number, z: number, bw: number, bd: number) => twice(x, z, bw, bd, (ax, az) => {
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) { const c = cellIdx(w, ax + dx, az + dz); if (veg && !w.occ[c] && w.ter[c] !== TER_ROAD) veg[c] = kind; }
  });

  // ---- 田（山腳下的平地）、路（最後鋪：大路穿過隘口，兩條橫路在稜線背後）----
  ter(TER_FIELD, 1, 20, 8, 25);              // 左下的田（對面：右上）
  ter(TER_FIELD, 19, 22, 21, 30);            // 村子南邊的田
  ter(TER_ROAD, 15, 16, 16, 27);             // 穿過隘口的大路（兩格寬；另一半是對面那一份）
  ter(TER_ROAD, 17, 26, 31, 27);             // 從大路往我方出生角落
  ter(TER_ROAD, 4, 16, 14, 16);              // 稜線背後的橫路（往小丘）

  // ---- 隘口南邊的村子（對面一模一樣）----
  bld(BK_HOUSE, 12, 19, 2, 1, 2); bld(BK_COTTAGE, 13, 21, 1, 1, 1); bld(BK_HOUSE, 17, 20, 1, 2, 2);
  bld(BK_CHURCH, 12, 23, 2, 2, 2);           // 教堂
  bld(BK_BARN, 9, 22, 2, 2, 1); bld(BK_COTTAGE, 18, 23, 1, 1, 1);
  bld(BK_COTTAGE, 5, 18, 1, 1, 1);           // 小丘下的看羊人小屋
  bld(BK_BARN, 2, 22, 2, 1, 1);              // 田邊的穀倉

  // ---- 植被（只有 map 指令帶 vegetation 才種）：稜線兩肩的小樹林、田邊的樹籬 ----
  plant(VEG_WOOD, 8, 19, 2, 2); plant(VEG_WOOD, 20, 14, 2, 2);
  plant(VEG_HEDGE, 1, 19, 4, 1); plant(VEG_HEDGE, 19, 21, 3, 1);
  if (veg) w.vegetation = { version: VEGETATION_VERSION, cells: veg };
  w.map = MAP_HILLS;
}
