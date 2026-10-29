// R069 開始選單：開頁先停在選單；右上「選單」鍵叫出同一份（開戰後是暫停選單）。
// 地圖、模式、重新開始、說明、教學都按原本那幾顆鍵（同一段程式，結果跟按舊鍵一樣）；這裡只顯示狀態、轉送動作，不碰世界。
// 電腦難度、暫停、音效由 main.ts 接線傳進來（音效要真的手指點才開得了，不能用程式按舊鍵）。
export type MapChoice = 'rye' | 'large' | 'town';
export type ModeChoice = 'battle' | 'zombies' | 'sandbox';
export type MenuKind = 'start' | 'pause';
export interface MenuView {
  kind: MenuKind;
  map: MapChoice; mode: ModeChoice; ai: number;
  maps: MapChoice[]; modes: ModeChoice[];
  aiOn: boolean; rye: boolean; tutorial: boolean; audio: boolean | null;   // audio：null＝沒有音效鍵
  resume: boolean;   // 從「選單」鍵打開（布陣中）：主鍵是「繼續」與「重新開始」，不是「開始」
}
export interface MenuItem { id: string; label: string; sub?: string; pressed?: boolean }
export interface MenuLayout { title: string; sub: string; rows: { id: string; title: string; items: MenuItem[] }[]; main: MenuItem[]; extra: MenuItem[] }

const MAP_TEXT: Record<MapChoice, [string, string]> = { rye: ['萊伊', '32×32'], large: ['鄉間', '64×64'], town: ['河鎮', '96×96'] };
const MODE_TEXT: Record<ModeChoice, string> = { battle: '一般對戰', zombies: '喪屍防守', sandbox: '沙盒' };
export const AI_TEXT = ['', '簡單', '普通', '困難'];

// 選單內容：純資料，不碰 DOM（tests/start-menu.mjs 直接驗）
export function menuLayout(v: MenuView): MenuLayout {
  const extra: MenuItem[] = [];
  if (v.kind === 'start' && v.tutorial) extra.push({ id: 'sm-tutorial', label: '新手教學' });
  extra.push({ id: 'sm-help', label: '怎麼玩' });
  if (v.audio !== null) extra.push({ id: 'sm-audio', label: v.audio ? '音效：開' : '音效：關', pressed: v.audio });
  if (v.kind === 'pause') {
    return { title: '暫停', sub: '戰鬥已暫停', rows: [], extra,
      main: [{ id: 'sm-resume', label: '繼續' }, { id: 'sm-restart', label: '重新開始' }, { id: 'sm-main', label: '回主選單' }] };
  }
  const rows: MenuLayout['rows'] = [];
  if (v.mode !== 'sandbox' && v.maps.length > 1) {
    rows.push({ id: 'sm-maps', title: '地圖', items: v.maps.map(m => ({
      id: `sm-map-${m}`, label: m === 'rye' && !v.rye ? '村莊' : MAP_TEXT[m][0], sub: MAP_TEXT[m][1], pressed: v.map === m })) });
  }
  if (v.modes.length > 1) rows.push({ id: 'sm-modes', title: '模式', items: v.modes.map(m => ({ id: `sm-mode-${m}`, label: MODE_TEXT[m], pressed: v.mode === m })) });
  if (v.aiOn && v.mode === 'battle') rows.push({ id: 'sm-ais', title: '電腦難度', items: [1, 2, 3].map(n => ({ id: `sm-ai-${n}`, label: AI_TEXT[n], pressed: v.ai === n })) });
  const main = v.resume ? [{ id: 'sm-resume', label: '繼續' }, { id: 'sm-restart', label: '重新開始' }] : [{ id: 'sm-start', label: '開始' }];
  return { title: '微光小鎮·二戰 RTS', sub: v.resume ? '換地圖或模式會回到布陣第 0 步' : '選地圖與模式，按「開始」布陣', rows, main, extra };
}

// 從現在的狀態到目標，下一步要按哪一顆舊鍵（每按一次就重開布陣、重讀狀態，最多三步）：
// 地圖鍵在萊伊與鄉間之間切換（河鎮時按它回萊伊）；河鎮鍵在河鎮與萊伊之間切換
export function mapStep(from: MapChoice, to: MapChoice): 'map-pick' | 'town-pick' | null {
  if (from === to) return null;
  return to === 'town' || from === 'town' ? 'town-pick' : 'map-pick';
}
// 模式：要沙盒按「沙盒模式」；離開沙盒按沙盒面板的「一般模式」（之後可能回到喪屍，所以重讀再決定）；一般↔喪屍按喪屍鍵
export function modeStep(from: ModeChoice, to: ModeChoice): 'sb-enter' | 'sb-exit' | 'zombies-pick' | null {
  if (from === to) return null;
  if (to === 'sandbox') return 'sb-enter';
  return from === 'sandbox' ? 'sb-exit' : 'zombies-pick';
}

export interface StartMenuHost {
  battle: () => boolean;                                                   // 開戰了沒
  state: () => { map: MapChoice; mode: ModeChoice; rye: boolean };
  aiOn: boolean;
  ai: (level?: number) => number;                                          // 讀／改電腦難度（開戰時送出的電腦指令用它）
  paused: (value?: boolean) => boolean;                                    // 讀／設暫停；開戰後打開選單時暫停，關掉時還原
  audio?: () => void;                                                      // 音效開關（要在真的點擊裡呼叫）
}
export interface StartMenu { open: (kind?: MenuKind, resume?: boolean) => void; close: () => void; visible: () => boolean }

const CSS = `
body.r069 #sb-enter, body.r069 #map-pick, body.r069 #zombies-pick, body.r069 #town-pick, body.r069 #b-restart { display: none; }
#start-menu { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: rgba(14, 18, 12, 0.55); }
#start-menu[hidden] { display: none; }
#start-menu .sm-panel { box-sizing: border-box; width: min(440px, 100%); max-height: 100%; overflow-y: auto; padding: 18px 18px 16px; border: 1px solid #6c745f;
  border-radius: 8px; background: rgba(28, 34, 26, 0.95); color: #f3eedf; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
#start-menu h1 { margin: 0; font-size: 24px; line-height: 1.25; letter-spacing: 1px; }
#start-menu .sm-sub { margin: 4px 0 14px; color: #c9cdb4; font-size: 13px; line-height: 1.4; }
#start-menu .sm-row { margin: 0 0 12px; }
#start-menu .sm-row h2 { margin: 0 0 6px; color: #c9cdb4; font-size: 13px; font-weight: 600; }
#start-menu .sm-seg, #start-menu .sm-extra { display: flex; flex-wrap: wrap; gap: 6px; }
#start-menu button { box-sizing: border-box; min-width: 44px; min-height: 44px; margin: 0; padding: 6px 8px; border: 1px solid #6c745f; border-radius: 5px;
  background: #3c4535; color: #f3eedf; font: inherit; line-height: 1.2; cursor: pointer; touch-action: manipulation; }
#start-menu .sm-seg button, #start-menu .sm-extra button { flex: 1 1 0; }
#start-menu .sm-seg button small { display: block; color: #d9dcc6; font-size: 11px; }
#start-menu button[aria-pressed="true"] { background: #2f5f9a; border-color: #9cc6ff; }
#start-menu .sm-main { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 10px; }
#start-menu .sm-main button { min-height: 48px; font-size: 17px; }
#start-menu .sm-main button.sm-primary { min-height: 54px; background: #9a4a2e; border-color: #e3a07c; font-size: 19px; font-weight: 700; }
#start-menu button:focus-visible { outline: 2px solid #ffd36a; outline-offset: 2px; }
@media (orientation: landscape) and (max-height: 520px) {
  #start-menu .sm-panel { width: min(760px, 100%); display: grid; grid-template-columns: 1.3fr 1fr; column-gap: 16px; align-items: start; padding: 12px 14px; }
  #start-menu .sm-head, #start-menu .sm-rows { grid-column: 1; }
  #start-menu .sm-side { grid-column: 2; grid-row: 1 / span 2; }
  #start-menu h1 { font-size: 20px; }
  #start-menu .sm-sub { margin-bottom: 8px; }
  #start-menu .sm-row { margin-bottom: 8px; }
}
`;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const button = (it: MenuItem, cls = '') =>
  `<button type="button" id="${it.id}"${cls ? ` class="${cls}"` : ''}${it.pressed === undefined ? '' : ` aria-pressed="${it.pressed}"`}>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`;

export function initStartMenu(host: StartMenuHost): StartMenu {
  if (!document.getElementById('start-menu-style')) {
    const style = document.createElement('style');
    style.id = 'start-menu-style'; style.textContent = CSS;
    document.head.appendChild(style);
  }
  document.body.classList.add('r069');
  const root = document.createElement('div');
  root.id = 'start-menu'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'sm-title');
  document.body.appendChild(root);
  const el = (id: string) => document.getElementById(id);
  let kind: MenuKind = 'start', resume = false, held = false, before = false;

  const view = (): MenuView => {
    const s = host.state(), audio = el('b-audio'), tut = el('tutorial-open');
    const maps: MapChoice[] = ['rye', ...(el('map-pick') ? ['large' as const] : []), ...(el('town-pick') ? ['town' as const] : [])];
    const modes: ModeChoice[] = ['battle', ...(el('zombies-pick') ? ['zombies' as const] : []), ...(el('sb-enter') ? ['sandbox' as const] : [])];
    return { kind, map: s.map, mode: s.mode, ai: host.ai(), maps, modes, aiOn: host.aiOn, rye: s.rye,
      tutorial: !!tut && !tut.hidden, audio: audio && host.audio ? audio.getAttribute('aria-pressed') === 'true' : null, resume: kind === 'start' && resume };
  };
  function render() {
    const m = menuLayout(view()), focused = root.contains(document.activeElement) ? document.activeElement!.id : '';
    root.innerHTML = `<div class="sm-panel">
      <div class="sm-head"><h1 id="sm-title">${esc(m.title)}</h1><p class="sm-sub">${esc(m.sub)}</p></div>
      <div class="sm-rows">${m.rows.map(r => `<div class="sm-row" id="${r.id}"><h2>${esc(r.title)}</h2><div class="sm-seg">${r.items.map(it => button(it)).join('')}</div></div>`).join('')}</div>
      <div class="sm-side"><div class="sm-main">${m.main.map((it, i) => button(it, i === 0 ? 'sm-primary' : '')).join('')}</div>
      <div class="sm-extra">${m.extra.map(it => button(it)).join('')}</div></div>
    </div>`;
    if (focused) (root.querySelector(`#${focused}`) as HTMLElement | null)?.focus({ preventScroll: true });   // 重畫不丟焦點（鍵盤操作）
  }
  // 開戰中（或沒有布陣、重開就開打）選單開著時暫停；關掉時還原打開前的暫停狀態
  function hold() { if (!held && !root.hidden && host.battle()) { before = host.paused(); host.paused(true); held = true; } }
  function release() { if (held) { held = false; host.paused(before); } }
  const press = (id: string) => (el(id) as HTMLElement | null)?.click();

  function open(next: MenuKind = host.battle() ? 'pause' : 'start', fromBar = false) {
    kind = next; resume = fromBar || next === 'pause'; root.hidden = false; render(); hold();
    (root.querySelector('.sm-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }
  function close() { release(); root.hidden = true; root.innerHTML = ''; }
  function act(id: string, trusted: boolean) {
    if (id === 'sm-start' || id === 'sm-resume') return close();
    if (id === 'sm-restart') { close(); return press('b-restart'); }
    if (id === 'sm-main') { close(); press('b-restart'); return open('start'); }
    if (id === 'sm-help') { close(); return press('b-help'); }
    if (id === 'sm-tutorial') { close(); return press('tutorial-open'); }
    if (id === 'sm-audio') { if (trusted) host.audio?.(); return render(); }
    if (id.startsWith('sm-map-')) for (let i = 0, b; i < 3 && (b = mapStep(host.state().map, id.slice(7) as MapChoice)); i++) press(b);
    else if (id.startsWith('sm-mode-')) for (let i = 0, b; i < 3 && (b = modeStep(host.state().mode, id.slice(8) as ModeChoice)); i++) press(b);
    else if (id.startsWith('sm-ai-')) host.ai(Number(id.slice(6)));
    hold(); render();
    (root.querySelector(`#${id}`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
  root.addEventListener('click', e => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest('button');
    if (b && root.contains(b)) act(b.id, e.isTrusted);
  });
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'contextmenu'] as const) root.addEventListener(type, e => e.stopPropagation());
  // 選單開著時鍵盤不穿透到遊戲（空白鍵不會開打）；Esc 等於「繼續」
  addEventListener('keydown', e => {
    if (root.hidden) return;
    e.stopPropagation();
    if (e.key === 'Escape' && resume) { e.preventDefault(); close(); return; }
    // 焦點留在選單裡：Tab 在選單的鍵之間循環；焦點跑到外面時 Enter／空白鍵不按到後面的鍵，拉回選單
    const keys = [...root.querySelectorAll('button')] as HTMLElement[], at = keys.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') { e.preventDefault(); keys[at < 0 ? 0 : (at + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]?.focus({ preventScroll: true }); }
    else if (at < 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (root.querySelector('.sm-primary') as HTMLElement | null)?.focus({ preventScroll: true }); }
  }, true);
  addEventListener('keyup', e => { if (!root.hidden) e.stopPropagation(); }, true);
  const audio = el('b-audio');
  let audioOn = audio?.getAttribute('aria-pressed');
  if (audio) new MutationObserver(() => {   // 只在音效真的切換時重畫（狀態列每次更新都會重設這個屬性）
    const now = audio.getAttribute('aria-pressed');
    if (now !== audioOn) { audioOn = now; if (!root.hidden) render(); }
  }).observe(audio, { attributes: true, attributeFilter: ['aria-pressed'] });

  const toolbar = document.querySelector('#hud .btns');
  if (toolbar) {
    const menu = document.createElement('button');
    menu.id = 'b-menu'; menu.type = 'button'; menu.textContent = '選單'; menu.title = '開始選單／暫停選單';
    menu.addEventListener('click', e => { e.stopPropagation(); open(undefined, true); });
    // 「↺ 重新開始」收進選單，「選單」鍵佔它的位置：手機上那排還是八顆（R117 算好 412px 剛好放得下）
    const restart = el('b-restart');
    if (restart?.parentElement === toolbar) restart.before(menu); else toolbar.prepend(menu);
  }
  open('start');
  return { open, close, visible: () => !root.hidden };
}
