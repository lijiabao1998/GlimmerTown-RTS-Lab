// R093 的截圖（卡面驗收 30；不進 CI）：GT_REAL_GPU=1 node tools/r093-shots.mjs → docs/shots/r093/
// 萊伊開戰之後，在我方一側擺兩門防空砲、一門榴彈砲（對照），一台卡車拖著一門防空砲開動；天上放三架飛機（夾具直接放進 w.sky）：
// 我方一架俯衝、敵方一架帶傷俯衝、我方一架偵察機盤旋。R089 開著（玩家的預設），桌機 1280×800、手機 412×915 各一張近景
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot, ROOT } from './cdp.mjs';
import { fixture89 } from './r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r093-shots-')), out = path.join(ROOT, 'docs/shots/r093');
fs.mkdirSync(out, { recursive: true });
const C = c => c * 256 + 128;
const PLANES = [
  { side: 0, kind: 1, x: C(9), z: C(17), sx: C(31), sz: C(31), tx: C(9), tz: C(17), t: 48, T: 34, hp: 100 },
  { side: 1, kind: 1, x: C(12), z: C(20), sx: C(0), sz: C(0), tx: C(12), tz: C(20), t: 38, T: 34, hp: 40 },
  { side: 0, kind: 2, x: C(7), z: C(21), sx: C(31), sz: C(31), tx: C(7), tz: C(21), t: 80, T: 43, hp: 60 },
];
try {
  await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
  for (const [name, width, height, mobile, zoom, port] of [['desktop', 1280, 800, false, 2.2, 9995], ['phone', 412, 915, true, 2.4, 9996]]) {
    await withBrowser({ root: tmp, width, height, mobile, port }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      await open('noR093=0&noR089=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      await E('__r089.place(0, 46, 6, 18)'); await E('__r089.place(0, 46, 8, 18)'); await E('__r089.place(0, 1, 10, 18)');
      const tr = await E('__r089.place(0, 44, 6, 22)'), gun = await E('__r089.place(0, 46, 6, 23)');
      await E(`__rts.issue({ t: 'move', side: 0, ids: [${tr}, ${gun}], x: 12, z: 22 }); __rts.stepN(12); 0`);
      await E(`__r089.sky93(${JSON.stringify(PLANES)})`);
      await E('__r089.cam(8.5, 19.5, ' + zoom + ')');
      for (let i = 0; i < 8; i++) await frames();
      await shot(page, path.join(out, `r093-${name}.png`));
      console.log(`shot ${name}`);
    });
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
