// R1002 驗收 27–28：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。單獨一支，免得 engineer1002-browser.mjs 超過每支 120 秒。
//   一、開局的繪製呼叫和三角形跟 ?noR1002=1 一模一樣。
//   二、海斯鎮上的混戰（R091 量的那一幕：先打 600 步，R089 開著，不開火；每邊 64 班＋4 組狙擊手、反戰車小組），每邊再多 4 組（2 組工兵、2 組火焰噴射器）：
//       繪製呼叫不多、≤ 22 次；小兵 ≤ 32,000 個三角形、活著的 ≤ 800（R096 的上限：人多時每班少畫幾個，所以加了人小兵反而可能變少）。
//       施工時量到：zoom 0.55 這一幕本來就 78,968 個三角形，其中小兵以外約 50,700；R096 准小兵畫到 32,000，所以只要再多一些人就會超過 R091 寫的 80,000
//       （多 24 個小兵＝82,568）。這是 R096 的上限跟 80,000 的總數本來就對不上，不是這張多畫了什麼；寫在卡面「沒做成的事」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1002-budget-'));
await runOrSkip('engineer1002-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9972 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async q => { await open(`${q}&noR091=0&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR1002=0'), off = await opening('noR1002=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the opening draws exactly what it drew without R1002 (${on.calls}/${on.triangles})`);
      await open('noR1002=0&noR091=0&noR089=0&map=hythe&seed=1944&noR100=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      for (let k = 0; k < 20; k++) { await E('__rts.stepN(30)'); await frames(); }   // R090、R091 那一幕：先打 600 步再擺混戰
      const placed = await E('__r089.crowd(64, 64, 64, false, 2, 0, 4)');
      assert.equal(placed, 136, `budget: fixture — 64 sections and 4 teams a side (${placed})`);
      const worst = async zoom => { await E(`__r089.cam(64, 64, ${zoom})`); let m = null; for (let i = 0; i < 3; i++) { const x = await measure(E, frames); if (!m || x.triangles > m.triangles || x.calls > m.calls) m = x; } return m; };
      const base = { 1: await worst(1), 0.55: await worst(0.55) };
      const ours = await E('[[0,60,70,47],[0,62,70,47],[0,64,70,48],[0,66,70,48],[1,60,58,47],[1,62,58,47],[1,64,58,48],[1,66,58,48]].map(([s,x,z,k])=>__r089.place(s,k,x,z))');
      assert(ours.every(Boolean), `budget: fixture — 2 engineers and 2 flamethrowers a side (${ours})`);
      const got = [];
      for (const zoom of [1, 0.55]) {
        const m = await worst(zoom), s = m.men.sec;
        got.push(`zoom ${zoom}: ${base[zoom].calls}/${base[zoom].triangles} men ${base[zoom].men.sec.tris}/${base[zoom].men.sec.live} → ${m.calls}/${m.triangles} men ${s.tris}/${s.live}`);
        assert(m.calls <= base[zoom].calls && m.calls <= 22, `budget: at zoom ${zoom} the 8 new teams add no draw call (${got.at(-1)})`);
        assert(s.tris <= 32000 && s.live <= 800, `budget: the Hythe town fight with the new teams at zoom ${zoom} keeps men ≤ 32,000 triangles and ≤ 800 live (${got.at(-1)})`);
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`engineer1002 budget: opening ${on.calls}/${on.triangles} (same as noR1002=1); ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
