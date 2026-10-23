// R118: real ground bytes and recorded canvas operations; WebGL/raster/mobile checks stay in Chrome.
// Mutants alter isolated module sources in memory and must fail at their named semantic assertion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, N, idx, SIDE_PLAYER } from '../src/sim/world.ts';
import { applyMap } from '../src/sim/maps.ts';
import { applyTrench, trenchError } from '../src/sim/trenches.ts';
import { step } from '../src/sim/step.ts';

const paths = { raster: '../src/render/trenches.ts', battle: '../src/render/battle.ts', mini: '../src/ui/minimap.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(new URL(path, import.meta.url), 'utf8')]));
const mutations = {
  absent_ground: { group: 'ground', file: 'battle', from: 'if (trench >= 0) { r = trench >>> 16; g = (trench >>> 8) & 255; bl = trench & 255; }', to: '', message: 'ground: each independently specified occupied cell has its dark trench floor' },
  wrong_rotation: { group: 'orientation', file: 'raster', from: 'trenchCells(segment)', to: 'trenchCells({ ...segment, rot: 0 })', message: 'orientation: all four templates and rotations change exactly their independently specified ground cells' },
  omit_communication: { group: 'ground', file: 'raster', from: 'if (kind < 0) return -1;', to: 'if (kind < 0 || kind === 2) return -1;', message: 'ground: each independently specified occupied cell has its dark trench floor' },
  absent_timber: { group: 'timber', file: 'raster', from: 'if (kind === 3 && distance <= 1.5', to: 'if (false && distance <= 1.5', message: 'timber: reinforced cells have independent transverse pale wooden braces' },
  broken_connection: { group: 'connection', file: 'raster', from: '(x + 1 < n && this.kinds[i + 1] ? TRENCH_E : 0)', to: '0', message: 'connection: adding an adjacent segment opens the previously closed endpoint pixels' },
  stale_event: { group: 'connection', file: 'battle', from: 'if (this.trench118.sync(this.w, trenchEvent)) {', to: 'if (false) {', message: 'connection: adding an adjacent segment opens the previously closed endpoint pixels' },
  stale_vegetation: { group: 'vegetation_valve', file: 'battle', from: 'if (trenchEvent) vegetationDirty = true;', to: '', message: 'vegetation_valve: hiding trenches still refreshes physically cleared foliage' },
  world_write: { group: 'readonly', file: 'raster', from: 'const state = w.trenches,', to: 'w.rng ^= 1; const state = w.trenches,', message: 'readonly: all drawing and lifecycle paths leave the complete world unchanged' },
  ignore_valve: { group: 'valve', file: 'raster', from: 'this.enabled = enabled;', to: 'this.enabled = true;', message: 'valve: disabled ground is byte-identical to the same world with no trench state' },
  stale_growth: { group: 'growth', file: 'raster', from: ' && this.count === count', to: '', message: 'growth: appending to the same state and segment array refreshes ground without needing an event' },
  churn_cache: { group: 'cache', file: 'raster', from: ' && !changed) return false;', to: ' && false) return false;', message: 'cache: stable frames reuse the fixed cell buffers without ground uploads or rebuilds' },
  stale_preview: { group: 'lifecycle', file: 'battle', from: '    this.trench118.sync(w, true);', to: '', message: 'lifecycle: preview paints the new trench footprint immediately' },
  extra_mesh: { group: 'budget', file: 'battle', from: '    this.scene.add(ground);', to: '    this.scene.add(ground); if (this.trench118.cells) this.scene.add(ground.clone());', message: 'budget: maximum affordable networks add zero calls and zero triangles including shadows' },
  absent_minimap: { group: 'minimap', file: 'mini', from: 'if (kind < 0 || w.occ[i]) continue;', to: 'if (true) continue;', message: 'minimap: each template has its independent color and connected cell paths' },
  mini_valve: { group: 'mini_valve', file: 'mini', from: 'new TrenchRaster(a.trenches !== false)', to: 'new TrenchRaster(true)', message: 'mini_valve: off restores all original canvas operations with no trench marks' },
  mini_growth: { group: 'mini_growth', file: 'mini', from: 'if (trenchRaster.sync(w)) baseDirty = true;', to: '', message: 'mini_growth: same-world state activation bypasses the previous 100ms throttle' },
  mini_late: { group: 'mini_growth', file: 'mini', from: 'if (t - last < 100 && !baseDirty) return;', to: 'if (t - last < 100) return;', message: 'mini_growth: same-world state activation bypasses the previous 100ms throttle' },
  mini_event: { group: 'mini_event', file: 'mini', from: 'dirty: () => { baseDirty = true; }', to: 'dirty: () => {}', message: 'mini_event: explicit trench event dirtiness refreshes changed links at the same segment count' },
};
const mutant = process.argv.find(s => s.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutant');
  assert.equal(sources[m.file].split(m.from).length, 2, `${mutant}: unique production anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
function moduleURL(key, aliases = {}) {
  const base = new URL(paths[key], import.meta.url);
  const code = stripTypeScriptTypes(sources[key]).replace(/from '([^']+)'/g, (_, spec) => `from '${aliases[spec] ?? (spec.startsWith('.') ? new URL(spec, base).href : import.meta.resolve(spec))}'`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const rasterURL = moduleURL('raster');
const { TrenchRaster } = await import(rasterURL);
const { BattleView } = await import(moduleURL('battle', { './trenches.ts': rasterURL }));
const { initMinimap } = await import(moduleURL('mini', { '../render/trenches.ts': rasterURL }));
const COLORS = ['#bba16c', '#c29463', '#84765c', '#dec997'];
const FLOORS = [0x30291f, 0x382c20, 0x514432, 0x28241e];
const BENDS = [[[0, 0], [1, 0], [1, 1]], [[1, 0], [1, 1], [0, 1]], [[1, 1], [0, 1], [0, 0]], [[0, 1], [0, 0], [1, 0]]];
// Explicit footprints, independent of trenchCells, TRENCH_KINDS and the rendering cache.
function expected(kind, rot, x = 24, z = 24) {
  const local = kind === 1 ? BENDS[rot] : Array.from({ length: kind === 2 ? 4 : 2 }, (_, i) => rot % 2 ? [0, i] : [i, 0]);
  return local.map(([a, b]) => [x + a, z + b]);
}
function field(segments = []) {
  const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.events = [];
  if (segments.length) w.trenches = { version: 1, segments: segments.map(s => ({ side: 0, kind: 0, x: 24, z: 24, rot: 0, ...s })) };
  return w;
}
const command = (kind, x = 24, z = 24, rot = 0) => ({ t: 'trench', side: 0, kind, x, z, rot });
const view = (w, enabled = true) => new BattleView(w, false, true, true, true, true, true, true, true, false, true, true, enabled);
const bytes = data => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
const sameBytes = (a, b) => bytes(a).equals(bytes(b));
function pixel(v, x, z, px, py) { const o = ((z * 8 + py) * N * 8 + x * 8 + px) * 4; return (v.groundPx[o] << 16) | (v.groundPx[o + 1] << 8) | v.groundPx[o + 2]; }
function changedCells(a, b) {
  const cells = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    let changed = false;
    for (let py = 0; py < 8 && !changed; py++) for (let px = 0; px < 8; px++) if (pixel(a, x, z, px, py) !== pixel(b, x, z, px, py)) { changed = true; break; }
    if (changed) cells.push(idx(x, z));
  }
  return cells;
}
class Canvas {
  constructor() {
    this.style = {}; this.ops = []; this.baseOps = []; this.paints = 0; this.draws = 0;
    const c = this; let path = [];
    this.context = {
      setTransform() {}, clearRect() { c.paints++; c.ops = []; },
      beginPath() { path = []; }, moveTo(...p) { path.push(['M', ...p]); }, lineTo(...p) { path.push(['L', ...p]); }, closePath() { path.push(['Z']); },
      fill() { c.ops.push({ op: 'fill', color: this.fillStyle, path: structuredClone(path) }); },
      stroke() { c.ops.push({ op: 'stroke', color: this.strokeStyle, width: this.lineWidth, path: structuredClone(path) }); },
      fillRect(...rect) { c.ops.push({ op: 'rect', color: this.fillStyle, rect }); },
      drawImage(base) { c.draws++; c.baseOps = structuredClone(base.ops); },
    };
  }
  getContext() { return this.context; }
  addEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}
function mini(initial, enabled = true) {
  const canvases = []; let w = initial;
  globalThis.innerWidth = 412; globalThis.devicePixelRatio = 1;
  globalThis.document = { body: { appendChild() {} }, getElementById() { return null; }, createElement() { const c = new Canvas(); canvases.push(c); return c; } };
  const m = initMinimap({ world: () => w, visible: () => false, view: () => [], tap() {}, trenches: enabled, counterbattery: false });
  return { m, screen: canvases[0], base: canvases[1], replace(other) { w = other; } };
}
function budget(v) {
  let calls = 0, triangles = 0;
  v.scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const count = o.isInstancedMesh ? o.count : 1, vertices = Math.min(o.geometry.drawRange.count, o.geometry.index?.count ?? o.geometry.attributes.position.count);
    if (!count || !vertices) return;
    const passes = o.castShadow ? 2 : 1; calls += passes; triangles += vertices / 3 * count * passes;
  });
  return { calls, triangles };
}
function legalPlan(w, kinds = [0, 1, 2, 3], side = 0) {
  const commands = [];
  for (const kind of kinds) {
    let found;
    for (let z = 0; z < N && !found; z++) for (let x = 0; x < N && !found; x++) for (let rot = 0; rot < 4 && !found; rot++) {
      const c = { ...command(kind, x, z, rot), side }; if (trenchError(w, c) === null) found = c;
    }
    assert(found, 'fixture: requested trench fits the actual map and budget'); assert.equal(applyTrench(w, found), null); commands.push(found);
  }
  return commands;
}
const groups = {
  ground() {
    for (let kind = 0; kind < 4; kind++) {
      const w = field([{ kind }]), v = view(w);
      for (const [x, z] of expected(kind, 0)) assert.equal(pixel(v, x, z, 3, 3), FLOORS[kind], 'ground: each independently specified occupied cell has its dark trench floor');
      assert.equal(pixel(v, 24, 24, 3, 2), [0x68513a, 0x765539, 0x8b7755, 0x705c41][kind], 'ground: each kind retains its independently specified wall tone');
      v.dispose();
    }
  },
  orientation() {
    const blank = view(field());
    for (let kind = 0; kind < 4; kind++) for (let rot = 0; rot < 4; rot++) {
      const w = field([{ kind, rot }]), v = view(w), cells = expected(kind, rot), indices = cells.map(([x, z]) => idx(x, z)).sort((a, b) => a - b);
      assert.deepEqual(changedCells(v, blank), indices, 'orientation: all four templates and rotations change exactly their independently specified ground cells');
      // Independent channel continuity: two dark center pixels reach an edge iff that neighbor exists.
      const set = new Set(indices);
      for (const [x, z] of cells) for (const [dx, dz, px, py] of [[1, 0, 7, 3], [-1, 0, 0, 3], [0, 1, 3, 7], [0, -1, 3, 0]]) {
        assert.equal(pixel(v, x, z, px, py), set.has(idx(x + dx, z + dz)) ? FLOORS[kind] : pixel(blank, x, z, px, py), 'orientation: trench openings follow independent occupied neighbors and never enter the L empty corner');
      }
      v.dispose();
    }
    blank.dispose();
  },
  timber() {
    for (const rot of [0, 1, 2, 3]) {
      const v = view(field([{ kind: 3, rot }]));
      assert.equal(pixel(v, 24, 24, rot % 2 ? 3 : 5, rot % 2 ? 5 : 3), 0xcbb383, 'timber: reinforced cells have independent transverse pale wooden braces'); v.dispose();
    }
    const narrow = view(field([{ kind: 2 }])), straight = view(field()), off = view(field([{ kind: 2 }]), false);
    assert.equal(pixel(narrow, 25, 24, 3, 1), pixel(straight, 25, 24, 3, 1), 'timber: communication trench is visibly narrower than the other kinds');
    assert(sameBytes(straight.groundPx, off.groundPx)); for (const v of [narrow, straight, off]) v.dispose();
  },
  connection() {
    const w = field(), v = view(w); applyTrench(w, command(0)); v.onEvents(w.events, 0);
    const before = pixel(v, 25, 24, 7, 3); w.events = []; applyTrench(w, command(3, 26, 24)); v.onEvents(w.events, 0);
    assert.equal(pixel(v, 25, 24, 7, 3), FLOORS[0], 'connection: adding an adjacent segment opens the previously closed endpoint pixels'); assert.notEqual(before, FLOORS[0]);
    assert.equal(pixel(v, 26, 24, 0, 3), FLOORS[3], 'connection: mixed-kind junction has reciprocal open halves');
    const direct = view(w); assert(sameBytes(v.groundPx, direct.groundPx), 'connection: incremental rendering equals full reconstruction'); v.dispose(); direct.dispose();
  },
  vegetation() {
    const w = field(); w.vegetation = { version: 1, cells: new Uint8Array(N * N) };
    for (const [x, z] of [[24, 24], [25, 24], [25, 25], [24, 25]]) w.vegetation.cells[idx(x, z)] = 1;
    const v = view(w); applyTrench(w, command(1)); v.onEvents(w.events, 0);
    assert.equal(v.vegetation116.cells, 1, 'vegetation: trench event removes only actually cleared cell geometry');
    assert.equal(w.vegetation.cells[idx(24, 25)], 1, 'vegetation: L empty corner remains intact'); v.dispose();
  },
  vegetation_valve() {
    const w = field(); w.vegetation = { version: 1, cells: new Uint8Array(N * N) }; w.vegetation.cells[idx(24, 24)] = 1;
    const v = view(w, false); applyTrench(w, command(0)); v.onEvents(w.events, 0);
    assert.equal(v.vegetation116.cells, 0, 'vegetation_valve: hiding trenches still refreshes physically cleared foliage'); v.dispose();
  },
  readonly() {
    const w = field([{ kind: 1 }, { kind: 3, x: 26 }]), before = structuredClone(w), hash = hashWorld(w);
    const v = view(w), f = mini(w); v.update(0, 0, new Set()); v.onEvents([{ e: 'trench' }], 0); f.m.frame(0); f.m.dirty(); f.m.frame(1);
    v.setWorld(structuredClone(w), SIDE_PLAYER); v.setWorld(w); v.dispose();
    assert.deepEqual(w, before, 'readonly: all drawing and lifecycle paths leave the complete world unchanged'); assert.equal(hashWorld(w), hash);
  },
  valve() {
    const w = field([{ kind: 0 }, { kind: 1, x: 26 }]), before = structuredClone(w), old = structuredClone(w); delete old.trenches;
    const on = view(w), off = view(w, false), legacy = view(old), f = mini(w, false); f.m.frame(0);
    assert.equal(sameBytes(off.groundPx, legacy.groundPx), true, 'valve: disabled ground is byte-identical to the same world with no trench state');
    assert(!sameBytes(on.groundPx, off.groundPx), 'valve: on visibly changes ground'); assert.deepEqual(w, before); assert.equal(hashWorld(w), hashWorld(before));
    for (const v of [on, off, legacy]) v.dispose();
  },
  growth() {
    const w = field([{ kind: 0 }]), v = view(w); w.trenches.segments.push({ side: 0, kind: 3, x: 26, z: 24, rot: 0 }); v.onEvents([], 0);
    assert.equal(pixel(v, 26, 24, 3, 3), FLOORS[3], 'growth: appending to the same state and segment array refreshes ground without needing an event'); v.dispose();
  },
  cache() {
    const w = field([{ kind: 0 }]), v = view(w), f = mini(w); f.m.frame(0);
    const fixed = [v.trench118.builds, v.groundTex.version, v.trench118.kinds, v.trench118.links];
    for (let n = 1; n < 40; n++) { v.onEvents([], 0); v.update(0, 0, new Set()); f.m.frame(n * 100); }
    assert.deepEqual([v.trench118.builds, v.groundTex.version, v.trench118.kinds, v.trench118.links], fixed, 'cache: stable frames reuse the fixed cell buffers without ground uploads or rebuilds');
    assert.equal(f.base.paints, 1, 'cache: stable minimap frames reuse the trench base'); v.dispose();
  },
  lifecycle() {
    const w = field(), preview = structuredClone(w), v = view(w), f = mini(w); f.m.frame(0);
    const blank = v.groundPx.slice(), blankOps = structuredClone(f.base.ops); applyTrench(preview, command(1));
    v.setWorld(preview, 0); f.replace(preview); f.m.frame(1); assert.equal(pixel(v, 24, 24, 3, 3), FLOORS[1], 'lifecycle: preview paints the new trench footprint immediately'); assert(f.base.ops.some(o => COLORS.includes(o.color)));
    v.setWorld(w); f.replace(w); f.m.frame(2); assert(sameBytes(v.groundPx, blank), 'lifecycle: cancel restores ground'); assert.deepEqual(f.base.ops, blankOps, 'lifecycle: cancel restores minimap before throttle');
    applyTrench(w, command(1)); v.onEvents(w.events, 0); f.m.dirty(); f.m.frame(3);
    const full = v.groundPx.slice(), operations = structuredClone(f.base.ops);
    const undo = field(); v.setWorld(undo); f.replace(undo); f.m.frame(4); assert(sameBytes(v.groundPx, blank)); assert.deepEqual(f.base.ops, blankOps);
    v.setWorld(w); f.replace(w); f.m.frame(5); assert(sameBytes(v.groundPx, full)); assert.deepEqual(f.base.ops, operations, 'lifecycle: returning to an already seen world restores its current marks');
    v.setWorld(field()); f.replace(field()); f.m.frame(6); assert(sameBytes(v.groundPx, blank)); assert.deepEqual(f.base.ops, blankOps, 'lifecycle: same-seed reset retains no old symbols'); v.dispose();
  },
  minimap() {
    for (let kind = 0; kind < 4; kind++) for (let rot = 0; rot < 4; rot++) {
      const w = field([{ kind, rot }]), f = mini(w); f.m.frame(0);
      const cells = expected(kind, rot), cellsSet = new Set(cells.map(([x, z]) => idx(x, z))), strokes = f.base.ops.filter(o => o.op === 'stroke' && o.color === COLORS[kind]);
      const project = (x, z) => [75 + (x - z) * 150 / 64, (x + z) * 150 / 128];
      const oracle = cells.sort((a, b) => idx(...a) - idx(...b)).map(([x, z]) => {
        const path = [];
        for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (cellsSet.has(idx(x + dx, z + dz))) path.push(['M', ...project(x + 0.5, z + 0.5)], ['L', ...project(x + 0.5 + dx / 2, z + 0.5 + dz / 2)]);
        return { op: 'stroke', color: COLORS[kind], width: kind === 2 ? 0.7 : 1.2, path };
      });
      assert.deepEqual(strokes, oracle, 'minimap: each template has its independent color and connected cell paths'); assert.deepEqual(f.screen.baseOps, f.base.ops);
      assert.equal(f.base.ops.filter(o => o.color === '#f0d9aa').length, kind === 3 ? 2 : 0, 'minimap: only reinforced cells carry pale brace dots');
    }
  },
  mini_valve() {
    const w = field([{ kind: 3 }]), off = mini(w, false), legacy = mini(field()); off.m.frame(0); legacy.m.frame(0);
    assert.deepEqual(off.base.ops, legacy.base.ops, 'mini_valve: off restores all original canvas operations with no trench marks');
  },
  mini_growth() {
    const w = field(), f = mini(w); f.m.frame(0); applyTrench(w, command(0)); f.m.frame(1);
    assert.equal(f.base.paints, 2, 'mini_growth: same-world state activation bypasses the previous 100ms throttle');
    assert.equal(f.base.ops.filter(o => o.color === COLORS[0]).length, 2);
    applyTrench(w, command(3, 26, 24)); f.m.frame(2); assert.equal(f.base.paints, 3, 'mini_growth: same-state append also bypasses throttle');
    assert.equal(f.base.ops.filter(o => o.color === COLORS[3]).length, 2);
    const replacement = structuredClone(w.trenches); replacement.segments[0].kind = 2; w.trenches = replacement; f.m.frame(3);
    assert.equal(f.base.paints, 4, 'mini_growth: same-count replacement state repaints');
  },
  mini_event() {
    const w = field([{ kind: 0 }, { kind: 3, x: 27 }]), f = mini(w); f.m.frame(0);
    w.trenches.segments[1].x = 26; f.m.dirty(); f.m.frame(1); const fresh = mini(w); fresh.m.frame(0);
    assert.deepEqual(f.base.ops, fresh.base.ops, 'mini_event: explicit trench event dirtiness refreshes changed links at the same segment count');
  },
  replay() {
    for (const map of [0, 1]) {
      const w = createWorld(1944); applyMap(w, map, 1); const trial = structuredClone(w), commands = legalPlan(trial), v = view(w), f = mini(w);
      v.setWorld(trial, 0); f.replace(trial); f.m.frame(0); v.setWorld(w); f.replace(w);
      const all = [{ t: 'map', id: map, vegetation: 1 }, ...commands, { t: 'eco', inf: 1, guns: 1, tanks: 1 }];
      v.snapshot(); step(w, all); v.onEvents(w.events, w.tick / 20); f.m.dirty(); f.m.frame(1);
      const replay = createWorld(1944), replayView = view(replay), replayMini = mini(replay); replayView.snapshot(); step(replay, JSON.parse(JSON.stringify(all))); replayView.onEvents(replay.events, replay.tick / 20); replayMini.m.frame(0);
      assert.equal(hashWorld(w), hashWorld(replay), 'replay: native start and JSON command playback have the same full hash');
      assert(sameBytes(v.groundPx, replayView.groundPx), 'replay: preview/start and same-log playback have byte-identical terrain including connections and curbs');
      assert.deepEqual(f.base.ops, replayMini.base.ops, 'replay: same-log minimap is operation-identical');
      const noView = view(replay, false), before = structuredClone(replay); noView.update(0, replay.tick / 20, new Set()); assert.deepEqual(replay, before, 'replay: valve leaves full same-log state unchanged');
      for (const item of [v, replayView, noView]) item.dispose();
    }
  },
  budget() {
    for (const map of [0, 1]) {
      const w = createWorld(1944); applyMap(w, map, 1); for (const side of [0, 1]) legalPlan(w, Array(8).fill(2), side);
      const on = view(w), off = view(w, false); on.update(0, 0, new Set()); off.update(0, 0, new Set()); const a = budget(on), b = budget(off);
      assert.deepEqual(a, b, 'budget: maximum affordable networks add zero calls and zero triangles including shadows');
      assert.equal(on.scene.children.length, off.scene.children.length); assert.equal(on.trench118.cells, 64, 'budget: fixture spends both sides full eight points on maximum cells');
      assert(a.calls <= 20 && a.triangles <= 80000, 'budget: structural opening stays within unchanged mobile limits');
      console.log(`  map${map}: ${on.trench118.cells} trench cells; structural ${a.calls} calls/${a.triangles} triangles (Chrome separately required)`); on.dispose(); off.dispose();
    }
  },
};
const only = process.argv.find(s => s.startsWith('--group='))?.slice(8) ?? (mutant ? mutations[mutant].group : undefined);
for (const [name, run] of Object.entries(groups)) if (!only || name === only) {
  try { run(); console.log(`OK trenches-view ${name}`); }
  catch (error) { console.error(`NG trenches-view ${name}`); throw error; }
}
if (!only && !mutant || process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 15000 });
  assert.equal(p.status, 1, `${name}: isolated mutant must exit 1\n${p.stdout}\n${p.stderr}`);
  const first = p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1];
  assert.equal(first, m.message, `${name}: first failure must be intended semantic assertion, not startup\n${p.stderr.slice(-3000)}`);
  assert(p.stderr.includes(`NG trenches-view ${m.group}`)); console.log(`RED trenches-view ${name}: ${first}`);
}
console.log('trenches-view: requested ground/canvas/lifecycle guards passed; actual Chrome pixels and frame budget remain separate');
