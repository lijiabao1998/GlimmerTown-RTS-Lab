// R090 海斯（地圖 5）在這台筆電、真顯示卡上的時間（GT_REAL_GPU=1 node tools/r090-time.mjs [--check]；CI 沒有顯示卡，不進 CI）。卡面驗收 8：
//   建好畫面（makeView＋開局第一次 refreshPreview）≤ 300 毫秒、小地圖重畫 ≤ 4 毫秒；R098 的三項（換段那一幀、布陣點一下、地面上傳）在地圖 5 上重量一次，
//   跟河鎮同一次量。手機 412×860、dpr 2；R098 的項目照 tools/r098-time.mjs 的量法（同一頁裡閥輪流開關、交錯取中位數）。量之前確認沒有別的無頭瀏覽器在跑。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from './cdp.mjs';
import { fixture98 } from './r098-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r090-time-')), CHECK = process.argv.includes('--check'), REPS = 15;
const r2 = v => Math.round(v * 100) / 100, med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
try {
  await build({ root, logLevel: 'error', plugins: [fixture98(root)], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9981 }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const many = async (expr, n = REPS) => { const t = []; for (let i = 0; i < 3; i++) await E(expr); for (let i = 0; i < n; i++) t.push(await E(expr)); return med(t); };
    const ab = async expr => { for (let i = 0; i < 3; i++) for (const on of [true, false]) await E(`__r098.valve(${on}); ${expr}`); const t = { on: [], off: [] }; for (let i = 0; i < REPS; i++) for (const on of i % 2 ? [false, true] : [true, false]) t[on ? 'on' : 'off'].push(await E(`__r098.valve(${on}); ${expr}`)); await E('__r098.valve(true)'); return { on: med(t.on), off: med(t.off) }; };
    const out = {};
    for (const [name, q] of [['hythe', 'map=hythe'], ['town', 'map=96']]) {
      const o = out[name] = {};
      await open(`${q}&seed=1944&noR100=1`); await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 2, mobile: true });
      await E('__rts.pause(true); 0'); await frames();
      o.build = await many('__r098.rebuild()', 7); o.mini = await many('__r098.mini()');
      await E('__r098.plan()'); o.tap = await ab('__r098.tapOnce()');
      await E('__rts.startBattle(); __rts.pause(true); 0'); await frames();
      for (let i = 0; i < 10; i++) await E("__r098.once('none')");
      for (const k of ['none', 'full', 'he', 'tracks', 'quarter']) o[k] = await ab(`__r098.once('${k}')`);
      o.roof = await E('__r098.garrison(8)'); o.stage8 = await ab('__r098.stageOnce()');
      console.log(name, JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? `${r2(v.on)}/${r2(v.off)}` : r2(v)]))), '(R098 items on/off ms)');
    }
    if (CHECK) {
      const h = out.hythe, t = out.town;
      assert(h.build <= 300, `time: building the Hythe view ≤ 300 ms (${r2(h.build)})`);
      assert(h.mini <= 4, `time: repainting the Hythe minimap ≤ 4 ms (${r2(h.mini)})`);
      for (const k of ['tap', 'stage8']) assert(h[k].on <= 1.5 * t[k].on, `time: R098's ${k} on Hythe ≤ 1.5× the town in the same run (${r2(h[k].on)} vs ${r2(t[k].on)})`);
      console.log('r090-time: all thresholds met');
    }
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
