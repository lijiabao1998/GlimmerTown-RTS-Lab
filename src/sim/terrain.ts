// R055 地勢與視線（第一段）：每格一個高度（0–HEIGHT_MAX 階）。只有帶高度的地圖（丘陵）才有 w.height；
// 沒有這張表的世界，下面的函式一律回「不擋、不加成」，舊地圖逐位不變。整數、決定性、不抽 World.rng。
// 高度以「半階」算：地面 2h，眼睛（也是槍口、車頂）2h＋1。規則與數字的理由在 docs/tasks/R055-地勢與視線.md。
import { SUB, cellIdx, cellOf, type World } from './world.ts';

export const HEIGHT_MAX = 3;       // 最高幾階
export const HIGH_SIGHT_MAX = 2;   // 站得比目標高：每高一階多看一格，最多多看幾格（暫定）

// 這一格的高度（格座標）；圖外、或沒有高度表的世界＝0
export const heightAt = (w: World, x: number, z: number): number => (w.height && x >= 0 && z >= 0 && x < w.n && z < w.n ? w.height[cellIdx(w, x, z)] : 0);

// 稜線擋不擋。cells＝從看的人那一格到被看的那一格（含兩端；step.ts 的 lineCells，房子擋視線用的也是這一條，兩個方向走同一串格子）。
// 視線是兩端眼睛之間的直線；中間任何一格的地面高過它就擋住。比的是交叉相乘，沒有除法。
export function ridgeBlocks(w: World, cells: readonly number[]): boolean {
  const h = w.height, n = cells.length - 1;
  if (!h || n < 2) return false;
  const a = 2 * h[cells[0]] + 1, b = 2 * h[cells[n]] + 1;
  for (let i = 1; i < n; i++) if (2 * h[cells[i]] * n > a * (n - i) + b * i) return true;
  return false;
}

// 站在 (ux, uz) 看 (x, z)（位置單位）：比那一格高幾階就多看幾格，最多 HIGH_SIGHT_MAX；回傳多出來的視野（位置單位）
export function highSight(w: World, ux: number, uz: number, x: number, z: number): number {
  if (!w.height) return 0;
  const up = heightAt(w, cellOf(ux), cellOf(uz)) - heightAt(w, cellOf(x), cellOf(z));
  return up > 0 ? Math.min(HIGH_SIGHT_MAX, up) * SUB : 0;
}
