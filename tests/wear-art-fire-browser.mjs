// R088 建築破壞的過程（真的 Chrome）：萊伊開戰，我方的坦克對最近的一棟民房 fireAt，打到 T3、再打到 T5（步數先在 Node 算好）。
// 那兩步：頁面的雜湊＝Node 重播頁面自己的紀錄；鏡頭對過去，手機與桌機 ≤ 22 次、80,000 三角形，繪製次數跟 ?noR088=1 打同一局同一步一樣；
// 截圖 shots/r088-fire-*.png。只改畫面，所以兩邊的世界一樣（雜湊也比）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, hashWorld, cellOf, UNIT_KINDS } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { wearTier, wearable } from '../src/render/wearArt.ts';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r088-fire-')), shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const fixture = { name: 'r088-fire', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `\nwindow.__r088={cam:(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);},clean:()=>document.querySelectorAll('#start-order').forEach(e=>e.remove())};`;
} };

await runOrSkip('wear-art-fire', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9983 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      // 先開 R088 那一頁拿開戰的紀錄，在 Node 挑目標、算 T3、T5 的步數
      await open('seed=1944&noR100=1');
      await E('__rts.startBattle(); __rts.pause(true)');
      const seed = await E('__rts.seed()'), t0 = await E('__rts.tick()'), log0 = await E('__rts.log()');
      const w = runLog(createWorld(seed), log0, t0);
      const tanks = w.units.filter(u => u.alive && u.side === 0 && UNIT_KINDS[u.kind].armored && UNIT_KINDS[u.kind].range > 0);
      const tx = tanks.reduce((s, u) => s + cellOf(u.x), 0) / tanks.length, tz = tanks.reduce((s, u) => s + cellOf(u.z), 0) / tanks.length;
      const target = w.blds.filter(b => wearable(b.kind) && b.hp === b.maxHp && !b.builtBy).sort((a, b) => Math.hypot(a.x + a.w / 2 - tx, a.z + a.d / 2 - tz) - Math.hypot(b.x + b.w / 2 - tx, b.z + b.d / 2 - tz))[0];
      const cmd = { t: 'fireAt', side: 0, ids: tanks.map(u => u.id), x: target.x, z: target.z }, log = [...log0, { tick: t0, cmd }];
      const sim = runLog(createWorld(seed), log0, t0); let t3 = -1, t5 = -1;
      step(sim, [cmd]);
      while (sim.tick < t0 + 4000 && t5 < 0) { const t = wearTier(sim.blds[target.id - 1]); if (t >= 3 && t3 < 0) t3 = sim.tick; if (t >= 5 && t < 6) t5 = sim.tick; step(sim, []); }
      console.log(`r088 fire: ${tanks.length} tanks at building ${target.id} (kind ${target.kind}); T3 at tick ${t3}, T5 at tick ${t5}`);
      assert(t3 > t0 && t5 > t3, `fixture: the tanks bring the building to T3 and then T5 (${t3}, ${t5})`);
      const info = {};
      for (const on of [true, false]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
        await open(`seed=1944&noR100=1${on ? '' : '&noR088=1'}`);
        await E('__rts.startBattle(); __rts.pause(true)');
        assert.equal(await E('__rts.tick()'), t0, 'fixture: both pages start the battle at the same tick');
        await E(`__rts.issue(${JSON.stringify(cmd)})`);
        for (const [name, t] of [['t3', t3], ['t5', t5]]) {
          await E(`__rts.stepN(${t} - __rts.tick()); __r088.cam(${target.x + target.w / 2}, ${target.z + target.d / 2}, 2.6); __r088.clean()`); await frames(); await frames();
          assert.equal(await E('__rts.hash()'), hashWorld(runLog(createWorld(seed), await E('__rts.log()'), t)), `page: at tick ${t} the page equals the Node replay of its own log (R088 ${on})`);
          for (const [dev, wd, ht] of [['phone', 412, 860], ['desk', 1280, 800]]) {
            await page.send('Emulation.setDeviceMetricsOverride', { width: wd, height: ht, deviceScaleFactor: 1, mobile: wd < 600 }); await frames(); await frames();
            const i = await E('__rts.info()'); info[`${on}/${name}/${dev}`] = i;
            assert(i.calls <= 22 && i.triangles <= 80000, `close-up: within 22 calls and 80,000 triangles (${name} ${dev}, R088 ${on}: ${i.calls}/${i.triangles})`);
            await shot(page, path.join(shots, `r088-fire-${name}-${dev}-${on ? 'on' : 'off'}.png`));
          }
          await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
        }
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      }
      for (const k of ['t3/phone', 't3/desk', 't5/phone', 't5/desk']) {
        const a = info[`true/${k}`], b = info[`false/${k}`];
        console.log(`r088 fire ${k}: on ${a.calls}/${a.triangles}, off ${b.calls}/${b.triangles}`);
        assert.equal(a.calls, b.calls, `close-up: R088 draws with the same number of calls as ?noR088=1 (${k})`);
      }
    });
    console.log('wear-art fire browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
