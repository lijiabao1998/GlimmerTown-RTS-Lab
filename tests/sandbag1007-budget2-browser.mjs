// R1007 驗收 28（海斯那一半；開局與萊伊在 sandbag1007-budget-browser.mjs）：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。
//   海斯（128×128，區域網格）鏡頭附近兩邊各 8 處沙包（堆好、受損、工地、打散都有），zoom 1 與 0.55：繪製呼叫跟沒有沙包的同一幕一樣、
//   三角形最多多 4,000（含陰影那一趟）、總數 ≤ 80,000；記下區域網格的遠景層級（town.lod）有沒有因為沙包變了（變了寫進卡面，不當過不過）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1007-budget2-'));
const LOOKS = [[120, 0], [50, 0], [1, 100], [0, 0]];   // 完好、受損、工地、打散（[血, 還差的工作量]）
await runOrSkip('sandbag1007-budget2', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9979 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const V = 'noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1';
      const got = [];
      for (const [name, map, cx, cz] of [['Hythe', 'map=hythe&', 64, 64]]) {
        await open(`noR1007=0&${map}${V}&noR018=1`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');   // noR018＝沒有電腦：走時間時兩邊都不出兵、不動
        const settle = async () => { await E('__rts.stepN(20); __rts.pause(true); 0'); for (let k = 0; k < 4; k++) await frames(); const r = await E('__rts.rising().rising'); assert.equal(r, 0, `budget: fixture — no building is still rising when measured (${r})`); };
        await settle();
        const worst = async zoom => { await E(`__r089.cam(${cx}, ${cz}, ${zoom})`); const m = await measure(E, frames); return { ...m, lod: (await E('__rts.info()')).town.lod }; };   // 暫停中同一幕：量一次就準（R050 那支量三次取最大，是因為它在走時間）
        // 兩邊各 8 處：鏡頭附近沒有建築的格（我方在南、敵方在北），四種樣子輪流
        const occ = await E(`(() => { const s = new Set(); for (const b of __rts.blds()) for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) s.add((b.x + dx) + ',' + (b.z + dz)); return [...s]; })()`), used = new Set(occ), list = [];
        for (const side of [0, 1]) for (let r = 0, k = 0; k < 8 && r < 400; r++) {
          const x = cx - 6 + (r % 12), z = side ? cz - 2 - Math.floor(r / 12) : cz + 2 + Math.floor(r / 12);
          if (used.has(`${x},${z}`)) continue;
          used.add(`${x},${z}`); list.push([side, x, z, ...LOOKS[k % 4]]); k++;
        }
        assert.equal(list.length, 16, `budget: fixture — room for 8 sandbags a side near the camera on ${name} (${list.length})`);
        assert.equal(await E(`__r089.bag1007(${JSON.stringify(list)})`), 16, `budget: fixture — 16 sandbags placed on ${name}`);
        await settle();
        // 同一幕（暫停中）把沙包拿掉再放回來比：走時間的那 1 秒裡別的東西（開戰的提示、特效）也會變，跟擺沙包之前比不準（施工紀錄）
        for (const zoom of [1, 0.55]) {
          const m = await worst(zoom); await E('__r089.bagsOff()'); const n = await worst(zoom); await E('__r089.bagsOn()');
          const dt = m.triangles - n.triangles;
          got.push(`${name} zoom ${zoom}: without → with the 16 sandbags ${n.calls}/${n.triangles} → ${m.calls}/${m.triangles} (+${dt}); town LOD ${n.lod} → ${m.lod}`);
          assert(m.calls <= n.calls, `budget: ${name} at zoom ${zoom} — 16 sandbags add no draw call (${got.at(-1)})`);
          assert(dt > 0 && dt <= 4000 && m.triangles <= 80000, `budget: ${name} at zoom ${zoom} — the sandbags are drawn, at most 4,000 more triangles, 80,000 in all (${got.at(-1)})`);
        }
        assert.equal((await E('__r089.bags()'))?.segments.length, 16, `budget: fixture — the sandbags are back on ${name}`);
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`sandbag1007 budget2: ${got.join(' · ')}`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
