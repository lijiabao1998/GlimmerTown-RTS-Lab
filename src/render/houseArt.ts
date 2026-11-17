// R086 房屋細化：每棟自己的樣子（牆色、屋頂色、屋頂形式、門、第二支煙囪、門罩、店的配色、穀倉門開關），
// 與新加的零件（煙囪與煙囪管、牆腳、簷下陰影帶、門罩、上下拉窗、店面與遮陽棚、穀倉大門與乾草口、茅草屋脊帶、教堂的尖拱窗與扶壁）。
// 只給 buildings.ts 叫（它照開關決定要不要叫這裡）；這一支不匯入 buildings.ts、不碰世界、不碰亂數：樣式只用 hash2(b.id, k, 86)。
// 時代考證：萊伊是 1940 年的英格蘭東南——不加百葉窗；門罩、塗焦油的穀倉、石板與陶瓦屋頂。沒有字、沒有商標、沒有任何徽記。
// 鏡頭固定從 +x、+z 看（battle.ts 的鏡頭方向）：新零件只畫在看得到的兩面（+x、+z）。
import * as THREE from 'three';
import type { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import { BK_HOUSE, BK_COTTAGE, BK_BARN, BK_SHOP, type Building } from '../sim/world.ts';

export type RGB = [number, number, number];
export const rgbOf = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const hexOf = (c: RGB): number => (c[0] << 16) | (c[1] << 8) | c[2];
const lim = (v: number): number => Math.max(30, Math.min(235, Math.round(v)));
const mul = (c: RGB, k: RGB): RGB => [lim(c[0] * k[0]), lim(c[1] * k[1]), lim(c[2] * k[2])];
const lerp = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
export const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const rgbDist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const color = (c: RGB): THREE.Color => new THREE.Color(hexOf(c));
const srgb = (c: THREE.Color): RGB => rgbOf(c.getHex());
const h86 = (b: Building, k: number): number => hash2(b.id, k, 86);

export const ROOF_GABLE = 0, ROOF_HIP = 1, ROOF_HALF = 2;
// 牆色的變化（乘在原本那一種的牆色上）：磚——原色、淺、深；穀倉——原木、雜酚油、焦油黑
const BRICK_VARIANTS: RGB[] = [[1, 1, 1], [1.19, 1.2, 1.16], [0.86, 0.63, 0.67]];
const BARN_VARIANTS: RGB[] = [[1, 1, 1], [0.716, 0.717, 0.691], [0.388, 0.485, 0.647]];
const PLASTERS = [0xe8dec4, 0xd6c4a0].map(rgbOf);
// 屋頂：照種類的一串，從雜湊挑的那一個往後找，直到跟牆的亮度差 ≥ 18
const ROOFS: Record<number, RGB[]> = {
  [BK_HOUSE]: [0x4f5660, 0x3b4049, 0x8a4e3a, 0x767c84].map(rgbOf),   // 石板、深石板、陶瓦、淺石板
  [BK_COTTAGE]: [0xa8874e, 0x8b7b5e, 0x6f6a52, 0x8a4e3a].map(rgbOf), // 茅草、舊茅草、更舊的、陶瓦
  [BK_SHOP]: [0x9c4a33, 0x4f5660, 0x767c84, 0x3b4049].map(rgbOf),    // 陶瓦、石板、淺石板、深石板（二樓掛瓦的店要跟磚牆、掛瓦都差夠）
  [BK_BARN]: [0x7b7d78, 0x7e4a30, 0xa3a29a].map(rgbOf),              // 鍍鋅鐵皮、鏽、纖維水泥
};
const DOORS = [0x5a3e2a, 0x2f4a3b, 0x6e2b25, 0x2a2826, 0x2e3a50].map(rgbOf);
const LIVERIES = [0x3f5a4a, 0x6a2622, 0x2e3a50, 0x4a3328].map(rgbOf);
const AWNINGS: [RGB, RGB][] = [[rgbOf(0xa2493e), rgbOf(0xd9cfb8)], [rgbOf(0x4e6b4e), rgbOf(0xd9cfb8)], [rgbOf(0x9a7a48), rgbOf(0xd9cfb8)], [rgbOf(0xb5a47e), rgbOf(0x5e5240)]];
const TILE_HUNG = rgbOf(0xa3533a);   // R028 掛瓦（buildings.ts 的 TILE）
const DARK = rgbOf(0x2c2b29), POT = rgbOf(0x8a4a35), SOOT = rgbOf(0x2e2824), VOID = rgbOf(0x1e1c1a), OAK = rgbOf(0x7a7265), OAK_DARK = rgbOf(0x5a5448), BARN_PLINTH = rgbOf(0x8e4b37), PLASTER_PLINTH = rgbOf(0x77736b);
export const ART_FIXED = { DARK, POT, SOOT, VOID, OAK };   // 守衛拿來檢查顏色規則（玻璃、門洞、煙灰不受 30–235 的限制）

export interface Look {
  wall: THREE.Color; roof: THREE.Color; trim: THREE.Color;   // 跟 buildings.ts 的 palette 同形（碎片、彈痕、損壞階段照它）
  plaster: THREE.Color;                                      // 木構灰泥牆（R028 木構的牆面）
  door: THREE.Color; form: number; stack2: boolean; hood: boolean; open: boolean;
  livery: THREE.Color; awning: [THREE.Color, THREE.Color];
  sig: string;                                               // 守衛數樣式用
}
export const civilian = (kind: number): boolean => kind === BK_HOUSE || kind === BK_COTTAGE || kind === BK_BARN || kind === BK_SHOP;
const pick = <T>(list: T[], h: number): number => Math.min(list.length - 1, Math.floor(h * list.length));
// 從第 i 個往後找第一個合格的（都不合格就用第 i 個）
const stepTo = <T>(list: T[], i: number, ok: (x: T) => boolean): T => { for (let k = 0; k < list.length; k++) { const x = list[(i + k) % list.length]; if (ok(x)) return x; } return list[i]; };

// 屋頂形式能不能用：四坡只給短邊 1 格、不是方的；半四坡不給 1×1、短邊 ≤ 2——格子中心的屋頂高度不變（守軍標記、點選照舊）
export function formAllowed(b: Building, form: number): boolean {
  const lo = Math.min(b.w, b.d), hi = Math.max(b.w, b.d);
  if (form === ROOF_HIP) return lo === 1 && hi > 1;
  if (form === ROOF_HALF) return hi > 1 && lo <= 2;
  return true;
}
function roofForm(b: Building): number {
  const h = h86(b, 2), want = b.kind === BK_HOUSE ? (h < 0.55 ? ROOF_GABLE : h < 0.8 ? ROOF_HIP : ROOF_HALF)
    : b.kind === BK_COTTAGE ? (h < 0.45 ? ROOF_GABLE : h < 0.6 ? ROOF_HIP : ROOF_HALF)
      : b.kind === BK_BARN ? (h < 0.7 ? ROOF_GABLE : ROOF_HALF) : ROOF_GABLE;
  if (formAllowed(b, want)) return want;
  return want === ROOF_HIP && formAllowed(b, ROOF_HALF) ? ROOF_HALF : ROOF_GABLE;
}

// 一棟的樣子。base＝那一種原本的配色（R105 材質之後）；timber＝外牆是 R028 木構（看得到的牆是灰泥）
// hung＝二樓以上是 R028 掛瓦（屋簷下看得到的是掛瓦）：屋頂也要跟掛瓦差夠（審查 G4）
export function houseLook(b: Building, base: { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color }, timber: boolean, plaster: THREE.Color, hung = false): Look {
  const w0 = srgb(base.wall), h0 = h86(b, 0);
  const wall: RGB = b.kind === BK_BARN ? mul(w0, BARN_VARIANTS[h0 < 0.5 ? 0 : h0 < 0.75 ? 1 : 2]) : civilian(b.kind) ? mul(w0, BRICK_VARIANTS[h0 < 0.5 ? 0 : h0 < 0.75 ? 1 : 2]) : w0;
  const pl: RGB = timber ? PLASTERS[h86(b, 11) < 0.6 ? 0 : 1] : srgb(plaster);
  const seen = timber ? pl : wall;
  const roofs = ROOFS[b.kind], roof = roofs ? stepTo(roofs, pick(roofs, h86(b, 1)), r => Math.abs(luma(r) - luma(seen)) >= 18 && (!hung || (Math.abs(luma(r) - luma(TILE_HUNG)) >= 18 && rgbDist(r, TILE_HUNG) >= 45))) : srgb(base.roof);
  const li = pick(LIVERIES, h86(b, 7)), aw = AWNINGS[pick(AWNINGS, h86(b, 10))];
  const door = stepTo(DOORS, pick(DOORS, h86(b, 4)), d => rgbDist(d, seen) >= 45 && (b.kind !== BK_SHOP || rgbDist(d, LIVERIES[li]) >= 45));   // 店：門也要跟招牌、門框（店的配色）差夠（審查 G7）
  const form = roofForm(b);
  return {
    wall: color(wall), roof: color(roof), trim: b.kind === BK_SHOP ? color(LIVERIES[li]) : base.trim, plaster: color(pl),
    door: color(door), form, stack2: b.kind === BK_HOUSE && Math.max(b.w, b.d) >= 2 && h86(b, 3) < 0.6,
    hood: (b.kind === BK_HOUSE || b.kind === BK_COTTAGE) && h86(b, 5) < 0.5, open: h86(b, 8) < 0.5,
    livery: color(LIVERIES[li]), awning: [color(aw[0]), color(aw[1])],
    sig: [b.kind, timber ? 1 : 0, hexOf(seen), hexOf(roof), form].join('/'),
  };
}

// ---- 零件 ----
// 一棟房子在畫面上的框：牆面四邊、簷高、屋脊高、屋脊方向（alongX＝屋脊沿 x）
export interface Frame { x0: number; z0: number; x1: number; z1: number; h: number; rise: number; alongX: boolean }
const OVER = 0.04;   // 屋簷外伸（跟 buildings.ts 一樣）
// 屋脊兩端（沿屋脊那一軸的座標）：雙坡到兩頭、四坡內縮半個跨度、半四坡內縮 0.4 個半跨度
export function ridgeEnds(f: Frame, form: number): [number, number] {
  const a0 = (f.alongX ? f.x0 : f.z0) - OVER, a1 = (f.alongX ? f.x1 : f.z1) + OVER;
  const r = ((f.alongX ? f.z1 - f.z0 : f.x1 - f.x0) + 2 * OVER) / 2, c = form === ROOF_HIP ? r : form === ROOF_HALF ? 0.4 * r : 0;
  if (a1 - a0 < 2 * c) { const m = (a0 + a1) / 2; return [m, m]; }
  return [a0 + c, a1 - c];
}
export function roof(g: Geo, f: Frame, form: number, roofC: THREE.Color, wallC: THREE.Color): void {
  const x0 = f.x0 - OVER, z0 = f.z0 - OVER, x1 = f.x1 + OVER, z1 = f.z1 + OVER;
  if (form === ROOF_HIP) g.hip(x0, z0, x1, z1, f.h, f.rise, f.alongX, roofC);
  else if (form === ROOF_HALF) g.halfHip(x0, z0, x1, z1, f.h, f.rise, f.alongX, roofC, wallC);
  else g.gable(x0, z0, x1, z1, f.h, f.rise, f.alongX, roofC, wallC);
}
// 屋脊壓條（R134 的那一條，照真的屋脊長度）
export function ridgeCap(g: Geo, f: Frame, form: number, c: THREE.Color): void {
  const [r0, r1] = ridgeEnds(f, form), y = f.h + f.rise, cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
  const a = Math.max(r0, f.alongX ? f.x0 : f.z0) - 0.025, b = Math.min(r1, f.alongX ? f.x1 : f.z1) + 0.025;   // 雙坡：跟 R134 一樣停在牆外 0.025（不凸出山牆尖；審查 G3）
  if (f.alongX) g.box(a, y - 0.015, cz - 0.025, b, y + 0.025, cz + 0.025, c);
  else g.box(cx - 0.025, y - 0.015, a, cx + 0.025, y + 0.025, b, c);
}
// 煙囪：0.10 見方，從簷高到屋脊上 0.12；壓頂 0.13 見方；兩支陶土煙囪管（頂面是煙灰）
export function stack(g: Geo, f: Frame, at: number, body: THREE.Color, cap: THREE.Color): void {
  const cx = f.alongX ? at : (f.x0 + f.x1) / 2, cz = f.alongX ? (f.z0 + f.z1) / 2 : at, top = f.h + f.rise + 0.12;
  g.box(cx - 0.05, f.h, cz - 0.05, cx + 0.05, top - 0.02, cz + 0.05, body);
  g.box(cx - 0.065, top - 0.02, cz - 0.065, cx + 0.065, top + 0.025, cz + 0.065, cap);
  for (const s of [-1, 1]) {
    const px = f.alongX ? cx + s * 0.03 : cx, pz = f.alongX ? cz : cz + s * 0.03;
    g.box(px - 0.0175, top + 0.025, pz - 0.0175, px + 0.0175, top + 0.075, pz + 0.0175, color(POT), color(SOOT));
  }
}
// 煙囪的位置（沿屋脊那一軸）：靠近那一頭的山牆，但要在屋脊上至少 0.12（四坡、半四坡的屋脊比較短）
export function stackAt(f: Frame, form: number, end: 0 | 1, inset: number): number {
  const [r0, r1] = ridgeEnds(f, form), lo = (f.alongX ? f.x0 : f.z0) + inset, hi = (f.alongX ? f.x1 : f.z1) - inset;
  return end ? Math.min(hi, r1 - 0.12) : Math.max(lo, r0 + 0.12);
}
// 看得到的兩面（+z、+x）的牆腳：0.07 高、凸出 0.005（在彈痕貼花後面）
export function plinth(g: Geo, f: Frame, c: THREE.Color): void {
  g.quad([f.x0, 0, f.z1 + 0.005], [f.x1, 0, f.z1 + 0.005], [f.x1, 0.07, f.z1 + 0.005], [f.x0, 0.07, f.z1 + 0.005], [0, 0, 1], c);
  g.quad([f.x1 + 0.005, 0, f.z0], [f.x1 + 0.005, 0, f.z1], [f.x1 + 0.005, 0.07, f.z1], [f.x1 + 0.005, 0.07, f.z0], [1, 0, 0], c);
}
export const plinthColor = (wall: THREE.Color, kind: number, timber: boolean): THREE.Color => color(kind === BK_BARN ? BARN_PLINTH : timber ? PLASTER_PLINTH : lerp(srgb(wall), DARK, 0.45));
// 簷下的陰影帶：看得到的那一邊屋簷下 0.05 高、凸出 0.012
export function eaveBand(g: Geo, f: Frame, wall: THREE.Color): void {
  const c = color(lerp(srgb(wall), DARK, 0.6)), y0 = f.h - 0.085, y1 = f.h - 0.035;
  if (f.alongX) g.quad([f.x0, y0, f.z1 + 0.012], [f.x1, y0, f.z1 + 0.012], [f.x1, y1, f.z1 + 0.012], [f.x0, y1, f.z1 + 0.012], [0, 0, 1], c);
  else g.quad([f.x1 + 0.012, y0, f.z0], [f.x1 + 0.012, y0, f.z1], [f.x1 + 0.012, y1, f.z1], [f.x1 + 0.012, y1, f.z0], [1, 0, 0], c);
}
// 門罩：門上方一片斜的平板（有底面，投得出影子），寬 0.30、深 0.085
export function hood(g: Geo, cx: number, z1: number, c: THREE.Color): void {
  const a = cx - 0.15, b = cx + 0.15, zf = z1 + 0.085, under = color(lerp(srgb(c), DARK, 0.5));
  g.face4([a, 0.355, z1], [b, 0.355, z1], [b, 0.325, zf], [a, 0.325, zf], [0, 1, 0.3], c);
  g.quad([a, 0.295, zf], [b, 0.295, zf], [b, 0.325, zf], [a, 0.325, zf], [0, 0, 1], c);
  g.quad([a, 0.295, z1], [b, 0.295, z1], [b, 0.295, zf], [a, 0.295, zf], [0, -1, 0], under);
  g.face4([b, 0.295, z1], [b, 0.355, z1], [b, 0.325, zf], [b, 0.295, zf], [1, 0, 0], c);
}
// 窗：只畫看得到的兩面（+z、+x）。sash＝上下拉窗（直長；住宅、商店）；否則是 R134 的方窗（小屋）。
// skipFront0：一樓正面不畫（商店的展示窗在那裡）
export function windows(g: Geo, b: Building, f: Frame, trim: THREE.Color, glass: THREE.Color, sash: boolean, skipFront0: boolean): void {
  const faces: [number, number, number, number][] = [[0, f.x0, f.x1, f.z1], [1, f.z0, f.z1, f.x1]];
  const cx = (f.x0 + f.x1) / 2;
  for (const [axis, start, end, at] of faces) {
    const pane = (a: number, c: number, lo: number, hi: number, col: THREE.Color, off: number) => {
      const p = at + off;
      if (axis === 0) g.quad([a, lo, p], [c, lo, p], [c, hi, p], [a, hi, p], [0, 0, 1], col);
      else g.quad([p, lo, a], [p, lo, c], [p, hi, c], [p, hi, a], [1, 0, 0], col);
    };
    for (let fl = 0; fl < b.floors; fl++) for (let k = Math.floor(start); k < end; k++) {
      const c = k + 0.5, y = 0.12 + fl * 0.36;
      if (c - 0.1 < start || c + 0.1 > end) continue;
      if (!axis && fl === 0 && (skipFront0 || Math.abs(c - cx) < 0.18)) continue;   // 正面一樓中間是門
      if (sash) {
        // 每一條框、橫框、窗台都至少 0.03 格（細過這個在畫面上不到一個像素、會閃；審查 G6）
        if (y + 0.2 > f.h - 0.09) continue;
        pane(c - 0.09, c + 0.09, y - 0.03, y + 0.2, trim, 0.015);
        pane(c - 0.06, c + 0.06, y, y + 0.17, glass, 0.017);
        pane(c - 0.06, c + 0.06, y + 0.07, y + 0.1, trim, 0.019);     // 上下兩扇中間的橫框
        pane(c - 0.1, c + 0.1, y - 0.06, y - 0.03, trim, 0.022);      // 窗台
      } else {   // 小屋的方窗：十字框
        if (y + 0.16 > f.h - 0.025) continue;
        pane(c - 0.09, c + 0.09, y - 0.03, y + 0.16, trim, 0.015);
        pane(c - 0.06, c + 0.06, y, y + 0.13, glass, 0.017);
        pane(c - 0.015, c + 0.015, y, y + 0.13, trim, 0.019);
        pane(c - 0.06, c + 0.06, y + 0.05, y + 0.08, trim, 0.019);
        pane(c - 0.1, c + 0.1, y - 0.06, y - 0.03, trim, 0.022);
      }
    }
  }
}
// 店面：門兩邊各一面展示窗、招牌（店的配色）、條紋帆布遮陽棚（有垂邊、側板、底面）
export function shopFront(g: Geo, f: Frame, look: Look, glass: THREE.Color): void {
  const cx = (f.x0 + f.x1) / 2, z = f.z1, half = 0.17;
  for (const [a, b] of [[f.x0 + 0.06, cx - half - 0.04], [cx + half + 0.04, f.x1 - 0.06]]) {
    if (b - a < 0.06) continue;
    g.quad([a - 0.03, 0.03, z + 0.015], [b + 0.03, 0.03, z + 0.015], [b + 0.03, 0.2, z + 0.015], [a - 0.03, 0.2, z + 0.015], [0, 0, 1], look.livery);
    g.quad([a, 0.06, z + 0.018], [b, 0.06, z + 0.018], [b, 0.17, z + 0.018], [a, 0.17, z + 0.018], [0, 0, 1], glass);
  }
  g.box(f.x0, 0.2, z, f.x1, 0.28, z + 0.03, look.livery, look.livery);   // 招牌（原本的位置、沒有字）
  const n = Math.max(3, Math.round((f.x1 - f.x0) / 0.28)), zb = z + 0.03, zf = z + 0.095;
  for (let i = 0; i < n; i++) {
    const a = f.x0 + (f.x1 - f.x0) * i / n, b = f.x0 + (f.x1 - f.x0) * (i + 1) / n, c = look.awning[i % 2];
    g.face4([a, 0.4, zb], [b, 0.4, zb], [b, 0.36, zf], [a, 0.36, zf], [0, 1, 0.6], c);
    g.quad([a, 0.325, zf], [b, 0.325, zf], [b, 0.36, zf], [a, 0.36, zf], [0, 0, 1], c);
  }
  g.face4([f.x1, 0.4, zb], [f.x1, 0.36, zf], [f.x1, 0.325, zf], [f.x1, 0.36, zb], [1, 0, 0], look.awning[(n - 1) % 2]);
  g.quad([f.x0, 0.36, zb], [f.x1, 0.36, zb], [f.x1, 0.325, zf], [f.x0, 0.325, zf], [0, -1, 0], color(lerp(srgb(look.awning[0]), DARK, 0.5)));
}
// 穀倉：0.32 高的大車門（一半開著＝門洞＋兩片往外摺的門板；一半關著＝木板門＋中縫）、門框跟牆至少差 40、看得到的山牆上的乾草口
export function barnDoor(g: Geo, f: Frame, look: Look): void {
  const cx = (f.x0 + f.x1) / 2, z = f.z1, a = cx - 0.2, b = cx + 0.2, wall = srgb(look.wall);
  const frame = rgbDist(srgb(look.trim), wall) >= 40 ? look.trim : color(OAK);
  g.quad([a - 0.03, 0, z + 0.012], [b + 0.03, 0, z + 0.012], [b + 0.03, 0.35, z + 0.012], [a - 0.03, 0.35, z + 0.012], [0, 0, 1], frame);
  if (look.open) {
    g.quad([a, 0, z + 0.015], [b, 0, z + 0.015], [b, 0.32, z + 0.015], [a, 0.32, z + 0.015], [0, 0, 1], color(VOID));
    for (const [p, q] of [[a - 0.2, a - 0.03], [b + 0.03, b + 0.2]]) if (p >= f.x0 && q <= f.x1) g.quad([p, 0, z + 0.012], [q, 0, z + 0.012], [q, 0.32, z + 0.012], [p, 0.32, z + 0.012], [0, 0, 1], color(OAK));
  } else {
    const leaf = frame === look.trim ? color(OAK) : color(OAK_DARK);   // 門框退回橡木色時（焦油黑的穀倉）門板用深一點的木色，看得出框與門（審查 G5）
    g.quad([a, 0, z + 0.015], [b, 0, z + 0.015], [b, 0.32, z + 0.015], [a, 0.32, z + 0.015], [0, 0, 1], leaf);
    g.quad([cx - 0.015, 0, z + 0.018], [cx + 0.015, 0, z + 0.018], [cx + 0.015, 0.32, z + 0.018], [cx - 0.015, 0.32, z + 0.018], [0, 0, 1], color(VOID));   // 中縫
  }
}
export function loft(g: Geo, f: Frame): void {
  const y0 = f.h + 0.03, y1 = f.h + 0.19, s = 0.08;
  // 山牆三角形（或半四坡的梯形山牆）畫在屋簷外伸那一層：乾草口要在它前面（審查 G1）
  if (f.alongX) { const zc = (f.z0 + f.z1) / 2, x = f.x1 + OVER + 0.006; g.quad([x, y0, zc - s], [x, y0, zc + s], [x, y1, zc + s], [x, y1, zc - s], [1, 0, 0], color(VOID)); }
  else { const xc = (f.x0 + f.x1) / 2, z = f.z1 + OVER + 0.006; g.quad([xc - s, y0, z], [xc + s, y0, z], [xc + s, y1, z], [xc - s, y1, z], [0, 0, 1], color(VOID)); }
}
// 茅草屋脊帶：沿屋脊、看得到的那一坡往下 0.1，顏色是屋頂的七成；浮在坡面上 0.004（在 R134 屋脊壓條下面）
export function thatchBand(g: Geo, f: Frame, form: number, roofC: THREE.Color): void {
  const [a, b] = ridgeEnds(f, form), c = color(srgb(roofC).map(v => Math.max(30, Math.round(v * 0.7))) as RGB);
  const half = ((f.alongX ? f.z1 - f.z0 : f.x1 - f.x0) + 2 * OVER) / 2, len = Math.hypot(half, f.rise), du = 0.1 * half / len, dy = 0.1 * f.rise / len, top = f.h + f.rise + 0.004;
  if (b - a < 0.05) return;
  const m = f.alongX ? (f.z0 + f.z1) / 2 : (f.x0 + f.x1) / 2;
  const s = 1;   // 只畫鏡頭看得到的那一坡（+z 或 +x；背面那一坡被屋脊擋住，審查 G9）
  if (f.alongX) g.face4([a, top, m], [b, top, m], [b, top - dy, m + s * du], [a, top - dy, m + s * du], [0, 1, s], c);
  else g.face4([m, top, a], [m, top, b], [m + s * du, top - dy, b], [m + s * du, top - dy, a], [s, 1, 0], c);
}
// ---- 教堂（長寬都 ≥ 2 格）：中殿 +x 那面的尖拱窗與扶壁、+z 山牆的拱門與圓窗、塔上兩面鐘樓開口、石牆腳 ----
export function churchDetails(g: Geo, nave: Frame, tower: { x0: number; z0: number; x1: number; z1: number; h: number }, stone: THREE.Color, trim: THREE.Color, glass: THREE.Color): void {
  const x = nave.x1, void_ = color(VOID), len = nave.z1 - nave.z0, bays = Math.max(2, Math.round(len / 0.6));
  for (let i = 0; i < bays; i++) {   // 尖拱窗：玻璃 0.07 × 0.30、尖頂、石框
    const zc = nave.z0 + len * (i + 0.5) / bays, y0 = 0.1, y1 = Math.min(0.4, nave.h - 0.12);
    g.quad([x + 0.012, y0 - 0.03, zc - 0.065], [x + 0.012, y0 - 0.03, zc + 0.065], [x + 0.012, y1, zc + 0.065], [x + 0.012, y1, zc - 0.065], [1, 0, 0], trim);
    g.face3([x + 0.012, y1, zc - 0.065], [x + 0.012, y1, zc + 0.065], [x + 0.012, y1 + 0.085, zc], [1, 0, 0], trim);
    g.quad([x + 0.015, y0, zc - 0.035], [x + 0.015, y0, zc + 0.035], [x + 0.015, y1, zc + 0.035], [x + 0.015, y1, zc - 0.035], [1, 0, 0], glass);
    g.face3([x + 0.015, y1, zc - 0.035], [x + 0.015, y1, zc + 0.035], [x + 0.015, y1 + 0.045, zc], [1, 0, 0], glass);
  }
  for (let i = 0; i <= bays; i++) {   // 扶壁：在每一跨的分界，0.08 寬、凸出 0.065、高 0.62 的牆高，頂斜
    const zc = nave.z0 + len * i / bays, z0 = Math.max(nave.z0, zc - 0.04), z1 = Math.min(nave.z1, zc + 0.04), top = nave.h * 0.62, out = x + 0.065;
    g.quad([out, 0, z0], [out, 0, z1], [out, top - 0.06, z1], [out, top - 0.06, z0], [1, 0, 0], stone);
    g.face4([x, top, z0], [x, top, z1], [out, top - 0.06, z1], [out, top - 0.06, z0], [1, 1, 0], trim);
    g.quad([x, 0, z1], [out, 0, z1], [out, top - 0.06, z1], [x, top, z1], [0, 0, 1], stone);
  }
  const cx = (nave.x0 + nave.x1) / 2, z = nave.z1;   // 正面山牆：拱門 0.2 × 0.3（尖頂）、上面一個 0.18 的圓窗
  g.quad([cx - 0.13, 0, z + 0.012], [cx + 0.13, 0, z + 0.012], [cx + 0.13, 0.3, z + 0.012], [cx - 0.13, 0.3, z + 0.012], [0, 0, 1], trim);
  g.face3([cx - 0.13, 0.3, z + 0.012], [cx + 0.13, 0.3, z + 0.012], [cx, 0.4, z + 0.012], [0, 0, 1], trim);
  g.quad([cx - 0.1, 0, z + 0.015], [cx + 0.1, 0, z + 0.015], [cx + 0.1, 0.27, z + 0.015], [cx - 0.1, 0.27, z + 0.015], [0, 0, 1], void_);
  g.face3([cx - 0.1, 0.27, z + 0.015], [cx + 0.1, 0.27, z + 0.015], [cx, 0.35, z + 0.015], [0, 0, 1], void_);
  const ry = nave.h + 0.16;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, b = (k + 1) * Math.PI / 4;
    g.face3([cx, ry, z + 0.012], [cx + Math.cos(a) * 0.12, ry + Math.sin(a) * 0.12, z + 0.012], [cx + Math.cos(b) * 0.12, ry + Math.sin(b) * 0.12, z + 0.012], [0, 0, 1], trim);
    g.face3([cx, ry, z + 0.015], [cx + Math.cos(a) * 0.09, ry + Math.sin(a) * 0.09, z + 0.015], [cx + Math.cos(b) * 0.09, ry + Math.sin(b) * 0.09, z + 0.015], [0, 0, 1], glass);
  }
  const t = tower, y0 = t.h + 0.59, y1 = t.h + 0.82;   // 鐘樓開口：+x、+z 兩面
  const tx = (t.x0 + t.x1) / 2, tz = (t.z0 + t.z1) / 2;
  g.quad([t.x1 + 0.01, y0, tz - 0.1], [t.x1 + 0.01, y0, tz + 0.1], [t.x1 + 0.01, y1, tz + 0.1], [t.x1 + 0.01, y1, tz - 0.1], [1, 0, 0], void_);
  g.face3([t.x1 + 0.01, y1, tz - 0.1], [t.x1 + 0.01, y1, tz + 0.1], [t.x1 + 0.01, y1 + 0.05, tz], [1, 0, 0], void_);
  g.quad([tx - 0.1, y0, t.z1 + 0.01], [tx + 0.1, y0, t.z1 + 0.01], [tx + 0.1, y1, t.z1 + 0.01], [tx - 0.1, y1, t.z1 + 0.01], [0, 0, 1], void_);
  g.face3([tx - 0.1, y1, t.z1 + 0.01], [tx + 0.1, y1, t.z1 + 0.01], [tx, y1 + 0.05, t.z1 + 0.01], [0, 0, 1], void_);
}
