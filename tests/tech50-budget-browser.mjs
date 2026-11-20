// R050 驗收 22：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。
//   一、開局的繪製呼叫和三角形跟 ?noR050=1 一模一樣。
//   二、萊伊開戰後，每邊擺兵營、車廠、補給站各一座（夾具直接擺，蓋好的樣子）、我方再一座工地：繪製呼叫不多（建築都在城鎮那一個網格裡）；
//       三角形最多多 6,000（兩邊七棟合計；zoom 1 與 0.55 各量三次取最大）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r050-budget-'));
await runOrSkip('tech50-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9974 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async q => { await open(`${q}&noR1002=0&noR091=0&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR050=0'), off = await opening('noR050=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the opening draws exactly what it drew without R050 (${on.calls}/${on.triangles})`);
      await open('noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1&noR018=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');   // R1004：noR018＝沒有電腦（走時間時兩邊都不出兵、不動）
      // R1004：暫停中畫面時間不走，剛放的建築一直在「升起來」的動畫網格裡（R016），量不到城鎮網格；先走 1 秒讓它們併回城鎮
      const settle = async () => { await E('__rts.stepN(20); __rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames(); const r = await E('__rts.rising().rising'); assert.equal(r, 0, `budget: fixture — no building is still rising when measured (${r})`); };
      await settle();
      const hq = await E('__rts.blds().filter(b => b.kind === 5).map(b => [b.x, b.z])');
      const worst = async (cx, cz, zoom) => { await E(`__r089.cam(${cx}, ${cz}, ${zoom})`); let m = null; for (let i = 0; i < 3; i++) { const x = await measure(E, frames); if (!m || x.triangles > m.triangles || x.calls > m.calls) m = x; } return m; };
      const cx = 16, cz = 16, base = { 1: await worst(cx, cz, 1), 0.55: await worst(cx, cz, 0.55) };
      // 兩邊各三座＋我方一座工地：在指揮部 8 格內找空的 2×2（四周留一格；夾具自己不檢查，只量畫面）
      const blds = await E('__rts.blds().map(b => [b.x, b.z, b.w, b.d, b.kind, b.builtBy ?? -1])'), used = new Set();
      for (const [x, z, w, d] of blds) for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used.add(`${x + dx},${z + dz}`);
      const free = (x, z) => { for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) if (used.has(`${x + dx},${z + dz}`)) return false; return x >= 1 && z >= 1 && x <= 29 && z <= 29; };
      const take = (x, z) => { for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) used.add(`${x + dx},${z + dz}`); return [x, z]; };
      const near = ([hx, hz]) => { for (let r = 3; r <= 8; r++) for (let z = hz - r; z <= hz + r; z++) for (let x = hx - r; x <= hx + r; x++) if (free(x, z)) return take(x, z); return null; };
      const sides = blds.filter(b => b[4] === 5).map(b => [b[5], [b[0], b[1]]]), plan = [];
      for (const [side, at] of sides) for (const kind of [14, 15, 16]) { const p = near(at); if (p) plan.push([side, kind, ...p, 0]); }
      { const p = near([16, 16]); if (p) plan.push([0, 14, ...p, 1]); }   // 工地擺在地圖中央附近（指揮部旁邊已經擺滿了）
      assert.equal(plan.length, 7, `budget: fixture — room for three buildings a side and one site (${JSON.stringify(plan)})`);
      const ids = await E(`${JSON.stringify(plan)}.map(([s,k,x,z,hp]) => __r089.bld50(s, k, x, z, hp))`);
      assert(ids.every(Boolean), `budget: fixture — placed (${ids})`);
      await settle();
      const got = [];
      for (const zoom of [1, 0.55]) {
        const m = await worst(cx, cz, zoom), dt = m.triangles - base[zoom].triangles;
        got.push(`zoom ${zoom}: ${base[zoom].calls}/${base[zoom].triangles} → ${m.calls}/${m.triangles} (+${dt})`);
        assert(m.calls <= base[zoom].calls, `budget: at zoom ${zoom} seven more buildings add no draw call (${got.at(-1)})`);
        assert(dt <= 6000, `budget: at zoom ${zoom} seven more buildings add at most 6,000 triangles (${got.at(-1)})`);
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`tech50 budget: opening ${on.calls}/${on.triangles} (same as noR050=1); ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
