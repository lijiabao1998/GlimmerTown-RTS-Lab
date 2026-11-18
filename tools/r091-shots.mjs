// R091 的截圖（卡面驗收 35；不進 CI）：GT_REAL_GPU=1 node tools/r091-shots.mjs → docs/shots/r091/
// 萊伊開戰之後，在我方一側擺一個步兵班、一組狙擊手（停著＝趴著）、一組反戰車小組，對面擺一台中坦克；R089 開著（玩家的預設），桌機 1280×800、手機 412×915 各一張近景
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot, ROOT } from './cdp.mjs';
import { fixture89 } from './r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r091-shots-')), out = path.join(ROOT, 'docs/shots/r091');
fs.mkdirSync(out, { recursive: true });
try {
  await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
  for (const [name, width, height, mobile, zoom, port] of [['desktop', 1280, 800, false, 2.4, 9984], ['phone', 412, 915, true, 2.6, 9985]]) {
    await withBrowser({ root: tmp, width, height, mobile, port }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      await open('noR091=0&noR089=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      await E('__r089.crowd(1, 16, 16, false, 1, 0, 2); __r089.cam(7, 18.5, ' + zoom + ')');   // 夾具從 x＝cx−10 開始擺：步兵班 (6,18)、狙擊手 (7,18)、反戰車小組 (8,18)
      for (let i = 0; i < 6; i++) await frames();
      await shot(page, path.join(out, `r091-${name}.png`));
      console.log(`shot ${name}`);
    });
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
