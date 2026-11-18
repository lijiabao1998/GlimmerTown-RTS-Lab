// R095 步兵排的介面：生產列的「步兵排」、倒數與「為什麼不能按」（排的記號不是單位種類）、全排（浮動鍵與桌機的 P）。
// 看的是世界的旗標（w.eco.pla），不是這一台的閥：連線時兩台閥不一樣也一樣。
import { PLATOON_ITEM, PLATOON_COST, ticksOf } from '../sim/platoon.ts';
import { ECO_QUEUE, hqAlive } from '../sim/eco.ts';
import { TICK_HZ, UK_INFANTRY, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';
import { productionCountdown } from './productionCountdown.ts';
import { productionBlockReason } from './productionBlockReason.ts';

export const PLATOON_UI_ITEM = { kind: PLATOON_ITEM, label: '步兵排', short: '排', cost: PLATOON_COST, role: '一次三班' };
export const PLATOON_BUTTON = 'pb-k' + PLATOON_ITEM;

// 生產列的進度條長度、倒數、理由：排的記號另外算，其他照舊
export const progMax95 = (q: readonly number[]): number => (q.length ? ticksOf(q[0]) : 0);
export function countdown95(w: World, enabled = true): string {
  const q = w.eco?.queue[SIDE_PLAYER] ?? [];
  if (!enabled || w.winner >= 0 || !w.eco || !hqAlive(w, SIDE_PLAYER) || q[0] !== PLATOON_ITEM) return productionCountdown(w, enabled);
  const remaining = ticksOf(PLATOON_ITEM) - w.eco.prog[SIDE_PLAYER];
  return `步兵排：${remaining > 0 ? `製造剩餘 ${Math.ceil(remaining / TICK_HZ)} 遊戲秒` : '等待部署（要空出 3 格人口）'} · 後續 ${q.length - 1}`;
}
export function reason95(w: World, kind: number, enabled = true): string {
  if (kind !== PLATOON_ITEM) return productionBlockReason(w, kind, enabled);
  if (!enabled || !w.eco || w.winner >= 0) return '';
  const e = w.eco;
  if (!hqAlive(w, SIDE_PLAYER)) return '指揮部已毀或不存在';
  if (!e.pla || !e.inf) return '這一局沒有步兵排';
  if (e.queue[SIDE_PLAYER].length >= ECO_QUEUE) return '生產佇列已滿';
  const missing = PLATOON_COST - e.supply[SIDE_PLAYER];
  return missing > 0 ? `補給不足，還差 ${missing}` : '';
}

// 全排：跟選著的班同一排的、活著的班（我方）；選著的不是排裡的班就照原樣
export function platoonOf(w: World, selected: Iterable<number>): number[] {
  const pls = new Set<number>();
  for (const id of selected) { const u = w.units[id - 1]; if (u?.alive && u.pl) pls.add(u.pl); }
  return w.units.filter(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_INFANTRY && u.pl !== undefined && pls.has(u.pl)).map(u => u.id);
}

export interface PlatoonRead { world: World; selected: Set<number>; active: boolean }
// 浮動鍵（觸控）；回傳每一幀叫的函式與「選全排」（桌機 P 也叫它）。生產列的「步兵排」只在有旗標的局出現
export function initPlatoon95(read: () => PlatoonRead, select: (ids: number[]) => void, opts: { show?: boolean } = {}): { frame: () => void; selectPlatoon: () => boolean } {
  const selectPlatoon = (): boolean => {
    const s = read(); if (!s.active || !s.world.eco?.pla) return false;
    const ids = platoonOf(s.world, s.selected);
    if (!ids.length) return false;
    select(ids); return true;
  };
  let button: HTMLButtonElement | null = null, bar: HTMLElement | null = null;
  if (opts.show !== false && typeof document !== 'undefined') {
    bar = document.createElement('div'); bar.id = 'platoon95'; bar.className = 'bar';
    document.querySelector('#hud')?.appendChild(bar);
    button = document.createElement('button'); button.id = 'b-platoon'; button.type = 'button'; button.textContent = '全排';
    button.title = '選全排：跟選著的班同一排的每一班'; button.setAttribute('aria-label', button.title);
    bar.appendChild(button);
    button.addEventListener('click', e => { e.stopPropagation(); selectPlatoon(); });
  }
  const frame = () => {
    const s = read(), pla = !!s.world.eco?.pla;
    const item = typeof document !== 'undefined' ? document.getElementById(PLATOON_BUTTON) : null;
    if (item && item.hidden !== !pla) item.hidden = !pla;   // index.html：#prodbar button[hidden] 不顯示
    if (bar && button) { const show = s.active && pla && platoonOf(s.world, s.selected).length > 0; bar.hidden = !show; button.hidden = !show; }
  };
  frame();
  return { frame, selectPlatoon };
}
