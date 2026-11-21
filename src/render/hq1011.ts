// R1011 指揮部升級的樣子（只在完好那一段畫：buildings.ts 的 hq() 最後一行接過來；沒屋頂、瓦礫照通用的畫法——屋頂掀了，加高的沙包和電線桿也不見了，正好對上「斷線」）。
// 第 1 級（沙包加固）：沙包圈的北、南、西三面再疊一層顏色深一點的濕沙包、小屋腳下一圈矮沙包、東邊開口外面擋一道短牆（門擋）。
// 第 2 級（電話交換台）：小屋西北角一根電線桿（帶橫擔）、一條從桿頂拉到小屋的電線、小屋東邊一捲電纜盤。
// 每座第 1 級 5 個方塊（50 個三角形）、第 2 級再 3 個方塊加一條電線（30 個）；不畫任何徽記、字、旗上的圖案。
import * as THREE from 'three';
import type { Building } from '../sim/world.ts';
import type { Geo } from './geo.ts';

const C = (hex: number) => new THREE.Color(hex);
const WET = C(0x9c8a63), POLE = C(0x4a3b2a), WIRE = C(0x1e1f1d), DRUM = C(0x5d4a33);

export function hq1011Art(g: Geo, b: Building): void {
  const x0 = b.x + 0.12, z0 = b.z + 0.12, x1 = b.x + b.w - 0.12, z1 = b.z + b.d - 0.12, t = 0.14, mz = (z0 + z1) / 2;   // 跟 hq() 的沙包圈同一圈
  const hx0 = b.x + 0.55, hz0 = b.z + 0.5, hx1 = b.x + b.w - 0.55, hz1 = b.z + b.d - 0.75;                                  // 跟 hq() 的小屋同一棟
  g.box(x0, 0.13, z0, x1, 0.23, z0 + t, WET);                       // 北面加高一層
  g.box(x0, 0.13, z1 - t, x1, 0.23, z1, WET);                       // 南面
  g.box(x0, 0.13, z0 + t, x0 + t, 0.23, z1 - t, WET);               // 西面
  g.box(x1 + 0.02, 0, mz - 0.24, x1 + 0.11, 0.18, mz + 0.24, WET);  // 東邊開口外面的門擋
  g.box(hx0 - 0.05, 0, hz0 - 0.05, hx1 + 0.05, 0.09, hz1 + 0.05, WET);   // 小屋腳下一圈矮沙包（頂面在小屋裡看不到，只露出外面那一圈）
  if ((b.hqLv ?? 0) < 2) return;
  const px = b.x + 0.34, pz = b.z + 0.36;
  g.box(px, 0, pz, px + 0.04, 0.8, pz + 0.04, POLE, null);          // 電線桿
  g.box(px - 0.1, 0.72, pz + 0.005, px + 0.14, 0.75, pz + 0.035, POLE);   // 橫擔
  g.quad([px + 0.02, 0.74, pz + 0.012], [px + 0.02, 0.74, pz + 0.028], [hx0 + 0.12, 0.42, hz0 + 0.13], [hx0 + 0.12, 0.42, hz0 + 0.11], [0, 1, 0], WIRE);   // 桿頂拉到小屋的電線
  g.box(hx1 + 0.06, 0, hz1 - 0.1, hx1 + 0.2, 0.1, hz1 + 0.06, DRUM);    // 電纜盤
}
