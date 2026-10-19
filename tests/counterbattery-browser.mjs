// R115: production Chrome pixels, independent analytic geometry, and native mouse/touch input.
// Mutants exist only in a second temporary Vite build; no production debug hook is added.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB } from '../src/sim/world.ts';
import { runLog, spotted } from '../src/sim/step.ts';
import { runScript, SCRIPT } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r115-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = s => { summary.push(s); console.log(s); };
const digest = s => createHash('sha256').update(s).digest('hex');
const ticks = [0, 374, 514, 654, 1253, 1254];
// These numbers are the card's fixed independent geometric contract, not counterbatteryAreas().
const shapes = { 374: [4, 4, 8, 6], 514: [2, 2, 4, 3], 654: [3, 3, 2, 1.5], 1253: [3, 3, 2, 1.5], 754: [3, 3, 2, 1.5] };
const worlds = new Map([...ticks, 600].map(t => [t, runScript(t)]));
const movingLog = [...SCRIPT, { tick: 654, cmd: { t: 'move', side: 1, ids: [8], x: 8, z: 2 } }].sort((a, b) => a.tick - b.tick);
const moving = runLog(createWorld(1944), movingLog, 754);
const ecoLog = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }, { tick: 0, cmd: { t: 'fireAt', side: 1, ids: [8], x: 12, z: 10 } }];
const eco = runLog(createWorld(1944), ecoLog, 281);
const hits = new Set();
const plugin = {
  name: 'r115-isolated-counterbattery-mutants', enforce: 'pre',
  transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
    const replace = (from, to, label) => {
      assert.equal(code.split(from).length - 1, 1, `unique isolated source anchor: ${label}`);
      code = code.replace(from, to); hits.add(label);
    };
    if (rel === 'src/ui/counterbattery.ts') {
      code += '\nlet r115PreviousAreas: Array<{ x: number; z: number; rx: number; rz: number; level: number }> = [];\n';
      replace('  if (!enabled) return;', "  if (!enabled || location.search.includes('__r115mutant=paint')) return;", 'paint');
      replace('  counterbatteryAreasInto(w, SIDE_PLAYER, AREA_BUFFER);\n  const areas = AREA_BUFFER.areas;', `  counterbatteryAreasInto(w, SIDE_PLAYER, AREA_BUFFER);
  const areas = AREA_BUFFER.areas;
  if (location.search.includes('__r115mutant=stale')) {
    if (AREA_BUFFER.count) r115PreviousAreas = areas.slice(0, AREA_BUFFER.count).map(area => ({ ...area }));
    else {
      for (let k = 0; k < r115PreviousAreas.length; k++) Object.assign(areas[k], r115PreviousAreas[k]);
      AREA_BUFFER.count = r115PreviousAreas.length;
    }
  }`, 'stale');
      replace('ctx.closePath(); ctx.clip();', "ctx.closePath(); if (!location.search.includes('__r115mutant=clip')) ctx.clip();", 'clip');
      replace('    const area = areas[i];', `    let area = areas[i];
    if (location.search.includes('__r115mutant=coarse')) area = { ...area, x: 4 * SUB, z: 4 * SUB, rx: 8 * SUB, rz: 6 * SUB };
    if (location.search.includes('__r115mutant=fine')) area = { ...area, x: 3 * SUB, z: 3 * SUB, rx: 2 * SUB, rz: 1.5 * SUB };
    if (location.search.includes('__r115mutant=cell')) {
      const r = (w.counterbattery ?? []).filter(r => r.side === SIDE_PLAYER)[i];
      if (r) area = { ...area, x: ((r.zone % 4) * 8 + (r.cell % 4) * 2 + 1) * SUB, z: (Math.floor(r.zone / 4) * 8 + Math.floor(r.cell / 4) * 2 + 1) * SUB };
    }
    if (location.search.includes('__r115mutant=follow') && w.tick >= 754) {
      const hidden = w.units.find(u => u.id === 8);
      if (hidden) area = { ...area, x: hidden.x, z: hidden.z };
    }`, 'precision and hidden movement');
    }
    if (rel === 'src/main.ts') {
      replace("const r115 = q.get('noR115') !== '1';", "const r115 = q.get('__r115mutant') === 'valve' || q.get('noR115') !== '1';", 'valve');
      replace('if (w !== lastCounterbatteryWorld || counterbatteryInfo !== lastCounterbatteryInfo)', "if ((q.get('__r115mutant') !== 'hint' && w !== lastCounterbatteryWorld) || counterbatteryInfo !== lastCounterbatteryInfo)", 'same-tick HUD');
    }
    return code;
  },
};

function fixture() {
  for (const [t, level] of [[374, 1], [514, 2], [654, 3], [1253, 3]]) {
    const w = worlds.get(t), r = w.counterbattery?.filter(r => r.side === 0);
    assert.deepEqual(r, [{ side: 0, zone: 0, cell: 5, shots: level, last: t === 1253 ? 654 : t }], `fixture: fixed SCRIPT report at ${t}`);
    assert(!spotted(w, 0, w.units[7].x, w.units[7].z), 'fixture: source is actually hidden');
  }
  assert(!worlds.get(1254).counterbattery?.some(r => r.side === 0), 'fixture: exact 600-tick expiry and no later enemy shot');
  assert(moving.units[7].x > 5 * SUB && !spotted(moving, 0, moving.units[7].x, moving.units[7].z), 'fixture: source really moved while hidden');
  assert.deepEqual(moving.counterbattery.filter(r => r.side === 0), worlds.get(654).counterbattery.filter(r => r.side === 0), 'fixture: no new shot during movement');
  assert(eco.eco && eco.counterbattery.some(r => r.side === 0 && r.shots === 3), 'fixture: production and level-three intelligence coexist');
}

// Project independent world-space analytic ellipses onto the 32-cell diamond. A 720-sample
// smooth curve deliberately differs from the production 40-sided implementation.
function changes(on, off) {
  assert.equal(on.width, off.width); assert.equal(on.height, off.height);
  const points = [];
  for (let i = 0; i < on.pixels.length; i += 4) {
    if (Math.max(...[0, 1, 2, 3].map(k => Math.abs(on.pixels[i + k] - off.pixels[i + k]))) > 8)
      points.push([(i / 4) % on.width + 0.5, Math.floor(i / 4 / on.width) + 0.5]);
  }
  return points;
}
function checkShape(on, off, shape, label) {
  const points = changes(on, off), w = on.width, s = w / 64;
  assert(points.length >= 8, `${label}: visible orange raster exists, including the smallest mobile ring`);
  const outside = points.filter(([px, py]) => {
    const x = (px - w / 2 + 2 * py) / (2 * s), z = (2 * py - px + w / 2) / (2 * s);
    // Canvas anti-aliasing may straddle the mathematical clipping boundary by one pixel.
    const margin = 1.3 * Math.sqrt(5) / (2 * s);
    return x < -margin || z < -margin || x > 32 + margin || z > 32 + margin;
  });
  assert.equal(outside.length, 0, `${label}: no orange raster outside the map diamond`);
  const [x, z, rx, rz] = shape;
  const expected = Array.from({ length: 720 }, (_, i) => {
    const a = i * Math.PI / 360, xx = x + rx * Math.cos(a), zz = z + rz * Math.sin(a);
    return [w / 2 + (xx - zz) * s, (xx + zz) * s / 2];
  });
  const bad = points.filter(([px, py]) => !expected.some(([ex, ey]) => (px - ex) ** 2 + (py - ey) ** 2 <= 1.8 ** 2));
  assert(bad.length <= 1, `${label}: raster follows independently specified center and uncertainty axes (${bad.length}/${points.length} outside)`);
  const strongOrange = on.pixels.reduce((n, v, i, p) => n + (i % 4 === 0 && v >= 240 && p[i + 1] >= 155 && p[i + 1] <= 195 && p[i + 2] >= 45 && p[i + 2] <= 100 ? 1 : 0), 0);
  assert(strongOrange >= 5, `${label}: orange dashes are visibly distinguishable at native CSS scale`);
  return points.length;
}

async function main() {
  fixture();
  const started = Date.now(), baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(hits.size, 6, 'all isolated semantic source mutations applied');
  const overlay = {}, offBySize = new Map();
  await withBrowser({ root: baseline, overlay, port: 8435, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 70 }, async ({ open, page }) => {
    const bounded = async (task, label) => {
      const ms = Math.min(8000, 110000 - (Date.now() - started));
      if (ms <= 0) throw Error('R115 browser operational deadline exceeded');
      let timer;
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${label}`)), ms); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression);
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const settle = async () => { await sleep(120); await frames(); };
    const state = () => E('({tick:__rts.tick(),hash:__rts.hash(),log:__rts.log(),phase:__rts.phase()})');
    const hint = () => E('document.getElementById("hint").textContent');
    const sample = () => E(`(()=>{const c=document.getElementById('minimap');return {width:c.width,height:c.height,pixels:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data),webgl:document.querySelector('body>canvas').toDataURL(),calls:__rts.info().calls,triangles:__rts.info().triangles,hud:document.querySelector('#hud .top').textContent}})()`);
    const viewport = async mobile => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };
    const fresh = async (query = '') => {
      await open('noR018=1&noR016=1&' + query);
      assert(await E('!!window.__rts?.ready'), 'fixture: production application ready');
      await E('__rts.pause(true)');
    };
    const replay = async (t, mode = 'script') => {
      const expected = mode === 'script' ? worlds.get(t) : mode === 'move' ? moving : eco;
      const call = mode === 'script' ? `__rts.runScript(${t})` : `__rts.playLog(1944,${JSON.stringify(mode === 'move' ? movingLog : ecoLog)},${t})`;
      assert.equal(await E(call), hashWorld(expected), `fixture: Chrome ${mode} ${t} matches current independent Node replay`);
      await E('__rts.pause(true);__rts.focus(16,16,0.65)'); await settle();
    };
    // reset(false) preserves pause but clears the HUD through ui(). Do not call pause(),
    // select(), or any other HUD updater after this replacement: that would rescue the mutant.
    const replacePaused = async t => {
      assert(await E('__rts.paused()'), 'fixture: same-tick replacement starts paused');
      assert.equal(await E(`__rts.runScript(${t})`), hashWorld(worlds.get(t)), 'fixture: same-tick replacement matches Node');
      await E('__rts.focus(16,16,0.65)'); await settle();
      assert.equal(await E('__rts.tick()'), t, 'fixture: same-tick replacement never advances');
    };
    const click = async (x, y, mobile) => {
      if (mobile) await touchTap(page, x, y);
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await settle();
    };
    const button = async (id, mobile) => {
      const p = await E(`(()=>{const b=document.getElementById(${JSON.stringify(id)}),r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,r.width,r.height,document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b]})()`);
      assert(p[4] && p[2] >= 44 && p[3] >= 44, 'fixture: native button is an unobstructed touch target');
      await click(p[0], p[1], mobile);
    };
    const shot = async (name, closeup = false) => {
      const clip = closeup ? await E(`(()=>{const r=document.getElementById('minimap').getBoundingClientRect();return {x:r.x-4,y:r.y-4,width:r.width+8,height:r.height+8,scale:3}})()`) : undefined;
      const png = await page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(png.data, 'base64'));
    };
    const sameScene = (on, off, label) => {
      assert.equal(digest(on.webgl), digest(off.webgl), `${label}: minimap intelligence creates no precise main-scene model or effect`);
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `${label}: zero added WebGL calls or triangles`);
      assert(on.calls <= 22 && on.triangles <= 80000, `${label}: unchanged hot-spot budget`);
      assert.equal(on.hud, off.hud, `${label}: visible-enemy HUD count is unchanged`);
      const red = p => { const out = []; for (let i = 0; i < p.length; i += 4) if (p[i] === 255 && p[i + 1] === 90 && p[i + 2] === 60) out.push(i); return out; };
      assert.deepEqual(red(on.pixels), red(off.pixels), `${label}: no additional precise enemy minimap dot`);
    };
    const layout = async label => {
      const g = await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),m=document.getElementById('minimap'),bar=document.querySelector('#hud .btns');return {hint:h.getBoundingClientRect().toJSON(),prod:p.getBoundingClientRect().toJSON(),mini:m.getBoundingClientRect().toJSON(),bar:bar.getBoundingClientRect().toJSON(),shown:!p.hidden,scroll:h.scrollHeight,client:h.clientHeight,width:innerWidth,height:innerHeight,buttons:[...p.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`);
      assert(g.shown && g.prod.bottom <= g.hint.top - 6 && g.hint.bottom <= g.height && g.hint.right <= g.width && g.hint.top >= 0 && g.scroll <= g.client, `${label}: new hint stays visible above no controls and below production with clearance`);
      assert(g.mini.bottom < g.prod.top && g.bar.bottom <= g.mini.top, `${label}: minimap, production and command toolbar do not overlap`);
      assert(g.buttons.every(b => b.w >= 44 && b.h >= 44 && b.hit), `${label}: production touch targets remain usable`);
    };
    const baselineCase = async mobile => {
      const size = mobile ? 'mobile' : 'desktop', off = new Map(); await viewport(mobile); await fresh('noR115=1');
      for (const t of ticks) {
        await replay(t); off.set(t, { image: await sample(), state: await state() });
        if ([374, 514, 654].includes(t)) await shot(`r115-${size}-level${t === 374 ? 1 : t === 514 ? 2 : 3}-off.png`, true);
      }
      await replay(754, 'move'); off.set('move', { image: await sample(), state: await state() });
      await replay(281, 'eco'); off.set('eco', { image: await sample(), state: await state() });
      assert(!(await hint()).includes('疑似敵砲'), `${size}: noR115 hides the new hint`);
      offBySize.set(size, off);
      await fresh();
      for (const t of ticks) {
        await replay(t); const image = await sample(), before = await state(), old = off.get(t);
        if (shapes[t]) {
          const count = checkShape(image, old.image, shapes[t], `${size} ${t}`);
          assert((await hint()).includes('疑似敵砲，非精確位置'), `${size} ${t}: HUD identifies uncertainty`);
          record(`R115 ${size} tick ${t}: ${count} changed minimap pixels; ${image.calls}/${image.triangles} WebGL unchanged`);
          if (t !== 1253) await shot(`r115-${size}-level${t === 374 ? 1 : t === 514 ? 2 : 3}.png`, true);
        } else {
          assert.deepEqual(image.pixels, old.image.pixels, `${size} ${t}: absent or expired information paints no pixels`);
          assert(!(await hint()).includes('疑似敵砲'), `${size} ${t}: absent or expired information leaves no hint`);
        }
        sameScene(image, old.image, `${size} ${t}`); assert.deepEqual(before, old.state, `${size} ${t}: valve changes no world, tick, command or RNG hash`);
        await frames(); assert.deepEqual(await state(), before, `${size} ${t}: paused refresh is read-only`);
      }
      // A second run at the same tick replaces the World object; neither cache nor old areas may survive.
      await replay(600); const first = await sample(); await replacePaused(600); assert.deepEqual((await sample()).pixels, first.pixels, `${size}: same-tick replay refresh is deterministic`);
      assert((await hint()).includes('疑似敵砲，非精確位置'), `${size}: same-tick world replacement restores the intelligence hint`);
      await replay(754, 'move'); const moved = await sample();
      checkShape(moved, off.get('move').image, shapes[754], `${size} hidden movement`); sameScene(moved, off.get('move').image, `${size} hidden movement`);
      assert.deepEqual(await state(), off.get('move').state, `${size}: hidden movement replay remains unchanged`);
      // A/B image comparisons are complete; exercise minimap input with a nonempty selection.
      const selected = await E('__rts.select([4])');
      assert.deepEqual(selected, [4], 'fixture: minimap interaction starts with a selected own gun');
      const saved = await state(), p = await E('__rts.miniPoint(23,23)'); await click(p[0], p[1], mobile); await sleep(450); await frames();
      const cam = await E('__rts.cam()'); assert(Math.abs(cam.x - 23) < 0.05 && Math.abs(cam.z - 23) < 0.05, `${size}: native minimap input still moves the camera`);
      assert.deepEqual(await E('__rts.selected()'), selected, `${size}: native minimap input preserves the selected own gun`);
      assert.deepEqual(await state(), saved, `${size}: minimap input does not lock a target or issue a command`);
      await replay(281, 'eco'); sameScene(await sample(), off.get('eco').image, `${size} production`); await layout(size); await shot(`r115-${size}-hud-production.png`);
      await button('b-restart', mobile);
      assert.equal(await E('__rts.phase()'), 'build', `${size}: native restart begins a new build`);
      assert(!(await hint()).includes('疑似敵砲'), `${size}: restart clears intelligence hint`);
      const restarted = await sample();
      assert(restarted.calls <= 20 && restarted.triangles <= 80000, `${size}: restart opening stays within budget`);
      await fresh('noR115=1'); await settle(); assert.deepEqual((await sample()).pixels, restarted.pixels, `${size}: native restart has no previous intelligence raster`);
      await fresh('noR015=1'); await replay(654);
      assert.equal(await E('document.getElementById("minimap")'), null, `${size}: noR015 creates no minimap canvas`);
      assert(!(await hint()).includes('疑似敵砲'), `${size}: noR015 leaves no orphan intelligence hint`);
      record(`OK real Chrome ${size}: all three levels, exact expiry, replay, restart, native minimap, valves, HUD and unchanged WebGL`);
    };
    await baselineCase(false); await baselineCase(true);
    // Native click at a genuinely hidden gun must not become an exact-unit attack order.
    for (const mobile of [false, true]) {
      await viewport(mobile); await fresh(); await replay(654);
      await E('__rts.focus(28,28,0.8)'); await settle();
      const gun = await E('__rts.screenOf(4)');
      assert(await E(`document.elementFromPoint(${gun[0]},${gun[1]})===document.querySelector('body>canvas')`), 'fixture: own gun is natively selectable');
      await click(gun[0], gun[1], mobile); assert.deepEqual(await E('__rts.selected()'), [4], 'fixture: native selection selected own howitzer');
      await E('__rts.focus(2.5,2.5,0.8)'); await settle(); const hidden = await E('__rts.screenOf(8)'), n = (await state()).log.length;
      assert(await E(`document.elementFromPoint(${hidden[0]},${hidden[1]})===document.querySelector('body>canvas')`), 'fixture: hidden-source screen location is unobstructed');
      await click(hidden[0], hidden[1], mobile); const issued = (await state()).log.slice(n).map(x => x.cmd);
      assert(issued.length > 0 && issued.every(c => c.t !== 'attack' || c.target !== 8), `${mobile ? 'mobile' : 'desktop'}: intelligence never makes a hidden unit targetable`);
    }
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negative = async (name, run, intended) => {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (error) { failure = error; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(intended), `negative ${name}: first red must be intended semantic assertion; got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no unrelated runtime or fixture error`);
      record(`RED real Chrome ${name}: ${intended}`);
    };
    for (const [mutant, t, mobile, ending] of [
      ['paint', 654, true, 'visible orange raster exists'],
      ['coarse', 514, false, 'raster follows independently specified center'],
      ['fine', 374, false, 'raster follows independently specified center'],
      ['cell', 374, false, 'raster follows independently specified center'],
      ['clip', 374, false, 'no orange raster outside the map diamond'],
      ['follow', 754, false, 'raster follows independently specified center'],
    ]) {
      await negative(mutant, async () => {
        await viewport(mobile); await fresh(`__r115mutant=${mutant}`); await replay(t, mutant === 'follow' ? 'move' : 'script');
        checkShape(await sample(), offBySize.get(mobile ? 'mobile' : 'desktop').get(mutant === 'follow' ? 'move' : t).image, shapes[t], `negative ${mutant}`);
      }, `negative ${mutant}: ${ending}`);
    }
    await negative('stale', async () => {
      await viewport(true); await fresh('__r115mutant=stale'); await replay(1253); await replay(1254);
      assert.deepEqual((await sample()).pixels, offBySize.get('mobile').get(1254).image.pixels, 'expiry: exact boundary removes all previous orange pixels');
    }, 'expiry: exact boundary removes all previous orange pixels');
    await negative('valve', async () => {
      await viewport(true); await fresh('noR115=1&__r115mutant=valve'); await replay(654);
      assert.deepEqual((await sample()).pixels, offBySize.get('mobile').get(654).image.pixels, 'valve: noR115 restores exact old minimap raster');
    }, 'valve: noR115 restores exact old minimap raster');
    await negative('hint', async () => {
      await viewport(true); await fresh('__r115mutant=hint'); await replay(600);
      assert((await hint()).includes('疑似敵砲，非精確位置'), 'fixture: first world has its intelligence hint');
      await replacePaused(600);
      assert((await hint()).includes('疑似敵砲，非精確位置'), 'freshness: same-tick world replacement restores the visible intelligence hint');
    }, 'freshness: same-tick world replacement restores the visible intelligence hint');
    assert.equal(page.errors.length, 0, 'all production and isolated mutant pages have no runtime errors');
    record(`R115 browser completed within ${Date.now() - started}ms operational wall time`);
  });
}
try {
  await main();
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### R115 real counterbattery Chrome guards\n${summary.map(s => '- ' + s).join('\n')}\n`);
} catch (error) {
  const message = String(error?.stack ?? error);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message) && !strictCI) {
    console.error('NOT RUN R115 real Chrome guards: local socket permission restriction; CI must execute them.'); console.error(error.message); process.exitCode = 77;
  } else { console.error(error); console.error(`R115 browser FAIL: ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
