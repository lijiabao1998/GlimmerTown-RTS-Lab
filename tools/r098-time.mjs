// R098 的時間（只在本機用真顯示卡量：GT_REAL_GPU=1 node tools/r098-time.mjs；CI 沒有顯示卡，這支不進 CI）。
// 河鎮（96）與鋪滿的 128，手機 412×860、dpr 2；閥開（R098）與關（?noR098=1，＝之前的做法）同一次量。印出表格；加 --check 照卡面驗收 6 的門檻斷言。
// 量之前先確認沒有別的無頭瀏覽器在跑（這台筆電上別的工作階段的 SwiftShader 會吃掉處理器）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from './cdp.mjs';
import { fixture98 } from './r098-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r098-time-')), CHECK = process.argv.includes('--check');
const r2 = v => Math.round(v * 100) / 100;
try {
  await build({ root, logLevel: 'error', plugins: [fixture98(root)], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9983 }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const dpr2 = () => page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 2, mobile: true });   // open() 每次設回 dpr 1
    const out = {};
    for (const map of ['town', 'town128']) for (const off of [0, 1]) {
      const key = `${map}/${off ? 'off' : 'on'}`, o = out[key] = {};
      await open(`map=96&seed=1944&noR100=1&noR098=${off}`); await dpr2(); await E('__rts.pause(true); 0'); await frames();
      if (map === 'town128') { await E('__r098.deploy128()'); await frames(); }
      o.tap = (await E('__r098.tap(9)')).ms;
      await E('__rts.startBattle(); __rts.pause(true); 0'); await frames();
      if (map === 'town128') { await E('__r098.town128()'); await frames(); }
      for (const k of ['none', 'full', 'he', 'tracks', 'quarter']) o[k] = await E(`__r098.bench('${k}', 15)`);
      o.stage0 = (await E('__r098.stage(0, 15)')).ms;
      const s8 = await E('__r098.stage(8, 15)'); o.stage8 = s8.ms; o.roof = s8.roof;
      console.log(key, JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]))));
    }
    if (CHECK) for (const map of ['town', 'town128']) {
      const on = out[`${map}/on`], off = out[`${map}/off`], up = k => on[k] - on.none;
      assert(on.stage8 <= 25, `time: ${map} stage frame with 8 garrisoned units ≤ 25 ms (${r2(on.stage8)}; before ${r2(off.stage8)})`);
      assert(up('he') <= 0.2, `time: ${map} one shell's upload ≤ 0.2 ms (${r2(up('he'))})`);
      assert(up('tracks') <= 0.5 && up('tracks') <= 0.4 * up('full'), `time: ${map} two companies' tracks ≤ 0.5 ms and ≤ 0.4× a full upload (${r2(up('tracks'))} vs full ${r2(up('full'))})`);
      assert(up('quarter') <= 0.6 * up('full'), `time: ${map} a quarter of the rows ≤ 0.6× a full upload (${r2(up('quarter'))} vs ${r2(up('full'))})`);
    }
    if (CHECK) {
      assert(out['town/on'].tap <= 0.8 * out['town/off'].tap, `time: a deploy tap on the town ≤ 0.8× before (${r2(out['town/on'].tap)} vs ${r2(out['town/off'].tap)})`);
      assert(out['town128/on'].tap <= 1.3 * out['town/off'].tap, `time: a deploy tap on 128 ≤ 1.3× the town before (${r2(out['town128/on'].tap)} vs ${r2(out['town/off'].tap)})`);
      console.log('r098-time: all thresholds met');
    }
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
