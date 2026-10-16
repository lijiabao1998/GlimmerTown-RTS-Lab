// 村莊建築：每棟照損壞三段畫（完好 → 沒屋頂的空殼 → 瓦礫堆）。只讀世界，不改世界。
// 三段的畫法照 GlimmerTown3D-lab@bece722 src/render/scene.ts:210-231（牆降高、屋頂消失、瓦礫用雜湊散落），改成二戰村莊的配色。
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import {
  stageOf, STAGE_INTACT, STAGE_ROOFLESS, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP,
  type World, type Building,
} from '../sim/world.ts';

export const FLOOR_H = 0.36;   // 一層樓高（格）；3D-lab blockArt.ts 的換算

const C = (hex: number) => new THREE.Color(hex);
const PAL: Record<number, { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color }> = {
  [BK_HOUSE]: { wall: C(0x9a5a44), roof: C(0x4f5660), trim: C(0xe8e0cc) },     // 紅磚、石板瓦
  [BK_COTTAGE]: { wall: C(0xe6dfcc), roof: C(0xa8874e), trim: C(0x5a4632) },   // 白灰牆、茅草頂
  [BK_BARN]: { wall: C(0x6b4a33), roof: C(0x7b7d78), trim: C(0x3d2c20) },      // 木板、鐵皮
  [BK_CHURCH]: { wall: C(0xa9a596), roof: C(0x4a5058), trim: C(0x7d7a6e) },    // 灰石、石板
  [BK_SHOP]: { wall: C(0xd9c9a3), roof: C(0x9c4a33), trim: C(0x3f5a4a) },      // 米色灰泥、紅瓦、綠招牌
};
const GLASS = C(0x2a3038), RUBBLE = [C(0x8a7d6e), C(0x6e6458), C(0x9b8f7f), C(0x5a4f45)], CHAR = C(0x2b2724), BEAM = C(0x4a3626);

export function wallHeight(b: Building): number { return b.floors * FLOOR_H + 0.1; }

function windows(g: Geo, b: Building, x0: number, z0: number, x1: number, z1: number, h: number) {
  const ww = 0.12, wh = 0.13, t = 0.012;
  for (let f = 0; f < b.floors; f++) {
    const y0 = 0.12 + f * FLOOR_H, y1 = y0 + wh;
    if (y1 > h - 0.04) break;
    for (let i = 0; i < b.w; i++) {
      const cx = b.x + i + 0.5;
      g.box(cx - ww / 2, y0, z1, cx + ww / 2, y1, z1 + t, GLASS, null);
      g.box(cx - ww / 2, y0, z0 - t, cx + ww / 2, y1, z0, GLASS, null);
    }
    for (let j = 0; j < b.d; j++) {
      const cz = b.z + j + 0.5;
      g.box(x1, y0, cz - ww / 2, x1 + t, y1, cz + ww / 2, GLASS, null);
      g.box(x0 - t, y0, cz - ww / 2, x0, y1, cz + ww / 2, GLASS, null);
    }
  }
}

function intact(g: Geo, b: Building) {
  const p = PAL[b.kind], m = 0.1, x0 = b.x + m, z0 = b.z + m, x1 = b.x + b.w - m, z1 = b.z + b.d - m;
  if (b.kind === BK_CHURCH) {
    const tw = 0.9, h = wallHeight(b);
    g.box(x0, 0, z0 + tw, x1, h, z1, p.wall, null);                         // 中殿
    g.gable(x0, z0 + tw, x1, z1, h, 0.55, false, p.roof, p.wall);
    g.box(x0, 0, z0, x0 + tw, h + 0.95, z0 + tw, p.wall);                   // 方塔
    g.box(x0 - 0.03, h + 0.95, z0 - 0.03, x0 + tw + 0.03, h + 1.02, z0 + tw + 0.03, p.trim);
    g.pyramid(x0, z0, x0 + tw, z0 + tw, h + 1.02, 0.7, p.roof);
    windows(g, b, x0, z0 + tw, x1, z1, h);
    return;
  }
  const h = wallHeight(b), alongX = b.w >= b.d;
  g.box(x0, 0, z0, x1, h, z1, p.wall, null);
  const rise = b.kind === BK_BARN ? 0.42 : b.kind === BK_SHOP ? 0.22 : 0.32;
  g.gable(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h, rise, alongX, p.roof, p.wall);
  if (b.kind === BK_HOUSE || b.kind === BK_SHOP) {                           // 煙囪
    const cx = alongX ? x1 - 0.18 : (x0 + x1) / 2, cz = alongX ? (z0 + z1) / 2 : z1 - 0.18;
    g.box(cx - 0.05, h, cz - 0.05, cx + 0.05, h + rise + 0.12, cz + 0.05, p.wall);
  }
  if (b.kind === BK_SHOP) g.box(x0, 0.2, z1, x1, 0.28, z1 + 0.03, p.trim, p.trim);   // 店招
  if (b.kind !== BK_BARN) windows(g, b, x0, z0, x1, z1, h);
}

// 沒屋頂：四面薄牆剩七成高，牆頂鋸齒，屋裡焦黑，幾根斷梁
function roofless(g: Geo, b: Building) {
  const p = PAL[b.kind], m = 0.1, t = 0.07, x0 = b.x + m, z0 = b.z + m, x1 = b.x + b.w - m, z1 = b.z + b.d - m;
  const h = wallHeight(b) * 0.72;
  const jag = (k: number) => h * (0.7 + 0.3 * hash2(b.id, k, 7));
  const segs = 3;
  for (let s = 0; s < segs; s++) {
    const a0 = x0 + ((x1 - x0) * s) / segs, a1 = x0 + ((x1 - x0) * (s + 1)) / segs;
    const c0 = z0 + ((z1 - z0) * s) / segs, c1 = z0 + ((z1 - z0) * (s + 1)) / segs;
    g.box(a0, 0, z1 - t, a1, jag(s), z1, p.wall);
    g.box(a0, 0, z0, a1, jag(s + 4), z0 + t, p.wall);
    g.box(x1 - t, 0, c0, x1, jag(s + 8), c1, p.wall);
    g.box(x0, 0, c0, x0 + t, jag(s + 12), c1, p.wall);
  }
  g.box(x0 + t, 0, z0 + t, x1 - t, 0.03, z1 - t, CHAR);
  for (let k = 0; k < 2; k++) {
    const y = 0.05 + 0.08 * k, zz = z0 + (z1 - z0) * (0.3 + 0.4 * hash2(b.id, k, 9));
    g.box(x0 + t, y, zz - 0.025, x1 - t, y + 0.05, zz + 0.025, BEAM);
  }
  windows(g, b, x0, z0, x1, z1, h);
}

function rubble(g: Geo, b: Building) {
  const n = 6 + b.w * b.d * 3;
  for (let k = 0; k < n; k++) {
    const hx = hash2(b.id, k, 1), hz = hash2(b.id, k, 2), hh = hash2(b.id, k, 3), hc = hash2(b.id, k, 4);
    const x = b.x + 0.12 + hx * (b.w - 0.24), z = b.z + 0.12 + hz * (b.d - 0.24), s = 0.08 + hh * 0.12;
    g.box(x - s, 0, z - s * 0.8, x + s, 0.05 + hh * 0.12, z + s * 0.8, RUBBLE[Math.floor(hc * RUBBLE.length)]);
  }
  if (b.kind === BK_CHURCH) g.box(b.x + 0.1, 0, b.z + 0.1, b.x + 0.9, 0.55, b.z + 0.9, PAL[b.kind].wall);   // 塔基還站著
}

export function buildTown(w: World): Geo {
  const g = new Geo();
  for (const b of w.blds) {
    const s = stageOf(b);
    if (s === STAGE_INTACT) intact(g, b); else if (s === STAGE_ROOFLESS) roofless(g, b); else rubble(g, b);
  }
  return g;
}

// 冒煙點：沒屋頂的房子從屋裡冒煙（渲染端的效果用）
export function smokeSources(w: World): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const b of w.blds) if (stageOf(b) === STAGE_ROOFLESS) out.push([b.x + b.w / 2, wallHeight(b) * 0.5, b.z + b.d / 2]);
  return out;
}
