// R050 建造與科技在真的 Chrome（CI 是 SwiftShader）：卡面驗收 18–21。網址帶 noR050=0、noR1002=0（tools/cdp.mjs 預設關掉兩張）。
//   新開的局 eco 帶 sw＝2、tech＝1；生產列「建造」三顆鍵在三種手機尺寸都是完整、點得到的 44px 鍵；狙擊手鍵一開始說「要先蓋兵營」；
//   造一個工兵、選它、按「兵營」、在畫面上點地圖：送出去的是 construct；蓋好之後狙擊手鍵不再說「要先蓋兵營」；第 N 步頁面＝Node 重播；
//   閥：?noR050=1 不送 tech、沒有「建造」；頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, BK_BARRACKS, BK_SUPPLY } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { why50 } from '../src/sim/tech50.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r050-browser-'));
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
await runOrSkip('tech50', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9973 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      const title = id => E(`document.getElementById('${id}')?.title ?? ''`);
      // 驗收 18：新開的局與生產列
      await open('noR050=0&noR1002=0&noR091=0&noR092=0&noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco.sw, eco.tech], [2, 1], 'page: a new battle sends sw 2 and tech 1');
      const groups = await pick('建造'); await frames();
      assert(groups.includes('建造'), `catalog: the group menu offers 建造 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k1014', 'pb-k1015', 'pb-k1016'], 'catalog: the group shows the barracks, the depot and the supply depot');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const r = await E(`['pb-k1014','pb-k1015','pb-k1016'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = (a, b) => a.ri <= b.l || b.ri <= a.l || a.bo <= b.t || b.bo <= a.t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart(r[0], r[1]) && apart(r[1], r[2]) && apart(r[0], r[2]), `catalog: at ${w}×${h} the three keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      await pick('步兵支援'); await frames();
      assert.match(await title('pb-k42'), /要先蓋兵營/, 'catalog: the sniper key says 要先蓋兵營');
      // 驗收 19：造工兵、按兵營、點地圖（同一頁重播一局：開局、造一個工兵；R1002 點鐵絲網那一段也是這樣做的）
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
      const node = runLog(createWorld(1944), lg, 300), en = node.units.find(u => u.kind === 47 && u.side === 0 && u.alive), hq = node.blds[node.eco.hq[0] - 1];
      assert(en && node.eco.tech === 1, 'build: the replayed game has tech and an engineer');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 300)`), hashWorld(node), 'build: the page replays the game to the Node hash');
      await E('__rts.pause(true); 0');
      let spot = null;
      for (let r = 2; r <= 8 && !spot; r++) for (let z = hq.z - r; z <= hq.z + r && !spot; z++) for (let x = hq.x - r; x <= hq.x + r && !spot; x++) if (why50(node, 0, BK_BARRACKS, { x, z, ids: [en.id] }) === '') spot = [x, z];
      assert(spot, `build: there is a free spot near the HQ (supply ${node.eco.supply[0]})`);
      await pick('建造'); await frames();
      await E(`__rts.select([${en.id}]); document.getElementById('pb-k1014').click(); __rts.focus(${spot[0] - 2}, ${spot[1] - 2}, 1); 0`); await frames(); await frames();   // 讓工地落在畫面右下：直式版面的空中鍵在中間偏左，靠太近的點擊會被 Chrome 吸到按鈕上（施工紀錄）
      // R1004：不再靠 __rts.select 刷新提示列——暫停中按下建造鍵，鍵馬上亮、提示列馬上換
      assert.match(await E("document.getElementById('hint').textContent"), /建造兵營：先選工兵/, 'build: armed while paused, the hint says how to place it at once');
      assert.equal(await E("document.getElementById('pb-k1014').classList.contains('armed50')"), true, 'build: the armed key is lit at once');
      assert.match(await title('pb-k1014'), /兵營/, 'build: the barracks key carries its own title (block50 wiring)');
      // R1004：點放不下的地方（指揮部那一格），理由馬上出來，還是選好的
      { const bad = await E(`__rts.screenOfCell(${hq.x}, ${hq.z})`), clear = await E(`[...document.querySelectorAll('#hud button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return Math.max(r.left - ${bad[0]}, 0, ${bad[0]} - r.right) + Math.max(r.top - ${bad[1]}, 0, ${bad[1]} - r.bottom); }).reduce((a, b) => Math.min(a, b), 1e9)`);
        assert(clear > 30 && bad[0] > 0 && bad[1] > 0 && bad[0] < 412 && bad[1] < 915, `build: fixture — the HQ cell is on screen and clear of keys (${bad}, ${clear}px)`);
        const n1 = (await E('__rts.log()')).length;
        await tapNow(page, bad[0], bad[1]); await frames();
        assert.match(await E("document.getElementById('hint').textContent"), /放不下：/, 'build: a tap where it cannot go shows the reason at once, while paused');
        assert.equal((await E('__rts.log()')).length, n1, 'build: and sends nothing');
        assert.deepEqual(await E('__r089.armed()'), [0, BK_BARRACKS], 'build: still armed for the barracks'); }
      const n0 = (await E('__rts.log()')).length, xy = await E(`__rts.screenOfCell(${spot[0]}, ${spot[1]})`);
      const keys = await E(`[...document.querySelectorAll('#hud button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return Math.max(r.left - ${xy[0]}, 0, ${xy[0]} - r.right) + Math.max(r.top - ${xy[1]}, 0, ${xy[1]} - r.bottom); }).reduce((a, b) => Math.min(a, b), 1e9)`);
      assert(keys > 30, `build: the tap point is clear of every HUD key (${keys} px)`);
      await tapNow(page, xy[0], xy[1]); await frames(); await E('__rts.stepN(1); 0');
      const sent = (await E('__rts.log()')).slice(n0).map(c => c.cmd).filter(c => c.t === 'construct');
      assert.deepEqual(sent, [{ t: 'construct', side: 0, ids: [en.id], kind: 14, x: spot[0], z: spot[1] }], `build: a tap on the map sends construct for the selected engineer (${JSON.stringify(sent)})`);
      for (let k = 0; k < 25; k++) await E('__rts.stepN(30)');
      const b = (await E('__rts.blds()')).find(x => x.kind === 14);
      assert(b && b.hp === 500, `build: the barracks stands finished (${JSON.stringify(b)})`);
      await pick('步兵支援'); await frames();
      assert.doesNotMatch(await title('pb-k42'), /要先蓋兵營/, 'build: with the barracks up, the sniper key no longer says 要先蓋兵營');
      const [s2, t2, h2, l2] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.equal(hashWorld(runLog(createWorld(s2), l2, t2)), h2, `replay: the page at tick ${t2} equals the Node replay of its own log`);
      // R1004：Esc、空中鍵、新開一局都取消建造模式
      await pick('建造'); await frames();
      await E("document.getElementById('pb-k1016').click(); 0"); await frames();
      assert.deepEqual(await E('__r089.armed()'), [0, BK_SUPPLY], 'cancel: fixture — the supply depot key arms build mode');
      await E("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await frames();
      assert.deepEqual([await E('__r089.armed()'), await E("document.getElementById('pb-k1016').classList.contains('armed50')")], [[0, 0], false], 'cancel: Esc disarms build mode and unlights the key');
      await E("document.getElementById('pb-k1016').click(); 0"); await frames();
      await E("document.getElementById('b-air').click(); 0"); await frames();
      const both = await E('__r089.armed()');
      assert(both[0] > 0 && both[1] === 0, `cancel: arming the air key cancels build mode (${JSON.stringify(both)})`);
      await E("document.getElementById('b-air').click(); document.getElementById('b-air').click(); 0"); await frames();
      await E("document.getElementById('pb-k1016').click(); 0"); await frames();
      assert.deepEqual(await E('__r089.armed()'), [0, BK_SUPPLY], 'cancel: armed again for the next check');
      await E("document.getElementById('b-restart').click(); 0"); await frames();
      await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames(); await frames();
      assert.deepEqual([(await E('__r089.armed()'))[1], await E("document.getElementById('pb-k1016')?.classList.contains('armed50') ?? false")], [0, false], 'cancel: a new game comes up with build mode off');
      // 驗收 20：閥
      await open('noR050=1&noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.tech, undefined, 'valve: ?noR050=1 sends no tech');
      assert.equal((await pick('步兵支援')).includes('建造'), false, 'valve: ?noR050=1 offers no 建造');
      assert.doesNotMatch(await title('pb-k42'), /要先蓋兵營/, 'valve: without tech the sniper is not locked');
      await open('noR091=1&noR1002=0&noR050=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');   // R1004：R091 的閥關著時 R1002 不再偷偷送 sw＝2
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.sw, undefined, 'valve: ?noR091=1 sends no sw at all');
      assert.deepEqual((({ sw, tech }) => [sw, tech])(await E('__rts.eco()')), [undefined, undefined], 'valve: so the battle has neither sw nor tech (the eco command still carries tech 1; without sw 2 the sim does not take it)');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`tech50 browser: catalog 3 sizes, locked sniper, construct at ${spot} → barracks at tick ${t2}, replay, valve`);
    });
    console.log('tech50-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
