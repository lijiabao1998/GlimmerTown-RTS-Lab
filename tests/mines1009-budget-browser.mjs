// R1009 驗收 30–31：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。
//   30 開局的繪製呼叫和三角形跟 ?noR1009=1 一模一樣（都在 ≤ 20 次、≤ 80,000 個以內）。
//   31 萊伊開戰後每邊擺 24 格布好的雷（夾具直接擺，一半被對方看到）：繪製呼叫和三角形跟同一幕沒有雷一模一樣（雷只在地面貼圖上）；
//      地面貼圖沒有整張重傳（R098：只傳改過的格列，貼圖的 version 不變），我方看得到的格真的畫上去了、看不到的沒有。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1009-budget-'));
await runOrSkip('mines1009-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 10092 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async q => { await open(`${q}&noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR1009=0'), off = await opening('noR1009=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the opening draws exactly what it drew without R1009 (${on.calls}/${on.triangles})`);
      assert(on.calls <= 20 && on.triangles <= 80000, `budget: the opening stays inside the phone budget (${on.calls}/${on.triangles})`);
      await open('noR1009=0&noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1&noR018=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');   // noR018：沒有電腦（走時間時兩邊都不出兵）
      await E('__rts.stepN(20); __rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames();
      const worst = async (cx, cz, zoom) => { await E(`__r089.cam(${cx}, ${cz}, ${zoom})`); let m = null; for (let i = 0; i < 3; i++) { const x = await measure(E, frames); if (!m || x.triangles > m.triangles || x.calls > m.calls) m = x; } return m; };
      const base = { 1: await worst(16, 16, 1), 0.55: await worst(16, 16, 0.55) };
      // 每邊 24 格：在地圖中段找空地（不是房子、不是泥、沒有單位），我方的擺在下半、敵方的擺在上半；每邊一半標成對方看到了
      const blds = await E('__rts.blds().map(b => [b.x, b.z, b.w, b.d])'), units = await E('__rts.units().filter(u => u.alive).map(u => [Math.floor(u.x / 256), Math.floor(u.z / 256)])'), used = new Set();
      for (const [x, z, w, d] of blds) for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used.add(`${x + dx},${z + dz}`);
      for (const [x, z] of units) used.add(`${x},${z}`);
      const plan = [];
      for (const s of [0, 1]) { let n = 0; for (let z = s ? 8 : 18; z < (s ? 15 : 25) && n < 24; z++) for (let x = 6; x < 26 && n < 24; x++) if (!used.has(`${x},${z}`)) { used.add(`${x},${z}`); plan.push([s, 1 + (n % 2), x, z, n < 12 ? 1 : 0]); n++; } }
      assert.equal(plan.length, 48, `budget: fixture — room for 24 cells a side (${plan.length})`);
      const v0 = (await E('__r089.px1009(0, 0)')).v;
      const before = await E(`${JSON.stringify(plan)}.map(([s, k, x, z]) => __r089.px1009(x, z).px)`);
      await E(`${JSON.stringify(plan)}.forEach(([s, k, x, z, seen]) => __r089.mine1009(s, k, x, z, seen)); 0`);
      for (let k = 0; k < 4; k++) await frames();
      const after = await E(`${JSON.stringify(plan)}.map(([s, k, x, z]) => __r089.px1009(x, z).px)`);
      const shown = plan.map((p, i) => after[i] !== before[i]), want = plan.map(([s, , , , seen]) => s === 0 || seen === 1);
      assert.deepEqual(shown, want, 'budget: our 24 cells and the 12 enemy cells we know of are on the ground; the 12 we do not know of are not');
      assert.equal((await E('__r089.px1009(0, 0)')).v, v0, 'budget: the ground texture was not re-uploaded whole (R098: only the changed rows go up)');
      const got = [];
      for (const zoom of [1, 0.55]) {
        const m = await worst(16, 16, zoom);
        got.push(`zoom ${zoom}: ${base[zoom].calls}/${base[zoom].triangles} → ${m.calls}/${m.triangles}`);
        assert.deepEqual([m.calls, m.triangles], [base[zoom].calls, base[zoom].triangles], `budget: at zoom ${zoom} 48 mines add no draw call and no triangle (${got.at(-1)})`);
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`mines1009 budget: opening ${on.calls}/${on.triangles} (same as noR1009=1); ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
