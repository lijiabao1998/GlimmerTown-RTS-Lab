// R1003（R093 補驗）在真的 Chrome（CI 是 SwiftShader）：卡面驗收 2。網址帶 noR093=0（tools/cdp.mjs 預設關掉 R093）。
//   2.1 Esc 取消空中鍵；2.2 新開一局（重新開始鍵）取消；2.3 讀檔（同一頁重播一份紀錄）取消；2.4 分出勝負取消、鍵按不下去；
//   2.5 飛機上天不多編著色程式（開戰、場上有車之後記 renderer.info.programs）；2.6 ?fx=off 時飛機與防空砲照畫、頁面沒有錯誤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1003-browser-'));
const C = c => c * 256 + 128;
const PLANES = [
  { side: 0, kind: 1, x: C(15), z: C(15), sx: C(31), sz: C(31), tx: C(15), tz: C(15), t: 60, T: 50, hp: 100 },
  { side: 1, kind: 1, x: C(17), z: C(16), sx: C(0), sz: C(0), tx: C(17), tz: C(16), t: 70, T: 50, hp: 55 },
  { side: 0, kind: 2, x: C(14), z: C(18), sx: C(31), sz: C(31), tx: C(14), tz: C(18), t: 100, T: 50, hp: 60 },
  { side: 1, kind: 2, x: C(18), z: C(14), sx: C(0), sz: C(0), tx: C(18), tz: C(14), t: 120, T: 50, hp: 60 },
];
await runOrSkip('air93-checks', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9975 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const key = () => E("(() => { const b = document.getElementById('b-air'); return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, shown: !document.getElementById('air93').hidden } : null; })()");
      const arm = async () => { await E("document.getElementById('b-air').click(); 0"); await frames(); return key(); };
      const battle = async q => { await open(`noR093=0&seed=1944${q}`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames(); await frames(); };
      // 2.1 Esc
      await battle('');
      let k = await arm();
      assert(k.pressed === 'true' && /轟炸|偵察/.test(k.text), `esc: a click arms the air key (${JSON.stringify(k)})`);
      await E("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await frames();
      k = await key();
      assert.deepEqual([k.pressed, k.text], ['false', '空中'], 'esc: Esc disarms it');
      // 2.2 新開一局（重新開始鍵）
      k = await arm(); assert.equal(k.pressed, 'true', 'restart: armed again');
      await E("document.getElementById('b-restart').click(); 0"); await frames();
      await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames(); await frames();
      k = await key();
      assert.deepEqual([k.shown, k.pressed, k.text], [true, 'false', '空中'], `restart: a new game comes up with the air key disarmed (${JSON.stringify(k)})`);
      // 2.3 讀檔（同一頁換一個世界）
      k = await arm(); assert.equal(k.pressed, 'true', 'load: armed again');
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, air: 1 } }];
      await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, 200)`); await E('__rts.pause(true); 0'); await frames(); await frames();
      k = await key();
      assert.deepEqual([k.pressed, k.text], ['false', '空中'], `load: loading another world disarms it (${JSON.stringify(k)})`);
      // 2.4 分出勝負
      k = await arm(); assert.equal(k.pressed, 'true', 'win: armed again');
      await E('__r089.hqDown(1); __rts.stepN(2); 0'); await frames(); await frames();
      k = await key();
      assert.equal(k.shown, false, `win: once the battle is decided the air bar is hidden (air93.ts clears the choice in the same branch; the hidden key keeps its old label until it shows again) (${JSON.stringify(k)})`);
      // 2.5 著色程式：開戰、場上有車之後記一次；飛機上天、畫幾幀，數量不變
      await battle('&noR089=0');
      await E('__r089.crowd(4, 16, 16, false, 2, 2)'); await E('__r089.cam(16, 16, 1)'); for (let i = 0; i < 6; i++) await frames();
      const before = await E('__r089.programs()');
      assert(before > 0, `programs: the renderer reports its programs (${before})`);
      assert.equal(await E(`__r089.sky93(${JSON.stringify(PLANES)})`), 4, 'programs: fixture — four planes in the sky');
      for (let i = 0; i < 6; i++) await frames();
      const after = await E('__r089.programs()');
      assert.equal(after, before, `programs: four planes add no shader program during the battle (${before} → ${after})`);
      // 2.6 ?fx=off：飛機與防空砲照畫
      await battle('&fx=off&noR089=0');
      await E('__r089.crowd(4, 16, 16, false, 2, 2)'); await E('__r089.cam(16, 16, 1)');
      const base = await measure(E, frames);
      assert(await E('[[0,14,20],[1,18,12]].map(([s,x,z])=>__r089.place(s,46,x,z)).every(Boolean)'), 'fx off: fixture — two AA guns');
      const guns = await measure(E, frames);
      assert.equal(await E(`__r089.sky93(${JSON.stringify(PLANES)})`), 4, 'fx off: fixture — four planes');
      const air = await measure(E, frames);
      assert(guns.triangles > base.triangles && air.triangles > guns.triangles, `fx off: AA guns and planes are still drawn (${base.triangles} → ${guns.triangles} → ${air.triangles})`);
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`air93 checks: esc, restart, load, win disarm; programs ${before} → ${after}; fx off ${base.triangles} → ${guns.triangles} → ${air.triangles}`);
    });
    console.log('air93-checks-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
