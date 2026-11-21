// R1011 指揮部升級的閥與重播在真的 Chrome（CI 是 SwiftShader）：卡面驗收 21（19、20 在 tests/hq1011-browser.mjs；分兩支，每支 CI 限 120 秒）。
//   ?noR1011=1：新開的局 eco 帶 tech＝1、不帶 hq11；分組選單沒有「指揮部」；第 600 步頁面＝Node 重播＝施工前在 main 上用同一個網址、同一串操作量好的雜湊。
//   __rts.playLog 餵一份帶 tech、不帶 hq11 的紀錄（照 tests/tech50-browser.mjs 那一份）：閥開著、關著兩種頁面都等於 Node，頁面的紀錄裡也沒有被補上 hq11。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const PINNED_VALVE_600 = '0d32219e';   // 施工時的 main c31548b：同一個網址（noR1011 對它沒有意義）、同一串操作（開局、暫停、開戰、走到第 600 步）
const LOG = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1011-valve-'));
await runOrSkip('hq1011-valve', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9714 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const groups = () => E(`[...document.querySelector('#pb-catalog').options].map(o=>o.value)`);
      const node300 = hashWorld(runLog(createWorld(1944), LOG, 300));
      const play = async () => [await E(`__rts.playLog(1944, ${JSON.stringify(LOG)}, 300)`), (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.hq11];
      // 閥開著：新開的局帶 hq11、有「指揮部」；playLog 照紀錄跑，不補旗標
      await open('noR1011=0&noR050=0&noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      assert.deepEqual([(await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.hq11, (await groups()).includes('指揮部')], [1, true], 'valve: fixture — with R1011 on a new battle sends hq11 and offers 指揮部');
      assert.deepEqual(await play(), [node300, undefined], 'valve: with R1011 on, __rts.playLog of a tech log (no hq11) equals Node and gains no hq11');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      // 閥關著
      await open('noR1011=1&noR050=0&noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco.sw, eco.tech, eco.hq11], [2, 1, undefined], 'valve: ?noR1011=1 still sends sw 2 and tech 1 but no hq11');
      const g = await groups();
      assert(g.includes('建造') && !g.includes('指揮部'), `valve: ?noR1011=1 offers 建造 but no 指揮部 group (${g.join('、')})`);
      await E('__rts.stepN(600 - __rts.tick()); 0');
      const [s, t, h, l] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]');
      assert.deepEqual([t, h, hashWorld(runLog(createWorld(s), l, t))], [600, PINNED_VALVE_600, PINNED_VALVE_600], 'valve: at step 600 the page equals the Node replay and the hash measured on main before this card');
      assert.deepEqual(await play(), [node300, undefined], 'valve: with R1011 off, __rts.playLog of the same log equals Node too');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`hq1011 valve browser: noR1011=1 sends tech without hq11, no 指揮部, step 600 = ${PINNED_VALVE_600} (main before this card); playLog = Node with the valve on and off`);
    });
    console.log('hq1011-valve-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
