// R088 建築破壞的過程（只改畫面）：照耐久把「完好」與「空殼」再分幾段樣子。只讀那一棟建築（耐久、種類、位置、大小），
// 位置只用 hash2(b.id, k, 88)；不讀世界、不抽亂數、不看時間——同一棟同一個耐久，誰畫都一樣（重播、讀檔、連線的兩邊）。
// 段（lost＝耐久上限−耐久，整數比）：T0 少於 5%（跟今天一模一樣）、T1 5–13%、T2 14–21%、T3 22% 到變空殼之前、
// T4 空殼少於 65%（今天的空殼）、T5 空殼 65% 以上（塌一半）、瓦礫（今天的瓦礫）。
// 鏡頭固定從 +x、+z 看：洞、缺口、裂縫只畫在看得到的那兩面與那一面屋頂。
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { hash2 } from '../sim/rng.ts';
import { stageOf, STAGE_INTACT, STAGE_ROOFLESS, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_OAST, BK_MILL, BK_WAREHOUSE, type Building } from '../sim/world.ts';

type V3 = [number, number, number];
export const WEAR_RUBBLE = 6;
const h88 = (b: Building, k: number): number => hash2(b.id, k, 88);
// 哪幾種有洞與缺口（R138 的五種民房）、哪幾種會塌（再加 R087 的三種）
const HOLES = new Set([BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP]);
const SAG = new Set([BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_OAST, BK_MILL, BK_WAREHOUSE]);
// 會損壞的建築：民房與 R087 三種；1×1 的「教堂」（萊伊的 Ypres 塔、Landgate 城門塔）是石塔、沒有中殿，照今天的三段（審查 R088-small-church）
export const wearable = (b: { kind: number; w: number; d: number }): boolean => SAG.has(b.kind) && !(b.kind === BK_CHURCH && (b.w < 2 || b.d < 2));

// 這一棟現在是哪一段（只看耐久；整數比，沒有小數）
export function wearTier(b: Building): number {
  if (b.hp <= 0) return WEAR_RUBBLE;
  const lost = b.maxHp - b.hp;
  if (stageOf(b) === STAGE_ROOFLESS) return lost * 100 >= b.maxHp * 65 ? 5 : 4;
  return lost * 100 < b.maxHp * 5 ? 0 : lost * 100 < b.maxHp * 14 ? 1 : lost * 100 < b.maxHp * 22 ? 2 : 3;
}
// 段與階段配得上才畫損壞（T1–T3 是完好、T5 是空殼）；配不上（例如殘影拿別的階段畫）就照今天的
export const tierFits = (stage: number, tier: number): boolean => (stage === STAGE_INTACT ? tier >= 1 && tier <= 3 : stage === STAGE_ROOFLESS && tier === 5);

const CAVITY = new THREE.Color(0x1f1a17),   // 洞口（跟 R086 門洞、乾草口的 0x1e1c1a 分開，守衛才認得出哪些是這張畫的）
  CHAR = new THREE.Color(0x2b2724), BEAM = new THREE.Color(0x4a3626), CRACK = new THREE.Color(0x35302b), GLASS = new THREE.Color(0x2a3038);
const same = (geo: Geo, i: number, c: THREE.Color) => Math.abs(geo.col[i] - c.r) < 1e-6 && Math.abs(geo.col[i + 1] - c.g) < 1e-6 && Math.abs(geo.col[i + 2] - c.b) < 1e-6;

// 看得到的牆面（+x 或 +z）：那一面的平面、沿牆的範圍、貼在牆上的東西（門、窗、框、招牌、木構……）的範圍
interface Face { axis: 0 | 2; at: number; lo: number; hi: number; top: number; blocked: [number, number, number, number][] }
function faceOf(geo: Geo, b: Building, axis: 0 | 2, h: number): Face | null {
  const at = axis === 0 ? b.x + b.w - 0.1 : b.z + b.d - 0.1, u = axis === 0 ? 2 : 0;
  let lo = Infinity, hi = -Infinity;
  const blocked: [number, number, number, number][] = [];
  for (let i = 0; i < geo.pos.length; i += 9) {
    if (geo.nor[i + axis] < 0.99) continue;
    let flat = true, near = true;
    for (let k = 0; k < 3; k++) { const d = geo.pos[i + 3 * k + axis] - at; if (Math.abs(d) > 1e-4) flat = false; if (d < -1e-4 || d > 0.06) near = false; }
    const us = [0, 1, 2].map(k => geo.pos[i + 3 * k + u]), ys = [0, 1, 2].map(k => geo.pos[i + 3 * k + 1]);
    if (flat && Math.max(...ys) > 0.2) { lo = Math.min(lo, ...us); hi = Math.max(hi, ...us); }
    else if (near) blocked.push([Math.min(...us) - 0.02, Math.max(...us) + 0.02, Math.min(...ys) - 0.02, Math.max(...ys) + 0.02]);
  }
  return lo < hi ? { axis, at, lo, hi, top: h, blocked } : null;
}
const free = (f: Face, u0: number, u1: number, y0: number, y1: number) => u0 >= f.lo + 0.04 && u1 <= f.hi - 0.04 && y0 >= 0.05 && y1 <= f.top - 0.08
  && !f.blocked.some(([a, b, c, d]) => u0 < b && u1 > a && y0 < d && y1 > c);
// 牆面上一塊（u、y 是沿牆、高度；off＝離牆面多遠）
function patch(g: Geo, f: Face, u0: number, u1: number, y0: number, y1: number, off: number, c: THREE.Color): void {
  const p = (u: number, y: number): V3 => (f.axis === 0 ? [f.at + off, y, u] : [u, y, f.at + off]);
  g.quad(p(u0, y0), p(u1, y0), p(u1, y1), p(u0, y1), f.axis === 0 ? [1, 0, 0] : [0, 0, 1], c);
}
// 一個洞：暗的洞口＋四塊崩掉的邊（牆色淺一點）
function hole(g: Geo, f: Face, uc: number, yc: number, hw: number, hh: number, rim: THREE.Color): void {
  patch(g, f, uc - hw, uc + hw, yc - hh, yc + hh, 0.02, CAVITY);
  const t = 0.028;
  patch(g, f, uc - hw - t, uc + hw * 0.4, yc + hh, yc + hh + t, 0.022, rim);
  patch(g, f, uc - hw * 0.2, uc + hw + t, yc - hh - t, yc - hh, 0.022, rim);
  patch(g, f, uc - hw - t, uc - hw, yc - hh * 0.6, yc + hh * 0.5, 0.022, rim);
  patch(g, f, uc + hw, uc + hw + t, yc - hh * 0.3, yc + hh * 0.8, 0.022, rim);
}
// 在一面牆上找一塊空的地方（照雜湊試，最多 24 次）
function spot(f: Face, b: Building, k0: number, hw: number, hh: number): [number, number] | null {
  for (let k = 0; k < 24; k++) {
    const uc = f.lo + hw + 0.08 + h88(b, k0 + 2 * k) * (f.hi - f.lo - 2 * hw - 0.16), yc = 0.1 + hh + h88(b, k0 + 2 * k + 1) * (f.top - 0.3 - 2 * hh);
    if (free(f, uc - hw - 0.03, uc + hw + 0.03, yc - hh - 0.03, yc + hh + 0.03)) return [uc, yc];
  }
  return null;
}

// 屋頂的缺口：看得到的那一面坡上一塊掉了瓦（暗）＋兩根椽子
function roofGap(g: Geo, base: Geo, b: Building, roof: THREE.Color, big: boolean): [number, number] {
  const alongX = b.kind === BK_CHURCH ? false : b.w >= b.d;
  let best = -1, area = 0;
  for (let i = 0; i < base.pos.length; i += 9) {
    if (!same(base, i, roof) || base.nor[i + 1] < 0.3 || (alongX ? base.nor[i + 2] : base.nor[i]) < 0.3) continue;
    const a = triArea(base, i);
    if (a > area) { area = a; best = i; }
  }
  if (best < 0 || area < 0.04) return [0, 0];
  const v0 = g.pos.length;
  const P = (k: number): V3 => [base.pos[best + 3 * k], base.pos[best + 3 * k + 1], base.pos[best + 3 * k + 2]];
  const [a, c, d] = [P(0), P(1), P(2)], m: V3 = [(a[0] + c[0] + d[0]) / 3, (a[1] + c[1] + d[1]) / 3, (a[2] + c[2] + d[2]) / 3];
  const n: V3 = [base.nor[best], base.nor[best + 1], base.nor[best + 2]], e1: V3 = alongX ? [1, 0, 0] : [0, 0, 1];
  const e2 = norm(cross(n, e1)), hw = big ? 0.17 : 0.11, hd = big ? 0.1 : 0.07;
  const at = (s: number, t: number, lift: number): V3 => [m[0] + e1[0] * s + e2[0] * t + n[0] * lift, m[1] + e1[1] * s + e2[1] * t + n[1] * lift, m[2] + e1[2] * s + e2[2] * t + n[2] * lift];
  g.quad(at(-hw, -hd, 0.012), at(hw, -hd, 0.012), at(hw, hd, 0.012), at(-hw, hd, 0.012), n, CHAR);
  for (const s of [-hw / 3, hw / 3]) g.quad(at(s - 0.012, -hd, 0.018), at(s + 0.012, -hd, 0.018), at(s + 0.012, hd, 0.018), at(s - 0.012, hd, 0.018), n, BEAM);
  return [v0, g.pos.length];
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function triArea(geo: Geo, i: number): number {
  const p = geo.pos, u: V3 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]], v: V3 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]], c = cross(u, v);
  return Math.hypot(c[0], c[1], c[2]) / 2;
}
// 打破一扇看得到的窗：玻璃上蓋一塊暗的
function brokenWindow(g: Geo, base: Geo, b: Building): void {
  const glass: number[] = [];
  for (let i = 0; i < base.pos.length; i += 9) if (same(base, i, GLASS)) {   // 只要貼在看得到的牆面上（或在它前面）的玻璃；?noR134=1 的窗框盒側面不算（審查 R088-window-box）
    const ax = base.nor[i] > 0.99 ? 0 : base.nor[i + 2] > 0.99 ? 2 : -1;
    if (ax >= 0 && base.pos[i + ax] >= (ax === 0 ? b.x + b.w - 0.1 : b.z + b.d - 0.1) - 1e-3) glass.push(i);
  }
  if (!glass.length) return;
  const i = glass[Math.min(glass.length - 1, Math.floor(h88(b, 90) * glass.length))], axis = base.nor[i] > 0.99 ? 0 : 2, u = axis === 0 ? 2 : 0;
  // 那一片玻璃（同一個平面、相連的兩個三角形）的範圍
  const at = base.pos[i + axis];
  let u0 = Infinity, u1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const j of glass) {
    if (Math.abs(base.pos[j + axis] - at) > 1e-5) continue;
    const us = [0, 1, 2].map(k => base.pos[j + 3 * k + u]), ys = [0, 1, 2].map(k => base.pos[j + 3 * k + 1]);
    const cu = (Math.min(...us) + Math.max(...us)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, iu = [0, 1, 2].map(k => base.pos[i + 3 * k + u]), iy = [0, 1, 2].map(k => base.pos[i + 3 * k + 1]);
    if (cu < Math.min(...iu) - 0.01 || cu > Math.max(...iu) + 0.01 || cy < Math.min(...iy) - 0.01 || cy > Math.max(...iy) + 0.01) continue;
    u0 = Math.min(u0, ...us); u1 = Math.max(u1, ...us); y0 = Math.min(y0, ...ys); y1 = Math.max(y1, ...ys);
  }
  patch(g, { axis, at, lo: 0, hi: 0, top: 0, blocked: [] }, u0 + 0.004, u1 - 0.004, y0 + 0.004, y1 - 0.004, 0.003, CAVITY);
}
// 裂縫：三小段鋸齒
function crack(g: Geo, f: Face, b: Building): void {
  const s = spot(f, b, 60, 0.06, 0.11);
  if (!s) return;
  const [uc, yc] = s, dir = h88(b, 70) < 0.5 ? 1 : -1;
  for (let k = 0; k < 3; k++) { const y = yc + 0.08 - k * 0.075, u = uc + dir * (k % 2 ? 0.03 : -0.02); patch(g, f, u - 0.007, u + 0.007, y - 0.075, y, 0.021, CRACK); }
}

// T1、T2 的東西（洞、屋頂缺口、打破的窗、裂縫）；sites：之後打穿的洞那張卡指定要開在哪裡（沒給就照雜湊）
export interface WearSite { axis: 0 | 2; u: number; y: number }
export function wearOverlays(g: Geo, base: Geo, b: Building, tier: number, h: number, wall: THREE.Color, roof: THREE.Color, sites?: WearSite[]): [number, number] {
  if (!HOLES.has(b.kind) || tier < 1 || tier > 3) return [0, 0];
  const rim = wall.clone().lerp(new THREE.Color(0xd8cfbf), 0.55);   // 崩掉的邊：牆色偏亮（陰影那一面也看得出洞）
  const faces = [faceOf(base, b, 0, h), faceOf(base, b, 2, h)];
  const holes = tier === 1 ? 1 : 2;
  for (let k = 0; k < holes; k++) {
    const want = sites?.[k], f = want ? faces[want.axis === 0 ? 0 : 1] : faces[h88(b, 10 + k) < 0.3 ? 0 : 1] ?? faces[0] ?? faces[1];   // 七成在亮的那一面（+z）
    if (!f) continue;
    const big = k === 1 && f.hi - f.lo >= 1.6, hw = big ? 0.16 : 0.09, hh = big ? 0.13 : 0.075;
    const at = want ? (free(f, want.u - hw - 0.03, want.u + hw + 0.03, want.y - hh - 0.03, want.y + hh + 0.03) ? [want.u, want.y] as [number, number] : null) : spot(f, b, 20 + 50 * k, hw, hh);
    if (!at) continue;
    hole(g, f, at[0], at[1], hw, hh, rim);
    f.blocked.push([at[0] - hw - 0.05, at[0] + hw + 0.05, at[1] - hh - 0.05, at[1] + hh + 0.05]);
  }
  const gap = roofGap(g, base, b, roof, tier >= 2);
  brokenWindow(g, base, b);
  if (tier >= 2) { const f = faces[h88(b, 40) < 0.5 ? 1 : 0] ?? faces[0]; if (f) crack(g, f, b); }
  return gap;
}

// T3：屋頂靠一頭的地方塌下去。只把頂點往下移（不加三角形）：屋脊那一頭下沉 0.55 倍屋頂高、簷最多 0.12、牆頂附近 0.15 以內平順地接上
export function sagEnd(b: Building): { alongX: boolean; end: number; len: number } {
  if (b.kind === BK_CHURCH) return { alongX: false, end: b.z + b.d - 0.1, len: b.d - 1.1 };   // 教堂：中殿的屋脊沿 z，塌離塔遠的那一頭
  const alongX = b.w >= b.d, a0 = alongX ? b.x + 0.1 : b.z + 0.1, a1 = alongX ? b.x + b.w - 0.1 : b.z + b.d - 0.1;
  return { alongX, end: h88(b, 30) < 0.5 ? a0 : a1, len: a1 - a0 };
}
export function sagDrop(b: Building, x: number, y: number, z: number, h: number, rise: number): number {
  const s = sagEnd(b), a = s.alongX ? x : z, w = Math.max(0, Math.min(1, 1 - Math.abs(a - s.end) / (0.65 * s.len)));
  if (w <= 0 || y <= h - 0.15) return 0;
  if (b.kind === BK_CHURCH && x < b.x + 1.05 && z < b.z + 1.05) return 0;   // 鐘樓不跟著塌
  if (y < h) return w * 0.12 * (y - (h - 0.15)) / 0.15;
  return w * (0.12 + (0.55 * rise - 0.12) * Math.min(1, (y - h) / Math.max(rise, 1e-6)));
}
// T5：空殼塌一半（照雜湊挑一半）：0.25 倍牆高以上的頂點照比例壓到 0.35
export function halfSide(b: Building): { alongX: boolean; mid: number; sign: number } {
  const alongX = b.w >= b.d;
  return { alongX, mid: alongX ? b.x + b.w / 2 : b.z + b.d / 2, sign: h88(b, 31) < 0.5 ? 1 : -1 };
}
export const onFallenHalf = (b: Building, x: number, z: number): boolean => { const s = halfSide(b); return ((s.alongX ? x : z) - s.mid) * s.sign > 0; };
const halfY = (y: number, h: number) => (y > 0.25 * h ? 0.25 * h + (y - 0.25 * h) * 0.35 : y);
// 移動頂點之後重算法線（每個三角形一個；方向照原本的那一側）
function move(geo: Geo, f: (x: number, y: number, z: number) => number, after?: () => void): void {
  const p = geo.pos, n = geo.nor;
  for (let i = 0; i < p.length; i += 3) p[i + 1] = f(p[i], p[i + 1], p[i + 2]);
  after?.();
  for (let i = 0; i < p.length; i += 9) {
    const u: V3 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]], v: V3 = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
    let c = cross(u, v); const l = Math.hypot(c[0], c[1], c[2]);
    if (l < 1e-12) continue;
    c = [c[0] / l, c[1] / l, c[2] / l];
    if (c[0] * n[i] + c[1] * n[i + 1] + c[2] * n[i + 2] < 0) c = [-c[0], -c[1], -c[2]];
    for (let k = 0; k < 3; k++) { n[i + 3 * k] = c[0]; n[i + 3 * k + 1] = c[1]; n[i + 3 * k + 2] = c[2]; }
  }
}

// 給 buildings.ts 叫：base 是今天那一段的幾何（已經畫好），照段改它、往 g 加
export function wearGeo(g: Geo, base: Geo, b: Building, stage: number, tier: number, h: number, rise: number, wall: THREE.Color, roof: THREE.Color): void {
  if (stage === STAGE_INTACT) {
    const [g0, g1] = wearOverlays(base, base, b, tier, h, wall, roof);
    if (tier === 3) {
      // 屋頂缺口與椽子：塌下去之後重新貼回塌了的屋頂上（不然它照自己那一點的下沉量走，會浮在屋頂上面；審查 R088-gap-float）
      const flat = g1 > g0 ? base.pos.slice() : null;
      move(base, (x, y, z) => y - sagDrop(b, x, y, z, h, rise), () => { if (flat) reseat(base, flat, g0, g1, roof); });
    }
  } else if (tier === 5) {
    move(base, (x, y, z) => (onFallenHalf(b, x, z) ? halfY(y, h) : y));
    const s = halfSide(b), dark = wall.clone().multiplyScalar(0.7);
    if (HOLES.has(b.kind)) for (let k = 0; k < 2; k++) {   // 兩堆碎磚、一根倒下的梁（在塌的那一半；R087 三種的基座、烘爐是實心的，不放——審查 R088-buried-heaps）
      const lo = (s.alongX ? b.x : b.z) + 0.26, hi = (s.alongX ? b.x + b.w : b.z + b.d) - 0.26;   // 堆在牆裡面
      const t = h88(b, 50 + k), a = Math.max(lo, Math.min(hi, s.mid + s.sign * (0.15 + 0.25 * t))), c = (s.alongX ? b.z : b.x) + 0.3 + 0.4 * h88(b, 52 + k);
      const [x, z] = s.alongX ? [a, c] : [c, a];
      base.pyramid(x - 0.14, z - 0.12, x + 0.14, z + 0.12, 0, 0.12 + 0.06 * t, k ? dark : wall);
    }
    const a = s.mid + s.sign * 0.2, c0 = (s.alongX ? b.z : b.x) + 0.2, c1 = (s.alongX ? b.z + b.d : b.x + b.w) - 0.2;
    if (!HOLES.has(b.kind)) { /* R087 三種：沒有倒下的梁 */ } else if (s.alongX) base.box(a - 0.03, 0.02, c0, a + 0.03, 0.08, c1, BEAM); else base.box(c0, 0.02, a - 0.03, c1, 0.08, a + 0.03, BEAM);
  }
  for (let i = 0; i < base.pos.length; i++) { g.pos.push(base.pos[i]); g.nor.push(base.nor[i]); g.col.push(base.col[i]); }
}
// 那一段（照 wearGeo 改過）在 (x, z) 的牆頂有多高：R014 的彈痕不能留在它上面（只看會降的那兩段）
export function wearTop(b: Building, tier: number, x: number, z: number, h: number, rise: number): number {
  // 畫出來的牆頂的下界（審查 R088-marks）：T3 照牆頂那條邊（塌的那一角降 0.12、另一角不降，中間直線）；T5 塌的那一半與跨過中線的那一段牆都當作降到最矮的鋸齒（0.7×0.72h 壓過）
  if (tier === 3) { const e = sagEnd(b), a = e.alongX ? x : z; void rise; return h - 0.12 * Math.max(0, 1 - Math.abs(a - e.end) / Math.max(e.len, 1e-6)); }   // 牆頂那一條邊是從塌的那一角拉到另一角的直線（中間的頂點只降得比它少）
  if (tier === 5) { const s = halfSide(b), len = (s.alongX ? b.w : b.d) - 0.2; return ((s.alongX ? x : z) - s.mid) * s.sign > -len / 6 ? halfY(0.7 * 0.72 * h, h) : Infinity; }
  return Infinity;
}
// 殘影用：屋頂——在沒塌的那一份（ref，T3 時是同一棟的 T2；三角形一樣多、一樣的順序）裡伸到簷以上的三角形，座標拿 geo 的（審查 R088-roof-fall：
// 用「每個頂點都在簷以上」會漏掉塌下去的那一頭，也會讓尖塔、風車的帽子、烘爐的風帽沒有底下撐著的東西就浮著）
export function roofSlice(geo: Geo, h: number, ref: Geo = geo): Geo {
  const out = new Geo();
  for (let i = 0; i < ref.pos.length; i += 9) if (Math.max(ref.pos[i + 1], ref.pos[i + 4], ref.pos[i + 7]) > h + 1e-4) for (let k = i; k < i + 9; k++) { out.pos.push(geo.pos[k]); out.nor.push(geo.nor[k]); out.col.push(geo.col[k]); }
  return out;
}
// T3：把 [v0, v1) 那幾個頂點（屋頂缺口）重新貼到塌了的屋頂上：在塌之前離屋頂多高，塌之後還是離屋頂多高（x、z 不動）
function reseat(geo: Geo, flat: number[], v0: number, v1: number, roof: THREE.Color): void {
  const roofTris: number[] = [];
  for (let i = 0; i < v0; i += 9) if (same(geo, i, roof) && geo.nor[i + 1] > 0.3) roofTris.push(i);
  const heightAt = (p: number[], i: number, x: number, z: number): number | null => {
    const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) return null;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    return l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6 ? null : l1 * p[i + 1] + l2 * p[i + 4] + l3 * p[i + 7];
  };
  for (let v = v0; v < v1; v += 3) {
    const x = geo.pos[v], z = geo.pos[v + 2];
    let before: number | null = null, after: number | null = null;
    for (const i of roofTris) { const a = heightAt(flat, i, x, z), c = heightAt(geo.pos, i, x, z); if (a !== null && c !== null && (before === null || a > before)) { before = a; after = c; } }
    if (before !== null && after !== null) geo.pos[v + 1] = Math.min(flat[v + 1], after + (flat[v + 1] - before));
  }
}
// 殘影用：照三角形中心分成兩半。T5 塌的那一半先倒；完好就倒的，上半先倒（first＝先倒的那一半）
export function splitHalves(geo: Geo, b: Building, tier: number, h: number): { first: Geo; second: Geo } {
  const first = new Geo(), second = new Geo();
  for (let i = 0; i < geo.pos.length; i += 9) {
    const cx = (geo.pos[i] + geo.pos[i + 3] + geo.pos[i + 6]) / 3, cy = (geo.pos[i + 1] + geo.pos[i + 4] + geo.pos[i + 7]) / 3, cz = (geo.pos[i + 2] + geo.pos[i + 5] + geo.pos[i + 8]) / 3;
    const to = (tier >= 4 ? onFallenHalf(b, cx, cz) : cy > 0.5 * h) ? first : second;
    for (let k = i; k < i + 9; k++) { to.pos.push(geo.pos[k]); to.nor.push(geo.nor[k]); to.col.push(geo.col[k]); }
  }
  return { first, second };
}
