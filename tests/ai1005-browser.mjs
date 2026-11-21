// R1005 電腦第四版在真的 Chrome：新開的局送 ai v＝4；?noR1005=1 送 v＝3；閥關著時，帶 v＝4 的紀錄照樣重播成 Node 的雜湊。卡面驗收 10。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { ECO1005 } from '../tools/r1005-duel.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1005-browser-'));
await runOrSkip('ai1005', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 12640 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); });
      const aiCmd = async q => { await open(q); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); return (await E('__rts.log()')).find(c => c.cmd.t === 'ai')?.cmd; };
      const on = await aiCmd('noR1005=0&noR1002=0&noR050=0&seed=1944');
      assert.deepEqual([on?.t, on?.v], ['ai', 4], `page: a new battle hands the enemy to the fourth version (${JSON.stringify(on)})`);
      const off = await aiCmd('noR1005=1&noR1002=0&noR050=0&seed=1944');
      assert.deepEqual([off?.t, off?.v], ['ai', 3], `valve: ?noR1005=1 hands it to the third version (${JSON.stringify(off)})`);
      const dflt = await aiCmd('seed=1944');
      assert.equal(dflt?.v, 3, 'valve: tools/cdp.mjs opens pages with noR1005=1 unless a guard asks for R1005');
      // 閥關著時重播一份帶 v＝4 的紀錄（鄉間 64、sw＝2、tech＝1）：跟 Node 同一個雜湊
      const lg = [{ tick: 0, cmd: { t: 'map', id: 2, vegetation: 1, sym: 1 } }, { tick: 0, cmd: ECO1005 }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3, v: 4 } }, { tick: 0, cmd: { t: 'ai', side: 0, level: 3, v: 3 } }];
      const node = runLog(createWorld(1944), lg, 1500);
      assert(node.blds.some(b => b.builtBy === 1 && b.kind === 14), 'replay: fixture — by step 1,500 the fourth version has put up a barracks in Node');
      await open('noR1005=1&seed=1944');
      assert.equal(await E(`__rts.pause(true); __rts.playLog(1944, ${JSON.stringify(lg)}, 1500)`), hashWorld(node), 'replay: with ?noR1005=1 a log with v 4 replays to the Node hash');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`ai1005 browser: new battle v ${on.v}, valve v ${off.v}, replay ${hashWorld(node)}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
