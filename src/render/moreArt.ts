// R087 三種新房型的模型：啤酒花烘房（BK_OAST）、塔式風車（BK_MILL）、河岸倉庫（BK_WAREHOUSE）。
// 完好、空殼（沒屋頂那一段）、瓦礫上還站著的那一截、96 圖的遠景兩層。buildings.ts 只在 setMoreArt(true) 時叫這裡；
// 關掉時新房型照「看起來像的舊種類」畫（MORE_LIKE：烘房像住宅、風車像小屋、倉庫像穀倉），模擬不變。
// 規矩跟 R086 一樣：鏡頭固定從 +x、+z 看（看得到的是 +x、+z 兩面與屋頂）；每棟的變化只用 hash2(b.id, k, 87)；不畫任何字。
// 1940 年肯特、薩塞克斯一帶的樣子：烘房是磚砌的圓烘爐（這裡做成八角）、圓錐頂、白色風帽，旁邊兩層的儲藏間；
// 塔式風車是磚基座上白色木板的八角塔身、船形的帽子、四片風帆；河港的倉庫一樓磚、上面塗焦油的木板、頂樓吊貨的小屋（lucam）。
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import { BK_HOUSE, BK_COTTAGE, BK_BARN, BK_OAST, BK_MILL, BK_WAREHOUSE, STAGE_ROOFLESS, STAGE_RUBBLE, type Building } from '../sim/world.ts';

type V3 = [number, number, number];
const C = (hex: number) => new THREE.Color(hex);
const h87 = (b: Building, k: number): number => hash2(b.id, k, 87);
const lumaOf = (hex: number): number => 0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255);

export const isMoreKind = (kind: number): boolean => kind === BK_OAST || kind === BK_MILL || kind === BK_WAREHOUSE;
// 閥關掉時照哪一種舊房子畫
export const MORE_LIKE: Record<number, number> = { [BK_OAST]: BK_HOUSE, [BK_MILL]: BK_COTTAGE, [BK_WAREHOUSE]: BK_BARN };
// 血條、冒煙那些用的「屋頂多高」（牆高之上）：烘房到風帽頂、風車到帽子頂、倉庫的屋脊
export const MORE_RISE: Record<number, number> = { [BK_OAST]: 0.63, [BK_MILL]: 0.33, [BK_WAREHOUSE]: 0.30 };

// 量出來的尺寸（守衛照這些檢查）
// 烘爐比卡面原本寫的（直徑 0.60、牆高 0.66）高一點、寬一點：照原數字畫出來圓錐頂只比儲藏間的屋脊高一點點，看不出是烘房（截圖見卡面施工紀錄）
export const OAST = { drum: 0.32, drumTop: 0.76, coneRise: 0.54, collar: 0.07, cowl: 0.075, cowlBody: 0.12, cowlRise: 0.06, stowWall: 0.82, stowRise: 0.32, split: 0.42 } as const;
export const MILL = { base: 0.35, baseTop: 0.30, stage: 0.42, body0: 0.31, body1: 0.20, bodyTop: 1.35, capRise: 0.16, hub: 1.45, out: 0.40, sail0: 0.05, sail1: 0.62, sailW: 0.11, stock: 0.015 } as const;
export const QUAY = { brick: 0.36, rise: 0.30, lucamW: 0.18, lucamD: 0.085, door: [0.14, 0.22] as const } as const;

const CHAR = C(0x2b2724), VOID = C(0x1e1c1a), GLASS = C(0x2a3038), OAKD = C(0x3a2a1f);
const KILN = [0x8e5040, 0x9a5a44, 0x84483a], BOARD = [0xd8d2c0, 0xe0dacb], CONE = [0x5e3a2e, 0x6a3f30];
const COWL = C(0xe0dacb), MILL_CAP = [0x3b4049, 0x4f5660], SAIL = C(0xd8d4c8), TAR = C(0x2f2b28), TAR_BAND = C(0x46403a), QUAY_DOOR = C(0xa89a80);
const TILE = 0x6a4032, SLATE = 0x3b4049, SLATE_L = 0x4f5660;

// 照種類的固定配色（buildings.ts 的 bldColors(kind)：沒有那一棟的時候用）
export const MORE_PAL: Record<number, { wall: THREE.Color; roof: THREE.Color; trim: THREE.Color }> = {
  [BK_OAST]: { wall: C(KILN[1]), roof: C(TILE), trim: OAKD },
  [BK_MILL]: { wall: C(BOARD[1]), roof: C(MILL_CAP[0]), trim: OAKD },
  [BK_WAREHOUSE]: { wall: TAR, roof: C(TILE), trim: TAR_BAND },
};

export interface MoreLook {
  wall: THREE.Color; roof: THREE.Color; trim: THREE.Color;   // 跟 buildings.ts 的 palette 同形（碎片、彈痕、損壞階段照它）
  brick: THREE.Color; upper: THREE.Color; cone: THREE.Color; door: THREE.Color;
}
// 每一棟自己的樣子
export function moreLook(b: Building): MoreLook {
  const k0 = h87(b, 0), k1 = h87(b, 1), k2 = h87(b, 2);
  if (b.kind === BK_OAST) {
    const brick = C(KILN[Math.floor(k0 * 3)]), upper = k1 < 0.55 ? C(BOARD[k1 < 0.3 ? 0 : 1]) : brick;   // 儲藏間的二樓：白色木板或照樣是磚
    const roofs = k2 < 0.6 ? [TILE, SLATE] : [SLATE, TILE], roof = roofs.find(r => Math.abs(lumaOf(r) - lumaOf(brick.getHex())) >= 18) ?? SLATE;   // 跟 R086 一樣：屋頂跟牆的亮度要差 ≥ 18
    return { wall: brick, roof: C(roof), trim: OAKD, brick, upper, cone: C(CONE[k2 < 0.5 ? 0 : 1]), door: OAKD };
  }
  if (b.kind === BK_MILL) {
    const body = C(BOARD[k1 < 0.6 ? 1 : 0]), brick = C(KILN[1 + Math.floor(k0 * 2)]);
    return { wall: body, roof: C(MILL_CAP[k2 < 0.6 ? 0 : 1]), trim: OAKD, brick, upper: body, cone: C(MILL_CAP[k2 < 0.6 ? 0 : 1]), door: OAKD };
  }
  const brick = C(KILN[Math.floor(k0 * 2)]);
  return { wall: TAR, roof: C(k2 < 0.65 ? TILE : SLATE_L), trim: TAR_BAND, brick, upper: TAR, cone: TAR, door: QUAY_DOOR };
}

// ---- 幾何小工具 ----
// 正八角柱（可以往上收）：第一個面朝 +x，第三個朝 +z、第二個朝 (+x,+z)——看得到的那幾面是平的。r＝邊心距；top：頂面色（null 不畫）
function octo(g: Geo, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, side: THREE.Color, top: THREE.Color | null): void {
  const k = 1 / Math.cos(Math.PI / 8), R0 = r0 * k, R1 = r1 * k, slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
  const at = (i: number, R: number, y: number): V3 => { const a = (i - 0.5) * Math.PI / 4; return [cx + R * Math.cos(a), y, cz + R * Math.sin(a)]; };
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, away: V3 = [Math.cos(a), slope, Math.sin(a)];
    if (R1 > 1e-6) g.face4(at(i, R0, y0), at(i + 1, R0, y0), at(i + 1, R1, y1), at(i, R1, y1), away, side);
    else g.face3(at(i, R0, y0), at(i + 1, R0, y0), [cx, y1, cz], away, side);
  }
  if (top && R1 > 1e-6) for (let i = 1; i < 7; i++) g.face3(at(0, R1, y1), at(i, R1, y1), at(i + 1, R1, y1), [0, 1, 0], top);
}
// 斜放的長方體：中心 c、三個互相垂直的單位軸、三個半長
function obox(g: Geo, c: V3, a: V3, b: V3, n: V3, ha: number, hb: number, hn: number, col: THREE.Color): void {
  const p = (sa: number, sb: number, sn: number): V3 => [c[0] + a[0] * ha * sa + b[0] * hb * sb + n[0] * hn * sn, c[1] + a[1] * ha * sa + b[1] * hb * sb + n[1] * hn * sn, c[2] + a[2] * ha * sa + b[2] * hb * sb + n[2] * hn * sn];
  for (const s of [1, -1]) {
    g.face4(p(s, -1, -1), p(s, 1, -1), p(s, 1, 1), p(s, -1, 1), [a[0] * s, a[1] * s, a[2] * s], col);
    g.face4(p(-1, s, -1), p(1, s, -1), p(1, s, 1), p(-1, s, 1), [b[0] * s, b[1] * s, b[2] * s], col);
    g.face4(p(-1, -1, s), p(1, -1, s), p(1, 1, s), p(-1, 1, s), [n[0] * s, n[1] * s, n[2] * s], col);
  }
}
// 貼在牆上的一塊（門、窗、帶子）：face＝哪一面（'x'＝+x 那面、'z'＝+z 那面），沿牆從 a0 到 a1、高 y0 到 y1
function patch(g: Geo, face: 'x' | 'z', at: number, a0: number, a1: number, y0: number, y1: number, col: THREE.Color): void {
  if (face === 'z') g.quad([a0, y0, at], [a1, y0, at], [a1, y1, at], [a0, y1, at], [0, 0, 1], col);
  else g.quad([at, y0, a0], [at, y0, a1], [at, y1, a1], [at, y1, a0], [1, 0, 0], col);
}
// 沒屋頂的四面薄牆（鋸齒的牆頂）＋焦黑的地
function shell(g: Geo, b: Building, x0: number, z0: number, x1: number, z1: number, h: number, col: THREE.Color): void {
  const t = 0.07, jag = (k: number) => h * (0.7 + 0.3 * hash2(b.id, k, 7));
  for (let s = 0; s < 3; s++) {
    const a0 = x0 + ((x1 - x0) * s) / 3, a1 = x0 + ((x1 - x0) * (s + 1)) / 3, c0 = z0 + ((z1 - z0) * s) / 3, c1 = z0 + ((z1 - z0) * (s + 1)) / 3;
    g.box(a0, 0, z1 - t, a1, jag(s), z1, col); g.box(a0, 0, z0, a1, jag(s + 4), z0 + t, col);
    g.box(x1 - t, 0, c0, x1, jag(s + 8), c1, col); g.box(x0, 0, c0, x0 + t, jag(s + 12), c1, col);
  }
  g.box(x0 + t, 0, z0 + t, x1 - t, 0.03, z1 - t, CHAR);
}

// ---- 啤酒花烘房 ----
// 烘爐在朝鏡頭的那一頭（長邊沿 x 時在 +x 那格，否則在 +z 那格）；另一頭是兩層的儲藏間
const oastFrame = (b: Building) => {
  const alongX = b.w >= b.d, kx = alongX ? b.x + b.w - 0.5 : b.x + b.w / 2, kz = alongX ? b.z + b.d / 2 : b.z + b.d - 0.5;
  const x0 = b.x + 0.1, z0 = b.z + 0.1, x1 = alongX ? kx : b.x + b.w - 0.1, z1 = alongX ? b.z + b.d - 0.1 : kz;   // 儲藏間伸到烘爐中間
  return { alongX, kx, kz, x0, z0, x1, z1 };
};
function oast(g: Geo, b: Building, look: MoreLook): void {
  const f = oastFrame(b), O = OAST, H = O.stowWall;
  // 儲藏間：一樓磚、二樓木板或磚；雙坡屋頂沿長邊
  g.box(f.x0, 0, f.z0, f.x1, O.split, f.z1, look.brick, null);
  g.box(f.x0, O.split, f.z0, f.x1, H, f.z1, look.upper, null);
  g.gable(f.x0 - 0.04, f.z0 - 0.04, f.x1 + (f.alongX ? 0 : 0.04), f.z1 + (f.alongX ? 0.04 : 0), H, O.stowRise, f.alongX, look.roof, look.upper);
  // 儲藏間的門：一樓一扇、二樓一扇裝貨門（看得到的長邊）
  if (f.alongX) { const m = (f.x0 + f.x1) / 2; patch(g, 'z', f.z1 + 0.005, m - 0.07, m + 0.07, 0, 0.26, look.door); patch(g, 'z', f.z1 + 0.005, m - 0.08, m + 0.08, 0.5, 0.7, look.door); }
  else { const m = (f.z0 + f.z1) / 2; patch(g, 'x', f.x1 + 0.005, m - 0.07, m + 0.07, 0, 0.26, look.door); patch(g, 'x', f.x1 + 0.005, m - 0.08, m + 0.08, 0.5, 0.7, look.door); }
  // 烘爐：八角的磚身、圓錐頂、頂上白色風帽（開口朝外，看得到的那一面是暗的）
  octo(g, f.kx, f.kz, 0, O.drumTop, O.drum, O.drum, look.brick, null);
  octo(g, f.kx, f.kz, O.drumTop, O.drumTop + O.coneRise, O.drum, O.collar, look.cone, null);
  const y0 = O.drumTop + O.coneRise - 0.01, y1 = y0 + O.cowlBody, c = O.cowl;
  g.box(f.kx - c, y0, f.kz - c, f.kx + c, y1, f.kz + c, COWL, null);
  g.gable(f.kx - c - 0.01, f.kz - c - 0.01, f.kx + c + 0.01, f.kz + c + 0.01, y1, O.cowlRise, f.alongX, COWL, COWL);
  if (f.alongX) patch(g, 'x', f.kx + c + 0.004, f.kz - c + 0.02, f.kz + c - 0.02, y0 + 0.03, y1 - 0.01, VOID);
  else patch(g, 'z', f.kz + c + 0.004, f.kx - c + 0.02, f.kx + c - 0.02, y0 + 0.03, y1 - 0.01, VOID);
  // 烘爐底下燒火的小門（朝鏡頭那一面）
  const r = O.drum + 0.004;
  if (f.alongX) patch(g, 'x', f.kx + r, f.kz - 0.06, f.kz + 0.06, 0, 0.2, look.door); else patch(g, 'z', f.kz + r, f.kx - 0.06, f.kx + 0.06, 0, 0.2, look.door);
}
function oastShell(g: Geo, b: Building, look: MoreLook): void {
  const f = oastFrame(b);
  shell(g, b, f.x0, f.z0, f.alongX ? f.x1 - OAST.drum * 0.5 : f.x1, f.alongX ? f.z1 : f.z1 - OAST.drum * 0.5, OAST.stowWall * 0.72, look.brick);
  octo(g, f.kx, f.kz, 0, OAST.drumTop * 0.8, OAST.drum, OAST.drum, look.brick, CHAR);   // 烘爐剩磚身，頂上燒黑
}

// ---- 塔式風車 ----
// 帆面朝鏡頭：風軸沿 A＝(1,0,1)/√2，帆在 B（橫）與 Y（上）張的平面裡排成 X
const S2 = Math.SQRT1_2, AX: V3 = [S2, 0, S2], BX: V3 = [S2, 0, -S2], UP: V3 = [0, 1, 0];
const along = (cx: number, cz: number, u: number, v: number, y: number): V3 => [cx + (u + v) * S2, y, cz + (u - v) * S2];
function mill(g: Geo, b: Building, look: MoreLook): void {
  const M = MILL, cx = b.x + 0.5, cz = b.z + 0.5;
  octo(g, cx, cz, 0, M.baseTop, M.base, M.base, look.brick, null);                       // 磚基座
  octo(g, cx, cz, M.baseTop, M.baseTop + 0.03, M.stage, M.stage, look.trim, look.trim);  // 一圈木平台（stage）
  octo(g, cx, cz, M.baseTop + 0.03, M.bodyTop, M.body0, M.body1, look.wall, null);       // 往上收的白色木板塔身
  // 船形的帽子（四坡，沿風軸）
  const cap = (u: number, v: number, y: number) => along(cx, cz, u, v, y), y0 = M.bodyTop, y1 = y0 + M.capRise;
  g.face4(cap(-0.24, -0.18, y0), cap(0.24, -0.18, y0), cap(0.1, 0, y1), cap(-0.1, 0, y1), [-BX[0], 1, -BX[2]], look.roof);
  g.face4(cap(-0.24, 0.18, y0), cap(0.24, 0.18, y0), cap(0.1, 0, y1), cap(-0.1, 0, y1), [BX[0], 1, BX[2]], look.roof);
  g.face3(cap(0.24, -0.18, y0), cap(0.24, 0.18, y0), cap(0.1, 0, y1), [AX[0], 1, AX[2]], look.roof);
  g.face3(cap(-0.24, -0.18, y0), cap(-0.24, 0.18, y0), cap(-0.1, 0, y1), [-AX[0], 1, -AX[2]], look.roof);
  // 風軸、軸頭
  obox(g, along(cx, cz, (0.2 + M.out) / 2, 0, M.hub), AX, BX, UP, (M.out - 0.2) / 2, 0.025, 0.025, OAKD);
  obox(g, along(cx, cz, M.out, 0, M.hub), AX, BX, UP, 0.03, 0.04, 0.04, OAKD);
  // 兩根帆臂（stock）交叉成 X，四片帆在帆臂前面
  for (const s of [1, -1]) {
    const d: V3 = [BX[0] * S2 * s, S2, BX[2] * S2 * s], p: V3 = [-BX[0] * S2, S2 * s, -BX[2] * S2];   // 帆臂方向、帆面上跟它垂直的方向
    const hub = along(cx, cz, M.out - 0.01, 0, M.hub);
    const len = M.sail1 + 0.01;
    obox(g, hub, d, p, AX, len, M.stock, M.stock, OAKD);
    for (const e of [1, -1]) {
      const at = (r: number, w: number, du: number): V3 => {
        const q = along(cx, cz, M.out + du, 0, M.hub);
        return [q[0] + (d[0] * r + p[0] * w) * e, q[1] + (d[1] * r + p[1] * w) * e, q[2] + (d[2] * r + p[2] * w) * e];
      };
      const hw = M.sailW / 2;
      g.quad(at(M.sail0, -hw, 0.02), at(M.sail1, -hw, 0.02), at(M.sail1, hw, 0.02), at(M.sail0, hw, 0.02), AX, SAIL);   // 正面
      g.quad(at(M.sail0, -hw, 0.017), at(M.sail1, -hw, 0.017), at(M.sail1, hw, 0.017), at(M.sail0, hw, 0.017), [-AX[0], 0, -AX[2]], SAIL);   // 背面（陰影用）
    }
  }
  // 門（基座朝鏡頭那一面）、塔身的小窗
  const r = M.base + 0.004;
  g.quad(along(cx, cz, r, -0.06, 0), along(cx, cz, r, 0.06, 0), along(cx, cz, r, 0.06, 0.24), along(cx, cz, r, -0.06, 0.24), AX, look.door);
  for (const y of [0.62, 0.95]) {
    const t = (y - M.baseTop) / (M.bodyTop - M.baseTop), rr = M.body0 + (M.body1 - M.body0) * t + 0.006;
    g.quad(along(cx, cz, rr, -0.04, y), along(cx, cz, rr, 0.04, y), along(cx, cz, rr, 0.04, y + 0.09), along(cx, cz, rr, -0.04, y + 0.09), AX, GLASS);
  }
}
function millShell(g: Geo, b: Building, look: MoreLook): void {
  const M = MILL, cx = b.x + 0.5, cz = b.z + 0.5;
  octo(g, cx, cz, 0, M.baseTop, M.base, M.base, look.brick, null);
  octo(g, cx, cz, M.baseTop, 0.95, M.body0, M.body0 - (M.body0 - M.body1) * 0.6, look.wall, CHAR);   // 塔身燒剩下半截，沒有帽子與帆
}

// ---- 河岸倉庫 ----
function quay(g: Geo, b: Building, look: MoreLook, h: number): void {
  const x0 = b.x + 0.1, z0 = b.z + 0.1, x1 = b.x + b.w - 0.1, z1 = b.z + b.d - 0.1, alongX = b.w >= b.d, Q = QUAY;
  g.box(x0, 0, z0, x1, Q.brick, z1, look.brick, null);   // 一樓磚
  g.box(x0, Q.brick, z0, x1, h, z1, TAR, null);           // 上面塗焦油的木板
  g.gable(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h, Q.rise, alongX, look.roof, TAR);
  // 木板的接縫（看得到的兩面，兩條淺一點的帶子）
  for (const y of [0.64, 0.92]) { patch(g, 'z', z1 + 0.003, x0, x1, y, y + 0.02, TAR_BAND); patch(g, 'x', x1 + 0.003, z0, z1, y, y + 0.02, TAR_BAND); }
  // 裝貨門三扇上下疊，頂上吊貨小屋；在看得到的長邊（長邊沿 x＝+z 那面）
  const face = alongX ? 'z' : 'x', at = alongX ? z1 + 0.005 : x1 + 0.005, a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
  const m = a0 + (a1 - a0) * (0.35 + 0.3 * h87(b, 3)), [dw, dh] = Q.door;
  for (const y of [0.05, 0.41]) patch(g, face, at, m - dw / 2, m + dw / 2, y, y + dh, look.door);   // 第三扇在吊貨小屋的正面
  // 吊貨小屋：從屋簷探出來（比牆頂高一截、自己一個小山牆頂），正面是一扇淺色的吊貨門
  const lw = Q.lucamW / 2, ly0 = 0.98, ly1 = h + 0.1, ld = Q.lucamD;
  if (alongX) {
    g.box(m - lw, ly0, z1 - 0.12, m + lw, ly1, z1 + ld, TAR, null); g.gable(m - lw - 0.01, z1 - 0.12, m + lw + 0.01, z1 + ld + 0.01, ly1, 0.08, false, look.roof, TAR);
    patch(g, 'z', z1 + ld + 0.004, m - lw + 0.025, m + lw - 0.025, ly0 + 0.03, ly1 - 0.03, look.door);
  } else {
    g.box(x1 - 0.12, ly0, m - lw, x1 + ld, ly1, m + lw, TAR, null); g.gable(x1 - 0.12, m - lw - 0.01, x1 + ld + 0.01, m + lw + 0.01, ly1, 0.08, true, look.roof, TAR);
    patch(g, 'x', x1 + ld + 0.004, m - lw + 0.025, m + lw - 0.025, ly0 + 0.03, ly1 - 0.03, look.door);
  }
  // 窗：二樓、三樓，門以外的位置（看得到的兩面）
  for (const y of [0.48, 0.84]) {
    for (let i = 0; i < b.w; i++) { const c = b.x + i + 0.5; if (!(alongX && Math.abs(c - m) < 0.2)) patch(g, 'z', z1 + 0.004, c - 0.06, c + 0.06, y, y + 0.11, GLASS); }
    for (let i = 0; i < b.d; i++) { const c = b.z + i + 0.5; if (!(!alongX && Math.abs(c - m) < 0.2)) patch(g, 'x', x1 + 0.004, c - 0.06, c + 0.06, y, y + 0.11, GLASS); }
  }
}
function quayShell(g: Geo, b: Building, look: MoreLook, h: number): void {
  const x0 = b.x + 0.1, z0 = b.z + 0.1, x1 = b.x + b.w - 0.1, z1 = b.z + b.d - 0.1;
  g.box(x0, 0, z0, x1, QUAY.brick, z1, look.brick, null);
  shell(g, b, x0, z0, x1, z1, h * 0.72, TAR);   // 屋頂沒了，上面的木板燒剩七成
}

// ---- 給 buildings.ts 叫的 ----
export function moreIntact(g: Geo, b: Building, h: number): void {
  const look = moreLook(b);
  if (b.kind === BK_OAST) oast(g, b, look); else if (b.kind === BK_MILL) mill(g, b, look); else quay(g, b, look, h);
}
export function moreShell(g: Geo, b: Building, h: number): void {
  const look = moreLook(b);
  if (b.kind === BK_OAST) oastShell(g, b, look); else if (b.kind === BK_MILL) millShell(g, b, look); else quayShell(g, b, look, h);
}
// 瓦礫上還站著的那一截（瓦礫堆本身照通用的畫）：烘爐的磚身、風車的磚基座
export function moreRubble(g: Geo, b: Building): void {
  const look = moreLook(b);
  if (b.kind === BK_OAST) { const f = oastFrame(b); octo(g, f.kx, f.kz, 0, 0.24, OAST.drum, OAST.drum, look.brick, CHAR); }
  else if (b.kind === BK_MILL) octo(g, b.x + 0.5, b.z + 0.5, 0, 0.22, MILL.base, MILL.base, look.brick, CHAR);
}
// 96 圖的遠景：lod 1（中景）、2（遠景）；h＝牆高
export function moreDistant(g: Geo, b: Building, lod: number, stage: number, h: number, rubbleColor: THREE.Color): void {
  const look = moreLook(b), x0 = b.x + 0.1, z0 = b.z + 0.1, x1 = b.x + b.w - 0.1, z1 = b.z + b.d - 0.1;
  if (stage === STAGE_RUBBLE) { g.box(x0, 0, z0, x1, 0.09, z1, rubbleColor); return; }
  if (stage === STAGE_ROOFLESS) { g.box(x0, 0, z0, x1, h * 0.65, z1, b.kind === BK_MILL ? look.wall : b.kind === BK_WAREHOUSE ? TAR : look.brick, CHAR); return; }
  if (b.kind === BK_OAST) {
    const f = oastFrame(b), d = OAST.drum, top = OAST.drumTop + OAST.coneRise;
    if (lod > 1) {   // 一個盒子＋烘爐的尖頂
      g.box(x0, 0, z0, x1, OAST.stowWall, z1, look.brick);
      g.pyramid(f.kx - d, f.kz - d, f.kx + d, f.kz + d, OAST.stowWall, top + OAST.cowlBody - OAST.stowWall, look.cone);
      return;
    }
    g.box(f.x0, 0, f.z0, f.x1, OAST.stowWall, f.z1, look.upper, null);
    g.gable(f.x0 - 0.04, f.z0 - 0.04, f.x1, f.z1 + 0.04, OAST.stowWall, OAST.stowRise, f.alongX, look.roof, look.upper);
    g.box(f.kx - d, 0, f.kz - d, f.kx + d, OAST.drumTop, f.kz + d, look.brick, null);
    g.pyramid(f.kx - d, f.kz - d, f.kx + d, f.kz + d, OAST.drumTop, OAST.coneRise, look.cone);
    g.box(f.kx - OAST.cowl, top - 0.01, f.kz - OAST.cowl, f.kx + OAST.cowl, top + OAST.cowlBody, f.kz + OAST.cowl, COWL);
    return;
  }
  if (b.kind === BK_MILL) {
    const M = MILL, cx = b.x + 0.5, cz = b.z + 0.5, r = M.body0;
    g.box(cx - r, 0, cz - r, cx + r, M.bodyTop, cz + r, look.wall);
    const hub = along(cx, cz, M.out + 0.02, 0, M.hub);
    // 帆畫成交叉的兩條（只畫正面）
    for (const s of [1, -1]) {
      const d: V3 = [BX[0] * S2 * s, S2, BX[2] * S2 * s], p: V3 = [-BX[0] * S2, S2 * s, -BX[2] * S2], w = M.sailW / 2;
      const q = (r0: number, w0: number): V3 => [hub[0] + d[0] * r0 + p[0] * w0, hub[1] + d[1] * r0 + p[1] * w0, hub[2] + d[2] * r0 + p[2] * w0];
      g.quad(q(-M.sail1, -w), q(M.sail1, -w), q(M.sail1, w), q(-M.sail1, w), AX, SAIL);
    }
    if (lod > 1) return;
    g.box(cx - M.base, 0, cz - M.base, cx + M.base, M.baseTop, cz + M.base, look.brick, null);
    g.pyramid(cx - 0.2, cz - 0.2, cx + 0.2, cz + 0.2, M.bodyTop, M.capRise, look.roof);
    return;
  }
  const alongX = b.w >= b.d;
  if (lod > 1) {   // 看得到的兩面牆＋兩片屋頂＋兩個山牆的三角
    g.quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], TAR);
    g.quad([x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0], [1, 0, 0], TAR);
    g.gable(x0, z0, x1, z1, h, QUAY.rise, alongX, look.roof, TAR);
    return;
  }
  g.box(x0, 0, z0, x1, h, z1, TAR, null);
  g.gable(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, h, QUAY.rise, alongX, look.roof, TAR);
  const m = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2;
  if (alongX) patch(g, 'z', z1 + 0.005, m - 0.07, m + 0.07, 0.05, 1.0, QUAY_DOOR); else patch(g, 'x', x1 + 0.005, m - 0.07, m + 0.07, 0.05, 1.0, QUAY_DOOR);
}
