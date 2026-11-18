// R090 海斯（地圖 5）在真的 Chrome（CI 是 SwiftShader；手機 412×860、dpr 1）：卡面驗收 3、7、9、11。
//   預算：開局 ≤ 20 次繪製、≤ 80,000 個三角形；打 600 步之後鏡頭在地圖中心、以及鎮上的混戰（夾具 tools/r089-fixture.mjs：每邊 64 個班），
//         zoom 1 與 0.55 都 ≤ 22 次、≤ 80,000，小兵三角形 ≤ 32,000、活著的小兵 ≤ 800（R096 的預算）；
//   重播：Chrome 裡跑的那一局（第 600 步，另開一局到第 2,400 步），紀錄拿回 Node 重播，雜湊一樣；
//   選單：預設的閥（丘陵、海斯都開）地圖那一列六顆排成兩行，四種手機尺寸每一顆都是完整、沒被裁、點得到的 44px 鍵；海斯不列喪屍防守、藏起喪屍鍵；
//   閥：?noR090=1 時 ?map=hythe 開成萊伊、設定頁沒有「海斯」；頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r090-browser-'));

await runOrSkip('hythe-map', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture89(root)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9982 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const budget = (m, why, calls) => assert(m.calls <= calls && m.triangles <= 80000, `budget: ${why} ≤ ${calls} calls and 80,000 triangles (${m.calls} / ${m.triangles})`);
      // 開局
      await open('map=hythe&seed=1944&noR100=1&noR089=0'); await E('__rts.pause(true); 0');
      assert.deepEqual(await E('[__rts.map(), __rts.mapSize()]'), [5, 128], 'page: ?map=hythe opens map 5 (128×128)');
      const opening = await measure(E, frames); budget(opening, 'the opening', 20);
      // 開戰、打 600 步（中間畫幀），鏡頭在地圖中心
      await E('__rts.startBattle(); __rts.pause(true); 0');
      for (let k = 0; k < 20; k++) { await E('__rts.stepN(30)'); await frames(); }
      const got = {};
      for (const zoom of [1, 0.55]) { await E(`__r089.cam(64, 64, ${zoom})`); got[`t600/${zoom}`] = await measure(E, frames); budget(got[`t600/${zoom}`], `tick 600 at the map centre, zoom ${zoom}`, 22); }
      // 重播：這一局的紀錄拿回 Node
      const seed = await E('__rts.seed()'), tick = await E('__rts.tick()'), hash = await E('__rts.hash()'), log = await E('__rts.log()');
      assert.equal(hashWorld(runLog(createWorld(seed), log, tick)), hash, `replay: the page's map-5 game replays in Node to the same hash at tick ${tick}`);
      // 鎮上的混戰：每邊 64 個班，鏡頭在鎮中心
      const n = await E('__r089.crowd(64, 64, 64, false)');
      assert.equal(n, 128, `fixture: 64 sections a side are on the map (${n})`);
      for (const zoom of [1, 0.55]) {
        await E(`__r089.cam(64, 64, ${zoom})`); const m = got[`town/${zoom}`] = await measure(E, frames), s = m.men.sec;
        budget(m, `the town fight at zoom ${zoom}`, 22);
        assert(s.tris <= 32000 && s.live <= 800, `budget: the town fight at zoom ${zoom} keeps men ≤ 32,000 triangles and ≤ 800 live figures (${s.tris} / ${s.live})`);
      }
      // 重播到第 2,400 步：另開一局，只走模擬（上面那一局放了夾具的班，不能再重播）
      await open('map=hythe&seed=1945&noR100=1'); await E('__rts.pause(true); 0');
      await E('__rts.startBattle(); __rts.pause(true); 0');
      for (let t = await E('__rts.tick()'); t < 2400; ) t = await E(`__rts.stepN(${Math.min(300, 2400 - t)})`);   // startBattle 已經走了一步
      const [s2, t2, h2, l2] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.equal(t2, 2400, `replay: the second game reached tick 2,400 (${t2})`);
      assert.equal(hashWorld(runLog(createWorld(s2), l2, t2)), h2, 'replay: a 2,400-tick map-5 game in Chrome replays in Node to the same hash');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`hythe phone 412×860: opening ${opening.calls}/${opening.triangles}; tick 600 ${got['t600/1'].calls}/${got['t600/1'].triangles} · ${got['t600/0.55'].calls}/${got['t600/0.55'].triangles}; town fight ${got['town/1'].calls}/${got['town/1'].triangles} · ${got['town/0.55'].calls}/${got['town/0.55'].triangles}`);
      // 閥關著：?map=hythe 開成萊伊，設定頁沒有海斯
      await open('map=hythe&seed=1944&noR100=1&noR090=1&noR069=0'); await E('__rts.pause(true); 0');
      assert.deepEqual(await E('[__rts.map(), __rts.mapSize()]'), [1, 32], 'valve: with ?noR090=1, ?map=hythe opens Rye');
      assert.equal(await E("!!document.getElementById('sm-map-hythe')"), false, 'valve: with ?noR090=1 the setup page offers no Hythe');
      await open('seed=1944&noR100=1&noR069=0'); await E('__rts.pause(true); 0');
      assert.equal(await E("!!document.getElementById('sm-map-hythe') || [...document.querySelectorAll('button')].some(b => b.textContent.includes('海斯'))"), true, 'menu: the start menu offers 海斯 (128×128)');
      // 版面（R046 的規則）：每一顆至少 44px、字沒被裁；地圖那一列每一顆都在畫面裡、點中間點得到它自己
      const geometry = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect(),map=b.id.startsWith('sm-map-');return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:!map||(r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight),hit:!map||b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
      assert.equal(await E("document.querySelectorAll('#sm-maps button').length"), 6, 'menu: the default map row has six maps (萊伊、村莊、丘陵、鄉間、河鎮、海斯)');
      for (const [w, h] of [[412, 860], [390, 844], [360, 780], [860, 412]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames();
        assert.deepEqual(await geometry(), [], `menu: at ${w}×${h} every start-menu key is a whole, unclipped 44px target and every map key is on screen and reachable`);
      }
      await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true }); await frames();
      // 海斯沒有喪屍模式：選單不列、喪屍鍵藏起來；回到萊伊又有
      const modes = () => E("[__rts.map(), !!document.getElementById('sm-mode-zombies'), document.getElementById('zombies-pick')?.hidden ?? true]");
      assert.deepEqual(await modes(), [1, true, false], 'menu: Rye offers 喪屍防守 and shows the 喪屍 key');
      await E("document.getElementById('sm-map-hythe').click(); 0"); await frames();
      assert.deepEqual(await modes(), [5, false, true], 'menu: 海斯 offers no 喪屍防守 and hides the 喪屍 key');
      await E("document.getElementById('sm-map-rye').click(); 0"); await frames();
      assert.deepEqual(await modes(), [1, true, false], 'menu: back on Rye 喪屍防守 is offered again');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
    });
    console.log('hythe-map browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
