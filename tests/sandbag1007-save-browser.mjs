// R1007 沙包在真的 Chrome（CI 是 SwiftShader）：卡面驗收 24–26（存檔與閥；21–23 在 sandbag1007-browser.mjs）。
//   一份帶 bag 的紀錄（Node 先算好：一處堆好、一處還在蓋）在有開始選單的頁面重播到第 M 步，離開頁面時存，重開按「繼續上一局」：
//   雜湊跟 Node 一樣、沙包回來、再跑 200 步也一樣；?noR1007=1：新開的局 eco 沒有 bag（sw＝2、tech＝1 照舊）、「建造」三項，
//   同一份帶 bag 的紀錄重播照樣有沙包、城鎮網格照樣畫進去；頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, BK_SANDBAG } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { why1007 } from '../src/sim/sandbag1007.ts';
import { Geo } from '../src/render/geo.ts';
import { bag1007Geo } from '../src/render/sandbag1007.ts';
import { SAVE_KEY } from '../src/ui/saveGame.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1007-save-browser-'));
const VALVES = 'noR050=0&noR1002=0&noR091=0&noR092=0&noR093=0&seed=1944';
const node = (seed, log, ticks) => runLog(createWorld(seed), log, ticks);
// 紀錄：萊伊、帶 bag 的 eco、造一個工兵、走到河邊；第 560 步堆一處、第 800 步再堆一處；第 840 步一處堆好、一處還在蓋
const lg0 = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, bag: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
const en = node(1944, lg0, 300).units.find(u => u.kind === 47 && u.side === 0 && u.alive);
assert(en, 'fixture: an engineer by step 300');
const lg1 = [...lg0, { tick: 300, cmd: { t: 'move', side: 0, ids: [en.id], x: 26, z: 19 } }];
const spots = (w, n) => { const u = w.units[en.id - 1], ux = Math.floor(u.x / 256), uz = Math.floor(u.z / 256), out = []; for (let r = 1; r <= 3; r++) for (let z = uz - r; z <= uz + r; z++) for (let x = ux - r; x <= ux + r; x++) if (out.length < n && Math.max(Math.abs(x - ux), Math.abs(z - uz)) === r && why1007(w, 0, BK_SANDBAG, { x, z, ids: [en.id] }) === '') out.push([x, z]); return out; };
const [a] = spots(node(1944, lg1, 560), 1), C = (x, z) => ({ t: 'construct', side: 0, ids: [en.id], kind: BK_SANDBAG, x, z });
const lg2 = [...lg1, { tick: 560, cmd: C(...a) }];
const [b] = spots(node(1944, lg2, 800), 1);
const LOG = [...lg2, { tick: 800, cmd: C(...b) }], M = 840, NM = node(1944, LOG, M);
assert(NM.bags?.segments.length === 2 && NM.bags.segments[0].left === 0 && NM.bags.segments[1].left > 0, `fixture: at step ${M} one sandbag stands finished and one is a site (${JSON.stringify(NM.bags)})`);
const HM = hashWorld(NM), WANT = bag1007Geo(new Geo(), NM).pos.length / 9;

await runOrSkip('sandbag1007-save', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9977 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      // 驗收 24：存檔（要有開始選單才存：R074）
      await open(`noR1007=0&${VALVES}`, { menu: true });
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(LOG)}, ${M})`), HM, `save: the page replays the log to the Node hash at step ${M}`);
      await E("__rts.pause(true); dispatchEvent(new Event('pagehide')); 0");
      assert(await E(`!!localStorage.getItem(${JSON.stringify(SAVE_KEY)})`), 'save: leaving the page stores the battle');
      await open(`noR1007=0&${VALVES}`, { menu: true, keep: true }); await frames();
      assert(await E("!!document.getElementById('sm-continue')"), 'save: the menu offers 繼續上一局');
      await E("document.getElementById('sm-continue').click(); 0"); await frames();
      assert.deepEqual(await E('[__rts.tick(), __rts.hash()]'), [M, HM], 'save: 繼續上一局 returns to the same step with the same hash');
      assert.deepEqual((await E('__r089.bags()'))?.segments, JSON.parse(JSON.stringify(NM.bags.segments)), 'save: the sandbags come back (one finished, one site)');
      await E('__rts.stepN(200); 0');
      const [t, h, lg] = await E('[__rts.tick(), __rts.hash(), __rts.log()]');
      assert.deepEqual([t, h], [M + 200, hashWorld(node(1944, lg, M + 200))], 'save: 200 steps later it equals the Node replay of the same log');
      assert.equal(hashWorld(node(1944, lg, M + 200)), hashWorld(node(1944, LOG, M + 200)), 'save: the resumed log is the original one');
      // 驗收 25：閥
      await open(`noR1007=1&${VALVES}`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      const off = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([off.sw, off.tech, off.bag], [2, 1, undefined], 'valve: ?noR1007=1 sends no bag (sw 2 and tech 1 as before)');
      await pick('建造'); await frames();
      assert.deepEqual(await visible(), ['pb-k1014', 'pb-k1015', 'pb-k1016'], 'valve: ?noR1007=1 offers the three R050 keys only');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(LOG)}, ${M})`), HM, 'valve: a log with bag replays to the same hash with the valve off');
      await E('__rts.pause(true); 0'); await frames();
      const on = await E('__r089.bagsOn()'), offTris = await E('__r089.bagsOff()'); await E('__r089.bagsOn()'); await frames();
      assert.deepEqual([(await E('__r089.bags()'))?.segments.length, on - offTris, await E('__rts.hash()')], [2, WANT, HM], `valve: and its two sandbags are there and drawn into the town mesh (+${on - offTris} triangles, ${WANT} expected)`);
      // 驗收 26
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`sandbag1007 save browser: saved at ${M}, resumed and 200 more steps equal Node; valve off: no bag sent, 3 keys, the bag log still draws +${WANT} triangles`);
    });
    console.log('sandbag1007-save-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
