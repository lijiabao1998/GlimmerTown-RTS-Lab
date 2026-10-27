// R902 新手教學面板（DOM）。只顯示文字、只改自己的演練狀態，不碰對戰世界。
import {
  TUTORIAL_BUILD, TUTORIAL_ENEMY, TUTORIAL_LESSONS, TUTORIAL_MOVE, TUTORIAL_STORE_KEY, TUTORIAL_SUPPLY_CELL,
  createTutorial, tutorialAct, tutorialClock, tutorialHolding, tutorialMark, tutorialStatus, tutorialVisible,
  type Tut,
} from '../sim/tutorial.ts';

export interface TutorialStore { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }
export interface TutorialHost { appendChild: (node: Node) => void }
export interface TutorialHandle { frame: (now: number) => void; visible: () => boolean }

const CSS = `
#tutorial { position: fixed; z-index: 4; box-sizing: border-box; display: flex; flex-direction: column;
  left: max(8px, env(safe-area-inset-left)); top: calc(max(8px, env(safe-area-inset-top)) + 208px);
  width: min(180px, calc(50vw - 24px)); max-height: min(168px, 42vh, calc(100vh - 470px)); overflow: hidden; padding: 8px 10px 8px;
  pointer-events: none; background: rgba(24, 28, 22, 0.94); border: 2px solid #6c8fb8; border-radius: 8px;
  color: #f3eedf; font-size: 13px; line-height: 1.4; }
#tutorial[hidden] { display: none; }
#tutorial .hd { display: flex; flex: 0 0 auto; justify-content: space-between; gap: 8px; align-items: baseline; }
#tutorial .copy { min-height: 0; overflow: auto; }
#tutorial h2 { margin: 0; font-size: 15px; letter-spacing: 0.06em; }
#tutorial p { margin: 6px 0; }
#tutorial #tutorial-clock { font-variant-numeric: tabular-nums; opacity: 0.8; }
#tutorial .row { display: flex; flex: 0 0 auto; flex-direction: column; }
#tutorial .acts { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
#tutorial button { box-sizing: border-box; min-width: 44px; min-height: 44px; height: 44px; padding: 0 6px; pointer-events: auto;
  border: 1px solid #6c745f; border-radius: 5px; background: #3c4535; color: #f3eedf; font: inherit; cursor: pointer; touch-action: manipulation; }
/* 按鈕不拉滿面板：Chrome 觸控會把距按鈕約 10px 的點吸過去，elementFromPoint 仍顯示畫布。 */
#tutorial #tutorial-skip, #tutorial #tutorial-ok { flex: 0 0 auto; width: auto; align-self: flex-start; margin-top: 6px; }
#tutorial #tutorial-skip { background: #2a2e26; }
#tutorial #tutorial-ok { background: #2f5f9a; border-color: #9cc6ff; font-weight: 700; }
#tutorial button[hidden] { display: none; }
@media (max-height: 500px) {
  #tutorial { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-rows: 44px minmax(0, 1fr);
    align-items: center; column-gap: 6px; top: calc(max(8px, env(safe-area-inset-top)) + 106px);
    width: min(300px, calc(100vw - 16px)); max-height: 100px; padding: 0 6px 2px; }
  #tutorial #tutorial-clock { display: none; }
  #tutorial h2 { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #tutorial p { margin: 0; }
  #tutorial .hd { grid-area: 1 / 1; min-width: 0; }
  #tutorial .copy { grid-area: 2 / 1 / auto / -1; margin-left: 128px; }
  #tutorial .row { display: contents; }
  #tutorial .acts { grid-area: 1 / 2; margin-top: 0; flex-wrap: nowrap; }
  #tutorial #tutorial-skip, #tutorial #tutorial-ok { grid-area: 1 / 3; width: auto; margin: 0; }
}
`;

const ACTS = [
  ['選我方', '移到空地'],
  ['選我方', '採補給'],
  ['選農舍', '蓋在空地'],
  ['', '攻擊敵人'],
];
const CELLS = [TUTORIAL_MOVE, TUTORIAL_SUPPLY_CELL, TUTORIAL_BUILD, TUTORIAL_ENEMY];

function browserStore(): TutorialStore | null {
  try { return localStorage; } catch { return null; }
}

function dormant(): TutorialHandle {
  return { frame() {}, visible: () => false };
}

export function initTutorial(host: TutorialHost, enabled: boolean, store?: TutorialStore | null): TutorialHandle {
  if (!enabled) return dormant();
  const box = store === undefined ? browserStore() : store;
  let stored: string | null = null;
  try { stored = box?.getItem(TUTORIAL_STORE_KEY) ?? null; } catch { stored = null; }
  if (!tutorialVisible(true, stored)) return dormant();

  if (!document.getElementById('tutorial-style')) {
    const style = document.createElement('style');
    style.id = 'tutorial-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'tutorial';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '新手教學');
  root.innerHTML = `
    <div class="hd"><h2 id="tutorial-title"></h2><span id="tutorial-clock"></span></div>
    <div class="copy">
      <p id="tutorial-body"></p>
      <p id="tutorial-status"></p>
    </div>
    <div class="row">
      <div class="acts"><button type="button" id="tutorial-a"></button><button type="button" id="tutorial-b"></button></div>
      <button type="button" id="tutorial-skip">跳過</button>
      <button type="button" id="tutorial-ok" hidden>知道了</button>
    </div>`;
  host.appendChild(root);
  const q = (sel: string) => {
    const n = root.querySelector(sel);
    if (!n) throw new Error(`tutorial: missing ${sel}`);
    return n as HTMLElement;
  };
  const title = q('#tutorial-title'), clock = q('#tutorial-clock'), body = q('#tutorial-body'), status = q('#tutorial-status');
  const btnA = q('#tutorial-a') as HTMLButtonElement, btnB = q('#tutorial-b') as HTMLButtonElement;
  const skip = q('#tutorial-skip') as HTMLButtonElement, ok = q('#tutorial-ok') as HTMLButtonElement;
  const state: Tut = createTutorial();
  let saved = '';
  const persist = () => {
    const mark = tutorialMark(state);
    if (!mark || saved === mark) return;
    saved = mark;
    try { box?.setItem(TUTORIAL_STORE_KEY, mark); } catch { /* 私密模式寫不進就只收這一頁 */ }
  };
  const refresh = () => {
    if (state.step >= 4) {
      title.textContent = '教學完成';
      clock.textContent = clockLabel(state.tick);
      body.textContent = '移動、採集、建造、攻擊都走過了。';
      status.textContent = tutorialStatus(state);
      btnA.hidden = true; btnB.hidden = true; skip.hidden = true; ok.hidden = false;
      persist();
      return;
    }
    const lesson = TUTORIAL_LESSONS[state.step];
    const done = (state.flags & (1 << state.step)) !== 0;
    const extra = done ? '做對了。腳本時間到就進入下一課。' : tutorialHolding(state) ? '先完成這一動，腳本才會繼續。' : '';
    title.textContent = `第 ${state.step + 1}／4 課　${lesson.title}`;
    body.textContent = extra ? `${lesson.body}${extra}` : lesson.body;
    status.textContent = tutorialStatus(state);
    clock.textContent = clockLabel(state.tick);
    const labels = ACTS[state.step];
    btnA.hidden = !labels[0]; btnA.textContent = labels[0];
    btnB.hidden = !labels[1]; btnB.textContent = labels[1];
    skip.hidden = false; ok.hidden = true;
  };
  const press = (which: 'a' | 'b') => {
    if (state.step >= 4) return;
    if (which === 'a') {
      if (state.step === 0 || state.step === 1) tutorialAct(state, { t: 'select', id: 1 });
      else if (state.step === 2) tutorialAct(state, { t: 'tool' });
    } else {
      const cell = CELLS[state.step];
      if (cell) tutorialAct(state, { t: 'cell', x: cell.x, z: cell.z });
    }
    refresh();
  };
  root.addEventListener('click', e => e.stopPropagation());
  btnA.addEventListener('click', e => { e.stopPropagation(); press('a'); });
  btnB.addEventListener('click', e => { e.stopPropagation(); press('b'); });
  skip.addEventListener('click', e => {
    e.stopPropagation();
    tutorialAct(state, { t: 'skip' });
    persist();
    root.hidden = true;
  });
  ok.addEventListener('click', e => { e.stopPropagation(); root.hidden = true; });
  refresh();

  let last = 0, acc = 0;
  return {
    visible: () => !root.hidden,
    frame(now: number) {
      if (root.hidden || state.skipped || state.step >= 4) return;
      if (!last) { last = now; return; }
      let dt = now - last; last = now;
      if (dt < 0) dt = 0;
      if (dt > 250) dt = 250;
      acc += dt;
      const before = state.tick + state.step * 10000 + state.flags;
      let n = 0;
      while (acc >= 50 && n < 8) { acc -= 50; tutorialClock(state, 1); n++; }
      if (state.step >= 4) persist();
      if (state.tick + state.step * 10000 + state.flags !== before) refresh();
    },
  };
}

const TUTORIAL_CLOCK = 20;
function clockLabel(tick: number): string {
  const sec = (tick / TUTORIAL_CLOCK) | 0;
  const m = (sec / 60) | 0;
  const r = sec % 60;
  const rs = r < 10 ? `0${r}` : `${r}`;
  return `${m}:${rs}／3:00`;
}
