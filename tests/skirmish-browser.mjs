// R046 遭遇戰設定：真實 Chrome。預設這支跑手機觸控（412×915 等）＋預算＋逃生閥＋故意弄壞；
// --desktop（skirmish-desktop-browser.mjs）跑桌機滑鼠與鍵盤、種子輸入、網址直接開局。
// 版面：每顆鍵（含種子輸入）≥44×44、整顆在畫面裡、中心點得到、字不截。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { ECO_INCOME_TICKS } from '../src/sim/eco.ts';
import { FORCE_DOUBLE, FORCE_LEAN, INCOME_FAST } from '../src/sim/rules.ts';

const desktop = process.argv.includes('--desktop');
const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r046-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const R069_IDS = ['sm-map-rye', 'sm-map-large', 'sm-map-town', 'sm-mode-battle', 'sm-mode-zombies', 'sm-mode-sandbox', 'sm-ai-1', 'sm-ai-2', 'sm-ai-3', 'sm-start', 'sm-tutorial', 'sm-help', 'sm-audio'];
const START_IDS = ['sm-map-rye', 'sm-map-village', 'sm-map-large', 'sm-map-town', 'sm-mode-battle', 'sm-mode-zombies', 'sm-mode-sandbox', 'sm-ai-1', 'sm-ai-2', 'sm-ai-3', 'sm-setup', 'sm-start', 'sm-tutorial', 'sm-help', 'sm-audio'];
const SETUP_IDS = ['sm-force-1', 'sm-force-2', 'sm-force-3', 'sm-supply-1', 'sm-supply-2', 'sm-supply-3', 'sm-seed', 'sm-seed-roll', 'sm-setup-done'];
// 故意弄壞（只編進 broken 那一份，網址帶 __r046mutant 才生效）
const mutations = {
  force: ['src/ui/startMenu.ts', "    else if (sk && id.startsWith('sm-force-')) {", "    else if (sk && id.startsWith('sm-force-') && location.search.includes('__r046mutant=force')) { fresh = true; /* 選了不套用 */ } else if (sk && id.startsWith('sm-force-')) {"],
  supply: ['src/ui/skirmish.ts', '...(supply !== 2 ? { income: supply } : {})', "...(supply !== 2 && !location.search.includes('__r046mutant=supply') ? { income: supply } : {})"],
  valve: ['src/main.ts', 'const skirmish = V.r046 ? initSkirmish(', "const skirmish = V.r046 || location.search.includes('__r046mutant=valve') ? initSkirmish("],
  flush: ['src/ui/startMenu.ts', '    commitSeed();   // R046：種子框裡打到一半就點別的鍵', "    if (!location.search.includes('__r046mutant=flush')) commitSeed();   // R046：種子框裡打到一半就點別的鍵"],
};
const applied = new Set();
const plugin = { name: 'r046-dormant-negatives', enforce: 'pre', transform(code, id) {
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
  if (!desktop) {
    await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
    assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  }
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: desktop ? 8497 : 8495, width: desktop ? 1280 : 412, height: desktop ? 800 : 915, mobile: !desktop, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let width = desktop ? 1280 : 412, height = desktop ? 800 : 915, mobile = !desktop;
    const size = async (w, h, m = mobile) => { width = w; height = h; mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const key = async (k, code, vk, text) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, ...(text && type === 'keyDown' ? { text } : {}) }); await frames(); };
    const menu = () => E(`(()=>{const m=document.getElementById('start-menu');return m?{open:!m.hidden,title:document.getElementById('sm-title')?.textContent??null,ids:[...m.querySelectorAll('button, input')].map(b=>b.id),pressed:[...m.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id),setup:document.getElementById('sm-setup')?.textContent??null,seed:document.getElementById('sm-seed')?.value??null}:null})()`);
    const state = () => E(`(()=>{const us=__rts.units().filter(u=>u.alive);return {phase:__rts.phase(),paused:__rts.paused(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),map:__rts.map(),n:__rts.mapSize(),sandbox:!!__rts.sandbox(),mine:us.filter(u=>u.side===0).length,theirs:us.filter(u=>u.side===1).length,log:__rts.log(),supply:__rts.eco()?.supply??null}})()`);
    const geometry = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const layout = async label => assert.deepEqual(await geometry(), [], `layout: ${label} ${width}×${height} every menu key is a whole, unclipped, reachable 44px target`);
    // R047：這支驗的是 R046 的選單（鍵的清單寫死），帶 noR047=1 開頁；「重播」鍵由 tests/replay-browser.mjs 驗
    const opened = async (q = '') => { await open(q ? `${q}&noR047=1` : 'noR047=1', { menu: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const rulesAt0 = s => s.log.filter(c => c.tick === 0 && c.cmd.t === 'rules').map(c => c.cmd);
    const mapsAt0 = s => s.log.filter(c => c.tick === 0 && c.cmd.t === 'map').map(c => c.cmd.id);
    // 種子輸入：點那一格、全選、打字、Enter
    const dirtySeed = async text => {   // 只打字，不按 Enter、不離開那一格
      await press('sm-seed');
      assert.equal(await E('document.activeElement?.id'), 'sm-seed', 'seed: a real tap or click puts the cursor in the seed box');
      await E("document.getElementById('sm-seed').select()");
      await page.send('Input.insertText', { text });
    };
    const typeSeed = async text => { await dirtySeed(text); await key('Enter', 'Enter', 13, '\r'); };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const forceApplies = async () => {
      const before = await state();
      await press('sm-setup'); await press(`sm-force-${FORCE_DOUBLE}`);
      const s = await state();
      assert(s.mine === before.mine * 2 && s.theirs === before.theirs * 2 && s.phase === 'build' && s.tick === 0, `force: 加倍 doubles both opening forces at once (${before.mine}／${before.theirs} → ${s.mine}／${s.theirs}, ${s.phase}, tick ${s.tick})`);
      assert.deepEqual(rulesAt0(s), [{ t: 'rules', force: FORCE_DOUBLE }], 'force: the log carries one rules command at tick 0');
      assert((await menu()).pressed.includes(`sm-force-${FORCE_DOUBLE}`), 'force: 加倍 shows as chosen');
      return s;
    };
    const supplyApplies = async () => {
      await press(`sm-supply-${INCOME_FAST}`);
      const s = await state();
      assert.deepEqual(rulesAt0(s), [{ t: 'rules', force: FORCE_DOUBLE, income: INCOME_FAST }], 'supply: 快 is recorded in the tick-0 rules command');
      await press('sm-setup-done'); await press('sm-start'); await press('bb-start');
      assert.equal((await state()).phase, 'battle', 'fixture: 開戰 starts the battle');
      await E('__rts.pause(true)');
      const a = await state(), STEPS = 10 * ECO_INCOME_TICKS;
      await E(`__rts.stepN(${STEPS})`);
      const b = await state();
      assert.equal(b.supply[0] - a.supply[0], STEPS / (ECO_INCOME_TICKS / 2), `supply: 快 pays the player twice the standard income (${a.supply[0]} → ${b.supply[0]} in ${STEPS} ticks)`);
      return b;
    };
    // 種子框打到一半（沒按 Enter）就去按別的鍵或按 Esc：先套用打的種子，選單上的字也要跟上
    const seedCommits = async (q = '') => {
      await opened(q); await press('sm-setup'); await dirtySeed('55');
      assert.notEqual((await state()).seed, 55, 'fixture: typing alone does not apply the seed');
      await E("document.getElementById('sm-setup-done').click()"); await frames();   // 用程式按＝輸入框不會先失焦（有的手機點按鈕就是這樣）
      let s = await state(), m = await menu();
      assert(s.seed === 55 && m.setup?.endsWith('種子 55'), `seed: text typed in the box is applied when another key is pressed without leaving the box (seed ${s.seed}, key ${m.setup})`);
      await press('sm-setup'); await dirtySeed('66'); await key('Escape', 'Escape', 27);
      s = await state(); m = await menu();
      assert(s.seed === 66 && m.title === '微光小鎮·二戰 RTS' && m.setup?.endsWith('種子 66'), `seed: Esc with typed text applies it and the start page shows it (seed ${s.seed}, key ${m.setup})`);
      await press('sm-setup'); await dirtySeed('77'); await press(`sm-force-${FORCE_DOUBLE}`);
      s = await state(); m = await menu();
      assert(s.seed === 77 && m.seed === '77' && s.mine === 10, `seed: pressing a force key after typing applies both the seed and the force (seed ${s.seed}, box ${m.seed}, ${s.mine} units)`);
      await press('sm-seed-roll');
      s = await state();
      assert(s.seed !== 77 && (await menu()).seed === String(s.seed) && s.mine === 10, `seed: 隨機 right after is not undone by the old text in the box (seed ${s.seed})`);
    };
    const valveOff = async (extra = '') => {
      await opened(`noR046=1&force=3&supply=3&map=village${extra}`);
      const m = await menu(), s = await state();
      assert.deepEqual(m.ids, R069_IDS, 'valve: noR046 leaves exactly the R069 start menu');
      assert(s.map === MAP_RYE && rulesAt0(s).length === 0, `valve: noR046 ignores ?force, ?supply and ?map=village (map ${s.map}, rules ${JSON.stringify(rulesAt0(s))})`);
      return s;
    };

    if (!desktop) {
      // ---- 手機：開始選單多了「村莊」與「遭遇戰設定」----
      await opened();
      let m = await menu();
      assert(m?.open && m.title === '微光小鎮·二戰 RTS', 'menu: start menu shows after loading');
      assert.deepEqual(m.ids, START_IDS, 'menu: start menu adds 村莊 and 遭遇戰設定');
      assert.equal(m.setup, '遭遇戰設定兵力 標準 · 補給 標準 · 種子 1944', 'menu: the setup key shows the current force, supply and seed');
      const standard = await state();
      assert.deepEqual(rulesAt0(standard), [], 'menu: standard settings send no rules command');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780], [860, 412]]) { await size(w, h); await layout('start menu'); }
      await size(412, 915); await shot(page, path.join(SHOTS, 'r046-phone-start.png'));
      await press('sm-setup');
      m = await menu();
      assert.equal(m.title, '遭遇戰設定', 'setup: the key opens the setup page');
      assert.deepEqual(m.ids, SETUP_IDS, 'setup: force, supply, seed, 隨機 and 完成');
      assert.deepEqual([m.pressed, m.seed], [['sm-force-2', 'sm-supply-2'], '1944'], 'setup: defaults are 標準, 標準 and the page seed');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780], [860, 412]]) { await size(w, h); await layout('setup page'); }
      await size(860, 412); await shot(page, path.join(SHOTS, 'r046-landscape-setup.png'));
      await size(412, 915);
      await press('sm-setup-done');
      assert.equal((await menu()).title, '微光小鎮·二戰 RTS', 'setup: 完成 returns to the start page');

      // ---- 兵力、補給速度：當場套用；開戰後跟重播逐位相同 ----
      const doubled = await forceApplies();
      await shot(page, path.join(SHOTS, 'r046-phone-setup.png'));
      const battle = await supplyApplies();
      await E('__rts.stepN(150)');
      const end = await state();
      assert(end.tick > 200, 'fixture: the battle ran past 200 ticks');
      assert.equal(await E(`__rts.playLog(${end.seed}, ${JSON.stringify(end.log)}, ${end.tick})`), end.hash, 'replay: the battle equals replaying its own log from tick 0');
      assert(end.log.some(c => c.cmd.t === 'eco') && end.log.some(c => c.cmd.t === 'ai'), 'fixture: headquarters and enemy AI were on');
      // 暫停選單不能改設定
      await opened(); await press('sm-start'); await press('bb-start'); await press('b-menu');
      m = await menu();
      assert(m.title === '暫停' && !m.ids.includes('sm-setup'), 'pause: the pause menu has no setup key');

      // ---- 村莊、種子、隨機 ----
      await opened(); await press('sm-map-village');
      let s = await state();
      assert(s.map === 0 && s.n === 32 && s.phase === 'build', `village: 村莊 is the seeded village, map 0 (map ${s.map}, ${s.n})`);
      assert.deepEqual(mapsAt0(s), [0], 'village: the log records map 0');
      assert((await menu()).pressed.includes('sm-map-village'), 'village: 村莊 shows as chosen');
      await press('sm-setup'); await typeSeed('7');
      const seven = await state();
      assert(seven.seed === 7 && seven.hash !== s.hash && seven.map === 0, `seed: typing 7 rebuilds the village with seed 7 (seed ${seven.seed})`);
      assert.equal((await menu()).seed, '7', 'seed: the box shows the new seed');
      await typeSeed('abc');
      s = await state();
      assert(s.seed === 7 && s.hash === seven.hash && (await menu()).seed === '7', 'seed: a value that is not a number is thrown away');
      await typeSeed('4294967296');
      assert.equal((await state()).seed, 7, 'seed: a number above 4294967295 is thrown away');
      await press('sm-seed-roll');
      s = await state();
      assert(s.seed !== 7 && s.hash !== seven.hash && (await menu()).seed === String(s.seed), `seed: 隨機 draws another seed and rebuilds (${s.seed})`);
      await press('sm-setup-done');
      assert.match((await menu()).setup, new RegExp(`種子 ${s.seed}$`), 'seed: the setup key shows the new seed');
      await press('sm-map-large'); s = await state();
      assert(s.map === MAP_LARGE && !(await menu()).pressed.includes('sm-map-village'), 'village: 鄉間 leaves the village');
      await press('sm-map-village'); assert.equal((await state()).map, 0, 'village: back from 鄉間 to the village');
      await press('sm-map-rye'); assert.equal((await state()).map, MAP_RYE, 'village: back to 萊伊');
      await seedCommits();
      await press('sm-setup-done');
      // 沙盒沒有設定鍵；喪屍＋精簡
      await press('sm-mode-sandbox');
      assert(!(await menu()).ids.includes('sm-setup'), 'sandbox: no setup key');
      await press('sm-mode-zombies'); await press('sm-setup'); await press(`sm-force-${FORCE_LEAN}`);
      s = await state();
      assert(s.mine === 3 && s.theirs === 0 && s.log.some(c => c.cmd.t === 'zombies'), `zombies: 精簡 leaves three player units and no enemy opening force (${s.mine}／${s.theirs})`);

      // ---- 預算：加倍兵力開局（網址直接開局，守衛預設不經選單）----
      await size(412, 860);
      for (const [q, name] of [['force=3', '萊伊'], ['map=64&force=3', '鄉間'], ['map=96&force=3', '河鎮']]) {
        await open(q); await frames();
        const info = await E('__rts.info()'), st = await state();
        assert(st.mine === (name === '萊伊' ? 10 : 30), `budget: ${name} really opened with the doubled force (${st.mine})`);
        assert(info.calls <= 20 && info.triangles <= 80000, `budget: ${name} doubled opening ${info.calls} calls / ${info.triangles} triangles`);
        console.log(`  ${name} 加倍開局 412×860：${info.calls} calls / ${info.triangles} triangles`);
      }
      await size(412, 915);

      // ---- 逃生閥 ----
      const replayOn = await E(`__rts.playLog(${end.seed}, ${JSON.stringify(end.log)}, 120)`);
      await valveOff();
      assert.equal(await E(`__rts.playLog(${end.seed}, ${JSON.stringify(end.log)}, 120)`), replayOn, 'valve: a log with a rules command replays the same with the valve off');
      assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
      assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
      assert(doubled.mine === 10 && battle.tick > 0, 'fixture: positive flow ran');
      console.log('OK R046 phone: start menu, setup page, force, supply, replay, village, seed, 隨機, sandbox, zombies, budget, four phone sizes, valve');

      // ---- 故意弄壞：各紅在自己的斷言 ----
      overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
      const negatives = [
        ['force', async () => { await opened('__r046mutant=force'); await forceApplies(); }, 'force: 加倍 doubles'],
        ['supply', async () => { await opened('__r046mutant=supply'); await forceApplies(); await supplyApplies(); }, 'supply: 快 is recorded'],
        ['valve', async () => { await valveOff('&__r046mutant=valve'); }, 'valve: noR046 leaves exactly'],
        ['flush', async () => { await seedCommits('__r046mutant=flush'); }, 'seed: text typed in the box is applied when another key'],
      ];
      for (const [name, run, prefix] of negatives) {
        const errors = page.errors.length; let failure;
        try { await run(); } catch (e) { failure = e; }
        assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
        assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
        console.log(`RED R046 ${name}: ${failure.message.split('\n')[0]}`);
      }
      delete overlay['index.html'];
      return;
    }

    // ---- 桌機：滑鼠、鍵盤 ----
    await opened('force=1&supply=3&seed=42');
    let m = await menu();
    assert.equal(m.setup, '遭遇戰設定兵力 精簡 · 補給 快 · 種子 42', 'url: ?force, ?supply and ?seed fill the menu');
    for (const [w, h] of [[1280, 800], [1440, 900]]) { await size(w, h, false); await layout('start menu'); }
    await size(1280, 800, false);
    await press('sm-setup');
    m = await menu();
    assert.deepEqual([m.pressed, m.seed], [['sm-force-1', 'sm-supply-3'], '42'], 'url: the setup page shows the values from the address');
    for (const [w, h] of [[1280, 800], [1440, 900]]) { await size(w, h, false); await layout('setup page'); }
    await size(1280, 800, false); await shot(page, path.join(SHOTS, 'r046-desktop-setup.png'));
    assert.equal(await E('document.activeElement?.id'), 'sm-setup-done', 'keyboard: 完成 has focus when the setup page opens');
    // 鍵盤：Tab 繞一圈多都還在選單（種子輸入也在圈裡）；在輸入框打數字不會漏到遊戲；Enter 套用；Esc 回上一頁
    const inside = () => E("document.getElementById('start-menu').contains(document.activeElement)");
    const visited = new Set();
    for (let i = 0; i <= SETUP_IDS.length; i++) { await key('Tab', 'Tab', 9); visited.add(await E('document.activeElement?.id')); }
    assert(await inside() && visited.has('sm-seed'), `keyboard: Tab stays inside the setup page and reaches the seed box (${[...visited]})`);
    await press('sm-seed'); await E("document.getElementById('sm-seed').select()");
    for (const d of '2024') await key(d, `Digit${d}`, 48 + Number(d), d);
    assert.equal((await menu()).seed, '2024', 'keyboard: digits typed in the seed box stay in the box');
    assert.equal((await state()).seed, 42, 'keyboard: the seed is not applied until Enter');
    await key('Enter', 'Enter', 13, '\r');
    let s = await state();
    assert(s.seed === 2024 && s.phase === 'build' && (await menu()).open, `keyboard: Enter applies the typed seed and keeps the menu open (seed ${s.seed})`);
    assert.equal(await E('document.activeElement?.id'), 'sm-seed', 'keyboard: focus stays in the seed box after Enter');
    await key('Escape', 'Escape', 27);
    m = await menu();
    assert(m.open && m.title === '微光小鎮·二戰 RTS', 'keyboard: Esc on the setup page goes back to the start page');
    assert.equal(m.setup, '遭遇戰設定兵力 精簡 · 補給 快 · 種子 2024', 'keyboard: the setup key follows the typed seed');
    assert(s.mine === 3 && s.theirs === 3, `url: ?force=1 opened with the lean force (${s.mine}／${s.theirs})`);
    // 重新開始沿用設定與種子
    await press('sm-start'); await press('bb-start'); await press('b-menu'); await press('sm-restart');
    s = await state();
    assert(s.phase === 'build' && s.tick === 0 && s.seed === 2024 && s.mine === 3, `restart: 重新開始 keeps the seed and the settings (seed ${s.seed}, ${s.mine} units)`);
    assert.deepEqual(rulesAt0(s), [{ t: 'rules', force: FORCE_LEAN, income: INCOME_FAST }], 'restart: the new log carries the same rules');
    await seedCommits();

    // ---- 網址直接開局＝選單選出來的同一局 ----
    const pick = r => ({ hash: r.hash, seed: r.seed, map: r.map, n: r.n, mine: r.mine, theirs: r.theirs, log: r.log });
    await open('map=village&seed=7&force=3&supply=3'); await frames();
    const direct = pick(await state());
    assert(await E("!document.getElementById('start-menu')") && direct.map === 0 && direct.mine === 10, 'url: the guard address opens straight into build step 0 with the chosen setup');
    await opened(); await press('sm-map-village'); await press('sm-setup'); await press('sm-force-3'); await press('sm-supply-3');
    await press('sm-seed'); await E("document.getElementById('sm-seed').select()");
    await key('7', 'Digit7', 55, '7'); await key('Enter', 'Enter', 13, '\r');
    assert.deepEqual(pick(await state()), direct, 'url: ?map=village&seed=7&force=3&supply=3 equals the same choices made in the menu');
    await open('force=9&supply=x'); await frames();
    const odd = pick(await state());
    await open(''); await frames();
    assert.deepEqual(odd, pick(await state()), 'url: values that are not 1 or 3 mean standard');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R046 desktop: address fills the menu, two desktop sizes, Tab/digits/Enter/Esc, restart keeps the setup, direct address equals the menu');
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R046 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R046 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
