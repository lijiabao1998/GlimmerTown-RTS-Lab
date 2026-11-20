// R1002、R050 的截圖（R1003 補拍；不進 CI）：GT_REAL_GPU=1 node tools/r050-shots.mjs → docs/shots/r050/
// 萊伊開戰之後，在我方一側擺兵營、車廠、補給站（夾具直接擺，蓋好的樣子）和一座兵營的工地（血 1：沒屋頂的骨架）；
// 旁邊兩組工兵、兩組火焰噴射器，前面一班敵方步兵（讓火焰噴射器噴一次）。R089 開著（玩家的預設），桌機 1280×800、手機 412×915 各一張
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot, ROOT } from './cdp.mjs';
import { fixture89 } from './r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r050-shots-')), out = path.join(ROOT, 'docs/shots/r050');
fs.mkdirSync(out, { recursive: true });
try {
  await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
  for (const [name, width, height, mobile, zoom, port] of [['desktop', 1280, 800, false, 2.0, 9997], ['phone', 412, 915, true, 2.2, 9998]]) {
    await withBrowser({ root: tmp, width, height, mobile, port }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      await open('noR050=0&noR1002=0&noR091=0&noR089=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      // 找空的 2×2（四周留一格）：從 (6,16) 附近起
      const blds = await E('__rts.blds().map(b => [b.x, b.z, b.w, b.d])'), used = new Set();
      for (const [x, z, w, d] of blds) for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used.add(`${x + dx},${z + dz}`);
      const free = (x, z) => { for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) if (used.has(`${x + dx},${z + dz}`)) return false; return x >= 1 && z >= 1 && x <= 29 && z <= 29; };
      const spots = [];
      for (let r = 0; r <= 12 && spots.length < 4; r++) for (let z = 18 - r; z <= 18 + r && spots.length < 4; z++) for (let x = 8 - r; x <= 8 + r && spots.length < 4; x++) if (free(x, z)) { spots.push([x, z]); for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) used.add(`${x + dx},${z + dz}`); }
      for (const [[x, z], [kind, hp]] of spots.map((s, i) => [s, [[14, 0], [15, 0], [16, 0], [14, 1]][i]])) await E(`__r089.bld50(0, ${kind}, ${x}, ${z}, ${hp})`);
      const [cx, cz] = spots[0];
      for (const [kind, dx, dz] of [[47, -2, 3], [47, -1, 3], [48, 1, 3], [48, 2, 3]]) await E(`__r089.place(0, ${kind}, ${cx + dx}, ${cz + dz})`);
      await E(`__r089.place(1, 3, ${cx + 1}, ${cz + 5})`);
      await E('__rts.stepN(6); 0');
      await E(`__r089.cam(${cx + 1.5}, ${cz + 2}, ${zoom})`);
      for (let i = 0; i < 8; i++) await frames();
      await shot(page, path.join(out, `r050-${name}.png`));
      console.log(`shot ${name} at ${JSON.stringify(spots)}`);
    });
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
