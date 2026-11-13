// R073 記住上次的遭遇戰設定：真實 Chrome（手機觸控 412×915）。選了什麼會存、重新開頁照舊、網址優先且不混用、恢復預設、沒有選單時不讀不存、逃生閥、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { SETUP_KEY, DEFAULT_SEED } from '../src/ui/skirmish.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r073-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const CHOSEN = { v: 1, map: '64', mode: 'battle', ai: 3, force: 3, supply: 3, seed: 77 };
// 故意弄壞（只編進 broken 那一份，網址帶 __r073mutant 才生效）
const mutations = {
  nosave: ['src/ui/skirmish.ts', '    saveSetup(store, now);', "    if (!location.search.includes('__r073mutant=nosave')) saveSetup(store, now);"],
  norestore: ['src/ui/skirmish.ts', '  const s = loadSetup(memory);', "  const s = location.search.includes('__r073mutant=norestore') ? null : loadSetup(memory);"],
  mix: ['src/ui/skirmish.ts', '  if (!memory || linked) return q;', "  if (!memory || (linked && !location.search.includes('__r073mutant=mix'))) return q;"],
};
const applied = new Set();
const plugin = { name: 'r073-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, 1, `negative anchor: ${name}`);
    code = code.replace(from, to); applied.add(name);
  }
  return code;
} };

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8501, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let mobile = true;
    const size = async (w, h, m = true) => { mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const key = async (k, code, vk, text) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, ...(text && type === 'keyDown' ? { text } : {}) }); await frames(); };
    const typeSeed = async text => { await press('sm-seed'); await E("document.getElementById('sm-seed').select()"); await page.send('Input.insertText', { text }); await key('Enter', 'Enter', 13, '\r'); };
    const stored = async () => { const raw = await E(`localStorage.getItem(${JSON.stringify(SETUP_KEY)})`); return raw === null ? null : JSON.parse(raw); };
    const menu = () => E(`(()=>{const m=document.getElementById('start-menu');return m?{open:!m.hidden,ids:[...m.querySelectorAll('button, input')].map(b=>b.id),pressed:[...m.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id),setup:document.getElementById('sm-setup')?.textContent??null}:null})()`);
    const state = () => E(`(()=>{const us=__rts.units().filter(u=>u.alive);return {phase:__rts.phase(),tick:__rts.tick(),seed:__rts.seed(),map:__rts.map(),n:__rts.mapSize(),sandbox:!!__rts.sandbox(),zombies:__rts.log().some(c=>c.cmd.t==='zombies'),mine:us.filter(u=>u.side===0).length,theirs:us.filter(u=>u.side===1).length,at0:__rts.log().filter(c=>c.tick===0&&(c.cmd.t==='map'||c.cmd.t==='rules')).map(c=>c.cmd)}})()`);
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const choose = async () => {   // 鄉間、困難、加倍、快、種子 77
      await press('sm-map-large'); await press('sm-ai-3'); await press('sm-setup'); await press('sm-force-3'); await press('sm-supply-3'); await typeSeed('77'); await press('sm-setup-done');
      return state();
    };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const remembers = async (extra = '') => {
      await opened(extra);
      assert.equal(await stored() === null || (await stored()).map === 'rye', true, 'fixture: a first visit starts from the standard setup');
      const before = await choose();
      assert(before.map === MAP_LARGE && before.mine === 30 && before.seed === 77, `fixture: the menu choices took effect (map ${before.map}, ${before.mine} units, seed ${before.seed})`);
      assert.deepEqual(await stored(), CHOSEN, 'save: the chosen setup is stored on this device');
      await opened(extra, true);
      const m = await menu(), after = await state();
      assert(m.pressed.includes('sm-map-large') && m.pressed.includes('sm-ai-3') && m.pressed.includes('sm-mode-battle') && m.setup === '遭遇戰設定兵力 加倍 · 補給 快 · 種子 77', `restore: reopening the page shows the remembered choices in the menu (${m.pressed} / ${m.setup})`);
      assert.deepEqual([after.map, after.n, after.mine, after.theirs, after.seed, after.at0, after.phase, after.tick], [before.map, before.n, before.mine, before.theirs, before.seed, before.at0, 'build', 0], 'restore: the world behind the menu is the same game as before the reload');
      return before;
    };
    const urlWins = async (extra = '') => {
      await E(`localStorage.setItem(${JSON.stringify(SETUP_KEY)}, ${JSON.stringify(JSON.stringify(CHOSEN))})`);
      await opened(`seed=5${extra}`, true);
      const m = await menu(), s = await state();
      assert(m.pressed.includes('sm-map-rye') && m.pressed.includes('sm-ai-2') && m.setup === '遭遇戰設定兵力 標準 · 補給 標準 · 種子 5' && s.map === MAP_RYE && s.mine === 5 && s.seed === 5, `url: an address with any setup item is used alone, nothing remembered is mixed in (${m.pressed} / ${m.setup} / map ${s.map}, ${s.mine} units)`);
    };

    // ---- 正向 ----
    await remembers();
    await shot(page, path.join(SHOTS, 'r073-phone-restored.png'));
    // 換難度會存（不重開一局）
    await press('sm-ai-1');
    assert.equal((await stored()).ai, 1, 'save: changing the AI level is stored at once');
    // 喪屍記得住；沙盒記不住
    await press('sm-mode-zombies');
    assert.equal((await stored()).mode, 'zombies', 'save: zombies mode is stored');
    await opened('', true);
    let s = await state(), m = await menu();
    assert(s.zombies && s.map === MAP_LARGE && m.pressed.includes('sm-mode-zombies') && m.pressed.includes('sm-map-large'), 'restore: zombies mode on the large map comes back');
    const beforeSandbox = await stored();
    await press('sm-mode-sandbox');
    assert((await state()).sandbox, 'fixture: the sandbox opened');
    assert.deepEqual(await stored(), beforeSandbox, 'save: entering the sandbox changes nothing that is remembered');
    await opened('', true);
    s = await state();
    assert(!s.sandbox && s.zombies && s.map === MAP_LARGE, 'restore: the page never reopens straight into the sandbox');
    // 網址優先且不混用
    await urlWins();
    assert.deepEqual(await stored(), CHOSEN, 'link: merely opening an address with setup items leaves the remembered setup alone');
    await press('sm-ai-1');
    assert.deepEqual(await stored(), { v: 1, map: 'rye', mode: 'battle', ai: 1, force: 2, supply: 2, seed: 5 }, 'link: once a setting is changed, this game becomes the remembered one');
    // 恢復預設
    await opened(); await choose(); await press('sm-map-town'); await press('sm-setup');
    m = await menu();
    assert(m.ids.includes('sm-setup-reset'), 'reset: the setup page has 恢復預設');
    for (const [w, h, mob] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
      await size(w, h, mob);
      const r = await rect('sm-setup-reset');
      assert(r && r.w >= 44 && r.h >= 44 && r.inside && r.hit, `layout: 恢復預設 is a whole reachable 44px target at ${w}×${h}`);
    }
    await size(412, 915, true); await shot(page, path.join(SHOTS, 'r073-phone-setup.png'));
    await press('sm-setup-reset');
    s = await state(); m = await menu();
    assert(s.seed === DEFAULT_SEED && s.mine === 15 && s.map === MAP_TOWN && s.at0.every(c => c.t !== 'rules') && m.pressed.includes('sm-force-2') && m.pressed.includes('sm-supply-2'), `reset: force, supply and seed go back to standard at once, the map stays (seed ${s.seed}, ${s.mine} units, map ${s.map})`);
    assert.deepEqual(await stored(), { v: 1, map: '96', mode: 'battle', ai: 3, force: 2, supply: 2, seed: DEFAULT_SEED }, 'reset: what is remembered follows');
    await opened('', true);
    s = await state(); m = await menu();
    assert(s.map === MAP_TOWN && s.seed === DEFAULT_SEED && s.mine === 15 && m.pressed.includes('sm-ai-3'), 'reset: after a reload the map and AI level are still the chosen ones, the rest is standard');
    // 沒有選單時不讀也不存
    const kept = await stored();
    await open('', { keep: true }); await frames();   // 守衛預設：noR069=1
    s = await state();
    assert(s.map === MAP_RYE && s.mine === 5 && await E("!document.getElementById('start-menu')"), 'no menu: a page without the start menu ignores the remembered setup');
    await E('__rts.startBattle()');
    assert.deepEqual(await stored(), kept, 'no menu: playing without the start menu does not change what is remembered');
    // 逃生閥
    await opened('noR073=1', true);
    s = await state(); m = await menu();
    assert(s.map === MAP_RYE && m.pressed.includes('sm-map-rye') && m.pressed.includes('sm-ai-2'), 'valve: noR073 restores nothing');
    await press('sm-map-large'); await press('sm-setup');
    assert(!(await menu()).ids.includes('sm-setup-reset'), 'valve: noR073 has no 恢復預設');
    assert.deepEqual(await stored(), kept, 'valve: noR073 stores nothing');
    assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R073: save, reload, AI level, zombies, sandbox not kept, address wins, 恢復預設 at four sizes, no menu, valve');

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nosave', async () => { await remembers('__r073mutant=nosave'); }, 'save: the chosen setup is stored'],
      ['norestore', async () => { await remembers('__r073mutant=norestore'); }, 'restore: reopening the page shows'],
      ['mix', async () => { await urlWins('&__r073mutant=mix'); }, 'url: an address with any setup item is used alone'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R073 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R073 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R073 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
