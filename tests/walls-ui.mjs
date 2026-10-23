// R120: run the real build-bar DOM and main callbacks, including semantic negative controls.
// This fake DOM verifies behavior, not layout; walls-browser owns real Chrome hit testing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, N, SIDE_PLAYER, SIDE_ENEMY, BK_COTTAGE, BK_WIRE, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, isWallKind, bldMaxHp, SHELL_HE } from '../src/sim/world.ts';
import { WIRE_KIND, BUILD_KINDS, BUILD_KINDS_24, WALL_KINDS, BUILD_POINTS, buildKind, buildError, applyBuild, enemyPlan } from '../src/sim/build.ts';
import { TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench } from '../src/sim/trenches.ts';
import { step, runLog } from '../src/sim/step.ts';
import { materialBuildDetail } from '../src/ui/materials.ts';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { ui: read('../src/ui/build.ts'), main: read('../src/main.ts'), css: read('../index.html') };
const mutations = {
  picker: ['controls', 'ui', '() => a.pick(it.kind)', '() => a.pick(items[0].kind)', 'controls: each native wall button selects its own kind'],
  propagation: ['controls', 'ui', 'e.stopPropagation(); f();', 'f();', 'controls: wall clicks stop propagation'],
  hidden: ['rows', 'ui', "$('bb-walls').hidden = !wallSelected;", "$('bb-walls').hidden = true;", 'rows: choosing wall opens wall styles'],
  stacked: ['rows', 'ui', 's.trench === undefined && walls.some', 'walls.some', 'rows: trench selection hides wall styles'],
  rotation: ['controls', 'main', 'pickRot = 1 - pickRot', 'pickRot = 0', 'controls: wall rotates through both footprints'],
  warning: ['details', 'main', ' · 不可射越 · 可駐守', ' · 可駐守', 'details: wall restriction is visible, including with materials disabled'],
  garrison: ['details', 'main', ' · 不可射越 · 可駐守', ' · 不可射越', 'details: inherited garrison rule is visible'],
  preview: ['preview', 'main', 'else applyBuild(pv, c);', 'else if (!isWallKind(c.kind)) applyBuild(pv, c);', 'preview: all three wall kinds exist in cloned world'],
  budget: ['budget', 'main', '(c.t === \'trench\' ? trenchKind(c.kind) : buildKind(c.kind))?.cost', '(c.t === \'trench\' ? trenchKind(c.kind) : isWallKind(c.kind) ? { cost: 0 } : buildKind(c.kind))?.cost', 'budget: walls, cottage and trench share exactly eight points'],
  ground_remove: ['removal', 'main', 'if (wallIndex >= 0)', 'if (false && wallIndex >= 0)', 'removal: either rotated footprint cell removes the complete wall'],
  surface_remove: ['surface', 'main', "plan.splice(k, 1); buildHint = '拿掉了一棟'", "void k; buildHint = '拿掉了一棟'", 'surface: direct building hit still removes the complete wall'],
  undo: ['undo', 'main', 'if (plan.pop())', 'if (plan.at(-1))', 'undo: native undo removes only the last complete item'],
  start: ['start', 'main', 'for (const c of plan) issue(c);', 'for (const c of [...plan].reverse()) issue(c);', 'start: native start preserves exact mixed command order'],
  picker_valve: ['valve', 'main', 'r120 ? WALL_KINDS.map', 'true ? WALL_KINDS.map', 'valve: disabled wall presentation exposes no wall category or styles'],
  renderer_valve: ['valve', 'main', 'setWalls(r120);', 'setWalls(true);', 'valve: real query flag reaches the renderer'],
  reset: ['reset', 'main', "plan = []; buildHint = ''; phase = build ? 'build' : 'battle';", "buildHint = ''; phase = build ? 'build' : 'battle';", 'reset: new game discards all prior mixed plans'],
  enemy: ['enemy', 'main', 'const BUILD_KINDS_NOW = r024 ? BUILD_KINDS_24 : BUILD_KINDS;', 'const BUILD_KINDS_NOW = [...(r024 ? BUILD_KINDS_24 : BUILD_KINDS), ...WALL_KINDS];', 'enemy: player walls never join enemy build kinds'],
  size: ['layout', 'css', '#buildbar button { min-height: 44px;', '#buildbar button { min-height: 38px;', 'layout: every wall button inherits at least 44px height'],
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert.ok(m, `unknown mutation ${mutant}`);
  assert.equal(sources[m[1]].split(m[2]).length - 1, 1, `mutation anchor unique: ${mutant}`);
  sources[m[1]] = sources[m[1]].replace(m[2], m[3]);
}
const { initBuildBar } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.ui)).toString('base64')}`);
const plain = stripTypeScriptTypes(sources.main), json = v => JSON.parse(JSON.stringify(v));
const fn = name => { const s = plain.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(s, `actual ${name} found`); return s; };
const constant = name => { const s = plain.match(new RegExp(`const ${name}\\s*= [^]*?;`))?.[0]; assert.ok(s, `actual ${name} found`); return s; };
class Element {
  constructor() { this.children = new Map(); this.attrs = new Map(); this.events = new Map(); this.style = {}; this.hidden = false; this.textContent = ''; const classes = new Set(); this.classList = { toggle: (n, b) => b ? classes.add(n) : classes.delete(n), contains: n => classes.has(n) }; }
  set innerHTML(s) { this.html = s; for (const m of s.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) { const el = new Element(); el.hidden = /\bhidden\b/.test(m[0]); for (const a of m[0].matchAll(/([\w-]+)="([^"]*)"/g)) el.attrs.set(a[1], a[2]); this.children.set(m[1], el); } }
  querySelector(s) { return this.children.get(s.slice(1)) ?? null; }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k); }
  addEventListener(e, f) { this.events.set(e, f); }
  click() { let stopped = false; this.events.get('click')?.({ stopPropagation() { stopped = true; } }); return stopped; }
}
function emptyWorld() { const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.units = []; w.blds = []; w.events = []; return w; }
function controller(query = '') {
  let root; const displayWorlds = [], wallFlags = [], enemyArgs = [];
  const previous = { document: globalThis.document, innerHeight: globalThis.innerHeight };
  globalThis.innerHeight = 860;
  globalThis.document = { createElement: () => new Element(), getElementById: id => id === 'hint' ? { getBoundingClientRect: () => ({ top: 800 }) } : null, body: { appendChild: el => { root = el; } } };
  const mockView = () => ({ dispose() {}, snapshot() {}, onEvents() {}, setMarker() {}, buildingAt: () => null, groundAt: (x, z) => ({ x, z }), setWorld(w) { displayWorlds.push(w); } });
  const q = new URLSearchParams(query);
  const c = vm.createContext({
    MAP_LARGE, large: false, // Existing construction fixture; use the real map constant.
    structuredClone, createWorld, hashWorld, isWallKind, bldMaxHp, buildKind, buildError, applyBuild, TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench, step, runLog, materialBuildDetail,
    enemyPlan(w, kinds) { enemyArgs.push(kinds); return enemyPlan(w, kinds); }, setWalls: flag => wallFlags.push(flag),
    BK_WIRE, WIRE_KIND, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE, WALL_KINDS, BUILD_KINDS, BUILD_KINDS_24, BUILD_POINTS, SIDE_PLAYER, SIDE_ENEMY, BK_COTTAGE, N, SHELL_HE,
    w: emptyWorld(), view: mockView(), phase: 'build', plan: [], pickKind: BK_COTTAGE, pickRot: 0, pickTrench: -1, trenchRot: 0, buildHint: '', log: [], pending: [], selected: new Set(), acc: 0,
    r121: false, r118: q.get('noR118') !== '1', r105: q.get('noR105') !== '1', r024: q.get('noR024') !== '1', r109: false, r006: true, r018: false, r019: false, r026: false, r016: false, r004: true, r008: true, r009: true, r011: true, r014: true, r107: true, r104: true,
    q, seed: 1944, fxOn: true, battleAudio: undefined, stats: {}, reportView: undefined, minimap: undefined, startBanner() {}, syncBattleAudio() {}, window: {},
    newStats: () => ({}), statsStep() {}, ecoCmd: () => ({ t: 'eco' }), aiLevel: 2, innerWidth: 412, innerHeight: 860, simT: () => 0, hud: { update() {} }, ui() { c.buildBar?.update(); },
    BattleView: class { constructor() { return mockView(); } },
    initBuildBar(items, actions, trenches, walls) { c.actions = actions; c.items = items; c.wallItems = walls; return initBuildBar(items, actions, trenches, walls); },
  });
  const flag = plain.slice(plain.indexOf('const r120 ='), plain.indexOf('setWalls(', plain.indexOf('const r120 =')) + 'setWalls(r120);'.length);
  vm.runInContext(flag, c);
  for (const key of ['TRENCH_LABEL', 'TRENCH_SHAPE', 'BUILD_LABEL', 'BUILD_WHY', 'BUILD_TIP', 'BUILD_KINDS_NOW']) vm.runInContext(constant(key), c);
  const start = plain.indexOf('buildBar = initBuildBar('), end = plain.indexOf('\n\n// R117', start);
  assert.ok(start >= 0 && end > start, 'actual main callbacks found');
  const points = plain.match(/const pointsLeft = [^]*?;\n/)?.[0], refresh = plain.match(/function refreshPreview\(\)[^\n]+/)?.[0]; assert.ok(points && refresh);
  vm.runInContext(`${points}\n${fn('previewWorld')}\n${refresh}\n${fn('placeAt')}\n${fn('issue')}\n${fn('tick')}\n${fn('startBattle')}\n${fn('reset')}\n${plain.slice(start, end)}\n${plain.slice(plain.indexOf('const rts = {'))}`, c);
  return { c, root, displayWorlds, wallFlags, enemyArgs, left: () => vm.runInContext('pointsLeft()', c), close() { for (const [k, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; } } };
}
function using(query, f) { const h = controller(query); try { f(h); } finally { h.close(); } }
const wall = (kind, x = 18, z = 26, rot = 0) => ({ t: 'build', side: SIDE_PLAYER, kind, x, z, ...(rot ? { rot } : {}) });
const mixed = () => [wall(7), wall(8, 20, 26), wall(9, 22, 26, 1), { t: 'trench', side: 0, kind: 0, x: 18, z: 23, rot: 0 }, { t: 'build', side: 0, kind: 1, x: 26, z: 23 }];
const groups = {
  controls() { using('', ({ c, root }) => {
    const $ = id => root.querySelector('#' + id), before = JSON.stringify(c.w);
    assert.equal(c.pickKind, 1, 'old cottage is the default'); assert.equal(c.pickTrench, -1);
    for (const id of ['bb-k0', 'bb-k1', 'bb-k2', 'bb-k6', 'bb-trench', 'bb-rot', 'bb-undo', 'bb-start']) assert.ok($(id), `preserve old ${id}`);
    for (const kind of [7, 8, 9]) {
      assert.equal($('bb-k' + kind).click(), true, 'controls: wall clicks stop propagation');
      assert.equal(c.pickKind, kind, 'controls: each native wall button selects its own kind'); assert.equal(c.pickTrench, -1);
      assert.equal($('bb-k' + kind).getAttribute('aria-pressed'), 'true'); assert.equal($('bb-k1').getAttribute('aria-pressed'), 'false');
      const rotations = []; for (let i = 0; i < 2; i++) { assert.equal($('bb-rot').click(), true, 'rotation click stops propagation'); rotations.push(c.pickRot); }
      assert.deepEqual(rotations, [1, 0], 'controls: wall rotates through both footprints'); assert.equal(c.actions.state().rotatable, true);
    }
    assert.equal(JSON.stringify(c.w), before, 'pick/rotate never mutates simulation'); assert.deepEqual(c.plan, []);
    assert.equal($('bb-undo').click(), true, 'undo click stops propagation'); assert.equal($('bb-start').click(), true, 'start click stops propagation'); assert.equal(root.hidden, true);
  }); },
  rows() { using('', ({ c, root }) => {
    const $ = id => root.querySelector('#' + id);
    assert.equal($('bb-walls').hidden, true); assert.equal($('bb-trenches').hidden, true);
    assert.equal($('bb-wall').click(), true); assert.equal(c.pickKind, 7); assert.equal($('bb-walls').hidden, false, 'rows: choosing wall opens wall styles');
    assert.equal($('bb-wall').getAttribute('aria-expanded'), 'true'); assert.equal($('bb-trenches').hidden, true);
    $('bb-k9').click(); $('bb-trench').click(); assert.equal($('bb-walls').hidden, true, 'rows: trench selection hides wall styles'); assert.equal($('bb-trenches').hidden, false);
    assert.equal($('bb-wall').getAttribute('aria-expanded'), 'false'); $('bb-wall').click(); assert.equal(c.pickKind, 9, 'category remembers last wall kind'); assert.equal(c.pickTrench, -1); assert.equal($('bb-trenches').hidden, true);
    $('bb-k1').click(); assert.equal($('bb-walls').hidden, true); assert.equal($('bb-trenches').hidden, true); assert.equal(c.pickKind, 1);
  }); },
  details() { for (const query of ['', 'noR105=1']) using(query, ({ root }) => {
    for (const [kind, cost, hp] of [[7, 1, 130], [8, 2, 220], [9, 3, 360]]) {
      root.querySelector('#bb-k' + kind).click(); const detail = root.querySelector('#bb-detail');
      assert.equal(detail.hidden, false); assert.match(detail.textContent, new RegExp(`建材 ${cost} · 耐久 ${hp}`), 'exact cost/HP visible');
      assert.match(detail.textContent, /不可射越/, 'details: wall restriction is visible, including with materials disabled');
      assert.match(detail.textContent, /可駐守/, 'details: inherited garrison rule is visible'); assert.match(detail.textContent, /可破壞建築/);
    }
  }); },
  placement() { for (const kind of [7, 8, 9]) for (const rot of [0, 1]) using('', ({ c, root }) => {
    root.querySelector('#bb-k' + kind).click(); if (rot) root.querySelector('#bb-rot').click(); const before = JSON.stringify(c.w);
    c.placeAt(18, 26); assert.deepEqual(json(c.plan), [wall(kind, 18, 26, rot)], 'native wall choice and rotation reach build command');
    assert.equal(JSON.stringify(c.w), before, 'placing changes only preview plan'); const b = c.previewWorld().blds[0];
    assert.deepEqual([b.kind, b.w, b.d, b.hp], [kind, rot ? 1 : 2, rot ? 2 : 1, [130, 220, 360][kind - 7]]);
  }); },
  preview() { using('', ({ c, displayWorlds }) => {
    c.plan = mixed(); const before = JSON.stringify(c.w), pv = c.previewWorld();
    assert.deepEqual(json(pv.blds.filter(b => b.kind >= 7).map(b => b.kind)), [7, 8, 9], 'preview: all three wall kinds exist in cloned world');
    assert.equal(pv.blds.length, 4); assert.equal(pv.trenches.segments.length, 1); assert.deepEqual(json(pv.events), []); assert.equal(JSON.stringify(c.w), before);
    assert.deepEqual(json(pv.blds.filter(b => b.kind >= 7).map(b => [b.x, b.z, b.w, b.d, b.hp])), [[18, 26, 2, 1, 130], [20, 26, 2, 1, 220], [22, 26, 1, 2, 360]]);
    c.refreshPreview(); assert.equal(displayWorlds.at(-1).blds.length, 4); c.plan = []; c.refreshPreview(); assert.equal(displayWorlds.at(-1).blds.length, 0); assert.equal(displayWorlds.at(-1).trenches, undefined); assert.equal(JSON.stringify(c.w), before);
  }); },
  budget() { using('', ({ c, root, left }) => {
    c.plan = mixed(); c.buildBar.update(); assert.equal(left(), 0, 'budget: walls, cottage and trench share exactly eight points');
    for (const kind of [7, 8, 9]) assert.equal(root.querySelector('#bb-k' + kind).classList.contains('dim'), true);
    root.querySelector('#bb-k7').click(); c.placeAt(26, 28); assert.equal(c.plan.length, 5); assert.match(c.buildHint, /建材不夠（剩 0，矮磚牆要 1）/);
    root.querySelector('#bb-undo').click(); assert.equal(left(), 1); assert.equal(root.querySelector('#bb-k7').classList.contains('dim'), false); assert.equal(root.querySelector('#bb-k8').classList.contains('dim'), true);
    c.placeAt(26, 28); assert.equal(left(), 0); assert.equal(c.plan.at(-1).kind, 7);
  }); },
  removal() { for (const kind of [7, 8, 9]) for (const rot of [0, 1]) for (const end of [0, 1]) using('', ({ c, left }) => {
    c.plan = [wall(kind, 18, 26, rot)]; c.placeAt(18 + (rot ? 0 : end), 26 + (rot ? end : 0));
    assert.equal(c.plan.length, 0, 'removal: either rotated footprint cell removes the complete wall'); assert.equal(left(), 8); assert.equal(c.previewWorld().blds.length, 0);
    assert.equal(c.w.blds.length, 0, 'preview removal does not mutate real world');
  }); },
  surface() { using('', ({ c, left }) => {
    c.plan = [wall(9)]; c.view.buildingAt = () => [19, 26]; c.view.groundAt = () => null; c.placeAt(999, 999);
    assert.equal(c.plan.length, 0, 'surface: direct building hit still removes the complete wall'); assert.equal(left(), 8);
  }); },
  undo() { using('', ({ c, root, left }) => {
    const cmds = mixed(); c.plan = structuredClone(cmds);
    for (const [remaining, points] of [[4, 1], [3, 2], [2, 5], [1, 7], [0, 8]]) {
      root.querySelector('#bb-undo').click(); assert.equal(c.plan.length, remaining, 'undo: native undo removes only the last complete item'); assert.equal(left(), points); assert.deepEqual(json(c.plan), cmds.slice(0, remaining));
    }
    root.querySelector('#bb-undo').click(); assert.equal(c.plan.length, 0); assert.equal(c.w.blds.length, 0);
  }); },
  start() { using('', ({ c, root }) => {
    const cmds = mixed(); c.plan = structuredClone(cmds); root.querySelector('#bb-start').click();
    assert.deepEqual(json(c.log.map(e => e.cmd)), cmds, 'start: native start preserves exact mixed command order'); assert.equal(c.phase, 'battle'); assert.equal(c.plan.length, 0); assert.equal(c.w.tick, 1); assert.equal(c.w.blds.length, 4); assert.equal(root.hidden, true);
    const direct = emptyWorld(); runLog(direct, JSON.parse(JSON.stringify(c.log)), 1); assert.equal(hashWorld(c.w), hashWorld(direct), 'mixed log round trip reaches exact world');
    const len = c.log.length; c.startBattle(); assert.equal(c.log.length, len, 'start cannot issue commands twice');
  }); },
  valve() { const hashes = []; for (const query of ['', 'noR120=1', 'noR120=1&noR105=1&noR024=1&noR118=1']) using(query, ({ c, root, wallFlags }) => {
    const enabled = !query.includes('noR120=1');
    if (!enabled) { assert.equal(root.querySelector('#bb-wall'), null, 'valve: disabled wall presentation exposes no wall category or styles'); assert.equal(root.querySelector('#bb-walls'), null); for (const kind of [7, 8, 9]) assert.equal(root.querySelector('#bb-k' + kind), null); }
    assert.deepEqual(wallFlags, [enabled], 'valve: real query flag reaches the renderer');
    c.plan = mixed(); c.startBattle(); hashes.push(hashWorld(c.w)); assert.equal(c.w.blds.filter(b => b.kind >= 7).length, 3, 'recorded walls still execute with choices hidden');
    // Use actual main replay callback with a seeded terrain-clearing map-free log fixture.
    const replayLog = [{ tick: 0, cmd: { t: 'build', side: 0, kind: 7, x: 18, z: 26 } }];
    const direct = createWorld(1944); runLog(direct, replayLog, 2);
    assert.equal(c.window.__rts.playLog(1944, replayLog, 2), hashWorld(direct), 'actual replay callback is independent of wall presentation');
  }); assert.equal(new Set(hashes).size, 1, 'wall presentation valves leave full mixed world hash identical'); },
  reset() { using('', ({ c, displayWorlds }) => {
    c.plan = mixed(); c.refreshPreview(); c.reset(1944, true, false, false, false, false);
    assert.equal(c.plan.length, 0, 'reset: new game discards all prior mixed plans'); assert.equal(c.buildHint, ''); assert.equal(c.log.length, 0); assert.equal(c.w.trenches, undefined); assert.equal(displayWorlds.at(-1).blds.some(b => b.kind >= 7), false);
  }); },
  enemy() { for (const query of ['', 'noR024=1']) using(query, ({ c, enemyArgs }) => {
    c.plan = mixed(); c.startBattle(); const expected = query ? BUILD_KINDS : BUILD_KINDS_24;
    assert.deepEqual(enemyArgs[0].map(k => k.kind), query ? [1, 0, 2] : [1, 0, 2, 6], 'enemy: player walls never join enemy build kinds');
    assert.equal(enemyArgs[0], expected, 'enemy retains the exact original table object');
  }); },
  layout() {
    const css = sources.css, rule = css.match(/#buildbar button\s*\{([^}]+)\}/)[1];
    assert.ok(Number(rule.match(/min-height:\s*(\d+)px/)[1]) >= 44, 'layout: every wall button inherits at least 44px height');
    assert.ok(Number(rule.match(/min-width:\s*(\d+)px/)[1]) >= 44, 'minimum width remains at least44');
    assert.match(css, /#buildbar #bb-walls\[hidden\]\s*\{\s*display:\s*none;/); assert.match(css, /#buildbar #bb-walls button\s*\{\s*flex:\s*1;/);
  },
};
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant][0] !== name) continue;
  try { test(); console.log(`OK walls-ui: ${name}`); } catch (e) { console.error(`NG walls-ui: ${name}`); throw e; }
}
if (!mutant) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 20000 });
  const output = p.stdout + p.stderr; assert.equal(p.status, 1, `${name}: must fail\n${output}`);
  assert.ok(output.includes(`NG walls-ui: ${m[0]}`), `${name}: designated group ran\n${output}`);
  assert.equal(output.match(/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/)?.[1], m[4], `${name}: designated semantic assertion must be first red\n${output}`);
  assert.doesNotMatch(output, /(?:ReferenceError|SyntaxError|TypeError):/, `${name}: startup/runtime errors are not evidence`);
  console.log(`RED walls-ui ${name}: ${m[4]}`);
}
console.log(`walls-ui: ${mutant ? 'mutation probe' : `${Object.keys(groups).length} groups / ${Object.keys(mutations).length} designated negatives`} (DOM/controller/CSS declarations; Chrome owns layout)`);
