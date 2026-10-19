// 進入點：固定步長迴圈（模擬 20 步／秒，畫面每幀插值）、觸控與滑鼠輸入、HUD、守衛掛勾 window.__rts。
import * as THREE from 'three';
import { createWorld, hashWorld, N, SUB, TICK_HZ, SHELL_HE, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UNIT_KINDS, BK_COTTAGE, cellOf, type World } from './sim/world.ts';
import { BUILD_KINDS, BUILD_KINDS_24, BUILD_POINTS, applyBuild, buildError, buildKind, enemyPlan, type BuildCmd } from './sim/build.ts';
import { step, runLog, type Command, type LoggedCommand } from './sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from './sim/script.ts';
import { BattleView } from './render/battle.ts';
import { STYLE_A, type Style } from './render/post.ts';
import { initHud, type Hud } from './ui/hud.ts';
import { routeBattleOrder, type AmmoMode } from './ui/smoke.ts';
import { Gestures, inSelectionRect, type SelectionRect } from './ui/gestures.ts';
import { initCommandMenu, bombardCommand, bombardTarget, type CommandMenu } from './ui/commandMenu.ts';
import { initBuildBar, type BuildBar } from './ui/build.ts';
import { Fling, Glide } from './ui/camera.ts';
import { applyMap, MAP_RYE } from './sim/maps.ts';
import { materialBuildDetail } from './ui/materials.ts';
import { setFacades, setMaterials } from './render/buildings.ts';
import { setStreets } from './render/battle.ts';
import { initProduction, type ProdBar } from './ui/production.ts';
import { initHelp } from './ui/help.ts';
import { initMinimap, type Minimap } from './ui/minimap.ts';
import { newStats, statsStep, makeReport, slowmoFactor, SLOWMO_MS, type BattleStats } from './ui/report.ts';
import { initReportView, type ReportView } from './ui/reportView.ts';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? SCRIPT_SEED) >>> 0;
const style: Style = { ...STYLE_A, pixelCss: Math.max(1, Math.min(4, Number(q.get('px') ?? STYLE_A.pixelCss) | 0)) };
// 逃生閥：?fx=off 或 window.__noFx＝true 時不產生爆炸、煙（AGENTS.md：新效果都要關得掉）
const fxOn = q.get('fx') !== 'off' && !(window as unknown as { __noFx?: boolean }).__noFx;
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
const fling = new Fling(), glide = new Glide(), camStep = { x: 0, z: 0 };
let dragV = { vx: 0, vy: 0, t: 0 }, lastTap = { id: 0, t: -1e9 };
let stats: BattleStats, endT0 = -1, endFrom: { x: number; z: number; zoom: number } | null = null, reportShown = false, reportView: ReportView | undefined;
// R011 指令回饋：選取單位的路線、攻擊線、砲擊準星。逃生閥 ?noR011=1
const r011 = q.get('noR011') !== '1';
// R014 牆上的彈孔與燻黑。逃生閥 ?noR014=1
const r014 = q.get('noR014') !== '1';
// R015 小地圖。逃生閥 ?noR015=1
const r015 = q.get('noR015') !== '1';
let minimap: Minimap | undefined;
// R016 開戰儀式：布陣的房子從地面升起、「開戰！」大字。逃生閥 ?noR016=1
const r016 = q.get('noR016') !== '1';
const r109 = q.get('noR109') !== '1';
let commandMenu: CommandMenu | undefined;
let battleHint: string | undefined;
const r107 = q.get('noR107') !== '1'; // 只關煙團畫面；煙幕指令與視線模擬保持啟用
const r105 = q.get('noR105') !== '1';
setMaterials(r105); // R105 材質視覺提示；只關畫面，模擬不變
setFacades(q.get('noR028') !== '1');
setStreets(q.get('noR027') !== '1');   // R027 人行道與燈火管制路緣；逃生閥 ?noR027=1   // R028 外牆細節（木構、掛瓦、護牆板）；逃生閥 ?noR028=1＝全部紅磚原樣
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
let plan: BuildCmd[] = [], pickKind = BK_COTTAGE, pickRot = 0, buildHint = '';
const BUILD_LABEL: Record<number, string> = { [BUILD_KINDS[0].kind]: '農舍', [BUILD_KINDS[1].kind]: '磚房', [BUILD_KINDS[2].kind]: '穀倉', [BUILD_KINDS_24[3].kind]: '碉堡' };
const BUILD_WHY: Record<string, string> = {
  tick: '已經開戰，不能再蓋', map: '超出地圖', foreign: '那是敵方半場（紅色）；只能蓋在我方半場（藍色）',
  neutral: '那是中間的無人帶；只能蓋在我方半場（藍色）', mud: '不能蓋在泥灘上', road: '不能蓋在路上', occupied: '那裡已經有房子',
  unit: '有單位站在那裡', blocked: '會堵死通路', gap: '太靠近別的房子（要隔一格）',
};
const BUILD_TIP = '布陣：點藍色地面蓋房子當掩體、擋視線；點蓋好的房子拿掉；蓋好按「開戰」';

// 預覽＝真的世界的複本套上這次的布陣（同一支 applyBuild，規則只有一份）
function previewWorld(): World {
  const pv = structuredClone(w);
  for (const c of plan) applyBuild(pv, c);
  pv.events = [];
  return pv;
}
function refreshPreview() { if (phase === 'build') view.setWorld(previewWorld(), SIDE_PLAYER); }
const pointsLeft = () => BUILD_POINTS - plan.reduce((p, c) => p + (buildKind(c.kind)?.cost ?? 0), 0);

// R018 電腦對手：開戰時送 ai 指令（記在指令紀錄裡，重播自動一致）。?ai=1|2|3 選難度；逃生閥 ?noR018=1＝敵人原地還擊
const r018 = q.get('noR018') !== '1';
// R019 生產與補給：開戰時送 eco（雙方指揮部、補給、打掉指揮部才贏）。逃生閥 ?noR019=1
const r019 = q.get('noR019') !== '1';
// R021 步兵班：eco 帶 inf＝1（雙方各一班、可出步兵）。逃生閥 ?noR021=1
const r021 = q.get('noR021') !== '1';
const r022 = q.get('noR022') !== '1';   // R022 反戰車砲、迫擊砲（關掉＝eco 不帶 guns：生產列沒有、電腦不出）
const r026 = q.get('noR026') !== '1';   // R026 Rye 1940 手排地圖（關掉＝亂數村莊）
const r024 = q.get('noR024') !== '1';   // R024 碉堡（關掉＝布陣列沒有碉堡、敵方布陣也不蓋）
const BUILD_KINDS_NOW = r024 ? BUILD_KINDS_24 : BUILD_KINDS;
const r023 = q.get('noR023') !== '1';   // R023 輕坦克、重坦克（關掉＝eco 不帶 tanks：生產列沒有、電腦不出）
const ecoCmd = (): Command => ({ t: 'eco', ...(r021 ? { inf: 1 } : {}), ...(r022 ? { guns: 1 } : {}), ...(r023 ? { tanks: 1 } : {}) });
let prodBar: ProdBar | undefined;
const aiLevel = Math.max(1, Math.min(3, Number(q.get('ai') ?? 2) | 0 || 2));
const AI_NAME = ['', '簡單', '普通', '困難'];

function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026) {
  if (r109) clearGestureInput();
  w = createWorld(s);
  if (map) applyMap(w, MAP_RYE);   // R026：布陣預覽就要看到 Rye；同一條 map 指令記在紀錄第 0 步，重播時由 step 套（套過的不再套）
  view?.dispose();
  view = new BattleView(w, fxOn, q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009, r011, r014, r016, r107);
  log = []; pending = []; acc = 0; selected.clear(); fireMode = false; ammo = 'he';
  stats = newStats(w); endT0 = -1; endFrom = null; reportShown = false; reportView?.hide();
  plan = []; buildHint = ''; phase = build ? 'build' : 'battle';
  if (map) issue({ t: 'map', id: MAP_RYE });
  if (build) { paused = true; refreshPreview(); }
  else {   // 沒有布陣：開頁就開打，第 0 步放指揮部、電腦接手
    if (eco) issue(ecoCmd());
    if (ai) issue({ t: 'ai', side: SIDE_ENEMY, level: aiLevel });
  }
  ui();
}
function ui() { hud?.update(); buildBar?.update(); prodBar?.update(); }

// 開戰：我方布陣＋敵方布陣都寫進指令紀錄（第 0 步），馬上走第一步讓房子落地（中間不畫任何一幀，不會閃）
function startBattle() {
  if (phase !== 'build') return;
  const pv = previewWorld(), enemy = enemyPlan(pv, BUILD_KINDS_NOW);
  for (const c of plan) issue(c);
  for (const c of enemy) issue(c);
  if (r019) issue(ecoCmd());
  if (r018) issue({ t: 'ai', side: SIDE_ENEMY, level: aiLevel });
  phase = 'battle'; plan = []; buildHint = '';
  if (r016) startBanner();
  view.setWorld(w, -1);
  tick();
  paused = false;
  ui();
}

function placeAt(cx: number, cy: number) {
  // 點到已經放好的房子＝拿掉它（只認這次布陣的，地圖上原本的房子不算）
  const hitB = view.buildingAt(cx, cy, innerWidth, innerHeight);
  if (hitB) {
    const k = plan.findIndex(c => { const kd = buildKind(c.kind)!, fw = c.rot ? kd.d : kd.w, fd = c.rot ? kd.w : kd.d; return hitB[0] >= c.x && hitB[1] >= c.z && hitB[0] < c.x + fw && hitB[1] < c.z + fd; });
    if (k >= 0) { plan.splice(k, 1); buildHint = '拿掉了一棟'; refreshPreview(); ui(); return; }
  }
  const p = view.groundAt(cx, cy, innerWidth, innerHeight);
  if (!p) return;
  const gx = Math.floor(p.x), gz = Math.floor(p.z);
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return;
  const kd = buildKind(pickKind)!, rot = kd.w !== kd.d ? pickRot : 0;
  const cmd: BuildCmd = { t: 'build', side: SIDE_PLAYER, kind: pickKind, x: gx, z: gz, ...(rot ? { rot } : {}) };
  const err = buildError(previewWorld(), cmd);
  if (err) {
    buildHint = err === 'points' ? `建材不夠（剩 ${pointsLeft()}，${BUILD_LABEL[pickKind]}要 ${kd.cost}）` : BUILD_WHY[err] ?? '這裡不能蓋';
    view.setMarker(gx + 0.5, gz + 0.5, simT(), true);
  } else {
    plan.push(cmd); buildHint = `${BUILD_LABEL[pickKind]}蓋好了，剩建材 ${pointsLeft()}`;
    view.setMarker(gx + 0.5, gz + 0.5, simT(), false);
    refreshPreview();
  }
  ui();
}

function issue(cmd: Command) {
  log.push({ tick: w.tick, cmd });
  pending.push(cmd);
}

const simT = (alpha = 0) => (w.tick + alpha) / TICK_HZ;

function tick() {
  view.snapshot();
  const now = pending; pending = [];
  const priorWinner = w.winner;
  step(w, now);
  if (r109 && priorWinner < 0 && w.winner >= 0) clearGestureInput();
  view.onEvents(w.events, simT());
  if (minimap && w.events.some(e => e.e === 'stage' || e.e === 'build' || (e.e === 'impact' && e.kind === SHELL_HE))) minimap.dirty();   // R015 地形變了才重畫底圖
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

function tap(cx: number, cy: number, additive: boolean) {
  if (r109) clearBattleHint();
  const hit = pickUnit(cx, cy), u = hit ? w.units[hit - 1] : null;
  if (u && u.side === SIDE_PLAYER) {
    const now = performance.now();
    if (r012 && lastTap.id === u.id && now - lastTap.t < 350) glide.start(view.target.x, view.target.z, u.x / SUB, u.z / SUB, now / 1000);   // 雙擊：鏡頭跟過去
    lastTap = { id: u.id, t: now };
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
  enabled: () => phase === 'battle' && w.winner < 0 && !help.visible() && !reportView?.visible(),
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

canvas.addEventListener('pointerdown', e => {
  const dismissOnly = !!commandMenu?.isOpen();
  if (dismissOnly) { commandMenu?.close(); battleHint = undefined; hud?.update(); }
  canvas.setPointerCapture(e.pointerId);
  gestures?.down(e, dismissOnly);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  fling.stop(); dragV = { vx: 0, vy: 0, t: performance.now() };   // R012：按下去慣性立刻停
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
      const now = performance.now(), dts = Math.max(1, now - dragV.t) / 1000, k = Math.min(1, dts / 0.05);
      dragV = { vx: dragV.vx + (dx / dts - dragV.vx) * k, vy: dragV.vy + (dy / dts - dragV.vy) * k, t: now };
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD > 0) { if (r012) view.zoomAt(d / pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2, innerWidth, innerHeight); else view.zoomBy(d / pinchD); }
    pinchD = d;
  }
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (gestures?.up(e)) { dragV = { vx: 0, vy: 0, t: 0 }; return; }
  // R012：單指拖曳放手（最後一次移動在 80 毫秒內）＝帶著速度滑出去
  if (r012 && p && dragged && !pointers.size && performance.now() - dragV.t < 80) fling.start(dragV.vx, dragV.vy);
  if (!p || dragged || pointers.size) return;
  if (e.button === 2) order(e.clientX, e.clientY); else tap(e.clientX, e.clientY, e.shiftKey);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', e => { if (r109) clearGestureInput(); else { pointers.delete(e.pointerId); dragged = true; } });
// 正常 pointerup 後瀏覽器會自動失去 capture，不能把剛開的選單關掉。
canvas.addEventListener('lostpointercapture', e => { if (r109 && pointers.has(e.pointerId)) clearGestureInput(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; if (r012) view.zoomAt(f, e.clientX, e.clientY, innerWidth, innerHeight); else view.zoomBy(f); }, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (r109) clearGestureInput(); selected.clear(); fireMode = false; ammo = 'he'; hud?.update(); }
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat && phase === 'battle') { paused = !paused; hud?.update(); } }   // 布陣中不能用空白鍵開打（要按「開戰」）   // 不讓空白鍵同時按到有焦點的 HUD 按鈕
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
    };
  },
  togglePause: () => { if (phase === 'battle') paused = !paused; },
  cycleSpeed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; },
  toggleFire: () => { fireMode = !fireMode; },
  toggleAmmo: () => { ammo = ammo === 'he' ? 'smoke' : 'he'; if (ammo === 'smoke') fireMode = true; },
  selectAll: () => { selected.clear(); for (const u of w.units) if (u.side === SIDE_PLAYER && u.alive) selected.add(u.id); },
  restart: () => reset(),
  help: () => help.open(),
});
reportView = initReportView({ again: () => reset() });
prodBar = initProduction([{ kind: UK_TANK, label: '坦克', cost: UNIT_KINDS[UK_TANK].cost }, { kind: UK_HOWITZER, label: '榴彈砲', cost: UNIT_KINDS[UK_HOWITZER].cost }, { kind: UK_OBSERVER, label: '觀測員', cost: UNIT_KINDS[UK_OBSERVER].cost }, ...(r021 ? [{ kind: UK_INFANTRY, label: '步兵', cost: UNIT_KINDS[UK_INFANTRY].cost }] : []),
  ...(r022 ? [{ kind: UK_ATGUN, label: '反戰車砲', cost: UNIT_KINDS[UK_ATGUN].cost }, { kind: UK_MORTAR, label: '迫擊砲', cost: UNIT_KINDS[UK_MORTAR].cost }] : []),
  ...(r023 ? [{ kind: UK_LIGHT, label: '輕坦克', cost: UNIT_KINDS[UK_LIGHT].cost }, { kind: UK_HEAVY, label: '重坦克', cost: UNIT_KINDS[UK_HEAVY].cost }] : [])], {
  state: () => {
    const e = w.eco, q0 = e?.queue[SIDE_PLAYER] ?? [];
    return { visible: !!e && phase === 'battle' && w.winner < 0, supply: e?.supply[SIDE_PLAYER] ?? 0, queue: q0, prog: e?.prog[SIDE_PLAYER] ?? 0, progMax: q0.length ? UNIT_KINDS[q0[0]].buildTicks : 0, queueMax: 5 };
  },
  produce: kind => issue({ t: 'produce', side: SIDE_PLAYER, kind }),
});
// R013 說明面板：開著的時候暫停，關掉回到原來的暫停狀態
let pausedBeforeHelp = false;
// R015 小地圖：點哪裡鏡頭滑過去（有 R012 就平滑）
if (r015) minimap = initMinimap({
  world: () => w,
  visible: u => view.visibleUnit(u),
  view: () => { const out: [number, number][] = []; for (const [cx, cy] of [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]]) { const p = view.groundAt(cx, cy, innerWidth, innerHeight); if (p) out.push([p.x, p.z]); } return out; },
  tap: (x, z) => { fling.stop(); if (r012) glide.start(view.target.x, view.target.z, x, z, performance.now() / 1000); else { view.target.x = x; view.target.z = z; } },
});
const help = initHelp({ open: () => { if (r109) clearGestureInput(); pausedBeforeHelp = paused; paused = true; hud?.update(); }, close: () => { paused = pausedBeforeHelp; hud?.update(); } }, r109);
buildBar = initBuildBar(BUILD_KINDS_NOW.map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost, ...(r105 ? { detail: materialBuildDetail(k.kind, k.w, k.d, k.floors) } : {}) })), {
  state: () => {
    const kd = buildKind(pickKind)!;
    return { visible: phase === 'build', kind: pickKind, rot: pickRot, rotatable: kd.w !== kd.d, left: pointsLeft(), total: BUILD_POINTS, planned: plan.length };
  },
  pick: kind => { pickKind = kind; buildHint = `${BUILD_LABEL[kind]}（建材 ${buildKind(kind)!.cost}）：點藍色地面放下`; hud?.update(); },
  rotate: () => { pickRot = 1 - pickRot; hud?.update(); },
  undo: () => { if (plan.pop()) { buildHint = '拿掉了最後一棟'; refreshPreview(); hud?.update(); } },
  start: () => startBattle(),
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
  let steps = 0;
  while (acc >= 1 / TICK_HZ && steps < 8) { acc -= 1 / TICK_HZ; tick(); steps++; }
  if (steps === 8) acc = 0;   // 機器太慢：丟掉積欠的時間，不追
  const alpha = Math.min(1, acc * TICK_HZ);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, true);
  if (fling.active) {   // R012 慣性：碰到地圖邊就停
    fling.step(dt, camStep);
    const bx = view.target.x, bz = view.target.z;
    view.pan(camStep.x, camStep.z, innerHeight);
    if ((view.target.x === bx && view.target.z === bz) || view.target.x <= 0 || view.target.z <= 0 || view.target.x >= N || view.target.z >= N) fling.stop();
  }
  if (glide.active) { glide.at(t / 1000, camStep); view.target.x = camStep.x; view.target.z = camStep.z; }
  view.update(alpha, simT(alpha), selected);
  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  hud?.frame();
  prodBar?.update();
  minimap?.frame(t);
});

// ---- 守衛掛勾（tools/smoke.mjs 用）----
const rts = {
  ready: true,
  seed: () => w.seed,
  tick: () => w.tick,
  hash: () => hashWorld(w),
  pause: (p: boolean) => { paused = p; hud?.update(); },
  stepN: (n: number) => { for (let i = 0; i < n; i++) tick(); return w.tick; },
  issue: (cmd: Command) => issue(cmd),
  log: () => JSON.parse(JSON.stringify(log)) as LoggedCommand[],
  selected: () => [...selected],
  // 用跟 Node 一樣的路徑重跑腳本戰鬥，回傳雜湊；畫面換成腳本跑完的世界
  runScript: (ticks = SCRIPT_TICKS) => {
    reset(SCRIPT_SEED, false, false, false, false);
    runLog(w, SCRIPT, ticks);
    view.dispose();
    view = new BattleView(w, fxOn, q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009, r011, r014, r016, r107);
    return hashWorld(w);
  },
  screenOf: (id: number) => { const u = w.units[id - 1]; return view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, innerWidth, innerHeight); },
  screenOfCell: (x: number, z: number) => view.screenOf(x + 0.5, 0, z + 0.5, innerWidth, innerHeight),
  screenOfPoint: (x: number, y: number, z: number) => view.screenOf(x, y, z, innerWidth, innerHeight),
  blds: () => w.blds.map(b => ({ ...b })),
  focus: (x: number, z: number, zoom = 1) => { view.target.set(x, 0, z); view.zoom = zoom; },
  info: () => ({ ...view.pipe.sceneInfo, rt: view.pipe.size, townTris: view.townTriangles, fx: fxOn, px: style.pixelCss, r004: fxOn && r004, pools: view.pools }),
  fxDigest: () => view.fxDigest(),
  bars: () => view.bars,
  dashes: () => view.dashes,
  holes: () => ({ count: view.holeCount, instances: view.holeInstances }),
  eco: () => (w.eco ? { supply: [...w.eco.supply], queue: w.eco.queue.map(q => [...q]), hq: [...w.eco.hq], guns: w.eco.guns ?? 0, tanks: w.eco.tanks ?? 0 } : null),
  men: () => ({ alive: view.menDbg.alive, bodies: view.bodies.n }),
  map: () => w.map ?? 0,
  units: () => w.units.map(u => ({ id: u.id, side: u.side, kind: u.kind, x: u.x, z: u.z, alive: u.alive })),
  minimap: () => (minimap ? { shown: true, rect: (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(minimap.el.getBoundingClientRect()) } : { shown: false }),
  miniPoint: (x: number, z: number) => minimap?.point(x, z) ?? null,
  rising: () => ({ rising: view.risingCount, ghosts: view.ghostCount, banner: !!document.getElementById('start-banner') }),
  cam: () => ({ x: view.target.x, z: view.target.z, zoom: view.zoom }),
  groundAt: (cx: number, cy: number) => { const p = view.groundAt(cx, cy, innerWidth, innerHeight); return p ? [p.x, p.z] : null; },
  select: (ids: number[]) => { selected.clear(); for (const id of ids) if (w.units[id - 1]?.alive && w.units[id - 1].side === SIDE_PLAYER) selected.add(id); hud?.update(); return [...selected]; },
  // 從第 0 步照腳本一步一步跑（指令照時間發、每一步都餵畫面）：車轍、揚塵這些「看著發生」的畫面才會出現。雜湊等於 runScript
  // 任意指令紀錄，從第 0 步一步一步跑（每一步都餵畫面與戰報統計）；回傳雜湊
  playLog: (s: number, lg: LoggedCommand[], ticks: number) => {
    reset(s, false, false, false, false);
    let i = 0;
    while (w.tick < ticks) {
      while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick) issue(lg[i].cmd); i++; }
      tick();
    }
    return hashWorld(w);
  },
  winner: () => w.winner,
  paused: () => paused,
  report: () => ({ shown: !!reportView?.visible(), data: makeReport(w, stats) }),
  playScript: (ticks = SCRIPT_TICKS) => {
    reset(SCRIPT_SEED, false, false, false, false);
    let i = 0;
    while (w.tick < ticks) {
      while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) issue(SCRIPT[i].cmd); i++; }
      tick();
    }
    return hashWorld(w);
  },
  cellOf: (p: number) => cellOf(p),
  phase: () => phase,
  plan: () => JSON.parse(JSON.stringify(plan)) as BuildCmd[],
  startBattle: () => startBattle(),
};
(window as unknown as { __rts: typeof rts }).__rts = rts;
