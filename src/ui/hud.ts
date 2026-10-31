// HUD：DOM 疊在畫面上（中文字不在 3D 裡畫）。只讀狀態、只呼叫傳進來的動作，不直接改世界。
import type { AmmoMode } from './smoke.ts';

export interface HudState {
  audio?: { enabled: boolean; state: 'off' | 'on' | 'paused' | 'pending' | 'unavailable' }; // R117：只呈現實際音訊狀態
  ammo?: AmmoMode; howitzers?: number; // R107：只供榴彈砲的煙幕彈
  tick: number; paused: boolean; speed: number; fireMode: boolean; winner: number;
  mine: number; theirs: number; tanks: number; guns: number; observers: number; infantry?: number;
  ai?: string;   // R018 電腦難度
  mode?: string; // R045：波次與擊倒數，僅顯示模擬結果
  build?: boolean; hint?: string;   // R006 布陣：藏掉暫停／速度／砲擊，提示列換成布陣說明
  coverEnabled?: boolean; // R124：窄螢幕工具列跟隨獨立閥
  coverInfo?: string; // R124：當前砲擊建築的只讀耐久摘要
  vehicleInfo?: string; // R135：我方選取坦克／砲車的現有HP，混選顯示最低比例
  bombardInfo?: string; // R145: real fireAt order state, never inferred hit/success
  reloadInfo?: string; // R123：純讀坦克／砲車裝填，不表示能射擊
  rangeInfo?: string; // R113：當前單選武器的名目射程與散布上界
  vegetationInfo?: string; // R116：閒置時的地形規則，讓操作／射程／聲測提示優先
  counterbatteryInfo?: string; // R115：只有小地圖有有效粗略情報時顯示
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
  toggleAudio?: () => void; // R117：可選，不在 HUD 內建立音訊
}
export interface Hud { update: () => void; frame: () => void; vehicleFrame: (info: string) => void; bombardFrame: (info: string) => void }

export function initHud(a: HudActions): Hud {
  const root = document.createElement('div');
  root.id = 'hud';
  root.classList.toggle('has-audio', !!a.toggleAudio);
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
      ${a.toggleAudio ? '<button id="b-audio" title="音效已關；點按開啟" aria-label="音效已關；點按開啟" aria-pressed="false">音效關</button>' : ''}
    </div>
    <div class="bar bottom" id="hint"></div>
    <div id="banner" hidden></div>`;
  document.body.appendChild(root);
  const $ = (id: string) => root.querySelector('#' + id) as HTMLElement;
  const act = (id: string, f: () => void) => $(id).addEventListener('click', e => { e.stopPropagation(); f(); update(); });
  act('b-pause', a.togglePause); act('b-speed', a.cycleSpeed); act('b-fire', a.toggleFire); act('b-ammo', a.toggleAmmo); act('b-all', a.selectAll); act('b-restart', a.restart); if (a.help) act('b-help', a.help);
  if (a.toggleAudio) $('b-audio').addEventListener('click', e => { e.stopPropagation(); if (!e.isTrusted) return; a.toggleAudio!(); update(); });

  let lastSec = -1;
  let legacyHint = '', priorityHint = false, bombardText = '', vehicleText = '';
  function bombardFrame(info: string) { bombardText = info; vehicleFrame(vehicleText); }
  // R135 frame-only updates never read state or refresh other features' cached text.
  function vehicleFrame(info: string) {
    vehicleText = info;
    const base = !priorityHint && info ? `${info}。${legacyHint}` : legacyHint;
    const text = base + (!priorityHint && bombardText ? `。${bombardText}` : '');
    if ($('hint').textContent !== text) $('hint').textContent = text;
  }
  function update() {
    const s = a.state();
    root.classList.toggle('build', !!s.build);
    root.classList.toggle('cover-durability', !!s.coverEnabled);
    if (a.toggleAudio) {
      const audio = s.audio ?? { enabled: false, state: 'off' }, button = $('b-audio');
      const text = { off: '音效關', on: '音效開', paused: '音效停', pending: '待啟用', unavailable: '無音效' }[audio.state];
      const status = { off: '音效已關', on: '音效已開', paused: '音效暫停', pending: '音效等待啟用', unavailable: '音效不可用' }[audio.state];
      const label = `${status}；點按${audio.enabled ? '關閉' : '開啟'}`;
      button.textContent = text;
      button.setAttribute('aria-label', label); button.setAttribute('title', label);
      button.setAttribute('aria-pressed', String(audio.enabled));
      button.classList.toggle('on', audio.enabled);
    }
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
    $('count').textContent = `我方 ${s.mine}　可見敵 ${s.theirs}${s.mode ? `　${s.mode}` : s.ai ? `　電腦：${s.ai}` : ''}`;
    const sel = s.tanks + s.guns + s.observers + (s.infantry ?? 0);
    $('hint').textContent = s.hint !== undefined ? s.hint : s.fireMode && smoke
      ? `${s.howitzers ? `已選榴彈砲 ${s.howitzers}：點地面、敵人或房子布煙；混選的其他單位不動。` : '煙幕只供榴彈砲：先點我方榴彈砲選取。'}煙幕無傷害，遮住雙方視線；按「砲擊」恢復移動／攻擊。`
      : sel
      ? `${s.info ? `${s.info}。` : ''}已選：${s.tanks ? `坦克 ${s.tanks}` : ''}${s.tanks && s.guns ? '、' : ''}${s.guns ? `砲 ${s.guns}` : ''}${s.infantry ? ` 步兵 ${s.infantry}` : ''}${s.observers ? ` 觀測員 ${s.observers}` : ''}${s.observers || s.infantry ? '（點房子進駐）' : ''}。點地面＝移動，點敵人＝攻擊，點房子＝轟它${s.fireMode ? '；砲擊模式：點地面＝對那一格開火' : ''}`
      : '點我方單位（藍圈）選取；拖曳平移，雙指或滾輪縮放';
    if (s.hint === undefined && s.coverInfo) $('hint').textContent += `。${s.coverInfo}`;
    if (s.hint === undefined && s.reloadInfo) $('hint').textContent += `。${s.reloadInfo}`;
    if (s.hint === undefined && s.rangeInfo) $('hint').textContent += `。${s.rangeInfo}`;
    if (s.hint === undefined && s.counterbatteryInfo) $('hint').textContent += `。${s.counterbatteryInfo}`;
    if (s.hint === undefined && !sel && !s.fireMode && !s.rangeInfo && !s.counterbatteryInfo && s.vegetationInfo) $('hint').textContent += `。${s.vegetationInfo}`;
    bombardText = s.bombardInfo ?? '';
    legacyHint = $('hint').textContent ?? ''; priorityHint = s.hint !== undefined;
    vehicleFrame(s.vehicleInfo ?? '');
    const ban = $('banner');
    ban.hidden = s.winner < 0 || !!s.report;
    ban.textContent = s.winner === 0 ? '勝利' : s.winner === 1 ? '戰敗' : s.winner === 2 ? '同歸於盡' : '';
  }
  function frame() {
    const s = a.state(), sec = Math.floor(s.tick / 20);
    if (sec !== lastSec) { lastSec = sec; $('clock').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; update(); }
  }
  update();
  return { update, frame, vehicleFrame, bombardFrame };
}
