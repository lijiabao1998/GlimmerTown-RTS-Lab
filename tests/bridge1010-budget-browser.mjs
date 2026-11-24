// R1010 驗收 24、25：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。noR018＝沒有電腦、noR100＝沒有霧（最壞的情況）。
//   一、萊伊開局的繪製呼叫和三角形跟 ?noR1010=1 一模一樣。
//   二、萊伊三座橋各一種狀態（斷、斷、木橋；夾具直接設，只在測試的建置裡）：繪製呼叫不多、三角形多 ≤ 1,000（兩趟合計）。
//   三、海斯五座都斷、都是木橋各量一次：繪製呼叫不多、三角形多 ≤ 2,500；區域城鎮：鏡頭停在五座橋上、鎮中心、開局位置，五座都是木橋時細節層級跟完好時一樣，
//       鏡頭在開局位置（離每一座橋都遠）時城鎮的三角形一個都不多。每一次都量「完好 → 那種狀態 → 換回完好」，前後兩次完好要一樣才算量得穩。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1010-budget-'));
const Q = 'noR1002=0&noR091=0&noR1010=0&seed=1944';
await runOrSkip('bridge1010-budget', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9918 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      // 驗收 24、25：預算（noR018＝沒有電腦、noR100＝沒有霧：最壞的情況）
      // 開戰時房子從地面升起（R016）、還有殘影：等它們都併回城鎮網格再量（不然量到的是動畫用的那一份，R1004 施工紀錄 7）
      const settle = async () => {
        for (let k = 0; k < 30; k++) { await E('__rts.stepN(20); __rts.pause(true); __r089.clean(); 0'); for (let f = 0; f < 3; f++) await frames(); const r = await E('__rts.rising()'); if (!r.rising && !r.ghosts) break; }
        const r = await E('__rts.rising()'); assert(!r.rising && !r.ghosts, `budget: fixture — nothing is still rising (${JSON.stringify(r)})`);
      };
      const worst = async (cx, cz, zoom) => { await E(`__r089.cam(${cx}, ${cz}, ${zoom})`); let m = null; for (let i = 0; i < 3; i++) { const x = await measure(E, frames); if (!m || x.triangles > m.triangles || x.calls > m.calls) m = x; } return m; };
      const opening = async q => { await open(`${q}&noR1002=0&noR091=0&seed=1944&noR100=1&noR018=1`); await E('__rts.pause(true); 0'); return measure(E, frames); };
      const on = await opening('noR1010=0'), off = await opening('noR1010=1');
      assert.deepEqual([on.calls, on.triangles], [off.calls, off.triangles], `budget: the Rye opening draws exactly what it drew without R1010 (${on.calls}/${on.triangles})`);
      const got = [`Rye opening ${on.calls}/${on.triangles}`];
      await open(`${Q}&noR100=1&noR018=1`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __rts.stepN(600); __rts.pause(true); 0'); await settle();   // 開局送的兵走到集結點、揚塵散掉之後才量（A＝C 那一句）
      // 量三次：完好（A）→ 換成那幾種狀態（B）→ 換回完好（C）；A＝C 才算量得穩，B 跟 C 比
      const states = async (list, q) => { await E(`${JSON.stringify(list)}.forEach(([si, st]) => __r089.bridge10(si, st)); 0`); await settle(); return q(); };
      const rq = async () => ({ 1: await worst(16, 12, 1), 0.55: await worst(16, 12, 0.55) });
      const ra = await rq(), rB = await states([[0, 1], [1, 1], [2, 2]], rq), rc = await states([[0, 0], [1, 0], [2, 0]], rq);
      for (const zoom of [1, 0.55]) {
        assert.deepEqual([ra[zoom].calls, ra[zoom].triangles], [rc[zoom].calls, rc[zoom].triangles], `budget: fixture — Rye zoom ${zoom} measures the same before and after (${ra[zoom].calls}/${ra[zoom].triangles}, ${rc[zoom].calls}/${rc[zoom].triangles})`);
        const m = rB[zoom], dt = m.triangles - rc[zoom].triangles;
        got.push(`Rye broken/broken/timber zoom ${zoom}: ${rc[zoom].calls}/${rc[zoom].triangles} → ${m.calls}/${m.triangles} (+${dt})`);
        assert(m.calls <= rc[zoom].calls && dt > 0 && dt <= 1000, `budget: ${got.at(-1)}: no more draw calls, at most 1,000 more triangles`);
      }
      // 海斯：五座都斷、都是木橋；區域城鎮的細節層級
      await open('noR1002=0&noR091=0&noR1010=0&map=hythe&seed=1944&noR100=1&noR018=1'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __rts.stepN(600); __rts.pause(true); 0'); await settle();
      const start = await E('__rts.cam()'), spots = [[106, 20], [88, 40], [64, 63], [41, 86], [20, 107], [64, 64], [start.x, start.z]];
      const region = async () => { const out = []; for (const [x, z] of spots) { await E(`__r089.cam(${x}, ${z}, 1)`); await frames(); await frames(); const i = await E('__rts.info()'); out.push({ lod: i.town.lod, tris: i.townTris }); } return out; };
      const hb = await worst(64, 64, 0.55), intact = await region();
      for (const st of [1, 2]) {
        const m = await states([0, 1, 2, 3, 4].map(si => [si, st]), () => worst(64, 64, 0.55)), c = await states([0, 1, 2, 3, 4].map(si => [si, 0]), () => worst(64, 64, 0.55)), dt = m.triangles - c.triangles;
        assert.deepEqual([hb.calls, hb.triangles], [c.calls, c.triangles], `budget: fixture — Hythe measures the same before and after (${hb.calls}/${hb.triangles}, ${c.calls}/${c.triangles})`);
        got.push(`Hythe all ${st === 1 ? 'broken' : 'timber'} zoom 0.55 at (64,64): ${c.calls}/${c.triangles} → ${m.calls}/${m.triangles} (+${dt})`);
        assert(m.calls <= c.calls && dt > 0 && dt <= 2500, `budget: ${got.at(-1)}: no more draw calls, at most 2,500 more triangles`);
        if (st === 2) {
          await E('[0,1,2,3,4].forEach(si => __r089.bridge10(si, 2)); 0'); await settle();
          const now = await region();
          assert.deepEqual(now.map(r => r.lod), intact.map(r => r.lod), `budget: with five timber bridges the Hythe region town keeps its level of detail at every bridge, the centre and the start (${JSON.stringify(now)} vs ${JSON.stringify(intact)})`);
          assert.equal(now.at(-1).tris, intact.at(-1).tris, 'budget: with the camera at the start (far from every bridge) the town gains not one triangle');
          got.push(`Hythe region lod ${now.map(r => r.lod).join('')}, start town ${now.at(-1).tris}`);
        }
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`bridge1010 budget: ${got.join(' · ')}`);
    });
    console.log('bridge1010-budget-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
