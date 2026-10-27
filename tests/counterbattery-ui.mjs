import { vehicleDurability } from '../src/ui/vehicleDurability.ts';
import { coverDurability } from '../src/ui/coverDurability.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
// R115: formal UI modules and Canvas/DOM recording fixtures. No browser/pixel claim.
// --mutations runs isolated production-source semantic negatives and verifies each first red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as world from '../src/sim/world.ts';
import { initProduction } from '../src/ui/production.ts';
const { createWorld, hashWorld, N, SUB, SIDE_PLAYER, SIDE_ENEMY } = world;
const paths = { ui: '../src/ui/counterbattery.ts', mini: '../src/ui/minimap.ts', hud: '../src/ui/hud.ts', main: '../src/main.ts', sim: '../src/sim/counterbattery.ts', valves: '../src/valves.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(new URL(path, import.meta.url), 'utf8')]));
const mutations = {
  wrong_projection: { group: 'projection', file: 'ui', from: '(area.z + circle[1] * area.rz) / SUB', to: '(area.z - circle[1] * area.rz) / SUB' },
  fixed_coarse: { group: 'projection', file: 'ui', from: 'const area = areas[i];', to: 'const area = { ...areas[i], rx: 8 * SUB, rz: 6 * SUB };' },
  fixed_fine: { group: 'projection', file: 'ui', from: 'const area = areas[i];', to: 'const area = { ...areas[i], rx: 2 * SUB, rz: 1.5 * SUB };' },
  low_samples: { group: 'projection', file: 'ui', from: 'COUNTERBATTERY_SEGMENTS = 40', to: 'COUNTERBATTERY_SEGMENTS = 20' },
  no_clip: { group: 'clipping', file: 'ui', from: 'ctx.closePath(); ctx.clip();', to: 'ctx.closePath();' },
  clamp_vertices: { group: 'clipping', file: 'ui', from: '(area.x + circle[0] * area.rx) / SUB', to: 'Math.max(0, Math.min(n, (area.x + circle[0] * area.rx) / SUB))' },
  faint_minimum: { group: 'minimum', file: 'ui', from: 'ctx.lineWidth = 1.5;', to: 'ctx.lineWidth = 0.4;' },
  solid_circle: { group: 'minimum', file: 'ui', from: 'ctx.setLineDash(DASH);', to: 'ctx.setLineDash([]);' },
  unlimited: { group: 'capacity', file: 'ui', from: ' && i < 8', to: '' },
  hidden_position: { group: 'public_only', file: 'ui', from: 'const area = areas[i];', to: 'const area = { ...areas[i], x: w.units[0].x };' },
  private_cell: { group: 'public_only', file: 'ui', from: 'const area = areas[i];', to: 'const area = { ...areas[i], x: w.counterbattery[0].cell * SUB };' },
  rng_write: { group: 'readonly', file: 'ui', from: '  if (!enabled) return;', to: '  if (!enabled) return; w.rng ^= 1;' },
  ignored_valve: { group: 'valves', file: 'ui', from: '  if (!enabled) return;', to: '  if (false) return;' },
  missed_paint: { group: 'minimap', file: 'mini', from: '    drawCounterbattery(ctx, w, counterbatteryProject, a.counterbattery !== false, w.n);', to: '' },
  stale_world: { group: 'refresh', file: 'mini', from: 'if (w !== baseWorld) baseDirty = true;', to: 'if (false) baseDirty = true;' },
  stale_expiry: { group: 'expiry', file: 'ui', from: 'counterbatteryAreasInto(w, SIDE_PLAYER, AREA_BUFFER);', to: 'counterbatteryAreasInto({ ...w, tick: 0 }, SIDE_PLAYER, AREA_BUFFER);' },
  overwrite_priority: { group: 'hud', file: 'hud', from: 's.hint === undefined && s.counterbatteryInfo', to: 's.counterbatteryInfo' },
  missing_refresh: { group: 'hint_refresh', file: 'main', from: 'lastCounterbatteryWorld = w; lastCounterbatteryInfo = counterbatteryInfo; hud?.update();', to: 'lastCounterbatteryWorld = w; lastCounterbatteryInfo = counterbatteryInfo;' },
  replay_identity: { group: 'replay_refresh', file: 'main', from: 'w !== lastCounterbatteryWorld || counterbatteryInfo !== lastCounterbatteryInfo', to: 'counterbatteryInfo !== lastCounterbatteryInfo' },
  disconnected_valve: { group: 'wiring', file: 'main', from: 'counterbattery: V.r115,', to: 'counterbattery: true,' },
  hidden_minimap_hint: { group: 'wiring', file: 'main', from: "counterbatteryInfo: counterbatteryHint(w, phase === 'battle' && V.r015 && V.r115)", to: "counterbatteryInfo: counterbatteryHint(w, phase === 'battle' && V.r115)" },
  absent_suffix: { group: 'layout', file: 'hud', from: "    if (s.hint === undefined && s.counterbatteryInfo) $('hint').textContent += `。${s.counterbatteryInfo}`;", to: '' },
  replaced_slot: { group: 'buffer_reuse', file: 'sim', from: 'projectArea(r, buffer.areas[buffer.count], zones);', to: 'buffer.areas[buffer.count] = projectArea(r, { x: 0, z: 0, rx: 0, rz: 0, level: 0 }, zones);' },
  stale_count: { group: 'buffer_reuse', file: 'sim', from: '  buffer.count = 0;', to: '  if (w.counterbattery?.length) buffer.count = 0;' },
  query_expiry: { group: 'has_query', file: 'sim', from: 'if (r.side === side && w.tick - r.last < COUNTERBATTERY_TTL) return true;', to: 'if (r.side === side && w.tick - r.last <= COUNTERBATTERY_TTL) return true;' },
  query_rng: { group: 'query_readonly', file: 'sim', from: 'export function hasCounterbattery(w: World, side: number): boolean {', to: 'export function hasCounterbattery(w: World, side: number): boolean { w.rng ^= 1;' },
  buffer_rng: { group: 'query_readonly', file: 'sim', from: '  buffer.count = 0;', to: '  buffer.count = 0; w.rng ^= 1;' },
  new_projection_tuple: { group: 'projection_reuse', file: 'mini', from: '  out[0] = g.w / 2', to: '  out = [0, 0]; out[0] = g.w / 2' },
  new_dash_array: { group: 'hotpath', file: 'ui', from: 'ctx.setLineDash(DASH);', to: 'ctx.setLineDash([3, 2]);' },
  query_filter: { group: 'hotpath', file: 'sim', from: 'export function hasCounterbattery(w: World, side: number): boolean {', to: 'export function hasCounterbattery(w: World, side: number): boolean { w.counterbattery?.filter(() => true);' },
  new_project_closure: { group: 'project_closure', file: 'mini', from: 'drawCounterbattery(ctx, w, counterbatteryProject, a.counterbattery !== false, w.n);', to: 'drawCounterbattery(ctx, w, (x, z) => counterbatteryProject(x, z), a.counterbattery !== false, w.n);' },
};
const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutant');
  assert.equal(sources[m.file].split(m.from).length - 1, 1, `${mutant}: unique production anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
function moduleURL(key, aliases = {}) {
  const base = new URL(paths[key], import.meta.url);
  return dataURL(stripTypeScriptTypes(sources[key]).replace(/from '([^']+)'/g, (_, spec) => `from '${aliases[spec] ?? new URL(spec, base).href}'`));
}
const simURL = moduleURL('sim');
const { counterbatteryAreas, counterbatteryAreasInto, hasCounterbattery, COUNTERBATTERY_TTL } = await import(simURL);
const uiURL = moduleURL('ui', { '../sim/counterbattery.ts': simURL }), { drawCounterbattery, counterbatteryHint } = await import(uiURL);
const { initMinimap, miniGeo, toMini } = await import(moduleURL('mini', { './counterbattery.ts': uiURL }));
const { initHud } = await import(moduleURL('hud'));
const plain = stripTypeScriptTypes(sources.main);
// R060：閥從閥表來；fixture 可以蓋掉個別閥
const { valves } = await import(moduleURL('valves'));
const fixtureValves = (q, over = {}) => Object.defineProperties(valves(q), Object.fromEntries(Object.entries(over).map(([k, value]) => [k, { value, writable: true }])));
const INFO = '小地圖橙虛線：疑似敵砲，非精確位置';
const makeBuffer = () => ({ areas: Array.from({ length: 8 }, () => ({ x: 0, z: 0, rx: 0, rz: 0, level: 0 })), count: 0 });
const publicStubURL = dataURL(`export const hasCounterbattery = (w, side) => globalThis.__r115PublicAreas(side).length > 0;
export function counterbatteryAreasInto(w, side, buffer) {
  const publicAreas = globalThis.__r115PublicAreas(side);
  buffer.count = publicAreas.length;
  for (let i = 0; i < publicAreas.length; i++) buffer.areas[i] = publicAreas[i];
}`);
function fixtureWorld(level = 1) {
  const w = createWorld(1944); w.tick = 100;
  w.counterbattery = [{ side: SIDE_PLAYER, zone: 5, cell: 6, shots: level, last: 100 }];
  return w;
}
class Context {
  constructor() { this.log = []; this.stack = []; this.reset(); }
  reset() { this.path = []; this.state = { strokeStyle: '#000', lineWidth: 1, lineJoin: 'miter', dash: [], clip: null }; }
  get strokeStyle() { return this.state.strokeStyle; } set strokeStyle(value) { this.state.strokeStyle = value; }
  get lineWidth() { return this.state.lineWidth; } set lineWidth(value) { this.state.lineWidth = value; }
  get lineJoin() { return this.state.lineJoin; } set lineJoin(value) { this.state.lineJoin = value; }
  save() { this.stack.push(structuredClone(this.state)); this.log.push({ op: 'save' }); }
  restore() { this.state = this.stack.pop(); this.log.push({ op: 'restore' }); }
  beginPath() { this.path = []; }
  moveTo(x, y) { this.path.push([x, y]); }
  lineTo(x, y) { this.path.push([x, y]); }
  closePath() { this.closed = true; }
  clip() { this.state.clip = structuredClone(this.path); this.log.push({ op: 'clip', path: structuredClone(this.path) }); }
  setLineDash(dash) { this.state.dash = [...dash]; }
  stroke() { this.log.push({ op: 'stroke', path: structuredClone(this.path), closed: this.closed, ...structuredClone(this.state) }); }
  fill() {}
  fillRect(...rect) { this.log.push({ op: 'dot', rect, fillStyle: this.fillStyle, ...structuredClone(this.state) }); }
  drawImage() { this.log.push({ op: 'base' }); }
  setTransform(...matrix) { this.log.push({ op: 'transform', matrix }); }
  clearRect() {}
}
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = new Map(); this.events = new Map(); this.style = {}; this.attrs = new Map();
    this.text = ''; this.writes = 0; this.top = 800; this.rectReads = 0; this.hidden = false;
    this.classList = { toggle() {} }; if (tag === 'canvas') this.context = new Context();
  }
  set innerHTML(html) { for (const match of html.matchAll(/id="([^"]+)"/g)) { const el = new Element(); el.id = match[1]; this.children.set(el.id, el); } const prog = this.children.get('pb-prog'); if (prog) prog.firstElementChild = new Element(); }
  set textContent(text) { this.text = text; this.writes++; }
  get textContent() { return this.text; }
  querySelector(selector) { return this.children.get(selector.slice(1)) ?? null; }
  appendChild(el) { this.children.set(el.id, el); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getContext() { return this.context; }
  set width(value) { this._width = value; this.context?.reset(); }
  get width() { return this._width; }
  getBoundingClientRect() { this.rectReads++; return { left: 10, top: this.tag === 'canvas' ? 20 : this.top, width: parseFloat(this.style.width || '0'), height: parseFloat(this.style.height || '0') }; }
}
function dom(width = 412, dpr = 1) {
  const body = new Element();
  const lookup = (root, id) => root.id === id ? root : [...root.children.values()].map(el => lookup(el, id)).find(Boolean);
  const document = { body, createElement: tag => new Element(tag), getElementById: id => lookup(body, id) ?? null };
  Object.assign(globalThis, { document, innerWidth: width, innerHeight: 860, devicePixelRatio: dpr });
  return document;
}
const strokes = ctx => ctx.log.filter(op => op.op === 'stroke' && op.strokeStyle === '#ffb54a');
function draw(w, width = 150, enabled = true) {
  const ctx = new Context(), g = miniGeo(width);
  drawCounterbattery(ctx, w, (x, z) => toMini(g, x, z), enabled); return ctx;
}
const expectedPoint = (width, x, z) => [width / 2 + (x - z) * width / (2 * N), (x + z) * width / (4 * N)];
function close(actual, expected, label) { assert.equal(actual.length, expected.length, label); actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-8, `${label}: ${actual} != ${expected}`)); }
function bounds(path) { return [Math.max(...path.map(p => p[0])) - Math.min(...path.map(p => p[0])), Math.max(...path.map(p => p[1])) - Math.min(...path.map(p => p[1]))]; }
function miniFixture({ w = fixtureWorld(), width = 412, dpr = 1, enabled } = {}) {
  dom(width, dpr); let current = w; const taps = [];
  const mini = initMinimap({ world: () => current, visible: () => false, view: () => [[10, 10], [20, 10], [20, 20], [10, 20]], tap: (...xy) => taps.push(xy), ...(enabled === undefined ? {} : { counterbattery: enabled }) });
  return { mini, ctx: mini.el.context, taps, get w() { return current; }, set w(value) { current = value; } };
}
function section(start, end) { const a = plain.indexOf(start), b = plain.indexOf(end, a + start.length); assert(a >= 0 && b > a, 'main source boundary'); return plain.slice(a, b); }
function mainFixture(query = '', w = fixtureWorld()) {
  const document = dom(); w.units = [];
  const metrics = { updates: 0, minimaps: 0 }; let actions;
  const q = new URLSearchParams(`${query}&noR135=1`);
  const c = vm.createContext({ ...world, reloadStatus, coverDurability, vehicleDurability, document, w, selected: new Set(), paused: true, phase: 'battle', speed: 1, fireMode: false, ammo: 'he', battleHint: undefined,
    battleAudio: undefined, syncBattleAudio() {}, // R117 stays outside this counterbattery-only fixture.
    V: fixtureValves(q, { r009: false, r010: true, r018: false, r012: false }), planner: { buildHint: '' }, BUILD_TIP: '布陣說明', q,
    view: { rangeInfo: '', visibleUnit: () => false }, counterbatteryHint, hud: undefined, minimap: undefined, lastCounterbatteryInfo: '', lastCounterbatteryWorld: undefined,
    initHud(a) { actions = a; const actual = initHud(a); return { frame: actual.frame, update() { metrics.updates++; actual.update(); } }; },
    initMinimap(a) { c.miniActions = a; metrics.minimaps++; return {}; },
  });
  vm.runInContext(section('hud = initHud({', '\nreportView = initReportView'), c);
  vm.runInContext(section('if (V.r015) minimap = initMinimap({', '\nconst help = '), c);
  const frameSource = section('  const counterbatteryInfo = ', '\n  view.render(');
  return { c, document, metrics, actions, hint: () => document.getElementById('hint'), refresh: () => vm.runInContext(`{${frameSource}}`, c) };
}
const groups = {
  projection() {
    const expected = [[12, 12, 8, 6], [14, 10, 4, 3], [13, 11, 2, 1.5]];
    for (const width of [150, 200]) for (let level = 1; level <= 3; level++) {
      const ctx = draw(fixtureWorld(level), width), paths = strokes(ctx);
      assert.equal(paths.length, 1, 'projection: one report is one ellipse');
      const path = paths[0].path, [x, z, rx, rz] = expected[level - 1];
      assert.equal(path.length, 40, 'projection: fixed 40 world samples at every size and level');
      for (let j = 0; j < 40; j++) {
        const angle = j * Math.PI / 20;
        close(path[j], expectedPoint(width, x + rx * Math.cos(angle), z + rz * Math.sin(angle)), 'projection: every sample passes through the oblique map transform');
      }
      const [cx, cy] = expectedPoint(width, x, z);
      const covariance = path.reduce((sum, [px, py]) => sum + (px - cx) * (py - cy), 0);
      assert(covariance > 0, 'projection: anisotropic world ellipse remains slanted on the map');
    }
  },
  clipping() {
    const w = fixtureWorld(); w.counterbattery[0].zone = 0; w.counterbattery[0].cell = 0;
    const ctx = draw(w), path = strokes(ctx)[0], diamond = [[75, 0], [150, 37.5], [75, 75], [0, 37.5]];
    assert.deepEqual(path.clip, diamond, 'clipping: the complete four-corner map diamond clips every ring');
    assert.equal(ctx.log.filter(op => op.op === 'clip').length, 1, 'clipping: one shared clip precedes all rings');
    const expected = expectedPoint(150, -4, 4);
    close(path.path[20], expected, 'clipping: outside vertex retains world ellipse position instead of clamping to map');
    assert(path.path.some(([px, py]) => Math.abs((px - 75) / 75) + Math.abs((py - 37.5) / 37.5) > 1), 'clipping: fixture actually crosses the map diamond');
    assert.equal(ctx.state.clip, null, 'clipping: save/restore releases the clip for original dots and camera');
    assert.deepEqual(ctx.state.dash, [], 'clipping: save/restore releases dash state');
  },
  minimum() {
    const path = strokes(draw(fixtureWorld(3)))[0], [width, height] = bounds(path.path);
    assert(width >= 11.5 && width <= 12 && height >= 5.7 && height <= 6, 'minimum: phone third-level footprint retains the full projected uncertainty ellipse');
    assert(path.lineWidth >= 1.25 && path.lineWidth <= 2, 'minimum: phone stroke has a visible CSS-pixel width');
    assert.deepEqual(path.dash, [3, 2], 'minimum: short orange dashes remain dashed on the smallest circle');
    assert.equal(path.closed, true, 'minimum: each ellipse is closed');
  },
  async capacity() {
    const w = fixtureWorld(); w.counterbattery = Array.from({ length: 16 }, (_, zone) => ({ side: 0, zone, cell: 0, shots: 1 + zone % 3, last: w.tick }));
    const result = strokes(draw(w));
    assert.equal(result.length, 8, 'capacity: defensive drawing cap remains eight even for a malformed oversized world');
    assert.equal(result.reduce((sum, stroke) => sum + stroke.path.length, 0), 320, 'capacity: maximal drawing has bounded fixed sampling cost');
    globalThis.__r115PublicAreas = () => counterbatteryAreas(w, SIDE_PLAYER);
    const publicUI = await import(moduleURL('ui', { '../sim/counterbattery.ts': publicStubURL }));
    const ctx = new Context(); publicUI.drawCounterbattery(ctx, w, (x, z) => toMini(miniGeo(150), x, z));
    assert.equal(strokes(ctx).length, 8, 'capacity: renderer independently caps an oversized public API response');
    delete globalThis.__r115PublicAreas;
  },
  async public_only() {
    const original = fixtureWorld(2), areas = counterbatteryAreas(original, SIDE_PLAYER);
    globalThis.__r115PublicAreas = side => { assert.equal(side, SIDE_PLAYER, 'public_only: asks for only the player projection'); return structuredClone(areas); };
    const publicUI = await import(moduleURL('ui', { '../sim/counterbattery.ts': publicStubURL }));
    const forbidden = new Proxy({}, { get(_target, key) { throw Error(`UI read private world field: ${String(key)}`); }, set() { throw Error('UI wrote world'); } });
    const ctx = new Context();
    assert.doesNotThrow(() => publicUI.drawCounterbattery(ctx, forbidden, (x, z) => toMini(miniGeo(150), x, z)), 'public_only: renderer only uses the public API, never reports or hidden units');
    assert.equal(publicUI.counterbatteryHint(forbidden), INFO, 'public_only: hint only asks the same public API');
    assert.deepEqual(strokes(ctx), strokes(draw(original)), 'public_only: public projection alone determines every rendered coordinate');
    const live = fixtureWorld(2); const before = strokes(draw(live));
    for (const u of live.units) { u.x = 0; u.z = 0; u.alive = false; }
    assert.deepEqual(strokes(draw(live)), before, 'public_only: hidden motion and death do not move or erase the report');
    delete globalThis.__r115PublicAreas;
  },
  readonly() {
    const w = fixtureWorld(3), before = structuredClone(w), hash = hashWorld(w);
    for (let i = 0; i < 120; i++) {
      draw(w, i % 2 ? 150 : 200, i % 3 !== 0); counterbatteryHint(w, i % 3 !== 0);
      assert.deepEqual(w, before, 'readonly: each individual render and hint preserves complete world and RNG');
    }
    assert.deepEqual(w, before, 'readonly: repeated rendering and hints preserve complete world and RNG');
    assert.equal(hashWorld(w), hash, 'readonly: rendering frequency and valve never change hash');
    const f = miniFixture({ w }); f.mini.frame(1000); f.mini.frame(1100);
    assert.deepEqual(w, before, 'readonly: actual minimap frames preserve world and RNG too');
  },
  valves() {
    const w = fixtureWorld(); assert.equal(strokes(draw(w, 150, false)).length, 0, 'valves: false hides all new canvas paths');
    assert.equal(counterbatteryHint(w, false), '', 'valves: false removes the information hint');
    assert.equal(strokes(draw(w)).length, 1, 'valves: optional flag defaults on');
    const f = miniFixture({ enabled: false }); f.mini.frame(1000);
    assert.equal(strokes(f.ctx).length, 0, 'valves: minimap passes its disabled flag to formal draw helper');
    assert.equal(f.ctx.log.filter(op => op.op === 'dot').length, f.w.units.filter(u => u.alive && u.side === SIDE_PLAYER).length, 'valves: original friendly dots survive the new valve');
  },
  minimap() {
    for (const [width, dpr, cssW] of [[412, 2, 150], [1280, 1, 200]]) {
      const f = miniFixture({ width, dpr }); f.mini.frame(1000);
      assert.equal(strokes(f.ctx).length, 1, 'minimap: formal frame integrates the public report');
      assert.equal(f.mini.el.width, cssW * dpr, 'minimap: existing pixel width unchanged');
      assert.equal(f.mini.el.height, cssW * dpr / 2, 'minimap: existing pixel height unchanged');
      assert.equal(f.mini.el.style.width, `${cssW}px`, 'minimap: existing CSS width unchanged');
      const ops = f.ctx.log, ring = ops.findIndex(op => op.strokeStyle === '#ffb54a' && op.op === 'stroke'), dot = ops.findIndex(op => op.op === 'dot'), camera = ops.findIndex(op => op.op === 'stroke' && op.strokeStyle !== '#ffb54a');
      assert(ring > ops.findIndex(op => op.op === 'base') && dot > ring && camera > dot, 'minimap: order remains base, estimated areas, original dots, camera');
      assert.deepEqual(ops[camera].dash, [], 'minimap: original camera frame is solid');
      assert.equal(ops[dot].clip, null, 'minimap: circles do not impose clipping on original dots');
      const paints = ops.filter(op => op.op === 'base').length;
      f.mini.frame(1099); assert.equal(ops.filter(op => op.op === 'base').length, paints, 'minimap: existing 10Hz throttle remains');
      f.mini.frame(1100); assert.equal(ops.filter(op => op.op === 'base').length, paints + 1, 'minimap: paints again at 100ms');
      const point = f.mini.point(13, 19); let stopped = 0;
      f.mini.el.events.get('pointerdown')({ stopPropagation() { stopped++; } });
      f.mini.el.events.get('pointerup')({ clientX: point[0], clientY: point[1], stopPropagation() { stopped++; } });
      assert.deepEqual(f.taps, [[13, 19]], 'minimap: native point-to-world click still pans to the original location');
      assert.equal(stopped, 2, 'minimap: existing pointer propagation is unchanged');
      f.mini.el.events.get('pointerup')({ clientX: 10, clientY: 20, stopPropagation() {} });
      assert.equal(f.taps.length, 1, 'minimap: click outside diamond does not pan');
    }
  },
  refresh() {
    const f = miniFixture(); f.mini.frame(1000); const old = f.w, fresh = createWorld(1945); fresh.tick = old.tick;
    f.ctx.log = []; f.w = fresh; f.mini.frame(1001);
    assert.equal(f.ctx.log.filter(op => op.op === 'base').length, 1, 'refresh: same-tick paused replacement bypasses previous-world throttle');
    assert.equal(strokes(f.ctx).length, 0, 'refresh: legacy or reset world removes old reports immediately');
    f.ctx.log = []; f.w = structuredClone(old); f.mini.frame(1002);
    assert.equal(strokes(f.ctx).length, 1, 'refresh: cloned replay world refreshes immediately at the same tick');
    f.ctx.log = []; f.w.counterbattery = []; f.mini.dirty(); f.mini.frame(1003);
    assert.equal(strokes(f.ctx).length, 0, 'refresh: explicit dirty frame clears removed intelligence immediately');
  },
  expiry() {
    const w = fixtureWorld(); w.tick += COUNTERBATTERY_TTL - 1;
    assert.equal(strokes(draw(w)).length, 1, 'expiry: estimate remains until the last live simulation tick');
    assert.equal(counterbatteryHint(w), INFO, 'expiry: live estimate has its hint');
    w.tick++;
    assert.equal(strokes(draw(w)).length, 0, 'expiry: expired reports cannot leave a canvas ring');
    assert.equal(counterbatteryHint(w), '', 'expiry: expiry clears hint even before the stale storage is pruned');
    delete w.counterbattery; assert.equal(strokes(draw(w)).length, 0, 'expiry: pre-R115 worlds have no ring');
  },
  hud() {
    const document = dom(), state = { tick: 100, paused: true, speed: 1, fireMode: false, winner: -1, mine: 1, theirs: 0, tanks: 0, guns: 1, observers: 0, info: '原資訊', rangeInfo: '原射程', counterbatteryInfo: INFO };
    const hud = initHud({ state: () => state, togglePause() {}, cycleSpeed() {}, toggleFire() {}, toggleAmmo() {}, selectAll() {}, restart() {} });
    const hint = document.getElementById('hint');
    assert(hint.textContent.startsWith('原資訊。已選'), 'hud: existing selection information stays first');
    assert(hint.textContent.endsWith(`。原射程。${INFO}`), 'hud: estimate explanation follows existing range information');
    for (const high of ['長按選單優先提示', '']) { state.hint = high; hud.update(); assert.equal(hint.textContent, high, 'hud: any defined priority hint suppresses all appended intelligence'); }
    state.hint = undefined; state.counterbatteryInfo = ''; hud.update();
    assert(!hint.textContent.includes(INFO) && hint.textContent.endsWith('。原射程'), 'hud: disabled or absent reports leave previous range information unchanged');
  },
  hint_refresh() {
    const w = createWorld(1944); w.tick = 100; const f = mainFixture('', w); f.refresh();
    assert(!f.hint().textContent.includes(INFO), 'hint_refresh: no report starts without explanation');
    f.c.w.counterbattery = fixtureWorld().counterbattery; f.refresh();
    assert(f.hint().textContent.includes(INFO), 'hint_refresh: new report immediately refreshes a paused same-second HUD');
    const updates = f.metrics.updates, writes = f.hint().writes;
    for (let i = 0; i < 120; i++) f.refresh();
    assert.equal(f.metrics.updates, updates, 'hint_refresh: stable paused intelligence adds no update calls');
    assert.equal(f.hint().writes, writes, 'hint_refresh: stable intelligence adds no text writes');
    const replacement = createWorld(1945); replacement.tick = w.tick; replacement.units = []; f.c.w = replacement; f.refresh();
    assert(!f.hint().textContent.includes(INFO), 'hint_refresh: same-tick new world immediately clears stale explanation');
    f.c.w = fixtureWorld(); f.c.w.units = []; f.refresh(); assert(f.hint().textContent.includes(INFO), 'hint_refresh: replay with report restores explanation');
    f.c.battleHint = '長按提示'; f.c.hud.update(); f.c.w.tick += COUNTERBATTERY_TTL; f.refresh();
    assert.equal(f.hint().textContent, '長按提示', 'hint_refresh: automatic expiry never overrides a higher-priority hint');
  },
  wiring() {
    for (const query of ['', 'noR115=1', 'noR015=1', 'noR115=1&noR015=1']) {
      const f = mainFixture(query), on = !query; f.refresh();
      assert.equal(f.hint().textContent.includes(INFO), on, 'wiring: main gates hint on both minimap and intelligence flags');
      assert.equal(f.metrics.minimaps, query.includes('noR015') ? 0 : 1, 'wiring: existing noR015 still disables the whole minimap');
      if (f.c.miniActions) assert.equal(f.c.miniActions.counterbattery, !query.includes('noR115'), 'wiring: main passes the real noR115 flag to minimap');
      f.c.phase = 'build'; f.c.hud.update(); assert.equal(f.actions.state().counterbatteryInfo, '', 'wiring: build phase never advertises battle intelligence');
      assert.equal(f.hint().textContent, '布陣說明', 'wiring: build instructions keep priority');
    }
  },
  replay_refresh() {
    const f = mainFixture(); f.c.w.tick = 600; f.c.w.counterbattery[0].last = 600;
    f.refresh(); f.c.hud.frame(); assert(f.hint().textContent.includes(INFO), 'replay_refresh: original paused replay has intelligence');
    const replay = createWorld(1944); replay.tick = 0; replay.units = [];
    f.c.w = replay; f.c.hud.update();
    assert(!f.hint().textContent.includes(INFO), 'replay_refresh: reset synchronously clears old hint before replay runs');
    replay.tick = 600; replay.counterbattery = [{ side: 0, zone: 5, cell: 6, shots: 1, last: 600 }];
    f.refresh(); f.c.hud.frame();
    assert(f.hint().textContent.includes(INFO), 'replay_refresh: replacement world restores identical intelligence even at the same paused tick and second');
  },
  layout() {
    const w = createWorld(1944); w.tick = 100; const f = mainFixture('', w), hint = f.hint(); f.refresh();
    const prod = initProduction([{ kind: 0, label: '坦克', cost: 80 }], { state: () => ({ visible: true, supply: 100, queue: [], prog: 0, progMax: 1, queueMax: 5 }), produce() {} });
    const bar = f.document.getElementById('prodbar'); assert.equal(bar.style.bottom, '66px', 'layout: original short hint uses existing R111 six-pixel clearance');
    f.c.w.counterbattery = fixtureWorld().counterbattery; f.refresh(); hint.top = 730; const reads = hint.rectReads; prod.update();
    assert(hint.textContent.includes(INFO), 'layout: the actual intelligence suffix reaches the existing measured hint element');
    assert.equal(bar.style.bottom, '136px', 'layout: R111 remeasures changed intelligence text and moves production above it');
    assert.equal(hint.rectReads, reads + 1, 'layout: changed hint has one synchronous measurement');
    prod.update(); assert.equal(hint.rectReads, reads + 1, 'layout: stable suffix reuses original R111 cache');
    delete f.c.w.counterbattery; f.refresh(); hint.top = 800; prod.update();
    assert.equal(bar.style.bottom, '66px', 'layout: removing intelligence restores original production position');
  },
  buffer_reuse() {
    const buffer = makeBuffer(), array = buffer.areas, slots = [...buffer.areas], w = fixtureWorld();
    for (const count of [8, 3, 0, 1, 8]) {
      w.counterbattery = Array.from({ length: count }, (_, i) => ({ side: 0, zone: count - i - 1, cell: i, shots: 1 + i % 3, last: 100 }));
      const expected = counterbatteryAreas(w, 0);
      counterbatteryAreasInto(w, 0, buffer);
      assert.equal(buffer.areas, array, 'buffer_reuse: projection retains the fixed array identity');
      assert.equal(buffer.areas.length, 8, 'buffer_reuse: fixed array never shrinks or grows');
      assert.equal(buffer.count, count, 'buffer_reuse: count precisely follows live reports without stale slots');
      for (let i = 0; i < 8; i++) assert.equal(buffer.areas[i], slots[i], 'buffer_reuse: each public projection slot is reused');
      assert.deepEqual(buffer.areas.slice(0, buffer.count), expected, 'buffer_reuse: sorted buffered projection equals the existing allocating API');
    }
    delete w.counterbattery; counterbatteryAreasInto(w, 0, buffer);
    assert.equal(buffer.count, 0, 'buffer_reuse: a legacy replacement world clears the active count');
    assert.equal(buffer.areas, array, 'buffer_reuse: empty world still preserves storage identity');
  },
  has_query() {
    const w = fixtureWorld();
    for (const delta of [0, COUNTERBATTERY_TTL - 1, COUNTERBATTERY_TTL, COUNTERBATTERY_TTL + 1]) for (const side of [0, 1]) {
      w.tick = 100 + delta;
      assert.equal(hasCounterbattery(w, side), counterbatteryAreas(w, side).length > 0, 'has_query: allocation-free boolean equals the public projection including exact expiry');
    }
    delete w.counterbattery; assert.equal(hasCounterbattery(w, 0), false, 'has_query: legacy worlds have no information');
    w.counterbattery = []; assert.equal(hasCounterbattery(w, 0), false, 'has_query: empty worlds have no information');
  },
  query_readonly() {
    const w = fixtureWorld(), buffer = makeBuffer(), before = structuredClone(w);
    for (let i = 0; i < 20; i++) {
      hasCounterbattery(w, i % 2);
      assert.deepEqual(w, before, 'query_readonly: each boolean query leaves complete world and RNG unchanged');
      counterbatteryAreasInto(w, i % 2, buffer);
      assert.deepEqual(w, before, 'query_readonly: each buffer query leaves complete world and RNG unchanged');
    }
    Object.defineProperty(w, 'units', { get() { throw Error('hidden units queried'); } });
    assert.doesNotThrow(() => { hasCounterbattery(w, 0); counterbatteryAreasInto(w, 0, buffer); }, 'query_readonly: both public APIs ignore hidden current units entirely');
    assert.deepEqual(Object.keys(buffer.areas[0]).sort(), ['level', 'rx', 'rz', 'x', 'z'], 'query_readonly: reused slots expose only current public geometry');
  },
  projection_reuse() {
    const out = [0, 0];
    for (const width of [150, 200]) for (let i = 0; i < 100; i++) {
      const x = i / 3, z = i / 4, result = toMini(miniGeo(width), x, z, out);
      assert.equal(result, out, 'projection_reuse: optional output tuple is reused at every sample');
      close(result, expectedPoint(width, x, z), 'projection_reuse: reused tuple retains original transform');
    }
    const g = miniGeo(150), a = toMini(g, 1, 2), b = toMini(g, 3, 4);
    assert.notEqual(a, b, 'projection_reuse: legacy three-argument callers retain separate tuples');
    close(a, expectedPoint(150, 1, 2), 'projection_reuse: later calls cannot change a previous legacy tuple');
  },
  hotpath() {
    const w = fixtureWorld(), point = [0, 0], g = miniGeo(150), project = (x, z) => toMini(g, x, z, point);
    let dash, changedDash = false, failure;
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, stroke() {}, setLineDash(value) { if (dash && dash !== value) changedDash = true; dash = value; } };
    const filter = Array.prototype.filter, map = Array.prototype.map, sort = Array.prototype.sort, iterator = Array.prototype[Symbol.iterator];
    try {
      Array.prototype.filter = Array.prototype.map = Array.prototype.sort = Array.prototype[Symbol.iterator] = () => { throw Error('allocating array operation on the new hot path'); };
      for (let i = 0; i < 20; i++) { counterbatteryHint(w); drawCounterbattery(ctx, w, project); }
    } catch (error) { failure = error; }
    finally { Array.prototype.filter = filter; Array.prototype.map = map; Array.prototype.sort = sort; Array.prototype[Symbol.iterator] = iterator; }
    assert.equal(failure, undefined, 'hotpath: repeated hints and drawing avoid allocating array operations and iterators');
    assert.equal(changedDash, false, 'hotpath: repeated drawing passes the same preallocated dash array');
    assert.deepEqual(dash, [3, 2], 'hotpath: reused dash retains its appearance');
  },
  async project_closure() {
    const document = dom(), projects = [], w = fixtureWorld();
    globalThis.__r115DrawSpy = (ctx, current, project, enabled) => { projects.push(project); drawCounterbattery(ctx, current, project, enabled); };
    const spy = dataURL('export const drawCounterbattery = (...args) => globalThis.__r115DrawSpy(...args);');
    const formal = await import(moduleURL('mini', { './counterbattery.ts': spy }));
    const mini = formal.initMinimap({ world: () => w, visible: () => false, view: () => [], tap() {} });
    mini.frame(1000); mini.frame(1100); globalThis.innerWidth = 1280; mini.dirty(); mini.frame(1200);
    assert.equal(projects.length, 3, 'project_closure: fixture exercises three actual minimap paints');
    assert(projects.every(project => project === projects[0]), 'project_closure: minimap creates its projection closure once across frames and resize');
    const a = projects[0](2, 3), b = projects[0](4, 5);
    assert.equal(a, b, 'project_closure: actual minimap projection also reuses one output tuple');
    assert.equal(document.getElementById('minimap'), mini.el, 'project_closure: real minimap initialization was executed');
    delete globalThis.__r115DrawSpy;
  },
};
const only = process.argv.find(arg => arg.startsWith('--group='))?.slice(8);
assert(!only || Object.hasOwn(groups, only), 'known group');
assert.deepEqual(new Set(Object.values(mutations).map(m => m.group)), new Set(Object.keys(groups)), 'every semantic group has an isolated production negative');
for (const [name, run] of Object.entries(groups)) if (!only || only === name) {
  try { await run(); console.log(`OK counterbattery-ui ${name}`); }
  catch (error) { console.error(`NG counterbattery-ui ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8', timeout: 10000 });
  assert.equal(p.status, 1, `${name}: broken formal source must exit 1\n${p.stdout}\n${p.stderr}`);
  const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
  assert(first?.includes(`${m.group}:`), `${name}: first red is its semantic assertion, not startup\n${p.stderr}`);
  assert(p.stderr.includes(`NG counterbattery-ui ${m.group}`), `${name}: intended group ran`);
  console.log(`RED counterbattery-ui ${name}: ${first}`);
}
console.log('counterbattery-ui: all requested groups OK (formal production code; recorded Canvas/DOM, not Chrome pixels)');
