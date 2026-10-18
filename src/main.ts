// 進入點：固定步長迴圈（模擬 20 步／秒，畫面每幀插值）、觸控與滑鼠輸入、HUD、守衛掛勾 window.__rts。
import * as THREE from 'three';
import { createWorld, hashWorld, N, SUB, TICK_HZ, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, UK_OBSERVER, UNIT_KINDS, BK_COTTAGE, bldAt, cellOf, type World } from './sim/world.ts';
import { BUILD_KINDS, BUILD_POINTS, applyBuild, buildError, buildKind, enemyPlan, type BuildCmd } from './sim/build.ts';
import { step, runLog, type Command, type LoggedCommand } from './sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from './sim/script.ts';
import { BattleView } from './render/battle.ts';
import { STYLE_A, type Style } from './render/post.ts';
import { initHud, type Hud } from './ui/hud.ts';
import { initBuildBar, type BuildBar } from './ui/build.ts';
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
let stats: BattleStats, endT0 = -1, endFrom: { x: number; z: number; zoom: number } | null = null, reportShown = false, reportView: ReportView | undefined;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

let w: World, view: BattleView, log: LoggedCommand[], pending: Command[];
let hud: Hud | undefined, buildBar: BuildBar | undefined;
let acc = 0, paused = false, speed = 1, fireMode = false, lastT = performance.now();
const selected = new Set<number>();
const SPEEDS = [1, 2, 4];

// ---- R006 布陣：開頁先停在第 0 步，玩家在我方半場蓋房子，按「開戰」才開打。逃生閥 ?noR006=1＝直接開打（R102 的流程）----
const r006 = q.get('noR006') !== '1';
let phase: 'build' | 'battle' = 'battle';
let plan: BuildCmd[] = [], pickKind = BK_COTTAGE, pickRot = 0, buildHint = '';
const BUILD_LABEL: Record<number, string> = { [BUILD_KINDS[0].kind]: '農舍', [BUILD_KINDS[1].kind]: '磚房', [BUILD_KINDS[2].kind]: '穀倉' };
const BUILD_WHY: Record<string, string> = {
  tick: '已經開戰，不能再蓋', map: '超出地圖', foreign: '那是敵方半場（紅色）；只能蓋在我方半場（藍色）',
  neutral: '那是中間的無人帶；只能蓋在我方半場（藍色）', road: '不能蓋在路上', occupied: '那裡已經有房子',
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

function reset(s = seed, build = r006) {
  w = createWorld(s);
  view?.dispose();
  view = new BattleView(w, fxOn, q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009);
  log = []; pending = []; acc = 0; selected.clear();
  stats = newStats(w); endT0 = -1; endFrom = null; reportShown = false; reportView?.hide();
  plan = []; buildHint = ''; phase = build ? 'build' : 'battle';
  if (build) { paused = true; refreshPreview(); }
  ui();
}
function ui() { hud?.update(); buildBar?.update(); }

// 開戰：我方布陣＋敵方布陣都寫進指令紀錄（第 0 步），馬上走第一步讓房子落地（中間不畫任何一幀，不會閃）
function startBattle() {
  if (phase !== 'build') return;
  const pv = previewWorld(), enemy = enemyPlan(pv);
  for (const c of plan) issue(c);
  for (const c of enemy) issue(c);
  phase = 'battle'; plan = []; buildHint = '';
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
  step(w, now);
  view.onEvents(w.events, simT());
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

function order(cx: number, cy: number) {
  if (phase === 'build') { placeAt(cx, cy); return; }
  const ids = [...selected].filter(id => w.units[id - 1].alive);
  if (!ids.length) return;
  const hit = pickUnit(cx, cy), t = hit ? w.units[hit - 1] : null;
  if (t && t.side !== SIDE_PLAYER) {
    issue({ t: 'attack', side: SIDE_PLAYER, ids, target: t.id });
    view.setMarker(t.x / SUB, t.z / SUB, simT(), true);
    return;
  }
  // 先看點到哪棟建築（屋頂、牆面都算）；沒點到建築才看地面
  const hitB = view.buildingAt(cx, cy, innerWidth, innerHeight);
  if (hitB) {
    const observers = ids.filter(id => w.units[id - 1].kind === UK_OBSERVER);
    const armed = ids.filter(id => w.units[id - 1].kind !== UK_OBSERVER);
    if (observers.length) issue({ t: 'move', side: SIDE_PLAYER, ids: observers, x: hitB[0], z: hitB[1] });
    if (armed.length) issue({ t: 'fireAt', side: SIDE_PLAYER, ids: armed, x: hitB[0], z: hitB[1] });
    view.setMarker(hitB[0] + 0.5, hitB[1] + 0.5, simT(), true);
    return;
  }
  const p = view.groundAt(cx, cy, innerWidth, innerHeight);
  if (!p) return;
  const gx = Math.floor(p.x), gz = Math.floor(p.z);
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return;
  const b = bldAt(w, gx, gz);
  // 砲擊模式點地面：只有榴彈砲接（坦克打空地沒有用）；選取裡沒有榴彈砲就照常移動
  const guns = ids.filter(id => UNIT_KINDS[w.units[id - 1].kind].indirect);
  if ((b && b.hp > 0) || (fireMode && guns.length)) {
    issue({ t: 'fireAt', side: SIDE_PLAYER, ids: b && b.hp > 0 ? ids : guns, x: gx, z: gz });
    view.setMarker(gx + 0.5, gz + 0.5, simT(), true);
  } else {
    issue({ t: 'move', side: SIDE_PLAYER, ids, x: gx, z: gz });
    view.setMarker(gx + 0.5, gz + 0.5, simT(), false);
  }
}

function tap(cx: number, cy: number, additive: boolean) {
  const hit = pickUnit(cx, cy), u = hit ? w.units[hit - 1] : null;
  if (u && u.side === SIDE_PLAYER) {
    if (!additive) selected.clear();
    if (additive && selected.has(u.id)) selected.delete(u.id); else selected.add(u.id);
    hud?.update();
    return;
  }
  if (phase === 'build') { placeAt(cx, cy); return; }
  order(cx, cy);
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  if (pointers.size === 1) dragged = false;
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); dragged = true; }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (!dragged && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) dragged = true;
    if (dragged) view.pan(dx, dy, innerHeight);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD > 0) view.zoomBy(d / pinchD);
    pinchD = d;
  }
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (!p || dragged || pointers.size) return;
  if (e.button === 2) order(e.clientX, e.clientY); else tap(e.clientX, e.clientY, e.shiftKey);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); dragged = true; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'Escape') { selected.clear(); hud?.update(); }
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
      tick: w.tick, paused, speed, fireMode, winner: w.winner, report: r010,
      build: phase === 'build', hint: phase === 'build' ? buildHint || BUILD_TIP : undefined,
      mine: mine.length, theirs: theirs.length,
      observers: sel.filter(u => u.kind === UK_OBSERVER).length, tanks: sel.filter(u => u.kind === UK_TANK).length, guns: sel.filter(u => u.kind === UK_HOWITZER).length,
      info: r009 && sel.length ? selInfo(sel) : undefined,
    };
  },
  togglePause: () => { if (phase === 'battle') paused = !paused; },
  cycleSpeed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; },
  toggleFire: () => { fireMode = !fireMode; },
  selectAll: () => { selected.clear(); for (const u of w.units) if (u.side === SIDE_PLAYER && u.alive) selected.add(u.id); },
  restart: () => reset(),
});
reportView = initReportView({ again: () => reset() });
buildBar = initBuildBar(BUILD_KINDS.map(k => ({ kind: k.kind, label: BUILD_LABEL[k.kind], cost: k.cost })), {
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
  if (r010 && !reportShown && since >= SLOWMO_MS) { reportShown = true; reportView?.show(makeReport(w, stats)); hud?.update(); }
  let steps = 0;
  while (acc >= 1 / TICK_HZ && steps < 8) { acc -= 1 / TICK_HZ; tick(); steps++; }
  if (steps === 8) acc = 0;   // 機器太慢：丟掉積欠的時間，不追
  const alpha = Math.min(1, acc * TICK_HZ);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, true);
  view.update(alpha, simT(alpha), selected);
  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  hud?.frame();
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
    reset(SCRIPT_SEED, false);
    runLog(w, SCRIPT, ticks);
    view.dispose();
    view = new BattleView(w, fxOn, q.get('noR100') !== '1', q.get('noR101') !== '1', r004, r008, r009);
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
  select: (ids: number[]) => { selected.clear(); for (const id of ids) if (w.units[id - 1]?.alive && w.units[id - 1].side === SIDE_PLAYER) selected.add(id); hud?.update(); return [...selected]; },
  // 從第 0 步照腳本一步一步跑（指令照時間發、每一步都餵畫面）：車轍、揚塵這些「看著發生」的畫面才會出現。雜湊等於 runScript
  // 任意指令紀錄，從第 0 步一步一步跑（每一步都餵畫面與戰報統計）；回傳雜湊
  playLog: (s: number, lg: LoggedCommand[], ticks: number) => {
    reset(s, false);
    let i = 0;
    while (w.tick < ticks) {
      while (i < lg.length && lg[i].tick <= w.tick) { if (lg[i].tick === w.tick) issue(lg[i].cmd); i++; }
      tick();
    }
    return hashWorld(w);
  },
  winner: () => w.winner,
  report: () => ({ shown: !!reportView?.visible(), data: makeReport(w, stats) }),
  playScript: (ticks = SCRIPT_TICKS) => {
    reset(SCRIPT_SEED, false);
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
