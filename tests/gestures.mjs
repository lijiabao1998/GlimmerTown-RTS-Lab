import { MAP_TOWN } from '../src/sim/expandedMap.ts';
// R109 exact-boundary guards. Real production controller/main snippets; fake clock, not browser evidence.
// --mutations corrupts an isolated in-memory production source and checks the intended first red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, SIDE_PLAYER, SIDE_ENEMY, SUB, UK_HOWITZER, UK_TANK } from '../src/sim/world.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { bombardCommand, bombardTarget } from '../src/ui/commandMenu.ts';
const sources = Object.fromEntries(['gestures', 'main'].map(n => [n, fs.readFileSync(new URL(n === 'main' ? '../src/main.ts' : '../src/ui/gestures.ts', import.meta.url), 'utf8')]));
const mutations = {
  threshold: { group: 'box', file: 'gestures', from: 'Math.hypot(c.cx - c.x, c.cy - c.y) > 8', to: 'Math.hypot(c.cx - c.x, c.cy - c.y) >= 8' },
  gate: { group: 'gate', file: 'gestures', from: "e.pointerType === 'mouse' && e.button === 0 && e.shiftKey", to: "e.pointerType === 'mouse'" },
  selection: { group: 'selection', file: 'main', from: 'if (!u.alive || u.side !== SIDE_PLAYER) continue;', to: 'if (!u.alive) continue;' },
  height: { group: 'selection', file: 'main', from: 'const [x, y] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15,', to: 'const [x, y] = view.screenOf(u.x / SUB, 0.15,' },
  timer: { group: 'hold', file: 'gestures', from: '}, 500);', to: '}, 499);' },
  release: { group: 'hold', file: 'gestures', from: 'c.started = true; this.consumed.add(c.id); this.actions.hold', to: 'c.started = true; this.actions.hold' },
  motion: { group: 'pan', file: 'gestures', from: 'Math.hypot(c.cx - c.x, c.cy - c.y) > 8', to: 'Math.hypot(c.cx - c.x, c.cy - c.y) > 9' },
  pinch: { group: 'pinch', file: 'gestures', from: 'for (const id of this.points) this.consumed.add(id);', to: 'for (const id of []) this.consumed.add(id);' },
  resume: { group: 'resume', file: 'gestures', from: 'if (this.points.size === 1) this.consumed.delete(e.pointerId);', to: '' },
  cancel: { group: 'cancel', file: 'gestures', from: 'this.clearCandidate(); this.points.clear(); this.consumed.clear(); this.dismissOnly.clear(); this.actions.dismiss();', to: 'this.actions.dismiss();' },
  glide: { group: 'camera', file: 'main', from: 'fling.stop(); glide.stop();\n      selectionBox', to: 'fling.stop();\n      selectionBox' },
  compatibility: { group: 'compatibility', file: 'main', from: 'else tap(e.clientX, e.clientY, e.shiftKey, t);', to: 'else tap(e.clientX, e.clientY, false, t);' },
  geometry: { group: 'geometry', file: 'main', from: 'hud?.update(); prodBar?.update();\n    if (target) commandMenu?.open', to: 'hud?.update();\n    if (target) commandMenu?.open' },
  dispatch: { group: 'dispatch', file: 'main', from: 'if (gestures?.up(e))', to: 'if (false && gestures?.up(e))' },
  capture: { group: 'lifecycle', file: 'main', from: 'if (r109 && pointers.has(e.pointerId)) clearGestureInput();', to: 'if (r109) clearGestureInput();' },
  reset: { group: 'reset', file: 'main', from: "function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026 || large, vegetation = true, sandbox = false) {\n  if (r109) clearGestureInput();", to: "function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026 || large, vegetation = true, sandbox = false) {" },
  valve: { group: 'valve', file: 'main', from: 'const gestures = r109 ? new Gestures', to: 'const gestures = true ? new Gestures' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) { const m = mutations[mutant]; assert.ok(m); assert.ok(sources[m.file].includes(m.from), `${mutant}: production anchor`); sources[m.file] = sources[m.file].replace(m.from, m.to); }
const { Gestures, inSelectionRect } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.gestures)).toString('base64')}`);
const plain = stripTypeScriptTypes(sources.main);
const extract = name => { const s = plain.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(s, `production ${name} exists`); return s; };
const json = value => JSON.parse(JSON.stringify(value));
function fakeClock() {
  let now = 0, next = 0; const timers = new Map();
  return {
    now: () => now, set: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; }, clear: id => timers.delete(id),
    advance(ms) { const until = now + ms; for (;;) { const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = until; },
    pending: () => timers.size,
  };
}
const point = (x = 100, y = 200, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: true, clientX: x, clientY: y, ...extra });
const touch = (x = 100, y = 200, extra = {}) => point(x, y, { pointerType: 'touch', shiftKey: false, ...extra });
function fixture() {
  const clock = fakeClock(), boxes = [], selected = [], holds = []; let enabled = true, dismissed = 0;
  const g = new Gestures({ enabled: () => enabled, box: r => boxes.push(r), select: r => selected.push(r), hold: (x, y) => holds.push([x, y]), dismiss: () => dismissed++ }, clock);
  return { g, clock, boxes, selected, holds, enable: b => { enabled = b; }, dismissed: () => dismissed };
}
function mainFixture(enabled = true) {
  const clock = fakeClock(), globalEvents = new Map(), docEvents = new Map(), canvasEvents = new Map(), elements = [], issued = [], pans = [], zooms = [], flings = [], glides = [], stops = [], layout = [];
  let menuOpen = false, menuTarget, menuActions, helpVisible = false, reportVisible = false;
  const canvas = { addEventListener: (t, f) => canvasEvents.set(t, f), setPointerCapture() {} };
  const view = { target: { x: 16, z: 16 }, zoom: 1, visibleUnit: () => true, unitHeight: () => 0,
    screenOf: (x, y, z) => [x * 10, z * 10 - y * 10], groundAt: (x, y) => ({ x: x / 10, z: y / 10 }), buildingAt: () => null,
    pan: (x, y) => { pans.push([x, y]); view.target.x += x / 10; view.target.z += y / 10; }, zoomAt: (...a) => zooms.push(a), zoomBy: (...a) => zooms.push(a), setMarker() {}, dispose() {}, setWorld() {},
  };
  const c = vm.createContext({
    MAP_LARGE, MAP_TOWN, large: false, expanded: false, townPick: undefined, // This fixture exercises the existing small-map controller.
    r109: enabled, r012: true, Gestures: class extends Gestures { constructor(a) { super(a, clock); } }, inSelectionRect,
    commandMenu: undefined, battleHint: undefined, document: { createElement: () => ({ id: '', hidden: false, style: {} }), body: { appendChild: el => elements.push(el) }, addEventListener: (t, f) => docEvents.set(t, f) },
    addEventListener: (t, f) => globalEvents.set(t, f), canvas, performance: { now: clock.now },
    view, w: createWorld(1944), selected: new Set(), phase: 'battle', fireMode: false, ammo: 'he', paused: false,
    battleAudio: undefined, syncBattleAudio() {}, // Preserve the original gesture assertions without an audio engine.
    hud: { update() { layout.push('hud'); } }, prodBar: { update() { layout.push('production'); } }, help: { visible: () => helpVisible }, reportView: { visible: () => reportVisible, hide() {} },
    fling: { stop() { stops.push('fling'); }, start: (...a) => flings.push(a) }, glide: { stop() { stops.push('glide'); }, start: (...a) => glides.push(a) }, dragV: { vx: 0, vy: 0, t: 0 }, lastTap: { id: 0, t: -1e9 },
    innerWidth: 412, innerHeight: 860, SIDE_PLAYER, SIDE_ENEMY, SUB, routeBattleOrder, bombardCommand, bombardTarget, issue: cmd => issued.push(json(cmd)), simT: () => 0, placeAt() {},
    initCommandMenu: a => { menuActions = a; return { open: t => { layout.push('menu'); menuOpen = true; menuTarget = { ...t }; }, close: () => { menuOpen = false; }, isOpen: () => menuOpen, contains: target => target === 'menu' }; },
  });
  vm.runInContext(plain.slice(plain.indexOf('const pointers ='), plain.indexOf('\nreset();')), c);
  const send = (name, e) => { if (name === 'pointerdown') docEvents.get(name)?.({ ...e, target: canvas }); canvasEvents.get(name)?.(e); if (name === 'pointerup') canvasEvents.get('lostpointercapture')?.(e); };
  return { c, clock, send, globalEvents, docEvents, canvasEvents, elements, issued, pans, zooms, flings, glides, stops, layout, menu: () => menuOpen, setHelp: x => { helpVisible = x; }, setReport: x => { reportVisible = x; },
    choose(ammo) { if (!menuOpen) return; menuOpen = false; menuActions.choose(ammo, menuTarget); },
  };
}
const groups = {
  box() {
    for (const [dx, dy] of [[20, 30], [20, -30], [-20, 30], [-20, -30]]) {
      const f = fixture(); f.g.down(point()); assert.equal(f.g.move(point(108, 200)), true); assert.equal(f.boxes.length, 0, '8px is still click');
      const end = point(100 + dx, 200 + dy); f.g.move(end); assert.equal(f.g.up(end), true);
      assert.deepEqual(f.selected, [{ left: Math.min(100, end.clientX), top: Math.min(200, end.clientY), right: Math.max(100, end.clientX), bottom: Math.max(200, end.clientY) }]);
      assert.equal(f.boxes.at(-1), null);
    }
    for (const distance of [0, 7.99, 8]) { const f = fixture(); f.g.down(point()); f.g.move(point(100 + distance)); assert.equal(f.g.up(point(100 + distance)), false); assert.equal(f.selected.length, 0); }
    const f = fixture(); f.g.down(point()); assert.equal(f.g.up(point(108.01)), true, 'final-up movement can complete box');
    const r = { left: 20, top: 30, right: 40, bottom: 50 };
    for (const [x, y] of [[20, 30], [40, 30], [20, 50], [40, 50]]) assert.equal(inSelectionRect(r, x, y), true, 'all edges inclusive');
    for (const [x, y] of [[19.99, 40], [40.01, 40], [30, 29.99], [30, 50.01]]) assert.equal(inSelectionRect(r, x, y), false);
  },
  gate() {
    for (const e of [point(100, 200, { shiftKey: false }), point(100, 200, { button: 2 }), point(100, 200, { pointerType: 'pen' })]) {
      const f = fixture(); f.g.down(e); assert.equal(f.g.move({ ...e, clientX: 120 }), false); assert.equal(f.g.up({ ...e, clientX: 120 }), false); assert.equal(f.selected.length, 0);
    }
    for (const e of [point(), touch()]) { const f = fixture(); f.enable(false); f.g.down(e); f.clock.advance(600); assert.equal(f.g.move({ ...e, clientX: 120 }), false); f.g.up(e); assert.equal(f.selected.length + f.holds.length, 0, 'build/inactive gate'); }
  },
  selection() {
    const w = { units: [
      { id: 1, side: SIDE_PLAYER, alive: true, x: 2 * SUB, z: 4 * SUB, roof: 2 },
      { id: 2, side: SIDE_PLAYER, alive: true, x: 3 * SUB, z: 4 * SUB, roof: 0 },
      { id: 3, side: SIDE_ENEMY, alive: true, x: 2 * SUB, z: 4 * SUB, roof: 2 },
      { id: 4, side: SIDE_PLAYER, alive: false, x: 2 * SUB, z: 4 * SUB, roof: 2 },
      { id: 5, side: SIDE_PLAYER, alive: true, x: 0, z: 0, roof: 0 },
    ] };
    const before = JSON.stringify(w), selected = new Set([5]), heights = [];
    const c = vm.createContext({ w, selected, SUB, SIDE_PLAYER, inSelectionRect, innerWidth: 412, innerHeight: 860, hud: { update() {} }, battleHint: 'x', view: { unitHeight: u => u.roof, screenOf: (x, y, z) => { heights.push(y); return [x * 10, z * 10 - y * 10]; } } });
    vm.runInContext(extract('selectInBox'), c);
    c.selectInBox({ left: 20, right: 20, top: 18.5, bottom: 18.5 });
    assert.deepEqual([...selected], [5, 1], 'alive friendly roof projection on inclusive edge; additive');
    assert.ok(heights.includes(2.15)); assert.equal(JSON.stringify(w), before, 'selection reads world only');
    c.selectInBox({ left: -100, right: -90, top: -100, bottom: -90 }); assert.deepEqual([...selected], [5, 1], 'empty box retains selection');
  },
  hold() {
    const f = fixture(); f.g.down(touch()); f.clock.advance(499); assert.equal(f.holds.length, 0, '499ms no menu');
    f.g.move(touch(108)); f.clock.advance(1); assert.deepEqual(f.holds, [[108, 200]], '500ms and 8px qualifies');
    f.clock.advance(1000); assert.equal(f.holds.length, 1, 'one hold only');
    const dismiss = f.dismissed(); assert.equal(f.g.up(touch(108)), true, 'release consumed'); assert.equal(f.dismissed(), dismiss, 'normal release leaves menu'); assert.equal(f.clock.pending(), 0);
    const early = fixture(); early.g.down(touch()); early.clock.advance(499); assert.equal(early.g.up(touch()), false); early.clock.advance(1); assert.equal(early.holds.length, 0);
  },
  pan() {
    const f = fixture(); f.g.down(touch()); assert.equal(f.g.move(touch(108.01)), false, '>8px passes original pan'); f.clock.advance(600); assert.equal(f.holds.length, 0, 'pan cancels timer'); assert.equal(f.g.up(touch(108.01)), false, 'pan keeps original release/fling');
    const h = fixture(); h.g.down(touch()); h.clock.advance(500); assert.equal(h.g.move(touch(109)), false); assert.equal(h.g.up(touch(109)), false, 'moving after menu returns to pan');
    const u = fixture(); u.g.down(touch()); assert.equal(u.g.up(touch(109)), true, 'up-only movement cannot accidentally tap');
    const m = mainFixture(); m.send('pointerdown', touch()); m.clock.advance(20); m.send('pointermove', touch(120)); m.send('pointerup', touch(120)); assert.equal(m.pans.length, 1); assert.equal(m.flings.length, 1); assert.equal(m.issued.length, 0);
  },
  pinch() {
    for (const opened of [false, true]) {
      const f = fixture(); f.g.down(touch()); f.clock.advance(opened ? 500 : 499); f.g.down(touch(160, 200, { pointerId: 2 }));
      assert.equal(f.g.move(touch(170, 200, { pointerId: 2 })), false, 'second pointer preserves pinch handling');
      assert.equal(f.g.up(touch()), true); assert.equal(f.g.up(touch(170, 200, { pointerId: 2 })), true, 'neither finger leaves tap');
      f.clock.advance(1000); assert.equal(f.holds.length, opened ? 1 : 0); assert.ok(f.dismissed() > 0);
      f.g.down(touch()); f.clock.advance(500); assert.equal(f.holds.length, opened ? 2 : 1, 'next independent gesture works');
    }
    const m = mainFixture(); m.send('pointerdown', touch()); m.clock.advance(300); m.send('pointerdown', touch(180, 200, { pointerId: 2 })); m.send('pointermove', touch(190, 200, { pointerId: 2 })); m.send('pointerup', touch()); m.send('pointerup', touch(190, 200, { pointerId: 2 })); m.clock.advance(500); assert.equal(m.zooms.length, 1); assert.equal(m.issued.length, 0); assert.equal(m.menu(), false);
  },
  cancel() {
    for (const elapsed of [0, 499, 500]) {
      const f = fixture(); f.g.down(touch()); f.clock.advance(elapsed); f.g.cancel(); const n = f.holds.length;
      f.clock.advance(1000); assert.equal(f.holds.length, n, 'canceled timer cannot open later'); assert.equal(f.clock.pending(), 0); assert.equal(f.boxes.at(-1), null);
    }
    const b = fixture(); b.g.down(point()); b.g.move(point(120)); b.g.cancel(); b.g.up(point(120)); assert.equal(b.selected.length, 0, 'canceled box cannot select');
    const f = fixture(); f.g.down(touch()); f.enable(false); f.clock.advance(500); assert.equal(f.holds.length, 0, 'revalidate phase when timer fires');
  },
  resume() {
    const results = [];
    for (const enabled of [false, true]) {
      const m = mainFixture(enabled);
      m.send('pointerdown', touch()); m.clock.advance(20);
      m.send('pointerdown', touch(180, 200, { pointerId: 2 }));
      m.send('pointermove', touch(190, 200, { pointerId: 2 }));
      m.send('pointerup', touch()); m.clock.advance(20);
      m.send('pointermove', touch(210, 200, { pointerId: 2 }));
      m.send('pointerup', touch(210, 200, { pointerId: 2 }));
      assert.deepEqual(m.issued, [], 'resumed pan does not issue an order');
      results.push({ pans: m.pans, zooms: m.zooms, flings: m.flings });
    }
    assert.deepEqual(results[1], results[0], 'pinch to single-finger pan preserves legacy inertia');
    assert(results[1].flings.length === 1 && Math.abs(results[1].flings[0][0] - 400) < 1e-8 && results[1].flings[0][1] === 0, 'fixture produces a real nonzero fling');
  },
  camera() {
    const b = mainFixture(); b.send('pointerdown', point()); const before = b.stops.filter(x => x === 'glide').length;
    b.send('pointermove', point(120)); assert.ok(b.stops.filter(x => x === 'glide').length > before, 'active box stops prior double-click glide');
    assert.equal(b.pans.length, 0);
    const h = mainFixture(); h.send('pointerdown', touch()); h.clock.advance(500); assert.ok(h.stops.includes('glide'), 'hold freezes the camera at activation');
  },
  geometry() {
    const m = mainFixture(); m.send('pointerdown', touch()); m.clock.advance(500);
    assert.deepEqual(m.layout.slice(-3), ['hud', 'production', 'menu'], 'menu measures final HUD and production layout');
  },
  compatibility() {
    for (const enabled of [true, false]) {
      const m = mainFixture(enabled), u = m.c.w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_TANK);
      const [x, y] = m.c.view.screenOf(u.x / SUB, 0.15, u.z / SUB);
      const e = point(x, y, { shiftKey: false });
      m.send('pointerdown', e); m.send('pointerup', e); assert.deepEqual([...m.c.selected], [u.id], 'normal click selects');
      m.clock.advance(100); m.send('pointerdown', e); m.send('pointerup', e); assert.equal(m.glides.length, 1, 'legacy double-click glide');
      const shift = { ...e, shiftKey: true }; m.send('pointerdown', shift); m.send('pointerup', shift); assert.equal(m.c.selected.size, 0, 'Shift-click toggles');
      m.c.selected.add(u.id); const right = point(200, 250, { button: 2, shiftKey: false }); m.send('pointerdown', right); m.send('pointerup', right); assert.equal(m.issued.length, 1, 'right click issues legacy order');
      const before = m.zooms.length; m.canvasEvents.get('wheel')({ clientX: 200, clientY: 250, deltaY: -1, preventDefault() {} }); assert.equal(m.zooms.length, before + 1, 'wheel stays zoom');
    }
  },
  dispatch() {
    const m = mainFixture(), gun = m.c.w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_HOWITZER); m.c.selected.add(gun.id);
    m.send('pointerdown', touch(200, 250)); m.clock.advance(500); assert.equal(m.menu(), true); assert.equal(m.issued.length, 0);
    m.send('pointerup', touch(200, 250)); assert.equal(m.issued.length, 0, 'opening and release issue nothing'); assert.equal(m.menu(), true, 'normal capture release leaves menu');
    m.choose('smoke'); assert.deepEqual(m.issued, [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], x: 20, z: 25, ammo: 'smoke' }]); assert.equal(m.c.ammo, 'he'); assert.equal(m.c.fireMode, false);
    m.choose('smoke'); assert.equal(m.issued.length, 1);
    m.send('pointerdown', touch(200, 250)); m.clock.advance(500); m.send('pointerup', touch(200, 250)); gun.alive = false; m.choose('he'); assert.equal(m.issued.length, 1); assert.match(m.c.battleHint, /先選取/);
    const b = mainFixture(); b.c.selected.add(gun.id); const before = { ...b.c.view.target }; b.send('pointerdown', point(40, 40)); b.send('pointermove', point(240, 240)); b.send('pointerup', point(240, 240)); assert.equal(b.pans.length + b.flings.length + b.issued.length, 0); assert.deepEqual(b.c.view.target, before);
  },
  lifecycle() {
    const normal = mainFixture(); normal.send('pointerdown', touch()); normal.clock.advance(500); normal.send('pointerup', touch()); assert.equal(normal.menu(), true, 'inactive lostcapture preserves opened menu');
    for (const event of ['pointercancel', 'lostpointercapture', 'Escape', 'blur', 'resize', 'hud']) {
      for (const elapsed of [499, 500]) {
        const m = mainFixture(); m.send('pointerdown', touch()); m.clock.advance(elapsed);
        if (event === 'Escape') m.globalEvents.get('keydown')({ key: 'Escape' });
        else if (event === 'hud') m.docEvents.get('pointerdown')({ ...touch(0, 0, { pointerId: 2 }), target: 'hud' });
        else if (event === 'blur' || event === 'resize') m.globalEvents.get(event)();
        else m.send(event, touch());
        m.clock.advance(1000); m.send('pointerup', touch()); assert.equal(m.menu(), false, `${event} closes/cancels`); assert.equal(m.issued.length, 0, `${event} no stale order`);
      }
    }
    const m = mainFixture(); m.send('pointerdown', touch()); m.clock.advance(500); m.send('pointerup', touch()); m.send('pointerdown', touch(220, 250)); m.clock.advance(700); m.send('pointerup', touch(220, 250)); assert.equal(m.menu(), false, 'outside canvas press dismisses without re-opening'); assert.equal(m.issued.length, 0);
  },
  reset() {
    const m = mainFixture();
    Object.assign(m.c, { seed: 1944, r006: false, r018: false, r019: false, r026: false, createWorld, fxOn: true, r004: false, r008: false, r009: false, r011: false, r014: false, r016: false, r107: true, r118: true, r104: true, q: new URLSearchParams(), newStats: () => ({}), ui() {}, BattleView: class { constructor() { return m.c.view; } } });
    vm.runInContext(extract('reset'), m.c);
    for (const elapsed of [499, 500]) { m.send('pointerdown', touch()); m.clock.advance(elapsed); m.c.reset(1944, false, false, false, false, false); m.clock.advance(1000); m.send('pointerup', touch()); assert.equal(m.menu(), false, 'reset/replay clears pending and open gestures'); assert.equal(m.issued.length, 0); }
    for (const name of ['runScript', 'playLog', 'playScript']) assert.match(plain.slice(plain.indexOf(`  ${name}:`), plain.indexOf(`  ${name}:`) + 200), /reset\(/, `${name} reuses reset cleanup`);
    assert.match(plain, /const help = initHelp\(\{ open: \(\) => \{ if \(r109\) clearGestureInput\(\)/);
    assert.match(plain, /if \(r109 && priorWinner < 0 && w\.winner >= 0\) clearGestureInput\(\)/);
    assert.match(plain, /since >= SLOWMO_MS\) \{ if \(r109\) clearGestureInput\(\)/);
  },
  valve() {
    const m = mainFixture(false); assert.equal(m.elements.length, 0, 'valve creates no new DOM'); m.send('pointerdown', point()); m.clock.advance(20); m.send('pointermove', point(120)); m.send('pointerup', point(120)); assert.equal(m.pans.length, 1, 'valve restores Shift-drag pan'); assert.equal(m.flings.length, 1);
    m.send('pointerdown', touch()); m.clock.advance(800); assert.equal(m.menu(), false); m.send('pointerup', touch());
    const b = mainFixture(); b.c.phase = 'build'; b.send('pointerdown', point()); b.send('pointermove', point(120)); b.send('pointerup', point(120)); assert.equal(b.pans.length, 1, 'build keeps pan'); b.send('pointerdown', touch()); b.clock.advance(600); assert.equal(b.menu(), false, 'build keeps old touch');
  },
};
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant].group !== name) continue;
  try { test(); console.log(`OK gestures: ${name}`); } catch (e) { console.error(`NG gestures: ${name}`); throw e; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8' });
  assert.equal(p.status, 1, `${name}: broken production source must fail\n${p.stdout}\n${p.stderr}`);
  assert.ok(p.stderr.includes(`NG gestures: ${m.group}`), `${name}: intended first red\n${p.stdout}\n${p.stderr}`);
  assert.ok(p.stderr.includes('AssertionError'), `${name}: failure must be an assertion, not setup/import error\n${p.stderr}`);
  console.log(`OK gestures mutation: ${name} → first red ${m.group} (exit ${p.status})`);
}
console.log('gestures: all OK (fake-clock/controller evidence; browser coverage is separate)');
