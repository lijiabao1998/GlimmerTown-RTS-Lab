// 村莊建築：每棟照損壞三段畫（完好 → 沒屋頂的空殼 → 瓦礫堆）。只讀世界，不改世界。
// 三段的畫法照 GlimmerTown3D-lab@bece722 src/render/scene.ts:210-231（牆降高、屋頂消失、瓦礫用雜湊散落），改成二戰村莊的配色。
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import {
  stageOf, STAGE_INTACT, STAGE_ROOFLESS, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_HQ, BK_PILLBOX,
  BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, isWallKind,
  bldMaterial, BM_WOOD, BM_BRICK, BM_STONE, BM_CONCRETE, type World, type Building,
} from '../sim/world.ts';

export const FLOOR_H = 0.36;   // 一層樓高（格）；3D-lab blockArt.ts 的換算

const C = (hex: number) => new THREE.Color(hex);
const PAL: Record<number, { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color }> = {
  [BK_HOUSE]: { wall: C(0x9a5a44), roof: C(0x4f5660), trim: C(0xe8e0cc) },     // 紅磚、石板瓦
  [BK_COTTAGE]: { wall: C(0xe6dfcc), roof: C(0xa8874e), trim: C(0x5a4632) },   // 白灰牆、茅草頂
  [BK_BARN]: { wall: C(0x6b4a33), roof: C(0x7b7d78), trim: C(0x3d2c20) },      // 木板、鐵皮
  [BK_PILLBOX]: { wall: C(0x9c998e), roof: C(0x8b887d), trim: C(0x1d1f1d) },   // R024 混凝土、槍眼
  [BK_CHURCH]: { wall: C(0xa9a596), roof: C(0x4a5058), trim: C(0x7d7a6e) },    // 灰石、石板
  [BK_SHOP]: { wall: C(0xd9c9a3), roof: C(0x9c4a33), trim: C(0x3f5a4a) },      // 米色灰泥、紅瓦、綠招牌
  [BK_HQ]: { wall: C(0xb8a67e), roof: C(0x5c6650), trim: C(0x6a5a40) },        // R019 指揮部：沙包、橄欖帆布、木料
  [BK_WALL_BRICK]: { wall: C(0xa5644c), roof: C(0x824b39), trim: C(0xd2b397) },
  [BK_WALL_STONE]: { wall: C(0xb2aea0), roof: C(0x898779), trim: C(0x716f63) },
  [BK_WALL_CONCRETE]: { wall: C(0x9c998e), roof: C(0xb8b5a9), trim: C(0x74746e) },
};
const GLASS = C(0x2a3038), RUBBLE = [C(0x8a7d6e), C(0x6e6458), C(0x9b8f7f), C(0x5a4f45)], CHAR = C(0x2b2724), BEAM = C(0x4a3626);

// R105 材質顏色：既有網格不變；不同牆體、空殼與瓦礫讀得到木／磚／石。
let materialsOn = true;
export function setMaterials(on: boolean): void { materialsOn = on; }
const MATERIAL_WALL = { [BM_WOOD]: C(0x866344), [BM_BRICK]: C(0xa5644c), [BM_STONE]: C(0xb2aea0) };
const MATERIAL_RUBBLE = {
  [BM_WOOD]: [C(0x6b4a33), C(0x493728), C(0x94714e), C(0x332a22)],
  [BM_BRICK]: [C(0x9a5a44), C(0x724a39), C(0xb6795c), C(0x583e33)],
  [BM_STONE]: [C(0xa9a596), C(0x7d7a6e), C(0xc0baaa), C(0x625e55)],
  [BM_CONCRETE]: [C(0x9c998e), C(0x74746e), C(0xb8b5a9), C(0x5e605b)],
};
const MATERIAL_PAL: typeof PAL = {};
for (const kind of [BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP]) MATERIAL_PAL[kind] = { ...PAL[kind], wall: MATERIAL_WALL[bldMaterial(kind) as 0 | 1 | 2] };
// R120 只切換外形；紀錄裡的牆關閥後仍畫普通房屋，不改世界或留下隱形障礙。
let wallsOn = true;
export function setWalls(on: boolean): void { wallsOn = on; }
export const wallShown = (b: Building): boolean => wallsOn && isWallKind(b.kind);
const visibleKind = (kind: number) => !wallsOn && isWallKind(kind) ? BK_HOUSE : kind;
const palette = (kind: number) => { kind = visibleKind(kind); return materialsOn ? MATERIAL_PAL[kind] ?? PAL[kind] ?? PAL[BK_HOUSE] : PAL[kind] ?? PAL[BK_HOUSE]; };
const rubbleColors = (kind: number) => {
  kind = visibleKind(kind);
  return (materialsOn || isWallKind(kind)) && kind !== BK_HQ && kind !== BK_PILLBOX ? MATERIAL_RUBBLE[bldMaterial(kind) as 0 | 1 | 2 | 3] : RUBBLE;
};

const WALL_HEIGHT: Record<number, number> = { [BK_WALL_BRICK]: 0.3, [BK_WALL_STONE]: 0.48, [BK_WALL_CONCRETE]: 0.56 };
const WALL_THICK: Record<number, number> = { [BK_WALL_BRICK]: 0.28, [BK_WALL_STONE]: 0.38, [BK_WALL_CONCRETE]: 0.34 };
export function wallHeight(b: Building): number { return wallShown(b) ? WALL_HEIGHT[b.kind] : b.floors * FLOOR_H + 0.1; }
// 共用實際牆面：建模、彈痕與煙源都用同一條窄線；長邊到格界，直線相連沒有縫。
export function wallBounds(b: Building): { x0: number; x1: number; z0: number; z1: number } {
  if (!wallShown(b)) return { x0: b.x + 0.1, x1: b.x + b.w - 0.1, z0: b.z + 0.1 + (b.kind === BK_CHURCH ? 0.9 : 0), z1: b.z + b.d - 0.1 };
  const t = WALL_THICK[b.kind] / 2, cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  return b.w >= b.d ? { x0: b.x, x1: b.x + b.w, z0: cz - t, z1: cz + t } : { x0: cx - t, x1: cx + t, z0: b.z, z1: b.z + b.d };
}

// 磚縫、較大的亂石分塊、混凝土模板接縫；全部寫入原本的 town Geo。
function boundaryWall(g: Geo, b: Building, broken: boolean) {
  const { x0, x1, z0, z1 } = wallBounds(b), p = palette(b.kind), h = wallHeight(b), alongX = b.w >= b.d;
  const length = alongX ? x1 - x0 : z1 - z0, base = alongX ? x0 : z0;
  const box = (a0: number, a1: number, y0: number, y1: number, color: THREE.Color) => {
    if (alongX) g.box(a0, y0, z0, a1, y1, z1, color); else g.box(x0, y0, a0, x1, y1, a1, color);
  };
  const top = broken ? h * 0.72 * 0.7 : h - 0.035;
  if (broken) {
    for (let i = 0; i < 7; i++) box(base + length * i / 7, base + length * (i + 1) / 7, 0, h * 0.72 * (0.7 + 0.3 * hash2(b.id, i, 120)), p.wall);
  } else { box(base, base + length, 0, top, p.wall); box(base, base + length, top, h, p.roof); }
  const rows = b.kind === BK_WALL_BRICK ? 3 : b.kind === BK_WALL_STONE ? 2 : 1;
  const cells = b.kind === BK_WALL_BRICK ? 8 : b.kind === BK_WALL_STONE ? 5 : 3;
  const seam = (a0: number, a1: number, y0: number, y1: number) => {
    if (alongX) {
      g.quad([a0, y0, z0 - 0.001], [a1, y0, z0 - 0.001], [a1, y1, z0 - 0.001], [a0, y1, z0 - 0.001], [0, 0, -1], p.trim);
      g.quad([a0, y0, z1 + 0.001], [a1, y0, z1 + 0.001], [a1, y1, z1 + 0.001], [a0, y1, z1 + 0.001], [0, 0, 1], p.trim);
    } else {
      g.quad([x0 - 0.001, y0, a0], [x0 - 0.001, y0, a1], [x0 - 0.001, y1, a1], [x0 - 0.001, y1, a0], [-1, 0, 0], p.trim);
      g.quad([x1 + 0.001, y0, a0], [x1 + 0.001, y0, a1], [x1 + 0.001, y1, a1], [x1 + 0.001, y1, a0], [1, 0, 0], p.trim);
    }
  };
  for (let row = 0; row < rows; row++) {
    const y0 = top * row / rows, y1 = top * (row + 1) / rows;
    if (row) seam(base, base + length, y0, y0 + 0.009);
    for (let i = 1; i < cells; i++) {
      const a = base + length * (i - (row % 2) * 0.5) / cells;
      seam(a, a + 0.01, y0, y1);
    }
  }
}

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

// ---- R028 外牆細節：依建築編號固定挑一種（只有畫面；關掉＝全部原樣）----
export const FAC_BRICK = 0, FAC_TIMBER = 1, FAC_TILE = 2, FAC_BOARD = 3;
let facadesOn = true;
export function setFacades(on: boolean): void { facadesOn = on; }
const PLASTER = C(0xe8dec4), OAK = C(0x3a2a1f), TILE = C(0xa3533a), TILE_D = C(0x7e3d2b), BOARD_D = C(0xbfb8a6);
export function facadeStyle(b: Building): number {
  if (!facadesOn) return FAC_BRICK;
  const r = hash2(b.id, 3, 28);
  if (b.kind === BK_HOUSE || b.kind === BK_SHOP) return r < 0.34 ? FAC_BRICK : r < 0.67 ? FAC_TIMBER : b.floors >= 2 ? FAC_TILE : FAC_TIMBER;
  if (b.kind === BK_COTTAGE) return r < 0.5 ? FAC_BOARD : FAC_BRICK;
  return FAC_BRICK;
}
// 四面牆各畫一層薄薄的外牆細節（外凸不到 0.01 格，窗戶 0.012 還露在外面）
function facade(g: Geo, b: Building, style: number, x0: number, z0: number, x1: number, z1: number, h: number) {
  const t = 0.008, faces: [number, number, number, number, number][] = [   // 沿著哪一軸、起點、終點、牆面座標、往外的方向
    [0, x0, x1, z1, 1], [0, x0, x1, z0, -1], [1, z0, z1, x1, 1], [1, z0, z1, x0, -1],
  ];
  const strip = (axis: number, a0: number, a1: number, at: number, dir: number, y0: number, y1: number, c: THREE.Color, out = t) => {
    const o0 = dir > 0 ? at : at - out, o1 = dir > 0 ? at + out : at;
    if (axis === 0) g.box(a0, y0, o0, a1, y1, o1, c, null); else g.box(o0, y0, a0, o1, y1, a1, c, null);
  };
  for (const [axis, a0, a1, at, dir] of faces) {
    if (style === FAC_TIMBER) {                                   // 角柱、每層的橫梁、間柱
      strip(axis, a0, a0 + 0.035, at, dir, 0, h, OAK); strip(axis, a1 - 0.035, a1, at, dir, 0, h, OAK);
      for (let f = 0; f <= b.floors; f++) { const y = Math.min(h - 0.03, f * FLOOR_H + (f ? 0.04 : 0)); strip(axis, a0, a1, at, dir, y, y + 0.03, OAK); }
      const n = Math.max(2, Math.round((a1 - a0) / 0.22));
      for (let k = 1; k < n; k++) { const a = a0 + ((a1 - a0) * k) / n; if (Math.abs(a - Math.round(a - 0.5) - 0.5) < 0.09) continue; strip(axis, a - 0.012, a + 0.012, at, dir, 0.03, h - 0.03, OAK); }   // 窗戶那一段不擋
    } else if (style === FAC_TILE) {                              // 一樓紅磚，二樓以上掛瓦：底色加一道道瓦縫
      const y0 = FLOOR_H + 0.04;
      strip(axis, a0, a1, at, dir, y0, h, TILE);
      for (let y = y0 + 0.045; y < h - 0.01; y += 0.045) strip(axis, a0, a1, at, dir, y, y + 0.008, TILE_D, t + 0.002);
      strip(axis, a0, a1, at, dir, y0 - 0.02, y0, OAK, t + 0.003);    // 掛瓦下緣的收邊板
    } else if (style === FAC_BOARD) {                             // 白色護牆板：一條條橫線
      for (let y = 0.05; y < h - 0.02; y += 0.05) strip(axis, a0, a1, at, dir, y, y + 0.006, BOARD_D);
    }
  }
}

// R019 指揮部：一圈沙包、指揮所小屋、天線、旗桿與陣營色的旗（不畫任何徽記）
const FLAG = [C(0x3b6fb6), C(0x8a8a84)];
function hq(g: Geo, b: Building) {
  const p = PAL[BK_HQ], x0 = b.x + 0.12, z0 = b.z + 0.12, x1 = b.x + b.w - 0.12, z1 = b.z + b.d - 0.12, t = 0.14;
  const bag = (ax: number, az: number, bx: number, bz: number) => g.box(ax, 0, az, bx, 0.13, bz, p.wall);
  bag(x0, z0, x1, z0 + t); bag(x0, z1 - t, x1, z1); bag(x0, z0 + t, x0 + t, z1 - t);
  bag(x1 - t, z0 + t, x1, (z0 + z1) / 2 - 0.15); bag(x1 - t, (z0 + z1) / 2 + 0.15, x1, z1 - t);   // 東邊留一個口
  const hx0 = b.x + 0.55, hz0 = b.z + 0.5, hx1 = b.x + b.w - 0.55, hz1 = b.z + b.d - 0.75;
  g.box(hx0, 0, hz0, hx1, 0.34, hz1, p.trim, null);
  g.gable(hx0 - 0.05, hz0 - 0.05, hx1 + 0.05, hz1 + 0.05, 0.34, 0.16, true, p.roof, p.trim);
  g.box(x0 + 0.25, 0, z1 - 0.4, x0 + 0.28, 0.95, z1 - 0.37, C(0x3a3c3e));                        // 天線
  const fx = x1 - 0.32, fz = z1 - 0.32;
  g.box(fx, 0, fz, fx + 0.03, 0.85, fz + 0.03, C(0xd8d4c8));                                      // 旗桿
  g.box(fx + 0.03, 0.62, fz, fx + 0.3, 0.8, fz + 0.015, FLAG[b.builtBy === 1 ? 1 : 0]);          // 旗
}

// R024 Type 22 碉堡：矮矮的六角形混凝土（用三塊錯開的方塊拼出切角），六面槍眼，頂板外挑；打壞了頂板裂開、槍眼周圍掉角
function pillbox(g: Geo, b: Building, broken: boolean) {
  const p = PAL[BK_PILLBOX], cx = b.x + 0.5, cz = b.z + 0.5, r = 0.36, h = 0.3, c = 0.14;
  g.box(cx - r, 0, cz - r + c, cx + r, h, cz + r - c, p.wall);
  g.box(cx - r + c, 0, cz - r, cx + r - c, h, cz + r, p.wall);
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {                     // 槍眼：每面一條暗縫
    const ax = cx + sx * (r + 0.004), az = cz + sz * (r + 0.004), half = 0.09;
    if (sx) g.box(ax - 0.006, 0.17, az - half, ax + 0.006, 0.22, az + half, p.trim); else g.box(ax - half, 0.17, az - 0.006, ax + half, 0.22, az + 0.006, p.trim);
  }
  if (broken) {
    g.box(cx - r + c, h, cz - r + 0.06, cx + 0.02, h + 0.05, cz + r - c, p.roof);   // 頂板只剩一半
    g.box(cx + r - 0.12, 0, cz + r - 0.1, cx + r + 0.04, 0.06, cz + r + 0.05, RUBBLE[0]);
  } else g.box(cx - r - 0.03, h, cz - r + 0.06, cx + r + 0.03, h + 0.06, cz + r - 0.06, p.roof);
  for (let k = 0; k < 3; k++) {                                                    // 後面一小段沙包（開口朝自己的後方）
    const z = cz + r + 0.06 + k * 0.001, x = cx - 0.3 + k * 0.2;
    g.box(x, 0, z, x + 0.18, 0.09, z + 0.1, PAL[BK_HQ].wall);
  }
}

function intact(g: Geo, b: Building) {
  if (wallShown(b)) { boundaryWall(g, b, false); return; }
  if (b.kind === BK_HQ) { hq(g, b); return; }
  if (b.kind === BK_PILLBOX) { pillbox(g, b, false); return; }
  const p = palette(b.kind), m = 0.1, x0 = b.x + m, z0 = b.z + m, x1 = b.x + b.w - m, z1 = b.z + b.d - m;
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
  const h = wallHeight(b), alongX = b.w >= b.d, style = facadeStyle(b), wall = style === FAC_TIMBER ? PLASTER : p.wall;
  g.box(x0, 0, z0, x1, h, z1, wall, null);
  const rise = b.kind === BK_BARN ? 0.42 : b.kind === BK_SHOP ? 0.22 : 0.32;
  g.gable(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h, rise, alongX, p.roof, wall);
  if (style) facade(g, b, style, x0, z0, x1, z1, h);
  if (b.kind === BK_HOUSE || b.kind === BK_SHOP) {                           // 煙囪
    const cx = alongX ? x1 - 0.18 : (x0 + x1) / 2, cz = alongX ? (z0 + z1) / 2 : z1 - 0.18;
    g.box(cx - 0.05, h, cz - 0.05, cx + 0.05, h + rise + 0.12, cz + 0.05, p.wall);
  }
  if (b.kind === BK_SHOP) g.box(x0, 0.2, z1, x1, 0.28, z1 + 0.03, p.trim, p.trim);   // 店招
  if (b.kind !== BK_BARN) windows(g, b, x0, z0, x1, z1, h);
}

// 沒屋頂：四面薄牆剩七成高，牆頂鋸齒，屋裡焦黑，幾根斷梁
function roofless(g: Geo, b: Building) {
  if (wallShown(b)) { boundaryWall(g, b, true); return; }
  if (b.kind === BK_PILLBOX) { pillbox(g, b, true); return; }
  const p = palette(b.kind), m = 0.1, t = 0.07, x0 = b.x + m, z0 = b.z + m, x1 = b.x + b.w - m, z1 = b.z + b.d - m;
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
  const n = 6 + b.w * b.d * 3, colors = rubbleColors(b.kind);
  for (let k = 0; k < n; k++) {
    const hx = hash2(b.id, k, 1), hz = hash2(b.id, k, 2), hh = hash2(b.id, k, 3), hc = hash2(b.id, k, 4);
    const x = b.x + 0.12 + hx * (b.w - 0.24), z = b.z + 0.12 + hz * (b.d - 0.24), s = 0.08 + hh * 0.12;
    g.box(x - s, 0, z - s * 0.8, x + s, 0.05 + hh * 0.12, z + s * 0.8, colors[Math.floor(hc * colors.length)]);
  }
  if (b.kind === BK_CHURCH) g.box(b.x + 0.1, 0, b.z + 0.1, b.x + 0.9, 0.55, b.z + 0.9, palette(b.kind).wall);   // 塔基還站著
}

// 一棟建築在指定損壞階段的模型（R004 倒塌殘影要畫「倒之前」那一段）
export function buildingGeo(g: Geo, b: Building, stage: number): Geo {
  if (!wallsOn && isWallKind(b.kind)) b = { ...b, kind: BK_HOUSE };
  if (stage === STAGE_INTACT) intact(g, b); else if (stage === STAGE_ROOFLESS) roofless(g, b); else rubble(g, b);
  return g;
}

// skip：這一刻先不畫的建築（R016 正在從地面升起的，由殘影網格畫）
export function buildTown(w: World, skip?: (b: Building) => boolean): Geo {
  const g = new Geo();
  for (const b of w.blds) if (!skip || !skip(b)) buildingGeo(g, b, stageOf(b));
  return g;
}

// 效果用的顏色：碎片取自那棟房子的牆、屋頂與瓦礫（R004）
export function bldColors(kind: number): { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color } { return palette(kind); }
export const RUBBLE_COLORS = RUBBLE;
export const ROOF_RISE: Record<number, number> = { [BK_HOUSE]: 0.32, [BK_COTTAGE]: 0.32, [BK_BARN]: 0.42, [BK_CHURCH]: 0.55, [BK_SHOP]: 0.22, [BK_HQ]: 0.16, [BK_PILLBOX]: 0.06, [BK_WALL_BRICK]: 0, [BK_WALL_STONE]: 0, [BK_WALL_CONCRETE]: 0 };
export const roofRise = (kind: number): number => ROOF_RISE[visibleKind(kind)] ?? 0.32;

// 冒煙點：沒屋頂的房子從屋裡冒煙（渲染端的效果用）
export function smokeSources(w: World): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const b of w.blds) if (stageOf(b) === STAGE_ROOFLESS) out.push([b.x + b.w / 2, wallHeight(b) * 0.5, b.z + b.d / 2]);
  return out;
}
