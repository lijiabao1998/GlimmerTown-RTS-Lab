// R050 三種軍用建築的模型（完好那一段；沒屋頂、瓦礫照通用的畫法：工地就是「沒屋頂」那一段，像搭到一半的骨架）。
// 兵營：長條木造營房，橄欖綠瓦楞屋頂、一排小窗。車廠：磚砌車棚，正面兩個大門洞。補給站：一圈沙包，裡面木箱與蓋帆布的貨堆。不畫任何徽記。
import * as THREE from 'three';
import { BK_BARRACKS, BK_DEPOT, BK_SUPPLY, type Building } from '../sim/world.ts';
import type { Geo } from './geo.ts';

const C = (hex: number) => new THREE.Color(hex);
export const PAL50: Record<number, { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color }> = {
  [BK_BARRACKS]: { wall: C(0x7a6648), roof: C(0x56603f), trim: C(0x3e3427) },   // 刷了焦油的木板、橄欖綠瓦楞鐵、深色木框
  [BK_DEPOT]: { wall: C(0x94604a), roof: C(0x5d6266), trim: C(0x2a2622) },      // 紅磚、灰鐵皮、門洞裡暗
  [BK_SUPPLY]: { wall: C(0xb8a67e), roof: C(0x6b7458), trim: C(0x8a6a44) },     // 沙包、帆布、木箱
};
export const RISE50: Record<number, number> = { [BK_BARRACKS]: 0.2, [BK_DEPOT]: 0.22, [BK_SUPPLY]: 0.12 };
export const isTech50 = (kind: number): boolean => PAL50[kind] !== undefined;
const DARK = C(0x1d1f1d), CRATE = C(0x8a6a44), CRATE_D = C(0x6b5034);

export function tech50Art(g: Geo, b: Building): void {
  const p = PAL50[b.kind], x0 = b.x + 0.1, z0 = b.z + 0.1, x1 = b.x + b.w - 0.1, z1 = b.z + b.d - 0.1;
  if (b.kind === BK_BARRACKS) {   // 長邊沿 x：兩棟並排的營房
    for (const [a0, a1] of [[z0, z0 + 0.8], [z1 - 0.8, z1]] as const) {
      g.box(x0, 0, a0, x1, 0.3, a1, p.wall, null);
      g.gable(x0 - 0.04, a0 - 0.04, x1 + 0.04, a1 + 0.04, 0.3, RISE50[BK_BARRACKS], true, p.roof, p.wall);
      for (let k = 0; k < 4; k++) { const x = x0 + 0.2 + k * 0.42; g.box(x, 0.13, a0 - 0.01, x + 0.14, 0.22, a0, DARK); g.box(x, 0.13, a1, x + 0.14, 0.22, a1 + 0.01, DARK); }   // 一排小窗
      g.box(x0 - 0.01, 0, (a0 + a1) / 2 - 0.08, x0, 0.24, (a0 + a1) / 2 + 0.08, p.trim);   // 山牆的門
    }
    return;
  }
  if (b.kind === BK_DEPOT) {   // 一棟大車棚，門朝 z 小的那一邊
    g.box(x0, 0, z0, x1, 0.46, z1, p.wall, null);
    g.gable(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 0.46, RISE50[BK_DEPOT], true, p.roof, p.wall);
    for (const cx of [x0 + 0.45, x1 - 0.45]) { g.box(cx - 0.32, 0, z0 - 0.012, cx + 0.32, 0.36, z0, DARK); g.box(cx - 0.35, 0.36, z0 - 0.02, cx + 0.35, 0.4, z0, p.trim); }   // 兩個大門洞與門楣
    return;
  }
  // 補給站：一圈沙包（東邊留口），裡面兩堆木箱、一堆蓋帆布的貨
  const t = 0.14, bag = (ax: number, az: number, bx: number, bz: number) => g.box(ax, 0, az, bx, 0.12, bz, p.wall);
  bag(x0, z0, x1, z0 + t); bag(x0, z1 - t, x1, z1); bag(x0, z0 + t, x0 + t, z1 - t);
  bag(x1 - t, z0 + t, x1, (z0 + z1) / 2 - 0.18); bag(x1 - t, (z0 + z1) / 2 + 0.18, x1, z1 - t);
  for (const [cx, cz, n] of [[x0 + 0.45, z0 + 0.45, 3], [x0 + 0.45, z1 - 0.5, 2]] as const) for (let k = 0; k < n; k++) g.box(cx - 0.18 + (k % 2) * 0.2, 0.12 * Math.floor(k / 2), cz - 0.16, cx + 0.0 + (k % 2) * 0.2, 0.12 * Math.floor(k / 2) + 0.12, cz + 0.16, k % 2 ? CRATE_D : CRATE);
  g.box(x1 - 0.95, 0, z0 + 0.35, x1 - 0.3, 0.16, z1 - 0.35, p.trim, null);
  g.gable(x1 - 0.98, z0 + 0.32, x1 - 0.27, z1 - 0.32, 0.16, RISE50[BK_SUPPLY], false, p.roof, p.roof);   // 帆布蓋著的貨堆
}
