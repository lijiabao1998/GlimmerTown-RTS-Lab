// 進入點：固定步長迴圈（模擬 20 步／秒，畫面每幀插值）、觸控與滑鼠輸入、HUD、守衛掛勾 window.__rts。
import * as THREE from 'three';
import { createWorld, hashWorld, N, SUB, TICK_HZ, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, bldAt, cellOf, type World } from './sim/world.ts';
import { step, runLog, type Command, type LoggedCommand } from './sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from './sim/script.ts';
import { BattleView } from './render/battle.ts';
import { STYLE_A, type Style } from './render/post.ts';
import { initHud, type Hud } from './ui/hud.ts';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? SCRIPT_SEED) >>> 0;
const style: Style = { ...STYLE_A, pixelCss: Math.max(1, Math.min(4, Number(q.get('px') ?? STYLE_A.pixelCss) | 0)) };
// 逃生閥：?fx=off 或 window.__noFx＝true 時不產生爆炸、煙（AGENTS.md：新效果都要關得掉）
const fxOn = q.get('fx') !== 'off' && !(window as unknown as { __noFx?: boolean }).__noFx;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

let w: World, view: BattleView, log: LoggedCommand[], pending: Command[];
let hud: Hud | undefined;
let acc = 0, paused = false, speed = 1, fireMode = false, lastT = performance.now();
const selected = new Set<number>();
const SPEEDS = [1, 2, 4];

function reset(s = seed) {
  w = createWorld(s);
  view?.dispose();
  view = new BattleView(w, fxOn);
  log = []; pending = []; acc = 0; selected.clear();
  hud?.update();
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
}

// ---- 輸入：單指點＝選取／下指令；單指拖＝平移；雙指＝縮放；滾輪＝縮放；右鍵＝下指令 ----
const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
let dragged = false, pinchD = 0;

function pickUnit(cx: number, cy: number): number {
  let best = 0, bestD = 26 * 26;
  for (const u of w.units) {
    if (!u.alive) continue;
    const [sx, sy] = view.screenOf(u.x / SUB, 0.15, u.z / SUB, innerWidth, innerHeight);
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = u.id; }
  }
  return best;
}

function order(cx: number, cy: number) {
  const ids = [...selected].filter(id => w.units[id - 1].alive);
  if (!ids.length) return;
  const hit = pickUnit(cx, cy), t = hit ? w.units[hit - 1] : null;
  if (t && t.side !== SIDE_PLAYER) {
    issue({ t: 'attack', side: SIDE_PLAYER, ids, target: t.id });
    view.setMarker(t.x / SUB, t.z / SUB, simT(), true);
    return;
  }
  const p = view.groundAt(cx, cy, innerWidth, innerHeight);
  if (!p) return;
  const gx = Math.floor(p.x), gz = Math.floor(p.z);
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return;
  const b = bldAt(w, gx, gz);
  if (fireMode || (b && b.hp > 0)) {
    issue({ t: 'fireAt', side: SIDE_PLAYER, ids, x: gx, z: gz });
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
  if (e.key === ' ') { paused = !paused; hud?.update(); }
});

reset();

// ---- HUD ----
hud = initHud({
  state: () => {
    const mine = w.units.filter(u => u.side === SIDE_PLAYER && u.alive), theirs = w.units.filter(u => u.side === SIDE_ENEMY && u.alive);
    const sel = [...selected].map(id => w.units[id - 1]).filter(u => u.alive);
    return {
      tick: w.tick, paused, speed, fireMode, winner: w.winner,
      mine: mine.length, theirs: theirs.length,
      tanks: sel.filter(u => u.kind === UK_TANK).length, guns: sel.filter(u => u.kind === UK_HOWITZER).length,
    };
  },
  togglePause: () => { paused = !paused; },
  cycleSpeed: () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; },
  toggleFire: () => { fireMode = !fireMode; },
  selectAll: () => { selected.clear(); for (const u of w.units) if (u.side === SIDE_PLAYER && u.alive) selected.add(u.id); },
  restart: () => reset(),
});

// ---- 迴圈 ----
renderer.setAnimationLoop(() => {
  const t = performance.now(), dt = Math.min(0.25, (t - lastT) / 1000);
  lastT = t;
  if (!paused) acc += dt * speed;
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
    reset(SCRIPT_SEED);
    runLog(w, SCRIPT, ticks);
    view.dispose();
    view = new BattleView(w, fxOn);
    return hashWorld(w);
  },
  screenOf: (id: number) => { const u = w.units[id - 1]; return view.screenOf(u.x / SUB, 0.15, u.z / SUB, innerWidth, innerHeight); },
  screenOfCell: (x: number, z: number) => view.screenOf(x + 0.5, 0, z + 0.5, innerWidth, innerHeight),
  focus: (x: number, z: number, zoom = 1) => { view.target.set(x, 0, z); view.zoom = zoom; },
  info: () => ({ ...view.pipe.sceneInfo, rt: view.pipe.size, townTris: view.townTriangles, fx: fxOn, px: style.pixelCss }),
  cellOf: (p: number) => cellOf(p),
};
(window as unknown as { __rts: typeof rts }).__rts = rts;
