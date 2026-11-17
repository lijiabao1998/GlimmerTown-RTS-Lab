// R089 更大規模的步兵（真的 Chrome）：
// 1. 近拍：行進、停下、趴下、屋頂（萊伊與 64 圖、手機 412×860 與桌機 1440×900、R089 開與 ?noR089=1）→ shots/r089-<狀態>-<地圖>-<裝置>-<on|off>.png；每張 ≤ 22 次、80,000 個三角形。
// 2. 桌機 1440×900 的數字：跟 tests/section89-browser.mjs 同一組情況，開與關各量一次（只記，不設門檻：預算是手機的）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, cases, measure } from '../tools/r089-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r089-shots-')), shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const desk = !process.argv.includes('--no-desk');

await runOrSkip('section89-shots', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture89(root)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 1440, height: 900, port: 9984 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (wd, ht) => { await page.send('Emulation.setDeviceMetricsOverride', { width: wd, height: ht, deviceScaleFactor: 1, mobile: wd < 600 }); await frames(); };
      for (const [device, wd, ht, zoom] of [['desktop', 1440, 900, 3.2], ['phone', 412, 860, 2.6]]) {
        await size(wd, ht);
        for (const [map, q] of [['rye', ''], ['m64', 'map=64&']]) for (const on of [true, false]) {
          await open(`${q}seed=1944&noR100=1&noR089=${on ? 0 : 1}`); await E('__rts.startBattle(); __rts.pause(true); 0');
          const at = await E('__r089.states()'); await frames();
          for (const state of ['move', 'halt', 'prone', 'roof']) {
            await E(`__r089.cam(${at[state][0]}, ${at[state][1]}, ${zoom})`);
            const m = await measure(E, frames);
            await shot(page, path.join(shots, `r089-${state}-${map}-${device}-${on ? 'on' : 'off'}.png`));
            assert(m.calls <= 22 && m.triangles <= 80000, `close-up: ${state} on ${map} (${device}, R089 ${on}) within 22 calls and 80,000 triangles (${m.calls}/${m.triangles})`);
            if (on && state === 'prone') assert(m.men.prone >= 10, `close-up: the prone section lies down (${map}, ${device}: ${m.men.prone})`);
          }
          assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
        }
      }
      if (desk) {
        await size(1440, 900);
        const on = await cases(open, E, frames, true), off = await cases(open, E, frames, false);
        for (const [i, [name, m]] of on.entries()) { const o = off[i][1], s = m.men.sec ?? {}; console.log(`r089 desktop ${name}: on ${m.calls}/${m.triangles} (F ${s.F}, T${s.tier}, men tris ${s.tris}) · off ${o.calls}/${o.triangles}`); }
        assert.equal(page.errors.length, 0, `page: no page errors on desktop (${page.errors.join(' | ').slice(0, 300)})`);
      }
    });
    console.log('section89 shots: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
