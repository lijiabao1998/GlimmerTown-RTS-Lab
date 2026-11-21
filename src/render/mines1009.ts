// R1009 地雷刻進地面貼圖（R118 戰壕的做法）：每格 8×8 像素的花樣，不加網格、不多繪製呼叫、不多三角形。
// 只畫「我方知道的雷」（known1009；我方＝side.ts 的 SIDE_PLAYER，連線對戰時是自己那一方）：自己布好的反戰車雷兩個半埋的深色圓盤、
// 反人員雷四個小點（觸角）；自己還在布的一塊翻過的褐土；知道的敵方雷同樣的花樣，格子角上多一根頂端紅色的標樁（一格同時有兩種時畫敵方的）。
// battle.ts 只改兩處：import、建構時把 TrenchRaster 換成 withMines1009(TrenchRaster) 並給兩個閉包（paint＝重畫一格、dirty＝R098 只傳改過的格列）。
// 底下的戰壕類別由 battle.ts 傳進來（不在這裡 import）：tests/trenches-view.mjs 把 battle.ts 的 './trenches.ts' 換成改壞的副本，雷那一層要疊在同一份上（施工紀錄 4）。
// 不 import three：Node 的守衛直接拿來跑。
import { cellIdx, inGrid, type World, type Mine1009 } from '../sim/world.ts';
import { known1009 } from '../sim/mines1009.ts';
import type { TrenchRaster } from './trenches.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）

// 每格一個位元組：0 沒有；1 自己的反戰車雷、2 自己的反人員雷、3 自己還在布的；4–6 同樣三種、但是知道的敵方雷（多一根標樁）
export const code1009 = (m: Mine1009, me: number): number => (m.left > 0 ? 3 : m.kind) + (m.side === me ? 0 : 3);
const DISC = 0x3b3a30, DISC_RIM = 0x6e6a58, PRONG = 0x24221d, PRONG_TIP = 0x8f8a78, SOIL = [0x6a4a2c, 0x5a3d24, 0x7a5a38], STAKE = 0xe2d6b4, STAKE_TOP = 0xc8231c;

type RasterClass = new (enabled: boolean) => TrenchRaster;
const made = new WeakMap<RasterClass, ReturnType<typeof make>>();
// 戰壕類別（battle.ts 的那一份）加上雷那一層；同一個底類別只做一次
export const withMines1009 = (Base: RasterClass): ReturnType<typeof make> => { let c = made.get(Base); if (!c) { c = make(Base); made.set(Base, c); } return c; };
const make = (Base: RasterClass) => class TrenchMines1009 extends Base {
  mines = new Uint8Array(0);            // 現在畫在地上的（每格一個位元組，見 code1009）
  private want = new Uint8Array(0);     // 這一次算出來的（算完就清回 0）
  private mn = 0;
  private live: number[] = [];          // mines 不是 0 的格
  private next: number[] = [];
  private changed: number[] = [];
  private first = true;
  minePaints = 0;                       // 守衛用：叫過幾次 paint、dirty
  mineDirty = 0;
  private readonly paint: (x: number, z: number) => void;
  private readonly dirty: () => void;
  constructor(enabled: boolean, paint: (x: number, z: number) => void, dirty: () => void) { super(enabled); this.paint = paint; this.dirty = dirty; }

  // 戰壕照舊（回傳值原樣：整張重畫照舊）；再照 w.mines 和當下的「我方」重算雷的表，變了的格叫 paint、有畫就叫一次 dirty。
  // 第一次（BattleView 建構時，地面貼圖還沒配置）只建表；之後每一步、換世界都照新世界重算（雷的表不看 enabled：?noR118=1 照樣畫雷）
  sync(w: World, changed = false): boolean {
    const r = super.sync(w, changed), n = w.n, me = SIDE_PLAYER;
    if (this.mn !== n) { this.mn = n; this.mines = new Uint8Array(n * n); this.want = new Uint8Array(n * n); this.live.length = 0; }
    const want = this.want, next = this.next, out = this.changed;
    next.length = 0; out.length = 0;
    for (const m of w.mines?.cells ?? []) {
      if (!known1009(w, me, m) || !inGrid(w, m.x, m.z)) continue;
      const i = cellIdx(w, m.x, m.z), c = code1009(m, me);
      if (!want[i]) next.push(i);
      if (!want[i] || c > 3) want[i] = c;
    }
    for (const i of this.live) if (this.mines[i] !== want[i]) out.push(i);
    for (const i of next) if (!this.mines[i]) out.push(i);
    for (const i of this.live) this.mines[i] = 0;
    for (const i of next) { this.mines[i] = want[i]; want[i] = 0; }
    this.next = this.live; this.live = next;
    if (this.first) { this.first = false; return r; }
    for (const i of out) { this.paint(i % n, (i - (i % n)) / n); this.minePaints++; }
    if (out.length) { this.dirty(); this.mineDirty++; }
    return r;
  }

  // 戰壕那一格照舊畫戰壕；沒有戰壕才畫雷（-1＝保留既有地面）
  pixel(cell: number, px: number, py: number): number {
    if (this.kinds[cell]) return super.pixel(cell, px, py);
    const c = this.mines[cell] ?? 0;
    if (!c) return -1;
    if (c > 3 && px === 6 && py <= 2) return py === 0 ? STAKE_TOP : STAKE;   // 敵方雷：排雷的人插的標樁（頂端紅色）
    const k = c > 3 ? c - 3 : c;
    if (k === 3) { const dx = px - 3.5, dz = py - 3.5; return dx * dx + dz * dz <= 9 ? SOIL[(px * 3 + py * 5) % 3] : -1; }   // 還在布：翻過的褐土
    if (k === 1) {   // 反戰車雷：兩個半埋的深色圓盤
      for (const [ox, oz] of [[2, 2], [5, 5]]) { const dx = px - ox, dz = py - oz, d = dx * dx + dz * dz; if (d <= 2) return dx < 0 && dz < 0 ? DISC_RIM : DISC; }
      return -1;
    }
    for (const [ox, oz] of [[2, 3], [5, 2], [3, 5], [5, 5]]) if (px === ox && py === oz) return PRONG;   // 反人員雷：四個小點（觸角）
    return (px === 2 && py === 2) || (px === 5 && py === 1) || (px === 3 && py === 4) || (px === 5 && py === 4) ? PRONG_TIP : -1;
  }
};
