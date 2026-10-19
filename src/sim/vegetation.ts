// R116 通用、可穿行的植被。只在明確的新 map 指令啟用；不消耗 World.rng。
import { N, idx, inMap, cellOf, TER_ROAD, TER_MUD, type World } from './world.ts';

export const VEG_NONE = 0;
export const VEG_HEDGE = 1;
export const VEG_WOOD = 2;
export const VEGETATION_VERSION = 1;
export const VEGETATION_MAX = 64;

// 參數是格座標。未知版本／種類當作無植被，缺欄位的舊世界不用遷移。
export function vegetationAt(w: World, x: number, z: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(z) || !inMap(x, z) || w.vegetation?.version !== VEGETATION_VERSION) return VEG_NONE;
  const v = w.vegetation.cells[idx(x, z)];
  return v === VEG_HEDGE || v === VEG_WOOD ? v : VEG_NONE;
}

// 使用 step 的同一條對稱射線；兩端植被可探頭，只有中間格遮蔽。
export function vegetationBlocks(w: World, cells: readonly number[]): boolean {
  if (w.vegetation?.version !== VEGETATION_VERSION) return false;
  for (let i = 1; i + 1 < cells.length; i++) {
    const c = cells[i], v = w.vegetation.cells[c];
    if (v === VEG_HEDGE || v === VEG_WOOD) return true;
  }
  return false;
}

// 永久清除，保留啟用狀態；重複 map 指令不讓建築或瓦礫下長回來。
export function clearVegetation(w: World, x: number, z: number, width: number, depth: number): void {
  if (!w.vegetation) return;
  for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) {
    if (inMap(x + dx, z + dz)) w.vegetation.cells[idx(x + dx, z + dz)] = VEG_NONE;
  }
}

// 固定鄉間候選：四小段樹籬、四片 2×2 小樹林，留住中央道路與攻防動線。
// 不抽額外亂數、不改地形／occ／速度；只過濾道路、泥灘、建築與出生單位格。
export function generateVegetation(w: World): void {
  if (w.tick !== 0 || w.vegetation) return;
  const cells = new Uint8Array(N * N), units = new Set(w.units.map(u => idx(cellOf(u.x), cellOf(u.z))));
  let count = 0;
  const put = (x: number, z: number, kind: number) => {
    const c = idx(x, z);
    if (count >= VEGETATION_MAX || !inMap(x, z) || cells[c] || w.occ[c] || units.has(c) || w.ter[c] === TER_ROAD || w.ter[c] === TER_MUD) return;
    cells[c] = kind; count++;
  };
  for (let k = 0; k < 4; k++) {
    put(1 + k, 11, VEG_HEDGE); put(27 + k, 22, VEG_HEDGE);
    put(9, 25 + k, VEG_HEDGE); put(22, k, VEG_HEDGE);
  }
  for (const [x, z] of [[0, 17], [30, 12], [9, 29], [20, 0]]) {
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, z + dz, VEG_WOOD);
  }
  w.vegetation = { version: VEGETATION_VERSION, cells };
}
