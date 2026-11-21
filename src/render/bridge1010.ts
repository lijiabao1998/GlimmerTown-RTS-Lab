// R1010 斷橋與木橋的模型（畫進城鎮那一個合併網格，不多任何一次繪製呼叫）。完好的橋照舊是地面貼圖上蓋過河的石板，這裡不畫。
// 斷橋：靠岸那幾格各一截斷掉的橋頭（灰色磚石一塊、上面燒黑的木頭一塊，高低不齊），每格兩塊落在水裡的碎塊（位置照格索引算，不抽亂數）。
// 木橋：每格一塊蓋滿整格的木橋面（舊木頭的褐色，比地面高一點）、靠水的邊一根欄杆、兩個橋頭各兩根柱子。不畫任何徽記。
// 只 import geo.ts 的型別與 sim/world.ts：不 import buildings.ts（tests/walls-view.mjs 用 data: 網址另外載一份 buildings.ts，互相 import 會多出第二份狀態）。
import * as THREE from 'three';
import type { Geo } from './geo.ts';
import { TER_ROAD, type World, type Building } from '../sim/world.ts';

const C = (hex: number) => new THREE.Color(hex);
const STONE = C(0x8a867c), CHAR = C(0x2f2822), DEBRIS = C(0x6d675c), DECK = C(0x7b5b3c), RAIL = C(0x5c4329), POST = C(0x47331f);
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const frac = (c: number, k: number) => ((c * 37 + k * 53) % 61) / 61;   // 照格索引算的 0–1（不抽亂數）

// skip：這一刻先不畫的（海斯 R090 的區域城鎮：外框在鏡頭範圍外就跳過；id 0 不會被當成正在升起的房子）
export function bridge1010Art(g: Geo, w: World, skip?: (b: Building) => boolean): void {
  if (!w.br) return;
  const n = w.n, wet = w.br.wet;
  for (const s of w.br.spans) {
    if (s.state === 0) continue;
    let x0 = n, z0 = n, x1 = 0, z1 = 0;
    for (const c of s.cells) { const x = c % n, z = (c - x) / n; x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, z + 1); }
    if (skip && skip({ id: 0, kind: -1, x: x0, z: z0, w: x1 - x0, d: z1 - z0, floors: 0, hp: 0, maxHp: 0 })) continue;
    for (const c of s.cells) {
      const x = c % n, z = (c - x) / n;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, j = nz * n + nx;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n || s.cells.includes(j)) continue;
        const shore = !wet[j] && w.ter[j] === TER_ROAD && s.cells.includes((z - dz) * n + x - dx), water = !!wet[j];   // 橋頭：順著橋走上岸的那一邊（對面那一格也是這座橋）
        // 那一條邊上的一長條（沿著邊、往格裡面 t 那麼厚）
        const strip = (t: number, y0: number, y1: number, col: THREE.Color, inset = 0) => {
          const ax = dx > 0 ? x + 1 - t : dx < 0 ? x : x + inset, bx = dx > 0 ? x + 1 : dx < 0 ? x + t : x + 1 - inset;
          const az = dz > 0 ? z + 1 - t : dz < 0 ? z : z + inset, bz = dz > 0 ? z + 1 : dz < 0 ? z + t : z + 1 - inset;
          g.box(ax, y0, az, bx, y1, bz, col);
        };
        if (s.state === 1 && shore) {   // 斷掉的橋頭：磚石一塊、上面燒黑的木頭一塊
          const h = 0.07 + 0.05 * frac(c, dx + 2 * dz + 3);
          strip(0.34, -0.04, h, STONE, 0.08);
          strip(0.22 + 0.1 * frac(c, dx - dz + 7), h, h + 0.035, CHAR, 0.18);
        }
        if (s.state === 2 && water) strip(0.06, 0.06, 0.17, RAIL);   // 木橋靠水的邊：欄杆
        if (s.state === 2 && shore) {   // 木橋的橋頭：兩根柱子
          for (const e of [0.04, 0.86]) {
            const px = dx ? (dx > 0 ? x + 0.88 : x + 0.02) : x + e, pz = dz ? (dz > 0 ? z + 0.88 : z + 0.02) : z + e;
            g.box(px, 0, pz, px + 0.1, 0.24, pz + 0.1, POST);
          }
        }
      }
      if (s.state === 1) for (let k = 0; k < 2; k++) {   // 落在水裡的碎塊
        const px = x + 0.15 + 0.55 * frac(c, k), pz = z + 0.15 + 0.55 * frac(c, k + 5), sz = 0.12 + 0.06 * frac(c, k + 9);
        g.box(px, -0.02, pz, px + sz, 0.025 + 0.02 * frac(c, k + 11), pz + sz * 0.7, k ? CHAR : DEBRIS);
      }
      else g.box(x, 0, z, x + 1, 0.06, z + 1, DECK);   // 木橋面：蓋滿整格（修好時地面沒重畫還是泥，讀檔之後是路；蓋滿才兩種一樣）
    }
  }
}
