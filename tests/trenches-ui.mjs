// R118: execute actual build-bar DOM and main-controller functions. This is not browser layout evidence.
// --mutations proves each semantic negative fails its designated assertion, never a startup error.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, N, SIDE_PLAYER, SIDE_ENEMY, BK_COTTAGE, SHELL_HE } from '../src/sim/world.ts';
import { BUILD_KINDS, BUILD_KINDS_24, BUILD_POINTS, buildKind, buildError, applyBuild, enemyPlan } from '../src/sim/build.ts';
import { TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench } from '../src/sim/trenches.ts';
import { step, runLog } from '../src/sim/step.ts';
import { materialBuildDetail } from '../src/ui/materials.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { ui: read('../src/ui/build.ts'), main: read('../src/main.ts'), css: read('../index.html') };
const mutations = {
  picker: ['controls', 'ui', 'a.pickTrench?.(it.kind)', 'a.pickTrench?.(0)', 'controls: each native shape button selects its own kind'],
  hidden_shapes: ['controls', 'ui', "$('bb-trenches').hidden = s.trench === undefined;", "$('bb-trenches').hidden = true;", 'controls: selecting trenches exposes shapes'],
  rotation: ['controls', 'main', '(trenchRot + 1) % 4', '(trenchRot + 1) % 2', 'controls: four clockwise quarter turns'],
  preview: ['preview', 'main', "if (c.t === 'trench') applyTrench(pv, c);", "if (c.t === 'trench') void c;", 'preview: all four trench kinds exist in cloned world'],
  refund: ['budget', 'main', "(c.t === 'trench' ? trenchKind(c.kind) : buildKind(c.kind))?.cost", "(c.t === 'trench' ? { cost: 0 } : buildKind(c.kind))?.cost", 'budget: building and trench share eight points'],
  partial_pick: ['removal', 'main', 'trenchCells(c).some(([x, z]) => x === gx && z === gz)', 'c.x === gx && c.z === gz', 'removal: clicking a non-anchor occupied cell removes the whole bend'],
  reordered: ['start', 'main', 'for (const c of plan) issue(c);', 'for (const c of [...plan].reverse()) issue(c);', 'start: exact mixed command order survives formal issue'],
  leaked_picker: ['valve', 'main', '}, r118 ? TRENCH_KINDS.map', '}, true ? TRENCH_KINDS.map', 'valve: disabled presentation has no trench choice or shape row'],
  stale_minimap: ['dirty', 'main', " || e.e === 'trench'", '', 'dirty: trench event invalidates minimap immediately'],
  stale_plan: ['reset', 'main', "  plan = []; buildHint = ''; phase = build ? 'build' : 'battle';", "  buildHint = ''; phase = build ? 'build' : 'battle';", 'reset: previous mixed preview is discarded'],
  undersized: ['layout', 'css', '#buildbar button { min-height: 44px;', '#buildbar button { min-height: 38px;', 'layout: all build controls retain 44px touch height'],
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert.ok(m, `unknown mutation ${mutant}`);
  assert.ok(sources[m[1]].includes(m[2]), `mutation anchor: ${mutant}`);
  sources[m[1]] = sources[m[1]].replace(m[2], m[3]);
}
const { initBuildBar } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(sources.ui)).toString('base64')}`);
const plain = stripTypeScriptTypes(sources.main);
const fn = name => { const text = plain.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(text, `function ${name} present`); return text; };
const json = value => JSON.parse(JSON.stringify(value));
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
function controller(visual = true) {
  let root; const views = [], displayWorlds = [];
  const previous = { document: globalThis.document, innerHeight: globalThis.innerHeight };
  globalThis.innerHeight = 860;
  globalThis.document = { createElement: () => new Element(), getElementById: id => id === 'hint' ? { getBoundingClientRect: () => ({ top: 800 }) } : null, body: { appendChild: el => { root = el; } } };
  const mockView = () => ({ dispose() {}, snapshot() {}, onEvents() {}, setMarker() {}, buildingAt: () => null, groundAt: (x, z) => ({ x, z }), setWorld(w) { displayWorlds.push(w); } });
  const c = vm.createContext({
    structuredClone, createWorld, hashWorld, buildKind, buildError, applyBuild, enemyPlan, TRENCH_KINDS, trenchKind, trenchCells, trenchError, applyTrench, step, runLog, materialBuildDetail,
    BUILD_KINDS, BUILD_KINDS_24, BUILD_KINDS_NOW: BUILD_KINDS_24, BUILD_POINTS, SIDE_PLAYER, SIDE_ENEMY, BK_COTTAGE, N, SHELL_HE,
    w: emptyWorld(), view: mockView(), phase: 'build', plan: [], pickKind: BK_COTTAGE, pickRot: 0, pickTrench: -1, trenchRot: 0, buildHint: '', log: [], pending: [], selected: new Set(), acc: 0,
    r118: visual, r105: true, r109: false, r006: true, r018: false, r019: false, r026: false, r016: false, r004: true, r008: true, r009: true, r011: true, r014: true, r107: true, r104: true,
    q: new URLSearchParams(visual ? '' : 'noR118=1'), seed: 1944, fxOn: true, battleAudio: undefined, stats: {}, reportView: undefined, minimap: undefined, startBanner() {}, syncBattleAudio() {},
    newStats: () => ({}), statsStep() {}, ecoCmd: () => ({ t: 'eco' }), aiLevel: 2, innerWidth: 412, innerHeight: 860, simT: () => 0, hud: { update() {} }, ui() { c.buildBar?.update(); },
    BattleView: class { constructor(...args) { views.push(args); return mockView(); } },
    initBuildBar(items, actions, trenches) { c.actions = actions; c.items = items; c.trenches = trenches; return initBuildBar(items, actions, trenches); },
  });
  for (const key of ['TRENCH_LABEL', 'TRENCH_SHAPE', 'BUILD_LABEL', 'BUILD_WHY', 'BUILD_TIP']) {
    const source = plain.match(new RegExp(`const ${key}\\s*= [^]*?;`))?.[0]; assert.ok(source, `${key} source`); vm.runInContext(source, c);
  }
  const start = plain.indexOf('buildBar = initBuildBar('), end = plain.indexOf('\n\n// R117', start);
  assert.ok(start >= 0 && end > start, 'actual main build callbacks found');
  const points = plain.match(/const pointsLeft = [^]*?;\n/)?.[0]; assert.ok(points);
  const refresh = plain.match(/function refreshPreview\(\)[^\n]+/)[0];
  vm.runInContext(`${points}\n${fn('previewWorld')}\n${refresh}\n${fn('placeAt')}\n${fn('issue')}\n${fn('tick')}\n${fn('startBattle')}\n${fn('reset')}\n${plain.slice(start, end)}`, c);
  return { c, root, views, displayWorlds, left: () => vm.runInContext('pointsLeft()', c), close() { for (const [k, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value; } } };
}
const trench = (kind, x = 20, z = 20, rot = 0) => ({ t: 'trench', side: SIDE_PLAYER, kind, x, z, rot });
const cottage = (x = 18, z = 18) => ({ t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x, z });
function using(visual, f) { const h = controller(visual); try { f(h); } finally { h.close(); } }
const groups = {
  controls() { using(true, ({ c, root }) => {
    const $ = id => root.querySelector('#' + id), before = JSON.stringify(c.w);
    assert.equal(c.pickKind, BK_COTTAGE); assert.equal(c.pickTrench, -1);
    for (const id of ['bb-k0', 'bb-k1', 'bb-k2', 'bb-k6', 'bb-rot', 'bb-undo', 'bb-start']) assert.ok($(id), `old ID ${id}`);
    assert.equal($('bb-trenches').hidden, true); assert.equal($('bb-k1').getAttribute('aria-pressed'), 'true');
    assert.equal($('bb-trench').click(), true, 'choice stops propagation');
    assert.equal($('bb-trenches').hidden, false, 'controls: selecting trenches exposes shapes');
    assert.equal($('bb-trench').getAttribute('aria-expanded'), 'true'); assert.equal($('bb-k1').getAttribute('aria-pressed'), 'false');
    const labels = ['直段', '折線', '交通壕', '加固段'], costs = [1, 2, 1, 2], cover = [75, 75, 90, 50], shape = ['2格直線', '3格L形', '4格直線', '2格加固'];
    for (let k = 0; k < 4; k++) {
      assert.equal($('bb-t' + k).click(), true, 'shape stops propagation');
      assert.equal(c.pickTrench, k, 'controls: each native shape button selects its own kind'); assert.equal(c.trenchRot, 0, 'picking shape resets rotation');
      assert.equal($('bb-t' + k).getAttribute('aria-pressed'), 'true');
      assert.equal($('bb-detail').textContent, `${shape[k]} · 建材 ${costs[k]} · 承傷 ${cover[k]}% · 轉向 0°`);
      assert.match(c.buildHint, new RegExp(labels[k]));
      const rotations = []; for (let i = 0; i < 4; i++) { assert.equal($('bb-rot').click(), true); rotations.push(c.trenchRot); }
      assert.deepEqual(rotations, [1, 2, 3, 0], 'controls: four clockwise quarter turns');
    }
    $('bb-k0').click(); assert.equal(c.pickTrench, -1); assert.equal($('bb-trenches').hidden, true); assert.equal($('bb-detail').textContent, '磚造 · 耐久 210');
    $('bb-rot').click(); assert.equal(c.pickRot, 1); $('bb-rot').click(); assert.equal(c.pickRot, 0);
    assert.equal(JSON.stringify(c.w), before, 'selecting and rotating controls never edits simulation'); assert.deepEqual(c.plan, []);
    assert.equal(root.style.bottom, '66px', 'bar remains above dynamic hint');
    c.phase = 'battle'; c.buildBar.update(); assert.equal(root.hidden, true);
  }); },
  preview() { using(true, ({ c, displayWorlds }) => {
    const commands = [cottage(18, 18), trench(0, 20, 20), trench(1, 23, 20, 1), trench(2, 20, 24), trench(3, 26, 24)];
    c.plan = structuredClone(commands); const before = JSON.stringify(c.w), pv = c.previewWorld();
    assert.equal(pv.trenches?.segments.length, 4, 'preview: all four trench kinds exist in cloned world');
    assert.equal(pv.blds.length, 1); assert.deepEqual(json(pv.events), []); assert.equal(JSON.stringify(c.w), before, 'preview never mutates real world');
    const expected = structuredClone(c.w); for (const cmd of commands) { const err = cmd.t === 'build' ? applyBuild(expected, cmd) : applyTrench(expected, cmd); assert.equal(err, null, 'independent fixture legal'); } expected.events = [];
    assert.deepEqual(json(pv), json(expected), 'preview uses exact simulation rules'); c.refreshPreview(); assert.equal(displayWorlds.length, 1);
    // Rebuild from real world after cancellation; no segment or vegetation-clearing residue survives.
    c.plan = []; c.refreshPreview(); assert.equal(displayWorlds.at(-1).trenches, undefined); assert.equal(JSON.stringify(c.w), before);
  }); },
  budget() { using(true, ({ c, root, left }) => {
    c.plan = [cottage(), trench(0, 20, 20), trench(1, 23, 20), trench(2, 20, 24), trench(3, 26, 24)];
    c.buildBar.update(); assert.equal(left(), 1, 'budget: building and trench share eight points');
    assert.equal(root.querySelector('#bb-t1').classList.contains('dim'), true); assert.equal(root.querySelector('#bb-t0').classList.contains('dim'), false);
    c.actions.pickTrench(3); const before = JSON.stringify(c.w); c.placeAt(28, 27); assert.equal(c.plan.length, 5); assert.match(c.buildHint, /建材不夠（剩 1，加固段要 2）/); assert.equal(JSON.stringify(c.w), before);
    c.actions.undo(); assert.equal(left(), 3); assert.equal(c.plan.length, 4); assert.equal(c.previewWorld().trenches.segments.length, 3);
    c.actions.pickTrench(3); c.placeAt(28, 27); assert.equal(left(), 1); assert.equal(c.plan.length, 5);
  }); },
  removal() { using(true, ({ c, left }) => {
    c.plan = [trench(1)]; c.actions.pick(BK_COTTAGE); c.placeAt(21, 21);
    assert.equal(c.plan.length, 0, 'removal: clicking a non-anchor occupied cell removes the whole bend'); assert.equal(left(), 8); assert.equal(c.previewWorld().trenches, undefined);
    c.plan = [trench(1)]; c.placeAt(20, 21); assert.equal(c.plan.length, 2, 'bend empty corner is free for a cottage'); assert.equal(c.plan[1].t, 'build');
    c.view.buildingAt = () => [20, 21]; c.placeAt(20, 21); assert.equal(c.plan.length, 1); assert.equal(c.plan[0].t, 'trench', 'building removal never confuses overlapping kind codes');
    for (let rot = 0; rot < 4; rot++) { c.view.buildingAt = () => null; const cmd = trench(1, 24, 24, rot); c.plan = [cmd]; const [x, z] = trenchCells(cmd).at(-1); c.placeAt(x, z); assert.equal(c.plan.length, 0, 'any rotated occupied cell removes piece'); }
  }); },
  start() { using(true, ({ c }) => {
    const commands = [trench(0, 20, 20), cottage(18, 18), trench(1, 23, 20, 1)];
    const initial = structuredClone(c.w); c.plan = structuredClone(commands); c.startBattle();
    assert.deepEqual(json(c.log.map(e => e.cmd)), commands, 'start: exact mixed command order survives formal issue'); assert.equal(c.phase, 'battle'); assert.equal(c.plan.length, 0); assert.equal(c.w.tick, 1);
    const replay = structuredClone(initial); runLog(replay, JSON.parse(JSON.stringify(c.log)), 1); assert.equal(hashWorld(c.w), hashWorld(replay));
    assert.equal(c.w.trenches.segments.length, 2); assert.equal(c.w.blds.length, 1); const n = c.log.length; c.startBattle(); assert.equal(c.log.length, n);
  }); },
  valve() { for (const visual of [true, false]) using(visual, ({ c, root, views }) => {
    if (!visual) { assert.equal(root.querySelector('#bb-trench'), null, 'valve: disabled presentation has no trench choice or shape row'); assert.equal(root.querySelector('#bb-trenches'), null); assert.equal(root.html.includes('戰壕'), false, 'valve: old tooltips contain no new trench explanation'); }
    const cmds = [trench(0, 20, 20), cottage(18, 18)]; c.plan = structuredClone(cmds); c.startBattle(); const expected = emptyWorld(); runLog(expected, cmds.map(cmd => ({ tick: 0, cmd })), 1); assert.equal(hashWorld(c.w), hashWorld(expected), 'valve never filters recorded trench commands');
    c.reset(1944, false, false, false, false, false); assert.equal(views.at(-1).at(-2), visual, 'reset forwards presentation valve');   // R036：R104 的裝甲弧旗標排在最後，R118 是倒數第二
    const viewCalls = [...plain.matchAll(/new BattleView\([^;]+;/g)].map(m => m[0]); assert.equal(viewCalls.length, 2); assert.ok(viewCalls.every(call => /, r118, r104\);$/.test(call)), 'script replacement also forwards valve');
    assert.match(plain, /trenches: r118,/); assert.match(plain, /const r118 = q.get\('noR118'\) !== '1'/);
  }); },
  dirty() { using(true, ({ c }) => {
    let dirty = 0; c.minimap = { dirty() { dirty++; } }; c.step = w => { w.events = [{ e: 'trench' }]; w.tick++; }; c.tick(); assert.equal(dirty, 1, 'dirty: trench event invalidates minimap immediately');
    c.step = w => { w.events = []; w.tick++; }; c.tick(); assert.equal(dirty, 1, 'unchanged terrain does not invalidate per tick');
  }); },
  reset() { using(true, ({ c, displayWorlds }) => {
    c.plan = [cottage(), trench(0)]; c.refreshPreview(); c.reset(1944, true, false, false, false, false);
    assert.equal(c.plan.length, 0, 'reset: previous mixed preview is discarded'); assert.equal(displayWorlds.at(-1).trenches, undefined); assert.equal(c.w.trenches, undefined); assert.equal(c.buildHint, ''); assert.equal(c.log.length, 0);
  }); },
  layout() {
    const css = sources.css, rule = css.match(/#buildbar button\s*\{([^}]+)\}/)[1];
    assert.ok(Number(rule.match(/min-height:\s*(\d+)px/)[1]) >= 44, 'layout: all build controls retain 44px touch height');
    assert.ok(Number(rule.match(/min-width:\s*(\d+)px/)[1]) >= 44, 'layout: all build controls retain 44px touch width');
    assert.match(css, /#buildbar #bb-trenches\[hidden\]\s*\{\s*display:\s*none;/, 'hidden row cannot override browser hidden with flex display');
    assert.match(css, /#buildbar #bb-trenches button\s*\{\s*flex:\s*1;/, 'four shapes share one existing width');
  },
};
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant][0] !== name) continue;
  try { test(); console.log(`OK trenches-ui: ${name}`); } catch (e) { console.error(`NG trenches-ui: ${name}`); throw e; }
}
if (process.argv.includes('--mutations')) for (const [name, m] of Object.entries(mutations)) {
  const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 20000 });
  const output = p.stdout + p.stderr; assert.equal(p.status, 1, `${name}: must fail\n${output}`);
  assert.ok(output.includes(`NG trenches-ui: ${m[0]}`) && output.includes(m[4]), `${name}: designated semantic assertion must be first red\n${output}`);
  assert.doesNotMatch(output, /(?:ReferenceError|SyntaxError|TypeError):/, `${name}: startup/runtime errors are not evidence`);
  console.log(`OK trenches-ui mutation: ${name} -> ${m[4]}`);
}
console.log('trenches-ui: all OK (DOM/controller/CSS declarations only; Chrome owns actual layout)');
