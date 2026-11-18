// R091 狙擊手與反戰車小組在真的 Chrome（CI 是 SwiftShader）：卡面驗收 30–34。網址帶 noR091=0（tools/cdp.mjs 預設關掉 R091）。
//   新開的局 eco 帶 sw；生產列分組選單有「步兵支援」，兩顆鍵在四種手機尺寸都是完整、點得到的 44px 鍵；點了扣補給、排進佇列；第 600 步頁面＝Node 重播；
//   選取的提示列、「開火」鍵送停火指令；畫面上人數＝活著的人數、停著的狙擊手趴著（R089 開、關）、多兩組不多繪製呼叫；海斯鎮上混戰每邊多 4 組仍在預算內；
//   閥：?noR091=1 不送 sw、沒有那一組；同一頁重播帶 sw 與兩種兵的紀錄，雜湊跟 Node 一樣（連線時閥關著的客人照樣看得到、照樣同步）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r091-browser-'));
await runOrSkip('support91', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9983 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      // 驗收 30：新開的局與生產列
      await open('noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.equal(eco.sw, 1, 'page: a new battle sends sw 1');
      const groups = await pick('步兵支援'); await frames();
      assert(groups.includes('步兵支援'), `catalog: the group menu offers 步兵支援 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k42', 'pb-k43'], 'catalog: the group shows the sniper and the AT team');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780], [860, 412]]) {
        await size(w, h);
        const r = await E(`['pb-k42','pb-k43'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = r[0].ri <= r[1].l || r[1].ri <= r[0].l || r[0].bo <= r[1].t || r[1].bo <= r[0].t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart, `catalog: at ${w}×${h} both keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      await pick('通用裝備'); await frames();
      const general = (await visible()).length;
      assert.equal(general, 12, `catalog: the 通用裝備 row keeps its 12 keys (noR095=1, the cdp default) (${general})`);
      const s0 = (await E('__rts.eco()')).supply[0];
      await pick('步兵支援'); await frames();
      await E("document.getElementById('pb-k42').click(); document.getElementById('pb-k43').click(); __rts.stepN(1); 0");   // 指令下一步才進模擬
      const e1 = await E('__rts.eco()'), income = (await E('__rts.tick()')) % 20 === 0 ? 1 : 0;
      assert.deepEqual([s0 - e1.supply[0] + income, e1.queue[0].slice(-2)], [55, [42, 43]], 'catalog: a tap costs 30 and 25 supply and queues both');
      for (let k = 0; k < 20; k++) await E('__rts.stepN(30)');
      const [seed, tick, hash, log] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.equal(hashWorld(runLog(createWorld(seed), log, tick)), hash, `replay: the page at tick ${tick} equals the Node replay of its own log`);
      // 驗收 31：選取的提示列、停火鍵
      const us = await E('__rts.units()'), sn = us.find(u => u.kind === 42 && u.side === 0 && u.alive), at = us.find(u => u.kind === 43 && u.side === 0 && u.alive);
      assert(sn && at, 'select: both were built by tick 600');
      await E(`__rts.select([${sn.id}]); 0`); await frames();
      assert((await E("document.getElementById('hint').textContent")).includes('狙擊手 1（點房子進駐）'), 'select: the hint says 狙擊手 1（點房子進駐）');
      await E(`__rts.select([${at.id}]); 0`); await frames();
      assert((await E("document.getElementById('hint').textContent")).includes('反戰車小組 1'), 'select: the hint says 反戰車小組 1');
      assert.equal(await E("(()=>{const b=document.getElementById('b-discipline');return !!b&&!b.hidden&&!b.disabled})()"), true, 'select: the 開火 key is there for the AT team');
      await E("__rts.pause(false); document.getElementById('b-discipline').click(); 0"); await frames(); await E('__rts.pause(true); __rts.stepN(1); 0');
      const fd = (await E('__rts.log()')).filter(c => c.cmd.t === 'fireDiscipline').at(-1);
      assert(fd && fd.cmd.hold === true && fd.cmd.ids.includes(at.id), 'select: the 開火 key sends a hold-fire command for the AT team');
      await pick('通用裝備'); await frames();
      // 驗收 32：畫面（R089 關著＝cdp 的預設，開著＝noR089=0）
      for (const r089 of [false, true]) {
        await open(`noR091=0&seed=1944${r089 ? '&noR089=0' : ''}`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');   // 先開戰：布陣時畫面是預覽的世界
        await E('__r089.crowd(0, 16, 16, false, 1); __r089.cam(7, 18, 1)');   // 夾具從 x＝cx−10 開始擺 await frames();
        const base = await measure(E, frames);
        await E('__r089.crowd(0, 16, 16, false, 1, 0, 2); __r089.cam(7, 18, 1)'); await frames();
        const m = await measure(E, frames);
        assert.equal(m.calls, base.calls, `draw (${r089 ? 'R089' : 'R021'}): two more teams cost no extra draw call`);
        assert.equal(m.men.alive - base.men.alive, 4, `draw (${r089 ? 'R089' : 'R021'}): two men each, all drawn (${m.men.alive - base.men.alive})`);
        assert(m.men.prone - base.men.prone >= 2, `draw (${r089 ? 'R089' : 'R021'}): the halted sniper lies prone (${m.men.prone - base.men.prone})`);
        const sid = (await E('__rts.units()')).filter(u => u.kind === 42 && u.side === 0).at(-1).id;
        await E(`__r089.hp(${sid}, 10)`); const half = await measure(E, frames);
        assert.equal(m.men.alive - half.men.alive, 1, `draw (${r089 ? 'R089' : 'R021'}): a sniper at half strength shows one man`);
      }
      // 驗收 33：海斯鎮上的混戰，每邊多 4 組
      await open('noR091=0&noR089=0&map=hythe&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      const placed = await E('__r089.crowd(64, 64, 64, false, 2, 0, 4)');
      assert.equal(placed, 136, `budget: 64 sections and 4 teams a side are on the map (${placed})`);
      const hy = [];
      for (const zoom of [1, 0.55]) {
        await E(`__r089.cam(64, 64, ${zoom})`); const m = await measure(E, frames), s = m.men.sec; hy.push(`${m.calls}/${m.triangles} men ${s.tris}/${s.live}`);
        assert(m.calls <= 22 && m.triangles <= 80000 && s.tris <= 32000 && s.live <= 800, `budget: the Hythe town fight with teams at zoom ${zoom} stays ≤ 22 calls, 80,000 triangles, men ≤ 32,000 and ≤ 800 live (${m.calls} / ${m.triangles} / ${s.tris} / ${s.live})`);
      }
      // 驗收 34：閥
      await open('noR091=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.sw, undefined, 'valve: ?noR091=1 sends no sw');
      assert.equal((await pick('通用裝備')).includes('步兵支援'), false, 'valve: ?noR091=1 offers no 步兵支援');
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 42 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 43 } }];
      const want = runLog(createWorld(1944), lg, 900);
      assert(want.units.some(u => u.kind === 42) && want.units.some(u => u.kind === 43), 'valve: the replayed game has both kinds');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 900)`), hashWorld(want), 'valve: with the valve off the page replays a game with sw and both kinds to the Node hash');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`support91 browser: catalog 4 sizes, general row ${general} keys, replay ${tick}, draw R021/R089, Hythe town fight + 4 teams a side ${hy.join(' · ')}, valve`);
    });
    console.log('support91-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
