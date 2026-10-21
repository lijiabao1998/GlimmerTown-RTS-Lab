import { reloadStatus } from '../src/ui/reloadStatus.ts';
// R107 UI guards. Real pure routing + main-controller snippets + a deliberately small DOM mock.
// CSS checks below are declaration/layout arithmetic, NOT a browser or real touch test.
// node tests/smoke-controls.mjs --mutations runs isolated, in-memory broken variants in child processes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, SUB, N, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sources = { route: read('../src/ui/smoke.ts'), hud: read('../src/ui/hud.ts'), main: read('../src/main.ts'), css: read('../index.html') };
const mutations = {
  filter: { group: 'filter', file: 'route', from: 'w.units[id - 1].kind === UK_HOWITZER', to: 'UNIT_KINDS[w.units[id - 1].kind].indirect' },
  priority: { group: 'priority', file: 'route', from: "if (fireMode && ammo === 'smoke')", to: "if (false && fireMode && ammo === 'smoke')" },
  compatibility: { group: 'compatibility', file: 'route', from: "...(smoke ? { ammo:", to: "...(true ? { ammo:" },
  controller: { group: 'controller', file: 'main', from: 'routeBattleOrder(w, selected, fireMode, ammo,', to: "routeBattleOrder(w, selected, fireMode, 'he'," },
  reset: { group: 'lifecycle', file: 'main', from: "selected.clear(); fireMode = false; ammo = 'he';", to: "selected.clear(); fireMode = false;" },
  valve: { group: 'lifecycle', file: 'main', from: "r009, r011, r014, r016, r107, q.get('noR113') !== '1', r118, r104, q.get('noR123') !== '1');", to: "r009, r011, r014, r016, true, q.get('noR113') !== '1', r118, r104, q.get('noR123') !== '1');" },
  hud: { group: 'hud', file: 'hud', from: "const smoke = s.ammo === 'smoke';", to: 'const smoke = false;' },
  layout: { group: 'layout', file: 'css', from: 'width: 44px; height: 44px; padding: 0;', to: 'width: 44px; height: 36px; padding: 0;' },
};
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice('--mutant='.length);
if (mutant) {
  const m = mutations[mutant]; assert.ok(m, `unknown mutation ${mutant}`);
  assert.ok(sources[m.file].includes(m.from), `${mutant}: mutation anchor exists`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
async function loadSource(source, base) {
  const js = stripTypeScriptTypes(source).replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, new URL(base, import.meta.url)).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { routeBattleOrder: route } = await loadSource(sources.route, '../src/ui/smoke.ts');
const { initHud } = await loadSource(sources.hud, '../src/ui/hud.ts');
const plain = stripTypeScriptTypes(sources.main);
const fn = name => { const s = plain.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0]; assert.ok(s, `main ${name} exists`); return s; };
const cmds = result => result?.commands ?? [];
const hit = overrides => ({ unit: 0, building: null, ground: { x: 16.2, z: 15.8 }, ...overrides });
function fixture() {
  const w = createWorld(1944), gun = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_HOWITZER);
  const tank = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_TANK);
  const observer = w.units.find(u => u.side === SIDE_PLAYER && u.kind === UK_OBSERVER);
  const foe = w.units.find(u => u.side === SIDE_ENEMY && u.kind === UK_TANK);
  const enemyGun = w.units.find(u => u.side === SIDE_ENEMY && u.kind === UK_HOWITZER);
  const add = (kind, alive = true) => { const u = { ...structuredClone(gun), id: w.units.length + 1, kind, alive }; w.units.push(u); return u; };
  const mortar = add(UK_MORTAR), infantry = add(UK_INFANTRY), deadGun = add(UK_HOWITZER, false);
  // An independent empty-ground fixture; building ray hits are supplied separately.
  w.occ.fill(0);
  return { w, gun, tank, observer, foe, enemyGun, mortar, infantry, deadGun };
}
function controller(visual = true) {
  const views = [], issued = [], placements = [];
  const mockView = () => ({ dispose() {}, setWorld() {}, visibleUnit: () => true, buildingAt: () => null, groundAt: () => ({ x: 16.2, z: 15.8 }), setMarker(...p) { this.marker = p; } });
  const c = vm.createContext({
    createWorld, hashWorld, runLog, routeBattleOrder: route,
    seed: 1944, r006: false, r018: false, r019: false, r026: false, r109: false, r015: true, r115: true, r118: true, reloadStatus, counterbatteryHint: () => '', battleHint: undefined,
    r004: true, r008: true, r009: false, r010: false, r011: true, r012: false, r014: true, r016: true, r104: true, fxOn: true,
    SIDE_PLAYER, SIDE_ENEMY, UK_HOWITZER, UK_TANK, UK_OBSERVER, UK_INFANTRY, UK_ATGUN: 4, UK_MORTAR,
    UNIT_KINDS: {}, N, SUB, SCRIPT_SEED: 1944, SCRIPT_TICKS: 1200, SCRIPT: [],
    q: new URLSearchParams(visual ? '' : 'noR107=1'),
    w: null, view: mockView(), selected: new Set(), fireMode: false, ammo: 'he', paused: false, phase: 'battle',
    log: [], pending: [], acc: 0, speed: 1, newStats: () => ({}), reportView: { hide() {} }, ui() {}, refreshPreview() {},
    innerWidth: 412, innerHeight: 860, issue: cmd => issued.push(cmd), simT: () => 0,
    pickUnit: () => 0, placeAt: (...p) => placements.push(p), performance: { now: () => 1000 }, lastTap: {},
    hud: { update() {} }, window: {},
    battleAudio: undefined, syncBattleAudio() {}, // R117 is absent in this legacy controller fixture.
    BattleView: class { constructor(...args) { views.push(args); return mockView(); } },
  });
  vm.runInContext(plain.match(/const r107 = [^\n]+/)[0], c);
  vm.runInContext(`${fn('reset')}\n${fn('order')}\n${fn('tap')}`, c);
  vm.runInContext(plain.slice(plain.indexOf('const rts = {')), c);
  // Capture the actual main callbacks rather than reimplementing their state transitions.
  c.initHud = a => { c.actions = a; return c.hud; };
  const a0 = plain.indexOf('hud = initHud({'), a1 = plain.indexOf('\n});', a0) + 4;
  vm.runInContext(plain.slice(a0, a1), c);
  c.reset(1944, false, false, false, false, false);
  return { c, views, issued, placements };
}

// This mock only implements APIs used by initHud. It performs no layout or hit testing.
class Element {
  constructor() { this.children = new Map(); this.events = new Map(); this.attrs = new Map(); this.textContent = ''; this.disabled = false; this.hidden = false; const values = new Set(); this.classList = { toggle: (s, on) => on ? values.add(s) : values.delete(s), contains: s => values.has(s) }; }
  set innerHTML(html) {
    this.html = html;
    for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
      const el = new Element();
      for (const a of tag[0].matchAll(/([\w-]+)="([^"]*)"/g)) el.attrs.set(a[1], a[2]);
      this.children.set(tag[1], el);
    }
  }
  querySelector(s) { return this.children.get(s.slice(1)) ?? null; }
  addEventListener(type, f) { this.events.set(type, f); }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k); }
  click() { if (this.disabled) return false; let stopped = false; this.events.get('click')?.({ stopPropagation() { stopped = true; } }); return stopped; }
}
const groups = {
  filter() {
    const { w, gun, tank, observer, enemyGun, mortar, infantry, deadGun } = fixture();
    const before = JSON.stringify(w), ids = [gun.id, tank.id, observer.id, enemyGun.id, mortar.id, infantry.id, deadGun.id, 999];
    const r = route(w, ids, true, 'smoke', hit());
    assert.deepEqual(cmds(r), [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], x: 16, z: 15, ammo: 'smoke' }]);
    for (const bad of [[], [tank.id], [mortar.id], [observer.id, infantry.id], [enemyGun.id, deadGun.id, 999]]) assert.equal(route(w, bad, true, 'smoke', hit()), null);
    assert.equal(JSON.stringify(w), before, 'routing only reads the world');
  },
  priority() {
    const { w, gun, tank, observer, foe, infantry } = fixture(), ids = [gun.id, tank.id, observer.id, infantry.id];
    const onEnemy = route(w, ids, true, 'smoke', hit({ unit: foe.id, building: [12, 13] }));
    assert.deepEqual(cmds(onEnemy), [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], x: Math.floor(foe.x / SUB), z: Math.floor(foe.z / SUB), ammo: 'smoke' }]);
    assert.deepEqual(cmds(route(w, ids, true, 'smoke', hit({ building: [12, 13] }))), [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], x: 12, z: 13, ammo: 'smoke' }]);
    assert.deepEqual(onEnemy.marker, { x: Math.floor(foe.x / SUB) + 0.5, z: Math.floor(foe.z / SUB) + 0.5, hostile: true });
    for (const ground of [null, { x: -1, z: 3 }, { x: N, z: 3 }, { x: 3, z: N }, { x: NaN, z: 3 }]) assert.equal(route(w, ids, true, 'smoke', hit({ ground })), null);
  },
  compatibility() {
    const { w, gun, tank, observer, foe, mortar, infantry } = fixture(), ids = [gun.id, tank.id, observer.id, mortar.id, infantry.id];
    assert.deepEqual(cmds(route(w, ids, true, 'he', hit())), [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id, mortar.id], x: 16, z: 15 }]);
    for (const ammo of ['he', 'smoke']) {
      assert.deepEqual(cmds(route(w, ids, false, ammo, hit())), [{ t: 'move', side: SIDE_PLAYER, ids, x: 16, z: 15 }]);
      assert.deepEqual(cmds(route(w, ids, false, ammo, hit({ unit: foe.id }))), [{ t: 'attack', side: SIDE_PLAYER, ids, target: foe.id }]);
    }
    assert.deepEqual(cmds(route(w, ids, true, 'he', hit({ unit: foe.id }))), [{ t: 'attack', side: SIDE_PLAYER, ids, target: foe.id }]);
    assert.deepEqual(cmds(route(w, ids, true, 'he', hit({ building: [12, 13] }))), [
      { t: 'move', side: SIDE_PLAYER, ids: [observer.id, infantry.id], x: 12, z: 13 },
      { t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id, tank.id, mortar.id], x: 12, z: 13 },
    ]);
    assert.deepEqual(cmds(route(w, [tank.id], true, 'he', hit())), [{ t: 'move', side: SIDE_PLAYER, ids: [tank.id], x: 16, z: 15 }]);
    // Preserve the existing ground-projection fallback when there is a live building in the cell.
    const b = w.blds[0]; w.occ[15 * N + 16] = b.id; b.hp = Math.max(1, b.hp);
    assert.deepEqual(cmds(route(w, ids, false, 'he', hit())), [{ t: 'fireAt', side: SIDE_PLAYER, ids, x: 16, z: 15 }]);
  },
  controller() {
    const { c, issued, placements } = controller();
    const { w, gun, tank, foe } = fixture(); c.w = w; c.selected.add(gun.id); c.selected.add(tank.id); c.pickUnit = () => foe.id;
    c.actions.toggleAmmo(); assert.equal(c.ammo, 'smoke'); assert.equal(c.fireMode, true);
    c.order(200, 300);
    assert.deepEqual(JSON.parse(JSON.stringify(issued)), [{ t: 'fireAt', side: SIDE_PLAYER, ids: [gun.id], x: Math.floor(foe.x / SUB), z: Math.floor(foe.z / SUB), ammo: 'smoke' }]);
    c.actions.toggleFire(); assert.equal(c.fireMode, false); c.order(200, 300); assert.equal(issued.at(-1).t, 'attack');
    c.actions.toggleAmmo(); assert.equal(c.ammo, 'he'); assert.equal(c.fireMode, false);
    // Friendly tap still selects, shift-tap toggles and does not accidentally issue smoke.
    c.pickUnit = () => gun.id; const n = issued.length; c.tap(20, 30, false); assert.deepEqual([...c.selected], [gun.id]);
    c.tap(20, 30, true); assert.equal(c.selected.size, 0); assert.equal(issued.length, n);
    c.phase = 'build'; c.order(200, 300); assert.deepEqual(placements, [[200, 300]]); assert.equal(issued.length, n);
  },
  lifecycle() {
    for (const visual of [true, false]) {
      const { c, views, issued } = controller(visual);
      for (const action of [() => c.reset(1944, false, false, false, false, false), () => c.window.__rts.runScript(0), () => c.window.__rts.playLog(1944, [], 0), () => c.window.__rts.playScript(0)]) {
        c.ammo = 'smoke'; c.fireMode = true; c.selected.add(4); const old = views.length;
        action();
        assert.equal(c.ammo, 'he', 'fresh/reset/replay resets ammo'); assert.equal(c.fireMode, false); assert.equal(c.selected.size, 0);
        assert.ok(views.length > old);
        for (const args of views.slice(old)) assert.equal(args[10], visual, 'every constructed BattleView receives noR107');
      }
      c.actions.toggleAmmo(); assert.equal(c.ammo, 'smoke', 'visual valve leaves smoke commands available');
      c.selected.add(4); c.order(200, 300); assert.equal(issued.at(-1).ammo, 'smoke', 'visual valve does not suppress smoke routing');
    }
  },
  hud() {
    let root; const prior = globalThis.document;
    globalThis.document = { createElement: () => new Element(), body: { appendChild: el => { root = el; } } };
    try {
      let s = { tick: 0, paused: false, speed: 1, fireMode: false, ammo: 'he', winner: -1, mine: 5, theirs: 0, tanks: 1, guns: 1, howitzers: 1, observers: 1 };
      let toggles = 0;
      const hud = initHud({ state: () => s, togglePause() {}, cycleSpeed() {}, toggleFire: () => { s.fireMode = !s.fireMode; }, toggleAmmo: () => { toggles++; s.ammo = s.ammo === 'he' ? 'smoke' : 'he'; s.fireMode = true; }, selectAll() {}, restart: () => { s = { ...s, ammo: 'he', fireMode: false, howitzers: 0 }; } });
      const ammo = root.querySelector('#b-ammo'), fire = root.querySelector('#b-fire'), hint = root.querySelector('#hint');
      assert.equal(ammo.textContent, '高爆'); assert.equal(ammo.getAttribute('aria-pressed'), 'false');
      assert.match(ammo.getAttribute('title'), /無傷害.*雙方視線/);
      assert.ok(ammo.click(), 'HUD stops click propagation'); assert.equal(toggles, 1);
      assert.equal(ammo.textContent, '煙幕'); assert.ok(ammo.classList.contains('on')); assert.equal(ammo.getAttribute('aria-pressed'), 'true');
      assert.ok(fire.classList.contains('on')); assert.equal(fire.getAttribute('aria-pressed'), 'true');
      assert.match(hint.textContent, /榴彈砲 1.*其他單位不動.*無傷害.*雙方視線/);
      fire.click(); assert.equal(fire.getAttribute('aria-pressed'), 'false'); assert.match(hint.textContent, /點地面＝移動.*點敵人＝攻擊/);
      fire.click(); s.howitzers = 0; hud.update(); assert.match(hint.textContent, /先點我方榴彈砲選取/);
      s.build = true; s.hint = '布陣提示'; hud.update(); assert.ok(root.classList.contains('build')); assert.equal(ammo.disabled, true); assert.equal(hint.textContent, '布陣提示'); ammo.click(); assert.equal(toggles, 1);
      s.build = false; delete s.hint; hud.update(); assert.equal(ammo.disabled, false);
      root.querySelector('#b-restart').click(); assert.equal(ammo.textContent, '高爆'); assert.equal(ammo.classList.contains('on'), false); assert.equal(fire.classList.contains('on'), false);
    } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
  },
  layout() {
    const css = sources.css, esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = selector => { const matches = [...css.matchAll(new RegExp(`${esc(selector)}\\s*\\{([^}]+)\\}`, 'g'))]; assert.ok(matches.length, selector); return matches.map(m => m[1]); };
    const cell = rule('#hud .btns button')[0], bar = rule('#hud .bar')[0];
    const px = (s, key) => { const n = s.match(new RegExp(`(?:^|;)\\s*${key}:\\s*([\\d.]+)px`)); assert.ok(n, key); return Number(n[1]); };
    const width = px(cell, 'width'), height = px(cell, 'height'), gap = px(bar, 'gap'), audioGap = px(rule('#hud.has-audio .btns')[0], 'gap');
    assert.ok(width >= 44 && height >= 44, '44×44 CSS target'); assert.match(cell, /box-sizing:\s*border-box/); assert.match(cell, /flex:\s*0 0 44px/);
    assert.equal(gap, 6, 'legacy HUD keeps original 6px gap'); assert.equal(audioGap, 4, 'only optional audio HUD uses 4px gap');
    const padding = bar.match(/padding:\s*(\d+)px (\d+)px/).slice(1).map(Number);
    const prior = globalThis.document; let rendered;
    globalThis.document = { createElement: () => new Element(), body: { appendChild: el => { rendered = el; } } };
    try {
      for (const [audio, expectedCount, expectedWidth] of [[false, 7, 360], [true, 8, 396]]) {
        initHud({ state: () => ({ tick: 0, paused: false, speed: 1, fireMode: false, winner: -1, mine: 1, theirs: 0, tanks: 0, guns: 0, observers: 0 }),
          togglePause() {}, cycleSpeed() {}, toggleFire() {}, toggleAmmo() {}, selectAll() {}, restart() {}, ...(audio ? { toggleAudio() {} } : {}) });
        const n = [...rendered.html.matchAll(/<button\b/g)].length;
        assert.equal(n, expectedCount, `${audio ? 'optional audio' : 'legacy'} HUD actually renders its contracted button count`);
        assert.equal(rendered.classList.contains('has-audio'), audio, 'compact spacing only exists with audio control');
        const totalWidth = n * width + (n - 1) * (audio ? audioGap : gap) + 2 * padding[1];
        assert.equal(totalWidth, expectedWidth, 'independent 7/8-button width contract');
        assert.ok(totalWidth + 16 <= 412, 'bar fits 412px with existing side insets');
        console.log(`CSS arithmetic only: 412×860; ${n} × ${width}×${height} targets; bar ${totalWidth}px`);
      }
    } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
    const titleRule = rule('#hud .top').at(-1), miniRule = rule('#minimap').at(-1);
    const offset = s => Number(s.match(/\+\s*(\d+)px/)[1]);
    const barBottom = 8 + height + 2 * padding[0], titleTop = 8 + offset(titleRule), titleBottom = titleTop + 12 * 1.4 + 2 * padding[0];
    assert.ok(titleTop >= barBottom + 2, 'mobile title clears enlarged controls');
    assert.ok(8 + offset(miniRule) >= titleBottom + 2, 'mobile minimap clears title');
    assert.match(css, /#hud\.build #b-ammo\s*\{\s*display:\s*none/);
    assert.match(rule('#hud button.on')[0], /background:.*border-color:/, 'selected ammo has existing visible style');
    console.log(`CSS arithmetic only: bar bottom ${barBottom}, title top ${titleTop}, minimap top ${8 + offset(miniRule)}`);
  },
};
for (const [name, test] of Object.entries(groups)) {
  if (mutant && mutations[mutant].group !== name) continue;
  try { await test(); console.log(`OK smoke-controls: ${name}`); }
  catch (e) { console.error(`NG smoke-controls: ${name}`); throw e; }
}
if (process.argv.includes('--mutations')) {
  for (const [name, m] of Object.entries(mutations)) {
    const p = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8' });
    assert.equal(p.status, 1, `${name}: isolated broken guard must fail\n${p.stdout}\n${p.stderr}`);
    assert.ok(p.stderr.includes(`NG smoke-controls: ${m.group}`), `${name}: intended group must be first red\n${p.stderr}`);
    console.log(`OK smoke-controls mutation: ${name} → first red ${m.group} (exit ${p.status})`);
  }
}
console.log('smoke-controls: all OK (mock DOM/CSS evidence; real browser touch not run)');
