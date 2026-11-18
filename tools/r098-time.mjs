// R098 的時間（只在本機用真顯示卡量：GT_REAL_GPU=1 node tools/r098-time.mjs [--check]；CI 沒有顯示卡，這支不進 CI）。
// 河鎮（96）與鋪滿的 128，手機 412×860、dpr 2。閥在同一頁裡輪流開關（setView98），一次量一幀、交錯 21 次取中位數：
// 機器負載飄動時兩邊受的影響一樣（一頁開、一頁關的量法在這台共用的筆電上會差到兩倍以上）。--check 照卡面驗收 6 的門檻斷言。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from './cdp.mjs';
import { fixture98 } from './r098-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r098-time-')), CHECK = process.argv.includes('--check'), REPS = 21;
const r2 = v => Math.round(v * 100) / 100, med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
try {
  await build({ root, logLevel: 'error', plugins: [fixture98(root)], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9983 }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const ab = async (expr, warm = 3) => {   // 交錯量：開、關、開、關……
      for (let i = 0; i < warm; i++) for (const on of [true, false]) await E(`__r098.valve(${on}); ${expr}`);
      const t = { on: [], off: [] };
      for (let i = 0; i < REPS; i++) for (const on of i % 2 ? [false, true] : [true, false]) t[on ? 'on' : 'off'].push(await E(`__r098.valve(${on}); ${expr}`));
      await E('__r098.valve(true)'); return { on: med(t.on), off: med(t.off) };
    };
    const out = {};
    for (const map of ['town', 'town128']) {
      const o = out[map] = {};
      await open('map=96&seed=1944&noR100=1');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 2, mobile: true });
      await E('__rts.pause(true); 0'); await frames();
      if (map === 'town128') { await E('__r098.deploy128()'); await frames(); }
      await E('__r098.plan()'); o.tap = await ab('__r098.tapOnce()');
      await E('__rts.startBattle(); __rts.pause(true); 0'); await frames();
      if (map === 'town128') { await E('__r098.town128()'); await frames(); }
      for (let i = 0; i < 10; i++) await E("__r098.once('none')");
      for (const k of ['none', 'full', 'he', 'tracks', 'eighth', 'quarter']) o[k] = await ab(`__r098.once('${k}')`);
      o.roof = await E('__r098.garrison(8)'); o.stage8 = await ab('__r098.stageOnce()');
      console.log(map, JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? `${r2(v.on)}/${r2(v.off)}` : v]))), '(on/off ms)');
    }
    if (CHECK) {
      for (const map of ['town', 'town128']) {
        const o = out[map], up = k => o[k].on - o.none.on, full = o.full.on - o.none.on;
        assert(o.stage8.on <= 25, `time: ${map} stage frame with 8 garrisoned units ≤ 25 ms (${r2(o.stage8.on)}; ?noR098=1 ${r2(o.stage8.off)})`);
        assert(up('he') <= 0.2, `time: ${map} one shell's upload ≤ 0.2 ms (${r2(up('he'))})`);
        assert(up('tracks') <= 0.5 && up('tracks') <= 0.4 * full, `time: ${map} two companies' tracks ≤ 0.5 ms and ≤ 0.4× a full upload (${r2(up('tracks'))} vs full ${r2(full)})`);
        assert(up('quarter') <= 0.6 * full, `time: ${map} a quarter of the rows ≤ 0.6× a full upload (${r2(up('quarter'))} vs ${r2(full)})`);
      }
      assert(out.town.tap.on <= 0.8 * out.town.tap.off, `time: a deploy tap on the town ≤ 0.8× before (${r2(out.town.tap.on)} vs ${r2(out.town.tap.off)})`);
      assert(out.town128.tap.on <= 1.3 * out.town.tap.off, `time: a deploy tap on 128 ≤ 1.3× the town before (${r2(out.town128.tap.on)} vs ${r2(out.town.tap.off)})`);
      console.log('r098-time: all thresholds met');
    }
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
