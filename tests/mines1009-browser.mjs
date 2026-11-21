// R1009 地雷與排雷在真的 Chrome（CI 是 SwiftShader）：卡面驗收 26–29。網址帶 noR1009=0、noR1002=0、noR091=0（tools/cdp.mjs 預設關掉）。
//   26 新開的局 eco 帶 mine＝1；生產列「地雷」兩顆鍵在三種手機尺寸都是完整、點得到的 44px 鍵；開打前（第 0 步）說「本局未開放」。
//   27 造一個工兵、選它、按「反戰車雷」、在畫面上點地圖：送出去的是 mine、len 3；布好之後那三格的地面貼圖跟布之前不一樣；
//      夾具擺的、我方不知道的敵方雷那一格跟沒擺時一模一樣。Esc、空中鍵取消地雷模式。
//   28 ?noR1009=1：eco 不帶 mine、沒有「地雷」組；頁面第 600 步的雜湊＝main c31548b 的隔離副本重播同一份紀錄算出來的（寫死在下面）。
//   29 第 N 步頁面＝Node 重播頁面自己的紀錄；頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, cellOf, UK_ENGINEER } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { why1009 } from '../src/sim/mines1009.ts';

// 驗收 28 的答案：main c31548b（R1004 之後）的隔離副本（git archive）裡，用頁面 ?noR1009=1 第 600 步的紀錄重播出來的雜湊（施工紀錄 6）
const MAIN_600 = '9b4fe746';   // 開打那一步＋600 步＝第 601 步；紀錄 7 筆（地圖、布陣四筆、eco、電腦）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1009-browser-'));
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
await runOrSkip('mines1009', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 10091 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      const title = id => E(`document.getElementById('${id}')?.title ?? ''`);
      const clearOfKeys = xy => E(`[...document.querySelectorAll('#hud button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return Math.max(r.left - ${xy[0]}, 0, ${xy[0]} - r.right) + Math.max(r.top - ${xy[1]}, 0, ${xy[1]} - r.bottom); }).reduce((a, b) => Math.min(a, b), 1e9)`);
      const ON = 'noR1009=0&noR050=0&noR1002=0&noR091=0&noR092=0&noR093=0&seed=1944';
      // 驗收 26：新開的局與生產列
      await open(ON); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco.sw, eco.mine], [2, 1], 'page: a new battle sends sw 2 and mine 1');
      assert.equal((await E('__r089.mines1009()')).flag, 1, 'page: the battle has mine');
      const groups = await pick('地雷'); await frames();
      assert(groups.includes('地雷'), `catalog: the group menu offers 地雷 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k1101', 'pb-k1102'], 'catalog: the group shows the two mines');
      assert.doesNotMatch(await title('pb-k1101'), /本局未開放|補給不足/, 'catalog: with supply the key is open');
      for (let i = 0; i < 8 && (await E('__rts.eco()')).supply[0] >= 10; i++) await E(`__rts.issue({ t: 'produce', side: 0, kind: __rts.eco().supply[0] >= 40 ? 0 : 2 }); __rts.stepN(1); __rts.pause(true); 0`);   // 把補給花在坦克、觀測員上（卡車在 tech 的局要先蓋車廠）
      await frames(); await pick('地雷'); await frames();
      const left = (await E('__rts.eco()')).supply[0];
      assert(left < 10, `catalog: fixture — the supply is spent (${left})`);
      assert.deepEqual([(await title('pb-k1101')).includes(`補給不足，還差 ${15 - left}`), (await title('pb-k1102')).includes(`補給不足，還差 ${10 - left}`)], [true, true], 'catalog: with the supply spent the keys say 補給不足，還差 N (why1009)');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const r = await E(`['pb-k1101','pb-k1102'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = (a, b) => a.ri <= b.l || b.ri <= a.l || a.bo <= b.t || b.bo <= a.t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart(r[0], r[1]), `catalog: at ${w}×${h} the two keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      // 驗收 27：造工兵、按反戰車雷、點地圖（同一頁重播一局：開局、造一個工兵；R050 的做法）
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, mine: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: UK_ENGINEER } }];
      const node = runLog(createWorld(1944), lg, 300), en = node.units.find(u => u.kind === UK_ENGINEER && u.side === 0 && u.alive);
      assert(en && node.eco.mine === 1, 'lay: the replayed game has mine and an engineer');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 300)`), hashWorld(node), 'lay: the page replays the game to the Node hash');
      await E('__rts.pause(true); 0');
      // 點的那一格：以它為中心、跟工兵過來的方向垂直的三格放得下（介面的規則），也離畫面上的鍵夠遠
      const ex = cellOf(en.x), ez = cellOf(en.z);
      let spot = null;
      for (let r = 3; r <= 7 && !spot; r++) for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r && !spot; dx++) {
        const cx = ex + dx, cz = ez + dz, rot = Math.abs(dx) >= Math.abs(dz) ? 1 : 0, x = rot ? cx : cx - 1, z = rot ? cz - 1 : cz;
        if (why1009(node, 0, 1, { x, z, ids: [en.id], rot, len: 3 }) === '') spot = { cx, cz, x, z, rot };
      }
      assert(spot, `lay: there is room for a band near the engineer (${ex},${ez})`);
      const cells = [0, 1, 2].map(i => (spot.rot ? [spot.x, spot.z + i] : [spot.x + i, spot.z]));
      // 夾具：敵方一格我方不知道的雷，擺在離雷帶遠一點的空地（畫面不該畫它）
      let foe = null;
      for (let z = spot.cz - 6; z <= spot.cz + 6 && !foe; z++) for (let x = spot.cx - 6; x <= spot.cx + 6 && !foe; x++) if (Math.max(Math.abs(x - spot.cx), Math.abs(z - spot.cz)) >= 4 && Math.max(Math.abs(x - ex), Math.abs(z - ez)) >= 6 && x >= 0 && z >= 0 && x < node.n && z < node.n && !node.occ[z * node.n + x]) foe = [x, z];
      assert(foe, 'lay: fixture — a free cell for the enemy mine away from the engineer');
      const beforeFoe = await E(`__r089.px1009(${foe[0]}, ${foe[1]})`);
      await E(`__r089.mine1009(1, 1, ${foe[0]}, ${foe[1]}, 0)`); await frames();
      assert.equal((await E(`__r089.px1009(${foe[0]}, ${foe[1]})`)).px, beforeFoe.px, 'lay: an enemy mine we do not know of leaves the ground exactly as it was');
      const before = [];
      for (const [x, z] of cells) before.push((await E(`__r089.px1009(${x}, ${z})`)).px);
      await pick('地雷'); await frames();
      await E(`__rts.select([${en.id}]); document.getElementById('pb-k1101').click(); __rts.focus(${spot.cx - 2}, ${spot.cz - 2}, 1); 0`); await frames(); await frames();
      assert.match(await E("document.getElementById('hint').textContent"), /布反戰車雷：先選工兵/, 'lay: armed while paused, the hint says how to lay it at once');
      assert.equal(await E("document.getElementById('pb-k1101').classList.contains('armed50')"), true, 'lay: the armed key is lit at once');
      const n0 = (await E('__rts.log()')).length, xy = await E(`__rts.screenOfCell(${spot.cx}, ${spot.cz})`), keys = await clearOfKeys(xy);
      assert(keys > 30 && xy[0] > 0 && xy[1] > 0 && xy[0] < 412 && xy[1] < 915, `lay: the tap point is on screen and clear of every HUD key (${xy}, ${keys} px)`);
      await tapNow(page, xy[0], xy[1]); await frames(); await E('__rts.stepN(1); 0');
      const sent = (await E('__rts.log()')).slice(n0).map(c => c.cmd).filter(c => c.t === 'mine');
      assert.deepEqual(sent, [{ t: 'mine', side: 0, ids: [en.id], kind: 1, x: spot.x, z: spot.z, rot: spot.rot, len: 3 }], `lay: a tap on the map sends mine with len 3 for the selected engineer (${JSON.stringify(sent)})`);
      for (let k = 0; k < 30; k++) { await E('__rts.stepN(30); __rts.pause(true); 0'); if ((await E('__r089.mines1009()')).cells.filter(m => m.side === 0).every(m => m.left === 0)) break; }
      const laid = (await E('__r089.mines1009()')).cells.filter(m => m.side === 0);
      assert(laid.length === 3 && laid.every(m => m.left === 0), `lay: the engineer laid all three cells (${JSON.stringify(laid)})`);
      await frames();
      const after = [];
      for (const [x, z] of cells) after.push((await E(`__r089.px1009(${x}, ${z})`)).px);
      assert(after.every((px, i) => px !== before[i]), 'lay: the three cells look different on the ground once laid');
      assert.equal((await E(`__r089.px1009(${foe[0]}, ${foe[1]})`)).px, beforeFoe.px, 'lay: the unknown enemy cell still looks like open ground');
      // 驗收 29：頁面＝Node 重播
      const [s2, t2, h2, l2] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert(l2.some(c => c.cmd.t === 'mine'), 'replay: fixture — the page log carries the mine order');
      // 夾具直接擺進世界的那一格不在紀錄裡：Node 重播時照樣在第 300 步擺進去
      const replay = (() => { const w = runLog(createWorld(s2), l2.filter(c => c.tick < 300), 300); w.mines = { version: 1, cells: [{ side: 1, kind: 1, x: foe[0], z: foe[1], left: 0, seen: 0 }] }; return runLog(w, l2.filter(c => c.tick >= 300), t2); })();
      assert.equal(hashWorld(replay), h2, `replay: the page at tick ${t2} equals the Node replay of its own log (plus the fixture cell)`);
      // Esc、空中鍵取消地雷模式
      await pick('地雷'); await frames();
      await E("document.getElementById('pb-k1102').click(); 0"); await frames();
      assert.match(await E("document.getElementById('hint').textContent"), /布反人員雷/, 'cancel: fixture — the 反人員雷 key arms');
      await E("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await frames(); await E('__rts.stepN(1); __rts.pause(true); 0'); await frames();
      assert.equal(await E("document.getElementById('pb-k1102').classList.contains('armed50')"), false, 'cancel: Esc disarms and unlights the key');
      // 驗收 28：閥
      await open('noR1009=1&noR050=0&noR1002=0&noR091=0&noR092=0&noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.mine, undefined, 'valve: ?noR1009=1 sends no mine');
      assert.equal((await pick('步兵支援')).includes('地雷'), false, 'valve: ?noR1009=1 offers no 地雷');
      await E('__rts.stepN(600); __rts.pause(true); 0');
      const [s3, t3, h3, l3] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.equal(hashWorld(runLog(createWorld(s3), l3, t3)), h3, 'valve: the page at tick 600 equals the Node replay of its own log');
      if (process.env.R1009_PRINT_LOG) fs.writeFileSync(process.env.R1009_PRINT_LOG, JSON.stringify({ seed: s3, tick: t3, hash: h3, log: l3 }));
      assert.equal(t3, 601, 'valve: fixture — the page is at step 601 (start plus 600)');
      assert.equal(h3, MAIN_600, `valve: with ?noR1009=1 the page at tick 600 is what main c31548b computes for the same log (${h3})`);
      await open('noR091=1&noR1002=0&noR1009=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      const eco91 = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco91.sw, eco91.mine, (await pick('步兵支援')).includes('地雷')], [undefined, undefined, false], 'valve: with ?noR091=1 (no sw 2) there is no mine and no 地雷 group');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`mines1009 browser: catalog 3 sizes, band at ${spot.x},${spot.z} rot ${spot.rot} laid by tick ${t2}, replay, valve ${h3}`);
    });
    console.log('mines1009-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
