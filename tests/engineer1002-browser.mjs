// R1002 工兵與火焰噴射器在真的 Chrome（CI 是 SwiftShader）：卡面驗收 22–26。網址帶 noR1002=0（tools/cdp.mjs 預設關掉 R1002）。
//   新開的局 eco 帶 sw＝2；生產列「步兵支援」有四項，兩顆新鍵在三種手機尺寸都是完整、點得到的 44px 鍵；點了扣補給、排進佇列；第 600 步頁面＝Node 重播；
//   選取的提示列；在畫面上點地上的鐵絲網，送出去的是工兵的射擊指令（其他的照舊移動）；閥：?noR1002=1 送 sw＝1、沒有兩項新的；頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1002-browser-'));
// 碰一下就放開（touchStart、touchEnd 一起送、帶時間戳）：機器忙時不會變成長按（R093 審查）
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
await runOrSkip('engineer1002', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9971 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      // 驗收 22：新開的局與生產列
      await open('noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.equal(eco.sw, 2, 'page: a new battle sends sw 2');
      const groups = await pick('步兵支援'); await frames();
      assert(groups.includes('步兵支援'), `catalog: the group menu offers 步兵支援 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k42', 'pb-k43', 'pb-k47', 'pb-k48'], 'catalog: the group shows the sniper, the AT team, the engineer and the flamethrower');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const r = await E(`['pb-k47','pb-k48'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = r[0].ri <= r[1].l || r[1].ri <= r[0].l || r[0].bo <= r[1].t || r[1].bo <= r[0].t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart, `catalog: at ${w}×${h} both new keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      const s0 = (await E('__rts.eco()')).supply[0];
      await E("document.getElementById('pb-k47').click(); document.getElementById('pb-k48').click(); __rts.stepN(1); 0");   // 指令下一步才進模擬
      const e1 = await E('__rts.eco()'), income = (await E('__rts.tick()')) % 20 === 0 ? 1 : 0;
      assert.deepEqual([s0 - e1.supply[0] + income, e1.queue[0].slice(-2)], [60, [47, 48]], 'catalog: a tap costs 30 and 30 supply and queues both');
      for (let k = 0; k < 20; k++) await E('__rts.stepN(30)');
      const [seed, tick, hash, log] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.equal(hashWorld(runLog(createWorld(seed), log, tick)), hash, `replay: the page at tick ${tick} equals the Node replay of its own log`);
      // 驗收 23：選取的提示列
      const us = await E('__rts.units()'), en = us.find(u => u.kind === 47 && u.side === 0 && u.alive), fl = us.find(u => u.kind === 48 && u.side === 0 && u.alive);
      assert(en && fl, 'select: both were built by tick 600');
      await E(`__rts.select([${en.id}]); 0`); await frames();
      assert((await E("document.getElementById('hint').textContent")).includes('工兵 1（點房子、碉堡＝放炸藥，點鐵絲網＝剪開）'), 'select: the hint says 工兵 1（點房子、碉堡＝放炸藥，點鐵絲網＝剪開）');
      await E(`__rts.select([${fl.id}]); 0`); await frames();
      assert((await E("document.getElementById('hint').textContent")).includes('火焰噴射器 1（燒得進房子和碉堡）'), 'select: the hint says 火焰噴射器 1（燒得進房子和碉堡）');
      await pick('通用裝備'); await frames();
      // 驗收 23：在畫面上點地上的鐵絲網＝工兵去剪、其他照舊走（同一頁重播一局帶網、工兵、步兵的紀錄）
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'build', side: 0, kind: 10, x: 22, z: 26 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
      const want = runLog(createWorld(1944), lg, 600);
      assert(want.wires?.segments.length === 1 && want.units.some(u => u.kind === 47 && u.side === 0), 'route: the replayed game has a wire section and an engineer');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 600)`), hashWorld(want), 'route: the page replays the game to the Node hash');
      await E('__rts.pause(true); 0');
      const ids = await E('__rts.units().filter(u => u.side === 0 && u.alive && (u.kind === 47 || u.kind === 3)).map(u => u.id)'), seg = want.wires.segments[0];
      await E(`__rts.select(${JSON.stringify(ids)}); __rts.focus(${seg.x + 0.5}, ${seg.z + 0.5}, 1); 0`); await frames(); await frames();
      const at = await E(`__rts.screenOfCell(${seg.x}, ${seg.z})`);
      const n0 = (await E('__rts.log()')).length;
      await tapNow(page, at[0], at[1]); await frames(); await E('__rts.stepN(1); 0');
      const sent = (await E('__rts.log()')).slice(n0).map(c => c.cmd).filter(c => c.t === 'fireAt' || c.t === 'move');
      const eng = ids.filter(id => want.units[id - 1].kind === 47), rest = ids.filter(id => want.units[id - 1].kind !== 47);
      assert.deepEqual(sent, [{ t: 'fireAt', side: 0, ids: eng, x: seg.x, z: seg.z }, ...(rest.length ? [{ t: 'move', side: 0, ids: rest, x: seg.x, z: seg.z }] : [])], `route: a tap on the wire sends the engineers to cut it and moves the rest (${JSON.stringify(sent)})`);
      // 驗收 24：閥
      await open('noR1002=1&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.sw, 1, 'valve: ?noR1002=1 sends sw 1');
      await pick('步兵支援'); await frames();
      assert.deepEqual(await visible(), ['pb-k42', 'pb-k43'], 'valve: ?noR1002=1 offers only the sniper and the AT team');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`engineer1002 browser: catalog 3 sizes, replay ${tick}, hints, wire tap ${JSON.stringify(sent).slice(0, 120)}, valve`);
    });
    console.log('engineer1002-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
