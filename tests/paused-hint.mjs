import { vehicleDurability } from '../src/ui/vehicleDurability.ts';
import { coverDurability } from '../src/ui/coverDurability.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
// R110: actual main input handlers/state callback + actual initHud, with a small DOM API stub.
// This is paused/controller evidence, not a browser/layout or physical-device test.
// node tests/paused-hint.mjs --mutations checks isolated, in-memory production-source mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, SUB, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UNIT_KINDS } from '../src/sim/world.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { bombardCommand, bombardTarget } from '../src/ui/commandMenu.ts';
import { Gestures, inSelectionRect } from '../src/ui/gestures.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { main: read('../src/main.ts'), hud: read('../src/ui/hud.ts') };
const mutations = {
  order_refresh: { group: 'orders', file: 'main', from: 'function order(cx: number, cy: number) {\n  if (r109) clearBattleHint();', to: 'function order(cx: number, cy: number) {\n  if (r109) battleHint = undefined;' },
  tap_refresh: { group: 'taps', file: 'main', from: 'function tap(cx: number, cy: number, additive: boolean, t = performance.now()) {\n  if (r109) clearBattleHint();', to: 'function tap(cx: number, cy: number, additive: boolean, t = performance.now()) {\n  if (r109) battleHint = undefined;' },
  clear_after_route: { group: 'early_returns', file: 'main', from: 'if (r109) clearBattleHint();\n  if (phase', to: 'if (r109 && selected.size && view.groundAt(cx, cy, innerWidth, innerHeight)) clearBattleHint();\n  if (phase' },
  gesture_refresh: { group: 'cancellation', file: 'main', from: 'dragV = { vx: 0, vy: 0, t: 0 }; clearBattleHint();', to: 'dragV = { vx: 0, vy: 0, t: 0 }; battleHint = undefined;' },
  blur_cleanup: { group: 'event_cleanup', file: 'main', from: "addEventListener('blur', clearGestureInput);", to: "addEventListener('blur', () => {});" },
  release_capture: { group: 'gesture_compatibility', file: 'main', from: 'if (r109 && pointers.has(e.pointerId)) clearGestureInput();', to: 'if (r109) clearGestureInput();' },
  redundant_update: { group: 'no_hint', file: 'main', from: 'if (battleHint === undefined) return;', to: 'if (false) return;' },
  absent_hud: { group: 'initialization', file: 'main', from: 'if (battleHint === undefined) return;', to: 'if (battleHint === undefined || !hud) return;' },
  frame_update: { group: 'throttle', file: 'hud', from: 'if (sec !== lastSec)', to: 'if (true)' },
  rng_write: { group: 'purity', file: 'main', from: 'function clearBattleHint() {', to: 'function clearBattleHint() {\n  w.rng ^= 1;' },
  duplicate_command: { group: 'payloads', file: 'main', from: 'for (const cmd of route.commands) issue(cmd);', to: 'for (const cmd of route.commands) { issue(cmd); issue(cmd); }' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutation');
  assert.equal(sources[m.file].split(m.from).length - 1, 1, `${mutant}: unique production-source anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
const plain = stripTypeScriptTypes(sources.main);
function between(start, end) {
  const a = plain.indexOf(start), b = plain.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `source boundaries exist: ${start}`);
  return plain.slice(a, b);
}
const inputSource = between('function clearBattleHint()', '\nreset();');
const hudSource = between('const ORD_NAME = ', '\nreportView = initReportView');
const { initHud } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.hud)).toString('base64')}`);

// Only DOM APIs used by the real HUD and main's selection-box creation are stubbed.
class Element {
  constructor(metrics) {
    this.metrics = metrics; this.children = new Map(); this.events = new Map(); this.attrs = new Map();
    this.style = {}; this.hidden = false; this.disabled = false; this.writes = 0; this.text = '';
    const classes = new Set();
    this.classList = { toggle: (key, on) => on ? classes.add(key) : classes.delete(key), contains: key => classes.has(key) };
  }
  set innerHTML(html) { for (const m of html.matchAll(/id="([^"]+)"/g)) this.children.set(m[1], new Element(this.metrics)); }
  set textContent(text) { this.text = text; this.writes++; }
  get textContent() { return this.text; }
  querySelector(selector) { return this.children.get(selector.slice(1)) ?? null; }
  appendChild(el) { this.children.set(el.id, el); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  setPointerCapture() {}
}
function fakeClock() {
  let now = 0, next = 0; const jobs = new Map();
  return {
    set(fn, ms) { const id = ++next; jobs.set(id, { at: now + ms, fn }); return id; },
    clear(id) { jobs.delete(id); },
    advance(ms) { now += ms; for (const [id, job] of [...jobs]) if (job.at <= now) { jobs.delete(id); job.fn(); } },
  };
}
const touch = (extra = {}) => ({ pointerId: 1, pointerType: 'touch', button: 0, shiftKey: false, clientX: 100, clientY: 100, ...extra });
const BASE_HINT = '血量 100%｜待命 2。已選：坦克 1、砲 1。點地面＝移動，點敵人＝攻擊，點房子＝轟它';
const NO_SELECTION = '點我方單位（藍圈）選取；拖曳平移，雙指或滾輪縮放';
const SMOKE_HINT = '已選榴彈砲 1：點地面、敵人或房子布煙；混選的其他單位不動。煙幕無傷害，遮住雙方視線；按「砲擊」恢復移動／攻擊。';
const NO_SMOKE_GUN = '煙幕只供榴彈砲：先點我方榴彈砲選取。煙幕無傷害，遮住雙方視線；按「砲擊」恢復移動／攻擊。';
const FEEDBACK = {
  smoke: '已下煙幕指令；其他單位保持原指令。',
  he: '已下高爆砲擊指令；其他單位保持原指令。',
  error: '煙幕只供存活的我方榴彈砲；請先選取榴彈砲。',
};
function fixture({ hud = true, enabled = true } = {}) {
  const metrics = { updates: 0, creates: 0, cancels: 0, flingStops: 0, glideStops: 0 };
  const body = new Element(metrics), canvas = new Element(metrics), docEvents = new Map(), globalEvents = new Map(), clock = fakeClock();
  const document = { body, createElement() { metrics.creates++; return new Element(metrics); }, addEventListener: (t, f) => docEvents.set(t, f) };
  globalThis.document = document;
  const w = createWorld(1944); w.tick = 1; w.occ.fill(0);
  const tank = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_TANK);
  const gun = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_HOWITZER);
  const foe = w.units.find(u => u.side === SIDE_ENEMY && u.kind === UK_TANK);
  const commands = [], markers = [], placements = [], selected = new Set([tank.id, gun.id]);
  let menuOpen = false;
  const menu = { isOpen: () => menuOpen, open() { menuOpen = true; }, close() { menuOpen = false; }, contains: target => target === menu };
  const c = vm.createContext({
    q: new URLSearchParams('noR123=1&noR124=1&noR135=1'), // Isolate original paused-hint refresh guard.
    w, selected, battleHint: undefined, hud: undefined, paused: true, phase: 'battle', speed: 1, fireMode: false, ammo: 'he',
    battleAudio: undefined, syncBattleAudio() {}, // This guard exercises the original no-audio HUD/input path.
    r109: enabled, r009: true, r010: false, r012: false, r018: false, r015: true, r115: true, reloadStatus, coverDurability, vehicleDurability, counterbatteryHint: () => '', buildHint: '', BUILD_TIP: '布陣說明',
    SIDE_PLAYER, SIDE_ENEMY, SUB, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UNIT_KINDS,
    routeBattleOrder, bombardCommand, bombardTarget, inSelectionRect, document, canvas,
    pointers: new Map(), dragged: false, pinchD: 0, dragV: { vx: 2, vy: 3, t: 4 }, lastTap: { id: 0, t: 0 },
    performance: { now: () => 1000 }, innerWidth: 412, innerHeight: 860,
    addEventListener: (t, f) => globalEvents.set(t, f),
    fling: { stop() { metrics.flingStops++; }, start() {} }, glide: { stop() { metrics.glideStops++; }, start() {} },
    Gestures: class extends Gestures { constructor(actions) { super(actions, clock); } cancel() { metrics.cancels++; super.cancel(); } },
    initCommandMenu(actions) { c.menuActions = actions; return menu; }, commandMenu: undefined,
    hit: 0, ground: { x: 16.2, z: 15.8 }, building: null,
    pickUnit: () => c.hit, simT: () => w.tick / 20, issue: command => commands.push(command), placeAt: (...p) => placements.push(p),
    view: { visibleUnit: () => true, buildingAt: () => c.building, groundAt: () => c.ground, setMarker: (...args) => markers.push(args), target: { x: 0, z: 0 }, pan() {}, zoomBy() {}, zoomAt() {} },
    help: { visible: () => false }, reportView: { visible: () => false }, prodBar: { update() {} },
    initHud(actions) { const actual = initHud(actions); return { update() { metrics.updates++; actual.update(); }, frame: actual.frame }; },
  });
  vm.runInContext(inputSource, c);
  if (hud) { vm.runInContext(hudSource, c); c.hud.frame(); }
  const hintElement = () => body.children.get('hud').querySelector('#hint');
  return {
    c, w, tank, gun, foe, commands, markers, placements, metrics, body, clock, menu,
    hint: () => hintElement().textContent, writes: () => hintElement().writes,
    send(type, extra = {}) { canvas.events.get(type)?.(touch(extra)); },
    global(type, event) { globalEvents.get(type)?.(event); },
    outside(target) { docEvents.get('pointerdown')?.({ target }); },
    prime(kind = 'smoke') {
      const ids = [...selected]; selected.clear(); selected.add(kind === 'error' ? tank.id : gun.id);
      c.menuActions.choose(kind === 'he' ? 'he' : 'smoke', { x: 18, z: 17 });
      selected.clear(); for (const id of ids) selected.add(id);
      assert.equal(c.battleHint, FEEDBACK[kind], 'fixture: actual menu callback produces feedback');
      assert.equal(this.hint(), FEEDBACK[kind], 'fixture: actual HUD renders feedback');
      commands.length = 0; markers.length = 0; metrics.updates = 0;
    },
  };
}
function stable(f, expected, group, label) {
  assert.equal(f.c.battleHint, undefined, `${group}: ${label} clears feedback state`);
  assert.equal(f.hint(), expected, `${group}: ${label} immediately restores HUD text while paused`);
  const tick = f.w.tick, writes = f.writes();
  for (let i = 0; i < 120; i++) f.c.hud.frame();
  assert.equal(f.w.tick, tick, `${group}: ${label} never advances simulation`);
  assert.equal(f.hint(), expected, `${group}: ${label} stays correct for 120 paused frames`);
  assert.equal(f.writes(), writes, `${group}: ${label} adds no per-frame HUD writes`);
}
const routes = [
  { name: 'ground move', setup() {}, expected: f => [{ t: 'move', side: SIDE_PLAYER, ids: [f.tank.id, f.gun.id], x: 16, z: 15 }], hint: BASE_HINT },
  { name: 'enemy attack', setup(f) { f.c.hit = f.foe.id; }, expected: f => [{ t: 'attack', side: SIDE_PLAYER, ids: [f.tank.id, f.gun.id], target: f.foe.id }], hint: BASE_HINT },
  { name: 'building fireAt', setup(f) { f.c.building = [12, 13]; }, expected: f => [{ t: 'fireAt', side: SIDE_PLAYER, ids: [f.tank.id, f.gun.id], x: 12, z: 13 }], hint: BASE_HINT },
  { name: 'HE ground fireAt', setup(f) { f.c.fireMode = true; }, expected: f => [{ t: 'fireAt', side: SIDE_PLAYER, ids: [f.gun.id], x: 16, z: 15 }], hint: `${BASE_HINT}；砲擊模式：點地面＝對那一格開火` },
  { name: 'smoke ground fireAt', setup(f) { f.c.fireMode = true; f.c.ammo = 'smoke'; }, expected: f => [{ t: 'fireAt', side: SIDE_PLAYER, ids: [f.gun.id], x: 16, z: 15, ammo: 'smoke' }], hint: SMOKE_HINT },
];
const canonical = value => JSON.parse(JSON.stringify(value));
function runRoute(entry, route, kind, group) {
  const f = fixture(); route.setup(f); f.prime(kind);
  f.c[entry](100, 100, false);
  stable(f, route.hint, group, `${entry}/${route.name}/${kind}`);
  assert.deepEqual(canonical(f.commands), route.expected(f), `${group}: ${entry}/${route.name} exact independent command payload/count`);
  assert.equal(f.metrics.updates, 1, `${group}: ${entry}/${route.name} one feedback refresh`);
  return f;
}
const groups = {
  orders() { for (const route of routes) for (const kind of Object.keys(FEEDBACK)) runRoute('order', route, kind, 'orders'); },
  taps() {
    for (const route of routes) for (const kind of Object.keys(FEEDBACK)) runRoute('tap', route, kind, 'taps');
    for (const additive of [false, true]) {
      const f = fixture(); f.prime('error'); f.c.hit = f.tank.id; f.c.tap(100, 100, additive);
      assert.deepEqual([...f.c.selected], additive ? [f.gun.id] : [f.tank.id], 'taps: friendly tap preserves replace/Shift-toggle selection');
      const selectedText = additive ? '砲 1' : '坦克 1';
      stable(f, `血量 100%｜待命 1。已選：${selectedText}。點地面＝移動，點敵人＝攻擊，點房子＝轟它`, 'taps', 'friendly selection');
      assert.equal(f.commands.length, 0, 'taps: friendly selection never issues a command');
      if (additive) { f.c.tap(100, 100, true); assert.deepEqual([...f.c.selected], [f.gun.id, f.tank.id], 'taps: Shift adds an unselected friend'); }
    }
  },
  early_returns() {
    const cases = [
      { name: 'empty selection', setup: f => f.c.selected.clear(), hint: NO_SELECTION },
      { name: 'no ground', setup: f => { f.c.ground = null; }, hint: BASE_HINT },
      { name: 'invalid ground', setup: f => { f.c.ground = { x: -1, z: 0 }; }, hint: BASE_HINT },
      { name: 'smoke without howitzer', setup: f => { f.c.selected.clear(); f.c.selected.add(f.tank.id); f.c.fireMode = true; f.c.ammo = 'smoke'; }, hint: NO_SMOKE_GUN },
    ];
    for (const entry of ['order', 'tap']) for (const item of cases) for (const kind of ['smoke', 'error']) {
      const f = fixture(); item.setup(f); f.prime(kind);
      f.c[entry](100, 100, false); stable(f, item.hint, 'early_returns', `${entry}/${item.name}`);
      assert.equal(f.commands.length, 0, 'early_returns: rejected route issues no commands');
      assert.equal(f.markers.length, 0, 'early_returns: rejected route adds no marker');
    }
  },
  cancellation() {
    for (const kind of Object.keys(FEEDBACK)) {
      const f = fixture(); f.prime(kind); f.c.pointers.set(1, { x: 100, y: 100, sx: 100, sy: 100 }); f.c.pinchD = 50;
      assert.equal(f.menu.isOpen(), false, 'cancellation: feedback starts with menu closed');
      f.c.clearGestureInput(); stable(f, BASE_HINT, 'cancellation', 'closed-menu cleanup');
      assert.equal(f.c.pointers.size, 0, 'cancellation: pointers are removed');
      assert.equal(f.c.dragged, true, 'cancellation: stale release cannot issue an order');
      assert.equal(f.c.pinchD, 0, 'cancellation: pinch state cleared');
      assert.deepEqual(canonical(f.c.dragV), { vx: 0, vy: 0, t: 0 }, 'cancellation: drag velocity cleared');
      assert.equal(f.metrics.cancels, 1, 'cancellation: real gesture state cancelled');
      assert.equal(f.metrics.flingStops, 1, 'cancellation: fling stopped'); assert.equal(f.metrics.glideStops, 1, 'cancellation: glide stopped');
      f.send('pointerup'); assert.equal(f.commands.length, 0, 'cancellation: no stale release command');
    }
  },
  event_cleanup() {
    const events = ['blur', 'resize', 'pointercancel', 'lostpointercapture', 'outside', 'minimap', 'Escape'];
    for (const event of events) {
      const f = fixture(); f.prime('smoke'); f.send('pointerdown');
      if (event === 'outside' || event === 'minimap') f.outside({ id: event });
      else if (event === 'Escape') f.global('keydown', { key: 'Escape' });
      else if (event === 'blur' || event === 'resize') f.global(event);
      else f.send(event);
      stable(f, event === 'Escape' ? NO_SELECTION : BASE_HINT, 'event_cleanup', event);
      f.clock.advance(1000); f.send('pointerup');
      assert.equal(f.menu.isOpen(), false, `event_cleanup: ${event} leaves no delayed long-press menu`);
      assert.equal(f.commands.length, 0, `event_cleanup: ${event} leaves no delayed command`);
    }
  },
  gesture_compatibility() {
    const f = fixture(); f.send('pointerdown'); f.clock.advance(500); f.send('pointerup');
    assert.equal(f.menu.isOpen(), true, 'gesture_compatibility: normal long-press release preserves the menu');
    const text = f.hint(); f.send('lostpointercapture');
    assert.equal(f.menu.isOpen(), true, 'gesture_compatibility: automatic capture loss after release keeps the menu');
    assert.equal(f.hint(), text, 'gesture_compatibility: automatic capture loss preserves prompt');
    assert.equal(f.commands.length, 0, 'gesture_compatibility: long press never commits a command');
    assert.equal(f.c.fireMode, false, 'gesture_compatibility: menu does not change toolbar mode');
    assert.equal(f.c.ammo, 'he', 'gesture_compatibility: menu does not change toolbar ammo');
    const off = fixture({ enabled: false }); off.send('pointerdown'); off.clock.advance(1000); off.send('pointerup');
    assert.equal(off.menu.isOpen(), false, 'gesture_compatibility: noR109 keeps ordinary touch');
    assert.equal(off.body.children.has('selection-box'), false, 'gesture_compatibility: noR109 creates no selection overlay');
    assert.deepEqual(canonical(off.commands), routes[0].expected(off), 'gesture_compatibility: noR109 ordinary command unchanged');
    assert.equal(off.metrics.updates, 0, 'gesture_compatibility: noR109 adds no cleanup HUD update');
  },
  no_hint() {
    const f = fixture(); const writes = f.writes();
    f.c.clearBattleHint(); f.c.order(100, 100); f.c.tap(100, 100, false); f.c.clearGestureInput();
    assert.equal(f.metrics.updates, 0, 'no_hint: absent feedback causes zero extra HUD updates');
    assert.equal(f.writes(), writes, 'no_hint: absent feedback causes zero extra text writes');
    f.c.hit = f.tank.id; f.c.tap(100, 100, false);
    assert.equal(f.metrics.updates, 1, 'no_hint: friendly selection retains its one required update');
    f.prime('smoke'); f.c.clearBattleHint(); f.c.clearBattleHint();
    assert.equal(f.metrics.updates, 1, 'no_hint: repeated cleanup updates only on the first clear');
  },
  initialization() {
    const f = fixture({ hud: false }); f.c.battleHint = FEEDBACK.error;
    assert.doesNotThrow(() => f.c.clearGestureInput(), 'initialization: cleanup before HUD creation is safe');
    assert.equal(f.c.battleHint, undefined, 'initialization: feedback is cleared even before HUD exists');
    assert.doesNotThrow(() => f.c.clearBattleHint(), 'initialization: repeated no-HUD clear is safe');
    assert.equal(f.commands.length, 0, 'initialization: early cleanup issues no command');
  },
  throttle() {
    const f = fixture(); f.prime('smoke'); f.c.clearBattleHint();
    const writes = f.writes(), creates = f.metrics.creates, updates = f.metrics.updates;
    for (let i = 0; i < 120; i++) f.c.hud.frame();
    assert.equal(f.writes(), writes, 'throttle: 120 paused frames add zero HUD text writes');
    assert.equal(f.metrics.creates, creates, 'throttle: 120 paused frames allocate no DOM');
    assert.equal(f.metrics.updates, updates, 'throttle: frames add no public update calls');
    f.w.tick = 19; f.c.hud.frame(); assert.equal(f.writes(), writes, 'throttle: same simulation second stays throttled');
    f.w.tick = 20; f.c.hud.frame(); assert.equal(f.writes(), writes + 1, 'throttle: next simulation second still refreshes once');
  },
  purity() {
    for (const entry of ['order', 'tap', 'clearGestureInput']) for (const kind of ['smoke', 'error']) {
      const f = fixture(); f.prime(kind); const world = structuredClone(f.w), hash = hashWorld(f.w), rng = f.w.rng, ids = [...f.c.selected];
      f.c[entry](100, 100, false); for (let i = 0; i < 120; i++) f.c.hud.frame();
      assert.equal(f.w.rng, rng, 'purity: input cleanup never consumes or changes simulation RNG');
      assert.equal(hashWorld(f.w), hash, 'purity: input cleanup preserves world hash');
      assert.deepEqual(f.w, world, 'purity: all world state stays unchanged before step');
      assert.deepEqual([...f.c.selected], ids, 'purity: command/cleanup leaves selection untouched');
    }
  },
  payloads() {
    for (const entry of ['order', 'tap']) for (const route of routes) {
      const f = fixture(); route.setup(f); f.prime('error'); f.c[entry](100, 100, false);
      assert.deepEqual(canonical(f.commands), route.expected(f), `payloads: ${entry}/${route.name} exact independent command payload/count`);
      assert.equal(f.markers.length, 1, `payloads: ${entry}/${route.name} one marker`);
      assert.equal(f.c.fireMode, route.name.includes('ground fireAt'), 'payloads: routing retains toolbar mode');
      assert.equal(f.c.ammo, route.name.startsWith('smoke') ? 'smoke' : 'he', 'payloads: routing retains toolbar ammo');
    }
  },
};
const only = process.argv.find(a => a.startsWith('--group='))?.slice(8);
assert(!only || Object.hasOwn(groups, only), 'known guard group');
for (const [name, run] of Object.entries(groups)) if (!only || name === only) {
  try { run(); console.log(`OK paused-hint ${name}`); }
  catch (error) { console.error(`NG paused-hint ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) {
  for (const [name, m] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8', timeout: 10000 });
    assert.equal(p.status, 1, `${name}: isolated broken source must exit 1\n${p.stdout}\n${p.stderr}`);
    const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
    assert(first?.startsWith(`${m.group}:`), `${name}: first red must be the intended semantic assertion, not syntax/startup\n${p.stderr}`);
    assert(p.stderr.includes(`NG paused-hint ${m.group}`), `${name}: intended guard ran`);
    console.log(`RED paused-hint ${name}: ${first}`);
  }
}
console.log('paused-hint: all requested groups OK (real handlers/HUD with DOM stub; browser evidence is separate)');
