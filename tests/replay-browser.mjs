// R047 重播：真實 Chrome（手機觸控 412×915；版面另量三個尺寸）。打完自動存、重播面板、播放時擋玩家指令、雜湊比對、匯出、匯入、逃生閥、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { MAP_RYE } from '../src/sim/maps.ts';
import { REPLAY_KEY, decodeReplay } from '../src/ui/replayStore.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r047-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const SAME = '重播結束 · 跟原局相同', DIFF = '這份紀錄是別的版本存的，結果可能跟原局不同';
const QUICK = 'force=1&noR019=1';   // 精簡兵力、沒有指揮部（全滅才結束）：雙方都交給電腦，幾百步就分出勝負
// 故意弄壞（只編進 broken 那一份，網址帶 __r047mutant 才生效）
const mutations = {
  nosave: ['src/ui/replay.ts', '    if (w.winner >= 0 && saved !== w && !w.sandbox) {', "    if (!location.search.includes('__r047mutant=nosave') && w.winner >= 0 && saved !== w && !w.sandbox) {"],
  leak: ['src/ui/replay.ts', "      say(`重播中 ${clock(w.tick)}／${clock(rec.ticks)}`);\n      return out;", "      say(`重播中 ${clock(w.tick)}／${clock(rec.ticks)}`);\n      return location.search.includes('__r047mutant=leak') ? [...out, ..._pending] : out;"],
  liar: ['src/ui/replay.ts', 'say(host.hash() === rec.hash ? REPLAY_SAME : REPLAY_DIFF);', "say(host.hash() === rec.hash || location.search.includes('__r047mutant=liar') ? REPLAY_SAME : REPLAY_DIFF);"],
};
const applied = new Set();
const plugin = { name: 'r047-dormant-negatives', enforce: 'pre', transform(code, id) {
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
  await withBrowser({ root: baseline, overlay, port: 8499, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let width = 412, height = 915, mobile = true;
    const size = async (w, h, m = true) => { width = w; height = h; mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const stored = async () => JSON.parse(await E(`localStorage.getItem(${JSON.stringify(REPLAY_KEY)})`) ?? '[]');
    const state = () => E(`({phase:__rts.phase(),paused:__rts.paused(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),map:__rts.map(),winner:__rts.winner(),log:__rts.log().length})`);
    const panel = () => E(`(()=>{const p=document.getElementById('replays');return {open:!!p&&!p.hidden,ids:p?[...p.querySelectorAll('button')].map(b=>b.id):[],rows:p?[...p.querySelectorAll('.rpl-watch')].map(b=>b.textContent):[],note:document.getElementById('rpl-note')?.textContent??''}})()`);
    const bar = () => E(`(()=>{const b=document.getElementById('replay-bar');return {shown:!!b&&!b.hidden,text:document.getElementById('replay-text')?.textContent??''}})()`);
    const geometry = () => E(`(()=>{const bs=[...document.querySelectorAll('#replays button')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit)})()`);
    const menuIds = () => E(`[...document.querySelectorAll('#start-menu button')].map(b=>b.id)`);
    // 打一局到分出勝負：開戰、我方也交給電腦、一步一步走
    const fight = async () => {
      if (await E("!!document.getElementById('sm-start') && !document.getElementById('start-menu').hidden")) await press('sm-start');
      // 開戰、暫停、把我方交給電腦要在同一次呼叫裡做完：中間不能讓畫面多跑幾步，不然電腦接手的那一步每次不一樣、同一局就打不出同一個結果
      await E("(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'ai', side: 0, level: 3 }); })()");
      for (let i = 0; i < 60 && (await E('__rts.winner()')) < 0; i++) await E('__rts.stepN(100)');
      await E('__rts.stepN(2)');   // 分出勝負之後再走兩步：存檔發生在下一步開頭
      const s = await state();
      assert(s.winner >= 0, `fixture: the quick battle ends (tick ${s.tick})`);
      return s;
    };
    // 把正在播的重播走到存檔那一步，回傳那一刻的雜湊與那一條的字
    const playToEnd = async rec => {
      await E('__rts.pause(true)');
      const at = await E('__rts.tick()');
      assert(at <= rec.ticks, `fixture: replay is still before the saved tick (${at} / ${rec.ticks})`);
      await E(`__rts.stepN(${rec.ticks - at})`);
      const hash = await E('__rts.hash()');
      await E('__rts.stepN(1)');
      return { hash, text: (await bar()).text };
    };
    const openPanel = async () => {
      if (await E('__rts.report().shown')) await press('rp-look');   // 戰報蓋著的時候先收起來（rp-look 是 R010 戰報的「看戰場」）
      if (!(await E("!!document.getElementById('start-menu') && !document.getElementById('start-menu').hidden"))) await press('b-menu');
      if ((await menuIds()).includes('sm-main')) await press('sm-main');
      assert((await menuIds()).includes('sm-replays'), 'menu: the start menu has a 重播 key');
      await press('sm-replays');
      const p = await panel(); assert(p.open, 'panel: 重播 opens the replay panel'); return p;
    };

    // ---- 共用的檢查 ----
    const saves = async (q = '') => {
      await open(`${QUICK}${q}`, { menu: true });
      const end = await fight(), list = await stored();
      assert.equal(list.length, 1, `save: one record after the battle (found ${list.length})`);
      const rec = list[0];
      assert(rec.v === 1 && rec.seed === end.seed && rec.ticks > 0 && rec.ticks <= end.tick && /^[0-9a-f]{8}$/.test(rec.hash) && rec.meta.map === MAP_RYE && rec.meta.winner === end.winner, `save: the record describes this battle (${JSON.stringify({ ...rec, log: rec.log.length })})`);
      assert.equal(decodeReplay(JSON.stringify(rec)).ok, true, 'save: the stored record passes the format check');
      return rec;
    };
    const blocks = async rec => {   // 播的時候玩家的指令不能進世界
      const p = await openPanel();
      assert(p.ids.includes('rpl-watch-0'), 'panel: the saved battle is listed');
      await press('rpl-watch-0');
      let s = await state(), b = await bar();
      assert(s.phase === 'battle' && s.tick >= 1 && s.tick < rec.ticks && b.shown && b.text.startsWith('重播中'), `replay: watching restarts the battle from tick 0 with the bar showing (tick ${s.tick}, “${b.text}”)`);
      assert.equal((await panel()).open, false, 'replay: the panel closes');
      for (const [w, h, m] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
        await size(w, h, m); await sleep(150); await frames();
        const clash = await E(`(()=>{const a=document.getElementById('replay-bar').getBoundingClientRect();return ['r901-chrome','minimap','fire-discipline','replay-leave'].map(id=>document.getElementById(id)).concat([document.querySelector('#hud .top'),document.querySelector('#hud .btns')]).filter(Boolean).map(e=>({id:e.id||e.className,r:e.getBoundingClientRect()})).filter(b=>b.id!=='replay-leave'&&b.r.width&&a.left<b.r.right&&a.right>b.r.left&&a.top<b.r.bottom&&a.bottom>b.r.top).map(b=>b.id)})()`);
        assert.deepEqual(clash, [], `layout: the replay bar clears the status line, the keys, the phone chrome, the fire key and the minimap at ${w}×${h} (${clash})`);
        const leave = await rect('replay-leave');
        assert(leave && leave.hit && leave.w >= 44 && leave.h >= 44, `layout: 離開 is a reachable 44px target at ${w}×${h}`);
      }
      await size(412, 915, true);
      await E('__rts.pause(true)');
      // 停火待命會在單位上留下旗標（進雜湊），電腦接手的那一方也不會自己取消：漏進世界的話雜湊一定不同
      await E("__rts.issue({ t: 'fireDiscipline', side: 0, ids: [1, 2], hold: true })"); await E("__rts.issue({ t: 'move', side: 0, ids: [1, 2], x: 1, z: 1 })");
      // 真的手指：先選兩台，再點地圖下移動指令（走遊戲平常的輸入路徑）。指令有發出去，但不能進世界
      const issued = await E('__rts.log().length');
      await E('__rts.select([1, 2])'); await touchTap(page, 206, 560); await frames();
      assert((await E('__rts.log().length')) > issued, 'fixture: the tap on the map really issued a command through the normal input path');
      const end = await playToEnd(rec);
      assert.equal(end.hash, rec.hash, 'replay: commands issued while watching never reach the world (hash at the saved tick equals the record)');
      return end;
    };
    const wrongHash = async rec => {   // 雜湊對不上要說出來
      const fake = { ...rec, hash: rec.hash === '00000000' ? '00000001' : '00000000', at: '2026-01-01T00:00:00.000Z' };
      await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([fake]))})`);
      await openPanel(); await press('rpl-watch-0');
      const end = await playToEnd(fake);
      assert.equal(end.hash, rec.hash, 'fixture: the tampered record still replays the real battle');
      assert.equal(end.text, DIFF, 'replay: a record whose hash does not match is reported as different');
    };

    // ---- 正向 ----
    const rec = await saves();
    assert.equal(await E(`__rts.playLog(${rec.seed}, ${JSON.stringify(rec.log)}, ${rec.ticks})`), rec.hash, 'save: seed, log and ticks reproduce the recorded hash');
    await open(QUICK, { menu: true, keep: true });
    assert.equal((await stored()).length, 1, 'save: the record is still there after reloading the page');
    let p = await openPanel();
    assert.deepEqual(p.ids, ['rpl-watch-0', 'rpl-export-0', 'rpl-back', 'rpl-import'], 'panel: one row with 匯出, then 返回 and 匯入');
    await shot(page, path.join(SHOTS, 'r047-phone-panel.png'));
    for (const [w, h, m] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) { await size(w, h, m); assert.deepEqual(await geometry(), [], `layout: replay panel ${w}×${h} every key is a whole reachable 44px target`); }
    await size(1280, 800, false); await shot(page, path.join(SHOTS, 'r047-desktop-panel.png'));
    await size(412, 915, true);
    // 匯出：攔下要下載的內容
    await E("(() => { const make = URL.createObjectURL.bind(URL); window.__blobs = []; window.__downloads = []; URL.createObjectURL = b => { window.__blobs.push(b); return make(b); }; HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); }; })()");
    await press('rpl-export-0');
    const text = await E('window.__blobs[0] ? window.__blobs[0].text() : null');
    assert.deepEqual(decodeReplay(text ?? ''), { ok: true, rec }, 'export: the downloaded file decodes to the stored record');
    assert.deepEqual(await E('window.__downloads'), [`gtrts-replay-${rec.seed}-${rec.ticks}.json`], 'export: one download named after the seed and the tick count');
    assert.match((await panel()).note, /已匯出/, 'export: the panel says so');
    await press('rpl-back');
    assert(!(await panel()).open && await E("!document.getElementById('start-menu').hidden"), 'panel: 返回 goes back to the menu');
    await E("document.getElementById('sm-resume')?.click()");
    // 播放：擋指令、雜湊相同、不重複存
    const end = await blocks(rec);
    assert.equal(end.text, SAME, 'replay: the bar says the replay matched the original battle');
    assert.equal((await stored()).length, 1, 'replay: watching does not save the battle again');
    await shot(page, path.join(SHOTS, 'r047-phone-replay.png'));
    await E('__rts.pause(false)');
    let shown = false;
    for (let i = 0; i < 40 && !shown; i++) { await sleep(250); shown = await E('__rts.report().shown'); }
    assert(shown, 'replay: the battle report appears at the end of the replay');
    // 戰報的「再來一局」：回一般開局；這時遊戲停在布陣、不再走步，「重播中」那一條也要自己收掉
    await press('rp-again'); await sleep(600); await frames();
    let s = await state();
    assert(s.phase === 'build' && s.tick === 0 && !(await bar()).shown, `again: 再來一局 from a replay returns to an ordinary game and takes the bar away (${s.phase}, tick ${s.tick}, bar ${(await bar()).shown})`);
    // 之後打的局照常存；同一局存兩次只有一筆
    await E(`localStorage.removeItem(${JSON.stringify(REPLAY_KEY)})`);
    await fight();
    assert.equal((await stored()).length, 1, 'leave: a battle fought after leaving a replay is saved again');
    await E(`__rts.playLog(${rec.seed}, ${JSON.stringify(rec.log)}, ${rec.ticks + 3})`);
    assert.equal((await stored()).length, 1, 'save: the same battle reaching its end twice is stored once, not twice');
    // 大地圖（64×64）：重播起播時世界換了大小，畫面要照新世界重建、鏡頭對準我方角落
    // 大地圖上全滅要打很久，這裡不等勝負：打 400 步，照格式自己做一筆紀錄放進本機，再從面板播
    await open(`map=64&seed=47&${QUICK}`, { menu: true, keep: true });
    await press('sm-start'); await E("(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'ai', side: 0, level: 3 }); __rts.stepN(400); })()");
    const bigEnd = await state();
    const big = { v: 1, seed: 47, ticks: bigEnd.tick, hash: bigEnd.hash, log: await E('__rts.log()'), at: '2026-03-03T00:00:00.000Z', meta: { map: 2, n: 64, winner: -1, seconds: Math.floor(bigEnd.tick / 20) } };
    assert(decodeReplay(JSON.stringify(big)).ok && bigEnd.seed === 47 && bigEnd.tick > 400, `large: a hand-made record of the 64×64 battle passes the format check (tick ${bigEnd.tick})`);
    await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([big]))})`);
    await openPanel(); await press('rpl-watch-0');
    const cam = await E('__rts.cam()'), n = await E('__rts.mapSize()');
    assert(n === 64 && Math.abs(cam.x - 55) < 1 && Math.abs(cam.z - 55) < 1, `large: the replay rebuilds the 64×64 view and looks at the player corner (n ${n}, camera ${cam.x},${cam.z})`);
    const bigReplay = await playToEnd(big);
    assert(bigReplay.hash === big.hash && bigReplay.text === SAME, 'large: the 64×64 replay reaches the recorded hash');
    await press('replay-leave');
    // 匯入：好檔、壞檔
    const good = path.join(temp, 'good.json'), junk = path.join(temp, 'junk.json'), other = path.join(temp, 'other.json'), deep = path.join(temp, 'deep.json');
    fs.writeFileSync(good, text); fs.writeFileSync(junk, '{ not json'); fs.writeFileSync(deep, `{"v":${'['.repeat(5000)}${']'.repeat(5000)}}`); fs.writeFileSync(other, JSON.stringify({ ...rec, seed: rec.seed + 1, at: '2026-02-02T00:00:00.000Z' }));
    const upload = async file => {
      const { root } = await page.send('DOM.getDocument', {}), { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#rpl-file' });
      await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
      await sleep(300); await frames();
    };
    await E(`localStorage.removeItem(${JSON.stringify(REPLAY_KEY)})`);
    await open(QUICK, { menu: true, keep: true });
    p = await openPanel();
    assert.deepEqual(p.ids, ['rpl-back', 'rpl-import'], 'panel: empty list shows only 返回 and 匯入');
    await upload(junk);
    p = await panel();
    assert(/匯入失敗/.test(p.note) && p.rows.length === 0 && (await stored()).length === 0, `import: a broken file is refused with a reason and nothing is stored (“${p.note}”)`);
    await upload(deep);
    p = await panel();
    assert(/匯入失敗/.test(p.note) && p.rows.length === 0, `import: a file built to overflow the checker is refused with a reason (“${p.note}”)`);
    await upload(good);
    p = await panel();
    assert(p.rows.length === 1 && /已匯入/.test(p.note) && (await stored())[0].hash === rec.hash, `import: a good file is added to the list (“${p.note}”)`);
    await upload(other);
    assert.deepEqual((await stored()).map(r => r.seed), [rec.seed + 1, rec.seed], 'import: the newest import goes first');
    await press('rpl-watch-1');
    const again = await playToEnd(rec);
    assert(again.hash === rec.hash && again.text === SAME, 'import: an imported battle replays to the recorded hash');
    await press('replay-leave');
    s = await state();
    assert(s.phase === 'build' && s.tick === 0 && !(await bar()).shown, `leave: 離開 returns to an ordinary game at build step 0 (${s.phase}, tick ${s.tick})`);
    await wrongHash(rec);
    await press('replay-leave');
    // 沙盒不存
    await E(`localStorage.removeItem(${JSON.stringify(REPLAY_KEY)})`);
    await open('', { menu: true, keep: true }); await press('sm-mode-sandbox'); await press('sm-start');
    await E("__rts.issue({ t: 'sandboxPlace', side: 0, kind: 0, x: 14, z: 14 })"); await E("__rts.issue({ t: 'sandboxPlace', side: 1, kind: 0, x: 16, z: 14 })"); await E("__rts.issue({ t: 'sandboxRun', running: true })");
    await E('__rts.stepN(400)');
    assert(await E('!!__rts.sandbox()') && (await stored()).length === 0, 'sandbox: nothing is saved from the sandbox');
    // 逃生閥
    await open(`noR047=1&${QUICK}`, { menu: true });
    assert(!(await menuIds()).includes('sm-replays'), 'valve: noR047 removes the 重播 key');
    await fight();
    assert.equal(await E(`localStorage.getItem(${JSON.stringify(REPLAY_KEY)})`), null, 'valve: noR047 stores nothing');
    assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R047: auto-save, reload, panel, four sizes, export, replay blocks input, same hash, report, leave, import good/bad, wrong hash, sandbox, valve');

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nosave', async () => { await saves('&__r047mutant=nosave'); }, 'save: one record after the battle'],
      ['leak', async () => { const r = await saves('&__r047mutant=leak'); await blocks(r); }, 'replay: commands issued while watching never reach the world'],
      ['liar', async () => { const r = await saves('&__r047mutant=liar'); await wrongHash(r); }, 'replay: a record whose hash does not match'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R047 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R047 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R047 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
