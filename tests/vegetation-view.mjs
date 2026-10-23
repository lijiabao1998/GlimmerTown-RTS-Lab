// R116: actual merged geometry, BattleView/cache, minimap and HUD; Node is not a pixel test.
// --mutations isolates production mutants and requires the named semantic assertion as first red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as sim from '../src/sim/world.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { applyBuild, enemyPlan, BUILD_KINDS_24 } from '../src/sim/build.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from '../src/sim/script.ts';
import { initProduction } from '../src/ui/production.ts';
const { createWorld, hashWorld, N, idx, BK_COTTAGE, SIDE_PLAYER } = sim;
const paths = { render: '../src/render/vegetation.ts', battle: '../src/render/battle.ts', mini: '../src/ui/minimap.ts', hud: '../src/ui/hud.ts', main: '../src/main.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(new URL(p, import.meta.url), 'utf8')]));
const mutations = {
  omit_wood: { group: 'geometry', file: 'render', from: 'if (kind !== VEG_HEDGE && kind !== VEG_WOOD) continue;', to: 'if (kind !== VEG_HEDGE) continue;', message: 'geometry: both independently specified cell kinds produce geometry' },
  over_capacity: { group: 'capacity', file: 'render', from: 'x < w.n && cells < VEGETATION_MAX;', to: 'x < w.n;', message: 'capacity: even an overfull input draws at most 64 cells' },
  world_write: { group: 'readonly', file: 'render', from: 'const g = new Geo(); let cells = 0;', to: 'w.rng ^= 1; const g = new Geo(); let cells = 0;', message: 'readonly: full world including events and RNG remains unchanged' },
  ignore_valve: { group: 'valve', file: 'render', from: 'this.enabled = vegetation116;', to: 'this.enabled = true;', message: 'valve: off has no foliage scene objects or hint' },
  cast_shadow: { group: 'budget', file: 'render', from: 'this.mesh.castShadow = false;', to: 'this.mesh.castShadow = true;', message: 'budget: foliage adds exactly one draw call including the shadow pass' },
  stable_rebuild: { group: 'cache', file: 'render', from: 'this.world === w && this.state === w.vegetation && !changed', to: 'false', message: 'cache: stable sync and update preserve geometry identity and build count' },
  ignore_replacement: { group: 'replacement', file: 'render', from: 'this.world === w && this.state === w.vegetation && !changed', to: 'this.state === w.vegetation && !changed', message: 'replacement: a different preview world rebuilds even with the same state object' },
  ignore_activation: { group: 'activation', file: 'render', from: 'this.world === w && this.state === w.vegetation && !changed', to: 'this.world === w && !changed', message: 'activation: same world map command immediately activates geometry' },
  stale_map: { group: 'activation', file: 'battle', from: 'if (this.mapId !== this.w.map) this.setWorld(this.w, this.territory);', to: '', message: 'activation: recorded Rye map refreshes actual ground pixels in the same tick' },
  footprint_only: { group: 'build_replay', file: 'battle', from: 'for (let z = Math.max(0, b.z - 1); z < Math.min(this.n, b.z + b.d + 1); z++) for (let x = Math.max(0, b.x - 1); x < Math.min(this.n, b.x + b.w + 1); x++) this.paintCell(x, z);', to: 'for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) this.paintCell(x, z);', message: 'build_replay: native construction and recorded map/build replay have byte-identical ground including adjacent curbs' },
  stale_build: { group: 'construction', file: 'battle', from: 'townDirty = true; vegetationDirty = true;', to: 'townDirty = true;', message: 'construction: build event removes the cleared cell from geometry' },
  stale_clear: { group: 'clear', file: 'render', from: 'this.scene.remove(this.mesh);', to: '', message: 'clear: old world removes foliage from the actual scene' },
  absent_symbols: { group: 'minimap', file: 'mini', from: 'if (!b && foliage) {', to: 'if (false) {', message: 'minimap: hedge has the independent light-green line symbol' },
  mini_valve: { group: 'minimap_valve', file: 'mini', from: 'a.vegetation !== false ? vegetationAt(w, x, z) : 0', to: 'vegetationAt(w, x, z)', message: 'minimap_valve: display-only valve removes all foliage symbols' },
  mini_activation: { group: 'minimap_cache', file: 'mini', from: 'if (w === baseWorld && w.vegetation !== baseVegetation) baseDirty = true;', to: '', message: 'minimap_cache: map activation repaints inside the old 100ms throttle' },
  mini_dirty: { group: 'minimap_construction', file: 'mini', from: 'dirty: () => { baseDirty = true; }', to: 'dirty: () => {}', message: 'minimap_construction: cleared foliage disappears on the dirty frame' },
  hint_priority: { group: 'hud', file: 'hud', from: 's.hint === undefined && !sel && !s.fireMode && !s.rangeInfo && !s.counterbatteryInfo && s.vegetationInfo', to: 's.vegetationInfo', message: 'hud: explicit high-priority feedback is never altered' },
  absent_hint: { group: 'hud', file: 'render', from: "return this.cells ? VEGETATION_HINT : '';", to: "return '';", message: 'hud: active world exposes the concise traversable/LOS/half-cover explanation' },
  no_default: { group: 'main_setup', file: 'main', from: 'map = r026, vegetation = true)', to: 'map = r026, vegetation = false)', message: 'main_setup: default new village explicitly enables vegetation' },
  omit_log: { group: 'main_setup', file: 'main', from: '...(vegetation ? { vegetation: 1 } : {})', to: '...{}', message: 'main_setup: preview and command recording use the same optional setting' },
  legacy_on: { group: 'legacy_replay', file: 'main', from: 'reset(s, false, false, false, false, false);', to: 'reset(s, false, false, false, false, true);', message: 'legacy_replay: a legacy replay never gains vegetation state' },
};
const mutant = process.argv.find(s => s.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutant');
  assert.equal(sources[m.file].split(m.from).length - 1, 1, `${mutant}: unique mutation anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
function moduleURL(key, aliases = {}) {
  const base = new URL(paths[key], import.meta.url);
  const code = stripTypeScriptTypes(sources[key]).replace(/from '([^']+)'/g, (_, spec) => `from '${aliases[spec] ?? (spec.startsWith('.') ? new URL(spec, base).href : import.meta.resolve(spec))}'`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const renderURL = moduleURL('render');
const { vegetationGeometry, VegetationView, setVegetation, VEGETATION_HINT } = await import(renderURL);
const { BattleView } = await import(moduleURL('battle', { './vegetation.ts': renderURL }));
const { initMinimap } = await import(moduleURL('mini'));
const { initHud } = await import(moduleURL('hud'));
const plain = stripTypeScriptTypes(sources.main);
const sameBytes = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
function field(entries = [[8, 8, 1], [10, 8, 2]]) {
  const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.events = [];
  w.vegetation = { version: 1, cells: new Uint8Array(N * N) };
  for (const [x, z, kind] of entries) w.vegetation.cells[idx(x, z)] = kind;
  return w;
}
function view(w) { setVegetation(true); return new BattleView(w, false); }
function budget(v) {
  let calls = 0, triangles = 0;
  v.scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const count = o.isInstancedMesh ? o.count : 1; if (!count) return;
    const g = o.geometry, vertices = Math.min(g.drawRange.count, g.index?.count ?? g.attributes.position.count);
    if (!vertices) return;
    const passes = o.castShadow ? 2 : 1; calls += passes; triangles += count * vertices / 3 * passes;
  });
  return { calls, triangles };
}
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.style = {}; this.attrs = {}; this.children = new Map(); this.handlers = new Map(); this.hidden = false;
    this.textContent = ''; this.top = 800; this.rectReads = 0; this.paintCount = 0; this.drawCount = 0; this.ops = []; this.baseOps = [];
    this.classList = { toggle() {} };
    const el = this; let path = [];
    this.context = {
      fillStyle: '', strokeStyle: '', lineWidth: 0,
      setTransform() {}, clearRect() { el.paintCount++; el.ops = []; },
      beginPath() { path = []; }, moveTo(...p) { path.push(p); }, lineTo(...p) { path.push(p); }, closePath() {},
      fill() { el.ops.push({ op: 'fill', color: this.fillStyle, points: path.map(p => [...p]) }); },
      fillRect(...rect) { el.ops.push({ op: 'rect', color: this.fillStyle, rect }); },
      drawImage(base) { el.drawCount++; el.baseOps = base.ops.map(o => structuredClone(o)); }, stroke() {},
      save() {}, restore() {}, clip() {}, setLineDash() {},
    };
  }
  set innerHTML(s) { for (const m of s.matchAll(/id="([^"]+)"/g)) this.children.set(m[1], new Element()); }
  getContext() { return this.context; }
  querySelector(selector) { return this.children.get(selector.slice(1)); }
  appendChild(el) { this.children.set(el.id, el); }
  addEventListener(k, f) { this.handlers.set(k, f); }
  setAttribute(k, v) { this.attrs[k] = v; }
  getBoundingClientRect() { this.rectReads++; return { left: 0, top: this.top, right: 412, bottom: 860, width: 412, height: 860 - this.top }; }
  get firstElementChild() { return this.first ??= new Element(); }
}
function dom() {
  const body = new Element(), canvases = [];
  globalThis.innerWidth = 412; globalThis.innerHeight = 860; globalThis.devicePixelRatio = 1;
  globalThis.document = { body,
    createElement(tag) { const e = new Element(tag); if (tag === 'canvas') canvases.push(e); return e; },
    getElementById(id) { return body.children.get(id) ?? body.children.get('hud')?.children.get(id) ?? null; },
  };
  return { body, canvases };
}
function mini(w, enabled = true) {
  const d = dom(); let world = w;
  const m = initMinimap({ world: () => world, visible: () => false, view: () => [], tap() {}, vegetation: enabled });
  return { ...d, m, base: d.canvases[1], screen: d.canvases[0], replace(w) { world = w; } };
}
function mainFixture() {
  const mockView = () => ({ dispose() {}, setWorld() {}, vegetation116: { mesh: null, cells: 0, triangles: 0, builds: 0 } });
  const c = vm.createContext({ ...sim, applyMap, MAP_RYE, runLog, SCRIPT, SCRIPT_SEED, SCRIPT_TICKS, seed: 1944,
    r006: false, r018: false, r019: false, r026: false, r109: false, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true, r107: true,
    r116: false, r118: true, r104: true, fxOn: true, q: new URLSearchParams('noR116=1'),
    w: undefined, view: mockView(), selected: new Set(), log: [], pending: [], paused: true, phase: 'battle', window: {},
    battleAudio: undefined, syncBattleAudio() {}, // Explicit absent optional audio for extracted replay/reset code.
    newStats() { return {}; }, reportView: undefined, ui() {}, refreshPreview() {},
    issue(cmd) { c.log.push({ tick: c.w.tick, cmd }); c.pending.push(cmd); }, tick() { step(c.w, c.pending); c.pending = []; },
    BattleView: class { constructor() { return mockView(); } },
  });
  const a = plain.indexOf('function reset('), b = plain.indexOf('\nfunction ui()', a);
  vm.runInContext(plain.slice(a, b), c);
  vm.runInContext(plain.slice(plain.indexOf('const rts = {')), c);
  return c;
}
const groups = {
  geometry() {
    const w = field(), a = vegetationGeometry(w), h = vegetationGeometry(field([[8, 8, 1]])), t = vegetationGeometry(field([[10, 8, 2]]));
    assert.equal(a.cells, 2, 'geometry: both independently specified cell kinds produce geometry');
    assert.deepEqual([h.geometry.attributes.position.count / 3, t.geometry.attributes.position.count / 3], [30, 26], 'geometry: three low hedge lobes and two wood crowns have fixed independent topology');
    assert.equal(a.geometry.attributes.position.count / 3, 56);
    assert.deepEqual([...a.geometry.attributes.position.array], [...vegetationGeometry(w).geometry.attributes.position.array], 'geometry: same world produces byte-identical vertices');
    assert.deepEqual([...a.geometry.attributes.normal.array].every(Number.isFinite), true);
    for (const p of [a, h, t]) p.geometry.dispose();
  },
  capacity() {
    const w = field(); w.vegetation.cells.fill(1); w.vegetation.cells[0] = 0;
    const a = vegetationGeometry(w); assert.equal(a.cells, 64, 'capacity: even an overfull input draws at most 64 cells');
    assert.equal(a.geometry.attributes.position.count / 3, 1920, 'capacity: at most 64 times 30 triangles'); a.geometry.dispose();
  },
  readonly() {
    const w = field(); w.events = [{ e: 'build', bld: 1 }]; const before = structuredClone(w), hash = hashWorld(w);
    const v = view(w); v.update(0, 0, new Set()); v.vegetation116.sync(w); v.setWorld(structuredClone(w)); v.dispose();
    assert.deepEqual(w, before, 'readonly: full world including events and RNG remains unchanged'); assert.equal(hashWorld(w), hash);
  },
  valve() {
    const w = field(), before = structuredClone(w); setVegetation(false); const off = new BattleView(w, false);
    assert.equal(off.scene.children.filter(o => o.name === 'vegetation-r116').length + (off.vegetationInfo ? 1 : 0), 0, 'valve: off has no foliage scene objects or hint');
    const legacy = createWorld(1944); setVegetation(true); const oldOn = new BattleView(legacy, false); setVegetation(false); const oldOff = new BattleView(legacy, false);
    assert.equal(oldOn.scene.children.length, oldOff.scene.children.length, 'valve: old worlds have exactly the legacy scene count');
    assert.deepEqual([...oldOn.groundPx], [...oldOff.groundPx]); assert.deepEqual(w, before); off.dispose(); oldOn.dispose(); oldOff.dispose(); setVegetation(true);
  },
  budget() {
    for (const map of [0, 1]) {
      const w = createWorld(1944); applyMap(w, map, 1); const on = view(w); on.update(0, 0, new Set());
      setVegetation(false); const off = new BattleView(w, false); off.update(0, 0, new Set());
      const a = budget(on), b = budget(off);
      assert.equal(a.calls - b.calls, 1, 'budget: foliage adds exactly one draw call including the shadow pass');
      assert(a.calls <= 20 && a.triangles <= 80000, 'budget: opening structural scene stays within existing mobile budget');
      assert.equal(a.triangles - b.triangles, on.vegetation116.triangles);
      console.log(`  map ${map}: structural ${a.calls} calls / ${a.triangles} triangles; foliage ${on.vegetation116.cells} cells/${on.vegetation116.triangles} triangles`);
      on.dispose(); off.dispose();
    }
    setVegetation(true);
  },
  cache() {
    const w = field(), v = view(w), geometry = v.vegetation116.mesh.geometry, builds = v.vegetation116.builds;
    for (let i = 0; i < 50; i++) { v.vegetation116.sync(w); v.update(0, 0, new Set()); v.onEvents([], 0); }
    assert.deepEqual([v.vegetation116.mesh.geometry, v.vegetation116.builds], [geometry, builds], 'cache: stable sync and update preserve geometry identity and build count'); v.dispose();
  },
  replacement() {
    const w = field(), v = view(w), geometry = v.vegetation116.mesh.geometry, other = { ...w };
    let disposed = 0; geometry.addEventListener('dispose', () => disposed++); v.setWorld(other);
    assert.notEqual(v.vegetation116.mesh.geometry, geometry, 'replacement: a different preview world rebuilds even with the same state object');
    assert.equal(disposed, 1, 'replacement: superseded GPU geometry is disposed once'); v.dispose();
  },
  activation() {
    const w = createWorld(1944), v = view(w); assert.equal(v.vegetation116.mesh, null); applyMap(w, 0, 1); v.onEvents([], 0);
    assert(v.vegetation116.cells > 0, 'activation: same world map command immediately activates geometry'); v.dispose();
    const rye = createWorld(1944), replayView = view(rye); applyMap(rye, 1, 1); replayView.onEvents([], 0);
    const directView = view(rye);
    assert.equal(sameBytes(replayView.groundPx, directView.groundPx), true, 'activation: recorded Rye map refreshes actual ground pixels in the same tick');
    assert.equal(sameBytes(replayView.town.geometry.attributes.position.array, directView.town.geometry.attributes.position.array), true, 'activation: recorded Rye map and direct world have identical town vertices');
    assert.deepEqual([...replayView.vegetation116.mesh.geometry.attributes.position.array], [...directView.vegetation116.mesh.geometry.attributes.position.array]);
    replayView.dispose(); directView.dispose();
  },
  construction() {
    const w = field([[26, 26, 1], [24, 26, 2]]), v = view(w), preview = structuredClone(w), command = { t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x: 26, z: 26 };
    assert.equal(applyBuild(preview, command), null, 'construction fixture is legal'); v.setWorld(preview);
    assert.equal(v.vegetation116.cells, 1); assert.equal(w.vegetation.cells[idx(26, 26)], 1, 'construction: preview does not mutate original foliage');
    v.setWorld(w); assert.equal(v.vegetation116.cells, 2, 'construction: cancel preview restores foliage');
    applyBuild(w, command); v.onEvents(w.events, 0);
    assert.equal(v.vegetation116.cells, 1, 'construction: build event removes the cleared cell from geometry');
    assert(v.vegetation116.mesh !== v.town, 'construction: foliage never joins building picking geometry');
    const [cx, cy] = v.screenOf(24.5, 1.23, 26.5, 412, 860);
    assert.equal(v.buildingAt(cx, cy, 412, 860), null, 'construction: clicking a tree canopy does not select a nonexistent building'); v.dispose();
  },
  build_replay() {
    // Reproduce the real preview/start route and its same tick-0 map/build/eco log, with R016
    // disabled just as the browser replay comparison does. The enemy barn touches Rye roads.
    const native = createWorld(1944); applyMap(native, 1, 1); setVegetation(true);
    const makeView = w => new BattleView(w, true, true, true, true, true, true, true, true, false, true, true);
    const a = makeView(native), command = { t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x: 30, z: 12 };
    const preview = structuredClone(native); assert.equal(applyBuild(preview, command), null, 'build_replay: actual preview placement is legal');
    a.setWorld(preview, SIDE_PLAYER); a.setWorld(native, -1);
    const commands = [{ t: 'map', id: 1, vegetation: 1 }, command, ...enemyPlan(preview, BUILD_KINDS_24), { t: 'eco', inf: 1, guns: 1, tanks: 1 }];
    assert(commands.some(c => c.t === 'build' && c.side === 1 && c.x === 9 && c.z === 12), 'build_replay: fixed fixture includes the road-adjacent enemy barn');
    a.snapshot(); step(native, commands); a.onEvents(native.events, native.tick / 20);
    const replay = createWorld(1944), b = makeView(replay); b.snapshot(); step(replay, commands); b.onEvents(replay.events, replay.tick / 20);
    assert.equal(hashWorld(native), hashWorld(replay), 'build_replay: both construction routes produce the same complete world');
    assert.equal(sameBytes(a.groundPx, b.groundPx), true, 'build_replay: native construction and recorded map/build replay have byte-identical ground including adjacent curbs');
    for (const attribute of ['position', 'normal', 'color']) assert.equal(sameBytes(a.town.geometry.attributes[attribute].array, b.town.geometry.attributes[attribute].array), true, `build_replay: identical ${attribute} town buffers`);
    assert.equal(sameBytes(a.tracks, b.tracks), true, 'build_replay: neighboring repaint preserves the same vehicle tracks');
    assert.equal(sameBytes(a.vegetation116.mesh.geometry.attributes.position.array, b.vegetation116.mesh.geometry.attributes.position.array), true);
    a.dispose(); b.dispose();
    // Corner construction exercises both clamp edges; the repaint still uses the existing
    // paintCell implementation and never addresses outside the original N by N texture.
    for (const [x, z, side] of [[0, 0, 1], [N - 1, N - 1, 0]]) {
      const w = field([]), v = view(w), painted = [], paint = v.paintCell.bind(v);
      v.paintCell = (cx, cz) => { painted.push([cx, cz]); paint(cx, cz); };
      assert.equal(applyBuild(w, { t: 'build', side, kind: BK_COTTAGE, x, z }), null);
      v.onEvents(w.events, 0);
      assert.equal(painted.length, 4, 'build_replay: corner construction repaints only its bounded two-by-two area');
      assert(painted.every(([cx, cz]) => cx >= 0 && cz >= 0 && cx < N && cz < N), 'build_replay: bounded repaint never reads outside the map'); v.dispose();
    }
  },
  clear() {
    const w = field(), v = view(w); v.setWorld(createWorld(1944));
    assert.equal(v.scene.children.filter(o => o.name === 'vegetation-r116').length, 0, 'clear: old world removes foliage from the actual scene');
    assert.equal(v.vegetationInfo, ''); v.setWorld(w); assert.equal(v.vegetation116.cells, 2); v.dispose();
  },
  minimap() {
    const w = field(), before = structuredClone(w), f = mini(w); f.m.frame(0);
    assert.equal(f.base.ops.filter(o => o.op === 'rect' && o.color === '#c4cf80').length, 1, 'minimap: hedge has the independent light-green line symbol');
    assert.equal(f.base.ops.filter(o => o.op === 'fill' && o.color === '#314b30').length, 1, 'minimap: woodland has the independent dark-green diamond');
    assert.deepEqual(f.screen.baseOps, f.base.ops, 'minimap: visible canvas receives current foliage base'); assert.deepEqual(w, before);
  },
  minimap_valve() {
    const w = field(), f = mini(w, false); f.m.frame(0);
    assert.equal(f.base.ops.filter(o => o.color === '#c4cf80' || o.color === '#314b30').length, 0, 'minimap_valve: display-only valve removes all foliage symbols');
    assert.equal(f.base.ops.length, N * N); assert.equal(w.vegetation.cells[idx(8, 8)], 1);
  },
  minimap_cache() {
    const w = field(); delete w.vegetation; const f = mini(w); f.m.frame(0); w.vegetation = field().vegetation; f.m.frame(1);
    assert.equal(f.base.paintCount, 2, 'minimap_cache: map activation repaints inside the old 100ms throttle');
    f.m.frame(2); f.m.frame(101); assert.equal(f.base.paintCount, 2, 'minimap_cache: stable timestamp draws reuse foliage base');
    const old = createWorld(1944); f.replace(old); f.m.frame(102); assert.equal(f.base.ops.length, N * N, 'minimap_cache: same-frame old world has no stale symbols');
    f.replace(w); f.m.frame(103); assert(f.base.ops.some(o => o.color === '#314b30'));
  },
  minimap_construction() {
    const w = field(), f = mini(w); f.m.frame(0); w.vegetation.cells[idx(8, 8)] = 0; f.m.dirty(); f.m.frame(1);
    assert.equal(f.base.ops.filter(o => o.color === '#c4cf80').length, 0, 'minimap_construction: cleared foliage disappears on the dirty frame');
  },
  hud() {
    const v = view(field()); assert.equal(v.vegetationInfo, '樹籬／林地：可穿行、遮住穿越視線；林內承傷50%，掩護不疊加', 'hud: active world exposes the concise traversable/LOS/half-cover explanation');
    const d = dom(), state = { tick: 0, paused: true, speed: 1, fireMode: false, winner: -1, mine: 0, theirs: 0, tanks: 0, guns: 0, observers: 0, vegetationInfo: v.vegetationInfo };
    const hud = initHud({ state: () => state, togglePause() {}, cycleSpeed() {}, toggleFire() {}, toggleAmmo() {}, selectAll() {}, restart() {} });
    const hint = document.getElementById('hint'); assert(hint.textContent.endsWith(VEGETATION_HINT));
    for (const high of ['不能在這裡建造', '']) { state.hint = high; hud.update(); assert.equal(hint.textContent, high, 'hud: explicit high-priority feedback is never altered'); }
    state.hint = undefined;
    for (const [key, value] of [['fireMode', true], ['tanks', 1], ['rangeInfo', '射程'], ['counterbatteryInfo', '聲測']]) {
      state[key] = value; hud.update(); assert(!hint.textContent.includes(VEGETATION_HINT), `hud: ${key} retains priority`); delete state[key];
    }
    state.fireMode = false; state.tanks = 0; hud.update();
    state.vegetationInfo = ''; hud.update();
    const production = initProduction([], { state: () => ({ visible: true, supply: 100, queue: [], prog: 0, progMax: 0, queueMax: 5 }), produce() {} });
    state.vegetationInfo = v.vegetationInfo; hud.update(); hint.top = 712; production.update(); assert.equal(document.getElementById('prodbar').style.bottom, '154px', 'hud: existing production clearance follows taller foliage hint');
    state.vegetationInfo = ''; hud.update(); assert(!hint.textContent.includes(VEGETATION_HINT)); v.dispose();
  },
  main_setup() {
    const c = mainFixture(); c.reset();
    assert(c.w.vegetation, 'main_setup: default new village explicitly enables vegetation');
    assert.deepEqual(JSON.parse(JSON.stringify(c.log)), [{ tick: 0, cmd: { t: 'map', id: 0, vegetation: 1 } }], 'main_setup: preview and command recording use the same optional setting');
    const before = hashWorld(c.w), recorded = JSON.parse(JSON.stringify(c.log)), replay = createWorld(1944); c.tick(); runLog(replay, recorded, 1); assert.equal(hashWorld(c.w), hashWorld(replay));
    c.reset(1944, false, false, false, true); assert.equal(c.w.map, 1); assert.equal(c.log[0].cmd.vegetation, 1);
    c.reset(1944, false, false, false, false, false); assert.equal(c.w.vegetation, undefined); assert.equal(c.log.length, 0);
    c.reset(); assert.equal(hashWorld(c.w), before, 'main_setup: noR116 query never disables simulation');
  },
  legacy_replay() {
    const c = mainFixture(); c.window.__rts.playLog(1944, [], 0);
    assert.equal(c.w.vegetation, undefined, 'legacy_replay: a legacy replay never gains vegetation state');
    assert.equal(c.window.__rts.runScript(600), 'd7b3572f', 'legacy_replay: original six-hundred-tick complete hash remains frozen');
    assert.equal(c.window.__rts.playScript(600), 'd7b3572f');
    c.window.__rts.playLog(1944, [{ tick: 0, cmd: { t: 'map', id: 0, vegetation: 1 } }], 1); assert(c.w.vegetation, 'legacy_replay: explicit new recorded option activates on replay');
  },
};
const only = process.argv.find(s => s.startsWith('--group='))?.slice(8) ?? (mutant ? mutations[mutant].group : undefined);
for (const [name, run] of Object.entries(groups)) if (!only || name === only) {
  try { run(); console.log(`OK vegetation-view ${name}`); }
  catch (error) { console.error(`NG vegetation-view ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8', timeout: 10000 });
  assert.equal(p.status, 1, `${name}: isolated mutant must exit 1\n${p.stdout}\n${p.stderr}`);
  const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
  assert.equal(first, m.message, `${name}: first red must be intended semantic assertion, not startup\n${p.stderr}`);
  assert(p.stderr.includes(`NG vegetation-view ${m.group}`)); console.log(`RED vegetation-view ${name}: ${first}`);
}
console.log('vegetation-view: all requested groups OK; actual Chrome draw/raster verification is separate');
