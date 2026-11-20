// R093 驗收 31：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。單獨一支，免得 air93-browser.mjs 超過每支 120 秒。
//   一、開局的繪製呼叫和三角形跟 ?noR093=1 一模一樣。
//   二、海斯鎮上的混戰（R090、R092 那一幕：先打 600 步，R089 開著，不開火），每邊 64 班、不放車、每邊 2 門砲在鏡頭中央：
//       防空砲跟反戰車砲畫的一模一樣（防空砲借砲的網格，不多任何東西）。這一幕本身會超過預算（任何一門砲約 570 個三角形），不量絕對值。
//   三、R092 驗過的那一幕（每邊 64 班加 5 台車）再放 4 架飛機（2 架俯衝、2 架盤旋，我方兩架有目標圈）：
//       最多多 3 次繪製、300 個三角形；zoom 1 與 0.55：≤ 22 次、≤ 80,000 個三角形（含陰影那一趟）；小兵 ≤ 32,000 個三角形、活著的 ≤ 800。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r093-budget-'));
const C = c => c * 256 + 128;
// 4 架飛機（夾具直接放進 w.sky）：2 架俯衝（t 在 T 與 T＋30 之間）、2 架盤旋，都在 (64, 64) 附近
const PLANES = [
  { side: 0, kind: 1, x: C(63), z: C(63), sx: C(127), sz: C(127), tx: C(63), tz: C(63), t: 60, T: 50, hp: 100 },
  { side: 1, kind: 1, x: C(65), z: C(64), sx: C(0), sz: C(0), tx: C(65), tz: C(64), t: 70, T: 50, hp: 55 },
  { side: 0, kind: 2, x: C(62), z: C(66), sx: C(127), sz: C(127), tx: C(62), tz: C(66), t: 100, T: 50, hp: 60 },
  { side: 1, kind: 2, x: C(66), z: C(62), sx: C(0), sz: C(0), tx: C(66), tz: C(62), t: 120, T: 50, hp: 60 },
];
await runOrSkip('air93-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9993 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async q => { await open(`${q}&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR093=0'), off = await opening('noR093=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the opening draws exactly what it drew without R093 (${on.calls}/${on.triangles})`);
      // 同一幕：混戰＋每邊 2 門 kind 的砲（回傳兩種縮放各量 3 次的最大值）
      const scene = async (kind, planes, cars = 0) => {
        await open('noR093=0&noR092=0&noR089=0&map=hythe&seed=1944&noR100=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
        for (let k = 0; k < 20; k++) { await E('__rts.stepN(30)'); await frames(); }
        const placed = await E(`__r089.crowd(64, 64, 64, false, 2, 0, 0, ${cars})`), guns = kind < 0 ? [1] : await E(`[[0,61,64],[0,61,66],[1,67,64],[1,67,66]].map(([s,x,z])=>__r089.place(s,${kind},x,z))`);
        assert(placed === 128 + 2 * cars && guns.every(Boolean), `budget: fixture — 64 sections and ${cars} vehicles a side, guns ${kind} (${placed}, ${guns})`);
        if (planes) assert.equal(await E(`__r089.sky93(${JSON.stringify(PLANES)})`), 4, 'budget: fixture — four planes in the sky');
        const out = {};
        for (const zoom of [1, 0.55]) {
          await E(`__r089.cam(64, 64, ${zoom})`);
          let worst = null;
          for (let i = 0; i < 3; i++) { const m = await measure(E, frames); if (!worst || m.triangles > worst.triangles || m.calls > worst.calls) worst = m; }
          out[zoom] = worst;
        }
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
        return out;
      };
      const at = await scene(4, false), aa = await scene(46, false), base = await scene(-1, false, 5), air = await scene(-1, true, 5), got = [];
      for (const zoom of [1, 0.55]) {
        assert.deepEqual([aa[zoom].calls, aa[zoom].triangles], [at[zoom].calls, at[zoom].triangles], `budget: at zoom ${zoom} two AA guns a side draw exactly what two AT guns draw (${aa[zoom].calls}/${aa[zoom].triangles})`);
        const m = air[zoom], s = m.men.sec, dc = m.calls - base[zoom].calls, dt = m.triangles - base[zoom].triangles;
        got.push(`zoom ${zoom}: guns ${aa[zoom].calls}/${aa[zoom].triangles} (= AT guns); R092 scene ${base[zoom].calls}/${base[zoom].triangles} → planes ${m.calls}/${m.triangles} (+${dc}/+${dt}) men ${s.tris}/${s.live}`);
        assert(dc <= 3 && dt <= 300, `budget: at zoom ${zoom} four planes and their target rings add at most 3 calls and 300 triangles (${got.at(-1)})`);
        assert(m.calls <= 22 && m.triangles <= 80000 && s.tris <= 32000 && s.live <= 800, `budget: the Hythe town fight with AA guns and planes at zoom ${zoom} stays ≤ 22 calls, 80,000 triangles, men ≤ 32,000 and ≤ 800 live (${got.at(-1)})`);
      }
      console.log(`air93 budget: opening ${on.calls}/${on.triangles} (same as noR093=1); ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
