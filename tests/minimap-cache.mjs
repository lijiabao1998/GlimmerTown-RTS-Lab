// R112: execute the actual minimap module against a counted DOM/canvas stub.
// Canvas calls/colors are observable here; real pixels and restart UI are browser tests.
// node tests/minimap-cache.mjs --mutations runs isolated semantic production mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, N, SUB, TER_GRASS, TER_ROAD, TER_FIELD, TER_MUD, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';

const sourceURL = new URL('../src/ui/minimap.ts', import.meta.url);
const source = fs.readFileSync(sourceURL, 'utf8');
const identityLine = '    if (w !== baseWorld) baseDirty = true;';
const mutations = {
  omit_first_paint: { group: 'initial', edits: [['if (baseDirty) paintBase(w);', 'if (baseDirty && t > 0) paintBase(w);']] },
  old_cache: { group: 'new_world', edits: [[identityLine, '    // World identity invalidation removed.']] },
  late_invalidation: { group: 'new_world', edits: [[identityLine, ''], ['    last = t;', `    last = t;\n${identityLine}`]] },
  seed_tick_key: { group: 'same_seed', edits: [[identityLine, '    if (!baseWorld || w.seed !== baseWorld.seed || w.tick !== baseWorld.tick) baseDirty = true;']] },
  already_seen_world: { group: 'return_old', edits: [
    ['  let baseWorld: World | undefined;', '  let baseWorld: World | undefined; const seen = new WeakSet<World>();'],
    [identityLine, '    if (w !== baseWorld && !seen.has(w)) baseDirty = true;'],
    ['    baseWorld = w;', '    baseWorld = w; seen.add(w);'],
  ] },
  repaint_every_frame: { group: 'stable', edits: [[identityLine, '    baseDirty = true;']] },
  forget_painted_world: { group: 'stable', edits: [['    baseWorld = w;', '    // Painted World was not recorded.']] },
  throttle_99ms: { group: 'throttle', edits: [['t - last < 100', 't - last < 99']] },
  throttle_101ms: { group: 'throttle', edits: [['t - last < 100', 't - last < 101']] },
  ignore_dirty: { group: 'dirty', edits: [['dirty: () => { baseDirty = true; }', 'dirty: () => {}']] },
  throttle_dirty: { group: 'dirty', edits: [['t - last < 100 && !baseDirty', 't - last < 100']] },
  ignore_resize: { group: 'resize_dpr', edits: [['innerWidth < 640 ? 150 : 200', '200']] },
  ignore_dpr: { group: 'resize_dpr', edits: [['g.w !== cssW || dpr !== Math.min(devicePixelRatio || 1, 2)', 'g.w !== cssW']] },
  base_refetch: { group: 'coherent', edits: [['if (baseDirty) paintBase(w);', 'if (baseDirty) paintBase(a.world());']] },
  dots_refetch: { group: 'coherent', edits: [['miniDots(w, a.visible)', 'miniDots(a.world(), a.visible)']] },
  mutate_rng: { group: 'readonly', edits: [['    const w = a.world();', '    const w = a.world(); w.rng++;']] },
  consume_events: { group: 'readonly', edits: [['    const w = a.world();', '    const w = a.world(); w.events.length = 0;']] },
  clone_each_frame: { group: 'readonly', edits: [['    const w = a.world();', '    const w = structuredClone(a.world());']] },
  tap_offset: { group: 'interaction', edits: [['e.clientX - r.left, e.clientY - r.top', 'e.clientX - r.left + 1, e.clientY - r.top']] },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
let initMinimap;
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutation');
  let broken = source;
  for (const [from, to] of m.edits) {
    assert.equal(broken.split(from).length - 1, 1, `${mutant}: unique production-source anchor`);
    broken = broken.replace(from, to);
  }
  // Keep the real World helpers: only this isolated production module is mutated.
  broken = stripTypeScriptTypes(broken).replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote, path) => `from ${JSON.stringify(new URL(path, sourceURL).href)}`);
  ({ initMinimap } = await import(`data:text/javascript;base64,${Buffer.from(broken).toString('base64')}`));
} else {
  ({ initMinimap } = await import(sourceURL.href));
}

class Canvas {
  constructor() {
    this.style = {}; this.events = new Map(); this.colors = []; this.drawn = []; this.dots = [];
    this.paints = 0; this.draws = 0; this.fills = 0; this.strokes = 0; this.resets = 0; this.transforms = [];
    this.rect = { left: 17, top: 29 }; this.rectReads = 0;
    const canvas = this;
    this.ctx = {
      setTransform(...values) { canvas.transforms.push(values); },
      clearRect() { canvas.paints++; canvas.colors = []; },
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { canvas.fills++; canvas.colors.push(this.fillStyle); },
      drawImage(base) { canvas.draws++; canvas.drawn = [...base.colors]; },
      fillRect(...values) { canvas.dots.push([this.fillStyle, ...values]); },
      stroke() { canvas.strokes++; },
    };
  }
  set width(value) { this.w = value; this.resets++; this.colors = []; this.dots = []; }
  get width() { return this.w; }
  set height(value) { this.h = value; this.resets++; this.colors = []; this.dots = []; }
  get height() { return this.h; }
  getContext(kind) { assert.equal(kind, '2d', 'fixture: only the actual 2D canvas API is needed'); return this.ctx; }
  addEventListener(type, callback) {
    const callbacks = this.events.get(type) ?? []; callbacks.push(callback); this.events.set(type, callbacks);
  }
  getBoundingClientRect() { this.rectReads++; return this.rect; }
}

const ROAD = 2 * N + 1, FIELD = 2 * N + 2, MUD = 2 * N + 3;
const HOUSE = 4 * N + 4, OWN_HOUSE = 4 * N + 5, CRATER = 5 * N + 5;
function mapWorld(seed = 1944, variant = 0) {
  const w = createWorld(seed), unit = w.units[0], house = w.blds[0];
  w.ter.fill(variant ? TER_FIELD : TER_GRASS); w.occ.fill(0); w.crater.fill(0);
  w.ter[ROAD] = TER_ROAD; w.ter[FIELD] = TER_FIELD; w.ter[MUD] = TER_MUD;
  w.blds = [
    { ...house, id: 1, x: 4, z: 4, w: 1, d: 1, hp: house.maxHp },
    { ...house, id: 2, x: 5, z: 4, w: 1, d: 1, hp: house.maxHp, builtBy: SIDE_PLAYER },
  ];
  w.occ[HOUSE] = 1; w.occ[OWN_HOUSE] = 2;
  w.units = [
    { ...unit, id: 1, side: SIDE_PLAYER, x: (4 + variant) * SUB, z: 6 * SUB, alive: true },
    { ...unit, id: 2, side: SIDE_ENEMY, x: 9 * SUB, z: 8 * SUB, alive: true },
    { ...unit, id: 3, side: SIDE_ENEMY, x: 12 * SUB, z: 11 * SUB, alive: true },
    { ...unit, id: 4, side: SIDE_PLAYER, x: 14 * SUB, z: 13 * SUB, alive: false },
  ];
  // Independent fixture oracle, never obtained by rendering the module under test.
  const colors = Array(N * N).fill(variant ? '#9a9450' : '#5b7a42');
  colors[ROAD] = '#8f7f62'; colors[FIELD] = '#9a9450'; colors[MUD] = '#4d6470';
  colors[HOUSE] = '#cfc3a8'; colors[OWN_HOUSE] = '#a9c4e6';
  return { w, colors };
}
function fixture(initial = mapWorld(), { width = 412, dpr = 1, hud = true, getter } = {}) {
  const canvases = [], metrics = { worldReads: 0, viewReads: 0, visibleReads: 0, appends: 0 }, taps = [];
  let world = initial.w;
  globalThis.innerWidth = width; globalThis.devicePixelRatio = dpr;
  const host = { appendChild() { metrics.appends++; } };
  globalThis.document = {
    body: host,
    getElementById(id) { assert.equal(id, 'hud', 'fixture: minimap attaches only to the existing HUD'); return hud ? host : null; },
    createElement(tag) { assert.equal(tag, 'canvas', 'fixture: minimap creates only canvases'); const c = new Canvas(); canvases.push(c); return c; },
  };
  const m = initMinimap({
    world() { metrics.worldReads++; return getter ? getter(metrics.worldReads) : world; },
    visible(u) { metrics.visibleReads++; return u.id === 2; },
    view() { metrics.viewReads++; return [[1, 1], [10, 1], [10, 10], [1, 10]]; },
    tap(x, z) { taps.push([x, z]); },
  });
  return {
    m, metrics, taps, canvases, screen: canvases[0], base: canvases[1],
    get world() { return world; }, set world(value) { world = value; },
    pointer(type, clientX, clientY) {
      let stops = 0;
      for (const callback of canvases[0].events.get(type) ?? []) callback({ clientX, clientY, stopPropagation() { stops++; } });
      return stops;
    },
  };
}
function expectBase(f, expected, group) {
  assert.equal(f.base.colors.length, N * N, `${group}: every terrain cell is painted`);
  assert.deepEqual(f.base.colors, expected, `${group}: base uses independent expected terrain, building and crater colors`);
  assert.deepEqual(f.screen.drawn, expected, `${group}: visible canvas receives the freshly painted base in the same frame`);
}
function expectedDots(width, variant = 0) {
  // Projection specified by the original UI contract, without toMini/miniDots as oracle.
  const scale = width / (2 * N);
  return [
    ['#4aa3ff', width / 2 + (4 + variant - 6) * scale - 2, (4 + variant + 6) * scale / 2 - 2, 4, 4],
    ['#ff5a3c', width / 2 + scale - 2, 17 * scale / 2 - 2, 4, 4],
  ];
}

const groups = {
  initial() {
    for (const hud of [true, false]) {
      const initial = mapWorld(), f = fixture(initial, { hud });
      f.m.frame(0);
      assert.equal(f.base.paints, 1, 'initial: first frame paints immediately, even at timestamp zero');
      expectBase(f, initial.colors, 'initial');
      assert.equal(f.base.fills, N * N, 'initial: initial base fills exactly one map');
      assert.equal(f.metrics.appends, 1, 'initial: visible canvas attaches once with HUD or body fallback');
      assert.equal(f.canvases.length, 2, 'initial: exactly one visible canvas and one cached base');
      assert.equal(f.m.el, f.screen, 'initial: public canvas remains the visible canvas');
      assert.equal(f.screen.id, 'minimap', 'initial: original element identity remains available');
      assert.deepEqual(f.screen.dots, expectedDots(150), 'initial: live player and visible enemy dots retain original projection/colors');
    }
  },
  new_world() {
    const initial = mapWorld(), next = mapWorld(1945, 1), f = fixture(initial);
    next.w.tick = 23;
    f.m.frame(1000); f.world = next.w; f.m.frame(1001);
    assert.equal(f.base.paints, 2, 'new_world: a different World repaints at delta 1ms before the old throttle');
    expectBase(f, next.colors, 'new_world');
    assert.deepEqual(f.screen.dots, expectedDots(150, 1), 'new_world: newly visible dots belong to the replacement World');
    assert.equal(f.screen.draws, 2, 'new_world: swap presents once immediately');
    f.m.frame(1002);
    assert.equal(f.base.paints, 2, 'new_world: replacement identity is recorded after its first paint');
    assert.equal(f.screen.draws, 2, 'new_world: next clean frame resumes the existing throttle');
  },
  same_seed() {
    const damaged = mapWorld(), fresh = mapWorld(), f = fixture(damaged);
    damaged.w.blds[0].hp = 0; damaged.w.crater[CRATER] = 1;
    damaged.colors[HOUSE] = '#6f6559'; damaged.colors[CRATER] = '#4a3f33';
    assert.equal(damaged.w.seed, fresh.w.seed, 'fixture: restart keeps seed');
    assert.equal(damaged.w.tick, fresh.w.tick, 'fixture: restart may also keep tick');
    f.m.frame(1000); expectBase(f, damaged.colors, 'same_seed');
    f.world = fresh.w; f.m.frame(1001);
    assert.equal(f.base.paints, 2, 'same_seed: equal seed/tick never substitute for World object identity');
    expectBase(f, fresh.colors, 'same_seed');
    assert.equal(f.screen.drawn[HOUSE], '#cfc3a8', 'same_seed: previous rubble is gone on the first restart frame');
    assert.equal(f.screen.drawn[CRATER], '#5b7a42', 'same_seed: previous crater is gone on the first restart frame');
  },
  return_old() {
    const first = mapWorld(), second = mapWorld(1945, 1), f = fixture(first);
    f.m.frame(1000); f.world = second.w; f.m.frame(1001);
    first.w.crater[CRATER] = 1; first.colors[CRATER] = '#4a3f33';
    f.world = first.w; f.m.frame(1002);
    assert.equal(f.base.paints, 3, 'return_old: returning to a previously painted World repaints its current contents');
    expectBase(f, first.colors, 'return_old');
    f.world = second.w; f.m.frame(1003);
    assert.equal(f.base.paints, 4, 'return_old: repeated A/B swaps each invalidate exactly once');
    expectBase(f, second.colors, 'return_old');
  },
  stable() {
    const f = fixture(); f.m.frame(1000);
    for (let i = 1; i <= 120; i++) f.m.frame(1000 + i * 100);
    assert.equal(f.base.paints, 1, 'stable: 120 clean frames never rebuild the base');
    assert.equal(f.base.fills, N * N, 'stable: stable frames add zero cell fill operations');
    assert.equal(f.base.resets, 2, 'stable: cached base backing dimensions are set only once');
    assert.equal(f.screen.draws, 121, 'stable: eligible frames still present dots and the camera view');
    assert.equal(f.screen.strokes, 121, 'stable: camera outline remains live while the base is cached');
    assert.equal(f.metrics.worldReads, 121, 'stable: exactly one World read per frame, including initial');
    assert.equal(f.canvases.length, 2, 'stable: stable frames allocate no more DOM');
  },
  throttle() {
    const f = fixture(); f.m.frame(1000);
    for (const t of [1000, 1001, 1099, 1099.999]) f.m.frame(t);
    assert.equal(f.screen.draws, 1, 'throttle: clean same-world frames below 100ms do not redraw');
    assert.equal(f.metrics.viewReads, 1, 'throttle: throttled frames do not read camera geometry');
    f.world.units[0].x += SUB;
    f.m.frame(1100);
    assert.equal(f.screen.draws, 2, 'throttle: the exact 100ms boundary redraws once');
    assert.deepEqual(f.screen.dots, expectedDots(150, 1), 'throttle: elapsed frame refreshes moving dots without rebuilding terrain');
    for (const t of [1101, 1199.999]) f.m.frame(t);
    assert.equal(f.screen.draws, 2, 'throttle: successful draw resets the 100ms window');
    f.m.frame(1200);
    assert.equal(f.screen.draws, 3, 'throttle: next exact boundary remains eligible');
    assert.equal(f.base.paints, 1, 'throttle: elapsed clean frames preserve cached terrain');
    assert.equal(f.metrics.worldReads, 9, 'throttle: even skipped frames read World exactly once to detect swaps');
  },
  dirty() {
    const original = mapWorld(), f = fixture(original); f.m.frame(1000);
    original.w.blds[0].hp = 0; original.w.crater[CRATER] = 1;
    original.colors[HOUSE] = '#6f6559'; original.colors[CRATER] = '#4a3f33';
    f.m.dirty(); f.m.dirty(); f.m.frame(1001);
    assert.equal(f.base.paints, 2, 'dirty: same-world dirty bypasses 100ms throttle and coalesces repeated requests');
    expectBase(f, original.colors, 'dirty');
    f.m.frame(1002);
    assert.equal(f.screen.draws, 2, 'dirty: painted dirty state clears and restores throttling');
    original.w.crater[CRATER] = 0; original.colors[CRATER] = '#5b7a42';
    f.m.dirty(); f.m.frame(1002);
    assert.equal(f.base.paints, 3, 'dirty: another same-world event invalidates independently');
    expectBase(f, original.colors, 'dirty');
  },
  resize_dpr() {
    const f = fixture(mapWorld(), { width: 1024 }); f.m.frame(1000);
    assert.deepEqual([f.screen.width, f.screen.height, f.base.width, f.base.height], [200, 100, 200, 100], 'resize_dpr: desktop dimensions retain original geometry');
    globalThis.innerWidth = 412; f.m.frame(1001);
    assert.equal(f.base.paints, 1, 'resize_dpr: size changes retain the existing throttle behavior');
    f.m.frame(1100);
    assert.deepEqual([f.screen.width, f.screen.height, f.base.width, f.base.height], [150, 75, 150, 75], 'resize_dpr: phone resize updates both backing canvases');
    assert.deepEqual(f.screen.style, { width: '150px', height: '75px' }, 'resize_dpr: original phone CSS dimensions remain unchanged');
    assert.equal(f.base.paints, 2, 'resize_dpr: resize repaints cached terrain once');
    globalThis.devicePixelRatio = 2; f.m.frame(1101);
    assert.equal(f.base.paints, 2, 'resize_dpr: DPR changes retain the existing throttle behavior');
    f.m.frame(1200);
    assert.deepEqual([f.screen.width, f.screen.height, f.base.width, f.base.height], [300, 150, 300, 150], 'resize_dpr: DPR-only change updates both backing canvases');
    assert.equal(f.base.paints, 3, 'resize_dpr: DPR-only change repaints once');
    assert.deepEqual(f.base.transforms.at(-1), [2, 0, 0, 2, 0, 0], 'resize_dpr: base paints in CSS coordinates at current DPR');
    assert.deepEqual(f.screen.transforms.slice(-2), [[1, 0, 0, 1, 0, 0], [2, 0, 0, 2, 0, 0]], 'resize_dpr: copy uses backing pixels, overlay uses CSS coordinates');
    globalThis.devicePixelRatio = 3; f.m.frame(1300);
    assert.equal(f.base.paints, 3, 'resize_dpr: effective DPR remains capped at two');
    globalThis.devicePixelRatio = 0; f.m.frame(1400);
    assert.equal(f.base.paints, 4, 'resize_dpr: falsy DPR retains the original fallback of one');
    assert.deepEqual([f.screen.width, f.base.width], [150, 150], 'resize_dpr: fallback DPR updates both backing sizes');
    globalThis.innerWidth = 639; f.m.frame(1500);
    assert.equal(f.base.paints, 4, 'resize_dpr: same effective width does not invalidate');
    globalThis.innerWidth = 640; f.m.frame(1600);
    assert.deepEqual([f.screen.width, f.base.width], [200, 200], 'resize_dpr: exact desktop breakpoint is preserved');
    assert.equal(f.base.paints, 5, 'resize_dpr: crossing the exact breakpoint repaints once');
  },
  coherent() {
    const first = mapWorld(), second = mapWorld(1945, 1);
    const f = fixture(first, { getter: reads => reads % 2 ? first.w : second.w });
    f.m.frame(1000);
    assert.equal(f.metrics.worldReads, 1, 'coherent: one frame reads World only once, even when getter would change its answer');
    expectBase(f, first.colors, 'coherent');
    assert.deepEqual(f.screen.dots, expectedDots(150), 'coherent: first base and dots share the one captured World');
    f.m.frame(1001);
    assert.equal(f.metrics.worldReads, 2, 'coherent: next frame takes exactly one new snapshot reference');
    expectBase(f, second.colors, 'coherent');
    assert.deepEqual(f.screen.dots, expectedDots(150, 1), 'coherent: replacement base and dots share the next captured World');
    assert.equal(f.base.paints, 2, 'coherent: each captured identity paints once');
  },
  readonly() {
    const first = mapWorld(), second = mapWorld(1945, 1);
    first.w.events.push({ e: 'stage', bld: 1, stage: 2 });
    second.w.events.push({ e: 'build', bld: 2 });
    const clone = globalThis.structuredClone, before = [clone(first.w), clone(second.w)];
    const hashes = [hashWorld(first.w), hashWorld(second.w)];
    let clones = 0;
    globalThis.structuredClone = (...args) => { clones++; return clone(...args); };
    const f = fixture(first);
    try {
      f.m.frame(1000); f.m.frame(1001); f.m.dirty(); f.m.frame(1002);
      f.world = second.w; f.m.frame(1003); f.m.frame(1200);
      globalThis.innerWidth = 1024; f.m.frame(1300);
      f.world = first.w; f.m.frame(1301);
    } finally { globalThis.structuredClone = clone; }
    assert.deepEqual([first.w, second.w], before, 'readonly: full structuredClone snapshots, including events and RNG, remain equal');
    assert.deepEqual([hashWorld(first.w), hashWorld(second.w)], hashes, 'readonly: rendering preserves both simulation hashes');
    assert.equal(clones, 0, 'readonly: frame keeps a World reference without cloning the simulation');
    assert.deepEqual(f.taps, [], 'readonly: frame, dirty, resize and replacement never invoke input commands');
  },
  interaction() {
    const f = fixture(); f.m.frame(1000);
    assert.deepEqual(f.m.point(0, 0), [92, 29], 'interaction: top corner preserves CSS-space page offset');
    assert.deepEqual(f.m.point(N, 0), [167, 66.5], 'interaction: right corner preserves original orientation');
    assert.deepEqual(f.m.point(N, N), [92, 104], 'interaction: bottom corner remains inside the diamond');
    assert.deepEqual(f.m.point(0, N), [17, 66.5], 'interaction: left corner remains inside the diamond');
    const x = 8, z = 12, px = 17 + 75 + (x - z) * 150 / (2 * N), py = 29 + (x + z) * 150 / (4 * N);
    assert.equal(f.pointer('pointerdown', px, py), 1, 'interaction: pointerdown still stops propagation exactly once');
    assert.equal(f.pointer('pointerup', px, py), 1, 'interaction: pointerup still stops propagation exactly once');
    assert.deepEqual(f.taps, [[x, z]], 'interaction: existing minimap tap maps CSS page coordinates to exact world coordinates');
    f.pointer('pointerup', -100, -100);
    assert.equal(f.taps.length, 1, 'interaction: clicks outside the world do not emit a tap');
    f.world = mapWorld(1945, 1).w; f.m.frame(1001);
    globalThis.innerWidth = 1024; globalThis.devicePixelRatio = 2; f.m.frame(1101);
    f.pointer('pointerup', 17 + 100, 29 + 50);
    assert.deepEqual(f.taps.at(-1), [N / 2, N / 2], 'interaction: world replacement and DPR resize preserve CSS-space tap coordinates');
  },
};

const only = process.argv.find(a => a.startsWith('--group='))?.slice(8);
assert(!only || Object.hasOwn(groups, only), 'known guard group');
assert.deepEqual(new Set(Object.values(mutations).map(m => m.group)), new Set(Object.keys(groups)), 'every new guard group has an isolated semantic production mutant');
for (const [name, run] of Object.entries(groups)) if (!only || name === only) {
  try { run(); console.log(`OK minimap-cache ${name}`); }
  catch (error) { console.error(`NG minimap-cache ${name}`); throw error; }
}
if (process.argv.includes('--mutations')) {
  for (const [name, m] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`, `--group=${m.group}`], { encoding: 'utf8', timeout: 10000 });
    assert.equal(p.status, 1, `${name}: isolated broken production source must exit 1\n${p.stdout}\n${p.stderr}`);
    const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
    assert(first?.startsWith(`${m.group}:`), `${name}: first red must be its intended semantic assertion, not syntax/startup\n${p.stderr}`);
    assert(p.stderr.includes(`NG minimap-cache ${m.group}`), `${name}: intended guard ran`);
    console.log(`RED minimap-cache ${name}: ${first}`);
  }
}
console.log('minimap-cache: all requested groups OK (actual production module; counted canvas calls, not browser pixels)');
