// R092 驗收 24：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。單獨一支，免得 transport92-browser.mjs 超過每支 120 秒。
//   開局的繪製呼叫和三角形跟 ?noR092=1 一模一樣；海斯鎮上的混戰（R090 那一幕：先打 600 步，R089 開著）每邊多 3 台卡車、2 台半履帶車，
//   卡車各載一班（從混戰原本每邊 64 班裡拿），zoom 1 與 0.55 都 ≤ 22 次、≤ 80,000 個三角形；小兵 ≤ 32,000 個三角形、活著的小兵 ≤ 800。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r092-budget-'));
await runOrSkip('transport92-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9987 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async q => { await open(`${q}&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR092=0'), off = await opening('noR092=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the opening draws exactly what it drew without R092 (${on.calls}/${on.triangles})`);
      await open('noR092=0&noR089=0&map=hythe&seed=1944&noR100=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      for (let k = 0; k < 20; k++) { await E('__rts.stepN(30)'); await frames(); }
      const placed = await E('__r089.crowd(64, 64, 64, false, 2, 0, 0, 5)');
      assert.equal(placed, 138, `budget: 64 sections and 5 vehicles a side are on the map (${placed})`);
      const got = [];
      for (const zoom of [1, 0.55]) {
        await E(`__r089.cam(64, 64, ${zoom})`); const m = await measure(E, frames), s = m.men.sec;
        got.push(`${m.calls}/${m.triangles} men ${s.tris}/${s.live}`);
        assert(m.calls <= 22 && m.triangles <= 80000 && s.tris <= 32000 && s.live <= 800, `budget: the Hythe town fight with vehicles at zoom ${zoom} stays ≤ 22 calls, 80,000 triangles, men ≤ 32,000 and ≤ 800 live (${got.at(-1)})`);
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`transport92 budget: opening ${on.calls}/${on.triangles} (same as noR092=1); Hythe town fight + 5 vehicles a side ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
