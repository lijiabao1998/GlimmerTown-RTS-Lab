// R109：只讀世界的砲擊快捷選單。選單保存格子，按下彈種時才檢查目前選取。
import { N, SUB, SIDE_PLAYER, UK_HOWITZER, UNIT_KINDS, type World } from '../sim/world.ts';
import type { Command } from '../sim/step.ts';
import type { AmmoMode, OrderHit } from './smoke.ts';

export interface BombardTarget { x: number; z: number }
const validTarget = (p: BombardTarget) => Number.isInteger(p.x) && Number.isInteger(p.z) && p.x >= 0 && p.z >= 0 && p.x < N && p.z < N;

export function bombardTarget(w: World, hit: OrderHit): BombardTarget | null {
  const unit = hit.unit ? w.units[hit.unit - 1] : undefined;
  const cell = unit?.alive ? [Math.floor(unit.x / SUB), Math.floor(unit.z / SUB)]
    : hit.building ?? (hit.ground ? [Math.floor(hit.ground.x), Math.floor(hit.ground.z)] : null);
  if (!cell) return null;
  const p = { x: cell[0], z: cell[1] };
  return validTarget(p) ? p : null;
}

export function bombardCommand(w: World, selected: Iterable<number>, target: BombardTarget, ammo: AmmoMode): Command | null {
  if (!validTarget(target)) return null;
  const ids = [...new Set(selected)].filter(id => {
    const u = w.units[id - 1];
    return u?.alive && u.side === SIDE_PLAYER && (ammo === 'smoke' ? u.kind === UK_HOWITZER : UNIT_KINDS[u.kind].indirect);
  });
  return ids.length ? { t: 'fireAt', side: SIDE_PLAYER, ids, x: target.x, z: target.z, ...(ammo === 'smoke' ? { ammo: 'smoke' as const } : {}) } : null;
}

export interface MenuRect { left: number; top: number; right: number; bottom: number }
// 優先靠手指，若 HUD 擋住，找同樣大小的空位；座標只用 CSS 像素。
export function menuPosition(width: number, height: number, vw: number, vh: number, cx: number, cy: number, obstacles: MenuRect[]): { left: number; top: number } {
  const margin = 8, maxX = Math.max(margin, vw - width - margin), maxY = Math.max(margin, vh - height - margin);
  const clampX = (x: number) => Math.max(margin, Math.min(maxX, x));
  const clampY = (y: number) => Math.max(margin, Math.min(maxY, y));
  const xs = [cx - width / 2, cx + 16, cx - width - 16, margin, maxX];
  const ys = [cy + 20, cy - height - 20, margin, maxY];
  for (const r of obstacles) { xs.push(r.right + margin, r.left - width - margin); ys.push(r.bottom + margin, r.top - height - margin); }
  let best = { left: clampX(xs[0]), top: clampY(ys[0]) }, bestOverlap = Infinity, bestFinger = Infinity, bestDistance = Infinity;
  for (const x of xs) for (const y of ys) {
    const left = clampX(x), top = clampY(y);
    const overlap = obstacles.reduce((area, r) => area + Math.max(0, Math.min(left + width + margin, r.right) - Math.max(left - margin, r.left)) * Math.max(0, Math.min(top + height + margin, r.bottom) - Math.max(top - margin, r.top)), 0);
    // R127: equally clear placements must not catch the opening touch's compatibility click.
    const finger = cx >= left - margin && cx <= left + width + margin && cy >= top - margin && cy <= top + height + margin ? 1 : 0;
    const distance = (left + width / 2 - cx) ** 2 + (top + height / 2 - cy) ** 2;
    if (overlap < bestOverlap || (overlap === bestOverlap && (finger < bestFinger || (finger === bestFinger && distance < bestDistance)))) { best = { left, top }; bestFinger = finger; bestOverlap = overlap; bestDistance = distance; }
  }
  return best;
}

export interface CommandMenu {
  open: (target: BombardTarget, cx: number, cy: number) => void;
  close: () => void;
  isOpen: () => boolean;
  contains: (target: EventTarget | null) => boolean;
}
export function initCommandMenu(on: { choose: (ammo: AmmoMode, target: BombardTarget) => void; cancel: () => void }): CommandMenu {
  const root = document.createElement('div');
  root.id = 'command-menu'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '指定地點砲擊');
  root.innerHTML = '<strong id="cm-target"></strong><button id="cm-he" type="button">高爆砲擊</button><button id="cm-smoke" type="button">煙幕（榴彈砲）</button><button id="cm-cancel" type="button">取消</button>';
  (document.getElementById('hud') ?? document.body).appendChild(root);
  let aim: BombardTarget | null = null;
  const close = () => { aim = null; root.hidden = true; };
  const choose = (ammo: AmmoMode) => {
    if (!aim || root.hidden) return;
    const target = { ...aim }; close(); on.choose(ammo, target);
  };
  root.addEventListener('pointerdown', e => e.stopPropagation());
  root.addEventListener('click', e => e.stopPropagation());
  root.querySelector('#cm-he')!.addEventListener('click', () => choose('he'));
  root.querySelector('#cm-smoke')!.addEventListener('click', () => choose('smoke'));
  root.querySelector('#cm-cancel')!.addEventListener('click', () => { if (!aim) return; close(); on.cancel(); });
  return {
    open(target, cx, cy) {
      if (!validTarget(target)) { close(); return; }
      aim = { ...target }; root.querySelector('#cm-target')!.textContent = `砲擊格 ${target.x + 1} · ${target.z + 1}`;
      root.hidden = false;
      const rect = root.getBoundingClientRect();
      const obstacles: MenuRect[] = [];
      for (const selector of ['#hud .btns', '#hud .top', '#hud .bottom', '#minimap', '#prodbar', '#buildbar']) {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) obstacles.push(r);
      }
      const p = menuPosition(rect.width, rect.height, innerWidth, innerHeight, cx, cy, obstacles);
      root.style.left = `${p.left}px`; root.style.top = `${p.top}px`;
    },
    close, isOpen: () => !root.hidden, contains: target => target instanceof Node && root.contains(target),
  };
}
