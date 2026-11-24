// R1007 沙包的樣子：畫進城鎮那一個網格（buildings.ts 的 buildTown、wearTown 在鐵絲網後面各叫一次），不多任何一次繪製呼叫。
// 四種樣子跟模擬共用 look1007：完好（馬蹄形，三面矮牆兩層）、受損（下層完整、上層只剩正面一段）、工地（正面一層、旁邊兩小堆空沙包）、打散（地上三塊扁的）。
// 開口朝蓋的那一方的後面（第 0 方朝 +z＝朝鏡頭，看得到裡面的人；第 1 方朝 −z）。全部縮在那一格裡（離格邊 0.06），不畫徽記、旗子。
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { look1007, BAG_SCATTERED, BAG_SITE, BAG_DAMAGED } from '../sim/sandbag1007.ts';
import type { World } from '../sim/world.ts';

const SACK = new THREE.Color(0xb8a67e), SEAM = new THREE.Color(0x9c8b63);   // 指揮部、補給站的沙包色；縫的暗色
const IN = 0.06, T = 0.14, H = 0.1, FLAT = 0.04;   // 離格邊、牆厚、每層高、打散的高

export function bag1007Geo(g: Geo, w: World): Geo {
  for (const s of w.bags?.segments ?? []) {
    const look = look1007(s), back = s.builtBy === 1;   // 第 1 方的正面在 +z、開口朝 −z
    const a0 = s.x + IN, span = 1 - 2 * IN;
    // 方塊：u 沿 x（0–span）、v 從正面往後（0–span）、y 從地面往上；第 1 方把 v 鏡像
    const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, c: THREE.Color) => {
      const z0 = back ? s.z + 1 - IN - v1 : s.z + IN + v0, z1 = back ? s.z + 1 - IN - v0 : s.z + IN + v1;
      g.box(a0 + u0, y0, z0, a0 + u1, y1, z1, c);
    };
    const mid = span / 2;
    if (look === BAG_SCATTERED) {
      box(0.08, 0.38, 0.1, 0.3, 0, FLAT, SEAM); box(0.46, 0.8, 0.2, 0.42, 0, FLAT, SACK); box(0.2, 0.5, 0.52, 0.74, 0, FLAT, SACK);
      continue;
    }
    if (look === BAG_SITE) {
      box(0, mid, 0, T, 0, H, SACK); box(mid, span, 0, T, 0, H, SEAM);   // 正面一層
      box(0.06, 0.3, 0.46, 0.66, 0, FLAT, SEAM); box(span - 0.3, span - 0.06, 0.5, 0.72, 0, FLAT, SEAM);   // 兩小堆空沙包
      continue;
    }
    for (let layer = 0; layer < 2; layer++) {
      const y0 = layer * H, y1 = y0 + H, odd = layer === 1;
      if (odd && look === BAG_DAMAGED) { box(span * 0.25, span * 0.75, 0, T, y0, y1, SACK); break; }   // 受損：上層只剩正面中間一段
      const cut = odd ? span * 0.4 : span * 0.6;   // 兩層的縫錯開
      box(0, cut, 0, T, y0, y1, odd ? SEAM : SACK); box(cut, span, 0, T, y0, y1, odd ? SACK : SEAM);   // 正面
      const side = (u0: number, u1: number) => { box(u0, u1, T, T + (span - T) * 0.5, y0, y1, odd ? SACK : SEAM); box(u0, u1, T + (span - T) * 0.5, span, y0, y1, odd ? SEAM : SACK); };
      side(0, T); side(span - T, span);   // 兩側（各兩段）
    }
  }
  return g;
}
