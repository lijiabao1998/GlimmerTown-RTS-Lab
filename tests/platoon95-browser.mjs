// R095 步兵排（真的 Chrome）：
// 1. 手機 412×860 與橫的 860×412：生產列 13 顆（多一顆「步兵排」）都 ≥ 44 像素、不重疊；?noR095=1 時那一顆藏起來、eco 指令沒有 pla。
// 2. 觸控按「步兵排」→ 佇列有排；出生後選一班 → 「全排」浮動鍵出現 → 按 → 選到同一排的三班。桌機按 P 一樣。
// 3. 手機預算（R089、R096 開著）：64 圖每邊 48、96 圖每邊 64（全是班；一半班一半坦克），zoom 1 與 0.55，繪製呼叫 ≤ 22、三角形 ≤ 80,000。
// 夾具在 tools/r089-fixture.mjs（只在這份測試的建置裡）。連線在 tests/platoon95-net-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r095-browser-'));
const ON = 'noR095=0&noR089=0';

await runOrSkip('platoon95', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture89(root)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9987 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (wd, ht, mobile = wd < 600 || ht < 600) => { await page.send('Emulation.setDeviceMetricsOverride', { width: wd, height: ht, deviceScaleFactor: 1, mobile }); await frames(); };
      const tap = async id => { const r = await E(`(() => { const b = document.getElementById('${id}'); if (!b || b.hidden) return null; const q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`); assert(r, `fixture: ${id} is on screen`);
        for (const type of ['touchStart', 'touchEnd']) await page.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: r[0], y: r[1] }] }); await frames(); };
      // 1. 生產列
      for (const [wd, ht] of [[412, 860], [860, 412]]) {
        await size(wd, ht);
        await open(`seed=1944&noR100=1&${ON}`); await E('__rts.startBattle(); __rts.pause(true); 0'); await frames();
        const rects = await E("[...document.querySelectorAll('#prodbar button')].filter(b => !b.hidden && b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id, r.x, r.y, r.width, r.height]; })");
        const overlap = rects.some((a, i) => rects.some((b, j) => j > i && a[1] < b[1] + b[3] - 0.5 && b[1] < a[1] + a[3] - 0.5 && a[2] < b[2] + b[4] - 0.5 && b[2] < a[2] + a[4] - 0.5));
        assert(rects.length === 13 && rects.some(r => r[0] === 'pb-k256') && rects.every(r => r[3] >= 44 && r[4] >= 44) && !overlap, `bar: 13 buttons including 步兵排, each at least 44 px, none overlapping (${wd}×${ht}: ${rects.length}, ${JSON.stringify(rects.filter(r => r[3] < 44 || r[4] < 44))}, overlap ${overlap})`);
      }
      await size(412, 860);
      await open('seed=1944&noR100=1&noR095=1&noR089=0'); await E('__rts.startBattle(); __rts.pause(true); 0'); await frames();
      const offLog = await E('__rts.log()'), hidden = await E("document.getElementById('pb-k256')?.hidden ?? true");
      assert(hidden && offLog.filter(e => e.cmd.t === 'eco').every(e => e.cmd.pla === undefined), 'valve: with ?noR095=1 there is no 步兵排 button and the eco command has no pla');
      // 2. 觸控按「步兵排」、出生、全排
      await open(`seed=1944&noR100=1&${ON}`); await E('__rts.startBattle(); __rts.pause(true); __rts.stepN(200); 0'); await frames();
      const before = Math.max(...(await E('__rts.units()')).map(u => u.id));   // __rts.units() 沒有排號：排裡的三班＝之後新出生的步兵
      await tap('pb-k256');
      await E('__rts.stepN(2)'); await frames();
      assert((await E('__rts.eco()')).queue[0].includes(256), 'touch: tapping 步兵排 queues a platoon');
      for (let i = 0; i < 20; i++) { await E('__rts.stepN(20)'); await frames(); }
      const pl = (await E('__rts.units()')).filter(u => u.alive && u.side === 0 && u.kind === 3 && u.id > before);
      assert.equal(pl.length, 3, `touch: the platoon arrives as three sections (${pl.length})`);
      await E(`__rts.select([${pl[0].id}])`); await frames();
      const clash = await E("(() => { const me = document.getElementById('b-platoon').getBoundingClientRect(); return [...document.querySelectorAll('button, select, #minimap')].filter(e => e.id !== 'b-platoon' && !e.closest('#platoon95') && e.offsetParent && !e.hidden).map(e => [e.id || e.textContent.slice(0, 6), e.getBoundingClientRect()]).filter(([, r]) => r.width && me.left < r.right - 0.5 && r.left < me.right - 0.5 && me.top < r.bottom - 0.5 && r.top < me.bottom - 0.5).map(([n]) => n); })()");
      const sz = await E("(() => { const r = document.getElementById('b-platoon').getBoundingClientRect(); return [r.width, r.height]; })()");
      assert(clash.length === 0 && sz[0] >= 44 && sz[1] >= 44, `touch: the 全排 button is at least 44 px and covers no other control (${JSON.stringify(sz)}; ${clash})`);
      await tap('b-platoon');
      assert.deepEqual((await E('__rts.selected()')).sort((a, b) => a - b), pl.map(u => u.id).sort((a, b) => a - b), 'touch: 全排 selects the three sections of the platoon');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      // 3. 手機預算
      await size(412, 860);
      for (const [q, c, per] of [['map=64&', 32, 48], ['map=96&', 48, 64]]) for (const tanks of [0, per >> 1]) {
        await open(`${q}seed=1944&noR100=1&${ON}`); await E('__rts.startBattle(); __rts.pause(true); 0');
        await E(`__r089.crowd(${per}, ${c}, ${c}, false, 2, ${tanks})`);
        for (const zoom of [1, 0.55]) {
          await E(`__r089.cam(${c}, ${c}, ${zoom})`); const m = await measure(E, frames);
          console.log(`r095 phone ${q || 'rye'} ${per} a side (${tanks} tanks), zoom ${zoom}: ${m.calls}/${m.triangles} (men ${m.men.sec?.live}, tris ${m.men.sec?.tris})`);
          assert(m.calls <= 22 && m.triangles <= 80000, `budget: at the new cap the battle stays within 22 calls and 80,000 triangles (${q} ${per} a side, ${tanks} tanks, zoom ${zoom}: ${m.calls}/${m.triangles})`);
        }
      }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
    });
    // 桌機：P（另開一個不是手機的瀏覽器：觸控模擬開著時頁面不裝桌機的鍵盤操作）
    await withBrowser({ root: tmp, width: 1440, height: 900, port: 9988 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
        // 桌機：P
        await open(`seed=1944&noR100=1&${ON}`); await E('__rts.startBattle(); __rts.pause(true); __rts.stepN(200); 0');
        const before2 = Math.max(...(await E('__rts.units()')).map(u => u.id));
        await E("__rts.issue({ t: 'produce', side: 0, kind: 256 }); __rts.stepN(2); 0");
        for (let i = 0; i < 20; i++) { await E('__rts.stepN(20)'); await frames(); }
        const pd = (await E('__rts.units()')).filter(u => u.alive && u.side === 0 && u.kind === 3 && u.id > before2);
        await E(`__rts.select([${pd[1].id}])`);
        await E("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'p', code: 'KeyP', bubbles: true }))"); await frames();
        assert.deepEqual((await E('__rts.selected()')).sort((a, b) => a - b), pd.map(u => u.id).sort((a, b) => a - b), 'desktop: P selects the whole platoon');
      assert.equal(page.errors.length, 0, `page: no page errors on desktop (${page.errors.join(' | ').slice(0, 300)})`);
    });
    console.log('platoon95 browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
