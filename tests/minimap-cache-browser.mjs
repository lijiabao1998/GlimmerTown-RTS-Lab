// R112: real Chrome canvas pixels after world replacement and the ordinary restart button.
// Baseline and semantic mutants are isolated builds; no test hooks enter the shipped application.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { runScript as nodeScript } from '../src/sim/script.ts';
import { hashWorld } from '../src/sim/world.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r112-minimap-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = text => { summary.push(text); console.log(text); };
const digest = png => createHash('sha256').update(png).digest('hex');
// A pure UI guard follows the current simulation baseline, including independently merged work.
// The checked-in golden still independently anchors the full replay; never rewrite it here.
const expected = { 600: hashWorld(nodeScript(600)), 1200: hashWorld(nodeScript(1200)) };
const hits = new Set();
const plugin = {
  name: 'r112-isolated-minimap-mutants', enforce: 'pre',
  transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
    const changes = {
      'src/ui/minimap.ts': ['if (w !== baseWorld) baseDirty = true;', "if (!location.search.includes('__r112mutant=cache') && w !== baseWorld) baseDirty = true;"],
      'src/main.ts': ["const V = valves(q);", "const V = Object.defineProperty(valves(q), 'r015', { get: () => location.search.includes('__r112mutant=valve') || q.get('noR015') !== '1' });"],   // R060：閥從閥表來
    };
    if (changes[rel]) {
      const [from, to] = changes[rel];
      assert.equal(code.split(from).length - 1, 1, `unique isolated mutant anchor: ${rel}`);
      hits.add(rel); return code.replace(from, to);
    }
    return code;
  },
};

async function main() {
  assert.equal(expected[1200], JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'fixture: current Node replay agrees with the checked-in golden');
  const started = Date.now(), baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(hits.size, 2, 'both semantic source mutations applied');
  const overlay = {}, baselineBudgets = new Map();
  await withBrowser({ root: baseline, overlay, port: 8432, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 100 }, async ({ open, page }) => {
    const bounded = async (task, label) => {
      const ms = Math.min(8000, 110000 - (Date.now() - started));
      if (ms <= 0) throw new Error('R112 browser operational deadline exceeded');
      let timer;
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${label}`)), ms); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression);
    const frames = () => E('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const settleMap = async () => { await sleep(150); await frames(); };
    const snapshot = () => E('({tick:__rts.tick(),hash:__rts.hash(),log:__rts.log(),phase:__rts.phase()})');
    const pixels = () => E('document.getElementById("minimap").toDataURL()');
    const info = () => E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    const viewport = async mobile => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };
    const fresh = async (extra = '') => {
      await open('noR018=1&noR016=1&' + extra);
      assert(await E('!!window.__rts?.ready'), 'fixture: real application ready');
      await E('__rts.pause(true)'); await settleMap();
      assert.equal(await E('__rts.tick()'), 0, 'fixture: initial build is paused at tick zero');
    };
    const restart = async mobile => {
      const b = await E('(()=>{const b=document.getElementById("b-restart"),r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()');
      assert(b.hit && b.w >= 44 && b.h >= 44, 'fixture: ordinary restart is an unobstructed touch target');
      if (mobile) await touchTap(page, b.x, b.y);
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await settleMap();
    };
    const closeup = async name => {
      const png = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 65, width: 412, height: 260, scale: 1 } });
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(png.data, 'base64'));
    };
    const budget = (v, opening, label) => {
      assert(v.calls <= (opening ? 20 : 22) && v.triangles <= 80000, `${label}: existing rendering budget`);
    };
    const restartCase = async (name, mobile, mutant) => {
      await viewport(mobile); await fresh(mutant ? '__r112mutant=cache' : '');
      const original = await pixels(), initial = await snapshot(), opening = await info(); budget(opening, true, name);
      assert.equal(await E('__rts.playScript(600)'), expected[600], `${name}: event-driven script agrees with current Node replay`);
      await E('__rts.pause(true)'); await settleMap();
      const damaged = await pixels();
      assert.notEqual(damaged, original, 'fixture: prior script damage/map is visibly different from a fresh Rye map');
      budget(await info(), false, name);
      await restart(mobile);
      if (mobile) await closeup(mutant ? 'r112-minimap-before.png' : 'r112-minimap-after.png');
      const restored = await pixels();
      assert.equal(digest(restored), digest(original), `${name}: restart redraws the fresh world's minimap pixels`);
      assert.deepEqual(await snapshot(), initial, `${name}: restart restores the original world, tick, command log and phase`);
      assert.deepEqual(await info(), opening, `${name}: minimap repair adds no WebGL call or triangle`);
      await sleep(250); await frames();
      assert.deepEqual(await snapshot(), initial, `${name}: waiting while paused changes no simulation state or commands`);
      assert.equal(digest(await pixels()), digest(original), `${name}: paused minimap remains correct after further frames`);
      record(`R112 ${name}: fresh ${digest(original)}, damaged ${digest(damaged)}, restored ${digest(restored)}; ${opening.calls}/${opening.triangles}`);
    };
    const scriptCase = async mutant => {
      const name = 'script'; await viewport(true); await fresh(mutant ? '__r112mutant=cache' : '');
      // Independent path: normal tick events dirty the old same-object cache, even in the mutant.
      assert.equal(await E('__rts.playScript(600)'), expected[600], `${name}: event-driven reference hash`);
      await E('__rts.pause(true)'); await settleMap();
      const reference = await pixels();
      await fresh(mutant ? '__r112mutant=cache' : '');
      const rye = await pixels(); assert.notEqual(rye, reference, 'fixture: reference contains a different map from Rye');
      assert.equal(await E('__rts.runScript(600)'), expected[600], `${name}: bulk world replacement preserves hash`);
      await E('__rts.pause(true)'); await settleMap();
      assert.equal(digest(await pixels()), digest(reference), `${name}: bulk replacement redraws without waiting for a future terrain event`);
      const before = await snapshot(), rendering = await info(); budget(rendering, false, name);
      await sleep(250); await frames(); assert.deepEqual(await snapshot(), before, `${name}: refresh itself advances no ticks or commands`);
      assert.equal(digest(await pixels()), digest(reference), `${name}: correct base remains cached`);
      if (!mutant) baselineBudgets.set('script600', rendering);
      record(`R112 script: canvas ${digest(reference)}; ${rendering.calls}/${rendering.triangles}`);
    };
    const valveCase = async mutant => {
      const name = 'valve'; await viewport(true); await fresh('noR015=1' + (mutant ? '&__r112mutant=valve' : ''));
      assert(await E('!document.getElementById("minimap")'), `${name}: noR015 creates no minimap canvas`);
      assert.equal(await E('__rts.runScript(600)'), expected[600], `${name}: 600-tick hash unchanged`);
      await E('__rts.pause(true)'); await settleMap();
      assert.deepEqual(await info(), baselineBudgets.get('script600'), `${name}: minimap on/off has identical WebGL calls and triangles`);
      assert.equal(await E('__rts.runScript(1200)'), expected[1200], `${name}: 1200-tick hash unchanged`);
      await restart(true);
      assert(await E('!document.getElementById("minimap")'), `${name}: restart does not recreate disabled minimap`);
    };
    const cases = {
      restartDesktop: broken => restartCase('restartDesktop', false, broken),
      restartMobile: broken => restartCase('restartMobile', true, broken),
      script: scriptCase,
      valve: valveCase,
    };
    for (const [name, run] of Object.entries(cases)) {
      const errors = page.errors.length; await run(false);
      assert.equal(page.errors.length, errors, `${name}: no unrelated runtime errors`); record(`OK real Chrome ${name}`);
    }
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    for (const [name, run] of Object.entries(cases)) {
      const errors = page.errors.length; let failure = null;
      try { await run(true); } catch (error) { failure = error; }
      const expected = name.startsWith('restart') ? `${name}: restart redraws the fresh world's minimap pixels`
        : name === 'script' ? 'script: bulk replacement redraws without waiting for a future terrain event'
        : 'valve: noR015 creates no minimap canvas';
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(expected), `negative ${name}: expected first semantic pixel/valve assertion, got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no unrelated runtime error`);
      record(`RED real Chrome ${name}: ${expected}`);
    }
  });
}
try {
  await main();
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### R112 minimap world-cache guards\n${summary.map(s => '- ' + s).join('\n')}\n`);
} catch (error) {
  const text = String(error?.stack ?? error);
  const blocked = /listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(text);
  if (blocked && !strictCI) { console.error('NOT RUN R112 real Chrome guards: local socket permission restriction; CI must execute them.'); console.error(error.message); process.exitCode = 77; }
  else { console.error(error); console.error(`R112 browser FAIL: ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
