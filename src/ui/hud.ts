// HUD：DOM 疊在畫面上（中文字不在 3D 裡畫）。只讀狀態、只呼叫傳進來的動作，不直接改世界。
import type { AmmoMode } from './smoke.ts';

export interface HudState {
  ammo?: AmmoMode; howitzers?: number; // R107：只供榴彈砲的煙幕彈
  tick: number; paused: boolean; speed: number; fireMode: boolean; winner: number;
  mine: number; theirs: number; tanks: number; guns: number; observers: number; infantry?: number;
  ai?: string;   // R018 電腦難度
  build?: boolean; hint?: string;   // R006 布陣：藏掉暫停／速度／砲擊，提示列換成布陣說明
  rangeInfo?: string; // R113：當前單選武器的名目射程與散布上界
  info?: string;   // R009 選取資訊（平均血量、正在做什麼）
  report?: boolean;   // R010：勝負由戰報顯示，不出中間的橫幅
}
export interface HudActions {
  state: () => HudState;
  togglePause: () => void;
  cycleSpeed: () => void;
  toggleFire: () => void;
  toggleAmmo: () => void;
  selectAll: () => void;
  restart: () => void;
  help?: () => void;   // R013 說明面板
}
export interface Hud { update: () => void; frame: () => void }

export function initHud(a: HudActions): Hud {
  const root = document.createElement('div');
  root.id = 'hud';
  root.innerHTML = `
    <div class="bar top">
      <span class="title">微光小鎮·二戰 RTS <small>R001</small></span>
      <span id="clock">0:00</span>
      <span id="count"></span>
    </div>
    <div class="bar btns">
      <button id="b-pause" title="暫停／繼續（空白鍵）">⏸</button>
      <button id="b-speed" title="速度">1×</button>
      <button id="b-fire" title="砲擊模式：點地面＝對那一格開火">砲擊</button>
      <button id="b-ammo" title="切換高爆／煙幕；煙幕無傷害，遮住雙方視線" aria-label="彈種：高爆；點按切換煙幕" aria-pressed="false">高爆</button>
      <button id="b-all" title="選取全部我方單位">全選</button>
      <button id="b-restart" title="重新開始">↺</button>
      <button id="b-help" title="怎麼玩">？</button>
    </div>
    <div class="bar bottom" id="hint"></div>
    <div id="banner" hidden></div>`;
  document.body.appendChild(root);
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement;
  const act = (id: string, f: () => void) => $(id).addEventListener('click', e => { e.stopPropagation(); f(); update(); });
  act('b-pause', a.togglePause); act('b-speed', a.cycleSpeed); act('b-fire', a.toggleFire); act('b-ammo', a.toggleAmmo); act('b-all', a.selectAll); act('b-restart', a.restart); if (a.help) act('b-help', a.help);

  let lastSec = -1;
  function update() {
    const s = a.state();
    root.classList.toggle('build', !!s.build);
    $('b-pause').textContent = s.paused ? '▶' : '⏸';
    $('b-speed').textContent = `${s.speed}×`;
    $('b-fire').classList.toggle('on', s.fireMode);
    $('b-fire').setAttribute('aria-pressed', String(s.fireMode));
    const smoke = s.ammo === 'smoke';
    $('b-ammo').textContent = smoke ? '煙幕' : '高爆';
    $('b-ammo').classList.toggle('on', smoke);
    $('b-ammo').setAttribute('aria-pressed', String(smoke));
    $('b-ammo').setAttribute('aria-label', smoke ? '彈種：煙幕；點按切換高爆' : '彈種：高爆；點按切換煙幕');
    ($('b-ammo') as HTMLButtonElement).disabled = !!s.build;
    $('count').textContent = `我方 ${s.mine}　可見敵 ${s.theirs}${s.ai ? `　電腦：${s.ai}` : ''}`;
    const sel = s.tanks + s.guns + s.observers + (s.infantry ?? 0);
    $('hint').textContent = s.hint !== undefined ? s.hint : s.fireMode && smoke
      ? `${s.howitzers ? `已選榴彈砲 ${s.howitzers}：點地面、敵人或房子布煙；混選的其他單位不動。` : '煙幕只供榴彈砲：先點我方榴彈砲選取。'}煙幕無傷害，遮住雙方視線；按「砲擊」恢復移動／攻擊。`
      : sel
      ? `${s.info ? `${s.info}。` : ''}已選：${s.tanks ? `坦克 ${s.tanks}` : ''}${s.tanks && s.guns ? '、' : ''}${s.guns ? `砲 ${s.guns}` : ''}${s.infantry ? ` 步兵 ${s.infantry}` : ''}${s.observers ? ` 觀測員 ${s.observers}` : ''}${s.observers || s.infantry ? '（點房子進駐）' : ''}。點地面＝移動，點敵人＝攻擊，點房子＝轟它${s.fireMode ? '；砲擊模式：點地面＝對那一格開火' : ''}`
      : '點我方單位（藍圈）選取；拖曳平移，雙指或滾輪縮放';
    if (s.hint === undefined && s.rangeInfo) $('hint').textContent += `。${s.rangeInfo}`;
    const ban = $('banner');
    ban.hidden = s.winner < 0 || !!s.report;
    ban.textContent = s.winner === 0 ? '勝利' : s.winner === 1 ? '戰敗' : s.winner === 2 ? '同歸於盡' : '';
  }
  function frame() {
    const s = a.state(), sec = Math.floor(s.tick / 20);
    if (sec !== lastSec) { lastSec = sec; $('clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; update(); }
  }
  update();
  return { update, frame };
}
