// R1010 炸橋與修橋在真的 Chrome（CI 是 SwiftShader；手機 412×860 觸控）：卡面驗收 19–25。網址帶 noR1010=0、noR1002=0、noR091=0（tools/cdp.mjs 預設關掉這三張）。
//   新開的局 eco 帶 br＝1、sw＝2；閥：?noR1010=1 不帶 br、?noR091=1 兩個都不帶；
//   造一個工兵、選它、按「砲擊」、在畫面上點橋 0：送出去的是工兵那一格的射擊指令；跑到斷：地面畫成泥、城鎮網格多了斷橋的殘段；
//   不按砲擊點斷橋：送射擊指令、補給少 10、提示列有「工兵去修橋」，修好之後有木橋；頁面＝Node 重播；?noR1010=1 的頁面照樣重播帶 br 的紀錄；
//   修好那一步城鎮網格當場重建（三角形＝Node 用同一個世界建的）；橋 2 斷了之後點橋 0：不送、提示列說是最後一座；木橋上的單位看得到隊色圓盤和選取圈（審查補的）。預算在 tests/bridge1010-budget-browser.mjs（CI 每支限 120 秒）。截圖存 R1010_SHOTS（沒設就是 shots/，不進倉庫）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, TER_MUD } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { buildTown } from '../src/render/buildings.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1010-browser-')), SHOTS = process.env.R1010_SHOTS || path.join(ROOT, 'shots');
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
const Q = 'noR1002=0&noR091=0&noR1010=0&seed=1944';
await runOrSkip('bridge1010', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9917 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const shot = async name => { const s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.data, 'base64')); };
      const ecoOf = async () => (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      const hint = () => E("document.getElementById('hint').textContent");
      // 點那一格：離每一顆看得到的 HUD 鍵 30 像素以上（Chrome 會把附近的觸控吸到按鈕上）
      const tapCell = async (x, z, label) => {
        const xy = await E(`__rts.screenOfCell(${x}, ${z})`);
        const clear = await E(`[...document.querySelectorAll('#hud button, #minimap')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return Math.max(r.left - ${xy[0]}, 0, ${xy[0]} - r.right) + Math.max(r.top - ${xy[1]}, 0, ${xy[1]} - r.bottom); }).reduce((a, b) => Math.min(a, b), 1e9)`);
        assert(clear > 30 && xy[0] > 0 && xy[1] > 0 && xy[0] < 412 && xy[1] < 860, `${label}: fixture — the tap point is on screen and clear of every key (${xy}, ${clear}px)`);
        const n0 = (await E('__rts.log()')).length;
        await tapNow(page, xy[0], xy[1]); await frames();
        return n0;
      };
      const sentSince = async n0 => (await E('__rts.log()')).slice(n0).map(c => c.cmd);
      const fireOn = async on => { if ((await E("document.getElementById('b-fire').classList.contains('on')")) !== on) await E("document.getElementById('b-fire').click(); 0"); await frames(); assert.equal(await E("document.getElementById('b-fire').classList.contains('on')"), on, `fixture: fire mode ${on}`); };
      // 驗收 19：新開的局與閥
      await open(Q); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      const eco = await ecoOf();
      assert.deepEqual([eco.br, eco.sw], [1, 2], `page: a new battle sends br 1 and sw 2 (${JSON.stringify(eco)})`);
      // 驗收 20：造一個工兵、走到橋 0 的南岸（同一頁重播一局；R050 守衛也是這樣做的。開頁很慢：閥的那兩頁放到最後，一起做）
      const lg0 = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: eco }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
      const w300 = runLog(createWorld(1944), lg0, 300), en = w300.units.find(u => u.kind === 47 && u.side === 0 && u.alive);
      assert(en && w300.br, 'fixture: the replayed game has w.br and an engineer');
      const lg = [...lg0, { tick: 300, cmd: { t: 'move', side: 0, ids: [en.id], x: 23, z: 10 } }];
      const node = runLog(createWorld(1944), lg, 1000), ne = node.units[en.id - 1];
      assert(Math.abs((ne.x >> 8) - 23) <= 1 && Math.abs((ne.z >> 8) - 10) <= 1, `fixture: the engineer reached the south bank (${ne.x >> 8},${ne.z >> 8})`);
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 1000)`), hashWorld(node), 'replay: the page plays the game to the Node hash');
      await E(`__rts.pause(true); __rts.select([${en.id}]); __rts.focus(26, 9, 1.4); 0`); await frames(); await frames();
      await fireOn(true);
      const groundBefore = await E('__r089.ground10(24, 7)'), tris0 = (await E('__rts.info()')).townTris;
      let n0 = await tapCell(24, 7, 'blow');
      await E('__rts.stepN(1); 0');
      assert.deepEqual((await sentSince(n0)).filter(c => c.t === 'fireAt'), [{ t: 'fireAt', side: 0, ids: [en.id], x: 24, z: 7 }], 'blow: with fire mode on, a tap on bridge 0 sends the engineer a fire order on that cell');
      for (let k = 0; k < 40 && (await E('__r089.br10()'))[0][0] !== 1; k++) await E('__rts.stepN(20)');
      assert.equal((await E('__r089.br10()'))[0][0], 1, 'blow: bridge 0 breaks');
      await E('__rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames();
      const mud = await E('__r089.ground10(23, 7)'), road = await E('__r089.ground10(24, 5)'), after = await E('__r089.ground10(24, 7)');
      const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      assert(d(after, mud) < d(after, road) && d(groundBefore, road) < d(groundBefore, mud), `blow: the ground of the bridge cell went from road to mud (${groundBefore} → ${after}; mud ${mud}, road ${road})`);
      const tris1 = (await E('__rts.info()')).townTris;
      assert(tris1 > tris0, `blow: the town mesh carries the broken stubs (${tris0} → ${tris1})`);
      await E('__rts.stepN(100); __rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames();   // 等爆炸的煙散掉再拍
      await shot('r1010-broken.png');
      // 驗收 21：不按砲擊點斷橋＝修
      await fireOn(false);
      while ((await E('__rts.tick()')) % 20 === 0) await E('__rts.stepN(1); __rts.pause(true); 0');   // 下一步不要剛好領補給（ecoStep 看走之前的 w.tick），才量得準
      const sup0 = (await E('__rts.eco()')).supply[0];
      n0 = await tapCell(24, 7, 'repair');
      await E('__rts.stepN(1); 0');
      assert.deepEqual((await sentSince(n0)).filter(c => c.t === 'fireAt'), [{ t: 'fireAt', side: 0, ids: [en.id], x: 24, z: 7 }], 'repair: without fire mode a tap on the broken bridge sends the engineer a fire order');
      assert.equal(sup0 - (await E('__rts.eco()')).supply[0], 10, 'repair: and 10 supply is paid');
      await E('__rts.stepN(19); __rts.pause(true); 0'); await frames(); await frames();
      assert.match(await hint(), /工兵去修橋/, 'repair: within 3 seconds the hint bar says 工兵去修橋');
      for (let k = 0; k < 40 && (await E('__r089.br10()'))[0][0] !== 2; k++) await E('__rts.stepN(20)');
      assert.deepEqual((await E('__r089.br10()'))[0], [2, 20, 0], 'repair: bridge 0 is a timber bridge');
      await E('__rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames();
      const trisT = (await E('__rts.info()')).townTris;
      assert(trisT > tris0, 'repair: the town mesh carries the timber deck');
      await shot('r1010-timber.png');
      // 驗收 23：頁面＝Node 重播；?noR1010=1 的頁面照樣重播帶 br 的紀錄
      const [s2, t2, h2, l2] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]'), nodeT = runLog(createWorld(s2), l2, t2);
      assert.equal(hashWorld(nodeT), h2, `replay: the page at tick ${t2} equals the Node replay of its own log`);
      // 修好那一步的 bridge 事件讓城鎮網格當場重建：頁面從斷橋到木橋多的三角形＝Node 在同一個世界把橋 0 換回斷橋差的那麼多（沒重建的話頁面還是斷橋殘段的 tris1；審查找到的缺口）
      const asBroken = structuredClone(nodeT), sp0 = asBroken.br.spans[0]; sp0.state = 1; sp0.hp = 0; sp0.left = 0; for (const c of sp0.cells) asBroken.ter[c] = TER_MUD;
      const artDelta = buildTown(nodeT).triangles - buildTown(asBroken).triangles;
      assert(artDelta !== 0 && trisT - tris1 === artDelta, `repair: the town mesh is rebuilt live with the timber deck (page ${tris1} → ${trisT}, Node timber − broken ${artDelta})`);
      // 驗收 22：橋 2 斷了之後點橋 0（夾具直接把橋 2 設成斷的）
      await E('__r089.bridge10(2, 1); __rts.pause(true); 0'); await fireOn(true);
      n0 = await tapCell(24, 7, 'last');
      assert.deepEqual(await sentSince(n0), [], 'last: with bridge 2 down a tap on bridge 0 sends nothing');
      assert.match(await hint(), /最後一座車過得去的橋/, 'last: the hint bar says it is the last bridge');
      // 木橋上的單位：隊色圓盤、選取圈看得到（審查：0.06 高的橋面把它們整個蓋掉）。先在岸上量一次當基準，走上木橋再量一次
      await fireOn(false);
      const count = async (name) => {
        for (let k = 0; k < 6; k++) await frames();
        const s = await page.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.data, 'base64'));
        const [cx, cy] = await E(`__rts.screenOf(${en.id})`);
        return E(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${s.data}'; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const dpr = img.width / innerWidth, R = Math.round(60 * dpr), x0 = Math.max(0, Math.round(${cx} * dpr) - R), y0 = Math.max(0, Math.round(${cy} * dpr) - R);
          const d = g.getImageData(x0, y0, 2 * R, 2 * R).data; let ring = 0, blue = 0;
          for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], b = d[i + 2]; if (r > 220 && gg > 190 && gg < 245 && b < 140) ring++; if (b > 170 && r < 110 && gg < 170) blue++; }
          return { ring, blue }; })()`);
      };
      const [s3, t3, l3] = await E('[__rts.seed(), __rts.tick(), __rts.log()]'), bank = runLog(createWorld(s3), l3, t3).units[en.id - 1];
      await E(`__rts.select([${en.id}]); __rts.focus(${bank.x / 256}, ${bank.z / 256}, 2.2); 0`);
      const onBank = await count('r1010-ring-bank.png');
      await E(`__rts.issue({ t: 'move', side: 0, ids: [${en.id}], x: 24, z: 7 }); __rts.stepN(150); __rts.pause(true); 0`);
      const [s4, t4, l4] = await E('[__rts.seed(), __rts.tick(), __rts.log()]'), deck = runLog(createWorld(s4), l4, t4).units[en.id - 1];
      assert.deepEqual([deck.x >> 8, deck.z >> 8, (await E('__r089.br10()'))[0][0]], [24, 7, 2], `ring: fixture: the engineer stands on the timber bridge (${deck.x >> 8},${deck.z >> 8})`);
      await E(`__rts.select([${en.id}]); __rts.focus(${deck.x / 256}, ${deck.z / 256}, 2.2); 0`);
      const onDeck = await count('r1010-ring-timber.png');
      assert(onBank.ring > 50 && onBank.blue > 50, `ring: fixture: on the bank the selection ring and team disc show (${JSON.stringify(onBank)})`);
      assert(onDeck.ring * 10 >= onBank.ring * 3 && onDeck.blue * 10 >= onBank.blue * 3, `ring: a unit on a timber bridge still shows its selection ring and team disc (bank ${JSON.stringify(onBank)}, timber ${JSON.stringify(onDeck)})`);
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      // 驗收 19 的閥、驗收 23 的另一半
      await open('noR091=1&noR1002=0&noR1010=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.deepEqual([(await ecoOf()).br, (await ecoOf()).sw], [undefined, undefined], 'valve: ?noR091=1 sends neither sw 2 nor br');
      await open('noR1010=1&noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.deepEqual([(await ecoOf()).br, (await ecoOf()).sw], [undefined, 2], 'valve: ?noR1010=1 sends no br (sw 2 stays)');
      assert.equal(await E(`__rts.playLog(${s2}, ${JSON.stringify(l2)}, ${t2})`), h2, 'replay: a ?noR1010=1 page replays the br log to the same hash');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`bridge1010 browser: eco and valves; blow at the tap (ground ${groundBefore} → ${after}); repair paid 10; timber; replay ${t2}; town rebuilt on repair (${tris1} → ${trisT}); last bridge refused; ring on the bank ${JSON.stringify(onBank)}, on the timber deck ${JSON.stringify(onDeck)}`);
    });
    console.log('bridge1010-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
