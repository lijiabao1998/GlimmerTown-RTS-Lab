// R137: independent eligibility fixtures, actual menu/main callbacks, isolated exact-first-red controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as world from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from '../src/sim/script.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { Gestures } from '../src/ui/gestures.ts';
const { createWorld, hashWorld, SUB, SIDE_PLAYER, SIDE_ENEMY, ORD_IDLE, ORD_MOVE, UNIT_KINDS,
  UK_TANK, UK_HOWITZER, UK_MORTAR, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_ZOMBIE } = world;
const paths = { menu: '../src/ui/commandMenu.ts', main: '../src/main.ts', valves: '../src/valves.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(new URL(p, import.meta.url), 'utf8')]));
const cases = {}, mutations = {}, aim = { x: 18, z: 17 };
const readStart = '  const ids = [...selected];';
const frameCall = '  commandMenu?.frame();';
const heLabel = n => `高爆砲擊 · 適用 ${n}`;
const smokeLabel = n => `煙幕（榴彈砲） · 適用 ${n}`;
const oldHTML = '<strong id="cm-target"></strong><button id="cm-he" type="button">高爆砲擊</button><button id="cm-smoke" type="button">煙幕（榴彈砲）</button><button id="cm-cancel" type="button">取消</button>';
const eq = (actual, expected, message) => assert.deepEqual(actual, expected, message);
function test(name, message, file, from, to, run) { cases[name] = run; mutations[name] = { message, file, from, to }; }
function fixture() { const w = createWorld(1944); w.units = []; return { w, selected: new Set() }; }
function add(f, kind = UK_HOWITZER, side = SIDE_PLAYER, alive = true) {
  const u = { id: f.w.units.length + 1, side, kind, x: SUB, z: SUB, hp: alive ? UNIT_KINDS[kind].hp : 0, alive,
    order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
  f.w.units.push(u); f.selected.add(u.id); return u;
}
function result(f, target = aim) { return bombardEligibility(f.w, f.selected, target); }
// The expected table is explicit: it never uses bombardCommand or UNIT_KINDS.indirect as its oracle.
for (const [label, kind, he, smoke] of [
  ['howitzer', UK_HOWITZER, 1, 1], ['mortar', UK_MORTAR, 1, 0], ['tank', UK_TANK, 0, 0], ['observer', UK_OBSERVER, 0, 0],
  ['infantry', UK_INFANTRY, 0, 0], ['atgun', UK_ATGUN, 0, 0], ['light', UK_LIGHT, 0, 0], ['heavy', UK_HEAVY, 0, 0],
  ['armored_car', UK_ARMORED_CAR, 0, 0], ['destroyer', UK_DESTROYER, 0, 0], ['assault', UK_ASSAULT, 0, 0], ['zombie', UK_ZOMBIE, 0, 0],
]) test(label, `${label}: exact HE and smoke eligibility`, 'menu', 'UNIT_KINDS[u.kind].indirect',
  he ? `UNIT_KINDS[u.kind].indirect && u.kind !== ${kind}` : `(UNIT_KINDS[u.kind].indirect || u.kind === ${kind})`, message => {
    const f = fixture(); add(f, kind); eq(result(f), { he, smoke }, message);
  });
test('smoke_howitzer_only', 'smoke: mortars cannot inflate howitzer count', 'menu', 'u.kind === UK_HOWITZER :', 'true :', message => {
  const f = fixture(); add(f); add(f, UK_MORTAR); add(f, UK_TANK); eq(result(f), { he: 2, smoke: 1 }, message);
});
test('deduplicate', 'duplicates: each selected ID counts only once', 'menu', '[...new Set(selected)]', '[...selected]', message => {
  const f = fixture(), a = add(f), b = add(f, UK_MORTAR); f.selected = [a.id, b.id, a.id, b.id, a.id]; eq(result(f), { he: 2, smoke: 1 }, message);
});
test('invalid_ids', 'invalid IDs: unknown and noninteger ids cannot contribute', 'menu', 'return u?.alive && u.side === SIDE_PLAYER && (ammo', 'return !u || u.alive && u.side === SIDE_PLAYER && (ammo', message => {
  const f = fixture(), a = add(f); f.selected = [-1, 0, 0.5, 99999, NaN, Infinity, a.id]; eq(result(f), { he: 1, smoke: 1 }, message);
});
test('enemy', 'enemy: hostile units never contribute', 'menu', 'u.side === SIDE_PLAYER && ', '', message => {
  const f = fixture(); add(f); add(f, UK_HOWITZER, SIDE_ENEMY); add(f, UK_MORTAR, SIDE_ENEMY); eq(result(f), { he: 1, smoke: 1 }, message);
});
test('dead', 'dead: destroyed guns never contribute', 'menu', 'return u?.alive &&', 'return u &&', message => {
  const f = fixture(); add(f); add(f, UK_HOWITZER, SIDE_PLAYER, false); add(f, UK_MORTAR, SIDE_PLAYER, false); eq(result(f), { he: 1, smoke: 1 }, message);
});
test('empty', 'empty: both eligibility counts are zero', 'menu', "he: he?.t === 'fireAt' ? he.ids.length : 0", "he: he?.t === 'fireAt' ? he.ids.length : 1", message => {
  const f = fixture(); add(f); f.selected.clear(); eq(result(f), { he: 0, smoke: 0 }, message); f.selected.add(99999); eq(result(f), { he: 0, smoke: 0 }, 'stale-only selection is empty');
});
test('invalid_target', 'target: out-of-bounds and malformed target has zero eligibility', 'menu', '  if (!validTarget(w, target)) return null;', '', message => {
  const f = fixture(); add(f); for (const p of [{ x: -1, z: 1 }, { x: 0, z: -1 }, { x: f.w.n, z: 0 }, { x: 0, z: f.w.n }, { x: 1.5, z: 2 }, { x: NaN, z: 1 }, { x: 1, z: Infinity }]) eq(result(f, p), { he: 0, smoke: 0 }, message);
});
test('large_map', 'target: current map extent rather than fixed small-map extent', 'menu', 'p.x < w.n && p.z < w.n', 'p.x < 32 && p.z < 32', message => {
  const f = fixture(); add(f); f.w.n = 64; eq(result(f, { x: 63, z: 63 }), { he: 1, smoke: 1 }, message);
});
test('single_use_iterable', 'iterable: both modes see the same single-use selection', 'menu', readStart, '  const ids = selected;', message => {
  const f = fixture(), a = add(f), b = add(f, UK_MORTAR); f.selected = (function* () { yield a.id; yield b.id; })(); eq(result(f), { he: 2, smoke: 1 }, message);
});
test('not_range', 'eligibility: distant guns remain eligible rather than pretending to be in range', 'menu', readStart,
  '  const ids = [...selected].filter(id => { const u = w.units[id - 1]; return u && (u.x - target.x * SUB) ** 2 + (u.z - target.z * SUB) ** 2 <= UNIT_KINDS[u.kind].range ** 2; });', message => {
    const f = fixture(); add(f); add(f, UK_MORTAR); eq(result(f, { x: f.w.n - 1, z: f.w.n - 1 }), { he: 2, smoke: 1 }, message);
  });
test('not_reload', 'eligibility: reload timers do not remove eligible guns', 'menu', readStart,
  '  const ids = [...selected].filter(id => !w.units[id - 1]?.cooldown);', message => {
    const f = fixture(), a = add(f), b = add(f, UK_MORTAR); a.cooldown = UNIT_KINDS[a.kind].reload; b.cooldown = 1; eq(result(f), { he: 2, smoke: 1 }, message);
  });
test('not_order', 'eligibility: moving guns retain command eligibility', 'menu', readStart,
  `  const ids = [...selected].filter(id => w.units[id - 1]?.order === ${ORD_IDLE});`, message => {
    const f = fixture(), a = add(f); a.order = ORD_MOVE; a.path = [1, 2]; eq(result(f), { he: 1, smoke: 1 }, message);
  });
test('readonly_world', 'readonly: full world including RNG remains unchanged', 'menu', readStart, '  w.rng ^= 1;\n' + readStart, message => {
  const f = fixture(); add(f); const before = structuredClone(f.w), hash = hashWorld(f.w);
  for (let i = 0; i < 120; i++) { result(f); eq(f.w, before, message); }
  eq(hashWorld(f.w), hash, 'full hash retained');
});
test('readonly_selection', 'readonly: selected IDs and insertion order remain unchanged', 'menu', readStart, readStart + '\n  selected.clear();', message => {
  const f = fixture(); add(f); add(f, UK_MORTAR); f.selected.add(99999); const before = [...f.selected]; result(f); eq([...f.selected], before, message);
});
test('readonly_target', 'readonly: frozen aim is never edited by eligibility reads', 'menu', readStart, '  target.x++;\n' + readStart, message => {
  const f = fixture(); add(f); const target = { ...aim }; result(f, target); eq(target, aim, message);
});
test('readonly_commands', 'readonly: reading eligibility never changes existing command records', 'menu', readStart, '  w.units[0].order++;\n' + readStart, message => {
  const f = fixture(); add(f); const cmd = { t: 'fireAt', side: SIDE_PLAYER, ids: [1], ...aim }, log = [{ tick: 0, cmd }], before = structuredClone({ world: f.w, log });
  result(f); eq({ world: f.w, log }, before, message);
});

class Element {
  constructor() { this.children = new Map(); this.events = new Map(); this.attrs = new Map(); this.style = {}; this.hidden = false; this.disabled = false; this.text = ''; this.writes = 0; }
  set innerHTML(html) {
    this.html = html; this.children.clear();
    for (const match of html.matchAll(/<([a-z]+) id="([^"]+)"[^>]*>([^<]*)<\/\1>/g)) { const child = new Element(); child.text = match[3]; this.children.set(match[2], child); }
  }
  get innerHTML() { return this.html; }
  set textContent(value) { this.text = value; this.writes++; }
  get textContent() { return this.text; }
  querySelector(selector) { return this.children.get(selector.slice(1)); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  appendChild(el) { this.children.set(el.id, el); }
  addEventListener(k, cb) { this.events.set(k, cb); }
  dispatch(k) { if (!this.disabled) this.events.get(k)?.({ target: this, stopPropagation() {} }); }
  contains(el) { return el === this || [...this.children.values()].includes(el); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 196, bottom: 220, width: 196, height: 220 }; }
}
function dom() {
  const body = new Element(), hud = new Element();
  globalThis.Node = Element; globalThis.innerWidth = 412; globalThis.innerHeight = 860;
  globalThis.document = { body, createElement: () => new Element(), getElementById: id => id === 'hud' ? hud : hud.children.get(id), querySelector: () => null, addEventListener() {} };
  return { hud, document: globalThis.document };
}
function menuFixture(enabled = true) {
  const f = fixture(); add(f); add(f, UK_MORTAR); const { hud } = dom(), chosen = [], canceled = []; let reads = 0;
  const menu = initCommandMenu({ choose: (...args) => chosen.push(args), cancel: () => canceled.push(1) }, enabled ? () => { reads++; return { world: f.w, selected: f.selected }; } : undefined);
  const root = hud.children.get('command-menu'), $ = id => root.querySelector('#' + id);
  return { ...f, menu, root, $, chosen, canceled, reads: () => reads, open: () => menu.open(aim, 206, 430), labels: () => [$('cm-he').textContent, $('cm-smoke').textContent] };
}
test('dom_labels', 'DOM: both original buttons show exact eligible counts', 'menu', 'he.textContent = heText;', "he.textContent = '錯誤';", message => {
  const f = menuFixture(); f.open(); eq(f.labels(), [heLabel(2), smokeLabel(1)], message); eq(f.chosen, [], 'opening only reads, never orders'); eq(f.$('cm-target').textContent, '砲擊格 19 · 18', 'original frozen target title retained');
});
test('disclaimer', 'disclaimer: qualification is visibly distinct from range reload and stock', 'menu', '適用不查射程、裝填、煙幕存量', '現在可開火', message => {
  const f = menuFixture(); f.open(); eq(f.$('cm-eligibility').textContent, '適用不查射程、裝填、煙幕存量', message);
});
test('disabled_summary', 'rollback: absent read callback preserves exact old menu markup', 'menu', "+ (summaryEnabled ? '<small", "+ (true ? '<small", message => {
  const f = menuFixture(false); f.open(); eq(f.root.innerHTML, oldHTML, message); eq(f.labels(), ['高爆砲擊', '煙幕（榴彈砲）'], 'old button labels exact'); eq(f.reads(), 0, 'disabled summary never reads state');
  f.$('cm-smoke').dispatch('click'); eq(f.chosen, [['smoke', aim]], 'old button still issues original callback once');
});
test('zero_enabled', 'zero: no new disabling rule blocks original error feedback', 'menu', '    const heText = ', '    he.disabled = counts.he === 0; smoke.disabled = counts.smoke === 0;\n    const heText = ', message => {
  const f = menuFixture(); f.selected.clear(); f.open(); eq([f.$('cm-he').disabled, f.$('cm-smoke').disabled], [false, false], message);
  eq(f.labels(), [heLabel(0), smokeLabel(0)], 'zero eligibility is displayed'); f.$('cm-smoke').dispatch('click'); eq(f.chosen, [['smoke', aim]], 'zero count still follows original click path');
});
test('unchanged_frame', 'frames: stable eligibility avoids repeated label writes', 'menu', 'if (he.textContent !== heText)', 'if (true)', message => {
  const f = menuFixture(); f.open(); const writes = f.$('cm-he').writes + f.$('cm-smoke').writes;
  for (let i = 0; i < 20; i++) f.menu.frame(); eq(f.$('cm-he').writes + f.$('cm-smoke').writes, writes, message);
});
test('closed_frame', 'closed: hidden menu performs no state reads', 'menu', 'if (!summaryEnabled || !aim || root.hidden) return;', 'if (!summaryEnabled) return;', message => {
  const f = menuFixture(); f.open(); f.menu.close(); const before = f.reads();
  // The mutant reads before failing on the absent target; assert the semantic read count, not that TypeError.
  let error; try { f.menu.frame(); } catch (e) { error = e; } eq(f.reads(), before, message); if (error) throw error; eq(f.chosen, [], 'closing never sends an order');
});
test('reopen', 'reopen: canceled menus use fresh selection and target', 'menu', '      frame();', '', message => {
  const f = menuFixture(); f.open(); f.$('cm-cancel').dispatch('click'); f.selected.clear(); f.selected.add(2); f.menu.open({ x: 4, z: 6 }, 210, 430);
  eq(f.labels(), [heLabel(1), smokeLabel(0)], message); eq(f.canceled, [1], 'cancel emits once'); eq(f.$('cm-target').textContent, '砲擊格 5 · 7', 'new frozen target replaces old one');
});

function section(source, start, end) { const a = source.indexOf(start), b = source.indexOf(end, a + start.length); assert(a >= 0 && b > a, 'source boundaries ' + start); return source.slice(a, b); }
function mainFixture(query = '') {
  const f = fixture(); add(f); add(f, UK_MORTAR); const { hud: domHud, document } = dom(); let render, hudUpdates = 0, hudFrames = 0; const issued = [];
  const q = new URLSearchParams(query);
  const c = vm.createContext({ ...world, ...f, q, V: fixtureValves(q, { r015: false, r115: false, r010: false }), initCommandMenu, bombardCommand, commandMenu: undefined,
    document, addEventListener() {}, phase: 'battle', battleHint: undefined, help: { visible: () => false }, reportView: undefined,
    issue: cmd => issued.push(structuredClone(cmd)), simT: () => 0, clearGestureInput() {}, canvas: {}, pointers: new Map(),
    view: { setMarker() {}, update() {}, render() {}, rangeInfo: 'unchanged', vegetationInfo: '' },
    hud: { update: () => hudUpdates++, frame: () => hudFrames++ }, performance: { now: () => 1000 }, lastT: 1000,
    paused: true, speed: 1, acc: 0, endT0: -1, endFrom: null, reportShown: false, stats: {}, slowmoFactor: () => 1,
    syncBattleAudio() {}, battleAudio: undefined, tick: () => step(c.w, []), TICK_HZ: 30, devicePixelRatio: 1, innerWidth: 412, innerHeight: 860,
    fling: { active: false }, glide: { active: false }, style: {}, lastRangeInfo: 'unchanged', lastCoverInfo: '', lastBombardInfo: '', lastReloadInfo: '', lastVehicleInfo: '', lastVegetationInfo: '',
    coverDurability: () => '', bombardStatus: () => '', reloadStatus: () => '', vehicleDurability: () => '', counterbatteryHint: () => '', lastCounterbatteryInfo: '', lastCounterbatteryWorld: f.w,
    fireDisciplineFrame: undefined, prodBar: undefined, minimap: undefined, tutorial: { frame() {} },
    renderer: { setAnimationLoop: callback => { render = callback; }, setPixelRatio() {}, setSize() {} } });
  vm.runInContext(section(mainPlain, 'if (V.r109) {\n  commandMenu = ', '\n// R037：'), c);
  vm.runInContext(section(mainPlain, 'renderer.setAnimationLoop(() => {', '\n// R040：'), c);
  const root = domHud.children.get('command-menu'), $ = id => root?.querySelector('#' + id);
  return { ...f, c, root, $, issued, frame: () => render(), updates: () => hudUpdates, frames: () => hudFrames,
    open: () => c.commandMenu.open(aim, 206, 430), labels: () => [$('cm-he').textContent, $('cm-smoke').textContent] };
}
test('main_valve', 'noR137: actual main wiring restores old menu', 'main', '}, () => V.r137 ? { world: w, selected } : undefined);', '}, () => ({ world: w, selected }));', message => {
  const f = mainFixture('noR137=1'); f.open(); f.frame(); eq(f.root.innerHTML, oldHTML, message);
  f.$('cm-he').dispatch('click'); eq(f.issued, [{ t: 'fireAt', side: SIDE_PLAYER, ids: [1, 2], ...aim }], 'rollback preserves HE command');
});
test('r109_valve', 'noR109: original gesture valve still prevents menu creation', 'valves', "get r109() { return on('109'); }", 'get r109() { return true; }', message => {
  const f = mainFixture('noR109=1'); f.frame(); eq(f.root, undefined, message); eq(f.issued, [], 'noR109 never sends new commands');
});
test('frame_selection', 'frame: current selection updates while paused without a HUD refresh', 'main', frameCall, '', message => {
  const f = mainFixture(); f.open(); f.selected.clear(); f.selected.add(2); f.frame(); eq(f.labels(), [heLabel(1), smokeLabel(0)], message); eq(f.updates(), 0, 'frame never calls full HUD update'); eq(f.w.tick, 0, 'paused simulation stays at same tick');
});
test('frame_death', 'frame: destroyed guns disappear while the menu stays open', 'main', frameCall, '', message => {
  const f = mainFixture(); f.open(); f.w.units[0].alive = false; f.w.units[0].hp = 0; f.frame(); eq(f.labels(), [heLabel(1), smokeLabel(0)], message); assert(f.c.commandMenu.isOpen(), 'death alone does not cancel existing menu');
});
test('frame_world', 'frame: replacing a world does not retain old counts', 'main', '() => V.r137 ? { world: w, selected } : undefined', '(() => { const original = w; return () => V.r137 ? { world: original, selected } : undefined; })()', message => {
  const f = mainFixture(); f.open(); f.c.w = structuredClone(f.w); f.c.w.units = []; f.c.lastCounterbatteryWorld = f.c.w; f.frame(); eq(f.labels(), [heLabel(0), smokeLabel(0)], message);
});
test('frame_no_hud_rescue', 'frame: eligibility never invokes general HUD refresh', 'main', frameCall, frameCall + ' hud?.update();', message => {
  const f = mainFixture(); f.open(); f.selected.clear(); f.frame(); eq(f.updates(), 0, message); eq(f.labels(), [heLabel(0), smokeLabel(0)], 'own text still updates'); eq(f.frames(), 1, 'existing HUD frame remains intact');
});
// The old gestures reset mutant has a pre-R130 signature anchor. Leave it untouched;
// execute today's reset and real cancellation/menu chain here, rather than checking source text.
for (const disabled of [false, true]) {
  const name = disabled ? 'reset_off' : 'reset_on';
  test(name, `reset ${disabled ? 'off' : 'on'}: original reset cleanup closes the real command menu`, 'main',
    '  if (V.r109) clearGestureInput();\n  battleAudio?.reset();', '  battleAudio?.reset();', message => {
      const f = mainFixture(disabled ? 'noR137=1' : '');
      Object.assign(f.c, { Gestures, MAP_LARGE, MAP_TOWN, selectInBox() {},
        fling: { stop() {} }, glide: { stop() {} }, dragged: false, pinchD: 0, dragV: { vx: 0, vy: 0, t: 0 },
        fxOn: true,
        newStats: () => ({}), ui() {}, planner: { clear() {}, refreshPreview() {} }, BattleView: class { constructor() { return f.c.view; } },
      });
      f.c.view.dispose = () => {};
      vm.runInContext(section(mainPlain, 'function clearBattleHint()', '\nfunction order('), f.c);
      vm.runInContext(section(mainPlain, 'const selectionBox = ', 'if (V.r109) {\n  commandMenu = '), f.c);
      vm.runInContext(section(mainPlain, 'function reset(', '\nfunction ui()'), f.c);
      f.open(); assert(f.c.commandMenu.isOpen(), 'reset fixture begins with real visible menu');
      eq(f.labels(), disabled ? ['高爆砲擊', '煙幕（榴彈砲）'] : [heLabel(2), smokeLabel(1)], 'reset fixture verifies requested R137 valve');
      f.c.reset(1944, false, false, false, false, false, false);
      eq(f.c.commandMenu.isOpen(), false, message);
      f.$('cm-he').dispatch('click'); eq(f.issued, [], 'reset invalidates frozen target and prevents stale command');
      eq([...f.selected], [], 'original reset clears selection');
      f.c.lastCounterbatteryWorld = f.c.w; f.frame(); eq(f.c.commandMenu.isOpen(), false, 'eligibility frame never reopens reset menu');
      f.open(); eq(f.labels(), disabled ? ['高爆砲擊', '煙幕（榴彈砲）'] : [heLabel(0), smokeLabel(0)], 'new world menu reopens with empty current selection');
    });
}
test('click_revalidation', 'click: death after last display still follows original revalidation error', 'menu', 'return u?.alive &&', 'return u &&', message => {
  const f = mainFixture(); f.selected.delete(2); f.open(); f.w.units[0].alive = false; f.$('cm-smoke').dispatch('click');
  eq(f.issued, [], message); eq(f.c.battleHint, '煙幕只供存活的我方榴彈砲；請先選取榴彈砲。', 'original smoke error retained'); assert(!f.c.commandMenu.isOpen(), 'click closes menu');
});
test('click_selection', 'click: new selection replaces previously displayed eligibility', 'main', 'const cmd = bombardCommand(w, selected, target, chosen);', 'const cmd = bombardCommand(w, [1, 2], target, chosen);', message => {
  const f = mainFixture(); f.open(); f.selected.clear(); f.selected.add(2); f.$('cm-he').dispatch('click');
  eq(f.issued, [{ t: 'fireAt', side: SIDE_PLAYER, ids: [2], ...aim }], message); eq(f.c.battleHint, '已下高爆砲擊指令；其他單位保持原指令。', 'original success feedback retained');
});
test('click_zero', 'click: zero eligibility still reaches original error feedback', 'menu', 'if (!aim || root.hidden) return;', 'if (!aim || root.hidden || read && !bombardEligibility(read().world, read().selected, aim).he) return;', message => {
  const f = mainFixture(); f.selected.clear(); f.open(); f.$('cm-he').dispatch('click');
  eq(f.c.battleHint, '高爆砲擊需先選取存活的我方榴彈砲或迫擊砲。', message); eq(f.issued, [], 'invalid click never dispatches a simulation command');
});
test('replay', 'replay: eligibility reads cannot change complete historical world', 'menu', readStart, '  w.rng ^= 1;\n' + readStart, message => {
  const a = createWorld(SCRIPT_SEED), b = structuredClone(a), ids = a.units.filter(u => u.side === SIDE_PLAYER).map(u => u.id), log = structuredClone(SCRIPT); let cursor = 0;
  for (let tick = 0; tick < SCRIPT_TICKS; tick++) {
    const commands = []; while (cursor < SCRIPT.length && SCRIPT[cursor].tick === tick) commands.push(SCRIPT[cursor++].cmd);
    step(a, commands); step(b, commands); bombardEligibility(a, ids, aim);
  }
  eq(a, b, message); eq(a, runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(log)), SCRIPT_TICKS), 'independent replay reaches the same complete world'); eq(SCRIPT, log, 'old command log remains unchanged');
  const golden = JSON.parse(fs.readFileSync(new URL('../tools/golden.json', import.meta.url), 'utf8'));
  eq(hashWorld(a), golden.hash, 'historical script golden remains exact');
});

const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.slice(9), only = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutation'); eq(sources[m.file].split(m.from).length - 1, 1, `${mutant}: unique production mutation anchor`); sources[m.file] = sources[m.file].replace(m.from, m.to);
}
const js = stripTypeScriptTypes(sources.menu).replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, new URL(paths.menu, import.meta.url)).href}'`);
const { bombardEligibility, bombardCommand, initCommandMenu } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const mainPlain = stripTypeScriptTypes(sources.main);
// R060：閥表也從（可能被故意弄壞的）原文載入；fixture 可以蓋掉個別閥
const { valves } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.valves)).toString('base64')}`);
const fixtureValves = (q, over = {}) => Object.defineProperties(valves(q), Object.fromEntries(Object.entries(over).map(([k, value]) => [k, { value, writable: true }])));
let count = 0;
for (const [name, run] of Object.entries(cases)) {
  if (only && name !== only) continue;
  try { run(mutations[name].message); count++; }
  catch (error) { console.error('FIRST_BOMBARD_FAILURE=' + JSON.stringify({ group: name, name: error.name, message: error.message.split('\n')[0] })); throw error; }
}
assert(count > 0, 'at least one eligibility group executes');
if (!mutant && !only) {
  for (const [name, m] of Object.entries(mutations)) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--case=${name}`], { encoding: 'utf8', timeout: 30000 });
    const output = child.stdout + '\n' + child.stderr, first = output.match(/^FIRST_BOMBARD_FAILURE=(.*)$/m);
    eq(child.error, undefined, `${name}: negative completes`); assert.notEqual(child.status, 0, `${name}: mutant must fail`); assert(first, `${name}: must fail on semantic assertion, not syntax/import error\n${output}`);
    eq(JSON.parse(first[1]), { group: name, name: 'AssertionError', message: m.message }, `${name}: exact intended first failure\n${output}`);
    console.log(`RED bombard-eligibility/${name}: ${m.message}`);
  }
  console.log(`bombard-eligibility: ${count} positive groups and ${Object.keys(mutations).length} isolated exact-first-red controls OK`);
}
