// R093 介面：生產列「防空」那一組；「空中」鍵（點一下＝轟炸、再點＝偵察、再點＝取消；選好之後點地圖＝叫飛機）；鍵上的提醒字。
// 只讀世界、產生指令（點地圖那一下由 smoke.ts 的 routeBattleOrder 開頭轉過來，指令照常經 issue() 記紀錄、走鎖步）。
// import 這個模組時不碰 DOM（Node 的守衛會 import smoke.ts）。卡面：docs/tasks/R093-空中支援與防空.md
import { UNIT_KINDS, UK_AA, center, cellOf, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import { STRIKE93, RECON93, COST93, HOLD93 } from '../sim/air93.ts';
import { hqAlive } from '../sim/eco.ts';
import { spotted } from '../sim/step.ts';
import type { OrderHit, OrderRoute } from './smoke.ts';

export const aa93Items = () => [
  { kind: UK_AA, label: '防空砲', cost: UNIT_KINDS[UK_AA].cost, group: '防空', role: '防空砲 · 只打飛機：8 格內每秒兩發，一門把俯衝轟炸打偏、兩門在投彈前打下來；不打地面，怕砲兵和步兵；要卡車或半履帶車拖；電腦不派飛機，對戰才用得上' },
];

let armed = 0;          // 0 沒選、1 轟炸、2 偵察（只在這一頁，不進模擬）
let flash = '', flashUntil = 0;
const NAME = ['', '轟炸', '偵察'];

// 這一方這一種現在叫不叫得出來：'' 可以；不然回原因（介面跟模擬的門一樣，只差「看不看得到」在點地圖時才查）
export function why93(w: World, side: number, kind: number): string {
  if (!w.eco?.air || w.zombies || w.sandbox || w.winner >= 0) return '不開放';
  if (!hqAlive(w, side)) return '指揮部倒了';
  const slot = side * 2 + kind - 1, ready = w.sky?.ready[slot] ?? 0;
  if (w.sky?.planes.some(p => p.side === side && p.kind === kind)) return '天上有一架';
  if (ready > w.tick) return `${Math.ceil((ready - w.tick) / 20)}秒`;
  if (w.eco.supply[side] < COST93[kind]) return `缺 ${COST93[kind] - w.eco.supply[side]}`;
  return '';
}

// smoke.ts 的 routeBattleOrder 開頭：沒選空中鍵＝undefined（照原本的路由）；選了＝送空中指令，或 null（看不到的格不炸、選擇保留）
export function air93Route(w: World, hit: OrderHit): OrderRoute | null | undefined {
  if (!armed) return undefined;
  const t = hit.unit ? w.units[hit.unit - 1] : null;
  const cell = t && t.alive && t.side !== SIDE_PLAYER ? [cellOf(t.x), cellOf(t.z)] : hit.building ?? (hit.ground ? [Math.floor(hit.ground.x), Math.floor(hit.ground.z)] : null);
  if (!cell || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1]) || cell[0] < 0 || cell[1] < 0 || cell[0] >= w.n || cell[1] >= w.n) return null;
  const [x, z] = cell, kind = armed;
  if (kind === STRIKE93 && !spotted(w, SIDE_PLAYER, center(x), center(z))) { flash = '看不到'; flashUntil = w.tick + 30; return null; }
  armed = 0;
  return { commands: [{ t: 'air', side: SIDE_PLAYER, kind, x, z }], marker: { x: x + 0.5, z: z + 0.5, hostile: true } };
}
export const air93Armed = (): number => armed;
export function air93Arm(kind: number): void { armed = kind; }   // 守衛用（Node 的路由測試）

// 提醒字（純函式，只讀 w.sky）：敵機第一次進地圖、敵機被打下來、我方的被打下來；自然飛走的不報
export interface Snap93 { tick: number; planes: Map<number, { side: number; t: number; end: number }> }
export function alert93(prev: Snap93 | null, w: World, me: number): { text: string; snap: Snap93 } {
  const planes = new Map<number, { side: number; t: number; end: number }>();
  let text = '';
  for (const p of w.sky?.planes ?? []) {
    planes.set(p.id, { side: p.side, t: p.t, end: 2 * p.T + HOLD93[p.kind] });
    const o = prev?.planes.get(p.id);
    if (p.side !== me && p.t >= 0 && (!o || o.t < 0)) text = '敵機來襲';
  }
  if (prev) for (const [id, o] of prev.planes) {
    if (planes.has(id) || o.t + (w.tick - prev.tick) >= o.end) continue;   // 還在，或自然飛走
    text = o.side === me ? '我機墜落' : '擊落敵機';
  }
  return { text, snap: { tick: w.tick, planes } };
}

interface Read93 { world: World; active: boolean }
export function initAir93(read: () => Read93, opts: { show?: boolean } = {}): void {
  if (!opts.show || typeof document === 'undefined') return;
  const bar = document.createElement('div'); bar.id = 'air93'; bar.className = 'bar'; bar.hidden = true;
  const b = document.createElement('button'); b.id = 'b-air'; b.type = 'button'; b.textContent = '空中';
  bar.appendChild(b); document.querySelector('#hud')?.appendChild(bar);
  let world: World | null = null, snap: Snap93 | null = null, alert = '', alertUntil = 0, title = '';
  const ok = (w: World, k: number) => why93(w, SIDE_PLAYER, k) === '';
  b.addEventListener('click', e => {
    e.stopPropagation();
    const w = read().world;
    const order = armed === 0 ? [STRIKE93, RECON93] : armed === STRIKE93 ? [RECON93] : [];
    armed = order.find(k => ok(w, k)) ?? 0;
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') armed = 0; });
  const frame = () => {
    const s = read(), w = s.world;
    if (w !== world) { world = w; armed = 0; snap = null; alert = ''; flash = ''; }
    const show = s.active && !!w.eco?.air && !w.zombies && !w.sandbox;
    bar.hidden = !show;
    if (!show) { armed = 0; requestAnimationFrame(frame); return; }
    const r = alert93(snap, w, SIDE_PLAYER); snap = r.snap;
    if (r.text) { alert = r.text; alertUntil = w.tick + 40; }
    if (armed && !ok(w, armed)) armed = 0;
    const why = [why93(w, SIDE_PLAYER, STRIKE93), why93(w, SIDE_PLAYER, RECON93)], none = why[0] !== '' && why[1] !== '';
    const label = flash && w.tick < flashUntil ? flash : armed ? NAME[armed] : alert && w.tick < alertUntil ? alert : none ? why.sort()[0] : '空中';
    if (b.textContent !== label) b.textContent = label;
    const t = `空中支援：${armed ? `已選${NAME[armed]}，點地圖叫（Esc 取消）` : '點一下選轟炸，再點選偵察，再點取消'}。轟炸 ${COST93[STRIKE93]} 補給、只炸看得到的格；偵察 ${COST93[RECON93]} 補給。${why[0] ? `轟炸：${why[0]}。` : ''}${why[1] ? `偵察：${why[1]}。` : ''}${alert && w.tick < alertUntil ? (alert === '我機墜落' ? '我方飛機被擊落，冷卻從現在重算。' : `${alert}。`) : ''}`;
    if (t !== title) { title = t; b.title = t; b.setAttribute('aria-label', t); }
    b.setAttribute('aria-pressed', armed ? 'true' : 'false');
    b.disabled = none && !armed;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
