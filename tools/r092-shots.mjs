// R092 的截圖（卡面驗收 29；不進 CI）：GT_REAL_GPU=1 node tools/r092-shots.mjs → docs/shots/r092/
// 萊伊開戰之後，在我方一側並排擺一台卡車、一台半履帶車、一台中坦克；另一台卡車拖著一門反戰車砲開動（砲畫在車尾）；R089 開著（玩家的預設），桌機 1280×800、手機 412×915 各一張近景
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot, ROOT } from './cdp.mjs';
import { fixture89 } from './r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r092-shots-')), out = path.join(ROOT, 'docs/shots/r092');
fs.mkdirSync(out, { recursive: true });
try {
  await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
  for (const [name, width, height, mobile, zoom, port] of [['desktop', 1280, 800, false, 2.4, 9984], ['phone', 412, 915, true, 2.6, 9985]]) {
    await withBrowser({ root: tmp, width, height, mobile, port }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      await open('noR092=0&noR089=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      const [tr, ht, tk, t2, gun] = [await E('__r089.place(0, 44, 6, 18)'), await E('__r089.place(0, 45, 8, 18)'), await E('__r089.place(0, 0, 10, 18)'), await E('__r089.place(0, 44, 6, 21)'), await E('__r089.place(0, 4, 6, 21)')];
      await E(`__rts.issue({ t: 'move', side: 0, ids: [${t2}, ${gun}], x: 12, z: 21 }); __rts.stepN(12); 0`);
      await E('__r089.cam(8, 19.5, ' + zoom + ')');
      for (let i = 0; i < 6; i++) await frames();
      await shot(page, path.join(out, `r092-${name}.png`));
      console.log(`shot ${name}`);
    });
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
