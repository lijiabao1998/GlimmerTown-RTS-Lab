// R055 地勢的畫法（第一段）：地面還是一張平面，起伏畫在地面貼圖上。只給畫面用，不影響模擬。
// 模擬的高度是一格一個整數；畫的時候在格中心之間雙線性內插成一片連續的地面，所以等高線是順的斜線，不是沿著格子的鋸齒。
//   越高越亮、越暖（坡頂的草比較乾）；光從畫面左上方（−x）來，往 +x 變高的坡迎光、反過來的背光；
//   每半階（0.5、1.5、2.5）一道一個像素寬的深色等高線——剛好落在兩格高度不同的交界上。
// 每個像素的倍數只看高度表，所以照高度表算一次存起來（布陣時每點一下都整張重畫；預覽世界是複製的，內容一樣就沿用）。
// 純函式、不碰 three；回傳的陣列每次呼叫都會被覆寫（不配置記憶體）。
import { heightAt } from '../sim/terrain.ts';
import type { World } from '../sim/world.ts';

export const RELIEF_LIFT = 0.1;     // 每高一階整體亮多少
export const RELIEF_WARM = 0.035;   // 每高一階紅多一點、藍少一點半（坡頂偏黃）
export const RELIEF_SLOPE = 0.16;   // 坡面：每一格高一階，迎光的亮多少、背光的暗多少
export const RELIEF_EDGE = 0.7;     // 等高線

const out = new Float64Array(3);
// 連續的高度：fx、fz 是格座標（可以有小數；格中心在 i＋0.5），圖外照最近的邊緣格
function field(w: World, fx: number, fz: number): number {
  const gx = fx - 0.5, gz = fz - 0.5, x0 = Math.floor(gx), z0 = Math.floor(gz), tx = gx - x0, tz = gz - z0, m = w.n - 1;
  const h = (x: number, z: number) => heightAt(w, Math.max(0, Math.min(m, x)), Math.max(0, Math.min(m, z)));
  return (h(x0, z0) * (1 - tx) + h(x0 + 1, z0) * tx) * (1 - tz) + (h(x0, z0 + 1) * (1 - tx) + h(x0 + 1, z0 + 1) * tx) * tz;
}
// 一個像素的倍數（直接算）
function shade(w: World, x: number, z: number, px: number, py: number, size: number, into: Float32Array | Float64Array, at: number): void {
  const d = 1 / size, fx = x + (px + 0.5) * d, fz = z + (py + 0.5) * d;
  const h = field(w, fx, fz), east = field(w, fx + d, fz), south = field(w, fx, fz + d), band = Math.floor(h + 0.5);
  let k = 1 + RELIEF_LIFT * h + RELIEF_SLOPE * (east - h) * size;
  if (Math.floor(east + 0.5) !== band || Math.floor(south + 0.5) !== band) k *= RELIEF_EDGE;
  into[at] = k * (1 + RELIEF_WARM * h); into[at + 1] = k; into[at + 2] = k * (1 - 1.5 * RELIEF_WARM * h);
}

// 快取：上一次算的是哪一張高度表（物件、內容）、多大；每個像素三個倍數
let lastRef: Uint8Array | null = null, lastCopy: Uint8Array | null = null, lastN = 0, lastSize = 0, table: Float32Array | null = null;
function prepare(w: World, size: number): Float32Array {
  const h = w.height!;
  if (h === lastRef && w.n === lastN && size === lastSize && table) return table;
  const same = !!lastCopy && w.n === lastN && size === lastSize && lastCopy.length === h.length && lastCopy.every((v, i) => v === h[i]);
  if (!same || !table) {
    const W = w.n * size;
    table = new Float32Array(W * W * 3);
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) shade(w, x, z, px, py, size, table, ((z * size + py) * W + x * size + px) * 3);
    lastCopy = h.slice(); lastN = w.n; lastSize = size;
  }
  lastRef = h;
  return table;
}

// (x, z)＝格；(px, py)＝格裡的像素（0–size−1）。回傳紅、綠、藍各要乘多少
export function reliefShade(w: World, x: number, z: number, px: number, py: number, size: number): Float64Array {
  const t = prepare(w, size), o = ((z * size + py) * w.n * size + x * size + px) * 3;
  out[0] = t[o]; out[1] = t[o + 1]; out[2] = t[o + 2];
  return out;
}
