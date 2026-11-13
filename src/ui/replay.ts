// R047 重播：打完的每一局自動存下來；重播面板（列表、匯出、匯入）；播放時餵紀錄裡的指令、擋掉玩家的指令。
// 格式與儲存在 replayStore.ts。這裡只在 main.ts 的 tick() 取指令那一行接一個 feed()：
//   正在重播 → 回傳紀錄裡這一步的指令（玩家這時下的指令不會進世界）；不是重播 → 回傳 undefined（照舊用玩家的指令），並在分出勝負時存檔。
import type { World } from '../sim/world.ts';
import type { Command, LoggedCommand } from '../sim/step.ts';
import { addReplay, loadReplays, makeRecord, encodeReplay, decodeReplay, replayTitle, browserStore, sameReplay, REPLAY_MAX_TEXT, type Decoded, type ReplayRecord, type Store } from './replayStore.ts';

export interface ReplayHost {
  world: () => World;
  log: () => readonly LoggedCommand[];
  hash: () => string;
  begin: (seed: number) => void;          // 開一個只有種子的世界（跟守衛的 playLog 同一條路）、不暫停
  tick: () => void;                       // 走一步
  remake: () => void;                     // 照現在的世界重建畫面與戰報統計
  focus: (x: number, z: number) => void;  // 鏡頭對準
  leave: () => void;                      // 回一般開局（布陣第 0 步）
}
export interface Replay {
  feed: (w: World, pending: Command[]) => Command[] | undefined;
  open: () => void;                       // 打開重播面板
  playing: () => boolean;
}

const CSS = `
#replays { position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  background: rgba(14, 18, 12, 0.55); }
#replays[hidden] { display: none; }
#replays .rpl-panel { box-sizing: border-box; width: min(480px, 100%); max-height: 100%; display: flex; flex-direction: column; padding: 18px 18px 16px; border: 1px solid #6c745f;
  border-radius: 8px; background: rgba(28, 34, 26, 0.95); color: #f3eedf; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
#replays h1 { margin: 0; font-size: 22px; line-height: 1.25; letter-spacing: 1px; }
#replays .rpl-sub { margin: 4px 0 12px; color: #c9cdb4; font-size: 13px; line-height: 1.4; }
#replays .rpl-list { min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; }
#replays .rpl-row { display: flex; gap: 6px; }
#replays button { box-sizing: border-box; min-width: 44px; min-height: 44px; margin: 0; padding: 6px 10px; border: 1px solid #6c745f; border-radius: 5px;
  background: #3c4535; color: #f3eedf; font: inherit; line-height: 1.2; cursor: pointer; touch-action: manipulation; }
#replays .rpl-watch { flex: 1 1 0; min-width: 0; text-align: left; }
#replays .rpl-watch small { display: block; color: #d9dcc6; font-size: 12px; }
#replays .rpl-acts { display: flex; gap: 8px; }
#replays .rpl-acts button { flex: 1 1 0; min-height: 48px; }
#replays .rpl-acts .rpl-primary { background: #9a4a2e; border-color: #e3a07c; font-weight: 700; }
#replays .rpl-note { margin: 0 0 10px; color: #ffd36a; font-size: 13px; line-height: 1.4; }
#replays .rpl-note:empty { display: none; }
#replays button:focus-visible { outline: 2px solid #ffd36a; outline-offset: 2px; }
#replay-bar { position: fixed; z-index: 12; left: 8px; top: 8px; display: flex; align-items: center; gap: 8px; box-sizing: border-box; max-width: min(300px, calc(100vw - 16px));
  padding: 4px 4px 4px 12px; border: 1px solid #e3a07c; border-radius: 6px; background: rgba(28, 34, 26, 0.92); color: #f3eedf; font-size: 14px; line-height: 1.3; }
#replay-bar[hidden] { display: none; }
#replay-bar button { box-sizing: border-box; min-width: 56px; min-height: 44px; border: 1px solid #6c745f; border-radius: 5px; background: #3c4535; color: #f3eedf; font: inherit; cursor: pointer; touch-action: manipulation; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const clock = (ticks: number) => { const s = Math.floor(ticks / 20); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const REPLAY_SAME = '重播結束 · 跟原局相同', REPLAY_DIFF = '這份紀錄是別的版本存的，結果可能跟原局不同';

export function initReplay(host: ReplayHost, store: Store | null = browserStore()): Replay {
  if (!document.getElementById('replay-style')) {
    const style = document.createElement('style');
    style.id = 'replay-style'; style.textContent = CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement('div');
  root.id = 'replays'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'rpl-title');
  const bar = document.createElement('div');
  bar.id = 'replay-bar'; bar.hidden = true; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span id="replay-text"></span><button type="button" id="replay-leave">離開</button>';
  const file = document.createElement('input');
  file.type = 'file'; file.id = 'rpl-file'; file.accept = '.json,application/json'; file.hidden = true;
  document.body.append(root, bar, file);
  const text = bar.querySelector('#replay-text') as HTMLElement;

  let play: { rec: ReplayRecord; world: World; i: number; checked: boolean } | null = null, watch = 0;
  // 重播結束：收掉那一條。世界被換掉（再來一局、重新開始、換地圖）時遊戲停在布陣、不會再走步，feed() 等不到，所以播放期間另外每 0.2 秒看一次
  const stop = () => { play = null; bar.hidden = true; clearInterval(watch); };
  let saved: World | null = null, list: ReplayRecord[] = [], note = '', shown = '';
  // 「重播中」那一條放哪裡：各種螢幕上狀態列、工具列、小地圖、手機側邊鍵的位置都不一樣（360 寬時工具列還會排成兩排），
  // 所以不寫死，從左上往下、往右掃，放在第一個不碰到它們的空位（只看畫面上半部；真的找不到就留在原地）
  const OBSTACLES = '#hud .top, #hud .btns, #minimap, #r901-chrome, #hud button, body > button';
  function place() {
    if (bar.hidden) return;
    const box = bar.getBoundingClientRect(), gap = 4;
    const taken = [...document.querySelectorAll(OBSTACLES)].filter(e => !bar.contains(e)).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    for (let y = 8; y + box.height <= innerHeight / 2; y += 4) for (let x = 8; x + box.width <= innerWidth - 8; x += 8) {
      if (taken.every(r => x + box.width + gap <= r.left || x - gap >= r.right || y + box.height + gap <= r.top || y - gap >= r.bottom)) { bar.style.left = `${x}px`; bar.style.top = `${y}px`; return; }
    }
  }
  const say = (s: string) => { if (s.length !== shown.length) { shown = s; text.textContent = s; place(); } else if (s !== shown) { shown = s; text.textContent = s; } };
  addEventListener('resize', place);

  function feed(w: World, _pending: Command[]): Command[] | undefined {
    if (play && play.world !== w) stop();   // 世界換了（重新開始、離開、再來一局）：重播結束
    if (play) {
      const { rec } = play, out: Command[] = [];
      if (w.tick >= rec.ticks) {
        if (!play.checked) { play.checked = true; say(host.hash() === rec.hash ? REPLAY_SAME : REPLAY_DIFF); }
        return out;   // 存檔那一步之後沒有指令；世界照常往下走（慢動作、戰報）
      }
      while (play.i < rec.log.length && rec.log[play.i].tick <= w.tick) { if (rec.log[play.i].tick === w.tick) out.push(rec.log[play.i].cmd); play.i++; }
      say(`重播中 ${clock(w.tick)}／${clock(rec.ticks)}`);
      return out;
    }
    if (w.winner >= 0 && saved !== w && !w.sandbox) {   // 分出勝負的那一刻存一筆（一個世界只存一次；沙盒沒有勝負）
      saved = w;
      const meta = { map: w.map ?? 0, n: w.n, winner: w.winner, seconds: Math.floor(w.tick / 20), ...(w.zombies ? { wave: w.zombies.wave } : {}) };
      list = addReplay(store, makeRecord(w.seed, w.tick, host.hash(), host.log(), meta, new Date().toISOString()));
    }
    return undefined;
  }

  function start(rec: ReplayRecord) {
    close();
    host.begin(rec.seed);
    const w = host.world();
    clearInterval(watch);
    play = { rec, world: w, i: 0, checked: false }; saved = w;   // 重播的這一局不再存一次
    watch = setInterval(() => { if (play && host.world() !== play.world) stop(); }, 200) as unknown as number;
    shown = ''; text.textContent = ''; bar.hidden = false;
    host.tick();     // 第 0 步：地圖、規則、布陣、指揮部都在這一步落地
    host.remake();   // 畫面與戰報統計照落地後的世界重建
    if (w.n > 32) host.focus(w.n - 9, w.n - 9);   // 大地圖：鏡頭對準我方角落（跟一般開局一樣）
    place();
  }

  function render() {
    const rows = list.map((r, i) => { const t = replayTitle(r); return `<div class="rpl-row"><button type="button" class="rpl-watch" id="rpl-watch-${i}">${esc(t.label)}<small>${esc(t.sub)}</small></button><button type="button" id="rpl-export-${i}">匯出</button></div>`; }).join('');
    root.innerHTML = `<div class="rpl-panel">
      <h1 id="rpl-title">重播</h1>
      <p class="rpl-sub">${list.length ? '點一局從頭重看。打完的每一局會自動存在這裡，最多留十局。' : '還沒有紀錄。打完一局會自動存在這裡。'}</p>
      <div class="rpl-list">${rows}</div>
      <p class="rpl-note" id="rpl-note" role="status">${esc(note)}</p>
      <div class="rpl-acts"><button type="button" class="rpl-primary" id="rpl-back">返回</button><button type="button" id="rpl-import">匯入</button></div>
    </div>`;
  }
  function open() { list = loadReplays(store); note = ''; root.hidden = false; render(); (root.querySelector('#rpl-back') as HTMLElement | null)?.focus({ preventScroll: true }); }
  function close() { root.hidden = true; root.innerHTML = ''; }
  function download(rec: ReplayRecord) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([encodeReplay(rec)], { type: 'application/json' }));
    a.href = url; a.download = `gtrts-replay-${rec.seed}-${rec.ticks}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  root.addEventListener('click', e => {
    e.stopPropagation();
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !root.contains(b)) return;
    if (b.id === 'rpl-back') { close(); (document.getElementById('b-menu') as HTMLElement | null)?.click(); return; }
    if (b.id === 'rpl-import') { file.value = ''; file.click(); return; }
    const m = /^rpl-(watch|export)-(\d+)$/.exec(b.id), rec = m ? list[Number(m[2])] : undefined;
    if (!m || !rec) return;
    if (m[1] === 'watch') start(rec); else { download(rec); note = '已匯出成檔案。'; render(); }
  });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    const failed = (why: string): Decoded => ({ ok: false, why });
    // 先看檔案大小（一個字最多四個位元組），太大的不讀；讀檔或檢查出任何意外都當成讀不出來
    const read: Promise<Decoded> = f.size > REPLAY_MAX_TEXT * 4 ? Promise.resolve(failed('檔案太大，不像重播紀錄')) : f.text().then(t => decodeReplay(t));
    read.catch(() => failed('這個檔讀不出來')).then(d => {
      if (d.ok) {
        const kept = addReplay(store, d.rec), stored = kept.some(r => sameReplay(r, d.rec));
        list = stored ? kept : [d.rec, ...kept];   // 本機存不進去：這次開著的時候照樣可以看
        note = stored ? '已匯入，排在最前面。' : '已匯入，但本機存不進去（空間不夠，或瀏覽器不讓存）；關掉頁面就沒了。';
      } else note = `匯入失敗：${d.why}`;
      if (!root.hidden) render();
    });
  });
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'contextmenu'] as const) root.addEventListener(type, e => e.stopPropagation());
  addEventListener('keydown', e => {
    if (root.hidden) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); (root.querySelector('#rpl-back') as HTMLElement | null)?.click(); return; }
    const keys = [...root.querySelectorAll('button')] as HTMLElement[], at = keys.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') { e.preventDefault(); keys[at < 0 ? 0 : (at + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]?.focus({ preventScroll: true }); }
    else if (at < 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); keys[0]?.focus({ preventScroll: true }); }
  }, true);
  addEventListener('keyup', e => { if (!root.hidden) e.stopPropagation(); }, true);
  bar.querySelector('#replay-leave')!.addEventListener('click', e => { e.stopPropagation(); stop(); host.leave(); });
  return { feed, open, playing: () => !!play };
}
