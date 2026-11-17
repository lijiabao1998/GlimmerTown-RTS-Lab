// R088 建築破壞的過程：畫面這一邊的記憶（每個世界一份）——每一棟上一次畫的是哪一段。
// 換段的那一刻冒煙、掉碎片、把高過新牆頂的彈痕拿掉；屋頂塌進去、分兩段倒下用「上一次畫的那一段」的幾何。
// 只讀世界；第一次看到一個世界（開局、讀檔、重播跳步、換世界）時不放效果，直接記下現在的段。
import { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import { STAGE_INTACT, type World, type Building } from '../sim/world.ts';
import { buildingGeo, wallHeight, roofRise, bldColorsOf, wearArtOn } from './buildings.ts';
import { wearTier, wearable, wearTop, roofSlice, splitHalves, WEAR_RUBBLE } from './wearArt.ts';
import type { Ghosts, Pool } from './fx.ts';
import type { WallMarks } from './wallMarks.ts';

const shown = new WeakMap<World, Int8Array>();
const tierOf = (b: Building) => (wearable(b.kind) ? wearTier(b) : 0);
// 畫面上一次畫的那一段（還沒同步過就照現在的耐久）
export function wearShown(w: World, b: Building): number { const s = shown.get(w); return s && b.id <= s.length ? s[b.id - 1] : tierOf(b); }

// 每一步的事件處理完之後叫：換了段就回 true（整鎮要重建）。puff、debris 是 null＝不放效果（?fx=off、?noR004=1）
export function wearSync(w: World, marks: WallMarks, puff: Pool | null, debris: Pool | null, t: number, seen: (x: number, z: number) => boolean): boolean {
  if (!wearArtOn()) return false;
  let s = shown.get(w);
  if (!s || s.length !== w.blds.length) {   // 第一次看到、或多了建築（布陣、指揮部）：新的照現在的段記下，不放效果
    const n = new Int8Array(w.blds.length);
    for (let i = 0; i < n.length; i++) n[i] = s && i < s.length ? s[i] : tierOf(w.blds[i]);
    shown.set(w, s = n);
  }
  let dirty = false;
  for (let i = 0; i < w.blds.length; i++) {
    const b = w.blds[i], t1 = tierOf(b), t0 = s[i];
    if (t1 === t0) continue;
    s[i] = t1; dirty = true;
    if (t1 === WEAR_RUBBLE || t1 < t0) continue;   // 倒成瓦礫的效果是 R004 的；段不會往回（模擬裡耐久只會往下）
    const h = wallHeight(b), rise = roofRise(b.kind);
    if (t1 === 3 || t1 === 5) marks.dropAbove(b.id, (x, z) => wearTop(b, t1, x, z, h, rise));
    if (!puff || !debris || t1 === 4) continue;
    const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
    if (!seen(cx, cz)) continue;
    const col = bldColorsOf(b), c = t1 === 3 ? col.roof.getHex() : col.wall.getHex(), y = t1 === 3 ? h + rise * 0.5 : h * 0.5;
    const H = (k: number) => hash2(b.id * 16 + t1, k, 88);
    for (let k = 0; k < 3; k++) puff.spawn({ x: cx + (H(k) - 0.5) * b.w * 0.6, y, z: cz + (H(k + 3) - 0.5) * b.d * 0.6, vy: 0.35, t0: t + 0.05 * k, life: 1.6 + 0.6 * H(k + 6), s0: 0.1, s1: 0.36, c0: 0x9a8b74, c1: 0xa59c8c });
    for (let k = 0; k < 4; k++) debris.spawn({ x: cx + (H(k + 9) - 0.5) * b.w * 0.7, y, z: cz + (H(k + 13) - 0.5) * b.d * 0.7, vx: (H(k + 17) - 0.5) * 1.2, vz: (H(k + 21) - 0.5) * 1.2, vy: 1 + H(k + 25), g: 9, t0: t, life: 2.2 + H(k + 29), s0: 0.05, s1: 0.03, c0: c });
  }
  return dirty;
}

// 完好 → 空殼：上一次畫的那一段的屋頂（簷以上）變成殘影，1.1 秒內直直往下沉（屋頂高 + 0.35）。閥關著回 false
export function wearRoofFall(w: World, ghosts: Ghosts, b: Building, t: number): boolean {
  if (!wearArtOn() || !wearable(b.kind)) return false;
  const h = wallHeight(b), roof = roofSlice(buildingGeo(new Geo(), b, STAGE_INTACT, wearShown(w, b)), h);
  if (!roof.pos.length) return false;
  ghosts.add(roof, t, roofRise(b.kind) + 0.2, b.x + b.w / 2, b.z + b.d / 2, hash2(b.id, 4, 88), false, 0, 0);
  return true;
}

// → 瓦礫：上一次畫的那一段照三角形中心分兩半，先倒的那一半在 t、另一半晚 0.22 秒；每一半往建築中心外倒。
// 另外 6 團煙、6 塊碎片（R004 的照舊）。閥關著回 false（照 R004 一整棟一個殘影）
export const COLLAPSE_GAP = 0.22;
export function wearCollapse(w: World, ghosts: Ghosts, puff: Pool, debris: Pool, b: Building, from: number, t: number, h: number): boolean {
  if (!wearArtOn() || !wearable(b.kind)) return false;
  const tier = wearShown(w, b), geo = buildingGeo(new Geo(), b, from, tier), wh = wallHeight(b), { first, second } = splitHalves(geo, b, tier, wh);
  const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  const add = (g: Geo, t0: number, k: number) => {
    if (!g.pos.length) return;
    let mx = 0, mz = 0; const n = g.pos.length / 3;
    for (let i = 0; i < g.pos.length; i += 3) { mx += g.pos[i]; mz += g.pos[i + 2]; }
    const dx = mx / n - cx, dz = mz / n - cz, l = Math.hypot(dx, dz), a = hash2(b.id, k, 89) * 6.2832;
    ghosts.add(g, t0, h, cx, cz, hash2(b.id, 3 + k, 77), false, l > 0.05 ? (dx / l) * 0.35 : Math.cos(a) * 0.35, l > 0.05 ? (dz / l) * 0.35 : Math.sin(a) * 0.35);
  };
  add(first, t, 0); add(second, t + COLLAPSE_GAP, 1);
  const col = bldColorsOf(b), H = (k: number) => hash2(b.id, k, 90);
  for (let k = 0; k < 6; k++) {
    puff.spawn({ x: cx + (H(k) - 0.5) * b.w, y: 0.15, z: cz + (H(k + 6) - 0.5) * b.d, vy: 0.5, t0: t + COLLAPSE_GAP + 0.05 * k, life: 2.4 + H(k + 12), s0: 0.2, s1: 0.7, c0: 0x9a8b74, c1: 0x9c9384 });
    debris.spawn({ x: cx + (H(k + 18) - 0.5) * b.w * 0.8, y: wh * 0.6, z: cz + (H(k + 24) - 0.5) * b.d * 0.8, vx: (H(k + 30) - 0.5) * 1.8, vz: (H(k + 36) - 0.5) * 1.8, vy: 1.4 + H(k + 42), g: 9, t0: t + COLLAPSE_GAP, life: 2.6 + H(k + 48), s0: 0.07, s1: 0.04, c0: (k % 2 ? col.roof : col.wall).getHex() });
  }
  return true;
}
