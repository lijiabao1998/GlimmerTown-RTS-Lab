// R015 小地圖：上半是純函式（座標換算、要畫哪些點，Node 守衛直接測），下半是 DOM 畫布。只讀世界、不改世界。
import { N, TER_ROAD, TER_FIELD, TER_MUD, SIDE_PLAYER, STAGE_RUBBLE, stageOf, type World, type Unit } from '../sim/world.ts';

// 菱形，方向跟主畫面一樣：主畫面的「右」＝世界 (+x,−z)、「上」＝世界 (−x,−z)。
// 小地圖 px = w/2 + (x − z)·s、py = (x + z)·s/2，s = w/(2N)；整張高 = w/2。
export interface MiniGeo { w: number; h: number; s: number }
export const miniGeo = (w: number): MiniGeo => ({ w, h: w / 2, s: w / (2 * N) });
export function toMini(g: MiniGeo, x: number, z: number): [number, number] { return [g.w / 2 + (x - z) * g.s, ((x + z) * g.s) / 2]; }
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

export function initMinimap(a: { world: () => World; visible: (u: Unit) => boolean; view: () => [number, number][]; tap: (x: number, z: number) => void }): Minimap {
  const cvs = document.createElement('canvas');
  cvs.id = 'minimap';
  (document.getElementById('hud') ?? document.body).appendChild(cvs);
  const base = document.createElement('canvas');
  let baseDirty = true, last = -1, g = miniGeo(160), dpr = 1;
  const cell = (ctx: CanvasRenderingContext2D, x: number, z: number) => {   // 一格＝一個小菱形
    const [p0x, p0y] = toMini(g, x, z), [p1x, p1y] = toMini(g, x + 1, z), [p2x, p2y] = toMini(g, x + 1, z + 1), [p3x, p3y] = toMini(g, x, z + 1);
    ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.closePath(); ctx.fill();
  };
  function paintBase() {
    const w = a.world(), ctx = base.getContext('2d')!;
    base.width = Math.round(g.w * dpr); base.height = Math.round(g.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, g.w, g.h);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, t = w.ter[i], id = w.occ[i], b = id ? w.blds[id - 1] : null;
      ctx.fillStyle = b ? (stageOf(b) === STAGE_RUBBLE ? '#6f6559' : b.builtBy === SIDE_PLAYER ? '#a9c4e6' : '#cfc3a8')
        : w.crater[i] ? '#4a3f33' : t === TER_ROAD ? '#8f7f62' : t === TER_FIELD ? '#9a9450' : t === TER_MUD ? '#4d6470' : '#5b7a42';
      cell(ctx, x, z);
    }
    baseDirty = false;
  }
  function frame(t: number) {
    if (t - last < 100 && !baseDirty) return;   // 一秒最多重畫 10 次
    last = t;
    const cssW = innerWidth < 640 ? 150 : 200;
    if (g.w !== cssW || dpr !== Math.min(devicePixelRatio || 1, 2)) { g = miniGeo(cssW); dpr = Math.min(devicePixelRatio || 1, 2); baseDirty = true; }
    if (baseDirty) paintBase();
    cvs.width = Math.round(g.w * dpr); cvs.height = Math.round(g.h * dpr);
    cvs.style.width = `${g.w}px`; cvs.style.height = `${g.h}px`;
    const ctx = cvs.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of miniDots(a.world(), a.visible)) {
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
  cvs.addEventListener('pointerup', e => { e.stopPropagation(); const [x, z] = pick(e); if (x >= 0 && z >= 0 && x <= N && z <= N) a.tap(x, z); });
  return { frame, dirty: () => { baseDirty = true; }, el: cvs, point: (x, z) => { const r = cvs.getBoundingClientRect(), [px, py] = toMini(g, x, z); return [r.left + px, r.top + py]; } };
}
