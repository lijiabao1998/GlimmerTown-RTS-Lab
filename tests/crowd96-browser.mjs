// R096 先把大仗撐住（真的 Chrome，手機 412×860）：64 圖每邊 64 班（夾具放的，比今天的人口上限多；R089 開著），zoom 1 與 0.55——
// R096 開著：繪製呼叫 ≤ 22、三角形 ≤ 80,000、小兵 ≤ 32,000、活著的小兵 ≤ 800；?noR096=1 的數字只記（R089 自己畫全部）。頁面沒有錯誤。
// 夾具在 tools/r089-fixture.mjs（只在這份測試的建置裡）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r096-browser-'));

await runOrSkip('crowd96', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture89(root)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9986 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const got = {};
      for (const on of [true, false]) {
        await open(`map=64&seed=1944&noR100=1&noR089=0&noR096=${on ? 0 : 1}`); await E('__rts.startBattle(); __rts.pause(true); 0');
        const n = await E('__r089.crowd(64, 32, 32, false)');
        for (const zoom of [1, 0.55]) { await E(`__r089.cam(32, 32, ${zoom})`); await frames(); got[`${on}/${zoom}`] = await measure(E, frames); }
        assert.equal(n, 128, `fixture: 64 sections a side are on the map (${n})`);
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      }
      for (const zoom of [1, 0.55]) {
        const m = got[`true/${zoom}`], o = got[`false/${zoom}`], s = m.men.sec, so = o.men.sec;
        console.log(`r096 phone 64 map, 64 sections a side, zoom ${zoom}: on ${m.calls}/${m.triangles} (want ${s.want}, live ${s.live}, ratio ${s.ratio?.toFixed?.(3)}, men tris ${s.tris}) · off ${o.calls}/${o.triangles} (live ${so.live}, men tris ${so.tris})`);
        assert(m.calls <= 22 && m.triangles <= 80000 && s.tris <= 32000 && s.live <= 800, `budget: with R096 the crowd stays within 22 calls, 80,000 triangles and 32,000 men triangles at zoom ${zoom} (${m.calls}/${m.triangles}, men ${s.tris}, live ${s.live})`);
      }
      assert(got['false/0.55'].men.sec.live > 800, `fixture: without R096 the crowd really is above 800 figures (${got['false/0.55'].men.sec.live})`);
    });
    console.log('crowd96 browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
