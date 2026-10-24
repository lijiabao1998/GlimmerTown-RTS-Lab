// R015 小地圖：上半是純函式（座標換算、要畫哪些點，Node 守衛直接測），下半是 DOM 畫布。只讀世界、不改世界。
import { cellIdx, TER_ROAD, TER_FIELD, TER_MUD, SIDE_PLAYER, STAGE_RUBBLE, stageOf, type World, type Unit } from '../sim/world.ts';
import { drawCounterbattery } from './counterbattery.ts';
import { VEG_HEDGE, VEG_WOOD, vegetationAt } from '../sim/vegetation.ts';
import { TrenchRaster, TRENCH_E, TRENCH_S, TRENCH_W, TRENCH_N, TRENCH_MINI_COLORS } from '../render/trenches.ts';

// 菱形，方向跟主畫面一樣：主畫面的「右」＝世界 (+x,−z)、「上」＝世界 (−x,−z)。
// 小地圖 px = w/2 + (x − z)·s、py = (x + z)·s/2，s = w/(2n)，n＝世界的地圖邊長 w.n；整張高 = w/2。
// n 預設 32 只給舊守衛的一參數呼叫；畫面一律傳世界的 w.n（R042）。
export interface MiniGeo { w: number; h: number; s: number }
export const miniGeo = (w: number, n = 32): MiniGeo => ({ w, h: w / 2, s: w / (2 * n) });
export function toMini(g: MiniGeo, x: number, z: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = g.w / 2 + (x - z) * g.s; out[1] = ((x + z) * g.s) / 2; return out;
}
export function fromMini(g: MiniGeo, px: number, py: number): [number, number] {
  const a = (px - g.w / 2) / g.s, b = (2 * py) / g.s;   // a = x − z、b = x + z
  return [(a + b) / 2, (b - a) / 2];
}
export interface Dot { x: number; z: number; side: number }
// 要畫的點：我方活著的全部；敵方只有看得到的（R100）；死掉的不畫
export function miniDots(w: World, visible: (u: Unit) => boolean): Dot[] {
  const out: Dot[] = [];
  for (const u of w.units) if (u.alive && (u.side === SIDE_PLAYER || visible(u))) out.push({ x: u.x / 256, z: u.z / 256, side: u.side });
  return out;
}

// ---- DOM ----
export interface Minimap { frame: (t: number) => void; dirty: () => void; el: HTMLCanvasElement; point: (x: number, z: number) => [number, number] }

export function initMinimap(a: { world: () => World; visible: (u: Unit) => boolean; view: () => [number, number][]; tap: (x: number, z: number) => void; counterbattery?: boolean; vegetation?: boolean; trenches?: boolean }): Minimap {
  const cvs = document.createElement('canvas');
  cvs.id = 'minimap';
  (document.getElementById('hud') ?? document.body).appendChild(cvs);
  const base = document.createElement('canvas');
  let baseDirty = true, last = -1, g = miniGeo(160), dpr = 1, gridN = 0;
  let baseWorld: World | undefined;
  let baseVegetation: World['vegetation'];
  const trenchRaster = new TrenchRaster(a.trenches !== false);
  const counterbatteryPoint: [number, number] = [0, 0];
  const counterbatteryProject = (x: number, z: number) => toMini(g, x, z, counterbatteryPoint);
  const cell = (ctx: CanvasRenderingContext2D, x: number, z: number) => {   // 一格＝一個小菱形
    const [p0x, p0y] = toMini(g, x, z), [p1x, p1y] = toMini(g, x + 1, z), [p2x, p2y] = toMini(g, x + 1, z + 1), [p3x, p3y] = toMini(g, x, z + 1);
    ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.closePath(); ctx.fill();
  };
  function paintBase(w: World) {
    trenchRaster.sync(w, true);
    const ctx = base.getContext('2d')!;
    base.width = Math.round(g.w * dpr); base.height = Math.round(g.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) {
      const i = cellIdx(w, x, z), t = w.ter[i], id = w.occ[i], b = id ? w.blds[id - 1] : null;
      ctx.fillStyle = b ? (stageOf(b) === STAGE_RUBBLE ? '#6f6559' : b.builtBy === SIDE_PLAYER ? '#a9c4e6' : '#cfc3a8')
        : w.crater[i] ? '#4a3f33' : t === TER_ROAD ? '#8f7f62' : t === TER_FIELD ? '#9a9450' : t === TER_MUD ? '#4d6470' : '#5b7a42';
      cell(ctx, x, z);
      const foliage = a.vegetation !== false ? vegetationAt(w, x, z) : 0;
      if (!b && foliage) {
        const [px, py] = toMini(g, x + 0.5, z + 0.5);
        ctx.fillStyle = foliage === VEG_HEDGE ? '#c4cf80' : '#314b30';
        // 樹籬＝細短線，小樹林＝深綠小菱形；不佔用聲測圈或單位圖層。
        if (foliage === VEG_HEDGE) ctx.fillRect(px - g.s * 0.42, py - 0.45, g.s * 0.84, 0.9);
        else if (foliage === VEG_WOOD) { ctx.beginPath(); ctx.moveTo(px, py - 1.2); ctx.lineTo(px + 1.2, py); ctx.lineTo(px, py + 1.2); ctx.lineTo(px - 1.2, py); ctx.closePath(); ctx.fill(); }
      }
    }
    // 先畫完地格，再疊接線；跨格的線不會被下一格底色蓋住。
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) {
      const i = cellIdx(w, x, z), kind = trenchRaster.kinds[i] - 1;
      if (kind < 0 || w.occ[i]) continue;
      const links = trenchRaster.links[i], [cx, cy] = toMini(g, x + 0.5, z + 0.5);
      ctx.beginPath();
      if (links & TRENCH_E) { const [px, py] = toMini(g, x + 1, z + 0.5); ctx.moveTo(cx, cy); ctx.lineTo(px, py); }
      if (links & TRENCH_S) { const [px, py] = toMini(g, x + 0.5, z + 1); ctx.moveTo(cx, cy); ctx.lineTo(px, py); }
      if (links & TRENCH_W) { const [px, py] = toMini(g, x, z + 0.5); ctx.moveTo(cx, cy); ctx.lineTo(px, py); }
      if (links & TRENCH_N) { const [px, py] = toMini(g, x + 0.5, z); ctx.moveTo(cx, cy); ctx.lineTo(px, py); }
      ctx.strokeStyle = '#30291f'; ctx.lineWidth = kind === 2 ? 1.8 : 2.6; ctx.stroke();
      ctx.strokeStyle = TRENCH_MINI_COLORS[kind]; ctx.lineWidth = kind === 2 ? 0.7 : 1.2; ctx.stroke();
      if (kind === 3) { ctx.fillStyle = '#f0d9aa'; ctx.fillRect(cx - 0.6, cy - 0.6, 1.2, 1.2); }
    }
    baseDirty = false;
    baseWorld = w;
    baseVegetation = w.vegetation;
  }
  function frame(t: number) {
    const w = a.world();
    if (w !== baseWorld) baseDirty = true;   // 換局先失效，不能被上一局的 100ms 節流擋住。
    if (w === baseWorld && w.vegetation !== baseVegetation) baseDirty = true;   // 同一個世界在 tick0 經紀錄啟用也立即換底圖。
    if (trenchRaster.sync(w)) baseDirty = true;   // 同一世界的首次啟用／追加段也先於 100ms 節流。
    if (t - last < 100 && !baseDirty) return;   // 一秒最多重畫 10 次
    last = t;
    const cssW = innerWidth < 640 ? 150 : 200;
    if (g.w !== cssW || dpr !== Math.min(devicePixelRatio || 1, 2) || gridN !== w.n) { g = miniGeo(cssW, w.n); gridN = w.n; dpr = Math.min(devicePixelRatio || 1, 2); baseDirty = true; }
    if (baseDirty) paintBase(w);
    cvs.width = Math.round(g.w * dpr); cvs.height = Math.round(g.h * dpr);
    cvs.style.width = `${g.w}px`; cvs.style.height = `${g.h}px`;
    const ctx = cvs.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCounterbattery(ctx, w, counterbatteryProject, a.counterbattery !== false, w.n);
    for (const d of miniDots(w, a.visible)) {
      const [px, py] = toMini(g, d.x, d.z);
      ctx.fillStyle = d.side === SIDE_PLAYER ? '#4aa3ff' : '#ff5a3c';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    const poly = a.view();
    if (poly.length === 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath();
      poly.forEach(([x, z], k) => { const [px, py] = toMini(g, x, z); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath(); ctx.stroke();
    }
  }
  const pick = (e: PointerEvent) => { const r = cvs.getBoundingClientRect(); return fromMini(g, e.clientX - r.left, e.clientY - r.top); };
  cvs.addEventListener('pointerdown', e => e.stopPropagation());
  cvs.addEventListener('pointerup', e => { e.stopPropagation(); const [x, z] = pick(e), n = a.world().n; if (x >= 0 && z >= 0 && x <= n && z <= n) a.tap(x, z); });
  return { frame, dirty: () => { baseDirty = true; }, el: cvs, point: (x, z) => { const r = cvs.getBoundingClientRect(), [px, py] = toMini(g, x, z); return [r.left + px, r.top + py]; } };
}
