// R137: real Chromium input, read-only menu counts, isolated production negatives.
// No production hooks, synthetic DOM input, world mutation, or new dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, TICK_HZ, UK_MORTAR, UNIT_KINDS } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
import { bombardCommand } from '../src/ui/commandMenu.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r137-browser-'));
const receipts = { status: 'initializing', measurements: [], negatives: [], firstError: null };
const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
// Keep the complete native baseline and the isolated negative pairs in separate
// unit processes. Both retain the runner's original 120s ceiling and this test's
// 108s diagnostic deadline; no timeout is accepted as a semantic negative.
const negativeOnly = process.argv.includes('--r137-negatives-only');
// R067: the native live-death pair (normal + low FPS, valve on/off) runs in its own
// process too (bombard-eligibility-death-browser.mjs), with the same 120s ceiling and
// 108s deadline. Same assertions; only the process boundary moved.
const deathOnly = process.argv.includes('--r137-death-only');
const plain = value => JSON.parse(JSON.stringify(value));
const original = ['高爆砲擊', '煙幕（榴彈砲）', '取消'];
const note = '適用不查射程、裝填、煙幕存量';
const mutations = {
  counts: ['src/ui/commandMenu.ts', '${counts.he}', "${counts.he + (location.search.includes('__r137mutant=counts') ? 1 : 0)}"],
  refresh: ['src/main.ts', '  commandMenu?.frame();', "  if (!location.search.includes('__r137mutant=refresh')) commandMenu?.frame();"],
  death: ['src/ui/commandMenu.ts', '    if (!state) return;', "    if (!state) return;\n    if (location.search.includes('__r137mutant=death') && [...state.selected].some(id => state.world.units[id - 1]?.alive === false)) return;"],
  readonly: ['src/ui/commandMenu.ts', '    const counts = bombardEligibility(state.world, state.selected, aim);', "    if (location.search.includes('__r137mutant=readonly')) state.world.rng = (state.world.rng + 1) >>> 0;\n    const counts = bombardEligibility(state.world, state.selected, aim);"],
  routing: ['src/main.ts', 'bombardCommand(w, selected, target, chosen)', "bombardCommand(w, selected, target, location.search.includes('__r137mutant=routing') ? 'he' : chosen)"],
  close: ['src/ui/commandMenu.ts', 'const target = { ...aim }; close(); on.choose', "const target = { ...aim }; if (!location.search.includes('__r137mutant=close')) close(); on.choose"],
  valve: ['src/main.ts', "const V = valves(q);", "const V = Object.defineProperty(valves(q), 'r137', { get: () => location.search.includes('__r137mutant=valve') || q.get('noR137') !== '1' });"],   // R060：閥從閥表來
};
const applied = new Set();
function plugin(negative = false) {
  return {
    name: 'r137-readonly-world-and-isolated-negatives', enforce: 'pre',
    transform(code, id) {
      const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
      if (negative) for (const [name, [file, from, to]] of Object.entries(mutations)) if (rel === file) {
        assert.equal(code.split(from).length - 1, 1, `negative anchor: ${name}`);
        code = code.replace(from, to); applied.add(name);
      }
      if (rel === 'src/main.ts') {
        const anchor = '(window as unknown as { __rts: typeof rts }).__rts = rts;';
        assert.equal(code.split(anchor).length - 1, 1, 'fixture: read-only world anchor');
        code = code.replace(anchor, anchor + '\n(window as any).__r137 = { world: () => JSON.stringify(w) };');
        if (negative) code = "document.documentElement.dataset.r137Mutant = new URLSearchParams(location.search).get('__r137mutant') ?? '';\n" + code;
      }
      return code;
    },
    transformIndexHtml: { order: 'pre', handler(html) {
      return negative ? html.replace('</style>', 'html[data-r137-mutant="layout"] #command-menu button {height:20px;min-height:20px;}\nhtml[data-r137-mutant="disclosure"] #cm-eligibility {display:none;}\n</style>') : html;
    } },
  };
}
// Slow actual requestAnimationFrame callbacks, not the simulation clock. The raw
// frame barrier does not repair any menu/HUD state or call production callbacks.
const preload = `(()=>{const raw=requestAnimationFrame.bind(window);window.__r137Slow=false;window.__r137Rendered=0;window.requestAnimationFrame=cb=>raw(t=>{const go=t=>{window.__r137Rendered++;cb(t)};if(window.__r137Slow)setTimeout(()=>raw(go),160);else go(t)});window.__r137Frames=()=>new Promise(r=>raw(()=>raw(r)));})();`;
const mortarLog = [{ tick: 0, cmd: { t: 'eco', guns: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: UK_MORTAR } }];
const mortarTick = UNIT_KINDS[UK_MORTAR].buildTicks + 1;
const mortarId = runLog(createWorld(1944), mortarLog, mortarTick).units.find(u => u.alive && u.side === 0 && u.kind === UK_MORTAR)?.id;
assert(mortarId, 'fixture: original production commands spawn a real mortar');
const deathLog = [{ tick: 0, cmd: { t: 'attack', side: 1, ids: [5, 6, 7], target: 4 } }];
const combat = createWorld(1944);
step(combat, [deathLog[0].cmd]);
while (combat.units[3].alive && combat.tick < 2000) step(combat, []);
assert(!combat.units[3].alive && combat.winner < 0, 'fixture: ordinary combat naturally kills selected howitzer before battle ends');
const deathTick = combat.tick, beforeDeath = deathTick - 4 * TICK_HZ;
assert(runLog(createWorld(1944), deathLog, beforeDeath).units[3].alive, 'fixture: four live seconds before natural death');

const started0 = Date.now();
async function main() {
  assert.equal(hashWorld(runScript(1200)), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'golden: unchanged original full-state combat');
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin()], build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin(true)], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'all isolated source mutations applied once');
  if (process.argv.includes('--prepare-only')) {
    receipts.status = 'prepared-only; Chromium not run';
    console.log(`PREPARED R137 baseline and ${applied.size + 2} isolated negatives; Node death tick ${deathTick}; Chromium NOT RUN`);
    return;
  }
  receipts.status = 'running';
  const overlay = {}, started = Date.now();
  await withBrowser({ root: baseline, overlay, port: 8467, width: 412, height: 860, mobile: true, preload, settle: 70, chromeWaitMs: 20000, readyMs: 8000 }, async ({ open, page }) => {
    const bounded = async (task, label) => {
      const remaining = Math.min(8000, 108000 - (Date.now() - started));
      assert(remaining > 0, 'operational deadline exceeded; not a semantic negative');
      let timer;
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${label}`)), remaining); })]); }
      finally { clearTimeout(timer); }
    };
    const rawSend = page.send.bind(page), rawEvaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(rawSend(method, args), method);
    page.evaluate = expression => bounded(rawEvaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression);
    let width = 412, height = 860, mobile = true;
    const frames = async () => {
      const first = await E('__r137Rendered'), until = Date.now() + 2500;
      while ((await E('__r137Rendered')) < first + 2) {
        assert(Date.now() < until, 'frame barrier: actual animation callbacks must complete');
        await E('__r137Frames()'); await sleep(10);
      }
    };
    const snapshot = () => E(`(()=>{const m=document.getElementById('command-menu'),n=document.getElementById('cm-eligibility');return {world:JSON.parse(__r137.world()),log:__rts.log(),selected:__rts.selected(),cam:__rts.cam(),hash:__rts.hash(),paused:__rts.paused(),info:__rts.info(),open:!!m&&!m.hidden,target:document.getElementById('cm-target')?.textContent,buttons:[...m.querySelectorAll('button')].map(e=>({id:e.id,text:e.textContent,disabled:e.disabled})),note:n?.textContent??null,noteVisible:!!n&&n.getBoundingClientRect().height>0,children:[...m.children].map(e=>e.id),hint:document.getElementById('hint').textContent};})()`);
    const worldOnly = s => ({ world: s.world, selected: s.selected, log: s.log, hash: s.hash });
    const viewport = async w => {
      width = w; mobile = w !== 1440; height = w === 860 ? 412 : mobile ? 860 : 900;
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      // Native menu opening is touch-only by design, including on desktop. All
      // desktop selection/menu-button clicks below still use real mouse input.
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    };
    const fresh = async (off = false, mutant = '') => {
      await open(`noR018=1&noR006=1&noR016=1${off ? '&noR137=1' : ''}${mutant ? '&__r137mutant=' + mutant : ''}`);
      assert(await E('!!__rts?.ready'), 'fixture: actual RTS ready');
      await E('__rts.pause(true);__rts.runScript(0);__rts.focus(27,27,1)'); await frames();
      const s = await snapshot();
      assert(s.info.calls <= 20 && s.info.triangles <= 80000, 'budget: original quiet opening 20 calls / 80000 triangles');
      return s;
    };
    const tap = async (x, y, useTouch = mobile) => {
      if (useTouch) await touchTap(page, x, y);
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await frames();
    };
    const button = async id => {
      const b = await E(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
      assert(b.hit && b.w >= 44 && b.h >= 44, 'layout: real reachable 44px button ' + id);
      await tap(b.x, b.y);
    };
    const gunPoint = async () => {
      const p = await E('__rts.screenOf(4)');
      assert.equal(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName`), 'CANVAS', 'fixture: native howitzer point is unobstructed canvas');
      return p;
    };
    const hold = async () => {
      const before = await snapshot(), p = await gunPoint();
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p[0], y: p[1], id: 1 }] });
      await sleep(560); await frames();
      assert((await snapshot()).open, 'native: real longpress opens before release');
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await frames();
      const after = await snapshot();
      assert(after.open, 'native: opening release never accidentally chooses a menu button');
      assert.deepEqual(after.log, before.log, 'native: opening release emits no command');
      assert.deepEqual(after.selected, before.selected, 'native: opening release does not select again');
      if (before.paused) assert.deepEqual(worldOnly(after), worldOnly(before), 'readonly: opening and repeated refresh preserve complete world/RNG/selection/log');
      return after;
    };
    const target = s => {
      const m = /^砲擊格 (\d+) · (\d+)$/.exec(s.target);
      assert(m, 'native: actual frozen target is visible'); return { x: +m[1] - 1, z: +m[2] - 1 };
    };
    const counts = (s, off = false, group = 'counts') => {
      const expected = ['he', 'smoke'].map(ammo => bombardCommand(s.world, s.selected, target(s), ammo)?.ids.length ?? 0);
      assert.deepEqual(s.buttons.map(b => b.text), off ? original : [`高爆砲擊 · 適用 ${expected[0]}`, `煙幕（榴彈砲） · 適用 ${expected[1]}`, '取消'], `${group}: exact qualification from existing command, not readiness`);
      assert(s.buttons.every(b => !b.disabled), `${group}: zero qualification retains original clickable error path`);
      assert.equal(s.note, off ? null : note, `${group}: explicit qualification-only explanation / original valve markup`);
      assert.equal(s.noteVisible, !off, 'disclosure: explanation is visible only when enabled');
      assert.deepEqual(s.children, off ? ['cm-target', 'cm-he', 'cm-smoke', 'cm-cancel'] : ['cm-target', 'cm-eligibility', 'cm-he', 'cm-smoke', 'cm-cancel'], `${group}: valve preserves original child structure`);
    };
    const layout = async () => {
      const g = await E(`(()=>{const root=document.getElementById('command-menu'),rect=e=>e.getBoundingClientRect().toJSON();return {menu:rect(root),scroll:[root.scrollWidth-root.clientWidth,root.scrollHeight-root.clientHeight],buttons:[...root.querySelectorAll('button')].map(e=>{const r=rect(e);return {r,overflow:[e.scrollWidth-e.clientWidth,e.scrollHeight-e.clientHeight],hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}),obstacles:['#hud .btns','#hud .top','#hud .bottom','#minimap','#prodbar','#buildbar'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden).map(rect)}})()`);
      const m = g.menu, disjoint = (a, b) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
      assert(m.left >= 0 && m.top >= 0 && m.right <= width && m.bottom <= height, 'layout: native menu inside viewport');
      assert(g.scroll.every(n => n === 0), 'layout: native menu has no overflow/clipping');
      assert(g.buttons.every(b => b.r.width >= 44 && b.r.height >= 44 && b.hit && b.overflow.every(n => n === 0)), 'layout: all original actions >=44px, uncut and hit-testable');
      for (const r of g.obstacles) if (r.width && r.height) assert(disjoint(m, r), 'layout: menu avoids every original HUD/production/minimap rectangle');
      return g;
    };
    const screenshot = async name => {
      const r = await page.send('Page.captureScreenshot', { format: 'png' }), png = Buffer.from(r.data, 'base64');
      assert.equal(png.subarray(1, 4).toString(), 'PNG', 'artifact: actual Chromium PNG');
      assert.equal(png.readUInt32BE(16), width, 'artifact: exact viewport width');
      assert.equal(png.readUInt32BE(20), height, 'artifact: exact viewport height');
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'shots', name), png);
    };
    const replay = s => {
      const expected = runLog(createWorld(1944), s.log, s.world.tick);
      assert.equal(s.hash, hashWorld(expected), 'replay: independent Node full hash');
      assert.deepEqual(s.world, plain(expected), 'replay: independent complete Node world, not only hash');
    };
    const key = async (key, code, virtualKey) => {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey });
      await frames();
    };
    const choose = async (ammo, off, group = 'routing') => {
      const before = await snapshot(), want = bombardCommand(before.world, before.selected, target(before), ammo);
      await button('cm-' + ammo); const after = await snapshot();
      assert(!after.open, 'close: actual choose closes exactly once');
      assert.deepEqual(after.log.slice(before.log.length).map(l => l.cmd), want ? [want] : [], `${group}: native click follows unchanged bombardCommand path exactly once`);
      assert.deepEqual(after.world, before.world, 'readonly: paused native command stays queued until step');
      assert.equal(after.hint.includes(ammo === 'smoke' ? '已下煙幕指令' : '已下高爆砲擊指令'), !!want, `${group}: unchanged success feedback`);
      if (!want) assert(after.hint.includes(ammo === 'smoke' ? '請先選取榴彈砲' : '高爆砲擊需先選取'), `${group}: unchanged no-eligible error feedback`);
      return after;
    };
    const pausedSelection = async off => {
      const before = await snapshot();
      // Existing API filters duplicate/enemy/invalid IDs; pure R137 tests cover
      // raw iterable edge cases which a real native selection cannot contain.
      await E('__rts.select([1,4,4,5,999])'); await frames();
      let s = await snapshot(); assert.deepEqual(s.selected, [1, 4], 'selection: existing API deduplicates and filters enemy/invalid'); counts(s, off, 'refresh');
      await E('__rts.select([1,9])'); await frames(); counts(await snapshot(), off, 'refresh');
      await E('__rts.select([])'); await frames(); s = await snapshot(); counts(s, off, 'refresh');
      assert(s.open && s.world.tick === before.world.tick, 'refresh: same paused tick and menu stay open');
      assert.deepEqual(s.world, before.world, 'readonly: paused selection refresh preserves world');
      assert.deepEqual(s.log, before.log, 'readonly: selection refresh never sends commands');
      await E('__rts.select([1,4])'); await frames(); counts(await snapshot(), off, 'refresh');
    };
    const mixedProduction = async off => {
      await fresh(off);
      await E(`__rts.playLog(1944,${JSON.stringify(mortarLog)},${mortarTick});__rts.pause(true);__rts.focus(27,27,1);__rts.select([1,4,${mortarId},${mortarId},5,999])`); await frames();
      const before = await snapshot(); assert.deepEqual(before.selected, [1, 4, mortarId], 'mixed: real tank/howitzer/produced mortar selection');
      const s = await hold(); counts(s, off); const g = await layout();
      assert.equal(bombardCommand(s.world, s.selected, target(s), 'he').ids.length, 2, 'mixed: HE includes both indirect weapon kinds');
      assert.equal(bombardCommand(s.world, s.selected, target(s), 'smoke').ids.length, 1, 'mixed: smoke still excludes the produced mortar');
      assert.equal(s.info.calls, before.info.calls, 'budget: mixed production menu adds zero calls');
      assert.equal(s.info.triangles, before.info.triangles, 'budget: mixed production menu adds zero triangles');
      await screenshot(`r137-412-produced-mortar-${off ? 'off' : 'on'}.png`);
      receipts.measurements.push({ width, off, label: 'produced-mortar', tick: s.world.tick, counts: s.buttons.map(b => b.text), geometry: g, calls: s.info.calls, triangles: s.info.triangles });
      await choose('smoke', off); counts(await hold(), off); await choose('he', off);
      await E('__rts.stepN(2)'); await frames(); const end = await snapshot(); replay(end);
      return { world: end.world, log: end.log, cam: end.cam, selected: end.selected };
    };
    const liveDeath = async (off, slow = false, mutant = '') => {
      await fresh(off, mutant);
      await E(`__rts.playLog(1944,${JSON.stringify(deathLog)},${beforeDeath});__rts.pause(true);__rts.focus(27,27,1);__rts.select([4])`); await frames();
      counts(await hold(), off, 'death');
      const initial = await snapshot(); assert(initial.world.units[3].alive, 'fixture: selected howitzer alive when native menu opens');
      if (slow) await E('__r137Slow=true;__r137Rendered=0');
      await key(' ', 'Space', 32); // A real existing keyboard action, preserving the open menu.
      const until = Date.now() + 12000; let live, polls = 0;
      do {
        live = await snapshot(); polls++;
        assert(!live.paused && live.open, 'death: actual battle runs while the native menu remains open');
        counts(live, off, 'death');
        if (!live.world.units[3].alive) break;
        await sleep(70);
      } while (Date.now() < until);
      assert(!live.world.units[3].alive && polls > 1, 'death: real simulation killed selected howitzer during observation');
      assert.deepEqual(live.selected, initial.selected, 'death: no API selection or fake removal repaired the count');
      replay(live);
      if (slow) {
        const callbacks = await E('__r137Rendered');
        assert(callbacks > 0 && callbacks < 50, 'lowfps: actual animation callbacks throttled during live combat');
      }
      await key(' ', 'Space', 32); const paused = await snapshot(); counts(paused, off, 'death'); replay(paused);
      const frozen = worldOnly(paused); await frames();
      assert.deepEqual(worldOnly(await snapshot()), frozen, 'readonly: post-death paused refresh leaves full state unchanged');
      if (!mutant) {
        await screenshot(`r137-${width}-native-death-${slow ? 'lowfps' : 'normal'}-${off ? 'off' : 'on'}.png`);
        receipts.measurements.push({ width, off, label: 'live-death', slow, tick: live.world.tick, polls, counts: live.buttons.map(b => b.text), hash: live.hash });
      }
      if (slow) await E('__r137Slow=false');
      await choose('smoke', off, 'death'); // Dead-only selection stays enabled and reports original error.
      // Equal tick/camera after native proof provides exact on/off full-world parity.
      await E(`__rts.playLog(1944,${JSON.stringify(deathLog)},${deathTick + 2});__rts.pause(true);__rts.focus(27,27,1)`); await frames();
      const fixed = await snapshot(); replay(fixed); return { world: fixed.world, log: fixed.log, cam: fixed.cam };
    };

    if (!negativeOnly) {
    if (!deathOnly) {
    for (const w of [1440, 412, 860]) {
      await viewport(w); const modes = [];
      for (const off of [false, true]) {
        const errorCount = page.errors.length, opening = await fresh(off);
        const point = await gunPoint(); await tap(...point);
        assert.deepEqual((await snapshot()).selected, [4], 'native: actual mouse/touch selects single howitzer');
        const before = await snapshot(), opened = await hold(); counts(opened, off);
        const geometry = await layout();
        assert.equal(opened.info.calls, before.info.calls, 'budget: opening DOM menu adds zero draw calls');
        assert.equal(opened.info.triangles, before.info.triangles, 'budget: opening DOM menu adds zero triangles');
        await screenshot(`r137-${width}-menu-${off ? 'off' : 'on'}.png`);
        receipts.measurements.push({ width, height, off, label: 'menu', openingCalls: opening.info.calls, openingTriangles: opening.info.triangles, selectedCalls: opened.info.calls, selectedTriangles: opened.info.triangles, geometry, cam: opened.cam, counts: opened.buttons.map(b => b.text) });
        await pausedSelection(off);
        const beforeCancel = await snapshot(); await button('cm-cancel'); const canceled = await snapshot();
        assert(!canceled.open, 'cancel: native cancel closes');
        assert.deepEqual(worldOnly(canceled), worldOnly(beforeCancel), 'cancel: native cancel changes no world/selection/command');
        counts(await hold(), off); await choose('smoke', off);
        counts(await hold(), off); await choose('he', off);
        await E('__rts.select([])'); await frames(); counts(await hold(), off); await choose('smoke', off);
        await E('__rts.select([1])'); await frames(); counts(await hold(), off); await choose('he', off);
        await E('__rts.select([4])'); await frames(); counts(await hold(), off); await key('Escape', 'Escape', 27);
        assert(!(await snapshot()).open, 'cancel: real Escape closes and clears selection');
        await E('__rts.stepN(2)'); await frames(); const end = await snapshot(); replay(end);
        assert.equal(page.errors.length, errorCount, 'browser: zero new JS/console errors');
        modes.push({ world: end.world, log: end.log, cam: end.cam, selected: end.selected, menuCamera: opened.cam, openingCalls: opening.info.calls, openingTriangles: opening.info.triangles, menuButtonSizes: geometry.buttons.map(b => [b.r.width, b.r.height]), hint: end.hint });
      }
      assert.deepEqual(modes[0], modes[1], 'valve: identical full world/log/selection/camera/original button sizes and behavior');
    }
    await viewport(412);
    assert.deepEqual(await mixedProduction(false), await mixedProduction(true), 'valve: real produced mortar commands and complete world match');
    } else {
    await viewport(412);
    const deathOn = await liveDeath(false, true), deathOff = await liveDeath(true, false);
    assert.deepEqual(deathOn, deathOff, 'valve: real death evidence then equal-tick full-world/log/camera replay');
    }
    assert.equal(page.errors.length, 0, 'browser: all native/mixed/death fixtures have zero console errors');
    } else {

    // Each mutant changes one production behavior. Run its identical untouched
    // case first in this process; timeouts/setup failures never count as a red.
    await viewport(412);
    const brokenHTML = fs.readFileSync(path.join(broken, 'index.html'), 'utf8');
    const negatives = {
      counts: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); counts(await hold()); },
      refresh: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); counts(await hold()); await pausedSelection(false); },
      readonly: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); await hold(); },
      layout: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); await hold(); await layout(); },
      disclosure: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); counts(await hold()); },
      routing: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); await hold(); await choose('smoke', false); },
      close: async mutant => { await fresh(false, mutant); await E('__rts.select([4])'); await hold(); await choose('smoke', false); },
      valve: async mutant => { await fresh(true, mutant); await E('__rts.select([4])'); counts(await hold(), true, 'valve'); },
      death: async mutant => { await liveDeath(false, true, mutant); },
    };
    for (const [name, run] of Object.entries(negatives)) {
      delete overlay['index.html'];
      await run('');
      assert.equal(page.errors.length, 0, `baseline ${name}: no browser errors`);
      overlay['index.html'] = brokenHTML;
      let failure;
      try { await run(name); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError, `negative ${name}: must fail semantically, not timeout/bootstrap`);
      assert(failure.message.startsWith(name + ':'), `negative ${name}: first red must be its own contract, got ${failure.message}`);
      const red = { name, firstRed: failure.message.split('\n')[0] }; receipts.negatives.push(red); console.log('RED R137 ' + JSON.stringify(red));
    }
    delete overlay['index.html'];
    }
  });
  receipts.status = 'passed real Chromium';
  console.log(negativeOnly
    ? 'OK R137 9 independent native baseline / exact-first-red negative pairs; unchanged operational deadline'
    : deathOnly
      ? `OK R137 native live deaths, low FPS, complete replay and valve parity (412; separate process, ${Date.now() - started0} ms)`
      : `OK R137 native longpress/mouse/touch, qualification, mixed production, complete replay, rollback and 3 viewports (live deaths: bombard-eligibility-death-browser; ${Date.now() - started0} ms)`);
}
try { await main(); }
catch (e) {
  receipts.firstError = String(e.stack || e); console.error(e);
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  try { fs.writeFileSync(path.join(ROOT, 'shots/r137-browser-first-error.txt'), receipts.firstError, { flag: 'wx' }); } catch (saveError) { if (saveError.code !== 'EEXIST') throw saveError; }
  const unavailable = /listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(String(e));
  process.exitCode = unavailable && !strictCI ? 77 : 1;
  receipts.status = process.exitCode === 77 ? 'not run: Chromium unavailable' : 'failed';
  if (process.exitCode === 77) console.error('NOT RUN local Chromium unavailable; official CI required');
  console.error('R137 FIRST RED ' + String(e.message).replace(/\n/g, ' '));
} finally {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots/r137-browser-receipt.json'), JSON.stringify(receipts, null, 2));
  fs.rmSync(temp, { recursive: true, force: true });
}
