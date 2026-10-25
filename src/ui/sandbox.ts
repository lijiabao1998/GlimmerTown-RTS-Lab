// R128：DOM 只讀狀態與發出動作；容量與落點是否合法由模擬層判斷。
import { SANDBOX_CAP, type SandboxError } from '../sim/sandbox.ts';
import { UK_TANK, UK_HOWITZER, SIDE_PLAYER, SIDE_ENEMY, type World } from '../sim/world.ts';

export const SANDBOX_WHY: Record<SandboxError, string> = { mode: '目前不是沙盒。', side: '請選我方或敵方。', kind: '僅能放置坦克或榴彈砲。', map: '超出地圖。', building: '有建築擋住這一格。', unit: '已有單位，請換一格。', capacity: '已達 32 輛上限（含殘骸）；請重置後再放置。' };

export function sandboxPlacementFeedback(results: readonly (SandboxError | null)[]): string {
  if (!results.length) return '';
  const failed = results.filter((e): e is SandboxError => e !== null), accepted = results.length - failed.length;
  return failed.length ? `已放置 ${accepted} 輛；未放置 ${failed.length} 輛：${[...new Set(failed)].map(e => SANDBOX_WHY[e]).join(' ')}` : `已放置 ${accepted} 輛。`;
}

// R136：殘骸仍佔原有容量；只讀目前沙盒，不對一般戰鬥暴露敵方資料。
export function sandboxCapacity(w: World, enabled = true): string {
  if (!enabled || !w.sandbox) return '';
  let player = 0, enemy = 0, wrecks = 0;
  for (const u of w.units) {
    if (!u.alive) wrecks++;
    else if (u.side === SIDE_PLAYER) player++;
    else if (u.side === SIDE_ENEMY) enemy++;
  }
  const free = Math.max(0, SANDBOX_CAP - w.units.length);
  return `存活：我方 ${player}／敵方 ${enemy}；殘骸 ${wrecks}；可放 ${free}`;
}

interface SandboxState { active: boolean; running: boolean; count: number; tool: number | null; side: number; hint: string; summary?: string }
interface SandboxActions {
  state: () => SandboxState;
  enter: () => void; exit: () => void; run: () => void; reset: () => void;
  pick: (kind: number | null) => void; side: (side: number) => void;
}
export interface SandboxBar { update: () => void }

export function initSandbox(a: SandboxActions): SandboxBar {
  const entry = document.createElement('button');
  entry.id = 'sb-enter'; entry.textContent = '沙盒模式';
  const panel = document.createElement('section');
  panel.id = 'sandbox-panel'; panel.setAttribute('aria-label', '沙盒控制');
  panel.innerHTML = `<div class="sb-row"><strong id="sb-status"></strong><button id="sb-run">開始</button><button id="sb-reset">重置</button><button id="sb-exit">一般模式</button></div>
    <div class="sb-row"><button id="sb-player">我方</button><button id="sb-enemy">敵方</button><button id="sb-tank">坦克</button><button id="sb-howitzer">榴彈砲</button><button id="sb-command">指揮</button></div>
    <div id="sb-summary" hidden></div>
    <div id="sb-hint" role="status" aria-live="polite"></div>`;
  document.body.append(entry, panel);
  const $ = (id: string) => panel.querySelector('#' + id) as HTMLButtonElement;
  const text = (id: string, value: string) => { const el = $(id); if (el.textContent !== value) el.textContent = value; };
  const act = (id: string, fn: () => void) => $(id).addEventListener('click', e => { e.stopPropagation(); fn(); update(); });
  entry.addEventListener('click', () => { a.enter(); update(); });
  act('sb-exit', a.exit); act('sb-reset', a.reset); act('sb-run', a.run);
  act('sb-player', () => a.side(0)); act('sb-enemy', () => a.side(1));
  act('sb-tank', () => a.pick(UK_TANK)); act('sb-howitzer', () => a.pick(UK_HOWITZER)); act('sb-command', () => a.pick(null));
  function update() {
    const s = a.state();
    entry.hidden = s.active; panel.hidden = !s.active;
    if (!s.active) return;
    $('sb-summary').hidden = !s.summary;
    text('sb-summary', s.summary ?? '');
    text('sb-status', `沙盒 ${s.running ? '運行' : '暫停'} · ${s.count}/${SANDBOX_CAP}`);
    text('sb-run', s.running ? '暫停' : '開始');
    for (const [id, on] of [['sb-player', s.side === 0], ['sb-enemy', s.side === 1], ['sb-tank', s.tool === UK_TANK], ['sb-howitzer', s.tool === UK_HOWITZER], ['sb-command', s.tool === null]] as const) {
      if ($(id).getAttribute('aria-pressed') !== String(on)) $(id).setAttribute('aria-pressed', String(on));
    }
    text('sb-hint', s.hint || (s.tool === null ? '選取我方單位下指令；敵方沿用自動還擊。' : `點空地放置${s.side === 0 ? '我方' : '敵方'}${s.tool === UK_TANK ? '坦克' : '榴彈砲'}；含殘骸最多 ${SANDBOX_CAP} 輛，重置清空。`));
    const hint = document.getElementById('hint')?.getBoundingClientRect();
    panel.style.bottom = `${hint ? Math.max(8, innerHeight - hint.top + 8) : 52}px`;
  }
  addEventListener('resize', update);
  const hint = document.getElementById('hint');
  if (hint) new ResizeObserver(update).observe(hint);
  update();
  return { update };
}
