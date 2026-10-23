import { hqDurability } from './ui/hqDurability.ts';
import { productionBlockReason } from './ui/productionBlockReason.ts';
import { productionCountdown } from './ui/productionCountdown.ts';
import { coverDurability } from './ui/coverDurability.ts';
import { reloadStatus } from './ui/reloadStatus.ts';
// 進入點：固定步長迴圈（模擬 20 步／秒，畫面每幀插值）、觸控與滑鼠輸入、HUD、守衛掛勾 window.__rts。
import * as THREE from 'three';
import { createWorld, hashWorld, SUB, TICK_HZ, SHELL_HE, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UNIT_KINDS, BK_COTTAGE, BK_WIRE, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, isWallKind, bldMaxHp, cellOf, type World } from './sim/world.ts';
import { BUILD_KINDS, BUILD_KINDS_24, WIRE_KIND, WALL_KINDS, BUILD_POINTS, applyBuild, buildError, buildKind, enemyPlan, type BuildCmd } from './sim/build.ts';
import { TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench, type TrenchCmd } from './sim/trenches.ts';
import { step, runLog, commandTick, type Command, type LoggedCommand } from './sim/step.ts';
import { createSandboxWorld, sandboxPlaceError, type SandboxCommand } from './sim/sandbox.ts';
import { initSandbox, type SandboxBar } from './ui/sandbox.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from './sim/script.ts';
import { BattleView } from './render/battle.ts';
import { BattleAudio } from './render/audio.ts';
import { STYLE_A, type Style } from './render/post.ts';
import { initHud, type Hud } from './ui/hud.ts';
import { routeBattleOrder, type AmmoMode } from './ui/smoke.ts';
import { Gestures, inSelectionRect, type SelectionRect } from './ui/gestures.ts';
import { initCommandMenu, bombardCommand, bombardTarget, type CommandMenu } from './ui/commandMenu.ts';
import { initBuildBar, type BuildBar } from './ui/build.ts';
import { Fling, Glide } from './ui/camera.ts';
import { applyMap, MAP_RYE } from './sim/maps.ts';
import { MAP_LARGE } from './sim/largeMap.ts';
import { initMapPick, type MapPick } from './ui/mapPick.ts';
import { materialBuildDetail } from './ui/materials.ts';
import { setFacades, setMaterials, setWireDetail, setWalls } from './render/buildings.ts';
import { setStreets } from './render/battle.ts';
import { setVegetation } from './render/vegetation.ts';
import { initProduction, type ProdBar } from './ui/production.ts';
import { initHelp } from './ui/help.ts';
import { initMinimap, type Minimap } from './ui/minimap.ts';
import { counterbatteryHint } from './ui/counterbattery.ts';
import { newStats, statsStep, makeReport, slowmoFactor, SLOWMO_MS, type BattleStats } from './ui/report.ts';
import { initReportView, type ReportView } from './ui/reportView.ts';
import { showStartOrder, startOrderText } from './ui/startOrder.ts';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? SCRIPT_SEED) >>> 0;
const style: Style = { ...STYLE_A, pixelCss: Math.max(1, Math.min(4, Number(q.get('px') ?? STYLE_A.pixelCss) | 0)) };
// 逃生閥：?fx=off 或 window.__noFx＝true 時不產生爆炸、煙（AGENTS.md：新效果都要關得掉）
const fxOn = q.get('fx') !== 'off' && !(window as unknown as { __noFx?: boolean }).__noFx;
const r117 = fxOn && q.get('noR117') !== '1';
// R004 破壞的重量：倒塌、碎片、火與曳光。逃生閥 ?noR004=1＝舊效果（模擬雜湊不變）
const r004 = q.get('noR004') !== '1';
// R008 車輛有重量：車轍、揚塵、後座、砲塔轉向、受擊閃光。逃生閥 ?noR008=1
const r008 = q.get('noR008') !== '1';
// R009 血條與戰況。逃生閥 ?noR009=1
const r009 = q.get('noR009') !== '1';
// R010 結局與戰報：最後一擊慢動作、鏡頭移到最後一擊、戰報。逃生閥 ?noR010=1＝原本的橫幅
const r010 = q.get('noR010') !== '1';
// R012 鏡頭手感：縮放對準手指／游標、拖曳慣性、雙擊單位鏡頭跟過去。逃生閥 ?noR012=1
const r012 = q.get('noR012') !== '1';
// R037 手勢計時看事件自己的時間戳（手指真的動、真的放的時刻），不看程式處理到事件的時間：
// 畫面卡一下（手機掉幀、CI 機器忙）時，快速拖曳放手照樣滑出去、雙擊照樣跟過去。逃生閥 ?noR037=1＝回到處理當下的時間
const r037 = q.get('noR037') !== '1';
const fling = new Fling(), glide = new Glide(), camStep = { x: 0, z: 0 };
let dragV = { vx: 0, vy: 0, t: 0 }, lastTap = { id: 0, t: -1e9 };
let stats: BattleStats, endT0 = -1, endFrom: { x: number; z: number; zoom: number } | null = null, reportShown = false, reportView: ReportView | undefined;
// R011 指令回饋：選取單位的路線、攻擊線、砲擊準星。逃生閥 ?noR011=1
const r011 = q.get('noR011') !== '1';
// R014 牆上的彈孔與燻黑。逃生閥 ?noR014=1
const r014 = q.get('noR014') !== '1';
// R015 小地圖。逃生閥 ?noR015=1
const r015 = q.get('noR015') !== '1';
const r116 = q.get('noR116') !== '1';
const r118 = q.get('noR118') !== '1'; // 只關戰壕選項與呈現；舊紀錄中的指令照常執行
const r120 = q.get('noR120') !== '1'; // 只關圍牆選項與外形；紀錄中的牆仍是可見、可破壞建築
setWalls(r120);
const r121 = q.get('noR121') !== '1';
setWireDetail(r121);
setVegetation(r116); // 只關模型與提示；新局地形仍由明確的 map 指令啟用
const r115 = q.get('noR115') !== '1'; // 只關估計區與提示，不改情報模擬
let minimap: Minimap | undefined;
// R016 開戰儀式：布陣的房子從地面升起、「開戰！」大字。逃生閥 ?noR016=1
const r016 = q.get('noR016') !== '1';
const r104 = q.get('noR104') !== '1'; // 裝甲弧提示；只關畫面，不改模擬
const r109 = q.get('noR109') !== '1';
const r128 = q.get('noR128') !== '1';
let sandboxBar: SandboxBar | undefined, sandboxTool: number | null = UK_TANK, sandboxSide = SIDE_PLAYER, sandboxHint = '';
let lastRangeInfo = '';
let lastCoverInfo = ''; // R124：同 tick 傷害／換選／重播也重算
let lastReloadInfo = ''; // R123：同 tick 換選與清理也重算
let lastVegetationInfo = '';
let lastCounterbatteryInfo = '';
let lastCounterbatteryWorld: World | undefined;
let commandMenu: CommandMenu | undefined;
let battleHint: string | undefined;
const r107 = q.get('noR107') !== '1'; // 只關煙團畫面；煙幕指令與視線模擬保持啟用
const r105 = q.get('noR105') !== '1';
setMaterials(r105); // R105 材質視覺提示；只關畫面，模擬不變
setFacades(q.get('noR028') !== '1');
setStreets(q.get('noR027') !== '1');   // R027 人行道與燈火管制路緣；逃生閥 ?noR027=1   // R028 外牆細節（木構、掛瓦、護牆板）；逃生閥 ?noR028=1＝全部紅磚原樣
// R041 開戰命令條（取代上面的發光大字）。逃生閥 ?noR041=1＝回到 R016 的「開戰！」
const r041 = q.get('noR041') !== '1';
function startOrder() {
  // 開戰這一刻 eco／ai 指令還在佇列裡沒套用：看同一組開關（r019 指揮部、r018 電腦），不看世界
  showStartOrder(document.getElementById('hud') ?? document.body, startOrderText(w.map ?? 0, r019, r018 ? AI_NAME[aiLevel] : undefined));
}
function startBanner() {
  const el = document.createElement('div');
  el.id = 'start-banner'; el.textContent = '開戰！';
  (document.getElementById('hud') ?? document.body).appendChild(el);
  setTimeout(() => el.remove(), 1300);   // 只是畫面上的字，跟模擬無關
}

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

let w: World, view: BattleView, log: LoggedCommand[], pending: Command[];
let hud: Hud | undefined, buildBar: BuildBar | undefined;
let acc = 0, paused = false, speed = 1, fireMode = false, lastT = performance.now();
let ammo: AmmoMode = 'he';
const selected = new Set<number>();
const SPEEDS = [1, 2, 4];

// ---- R006 布陣：開頁先停在第 0 步，玩家在我方半場蓋房子，按「開戰」才開打。逃生閥 ?noR006=1＝直接開打（R102 的流程）----
const r006 = q.get('noR006') !== '1';
let phase: 'build' | 'battle' = 'battle';
// R117：預設靜音。只有原生音效鍵會建立／解鎖 context；模擬與重播不碰它。
const battleAudio = r117 ? new BattleAudio(() => hud?.update()) : undefined;
let audioPageActive = true, audioHelpActive = false;
function syncBattleAudio() {
  battleAudio?.setActive(phase === 'battle' && !paused && !reportShown && !audioHelpActive && !document.hidden && audioPageActive);
}
type PlanCmd = BuildCmd | TrenchCmd;
let plan: PlanCmd[] = [], pickKind = BK_COTTAGE, pickRot = 0, buildHint = '';
let pickTrench = -1, trenchRot = 0;
const TRENCH_LABEL = ['直段', '折線', '交通壕', '加固段'];
const TRENCH_SHAPE = ['2格直線', '3格L形', '4格直線', '2格加固'];
const BUILD_LABEL: Record<number, string> = { [BUILD_KINDS[0].kind]: '農舍', [BUILD_KINDS[1].kind]: '磚房', [BUILD_KINDS[2].kind]: '穀倉', [BUILD_KINDS_24[3].kind]: '碉堡', [BK_WALL_BRICK]: '矮磚牆', [BK_WALL_STONE]: '石牆', [BK_WALL_CONCRETE]: '混凝土牆', [BK_WIRE]: '鐵絲網' };
const BUILD_WHY: Record<string, string> = {
  tick: '已經開戰，不能再蓋', map: '超出地圖', foreign: '那是敵方半場（紅色）；只能蓋在我方半場（藍色）',
  neutral: '那是中間的無人帶；只能蓋在我方半場（藍色）', mud: '不能蓋在泥灘上', road: '不能蓋在路上', occupied: r118 ? '那裡已有房子或戰壕' : '那裡已經有房子',
  trench: '那裡已經有戰壕', unit: '有單位站在那裡', blocked: '會堵死通路', gap: '太靠近別的房子（要隔一格）',
};
const BUILD_TIP = '布陣：點藍色地面蓋房子當掩體、擋視線；點蓋好的房子拿掉；蓋好按「開戰」';

// 預覽＝真的世界的複本套上這次的布陣（同一支 applyBuild／applyTrench，規則只有一份）
function previewWorld(): World {
  const pv = structuredClone(w);
  for (const c of plan) { if (c.t === 'trench') applyTrench(pv, c); else applyBuild(pv, c); }
  pv.events = [];
  return pv;
}
function refreshPreview() { if (phase === 'build') view.setWorld(previewWorld(), SIDE_PLAYER); }
const pointsLeft = () => BUILD_POINTS - plan.reduce((p, c) => p + ((c.t === 'trench' ? trenchKind(c.kind) : buildKind(c.kind))?.cost ?? 0), 0);

// R018 電腦對手：開戰時送 ai 指令（記在指令紀錄裡，重播自動一致）。?ai=1|2|3 選難度；逃生閥 ?noR018=1＝敵人原地還擊
const r018 = q.get('noR018') !== '1';
// R019 生產與補給：開戰時送 eco（雙方指揮部、補給、打掉指揮部才贏）。逃生閥 ?noR019=1
const r019 = q.get('noR019') !== '1';
// R021 步兵班：eco 帶 inf＝1（雙方各一班、可出步兵）。逃生閥 ?noR021=1
const r021 = q.get('noR021') !== '1';
const r022 = q.get('noR022') !== '1';   // R022 反戰車砲、迫擊砲（關掉＝eco 不帶 guns：生產列沒有、電腦不出）
const r026 = q.get('noR026') !== '1';   // R026 Rye 1940 手排地圖（關掉＝亂數村莊）
// R043 大地圖：布陣時左上「地圖」鍵在萊伊 32×32 與鄉間 64×64 之間換；?map=64 直接開。逃生閥 ?noR043=1＝沒有這顆鍵、不認 ?map=64
const r043 = q.get('noR043') !== '1';
let large = r043 && q.get('map') === '64';
document.body.classList.toggle('r043', r043);   // 說明面板的大地圖那一句只在開著時出現（index.html 的 body.r043）
let mapPick: MapPick | undefined;
const r024 = q.get('noR024') !== '1';   // R024 碉堡（關掉＝布陣列沒有碉堡、敵方布陣也不蓋）
const BUILD_KINDS_NOW = r024 ? BUILD_KINDS_24 : BUILD_KINDS;
const r023 = q.get('noR023') !== '1';   // R023 輕坦克、重坦克（關掉＝eco 不帶 tanks：生產列沒有、電腦不出）
const r044 = q.get('noR044') !== '1';   // R044 裝甲車、驅逐戰車、突擊砲（關掉＝eco 不帶 armor2：生產列沒有、電腦不出）
document.body.classList.toggle('r044', r044);   // R044 生產列排版、說明的剋制那一句只在開著時套（index.html 的 body.r044）
const ecoCmd = (): Command => ({ t: 'eco', ...(r021 ? { inf: 1 } : {}), ...(r022 ? { guns: 1 } : {}), ...(r023 ? { tanks: 1 } : {}), ...(r044 ? { armor2: 1 } : {}) });
let prodBar: ProdBar | undefined;
const aiLevel = Math.max(1, Math.min(3, Number(q.get('ai') ?? 2) | 0 || 2));
const AI_NAME = ['', '簡單', '普通', '困難'];

function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026 || large, vegetation = true, sandbox = false) {
  if (r109) clearGestureInput();
  battleAudio?.reset();
  w = sandbox ? createSandboxWorld(s) : createWorld(s);
  // 預覽與紀錄共用設定；五項舊功能全部關閉的腳本仍明確傳 vegetation=false。
  // R043：一般開局（map＝true）才看地圖鍵選的大地圖；腳本、重播傳 map＝false，不受影響
  const mapId = map ? (large ? MAP_LARGE : MAP_RYE) : 0;
  if (map || vegetation) applyMap(w, mapId, vegetation ? 1 : undefined);
  view?.dispose();
  view = new BattleView(w, fxOn, !w.sandbox && q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009, r011, r014, r016, r107, q.get('noR113') !== '1', r118, r104, q.get('noR123') !== '1');
  view.multiRangeEnabled = q.get('noR122') !== '1';
  if (w.map === MAP_LARGE) view.target.set(55, 0, 55);   // R043：大地圖開局鏡頭對準我方裝甲連（右下角落）
  log = []; pending = []; acc = 0; selected.clear(); fireMode = false; ammo = 'he';
  stats = newStats(w); endT0 = -1; endFrom = null; reportShown = false; reportView?.hide();
  plan = []; buildHint = ''; phase = build ? 'build' : 'battle';
  battleHint = undefined; sandboxHint = ''; lastTap = { id: 0, t: -1e9 };
  if (sandbox) paused = true;
  if (map || vegetation) issue({ t: 'map', id: mapId, ...(vegetation ? { vegetation: 1 } : {}) });
  if (build) { paused = true; refreshPreview(); }
  else {   // 沒有布陣：開頁就開打，第 0 步放指揮部、電腦接手
    if (eco) issue(ecoCmd());
    if (ai) issue({ t: 'ai', side: SIDE_ENEMY, level: aiLevel });
  }
  ui();
  syncBattleAudio();
}
function ui() { hud?.update(); buildBar?.update(); prodBar?.update(); sandboxBar?.update(); mapPick?.update(); }

function sandboxAction(cmd: SandboxCommand) {
  if (!w.sandbox || audioHelpActive) return;
  issue(cmd);
  // 運行中放兵排入下一個 20Hz step；暫停編輯、暫停及重置可即時處理，但不跑戰鬥。
  if (paused || cmd.t !== 'sandboxPlace') {
    tick(); acc = 0; paused = !w.sandbox.running;
    syncBattleAudio(); ui();
  }
}
function setPaused(value: boolean) {
  if (w.sandbox) { if (w.sandbox.running === value) sandboxAction({ t: 'sandboxRun', running: !value }); }
  else paused = value;
  syncBattleAudio(); ui();
}
function sandboxPlaceAt(cx: number, cy: number) {
  const p = view.groundAt(cx, cy, innerWidth, innerHeight);
  if (!p || sandboxTool === null) return;
  const cmd = { t: 'sandboxPlace' as const, side: sandboxSide, kind: sandboxTool, x: Math.floor(p.x), z: Math.floor(p.z) };
  const err = sandboxPlaceError(w, cmd);
  const why = { mode: '目前不是沙盒。', side: '請選我方或敵方。', kind: '僅能放置坦克或榴彈砲。', map: '超出地圖。', building: '有建築擋住這一格。', unit: '已有單位，請換一格。', capacity: '已達 32 輛上限（含殘骸）；請重置後再放置。' };
  sandboxHint = err ? why[err] : '已下放置指令。';
  if (!err) sandboxAction(cmd);
  sandboxBar?.update();
}

// 開戰：我方布陣＋敵方布陣都寫進指令紀錄（第 0 步），馬上走第一步讓房子落地（中間不畫任何一幀，不會閃）
function startBattle() {
  if (phase !== 'build') return;
  const pv = previewWorld(), enemy = enemyPlan(pv, BUILD_KINDS_NOW);
  for (const c of plan) issue(c);
  for (const c of enemy) issue(c);
  if (r019) issue(ecoCmd());
  if (r018) issue({ t: 'ai', side: SIDE_ENEMY, level: aiLevel });
  phase = 'battle'; plan = []; buildHint = '';
  if (r016) { if (r041) startOrder(); else startBanner(); }
  view.setWorld(w, -1);
  tick();
  paused = false;
  syncBattleAudio();
  ui();
}

function placeAt(cx: number, cy: number) {
  // 點到已經放好的房子＝拿掉它（只認這次布陣的，地圖上原本的房子不算）
  const hitB = view.buildingAt(cx, cy, innerWidth, innerHeight);
  if (hitB) {
    const k = plan.findIndex(c => { if (c.t !== 'build') return false; const kd = buildKind(c.kind)!, fw = c.rot ? kd.d : kd.w, fd = c.rot ? kd.w : kd.d; return hitB[0] >= c.x && hitB[1] >= c.z && hitB[0] < c.x + fw && hitB[1] < c.z + fd; });
    if (k >= 0) { plan.splice(k, 1); buildHint = '拿掉了一棟'; refreshPreview(); ui(); return; }
  }
  const p = view.groundAt(cx, cy, innerWidth, innerHeight);
  if (!p) return;
  const gx = Math.floor(p.x), gz = Math.floor(p.z);
  if (gx < 0 || gz < 0 || gx >= w.n || gz >= w.n) return;
  // 圍牆模型窄於佔地：點任一佔地格仍能拿掉整段，不必精準命中薄牆表面。
  const wallIndex = plan.findIndex(c => { if (c.t !== 'build' || !(isWallKind(c.kind) || c.kind === BK_WIRE)) return false; const kd = buildKind(c.kind)!, fw = c.rot ? kd.d : kd.w, fd = c.rot ? kd.w : kd.d; return gx >= c.x && gz >= c.z && gx < c.x + fw && gz < c.z + fd; });
  if (wallIndex >= 0) { plan.splice(wallIndex, 1); buildHint = '拿掉了一段障礙'; refreshPreview(); ui(); return; }
  // 一段壕溝的任一實際格都能拿掉整段；L形空角不是戰壕。
  const trenchIndex = plan.findIndex(c => c.t === 'trench' && trenchCells(c).some(([x, z]) => x === gx && z === gz));
  if (trenchIndex >= 0) { plan.splice(trenchIndex, 1); buildHint = '拿掉了一段戰壕'; refreshPreview(); ui(); return; }
  const kd = buildKind(pickKind)!, rot = kd.w !== kd.d ? pickRot : 0;
  const cmd: PlanCmd = pickTrench >= 0
    ? { t: 'trench', side: SIDE_PLAYER, kind: pickTrench, x: gx, z: gz, rot: trenchRot }
    : { t: 'build', side: SIDE_PLAYER, kind: pickKind, x: gx, z: gz, ...(rot ? { rot } : {}) };
  const label = cmd.t === 'trench' ? TRENCH_LABEL[cmd.kind] : BUILD_LABEL[cmd.kind];
  const cost = cmd.t === 'trench' ? trenchKind(cmd.kind)!.cost : kd.cost;
  const pv = previewWorld(), err = cmd.t === 'trench' ? trenchError(pv, cmd) : buildError(pv, cmd);
  if (err) {
    buildHint = err === 'points' ? `建材不夠（剩 ${pointsLeft()}，${label}要 ${cost}）` : BUILD_WHY[err] ?? '這裡不能蓋';
    view.setMarker(gx + 0.5, gz + 0.5, simT(), true);
  } else {
    plan.push(cmd); buildHint = `${label}蓋好了，剩建材 ${pointsLeft()}`;
    view.setMarker(gx + 0.5, gz + 0.5, simT(), false);
    refreshPreview();
  }
  ui();
}

function issue(cmd: Command) {
  log.push({ tick: w.sandbox ? commandTick(w) : w.tick, cmd });
  pending.push(cmd);
}

const simT = (alpha = 0) => (w.tick + alpha) / TICK_HZ;

function tick() {
  view.snapshot();
  const now = pending; pending = [];
  const priorWinner = w.winner, priorMap = w.map;
  step(w, now);
  if (w.sandbox) {
    if (now.some(c => c.t === 'sandboxReset')) {
      const priorView = view;
      priorView.dispose(); view = priorView.recreate(w);
      selected.clear(); fireMode = false; ammo = 'he'; battleHint = undefined; sandboxHint = '已重置；沙盒暫停。';
      stats = newStats(w); minimap?.dirty(); battleAudio?.reset();
    }
    if (!w.sandbox.running || now.some(c => c.t === 'sandboxPlace' || c.t === 'sandboxReset')) view.snapshot(); // 新 ID 不從 (0,0) 插值；運行時仍保留既有移動插值。
    sandboxBar?.update();
  }
  if (r109 && priorWinner < 0 && w.winner >= 0) clearGestureInput();
  view.onEvents(w.events, simT());
  if (minimap && (priorMap !== w.map || w.events.some(e => e.e === 'stage' || e.e === 'build' || e.e === 'trench' || (e.e === 'impact' && e.kind === SHELL_HE)))) minimap.dirty();   // R015 地形變了才重畫底圖
  statsStep(stats, w, w.events);
}

// ---- 輸入：單指點＝選取／下指令；單指拖＝平移；雙指＝縮放；滾輪＝縮放；右鍵＝下指令 ----
const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
let dragged = false, pinchD = 0;

function pickUnit(cx: number, cy: number): number {
  let best = 0, bestD = 26 * 26;
  for (const u of w.units) {
    if (!u.alive || !view.visibleUnit(u)) continue;
    const [sx, sy] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, innerWidth, innerHeight);
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = u.id; }
  }
  return best;
}

// R110：暫停時沒有下一個模擬秒，清提示必須同步刷新 HUD。
function clearBattleHint() {
  if (battleHint === undefined) return;
  battleHint = undefined;
  hud?.update();
}

function order(cx: number, cy: number) {
  if (w.sandbox && sandboxTool !== null) { sandboxPlaceAt(cx, cy); return; }
  if (r109) clearBattleHint();
  if (phase === 'build') { placeAt(cx, cy); return; }
  const route = routeBattleOrder(w, selected, fireMode, ammo, {
    unit: pickUnit(cx, cy),
    building: view.buildingAt(cx, cy, innerWidth, innerHeight),
    ground: view.groundAt(cx, cy, innerWidth, innerHeight),
  });
  if (!route) return;
  for (const cmd of route.commands) issue(cmd);
  view.setMarker(route.marker.x, route.marker.z, simT(), route.marker.hostile);
}

function tap(cx: number, cy: number, additive: boolean, t = performance.now()) {
  if (w.sandbox && sandboxTool !== null) { sandboxPlaceAt(cx, cy); return; }
  if (r109) clearBattleHint();
  const hit = pickUnit(cx, cy), u = hit ? w.units[hit - 1] : null;
  if (u && u.side === SIDE_PLAYER) {
    // 雙擊：鏡頭跟過去。兩次放手的間隔用事件時間量（R037）；滑過去的動畫照樣用現在的時間起算
    if (r012 && lastTap.id === u.id && t - lastTap.t < 350) glide.start(view.target.x, view.target.z, u.x / SUB, u.z / SUB, performance.now() / 1000);
    lastTap = { id: u.id, t };
    if (!additive) selected.clear();
    if (additive && selected.has(u.id)) selected.delete(u.id); else selected.add(u.id);
    hud?.update();
    return;
  }
  if (phase === 'build') { placeAt(cx, cy); return; }
  order(cx, cy);
}

// R109 只加快捷手勢；矩形用和點選相同的畫面座標（包含進駐屋頂高度）。
function selectInBox(rect: SelectionRect) {
  for (const u of w.units) {
    if (!u.alive || u.side !== SIDE_PLAYER) continue;
    const [x, y] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, innerWidth, innerHeight);
    if (inSelectionRect(rect, x, y)) selected.add(u.id);
  }
  battleHint = undefined; hud?.update();
}
const selectionBox = r109 ? document.createElement('div') : null;
if (selectionBox) { selectionBox.id = 'selection-box'; selectionBox.hidden = true; document.body.appendChild(selectionBox); }
const gestures = r109 ? new Gestures({
  enabled: () => phase === 'battle' && (!w.sandbox || sandboxTool === null) && w.winner < 0 && !help.visible() && !reportView?.visible(),
  box: rect => {
    if (!selectionBox) return;
    selectionBox.hidden = !rect;
    if (rect) {
      fling.stop(); glide.stop();
      selectionBox.style.left = `${rect.left}px`; selectionBox.style.top = `${rect.top}px`;
      selectionBox.style.width = `${rect.right - rect.left}px`; selectionBox.style.height = `${rect.bottom - rect.top}px`;
    }
  },
  select: selectInBox,
  hold: (cx, cy) => {
    fling.stop(); glide.stop();
    const target = bombardTarget(w, {
      unit: pickUnit(cx, cy), building: view.buildingAt(cx, cy, innerWidth, innerHeight),
      ground: view.groundAt(cx, cy, innerWidth, innerHeight),
    });
    battleHint = target ? '選擇這一格的高爆砲擊或煙幕；放手不會下指令。' : '這裡不在地圖內，請長按地圖上的目標。';
    hud?.update(); prodBar?.update();
    if (target) commandMenu?.open(target, cx, cy);
  },
  dismiss: () => { if (commandMenu?.isOpen()) { commandMenu.close(); battleHint = undefined; hud?.update(); } },
}) : null;
function clearGestureInput() {
  gestures?.cancel(); pointers.clear(); dragged = true; pinchD = 0;
  fling.stop(); glide.stop(); dragV = { vx: 0, vy: 0, t: 0 }; clearBattleHint();
}
if (r109) {
  commandMenu = initCommandMenu({
    choose: (chosen, target) => {
      if (phase !== 'battle' || w.winner >= 0 || help.visible() || reportView?.visible()) {
        battleHint = '目前不能下砲擊指令。'; hud?.update(); return;
      }
      const cmd = bombardCommand(w, selected, target, chosen);
      if (cmd) {
        issue(cmd); view.setMarker(target.x + 0.5, target.z + 0.5, simT(), true);
        battleHint = chosen === 'smoke' ? '已下煙幕指令；其他單位保持原指令。' : '已下高爆砲擊指令；其他單位保持原指令。';
      } else battleHint = chosen === 'smoke' ? '煙幕只供存活的我方榴彈砲；請先選取榴彈砲。' : '高爆砲擊需先選取存活的我方榴彈砲或迫擊砲。';
      hud?.update();
    },
    cancel: () => { battleHint = undefined; hud?.update(); },
  });
  // HUD／小地圖仍照原本操作；它們不能留下地圖上的長按計時或框。
  document.addEventListener('pointerdown', e => {
    if (e.target !== canvas && (!commandMenu?.contains(e.target) || pointers.size > 0)) clearGestureInput();
  }, true);
  addEventListener('blur', clearGestureInput);
  addEventListener('resize', clearGestureInput);
}

// R037：慣性的 80 毫秒、雙擊的 350 毫秒用這個時間量。沒有時間戳的假事件（Node 守衛用的）退回處理當下的時間，不碰 r037。
const eventT = (e: Event) => e.timeStamp > 0 && r037 ? e.timeStamp : performance.now();
canvas.addEventListener('pointerdown', e => {
  const dismissOnly = !!commandMenu?.isOpen();
  if (dismissOnly) { commandMenu?.close(); battleHint = undefined; hud?.update(); }
  canvas.setPointerCapture(e.pointerId);
  gestures?.down(e, dismissOnly);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  fling.stop(); dragV = { vx: 0, vy: 0, t: eventT(e) };   // R012：按下去慣性立刻停
  if (pointers.size === 1) dragged = false;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); dragged = true; }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (gestures?.move(e)) return;
  if (pointers.size === 1) {
    if (!dragged && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) dragged = true;
    if (dragged) {
      view.pan(dx, dy, innerHeight); glide.stop();
      // R012：拖曳速度（CSS 像素／秒），平滑一下，放手時當慣性的初速
      const now = eventT(e), dts = Math.max(1, now - dragV.t) / 1000, k = Math.min(1, dts / 0.05);
      dragV = { vx: dragV.vx + (dx / dts - dragV.vx) * k, vy: dragV.vy + (dy / dts - dragV.vy) * k, t: now };
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD > 0) { if (r012) view.zoomAt(d / pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2, innerWidth, innerHeight); else view.zoomBy(d / pinchD); }
    pinchD = d;
  }
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId), t = eventT(e);
  pointers.delete(e.pointerId);
  if (gestures?.up(e)) { dragV = { vx: 0, vy: 0, t: 0 }; return; }
  // R012：單指拖曳放手（最後一次移動在 80 毫秒內）＝帶著速度滑出去
  if (r012 && p && dragged && !pointers.size && t - dragV.t < 80) fling.start(dragV.vx, dragV.vy);
  if (!p || dragged || pointers.size) return;
  if (e.button === 2) order(e.clientX, e.clientY); else tap(e.clientX, e.clientY, e.shiftKey, t);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', e => { if (r109) clearGestureInput(); else { pointers.delete(e.pointerId); dragged = true; } });
// 正常 pointerup 後瀏覽器會自動失去 capture，不能把剛開的選單關掉。
canvas.addEventListener('lostpointercapture', e => { if (r109 && pointers.has(e.pointerId)) clearGestureInput(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; if (r012) view.zoomAt(f, e.clientX, e.clientY, innerWidth, innerHeight); else view.zoomBy(f); }, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (r109) clearGestureInput(); selected.clear(); fireMode = false; ammo = 'he'; hud?.update(); }
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat && phase === 'battle') setPaused(!paused); }   // 布陣中不能用空白鍵開打（要按「開戰」）
});

reset();

// R009 選取資訊：平均血量與正在做什麼
const ORD_NAME = ['待命', '移動', '攻擊', '砲擊'];
function selInfo(sel: typeof w.units): string {
  const hp = Math.round((100 * sel.reduce((p, u) => p + u.hp / UNIT_KINDS[u.kind].hp, 0)) / sel.length);
  const n = [0, 0, 0, 0];
  for (const u of sel) n[u.order] = (n[u.order] ?? 0) + 1;
  return `血量 ${hp}%｜${n.map((k, i) => (k ? `${ORD_NAME[i]} ${k}` : '')).filter(Boolean).join('、')}`;
}

// ---- HUD ----
hud = initHud({
  state: () => {
    const mine = w.units.filter(u => u.side === SIDE_PLAYER && u.alive), theirs = w.units.filter(u => u.side === SIDE_ENEMY && u.alive && view.visibleUnit(u));
    const sel = [...selected].map(id => w.units[id - 1]).filter(u => u.alive);
    return {
      tick: w.tick, paused, speed, fireMode, ammo, howitzers: sel.filter(u => u.kind === UK_HOWITZER).length, winner: w.winner, report: r010,
      build: phase === 'build', hint: phase === 'build' ? buildHint || BUILD_TIP : battleHint,
      mine: mine.length, theirs: theirs.length, ai: r018 && w.ai?.length ? AI_NAME[aiLevel] : undefined,
      observers: sel.filter(u => u.kind === UK_OBSERVER).length, tanks: sel.filter(u => UNIT_KINDS[u.kind].armored).length, infantry: sel.filter(u => u.kind === UK_INFANTRY).length, guns: sel.filter(u => u.kind === UK_HOWITZER || u.kind === UK_ATGUN || u.kind === UK_MORTAR).length,
      info: r009 && sel.length ? selInfo(sel) : undefined,
      rangeInfo: phase === 'battle' ? view.rangeInfo : undefined,
      coverEnabled: phase === 'battle' && q.get('noR124') !== '1',
      coverInfo: coverDurability(w, selected, phase === 'battle' && q.get('noR124') !== '1'),
      reloadInfo: reloadStatus(w, selected, phase === 'battle' && q.get('noR123') !== '1'),
      counterbatteryInfo: counterbatteryHint(w, phase === 'battle' && r015 && r115),
      vegetationInfo: view.vegetationInfo,
      audio: battleAudio?.status(),
    };
  },
  togglePause: () => { if (phase === 'battle') setPaused(!paused); },
  toggleAudio: battleAudio ? () => { syncBattleAudio(); battleAudio.toggleFromGesture(); } : undefined,
  cycleSpeed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; },
  toggleFire: () => { fireMode = !fireMode; },
  toggleAmmo: () => { ammo = ammo === 'he' ? 'smoke' : 'he'; if (ammo === 'smoke') fireMode = true; },
  selectAll: () => { selected.clear(); for (const u of w.units) if (u.side === SIDE_PLAYER && u.alive) selected.add(u.id); },
  restart: () => w.sandbox ? sandboxAction({ t: 'sandboxReset' }) : reset(),
  help: () => help.open(),
});
reportView = initReportView({ again: () => reset() });
prodBar = initProduction([{ kind: UK_TANK, label: '坦克', cost: UNIT_KINDS[UK_TANK].cost }, { kind: UK_HOWITZER, label: '榴彈砲', cost: UNIT_KINDS[UK_HOWITZER].cost }, { kind: UK_OBSERVER, label: '觀測員', cost: UNIT_KINDS[UK_OBSERVER].cost }, ...(r021 ? [{ kind: UK_INFANTRY, label: '步兵', cost: UNIT_KINDS[UK_INFANTRY].cost }] : []),
  ...(r022 ? [{ kind: UK_ATGUN, label: '反戰車砲', cost: UNIT_KINDS[UK_ATGUN].cost }, { kind: UK_MORTAR, label: '迫擊砲', cost: UNIT_KINDS[UK_MORTAR].cost }] : []),
  ...(r023 ? [{ kind: UK_LIGHT, label: '輕坦克', cost: UNIT_KINDS[UK_LIGHT].cost }, { kind: UK_HEAVY, label: '重坦克', cost: UNIT_KINDS[UK_HEAVY].cost }] : []),
  ...(r044 ? [{ kind: UK_ARMORED_CAR, label: '裝甲車', cost: UNIT_KINDS[UK_ARMORED_CAR].cost }, { kind: UK_DESTROYER, label: '驅逐戰車', cost: UNIT_KINDS[UK_DESTROYER].cost }, { kind: UK_ASSAULT, label: '突擊砲', cost: UNIT_KINDS[UK_ASSAULT].cost }] : [])], {
  state: () => {
    const e = w.eco, q0 = e?.queue[SIDE_PLAYER] ?? [];
    return { hq: phase === 'battle' ? hqDurability(w, q.get('noR127') !== '1') : '', context: w, visible: !!e && phase === 'battle' && w.winner < 0, supply: e?.supply[SIDE_PLAYER] ?? 0, queue: q0, prog: e?.prog[SIDE_PLAYER] ?? 0, progMax: q0.length ? UNIT_KINDS[q0[0]].buildTicks : 0, queueMax: 5, countdown: phase === 'battle' ? productionCountdown(w, q.get('noR125') !== '1') : '' };
  },
  produce: kind => issue({ t: 'produce', side: SIDE_PLAYER, kind }),
  hq: q.get('noR127') !== '1',
  countdown: q.get('noR125') !== '1',
  blockReason: q.get('noR126') !== '1' ? kind => productionBlockReason(w, kind, phase === 'battle') : undefined,
});
// R013 說明面板：開著的時候暫停，關掉回到原來的暫停狀態
let pausedBeforeHelp = false;
// R015 小地圖：點哪裡鏡頭滑過去（有 R012 就平滑）
if (r015) minimap = initMinimap({
  counterbattery: r115,
  vegetation: q.get('noR116') !== '1',
  trenches: r118,
  world: () => view.world,
  visible: u => view.visibleUnit(u),
  view: () => { const out: [number, number][] = []; for (const [cx, cy] of [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]) { const p = view.groundAt(cx, cy, innerWidth, innerHeight); if (p) out.push([p.x, p.z]); } return out; },
  tap: (x, z) => { fling.stop(); if (r012) glide.start(view.target.x, view.target.z, x, z, performance.now() / 1000); else { view.target.x = x; view.target.z = z; } },
});
const help = initHelp({ open: () => { if (r109) clearGestureInput(); audioHelpActive = true; pausedBeforeHelp = paused; paused = true; syncBattleAudio(); hud?.update(); }, close: () => { audioHelpActive = false; paused = pausedBeforeHelp; syncBattleAudio(); hud?.update(); } }, r109);
buildBar = initBuildBar([...(r121 ? [WIRE_KIND] : []), ...BUILD_KINDS_NOW].map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost, ...(k.kind === BK_WIRE ? { detail: `建材 ${k.cost} · 耐久 ${bldMaxHp(k.kind, k.w, k.d, k.floors)} · 徒步繞行／車輛通過 · 不擋射線、不提供掩護 · 榴彈砲可清除` } : r105 ? { detail: materialBuildDetail(k.kind, k.w, k.d, k.floors) } : {}) })), {
  state: () => {
    const kd = buildKind(pickKind)!;
    return { visible: phase === 'build', kind: pickKind, trench: pickTrench >= 0 ? pickTrench : undefined, rot: pickTrench >= 0 ? trenchRot : pickRot, rotatable: pickTrench >= 0 || kd.w !== kd.d, left: pointsLeft(), total: BUILD_POINTS, planned: plan.length };
  },
  pick: kind => { pickTrench = -1; pickKind = kind; buildHint = `${BUILD_LABEL[kind]}（建材 ${buildKind(kind)!.cost}）：點藍色地面放下`; hud?.update(); },
  pickTrench: kind => { pickTrench = kind; trenchRot = 0; buildHint = `${TRENCH_LABEL[kind]}（建材 ${trenchKind(kind)!.cost}）：點藍色地面放下；再點任一壕格整段移除`; hud?.update(); },
  rotate: () => { if (pickTrench >= 0) trenchRot = (trenchRot + 1) % 4; else pickRot = 1 - pickRot; hud?.update(); },
  undo: () => { if (plan.pop()) { buildHint = '拿掉了最後一項'; refreshPreview(); hud?.update(); } },
  start: () => startBattle(),
}, r118 ? TRENCH_KINDS.map(k => ({ kind: k.kind, label: TRENCH_LABEL[k.kind], cost: k.cost, detail: `${TRENCH_SHAPE[k.kind]} · 建材 ${k.cost} · 承傷 ${k.cover}%` })) : [],
r120 ? WALL_KINDS.map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost, detail: `建材 ${k.cost} · 耐久 ${bldMaxHp(k.kind, k.w, k.d, k.floors)} · 可破壞建築 · 不可射越 · 可駐守` })) : []);

// R117：背景／離頁即清尾音；BFCache只暫停，真正離開才關閉context。
if (battleAudio) {
  document.addEventListener('visibilitychange', syncBattleAudio);
  addEventListener('pagehide', e => { audioPageActive = false; syncBattleAudio(); if (!e.persisted) battleAudio.dispose(); });
  addEventListener('pageshow', () => { audioPageActive = true; syncBattleAudio(); });
}

if (r128) sandboxBar = initSandbox({
  state: () => ({ active: !!w.sandbox, running: !!w.sandbox?.running, count: w.units.length, tool: sandboxTool, side: sandboxSide, hint: sandboxHint }),
  enter: () => { sandboxTool = UK_TANK; sandboxSide = SIDE_PLAYER; speed = 1; reset(seed, false, false, false, false, false, true); },
  exit: () => { sandboxTool = null; sandboxSide = SIDE_PLAYER; speed = 1; paused = false; reset(); },
  run: () => setPaused(!paused), reset: () => sandboxAction({ t: 'sandboxReset' }),
  pick: kind => { clearGestureInput(); sandboxTool = kind; sandboxHint = ''; selected.clear(); fireMode = false; ammo = 'he'; ui(); },
  side: side => { sandboxSide = side; sandboxHint = ''; },
});
if (r043) mapPick = initMapPick({
  state: () => ({ show: phase === 'build' && !w.sandbox, large, rye: r026 }),
  toggle: () => { large = !large; reset(); },
});

// ---- 迴圈 ----
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.25, (t - lastT) / 1000);
  lastT = t;
  // R010：勝負一出現，2.5 秒慢動作（0.25 倍）、鏡頭 1 秒內移到最後一擊並拉近；之後出戰報
  if (r010 && w.winner >= 0 && endT0 < 0) { endT0 = t; endFrom = { x: view.target.x, z: view.target.z, zoom: view.zoom }; }
  const since = endT0 < 0 ? -1 : t - endT0;
  if (!paused && phase === 'battle') acc += dt * speed * slowmoFactor(since);
  if (endFrom && stats.lastKill && since >= 0 && since <= 1200) {
    const k = Math.min(1, since / 1000), e = k * k * (3 - 2 * k);
    view.target.x = endFrom.x + (stats.lastKill.x / SUB - endFrom.x) * e;
    view.target.z = endFrom.z + (stats.lastKill.z / SUB - endFrom.z) * e;
    view.zoom = endFrom.zoom + (Math.max(endFrom.zoom, 1.6) - endFrom.zoom) * e;
  }
  if (r010 && !reportShown && since >= SLOWMO_MS) { if (r109) clearGestureInput(); reportShown = true; reportView?.show(makeReport(w, stats)); hud?.update(); }
  syncBattleAudio();
  let steps = 0;
  // 只在即時迴圈收新事件；所有同步stepN／playLog／SCRIPT都不會走這裡。
  while (acc >= 1 / TICK_HZ && steps < 8) { acc -= 1 / TICK_HZ; tick(); battleAudio?.enqueue(w, w.events, view); steps++; }
  battleAudio?.flush();
  if (steps === 8) acc = 0;   // 機器太慢：丟掉積欠的時間，不追
  const alpha = Math.min(1, acc * TICK_HZ);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, true);
  if (fling.active) {   // R012 慣性：碰到地圖邊就停
    fling.step(dt, camStep);
    const bx = view.target.x, bz = view.target.z;
    view.pan(camStep.x, camStep.z, innerHeight);
    if ((view.target.x === bx && view.target.z === bz) || view.target.x <= 0 || view.target.z <= 0 || view.target.x >= view.world.n || view.target.z >= view.world.n) fling.stop();
  }
  if (glide.active) { glide.at(t / 1000, camStep); view.target.x = camStep.x; view.target.z = camStep.z; }
  view.update(alpha, simT(alpha), selected, phase === 'battle');
  // R113：校準／視線／選取在同一秒也會變，提示不等下一個整秒。
  const rangeInfo = view.rangeInfo;
  if (rangeInfo !== lastRangeInfo) { lastRangeInfo = rangeInfo; hud?.update(); }
  const coverInfo = coverDurability(w, selected, phase === 'battle' && q.get('noR124') !== '1');
  if (coverInfo !== lastCoverInfo) { lastCoverInfo = coverInfo; hud?.update(); }
  const reloadInfo = reloadStatus(w, selected, phase === 'battle' && q.get('noR123') !== '1');
  if (reloadInfo !== lastReloadInfo) { lastReloadInfo = reloadInfo; hud?.update(); }
  const vegetationInfo = view.vegetationInfo;
  if (vegetationInfo !== lastVegetationInfo) { lastVegetationInfo = vegetationInfo; hud?.update(); }
  // 暫停／重播也檢查當前世界；同 tick 換世界不能沿用上一局的提示。
  const counterbatteryInfo = counterbatteryHint(w, phase === 'battle' && r015 && r115);
  if (w !== lastCounterbatteryWorld || counterbatteryInfo !== lastCounterbatteryInfo) {
    lastCounterbatteryWorld = w; lastCounterbatteryInfo = counterbatteryInfo; hud?.update();
  }
  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  hud?.frame();
  prodBar?.update();
  minimap?.frame(t);
});

// R040：初始化做完才拿掉載入畫面，跟下面設好 __rts（守衛等的「準備好了」）在同一個同步步驟裡：準備好的那一刻畫面上已經沒有它。
// 放在守衛掛勾之前：幾支守衛會把守衛掛勾那個物件以後的原文抽到沒有 DOM 的沙箱裡跑。
document.getElementById('loader')?.remove();

// ---- 守衛掛勾（tools/smoke.mjs 用）----
const rts = {
  ready: true,
  seed: () => w.seed,
  tick: () => w.tick,
  hash: () => hashWorld(w),
  pause: (p: boolean) => setPaused(p),
  stepN: (n: number) => {
    battleAudio?.silence();
    try { for (let i = 0; i < n; i++) tick(); return w.tick; }
    finally { battleAudio?.silence(); }
  },
  issue: (cmd: Command) => issue(cmd),
  log: () => JSON.parse(JSON.stringify(log)) as LoggedCommand[],
  selected: () => [...selected],
  // 用跟 Node 一樣的路徑重跑腳本戰鬥，回傳雜湊；畫面換成腳本跑完的世界
  runScript: (ticks = SCRIPT_TICKS) => {
    reset(SCRIPT_SEED, false, false, false, false, false);
    runLog(w, SCRIPT, ticks);
    view.dispose();
    view = new BattleView(w, fxOn, q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009, r011, r014, r016, r107, q.get('noR113') !== '1', r118, r104, q.get('noR123') !== '1');
  view.multiRangeEnabled = q.get('noR122') !== '1';
    return hashWorld(w);
  },
  screenOf: (id: number) => { const u = w.units[id - 1]; return view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, innerWidth, innerHeight); },
  screenOfCell: (x: number, z: number) => view.screenOf(x + 0.5, 0, z + 0.5, innerWidth, innerHeight),
  screenOfPoint: (x: number, y: number, z: number) => view.screenOf(x, y, z, innerWidth, innerHeight),
  blds: () => w.blds.map(b => ({ ...b })),
  focus: (x: number, z: number, zoom = 1) => { view.target.set(x, 0, z); view.zoom = zoom; },
  info: () => ({ ...view.pipe.sceneInfo, rt: view.pipe.size, townTris: view.townTriangles, fx: fxOn, px: style.pixelCss, r004: fxOn && r004, pools: view.pools }),
  armorArcs: () => view.armorArcCount,
  fxDigest: () => view.fxDigest(),
  bars: () => view.bars,
  dashes: () => view.dashes,
  multiRange: () => ({ ...view.multi122.solution, shown: view.multi122.mesh.visible, triangles: view.multi122.mesh.visible ? 2 : 0 }),
  rangePreview: () => view.range113 ? { ...view.range113.solution, triangles: view.range113.mesh.geometry.drawRange.count / 3, shown: view.range113.mesh.visible } : null,
  holes: () => ({ count: view.holeCount, instances: view.holeInstances }),
  eco: () => (w.eco ? { supply: [...w.eco.supply], queue: w.eco.queue.map(q => [...q]), hq: [...w.eco.hq], guns: w.eco.guns ?? 0, tanks: w.eco.tanks ?? 0, armor2: w.eco.armor2 ?? 0 } : null),
  men: () => ({ alive: view.menDbg.alive, bodies: view.bodies.n }),
  map: () => w.map ?? 0,
  mapSize: () => w.n,   // R043：地圖邊長（萊伊 32、鄉間大地圖 64）
  vegetation: () => ({ version: w.vegetation?.version ?? 0, cells: w.vegetation ? [...w.vegetation.cells] : [],
    shown: !!view.vegetation116.mesh, count: view.vegetation116.cells, triangles: view.vegetation116.triangles, builds: view.vegetation116.builds }),
  units: () => w.units.map(u => ({ id: u.id, side: u.side, kind: u.kind, x: u.x, z: u.z, alive: u.alive })),
  minimap: () => (minimap ? { shown: true, rect: (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(minimap.el.getBoundingClientRect()) } : { shown: false }),
  miniPoint: (x: number, z: number) => minimap?.point(x, z) ?? null,
  rising: () => ({ rising: view.risingCount, ghosts: view.ghostCount, banner: !!document.getElementById('start-banner'), order: !!document.getElementById('start-order') }),
  cam: () => ({ x: view.target.x, z: view.target.z, zoom: view.zoom }),
  groundAt: (cx: number, cy: number) => { const p = view.groundAt(cx, cy, innerWidth, innerHeight); return p ? [p.x, p.z] : null; },
  select: (ids: number[]) => { selected.clear(); for (const id of ids) if (w.units[id - 1]?.alive && w.units[id - 1].side === SIDE_PLAYER) selected.add(id); hud?.update(); return [...selected]; },
  // 從第 0 步照腳本一步一步跑（指令照時間發、每一步都餵畫面）：車轍、揚塵這些「看著發生」的畫面才會出現。雜湊等於 runScript
  // 任意指令紀錄，從第 0 步一步一步跑（每一步都餵畫面與戰報統計）；回傳雜湊
  playLog: (s: number, lg: LoggedCommand[], ticks: number, sandbox = false) => {
    reset(s, false, false, false, false, false, sandbox);
    let i = 0;
    if (sandbox) {
      while (commandTick(w) < ticks) {
        while (i < lg.length && lg[i].tick <= commandTick(w)) { if (lg[i].tick === commandTick(w)) issue(lg[i].cmd); i++; }
        tick();
      }
    } else {
      while (w.tick < ticks) {
        while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick) issue(lg[i].cmd); i++; }
        tick();
      }
    }
    if (w.sandbox) { paused = !w.sandbox.running; ui(); }
    return hashWorld(w);
  },
  winner: () => w.winner,
  paused: () => paused,
  report: () => ({ shown: !!reportView?.visible(), data: makeReport(w, stats) }),
  playScript: (ticks = SCRIPT_TICKS) => {
    reset(SCRIPT_SEED, false, false, false, false, false);
    let i = 0;
    while (w.tick < ticks) {
      while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) issue(SCRIPT[i].cmd); i++; }
      tick();
    }
    return hashWorld(w);
  },
  cellOf: (p: number) => cellOf(p),
  phase: () => phase,
  plan: () => JSON.parse(JSON.stringify(plan)) as PlanCmd[],
  startBattle: () => startBattle(),
  sandbox: () => w.sandbox ? { ...w.sandbox, count: w.units.length } : null,
};
(window as unknown as { __rts: typeof rts }).__rts = rts;
