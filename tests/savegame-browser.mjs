// R074 繼續上一局：真實 Chrome（手機觸控 412×915；版面另量三個尺寸）。離開頁面時存、重新開頁接回同一步、接著打跟沒中斷一樣、打完進重播並清存檔、
// 回主選單先存、大地圖／喪屍／穿甲規則各接一次、壞掉的存檔不給接、沙盒與看重播不存、逃生閥、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UK_HOWITZER } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { SAVE_KEY, checkSave } from '../src/ui/saveGame.ts';
import { REPLAY_KEY, decodeReplay } from '../src/ui/replayStore.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r074-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const QUICK = 'force=1&noR019=1';   // 精簡兵力、沒有指揮部（全滅才結束）：雙方都交給電腦，幾百步就分出勝負
// 故意弄壞（只編進 broken 那一份，網址帶 __r074mutant 才生效）
const mutations = {
  nosave: ['src/ui/saveGame.ts', '    return writeSave(store, text);', "    return location.search.includes('__r074mutant=nosave') ? false : writeSave(store, text);"],
  otherworld: ['src/main.ts', ' w = world; log = lg; ', " if (!location.search.includes('__r074mutant=otherworld')) w = world; log = lg; "],
  nopending: ['src/main.ts', 'pending = lg.filter(c => c.tick === w.tick).map(c => c.cmd);', "pending = location.search.includes('__r074mutant=nopending') ? [] : lg.filter(c => c.tick === w.tick).map(c => c.cmd);"],
  offerbad: ['src/ui/saveGame.ts', 'seenTitle = l?.ok ? saveTitle(l.save) : null;', "seenTitle = l?.ok ? saveTitle(l.save) : raw && location.search.includes('__r074mutant=offerbad') ? '壞掉的存檔' : null;"],
};
const applied = new Set();
const plugin = { name: 'r074-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, 1, `negative anchor: ${name}`);
    code = code.replace(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));   // 同一份紀錄在 Node 從第 0 步跑到那一步的雜湊

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8505, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let mobile = true;
    const size = async (w, h, m = true) => { mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),fits:e.scrollWidth<=e.clientWidth+1}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const raw = () => E(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    const put = (key, text) => E(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(text)})`);
    const leave = () => E("dispatchEvent(new Event('pagehide'))");   // 頁面要離開的那個事件（同一頁裡直接發，不真的換頁）
    const keys = () => E(`[...document.querySelectorAll('#start-menu .sm-main button')].map(b=>({id:b.id,small:b.querySelector('small')?.textContent??''}))`);
    const menuOpen = () => E("(()=>{const m=document.getElementById('start-menu');return !!m&&!m.hidden})()");
    const state = () => E(`(()=>{const lg=__rts.log();return {phase:__rts.phase(),paused:__rts.paused(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),map:__rts.map(),n:__rts.mapSize(),winner:__rts.winner(),sandbox:!!__rts.sandbox(),log:lg,cam:__rts.cam(),report:__rts.report().data,zombies:lg.some(c=>c.cmd.t==='zombies'),rules:lg.find(c=>c.tick===0&&c.cmd.t==='rules')?.cmd??null}})()`);
    const fresh = async (q = '') => { await open(q, { menu: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };          // 本機儲存清乾淨再開
    const reload = async (q = '') => { await open(q, { menu: true, keep: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };   // 真的換頁，本機儲存留著
    const fight = cmds => E(`(() => { __rts.startBattle(); __rts.pause(true); ${cmds} })()`);   // 開戰、暫停、下指令、走步數在同一次呼叫裡做完：中間不讓畫面自己多跑

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const resumes = async (extra = '') => {
      await fresh(extra);
      assert.deepEqual((await keys()).map(k => k.id), ['sm-start'], 'fixture: a first visit has no 繼續上一局');
      await press('sm-start');
      await leave();
      assert.deepEqual([await E('__rts.phase()'), await raw()], ['build', null], 'save: nothing is stored during the build phase');
      const gun = await E(`__rts.units().find(u => u.side === 0 && u.kind === ${UK_HOWITZER}).id`);
      await fight(`__rts.issue({ t: 'fireAt', side: 0, ids: [${gun}], x: 10, z: 10 }); __rts.issue({ t: 'move', side: 0, ids: [1, 2], x: 14, z: 14 }); __rts.stepN(240); __rts.issue({ t: 'fireDiscipline', side: 0, ids: [1], hold: true }); __rts.stepN(60); __rts.focus(15, 16, 1.6); __rts.issue({ t: 'move', side: 0, ids: [__rts.units().filter(u => u.side === 0 && u.alive && u.kind === 0).pop().id], x: 20, z: 12 });`);   // 最後這道是暫停著下的：進了紀錄、還沒進世界
      const before = await state();
      assert(before.phase === 'battle' && before.tick === 301 && before.winner < 0 && before.report.fires[0] > 0, `fixture: a battle in progress with shots fired (tick ${before.tick}, fires ${before.report.fires})`);
      assert.equal(node(before.seed, before.log, before.tick), before.hash, 'fixture: Node reproduces this battle from its log');
      assert(before.log.at(-1).tick === before.tick && before.log.at(-1).cmd.t === 'move', 'fixture: the last order was given while paused and has not reached the world yet');
      assert.notEqual(node(before.seed, before.log, before.tick + 200), node(before.seed, before.log.slice(0, -1), before.tick + 200), 'fixture: that last order changes how the battle goes');
      await reload(extra);   // 真的換頁：遊戲在頁面離開時存
      const text = await raw(), saved = text ? JSON.parse(text) : null;
      assert(saved && saved.tick === before.tick && saved.hash === before.hash, `save: leaving the page stores this battle at this step (${saved ? `tick ${saved.tick}, ${saved.hash}` : 'nothing stored'})`);
      assert.equal(checkSave(text).ok, true, 'save: what was stored passes the check');
      const k = await keys(), behind = await state();
      assert(k.length === 2 && k[0].id === 'sm-continue' && k[1].id === 'sm-start' && new RegExp(`^萊伊 32×32 · 0:15 · 種子 ${before.seed}$`).test(k[0].small), `menu: 繼續上一局 comes first with the map, the time and the seed under it (${JSON.stringify(k)})`);
      assert(behind.phase === 'build' && behind.tick === 0, 'menu: until the key is pressed the game behind the menu is a new one');
      await press('sm-continue');
      const after = await state();
      assert.equal(await menuOpen(), false, 'resume: the menu closes');
      assert.deepEqual([after.phase, after.paused, after.tick, after.hash], ['battle', true, before.tick, before.hash], 'resume: 繼續上一局 returns to the same step of the same battle, paused');
      assert.deepEqual(after.log, before.log, 'resume: the command log comes back');
      assert.deepEqual(after.report, before.report, 'resume: the battle-report numbers come back');
      assert(Math.abs(after.cam.x - 15) < 0.01 && Math.abs(after.cam.z - 16) < 0.01 && Math.abs(after.cam.zoom - 1.6) < 0.01, `resume: the camera comes back (${JSON.stringify(after.cam)})`);
      await E('__rts.stepN(200)');
      assert.equal(await E('__rts.hash()'), node(before.seed, before.log, before.tick + 200), 'resume: 200 steps later the battle equals the one that was never interrupted');
      return text;
    };
    const refuses = async (good, extra = '') => {
      const x = JSON.parse(good); x.world.units[0].hp += 1;
      const y = JSON.parse(good); y.hash = y.hash === '00000000' ? '00000001' : '00000000';
      await fresh(extra);
      for (const [why, text] of [['cut in half', good.slice(0, good.length >> 1)], ['edited by one hit point', JSON.stringify(x)], ['given another hash', JSON.stringify(y)], ['not a save at all', '{"v":1,"hello":"world"}']]) {
        await put(SAVE_KEY, text); await reload(extra);
        assert.deepEqual((await keys()).map(k => k.id), ['sm-start'], `corrupt: a save that is ${why} is not offered`);
      }
      await press('sm-start');
      assert.equal(await E('__rts.phase()'), 'build', 'corrupt: 開始 works as usual next to a damaged save');
    };

    // ---- 正向 ----
    const good = await resumes();
    // 守衛工具：不帶 keep 的 open() 之後沒有存檔（上一頁正在打，離開時會自己存一次，工具要把那一筆也清掉）
    await fresh();
    assert.deepEqual([await raw(), (await keys()).map(k => k.id)], [null, ['sm-start']], 'harness: open() without keep leaves no save behind, even after a page that was mid-battle');
    // 回主選單：先存，同一頁馬上接得回來
    await press('sm-start'); await fight('__rts.stepN(90);');
    const mid = await state();
    await press('b-menu');
    assert.deepEqual((await keys()).map(k => k.id), ['sm-resume', 'sm-restart', 'sm-main'], 'fixture: the pause menu');
    await press('sm-main');
    let k = await keys(), s = await state();
    assert(k[0]?.id === 'sm-continue' && s.phase === 'build' && s.tick === 0, `main menu: 回主選單 saves first, so the start menu offers 繼續上一局 at once (${JSON.stringify(k)})`);
    await press('sm-continue');
    s = await state();
    assert.deepEqual([s.phase, s.paused, s.tick, s.hash], ['battle', true, mid.tick, mid.hash], 'main menu: it returns to the step where 回主選單 was pressed');
    await shot(page, path.join(SHOTS, 'r074-phone-resumed.png'));
    console.log('OK R074: save on leaving, 繼續上一局 first, same step, log, report and camera, continues like the uninterrupted battle, 回主選單');

    // 各種局：換一個不相干的網址再開，接回來的還是存的那一局；之後「重新開始」是同一種局
    for (const [name, q, small, is] of [
      ['鄉間 64', 'map=64', /^鄉間 64×64 · 0:03 · /, v => v.n === 64 && v.map === MAP_LARGE],
      ['喪屍防守', 'mode=zombies', /^喪屍防守 · 萊伊 32×32 · 0:03 · /, v => v.zombies && v.n === 32],
      ['穿甲規則、兵力加倍', 'ap=1&force=3', /^萊伊 32×32 · 0:03 · /, v => v.rules?.ap === 1 && v.rules?.force === 3],
    ]) {
      await fresh(q); await press('sm-start'); await fight('__rts.stepN(60);');
      const at = await state();
      assert(is(at) && at.winner < 0, `fixture: ${name} is running (${JSON.stringify({ n: at.n, map: at.map, zombies: at.zombies, rules: at.rules })})`);
      await reload('seed=9');
      k = await keys();
      assert(k[0]?.id === 'sm-continue' && small.test(k[0].small), `kinds: ${name} is offered under its own name (${JSON.stringify(k[0])})`);
      await press('sm-continue');
      s = await state();
      assert(s.tick === at.tick && s.hash === at.hash && s.seed === at.seed && is(s), `kinds: ${name} resumes at the same step`);
      await E('__rts.stepN(100)');
      assert.equal(await E('__rts.hash()'), node(at.seed, at.log, at.tick + 100), `kinds: ${name} continues like the uninterrupted battle`);
      await press('b-menu'); await press('sm-restart');
      s = await state();
      assert(s.phase === 'build' && s.tick === 0 && s.seed === at.seed && is(s), `kinds: after resuming ${name}, 重新開始 gives the same kind of game (${JSON.stringify({ seed: s.seed, n: s.n, zombies: s.zombies, rules: s.rules })})`);
    }
    console.log('OK R074: large map, zombies and the armour rule each resume, continue and restart as the same kind of game');

    // 接回來打完：進 R047 的重播，存檔清掉
    await fresh(QUICK); await press('sm-start'); await fight("__rts.issue({ t: 'ai', side: 0, level: 3 }); __rts.stepN(120);");
    assert((await E('__rts.winner()')) < 0, 'fixture: the quick battle is still open when it is saved');
    await reload(QUICK); await press('sm-continue');
    for (let i = 0; i < 60 && (await E('__rts.winner()')) < 0; i++) await E('__rts.stepN(100)');
    await E('__rts.stepN(2)');   // 分出勝負之後再走兩步：重播存在下一步開頭
    const list = JSON.parse((await E(`localStorage.getItem(${JSON.stringify(REPLAY_KEY)})`)) ?? '[]'), rec = list[0];
    assert((await E('__rts.winner()')) >= 0 && list.length === 1 && decodeReplay(JSON.stringify(rec)).ok, `finish: the battle finished after resuming is saved as one replay (${list.length})`);
    assert.equal(node(rec.seed, rec.log, rec.ticks), rec.hash, 'finish: that replay reproduces from step 0 in Node');
    await reload();
    assert.deepEqual([await raw(), (await keys()).map(x => x.id)], [null, ['sm-start']], 'finish: once the battle is decided the save is gone and the menu no longer offers it');

    // 壞掉的存檔
    await refuses(good);
    // 沙盒不存
    await E(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
    await press('b-menu'); await press('sm-mode-sandbox');
    assert((await state()).sandbox, 'fixture: the sandbox opened');
    await leave();
    assert.equal(await raw(), null, 'sandbox: nothing is saved');
    // 版面（四個尺寸）＋看重播：不存也不清
    await put(SAVE_KEY, good); await put(REPLAY_KEY, JSON.stringify([rec]));
    await reload();
    for (const [w, h, m] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
      await size(w, h, m);
      for (const id of ['sm-continue', 'sm-start']) { const r = await rect(id); assert(r && r.w >= 44 && r.h >= 44 && r.inside && r.hit && r.fits, `layout: ${id} is a whole reachable 44px target with its text inside at ${w}×${h} (${JSON.stringify(r)})`); }
      const off = await E(`[...document.querySelectorAll('#start-menu button, #start-menu input')].map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit)`);
      assert.deepEqual(off, [], `layout: with 繼續上一局 every key of the start menu is still a whole reachable 44px target without scrolling at ${w}×${h} (${JSON.stringify(off)})`);
    }
    await size(412, 915, true); await shot(page, path.join(SHOTS, 'r074-phone-menu.png'));
    await press('sm-replays'); await press('rpl-watch-0');
    await E('__rts.pause(true)'); await E('__rts.stepN(40)');
    await leave();
    assert.equal(await raw(), good, 'replay: watching a replay neither overwrites nor clears the save');
    // 逃生閥
    await reload('noR074=1');
    assert.deepEqual((await keys()).map(x => x.id), ['sm-start'], 'valve: noR074 offers nothing');
    await press('sm-start'); await fight('__rts.stepN(30);'); await leave();
    assert.equal(await raw(), good, 'valve: noR074 stores nothing and leaves what is there alone');
    assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R074: finished battle becomes a replay and clears the save, damaged saves refused, sandbox and replay viewing do not save, four sizes, valve');

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nosave', async () => { await resumes('__r074mutant=nosave'); }, 'save: leaving the page stores this battle'],
      ['otherworld', async () => { await resumes('__r074mutant=otherworld'); }, 'resume: 繼續上一局 returns to the same step'],
      ['nopending', async () => { await resumes('__r074mutant=nopending'); }, 'resume: 200 steps later the battle equals'],
      ['offerbad', async () => { await refuses(good, '__r074mutant=offerbad'); }, 'corrupt: a save that is cut in half is not offered'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R074 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R074 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R074 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
