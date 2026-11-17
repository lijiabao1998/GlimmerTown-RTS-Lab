// R087 更多房屋（真的 Chrome，網址 noR087=0）：五張地圖的手機開局、預算、96 圖的遠近層級、點得到地標、開關對照圖。
// 1. 每個手機開局 ≤ 20 次繪製、80,000 三角形；開關兩邊繪製次數一樣；64 開局 ≤ 關閥時 + 5,600；頁面上新房子的數量跟 Node 一樣。
// 2. 96 圖在手機開局、近景、遠景三個鏡頭跟關閥時同一個遠近層級。
// 3. 每一棟新房子：鏡頭對過去、點它看得到的身體（塔身、烘爐、牆）＝那一棟（點選走的是畫面上的 buildingAt）。
// 4. 開關對照圖存到 shots/r087-*.png。
// 第 0／600 步雜湊、閥關著重播、喪屍 48 隻壓力在 tests/more-houses-replay-browser.mjs；連線在 tests/more-houses-net-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, BK_OAST, BK_MILL, BK_WAREHOUSE } from '../src/sim/world.ts';
import { applyMap } from '../src/sim/maps.ts';
import { applyMoreHouses } from '../src/sim/moreHouses.ts';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r087-browser-')), shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const fixture = { name: 'r087-pick', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + '\nwindow.__r087={pick:(x,y)=>view.buildingAt(x,y,innerWidth,innerHeight),cam:(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);}};';
} };
const MAPS = [['rye', '', 1], ['village', 'map=village&', 0], ['m64', 'map=64&', 2], ['m96', 'map=96&', 3], ['hills', 'map=hills&', 4]];
const NEW = [BK_OAST, BK_MILL, BK_WAREHOUSE];
const nodeAdded = map => { const a = createWorld(1944); applyMap(a, map, 1); const b = createWorld(1944); applyMap(b, map, 1); applyMoreHouses(b); return b.blds.length - a.blds.length; };

await runOrSkip('more-houses', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9991 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const opening = async (q, on, name) => {
        await open(`${q}seed=1944&noR100=1&noR087=${on ? 0 : 1}`); await E('__rts.pause(true)'); await frames();
        const r = { info: await E('__rts.info()'), blds: await E('__rts.blds()'), errors: [...page.errors] };
        await shot(page, path.join(shots, `r087-${name}-phone-${on ? 'on' : 'off'}.png`));
        return r;
      };
      for (const [name, q, map] of MAPS) {
        const off = await opening(q, false, name), on = await opening(q, true, name);
        const added = on.blds.length - off.blds.length;
        console.log(`r087 ${name} phone opening: off ${off.info.calls}/${off.info.triangles}, on ${on.info.calls}/${on.info.triangles} (+${on.info.triangles - off.info.triangles}), +${added} houses, lod ${on.info.town.lod}`);
        assert.equal(on.errors.length + off.errors.length, 0, `page: no page errors (${[...on.errors, ...off.errors].join(' | ').slice(0, 300)})`);
        assert.equal(added, nodeAdded(map), `page: the opening has the same new houses as Node (${name})`);
        assert(on.info.calls <= 20 && on.info.triangles <= 80000, `budget: the phone opening stays within 20 calls and 80,000 triangles (${name}: ${on.info.calls}/${on.info.triangles})`);
        assert.equal(on.info.calls, off.info.calls, `budget: R087 adds no draw calls (${name})`);
        if (map === 2) assert(on.info.triangles <= off.info.triangles + 5600, `budget: the 64 opening grows by at most 5,600 triangles (+${on.info.triangles - off.info.triangles})`);
        if (map === 3) assert.equal(on.info.town.lod, off.info.town.lod, 'lod: the 96 phone opening shows the same distance level as without R087');
        // 點得到：每一棟新房子，對過去點它看得到的身體
        const fresh = on.blds.filter(b => NEW.includes(b.kind));
        for (const b of fresh) {
          const cx = b.x + b.w / 2, cz = b.z + b.d / 2, alongX = b.w >= b.d;
          const [px, py, pz] = b.kind === BK_MILL ? [b.x + 0.5, 0.8, b.z + 0.5] : b.kind === BK_OAST ? (alongX ? [b.x + b.w - 0.5, 0.45, b.z + 0.5] : [b.x + 0.5, 0.45, b.z + b.d - 0.5]) : [cx, 0.6, cz];
          await E(`__r087.cam(${cx},${cz},2.4)`); await frames();
          const [sx, sy] = await E(`__rts.screenOfPoint(${px},${py},${pz})`), hit = await E(`__r087.pick(${sx},${sy})`);
          assert(hit && hit[0] >= b.x && hit[0] < b.x + b.w && hit[1] >= b.z && hit[1] < b.z + b.d, `pick: tapping a new ${b.kind} on screen picks that building (${name}, building ${b.id}: ${JSON.stringify(hit)})`);
        }
        if (fresh.length) {   // 近拍：第一棟地標
          const b = fresh.find(b => b.kind === BK_MILL) ?? fresh[0];
          await E(`__r087.cam(${b.x + b.w / 2},${b.z + b.d / 2},2.6)`); await frames();
          await shot(page, path.join(shots, `r087-${name}-near-on.png`));
          const near = await E('__rts.info()');
          assert(near.calls <= 22 && near.triangles <= 80000, `budget: a close-up stays within 22 calls and 80,000 triangles (${name}: ${near.calls}/${near.triangles})`);
        }
        if (map === 3) {   // 96：近景、遠景跟關閥時同一個層級
          const lods = {};
          for (const on2 of [false, true]) {
            await open(`${q}seed=1944&noR100=1&noR087=${on2 ? 0 : 1}`);
            lods[on2] = [];
            for (const [x, z, zoom] of [[48, 48, 2.5], [48, 48, 0.6], [70, 70, 1]]) { await E(`__r087.cam(${x},${z},${zoom})`); await frames(); lods[on2].push((await E('__rts.info()')).town.lod); }
            if (on2) await shot(page, path.join(shots, 'r087-m96-wide-on.png'));
          }
          assert.deepEqual(lods.true, lods.false, `lod: the 96 near and wide cameras show the same distance levels as without R087 (${JSON.stringify(lods)})`);
        }
      }
    });
    console.log('more-houses browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
