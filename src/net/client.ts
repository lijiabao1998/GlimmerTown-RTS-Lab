// R083 連線（合作）：接真的 WebSocket 與畫面——開始選單的「連線合作」那一頁、右上的狀態列。同步的規矩在 session.ts／lockstep.ts。
// R085 連線對戰：同一頁（「連線對戰」開的）；加入的人開戰時「我方」換成左上那一方（src/side.ts）。
// main.ts 只接四個地方：initNet（掛勾）、netLive（issue 不記紀錄）、netFeed（tick 拿指令）、netReady（迴圈等對方的包）。
import type { World } from '../sim/world.ts';
import type { Command } from '../sim/step.ts';
import { Session, type NetHost, type NetMsg, type Role } from './session.ts';
import { SIDE_ENEMY as TOP_LEFT } from '../sim/world.ts';
import { SIDE_PLAYER, setViewSide } from '../side.ts';

let host: NetHost | null = null, session: Session | null = null, sock: WebSocket | null = null, bar: HTMLElement | null = null, panel: HTMLElement | null = null;
let rtt = -1, stalledSince = -1, afterHost: (() => void) | null = null;
const versusWorlds = new WeakSet<World>();   // R085：對戰的世界（對方離線之後照樣算：左上那一方沒有電腦，不自動存）
const STALL_MS = 500, VERSUS_STALL_MS = 60000;   // R085 審查：對戰中對方停住（暫停、切到別的分頁）超過一分鐘＝當成離線
const GAVE_UP = '對方停了超過一分鐘（暫停或切到別的分頁）：當成離線，你繼續打';
let gaveUp: Session | null = null;

export function initNet(h: NetHost): void {
  host = h;
  const q = new URLSearchParams(location.search), room = q.get('room');
  if (room) connect(q.get('net') === 'join' ? 'join' : 'host', room, q.get('relay') ?? defaultRelay(), !!h.versus && q.get('vs') === '1');   // 分享的連結：?room=ABCD&net=join（守衛也走這條）；R085 房主 &vs=1＝對戰
  // R083 第二輪審查：連線那一頁開著時鍵盤不穿透到後面的開始選單與遊戲——Tab 只在這一頁的鍵之間、Esc＝關閉／取消（比開始選單早掛，先收到）
  addEventListener('keydown', e => {
    if (!panel) return;
    e.stopImmediatePropagation();
    const keys = [...panel.querySelectorAll('button, input')] as HTMLElement[], at = keys.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') { e.preventDefault(); keys[at < 0 ? 0 : (at + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]?.focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { e.preventDefault(); document.getElementById('net-close')?.click(); }
    else if (at < 0 && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); keys[0]?.focus({ preventScroll: true }); }
  }, true);
  addEventListener('keyup', e => { if (panel) e.stopImmediatePropagation(); }, true);
  (window as unknown as { __net: () => unknown }).__net = () => ({
    role: session?.role ?? null, me: session?.me ?? -1, room: session?.room ?? '', state: session?.state ?? 'off', why: session?.why ?? '', peer: !!session?.peer,
    live: !!session?.ls, desync: session?.ls?.desync ?? -1, checks: session?.ls?.checks ?? 0, rtt, tick: host?.world().tick ?? 0, versus: !!session?.versus, side: SIDE_PLAYER, ai: host?.world().ai?.length ?? 0,
  });
}
export const netAvailable = (): boolean => !!host;
export const netVersusAvailable = (): boolean => !!host?.versus;   // R085：開始選單有「連線對戰」
// R085：現在這個世界是連線對戰的局（對方離線之後照樣是）——main.ts 不自動存它
export const netVersus = (): boolean => !!host && versusWorlds.has(host.world());
// R085 審查：房主開了對戰的房、對方在、還沒開戰——開局卡片不說「敵方由電腦指揮」
export const netVersusNext = (): boolean => !!session?.versus && !session.ls && session.state === 'ready' && session.peer;
const mark = (): void => { if (session?.versus && session.world) versusWorlds.add(session.world); };
// 本機換了世界（重開、回主選單、看重播、沙盒、讀存檔）：這一局連線結束——斷線（對方收到「離開」自己繼續打），之後照單機（R083 審查）
function dropIfStale(): void { if (session?.stale()) { sock?.close(); sock = null; session = null; stalledSince = -1; paint(); } }
export const netLive = (): boolean => { dropIfStale(); return !!session?.live(); };
export function netReady(t: number): boolean {
  dropIfStale();
  let ok = !session || session.ready(t);
  if (ok) { if (stalledSince >= 0) { stalledSince = -1; paint(); } }
  else if (stalledSince < 0) { stalledSince = performance.now(); setTimeout(paint, STALL_MS + 20); }
  else if (session?.versus && session.ls && performance.now() - stalledSince > VERSUS_STALL_MS) {   // 對戰不能讓一方拿暫停把比賽卡住：斷線，對方收到「離開」；自己從他最後一包之後不再等
    const s = session; gaveUp = s; s.disconnected(); s.why = GAVE_UP; sock?.close(); sock = null; stalledSince = -1; ok = s.ready(t); paint();
  }
  return ok;
}
export function netFeed(w: World, pending: readonly Command[]): Command[] | null {
  dropIfStale();
  if (!session) return null;
  const before = session.live(), cmds = session.feed(w, pending);
  if (!before && session.live()) { mark(); paint(); }
  return cmds;
}

// 預設的伺服器：遊戲頁是由轉發伺服器給的（http）就用同一台；不然用本機（自己開 node server/relay.mjs）
export function defaultRelay(): string {
  try { const saved = localStorage.getItem('gtrts.v1.relay'); if (saved) return saved; } catch { /* 沒有本機儲存就算了 */ }
  return location.protocol === 'http:' && location.host ? `ws://${location.host}/relay` : 'ws://127.0.0.1:8788/relay';
}
// https 的頁面連不了的伺服器位址：ws://（不加密）而且不是本機（瀏覽器對本機放行：127.x.x.x、localhost、[::1]、*.localhost；R083 第二輪審查放寬）
export const httpsBlocks = (url: string): boolean => /^ws:/i.test(url) && !/^ws:\/\/(127(\.\d{1,3}){3}|localhost|\[::1\]|[a-z0-9.-]+\.localhost)([:/?#]|$)/i.test(url);
export const randomRoom = (): string => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function connect(role: Role, room: string, url: string, versus = false): void {
  if (!host) return;
  sock?.close();
  const h = host;
  // R085：加入的人開戰時（begin＝建空世界）照開局換「我方」：對戰＝左上那一方；reset() 先換回第 0 方，所以要在它之後
  const s: Session = new Session(role, { ...h, begin: seed => { h.begin(seed); setViewSide(s.versus ? TOP_LEFT : undefined); } }, m => { if (sock?.readyState === 1) sock.send(JSON.stringify(m)); }, versus);
  session = s; rtt = -1;
  let ws: WebSocket;
  if (location.protocol === 'https:' && httpsBlocks(url)) { s.state = 'error'; s.why = 'https 的頁面連不了 ws://（瀏覽器擋掉）：開轉發伺服器印出來的 http 網址，或用 wss:// 的伺服器'; paint(); return; }   // R083 審查
  try { ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}room=${encodeURIComponent(room.toUpperCase())}&role=${role}`); }
  catch { s.state = 'error'; s.why = '伺服器位址不對'; paint(); return; }
  sock = ws;
  ws.onmessage = e => {
    let m: NetMsg & { from?: number };
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === 'pong') { rtt = Math.round(performance.now() - m.id); paint(); return; }
    const wasHosting = s.state;
    s.receive(m);
    if (m.t === 'welcome') { try { localStorage.setItem('gtrts.v1.relay', url); } catch { /* 存不了就算了 */ } }
    if (m.t === 'welcome' && role === 'host' && wasHosting !== 'ready') { const next = afterHost; afterHost = null; closePanel(); next?.(); }
    if (m.t === 'start') { mark(); closePanel(); (document.querySelector('#start-menu:not([hidden]) #sm-setup-done') as HTMLElement | null)?.click(); (document.querySelector('#start-menu:not([hidden]) #sm-start, #start-menu:not([hidden]) #sm-resume') as HTMLElement | null)?.click(); }   // 用連結加入的人，開始選單還開著：關掉（R083 審查；第二輪：停在設定頁也先回第一頁再關）
    if (m.t === 'welcome' && role === 'join' && !panel) waitingPanel();
    paint();
  };
  let ping = 0;   // R083 第二輪審查：每條連線自己的計時器（舊連線關掉時不會清到新連線的）
  ws.onopen = () => { ping = window.setInterval(() => { if (ws.readyState === 1 && s.peer) ws.send(JSON.stringify({ t: 'ping', id: performance.now() })); }, 2000); };
  ws.onerror = () => { if (s.state === 'connecting') { s.state = 'error'; s.why = `連不上伺服器 ${url}`; paint(); } };
  ws.onclose = () => { clearInterval(ping); if (session === s) { s.disconnected(); if (gaveUp === s) s.why = GAVE_UP; } paint(); };
  paint();
}

// 右上的狀態列：房號、幾個人、延遲；等對方、不同步、對方離線
function statusText(): string {
  const s = session;
  if (!s) return '';
  if (s.state === 'error') return `連線：${s.why}`;
  if (s.state === 'connecting') return '連線中…';
  const ls = s.ls;
  if (ls && ls.desync >= 0) return `不同步（第 ${ls.desync} 步）：這一局停在這裡`;
  if (ls && s.peerLeft) return s.why || '對方離線了：你繼續打';
  if (ls && stalledSince >= 0 && performance.now() - stalledSince >= STALL_MS) return '等另一位玩家…';
  if (s.state === 'ended') return `連線：${s.why || '結束了'}`;
  const who = s.peer ? '2 人' : s.role === 'host' ? '等第二位玩家（把房號告訴他）' : '等房主';
  const vs = s.versus ? (ls ? `對戰（你指揮${SIDE_PLAYER === TOP_LEFT ? '左上' : '右下'}）｜` : '對戰｜') : '';   // R085
  return `連線 ${s.room}｜${vs}${who}${rtt >= 0 && s.peer ? `｜延遲 ${rtt} 毫秒` : ''}${s.role === 'join' && !ls ? '｜等房主開戰…' : ''}`;
}
function paint(): void {
  const text = statusText();
  if (!bar && text) {
    bar = document.createElement('div'); bar.id = 'net-status';
    bar.style.cssText = 'position:fixed;right:8px;top:52px;z-index:30;max-width:70vw;padding:4px 10px;border-radius:6px;font:13px/1.4 system-ui,sans-serif;background:rgba(20,24,20,.78);color:#f2ecd8;pointer-events:none';
    document.body.appendChild(bar);
  }
  if (bar) { bar.textContent = text; bar.hidden = !text; }
  const msg = document.getElementById('net-msg');
  if (msg) msg.textContent = session && (session.state === 'error' || session.state === 'ended') ? session.why : session?.role === 'join' && session.state === 'waiting' ? `已加入房號 ${session.room}，等房主開戰…` : session?.state === 'connecting' ? '連線中…' : '';
}

// 開始選單的「連線合作」那一頁：伺服器、房號、開房／加入。onHosted：開房成功之後（回到開始選單照平常開局）
// R085 versus：「連線對戰」開的同一頁——開房的是對戰的房（加入的人不用選，照房主的開局）
export function openNetPanel(onHosted: () => void, versus = false): void {
  closePanel();
  panel = document.createElement('div');
  panel.id = 'net-panel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,12,10,.6);font:15px/1.5 system-ui,sans-serif;color:#f2ecd8';
  const field = 'width:100%;box-sizing:border-box;min-height:44px;margin:4px 0 10px;padding:6px 10px;font:inherit;border-radius:6px;border:1px solid #8a8570;background:#2a2d26;color:inherit';
  const btn = 'min-width:96px;min-height:44px;margin:4px 6px 0 0;font:inherit;border-radius:6px;border:1px solid #c9b77a;background:#4a4630;color:inherit';
  panel.innerHTML = `<div style="width:min(92vw,420px);padding:16px 18px;border-radius:10px;background:#22251f;box-shadow:0 6px 24px rgba(0,0,0,.5)">
    <h2 style="margin:0 0 6px;font-size:18px">${versus ? '連線對戰' : '連線合作'}</h2>
    <p style="margin:0 0 10px;font-size:13px;opacity:.85">${versus ? '兩個人對打，沒有電腦。開房的人指揮右下，照平常選地圖、布陣、開戰；另一個人輸入同一個房號加入，指揮左上（左上的布陣先由電腦代排）。' : '兩個人一起指揮我方，跟電腦打。開房的人照平常選地圖、布陣、開戰；另一個人輸入同一個房號加入。'}</p>
    <label>伺服器<input id="net-relay" style="${field}" autocomplete="off" spellcheck="false"></label>
    <label>房號<input id="net-room" style="${field}" maxlength="12" autocomplete="off" spellcheck="false"></label>
    <div><button id="net-host" style="${btn}">開房</button><button id="net-join" style="${btn}">加入</button><button id="net-close" style="${btn}">關閉</button></div>
    <p id="net-msg" style="min-height:1.5em;margin:10px 0 0;font-size:13px"></p>
    <p style="margin:6px 0 0;font-size:12px;opacity:.7">伺服器：在一台電腦上跑 <code>node server/relay.mjs</code>，同一個區域網路的人開它給的網址就好（README「連線合作」）。</p>
  </div>`;
  document.body.appendChild(panel);
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();
  (document.getElementById('net-relay') as HTMLInputElement).value = defaultRelay();
  (document.getElementById('net-room') as HTMLInputElement).value = randomRoom();
  document.getElementById('net-host')!.onclick = () => { afterHost = onHosted; connect('host', val('net-room'), val('net-relay'), versus); };
  document.getElementById('net-join')!.onclick = () => connect('join', val('net-room'), val('net-relay'));
  document.getElementById('net-close')!.onclick = () => { if (session && !session.ls && (session.role === 'join' || session.state !== 'ready')) { sock?.close(); sock = null; session = null; paint(); } closePanel(); onHosted(); };   // R083 審查：開房失敗的也清掉
  (document.getElementById('net-host') as HTMLElement).focus({ preventScroll: true });   // R083 第二輪審查：鍵盤在這一頁
  paint();
}
function closePanel(): void { panel?.remove(); panel = null; }
// 用連結（?room=…&net=join）加入的人：蓋一層「等房主開戰」，不讓開始選單在等的時候被按（R083 審查）
function waitingPanel(): void {
  panel = document.createElement('div');
  panel.id = 'net-panel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,12,10,.6);font:15px/1.5 system-ui,sans-serif;color:#f2ecd8';
  panel.innerHTML = `<div style="width:min(92vw,380px);padding:16px 18px;border-radius:10px;background:#22251f"><h2 style="margin:0 0 6px;font-size:18px">連線合作</h2><p id="net-msg" style="min-height:1.5em;margin:0 0 10px"></p><button id="net-close" style="min-width:96px;min-height:44px;font:inherit;border-radius:6px;border:1px solid #c9b77a;background:#4a4630;color:inherit">取消</button></div>`;
  document.body.appendChild(panel);
  document.getElementById('net-close')!.onclick = () => { sock?.close(); sock = null; session = null; closePanel(); paint(); };
  (document.getElementById('net-close') as HTMLElement).focus({ preventScroll: true });   // R083 第二輪審查：焦點在「取消」，後面的開始選單按不到
  paint();
}
