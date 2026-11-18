// R089 更大規模的步兵（真的 Chrome，手機 412×860）：每一個情況 R089 開著與 ?noR089=1 各量一次——
// 萊伊開局（≤ 20 次、80,000）、smoke 的「步兵特寫（開戰 30 秒）」那一刻、假局 A（村莊每邊 16 個班交戰）、假局 B（64 圖每邊 40 個班＋躺下 300 個人，zoom 1 與 0.55）、
// 96 圖每邊 40 個班（zoom 0.55）、喪屍壓力（萊伊、我方 40 個班）；開著的 ≤ 22 次、80,000 個三角形，繪製呼叫 ≤ 關著的；頁面沒有錯誤。
// 夾具在 tools/r089-fixture.mjs（只在這份測試的建置裡）。近拍與桌機的數字在 tests/section89-shots-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, cases } from '../tools/r089-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r089-browser-'));

await runOrSkip('section89', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture89(root)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9983 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const on = await cases(open, E, frames, true);
      assert.equal(page.errors.length, 0, `page: no page errors with R089 on (${page.errors.join(' | ').slice(0, 300)})`);
      const off = await cases(open, E, frames, false);
      assert.equal(page.errors.length, 0, `page: no page errors with ?noR089=1 (${page.errors.join(' | ').slice(0, 300)})`);
      for (const [i, [name, m]] of on.entries()) {
        const o = off[i][1], cap = name === 'rye-opening' ? 20 : 22, s = m.men.sec ?? {};
        console.log(`r089 phone ${name}: on ${m.calls}/${m.triangles} (F ${s.F}, T${s.tier}, men tris ${s.tris}, live ${s.live}, bodies ${s.bodies}, culled ${s.culled}) · off ${o.calls}/${o.triangles} (alive ${o.men.alive}, bodies ${o.men.bodies})`);
        assert(m.calls <= cap && m.triangles <= 80000, `budget: ${name} stays within ${cap} calls and 80,000 triangles on a phone with R089 on (${m.calls}/${m.triangles})`);
        assert(m.calls <= o.calls, `budget: ${name} draws no more calls with R089 on than off (${m.calls} vs ${o.calls})`);
        assert(s.tris <= 32000, `budget: ${name} keeps the men under 32,000 triangles (${s.tris})`);
      }
      const b = on.find(c => c[0] === 'B-64-40-z055')[1];
      assert(b.men.sec.live >= 400 && b.men.bodies === 300, `fixture: B really is a big crowd (${b.men.sec.live} figures on screen, ring ${b.men.bodies})`);
    });
    console.log('section89 browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
