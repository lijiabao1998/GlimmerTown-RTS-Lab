// R070 桌機鍵盤：WASD／方向鍵平移、Q/E 縮放、標準 RTS 快捷鍵。
// 純邏輯（按鍵→動作、按住→每幀位移）跟 DOM 分開：純的部分在 Node 守衛直接測（tests/desktop-keys.mjs）。
// 不碰世界、不碰 three、不讀模擬；動作一律交給 main.ts 接到既有的 HUD 動作上。

export type KeyAction =
  | 'zoom-in' | 'zoom-out' | 'home' | 'fire-mode' | 'hold-fire'
  | 'select-all' | 'help' | 'next-unit' | 'group-set' | 'group-recall';

export type PanToken = 'w' | 'a' | 's' | 'd' | 'up' | 'down' | 'left' | 'right';

export const PAN_SPEED = 1100;   // 按住一秒移動幾個 CSS 像素（跟 view.pan 同方向、同單位）
export const ZOOM_STEP = 1.12;   // 跟滾輪同一倍率

export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

// 依「實體鍵」認移動鍵（e.code）：AZERTY 之類的鍵盤上 W 的位置一樣能走。
// 沒有 code 的環境（Node 守衛、舊瀏覽器）退回 e.key。
export function panToken(code: string, key = ''): PanToken | null {
  switch (code) {
    case 'KeyW': return 'w';
    case 'KeyA': return 'a';
    case 'KeyS': return 's';
    case 'KeyD': return 'd';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
  }
  const k = normalizeKey(key);
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') return k;
  if (k === 'arrowup') return 'up';
  if (k === 'arrowdown') return 'down';
  if (k === 'arrowleft') return 'left';
  if (k === 'arrowright') return 'right';
  return null;
}

// 這一幀要平移多少（螢幕 CSS 像素；跟滑鼠拖曳同方向：往 +x 拖、往 +y 拖）。
// A／← 讓畫面往左捲＝往 +x 拖；W／↑ 讓畫面往上捲＝往 +y 拖。
export function panDelta(held: ReadonlySet<PanToken>, dtSec: number, speed = PAN_SPEED): { x: number; z: number } {
  const x = (held.has('a') || held.has('left') ? 1 : 0) - (held.has('d') || held.has('right') ? 1 : 0);
  const z = (held.has('w') || held.has('up') ? 1 : 0) - (held.has('s') || held.has('down') ? 1 : 0);
  if (!x && !z) return { x: 0, z: 0 };
  const d = speed * Math.max(0, dtSec) / (x && z ? Math.SQRT2 : 1);   // 斜走不加速：合向量長度＝speed·dt
  return { x: x * d, z: z * d };
}

export interface Mods { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean }

// 按鍵→動作。Ctrl／Meta 組合只認全選與群組，其餘留給瀏覽器（Ctrl+W、Ctrl+T 不能搶）。
export function actionFor(key: string, mods: Mods = {}): KeyAction | null {
  const k = normalizeKey(key);
  if (mods.alt) return null;
  if (k === 'tab') return mods.ctrl || mods.shift ? null : 'next-unit';
  if (mods.ctrl || mods.meta) {
    if (k === 'a') return 'select-all';
    if (/^[1-9]$/.test(k)) return 'group-set';
    return null;
  }
  if (k === 'q') return 'zoom-out';
  if (k === 'e') return 'zoom-in';
  if (k === '+' || k === '=') return 'zoom-in';
  if (k === '-' || k === '_') return 'zoom-out';
  if (k === 'h') return 'home';
  if (k === 'f') return 'fire-mode';
  if (k === 'g') return 'hold-fire';
  if (k === 'f1' || k === '?') return 'help';
  if (/^[1-9]$/.test(k)) return 'group-recall';
  return null;
}

export function groupIndex(key: string): number {
  const m = /^[1-9]$/.exec(normalizeKey(key));
  return m ? Number(m[0]) : 0;
}

export interface KeysHost {
  blocked: () => boolean;                                    // 說明、戰報、開始選單開著時不作用
  pan: (dx: number, dz: number) => void;
  zoom: (factor: number) => void;
  action: (a: KeyAction, n: number) => void;
}

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return TYPING.test(el.tagName) || el.isContentEditable === true;
}

// DOM 接線：只把事件轉成動作與按住狀態，實際效果都由 host 做。
export function initDesktopKeys(host: KeysHost): { step: (dt: number) => void; clear: () => void } {
  const held = new Set<PanToken>();
  const down = (e: KeyboardEvent) => {
    if (e.isComposing || typing(e.target)) return;
    const token = panToken(e.code, e.key);
    if (token) { held.add(token); e.preventDefault(); return; }   // 方向鍵不讓頁面捲動
    if (e.repeat) return;
    if (host.blocked()) return;
    const a = actionFor(e.key, { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey });
    if (!a) return;
    e.preventDefault();
    if (a === 'zoom-in') { host.zoom(ZOOM_STEP); return; }
    if (a === 'zoom-out') { host.zoom(1 / ZOOM_STEP); return; }
    host.action(a, groupIndex(e.key));
  };
  const up = (e: KeyboardEvent) => { const t = panToken(e.code, e.key); if (t) held.delete(t); };
  const clear = () => held.clear();
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  return {
    step: dt => {
      if (host.blocked()) { held.clear(); return; }   // 開著對話框：連按住都不追
      const p = panDelta(held, dt);
      if (p.x || p.z) host.pan(p.x, p.z);
    },
    clear,
  };
}
