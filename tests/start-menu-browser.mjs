// R069 開始選單：真實 Chrome。預設這支跑手機觸控（412×915 等）＋故意弄壞；--desktop（start-menu-desktop-browser.mjs）跑桌機滑鼠、鍵盤，
// 以及「選單選地圖／模式」與閥關時按舊鍵逐位相同。版面：每顆鍵 ≥44×44、整顆在畫面裡、中心點得到、字不截。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';

const desktop = process.argv.includes('--desktop');
const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r069-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const START_IDS = ['sm-map-rye', 'sm-map-large', 'sm-map-town', 'sm-mode-battle', 'sm-mode-zombies', 'sm-mode-sandbox', 'sm-ai-1', 'sm-ai-2', 'sm-ai-3', 'sm-start', 'sm-tutorial', 'sm-help', 'sm-audio'];
const FOLDED = ['sb-enter', 'map-pick', 'zombies-pick', 'town-pick', 'b-restart'];
// 故意弄壞（只編進 broken 那一份，網址帶 __r069mutant 才生效）
const mutations = {
  hold: ['src/ui/startMenu.ts', '  function hold() { if (!held && !root.hidden && host.battle()) {', "  function hold() { if (location.search.includes('__r069mutant=hold')) return; if (!held && !root.hidden && host.battle()) {"],
  map: ['src/ui/startMenu.ts', "    if (id.startsWith('sm-map-')) for", "    if (id.startsWith('sm-map-') && location.search.includes('__r069mutant=map')) { /* 選了不套用 */ } else if (id.startsWith('sm-map-')) for"],
  valve: ['src/main.ts', 'if (V.r069) initStartMenu(', "if (V.r069 || location.search.includes('__r069mutant=valve')) initStartMenu("],
};
const applied = new Set();
const plugin = { name: 'r069-dormant-negatives', enforce: 'pre', transform(code, id) {
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
  await withBrowser({ root: baseline, overlay, port: desktop ? 8493 : 8491, width: desktop ? 1280 : 412, height: desktop ? 800 : 915, mobile: !desktop, settle: 300 }, async ({ open, page }) => {
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
    const menu = () => E(`(()=>{const m=document.getElementById('start-menu');return m?{open:!m.hidden,title:document.getElementById('sm-title')?.textContent??null,ids:[...m.querySelectorAll('button')].map(b=>b.id),pressed:[...m.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id)}:null})()`);
    const state = () => E(`({phase:__rts.phase(),paused:__rts.paused(),tick:__rts.tick(),hash:__rts.hash(),map:__rts.map(),n:__rts.mapSize(),sandbox:!!__rts.sandbox(),zombies:__rts.log().some(c=>c.cmd.t==='zombies'),log:__rts.log(),selected:__rts.selected()})`);
    const geometry = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const layout = async label => assert.deepEqual(await geometry(), [], `layout: ${label} ${width}×${height} every menu key is a whole, unclipped, reachable 44px target`);
    const opened = async (q = '') => { await open(q, { menu: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const mapApplies = async () => {
      await press('sm-map-town'); const s = await state();
      assert(s.map === MAP_TOWN && s.n === 96 && s.phase === 'build', `map: 河鎮 applies to the world at once (map ${s.map}, ${s.n}×${s.n}, ${s.phase})`);
      assert.deepEqual((await menu()).pressed.filter(id => id.startsWith('sm-map-')), ['sm-map-town'], 'map: 河鎮 shows as chosen');
    };
    const pauseHolds = async () => {
      await press('sm-start'); await press('bb-start');
      assert.equal((await state()).phase, 'battle', 'fixture: 開戰 starts the battle');
      await sleep(300); await frames();
      const running = await state(); assert(!running.paused && running.tick > 0, 'fixture: battle runs before the menu opens');
      await press('b-menu');
      const before = await state(), m = await menu();
      assert(m.open && m.title === '暫停', 'pause: 選單 during battle opens the pause menu');
      await sleep(600); await frames();
      const after = await state();
      assert(after.paused && after.tick === before.tick && after.hash === before.hash, `pause: battle does not advance while the pause menu is open (tick ${before.tick} → ${after.tick})`);
      return before;
    };
    const valveOff = async () => {
      assert(await E("!document.getElementById('start-menu') && !document.getElementById('b-menu')"), 'valve: noR069 removes the menu and its key');
      const shown = await E(`${JSON.stringify(FOLDED)}.filter(id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none'})`);
      assert.deepEqual(shown, FOLDED, 'valve: noR069 restores the four entry keys and ↺');
    };

    if (!desktop) {
      // ---- 手機：開頁先停在選單 ----
      await opened();
      const m = await menu();
      assert(m?.open && m.title === '微光小鎮·二戰 RTS', 'menu: start menu shows after loading');
      assert.deepEqual(m.ids, START_IDS, 'menu: maps, modes, AI levels, 開始, tutorial, help and audio');
      assert.deepEqual(m.pressed, ['sm-map-rye', 'sm-mode-battle', 'sm-ai-2'], 'menu: defaults are 萊伊, 一般對戰, 普通');
      const info = await E('__rts.info()');
      assert(info.calls <= 20 && info.triangles <= 80000, `budget: opening with the menu ${info.calls} calls / ${info.triangles} triangles`);
      assert.deepEqual(await E(`${JSON.stringify(FOLDED)}.filter(id=>{const e=document.getElementById(id);return e&&getComputedStyle(e).display!=='none'})`), [], 'fold: the four entry keys and ↺ are inside the menu');
      await shot(page, path.join(SHOTS, 'r069-phone-start.png'));
      for (const [w, h] of [[412, 915], [390, 844], [360, 780], [860, 412]]) { await size(w, h); await layout('start menu'); }
      await size(860, 412); await shot(page, path.join(SHOTS, 'r069-landscape-start.png'));
      await size(412, 915);
      // 模式與地圖：按下去背後的世界就換
      await mapApplies();
      await press('sm-mode-zombies'); let s = await state();
      assert(s.zombies && s.map === MAP_TOWN && !s.sandbox, 'mode: 喪屍防守 keeps 河鎮 and starts zombies');
      await press('sm-mode-sandbox'); s = await state();
      assert(s.sandbox && (await menu()).ids.every(id => !id.startsWith('sm-map-')), 'mode: 沙盒 enters the sandbox and hides the map row');
      await press('sm-mode-battle'); s = await state();
      assert(!s.sandbox && !s.zombies && s.map === MAP_TOWN, 'mode: 一般對戰 leaves the sandbox without falling back into zombies');
      await press('sm-map-rye'); s = await state();
      assert(s.map === MAP_RYE && s.n === 32, 'map: back to 萊伊 32×32');
      // 開始 → 布陣；開戰後選單＝暫停選單
      await pauseHolds();
      await shot(page, path.join(SHOTS, 'r069-phone-pause.png'));
      for (const [w, h] of [[412, 915], [360, 780], [860, 412]]) { await size(w, h); await layout('pause menu'); }
      await size(412, 915);
      const held = await state();
      // 焦點在「繼續」時空白鍵按的是「繼續」（按鍵本來的行為）；移開焦點再按，驗的是遊戲自己的空白鍵（暫停／繼續）收不到
      await E('document.activeElement?.blur()');
      await key(' ', 'Space', 32, ' ');
      let s2 = await state(); assert(s2.paused && s2.tick === held.tick, 'pause: Space does not leak through the menu');
      await touchTap(page, 206, 860); await frames();
      s2 = await state(); assert.deepEqual([s2.selected, s2.log.length], [held.selected, held.log.length], 'pause: taps on the backdrop never reach the map');
      await press('sm-resume');
      assert.equal((await menu()).open, false, 'resume: 繼續 closes the menu');
      await sleep(400); await frames();
      s2 = await state(); assert(!s2.paused && s2.tick > held.tick, 'resume: 繼續 restores the running battle');
      // 打開前已暫停 → 繼續後仍暫停
      await press('b-pause'); assert((await state()).paused, 'fixture: ⏸ pauses');
      await press('b-menu'); await press('sm-resume');
      assert((await state()).paused, 'resume: a battle paused before the menu stays paused');
      // 回主選單、新手教學
      await press('b-menu'); await press('sm-main');
      const back = await state(), bm = await menu();
      assert(back.phase === 'build' && back.tick === 0 && bm.open && bm.ids.includes('sm-start'), 'main: 回主選單 returns to build step 0 with the start menu');
      await press('sm-tutorial');
      assert(await E("!document.getElementById('tutorial')?.hidden") && !(await menu()).open, 'tutorial: 新手教學 closes the menu and opens the tutorial');
      // 選單鍵不跟具／產／框、小地圖、狀態列重疊
      const overlap = await E(`(()=>{const a=document.getElementById('b-menu').getBoundingClientRect();return ['r901-chrome','minimap'].map(id=>document.getElementById(id)).concat([document.querySelector('#hud .top')]).filter(Boolean).map(e=>e.getBoundingClientRect()).filter(b=>b.width&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top).length})()`);
      assert.equal(overlap, 0, 'layout: 選單 key clears the phone chrome, minimap and status line');
      // 閥
      await open('noR069=1'); await valveOff();
      assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
      assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
      console.log('OK R069 phone: start menu, map/mode/sandbox, pause hold, Space and taps blocked, resume, main menu, tutorial, four phone sizes, valve');

      // ---- 故意弄壞：各紅在自己的斷言 ----
      overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
      const negatives = [
        ['map', async () => { await opened('__r069mutant=map'); await mapApplies(); }, 'map: 河鎮 applies'],
        ['hold', async () => { await opened('__r069mutant=hold'); await pauseHolds(); }, 'pause: battle does not advance'],
        ['valve', async () => { await open('noR069=1&__r069mutant=valve'); await valveOff(); }, 'valve: noR069 removes the menu'],
      ];
      for (const [name, run, prefix] of negatives) {
        const errors = page.errors.length; let failure;
        try { await run(); } catch (e) { failure = e; }
        assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
        assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
        console.log(`RED R069 ${name}: ${failure.message.split('\n')[0]}`);
      }
      delete overlay['index.html'];
      return;
    }

    // ---- 桌機：滑鼠、鍵盤 ----
    await opened();
    for (const [w, h] of [[1280, 800], [1440, 900]]) { await size(w, h, false); await layout('start menu'); }
    await size(1280, 800, false); await shot(page, path.join(SHOTS, 'r069-desktop-start.png'));
    assert.equal(await E('document.activeElement?.id'), 'sm-start', 'keyboard: 開始 has focus when the menu opens');
    await key('Enter', 'Enter', 13, '\r');
    assert(!(await menu()).open && (await state()).phase === 'build', 'keyboard: Enter on 開始 closes the menu into build step 0');
    await press('bb-start'); await press('b-menu'); await layout('pause menu');
    // 鍵盤焦點留在選單裡：Tab／Shift+Tab 繞一圈多都還在選單；焦點被移到後面的 ⏸ 時按 Enter 不會讓戰鬥繼續
    const nKeys = (await menu()).ids.length;
    const inside = () => E("document.getElementById('start-menu').contains(document.activeElement)");
    for (let i = 0; i <= nKeys; i++) await key('Tab', 'Tab', 9);
    assert(await inside(), 'keyboard: Tab stays inside the open menu');
    for (let i = 0; i <= 2 * nKeys; i++) { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }); await frames(); }
    assert(await inside(), 'keyboard: Shift+Tab stays inside the open menu');
    await E("document.getElementById('b-pause').focus()"); await key('Enter', 'Enter', 13, '\r');
    assert((await state()).paused && (await menu()).open, 'keyboard: Enter cannot press a key behind the open menu');
    await shot(page, path.join(SHOTS, 'r069-desktop-pause.png'));
    const held = await state();
    await key('Escape', 'Escape', 27);
    let s = await state();
    assert(!(await menu()).open && !s.paused, 'keyboard: Esc in the pause menu resumes the battle');
    assert(s.tick >= held.tick, 'fixture: battle continues');
    await press('b-menu'); await press('sm-help');
    assert(await E("!document.getElementById('help').hidden") && !(await menu()).open, 'help: 怎麼玩 closes the menu and opens the help panel');
    // 音效：真的滑鼠點才開得了；選單的字跟著右上的音效鍵
    await opened(); await press('sm-audio');
    assert.equal(await E("document.getElementById('b-audio').getAttribute('aria-pressed')"), 'true', 'audio: 音效 in the menu turns the real audio key on');
    await sleep(200);
    assert.equal(await E("document.getElementById('sm-audio').textContent"), '音效：開', 'audio: menu label follows the audio key');
    // 難度：?ai=3 開頁顯示困難；選困難開戰，電腦指令是 level 3
    await opened('ai=3'); assert((await menu()).pressed.includes('sm-ai-3'), 'ai: ?ai=3 shows 困難');
    await opened(); await press('sm-ai-3'); await press('sm-start'); await press('bb-start');
    const ai = (await state()).log.filter(c => c.cmd.t === 'ai').map(c => c.cmd.level);
    assert.deepEqual(ai, [3], `ai: 困難 sends the enemy AI at level 3 (${ai})`);
    // 跟閥關時按舊鍵逐位相同（同一個世界雜湊、同一份指令紀錄）
    const viaMenu = async ids => { await opened(); for (const id of ids) await press(id); const r = await state(); return { hash: r.hash, map: r.map, n: r.n, sandbox: r.sandbox, zombies: r.zombies, log: r.log }; };
    const viaOld = async ids => { await open('noR069=1'); for (const id of ids) await press(id); const r = await state(); return { hash: r.hash, map: r.map, n: r.n, sandbox: r.sandbox, zombies: r.zombies, log: r.log }; };
    for (const [label, menuIds, oldIds] of [
      ['鄉間 64×64', ['sm-map-large'], ['map-pick']],
      ['河鎮 96×96', ['sm-map-town'], ['town-pick']],
      ['河鎮 → 鄉間', ['sm-map-town', 'sm-map-large'], ['town-pick', 'map-pick', 'map-pick']],   // 舊地圖鍵在河鎮時先回萊伊，再按一次才到鄉間
      ['喪屍防守', ['sm-mode-zombies'], ['zombies-pick']],
      ['沙盒', ['sm-mode-sandbox'], ['sb-enter']],
    ]) {
      const a = await viaMenu(menuIds), b = await viaOld(oldIds);
      assert.deepEqual(a, b, `equal: menu ${label} gives the same world and log as the old keys`);
    }
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R069 desktop: two desktop sizes, Enter/Esc, help, audio, AI level, five menu choices equal the old keys');
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R069 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R069 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
