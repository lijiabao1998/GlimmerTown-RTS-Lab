// R113: actual WebGL pixels and ordinary desktop/touch selection, with isolated semantic mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB, UNIT_KINDS, UK_HOWITZER, SHELL_SMOKE } from '../src/sim/world.ts';
import { runLog, spotted } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r113-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = x => { summary.push(x); console.log(x); };
const hash = s => createHash('sha256').update(s).digest('hex');
const ecoLog = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }];
const ecoWorld = runLog(createWorld(1944), ecoLog, 1), script = runScript(1), gun = script.units[3];
const expected = { eco: hashWorld(ecoWorld), script: hashWorld(script), golden: hashWorld(runScript(1200)) };
const dx = (gun.tx + 0.5) * SUB - gun.x, dz = (gun.tz + 0.5) * SUB - gun.z;
const distance = Math.floor(Math.sqrt(dx * dx + dz * dz));
const offset = Math.floor(distance / 12) * (spotted(script, 0, (gun.tx + 0.5) * SUB, (gun.tz + 0.5) * SUB) ? 1 : 2);
// Analytic scatter circumference samples deliberately separated from the weapon-range rings.
// Neither points nor expected radius come from the preview implementation or its diagnostic API.
const scatterPoints = Array.from({ length: 24 }, (_, i) => {
  const a = i * Math.PI / 12, r = Math.SQRT2 * offset / SUB + 0.05;
  return [gun.tx + 0.5 + Math.cos(a) * r, gun.tz + 0.5 + Math.sin(a) * r];
}).filter(([x,z]) => {
  const d = Math.hypot(x - gun.x / SUB, z - gun.z / SUB), k = UNIT_KINDS[UK_HOWITZER];
  return Math.abs(d - k.range / SUB) > 0.8 && Math.abs(d - k.minRange / SUB) > 0.8;
});
const hit = new Set();
const plugin = {
  name: 'r113-isolated-browser-mutants', enforce: 'pre',
  transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
    const changes = {
      'src/main.ts': [
        ["const r113 = q.get('noR113') !== '1';", "const r113 = q.get('__r113mutant') === 'valve' || q.get('noR113') !== '1';"],
        ['  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));', "  if (q.get('__r113mutant') === 'paint' && view.range113) view.range113.mesh.visible = false;\n  if (q.get('__r113mutant') === 'scatter' && view.range113) view.range113.mesh.geometry.setDrawRange(0, Math.min(view.range113.mesh.geometry.drawRange.count, 2 * 96 * 6));\n  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));"],
        ['if (rangeInfo !== lastRangeInfo)', "if (q.get('__r113mutant') !== 'freshness' && rangeInfo !== lastRangeInfo)"],
      ],
      'src/ui/hud.ts': [
        ['if (s.hint === undefined && s.rangeInfo)', 'if (s.rangeInfo)'],
      ],
      'src/render/rangePreview.ts': [
        ['if (worldXZ.x < 0.0 || worldXZ.y < 0.0 || worldXZ.x > mapSize || worldXZ.y > mapSize) discard;', 'if (false) discard;'],
      ],
    };
    if (!changes[rel]) return;
    if (rel === 'src/main.ts') {
      const from = "r016, r107, q.get('noR113') !== '1');";
      assert.equal(code.split(from).length - 1, 2, 'both reset constructors retain the range valve');
      code = code.replaceAll(from, "r016, r107, q.get('__r113mutant') === 'valve' || q.get('noR113') !== '1');");
      hit.add('constructor valve');
    }
    for (const [from, to] of changes[rel]) {
      assert.equal(code.split(from).length - 1, 1, `unique source mutant anchor: ${rel}`);
      code = code.replace(from, to); hit.add(rel + ':' + from);
    }
    return code;
  },
};

async function main() {
  assert.equal(expected.golden, JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'fixture: Node replay still matches checked-in golden');
  const started = Date.now(), baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(hit.size, 6, 'all isolated semantic mutations applied');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8433, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 70 }, async ({ open, page }) => {
    const bounded = async (promise, label) => {
      const left = Math.min(8000, 112000 - (Date.now() - started));
      if (left <= 0) throw Error('R113 browser operational deadline exceeded');
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${label}`)), left); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression);
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const snapshot = () => E('({tick:__rts.tick(),hash:__rts.hash(),log:__rts.log(),phase:__rts.phase()})');
    const diag = () => E('__rts.rangePreview()');
    const hint = () => E('document.getElementById("hint").textContent');
    const info = () => E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    // Main WebGL canvas only: changing HTML hint height cannot manufacture this pixel difference.
    const pixels = () => E('document.querySelector("body>canvas").toDataURL()');
    const scatterPixels = () => E(`(()=>{const c=document.querySelector('body>canvas'),a=document.createElement('canvas');a.width=c.width;a.height=c.height;const ctx=a.getContext('2d');ctx.drawImage(c,0,0);const points=${JSON.stringify(scatterPoints)}.map(([x,z])=>__rts.screenOfPoint(x,0.045,z)).filter(p=>p[0]>5&&p[1]>5&&p[0]<innerWidth-5&&p[1]<innerHeight-5);return {count:points.length,pixels:points.flatMap(p=>Array.from(ctx.getImageData(Math.round(p[0])-3,Math.round(p[1])-3,7,7).data))};})()`);
    const viewport = async mobile => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };
    const fresh = async (extra = '', mode = 'eco') => {
      await open('noR018=1&noR016=1&' + extra); await E('__rts.pause(true)');
      if (mode === 'eco') assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(ecoLog)},1)`), expected.eco, 'fixture: exact eco replay');
      else if (mode === 'script') assert.equal(await E('__rts.runScript(1)'), expected.script, 'fixture: exact current Node script');
      await E('__rts.pause(true); __rts.focus(28,28,1)'); await frames();
    };
    const click = async (x, y, mobile) => {
      if (mobile) await touchTap(page, x, y);
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await frames();
    };
    const selectGun = async mobile => {
      const p = await E('__rts.screenOf(4)');
      assert(await E(`document.elementFromPoint(${p[0]},${p[1]}) === document.querySelector('body>canvas')`), 'fixture: ordinary gun selection is unobstructed');
      await click(p[0], p[1], mobile);
      assert.deepEqual(await E('__rts.selected()'), [4], 'fixture: native pointer selected the gun');
    };
    const button = async (id, mobile) => {
      const p = await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)];})()`);
      assert(p[2], 'fixture: button unobstructed'); await click(p[0], p[1], mobile);
    };
    const shot = async name => {
      const p = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(p.data, 'base64'));
    };
    const layout = async () => {
      const g = await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),r=h.getBoundingClientRect(),b=p.getBoundingClientRect();return {hint:r.toJSON(),prod:b.toJSON(),shown:!p.hidden,scroll:h.scrollHeight,client:h.clientHeight,width:innerWidth,height:innerHeight,buttons:[...p.querySelectorAll('button')].map(e=>{const q=e.getBoundingClientRect();return {w:q.width,h:q.height,hit:e.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))}})};})()`);
      assert(g.shown && g.prod.bottom <= g.hint.top - 6 && g.hint.bottom <= g.height && g.hint.top >= 0 && g.hint.right <= g.width && g.scroll <= g.client, 'selection: legend stays visible with production clearance');
      assert(g.buttons.every(b => b.w >= 44 && b.h >= 44 && b.hit), 'selection: production touch targets stay usable');
    };
    const selection = async (mobile, mutant) => {
      const name = mobile ? 'mobile' : 'desktop'; await viewport(mobile);
      await fresh('noR113=1'); await selectGun(mobile); const old = await pixels(), oldInfo = await info(), oldState = await snapshot();
      await fresh(mutant ? '__r113mutant=paint' : ''); await selectGun(mobile);
      const now = await pixels();
      assert.notEqual(hash(now), hash(old), `${name}: actual selected range pixels differ from valve-off`);
      const d = await diag();
      assert(d.shown && d.count === 2 && d.range === UNIT_KINDS[UK_HOWITZER].range / SUB && d.minRange === UNIT_KINDS[UK_HOWITZER].minRange / SUB, `${name}: current nominal range and near-limit circles`);
      assert((await hint()).includes('金圈射程') && (await hint()).includes('紅圈近限'), `${name}: visible legend identifies both rings`);
      assert.deepEqual(await snapshot(), oldState, `${name}: UI adds no tick, command or world change`);
      const rendering = await info();
      assert(rendering.calls === oldInfo.calls + 1 && rendering.triangles - oldInfo.triangles <= 576 && rendering.calls <= 22 && rendering.triangles <= 80000, `${name}: one-call bounded range geometry`);
      await layout();
      if (mobile) await shot('r113-mobile-range.png'); else await shot('r113-desktop-range.png');
      await button('b-all', mobile); assert(!(await diag()).shown && (await hint()).includes('請單選'), `${name}: multiple selection never chooses an arbitrary gun`);
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await frames();
      assert(!(await diag()).shown && !(await hint()).includes('金圈射程'), `${name}: clear removes geometry and legend while paused`);
      await button('b-restart', mobile); assert.equal(await E('__rts.phase()'), 'build');
      assert(!(await diag()).shown && !(await hint()).includes('金圈射程'), `${name}: restart/build never retains previous preview`);
      const opening = await info(); assert(opening.calls <= 20 && opening.triangles <= 80000, `${name}: unchanged opening budget`);
      record(`R113 ${name}: selected ${rendering.calls}/${rendering.triangles}, delta ${rendering.calls-oldInfo.calls}/${rendering.triangles-oldInfo.triangles}`);
    };
    const scatter = async mutant => {
      await viewport(true); await fresh('noR113=1', 'script'); await selectGun(true); await E('__rts.focus(10.5,10.5,0.8)'); await frames();
      const old = await scatterPixels(), oldInfo = await info();
      assert(old.count >= 4, 'fixture: several independently chosen scatter patches are on screen');
      await fresh(mutant ? '__r113mutant=scatter' : '', 'script'); await selectGun(true); await E('__rts.focus(10.5,10.5,0.8)'); await frames();
      assert.notDeepEqual((await scatterPixels()).pixels, old.pixels, 'scatter: scatter-only circumference pixels are painted');
      const before = await diag(), frozen = await snapshot();
      assert.equal(before.offset, offset, 'scatter: independent applied-order integer dispersion');
      assert.equal(before.scatterRadius, Math.SQRT2 * offset / SUB, 'scatter: square-corner upper bound, not one-axis radius');
      assert((await hint()).includes('散布上界') && before.aimX === gun.tx + 0.5 && before.aimZ === gun.tz + 0.5, 'scatter: visible legend and ordered cell center');
      const rendering = await info(); assert(rendering.calls === oldInfo.calls + 1 && rendering.triangles-oldInfo.triangles <= 576 && rendering.calls <= 22 && rendering.triangles <= 80000, 'scatter: budget stays bounded');
      await shot('r113-mobile-scatter.png');
      await E('__rts.focus(16,16,0.35)'); await frames(); await shot('r113-mobile-range-overview.png');
      await button('b-ammo', true); assert.deepEqual(await diag(), before, 'scatter: toolbar ammo does not change an applied firing task');
      await E("__rts.issue({t:'fireAt',side:0,ids:[4],x:24,z:24,ammo:'smoke'})"); await frames();
      assert.deepEqual(await diag(), before, 'scatter: queued paused order is not an applied solution');
      assert.equal((await snapshot()).hash, frozen.hash, 'scatter: queued order advances no simulation');
      await E('__rts.stepN(1)'); await frames(); const applied = await diag();
      assert.equal(applied.ammo, SHELL_SMOKE); assert.equal(applied.aimX, 24.5); assert((await hint()).includes('煙幕散布上界'), 'scatter: same-second applied order immediately updates legend');
      const appliedState = await snapshot(); await sleep(180); await frames(); assert.deepEqual(await snapshot(), appliedState, 'scatter: view refresh is read-only');
      await fresh('noR100=1', 'script'); await selectGun(true);
      assert.equal((await diag()).offset, offset, 'scatter: visual fog valve cannot shrink blind dispersion');
    };
    const freshness = async mutant => {
      await viewport(true); await fresh(mutant ? '__r113mutant=freshness' : '', 'script'); await selectGun(true);
      // Refresh the initial HUD once through an existing control, then change the applied order
      // without crossing a whole second. A correct diagnostic alone must not pass this guard.
      await E('__rts.pause(true)'); await frames();
      assert((await hint()).includes('高爆散布上界'), 'fixture: initial HE legend was rendered');
      const tick = await E('__rts.tick()');
      await E("__rts.issue({t:'fireAt',side:0,ids:[4],x:24,z:24,ammo:'smoke'});__rts.stepN(1)"); await frames();
      assert((await hint()).includes('煙幕散布上界'), 'freshness: visible applied-ammo legend changes within the same second');
      assert.equal(Math.floor(await E('__rts.tick()') / 20), Math.floor(tick / 20), 'freshness: no whole-second HUD refresh rescued the test');
    };
    const transient = async mutant => {
      await viewport(true); await fresh(mutant ? '__r113mutant=hint' : ''); await selectGun(true);
      const before = await diag(), oldPixels = await pixels(), oldHint = await hint(), oldInfo = await info(), frozen = await snapshot();
      assert(before.shown && before.count === 2, 'fixture: transient test has one armed selection and two circles');
      const p = await E('__rts.screenOf(4)');
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x:p[0], y:p[1], id:1 }] }); await sleep(650); await frames();
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await frames();
      assert(await E('!!document.querySelector("#command-menu:not([hidden])")'), 'fixture: real hold opened command menu');
      assert((await hint()).includes('選擇這一格') && !(await hint()).includes('金圈射程'), 'transient: command prompt takes priority over range legend');
      assert.deepEqual(await diag(), before, 'transient: a short-lived prompt never clears range geometry');
      assert.equal(hash(await pixels()), hash(oldPixels), 'transient: single-gun WebGL circles persist while the HTML menu is open');
      assert.deepEqual(await info(), oldInfo); assert.deepEqual(await snapshot(), frozen);
      await button('cm-cancel', true);
      assert.equal(await hint(), oldHint, 'transient: cancel restores the current single-gun legend');
      assert.deepEqual(await diag(), before); assert.equal(hash(await pixels()), hash(oldPixels));
    };
    const clippedPixels = async () => E(`(()=>{const c=document.querySelector('body>canvas'),a=document.createElement('canvas');a.width=c.width;a.height=c.height;const x=a.getContext('2d');x.drawImage(c,0,0);const p=__rts.screenOfPoint(35.5,0.045,29.5);if(p[0]<10||p[1]<10||p[0]>innerWidth-10||p[1]>innerHeight-10)throw Error('outside clip fixture is offscreen');return Array.from(x.getImageData(Math.round(p[0])-5,Math.round(p[1])-5,11,11).data);})()`);
    const clipping = async mutant => {
      await viewport(false); await fresh('noR113=1'); await selectGun(false); await E('__rts.focus(31,29.5,1)'); await frames(); const off = await clippedPixels();
      await fresh(mutant ? '__r113mutant=clip' : ''); await selectGun(false); await E('__rts.focus(31,29.5,1)'); await frames();
      assert.deepEqual(await clippedPixels(), off, 'clipping: a minimum circle outside the board draws no pixels');
      assert((await diag()).shown, 'clipping: fixture really has enabled range geometry');
      if (!mutant) await shot('r113-desktop-board-edge.png');
    };
    const valve = async mutant => {
      await viewport(true); await fresh('noR113=1' + (mutant ? '&__r113mutant=valve' : ''), 'script'); await selectGun(true);
      assert.equal(await diag(), null, 'valve: noR113 constructs no range mesh or solution');
      assert(!(await hint()).includes('金圈射程') && !(await hint()).includes('散布上界'), 'valve: all new legend is disabled');
      assert.equal(await E('__rts.hash()'), expected.script); assert.equal(await E('__rts.runScript(1200)'), expected.golden);
      await E('__rts.runScript(1);__rts.pause(true);__rts.select([4]);__rts.focus(10.5,10.5,0.8)'); await frames();
      if (!mutant) await shot('r113-mobile-scatter-off.png');
    };
    const cases = { desktop: m => selection(false,m), mobile: m => selection(true,m), scatter, freshness, transient, clipping, valve };
    for (const [name, run] of Object.entries(cases)) {
      const errors = page.errors.length; await run(false);
      assert.equal(page.errors.length, errors, `${name}: no runtime errors`); record(`OK real Chrome ${name}`);
    }
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    for (const [name, run] of Object.entries(cases)) {
      const errors = page.errors.length; let failure;
      try { await run(true); } catch (e) { failure = e; }
      const expected = name === 'desktop' || name === 'mobile' ? `${name}: actual selected range pixels differ from valve-off`
        : name === 'scatter' ? 'scatter: scatter-only circumference pixels are painted'
        : name === 'freshness' ? 'freshness: visible applied-ammo legend changes within the same second'
        : name === 'transient' ? 'transient: command prompt takes priority over range legend'
        : name === 'clipping' ? 'clipping: a minimum circle outside the board draws no pixels'
        : 'valve: noR113 constructs no range mesh or solution';
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(expected), `negative ${name}: first failure must be targeted pixel/valve assertion, got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no unrelated runtime errors`); record(`RED real Chrome ${name}: ${expected}`);
    }
  });
}
try {
  await main();
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### R113 real range-preview guards\n${summary.map(x=>'- '+x).join('\n')}\n`);
} catch (error) {
  const message = String(error?.stack ?? error);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message) && !strictCI) {
    console.error('NOT RUN R113 real Chrome guards: local socket permission restriction; CI must execute them.'); console.error(error.message); process.exitCode = 77;
  } else { console.error(error); console.error(`R113 browser FAIL: ${String(error.message).split('\n')[0]}`); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
