// R1007 沙包在真的 Chrome（CI 是 SwiftShader）：卡面驗收 21–23、26。網址帶 noR050=0、noR1002=0、noR1007=0（tools/cdp.mjs 預設關掉這三張）。
//   新開的局 eco 帶 sw＝2、tech＝1、bag＝1；「建造」四顆鍵在三種手機尺寸都是完整、點得到的 44px 鍵；按「沙包」鍵亮、提示列換成堆沙包那一句；
//   選工兵、按沙包、在真的畫面上點泥灘（說原因、不送）、點一格空地（送 construct kind 17）；蓋好之後城鎮網格多了沙包那幾個三角形、繪製呼叫沒多；第 N 步頁面＝Node 重播；頁面沒有錯誤。
//   存檔與閥（驗收 24、25）在 sandbag1007-save-browser.mjs（一支 CI 限 120 秒）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, cellIdx, BK_SANDBAG } from '../src/sim/world.ts';
import { Geo } from '../src/render/geo.ts';
import { bag1007Geo } from '../src/render/sandbag1007.ts';
import { runLog } from '../src/sim/step.ts';
import { why1007, BAG1007 } from '../src/sim/sandbag1007.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1007-browser-'));
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
const Q = 'noR050=0&noR1002=0&noR1007=0&noR091=0&noR092=0&noR093=0&seed=1944';
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, bag: 1 };
const node = (seed, log, ticks) => runLog(createWorld(seed), log, ticks);
await runOrSkip('sandbag1007', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9976 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      const hint = () => E("document.getElementById('hint').textContent");
      const clear = xy => E(`[...document.querySelectorAll('#hud button')].filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return Math.max(r.left - ${xy[0]}, 0, ${xy[0]} - r.right) + Math.max(r.top - ${xy[1]}, 0, ${xy[1]} - r.bottom); }).reduce((a, b) => Math.min(a, b), 1e9)`);
      // 點得到的格：在畫面裡、離每一顆 HUD 鍵 ≥ 30 像素、點下去落在同一格（R050 施工紀錄 5、R1008 直式空中鍵在左邊那一排）
      const tappable = async (x, z) => {
        const xy = await E(`__rts.screenOfCell(${x}, ${z})`);
        if (!(xy[0] > 40 && xy[1] > 80 && xy[0] < 372 && xy[1] < 700)) return null;
        if ((await clear(xy)) <= 30) return null;
        const g = await E(`__rts.groundAt(${xy[0]}, ${xy[1]})`);
        return g && Math.floor(g[0]) === x && Math.floor(g[1]) === z ? xy : null;
      };
      // 驗收 21：新開的局與「建造」四顆鍵
      await open(`${Q}&noR018=1`); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco.sw, eco.tech, eco.bag], [2, 1, 1], 'page: a new battle sends sw 2, tech 1 and bag 1');
      await pick('建造'); await frames();
      const KEYS = ['pb-k1014', 'pb-k1015', 'pb-k1016', 'pb-k1017'];
      assert.deepEqual(await visible(), KEYS, 'catalog: 建造 shows the barracks, the depot, the supply depot and the sandbag');
      for (const [w, h] of [[412, 860], [390, 844], [360, 780]]) {
        await size(w, h);
        const r = await E(`${JSON.stringify(KEYS)}.map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = (a, b) => a.ri <= b.l || b.ri <= a.l || a.bo <= b.t || b.bo <= a.t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && r.every((a, i) => r.every((b, j) => i >= j || apart(a, b))), `catalog: at ${w}×${h} the four keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 860);
      assert.match(await E("document.getElementById('pb-k1017').title"), /沙包/, 'catalog: the sandbag key carries its own title');
      await E("document.getElementById('pb-k1017').click(); 0"); await frames();
      assert.deepEqual([await E("document.getElementById('pb-k1017').classList.contains('armed50')"), await E('__r089.armed()')], [true, [0, BK_SANDBAG]], 'arm: the 沙包 key lights up and arms the sandbag at once');
      assert.match(await hint(), /^建造沙包：先選工兵，再點工兵 7 格內要堆的那一格/, 'arm: the hint says how to place a sandbag');
      await E("dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 0"); await frames();
      assert.deepEqual(await E('__r089.armed()'), [0, 0], 'arm: Esc disarms it');
      // 驗收 22：造一個工兵、走到河邊、按沙包、點泥灘、點空地（同一頁重播一局）
      const lg0 = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: ECO }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 47 } }];
      const en = node(1944, lg0, 300).units.find(u => u.kind === 47 && u.side === 0 && u.alive);
      assert(en, 'fixture: the replayed game has an engineer by step 300');
      const lg = [...lg0, { tick: 300, cmd: { t: 'move', side: 0, ids: [en.id], x: 26, z: 19 } }], T0 = 560, nw = node(1944, lg, T0);
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, ${T0})`), hashWorld(nw), 'build: the page replays the game to the Node hash');
      await E('__rts.pause(true); 0');
      const e = nw.units[en.id - 1], ex = Math.floor(e.x / 256), ez = Math.floor(e.z / 256);
      await pick('建造'); await frames();
      await E(`__rts.select([${en.id}]); document.getElementById('pb-k1017').click(); __rts.focus(${ex}, ${ez}, 1.3); 0`); await frames(); await frames();
      let spot = null, mud = null;
      for (let r = 1; r <= BAG1007.range && !(spot && mud); r++) for (let z = ez - r; z <= ez + r && !(spot && mud); z++) for (let x = ex - r; x <= ex + r && !(spot && mud); x++) {
        if (Math.max(Math.abs(x - ex), Math.abs(z - ez)) !== r || x < 0 || z < 0 || x >= nw.n - 1 || z >= nw.n - 1) continue;
        const why = why1007(nw, 0, BK_SANDBAG, { x, z, ids: [en.id] }), front = [[1, 0], [0, 1], [1, 1]].some(([dx, dz]) => nw.occ[cellIdx(nw, x + dx, z + dz)]);   // 鏡頭那一側有房子會擋住點擊
        if (front) continue;
        if (!spot && why === '' && r >= 2) { const xy = await tappable(x, z); if (xy) spot = [x, z, xy]; }
        if (!mud && why === '不能堆在泥灘上') { const xy = await tappable(x, z); if (xy) mud = [x, z, xy]; }
      }
      assert(spot && mud, `build: fixture — an open cell and a mud cell in reach, on screen and clear of keys (${JSON.stringify(spot)}, ${JSON.stringify(mud)})`);
      const n1 = (await E('__rts.log()')).length;
      await tapNow(page, ...mud[2]); await frames();
      assert.match(await hint(), /放不下：不能堆在泥灘上/, 'build: a tap on the mud says why, at once');
      assert.deepEqual([(await E('__rts.log()')).length, (await E('__r089.armed()'))[1]], [n1, BK_SANDBAG], 'build: and sends nothing, still armed');
      const before = await E('__rts.info()');   // 只記下來（暫停中房子升起的動畫不走，前後比不準；量的是下面拿掉沙包前後）
      await tapNow(page, ...spot[2]); await frames(); await E('__rts.stepN(1); 0');
      const sent = (await E('__rts.log()')).slice(n1).map(c => c.cmd).filter(c => c.t === 'construct');
      assert.deepEqual(sent, [{ t: 'construct', side: 0, ids: [en.id], kind: BK_SANDBAG, x: spot[0], z: spot[1] }], `build: a tap on the map sends construct kind 17 for the selected engineer (${JSON.stringify(sent)})`);
      assert.equal((await E('__r089.armed()'))[1], 0, 'build: sent, disarmed');
      // 驗收 23：蓋好之後城鎮網格多了沙包那幾個三角形、繪製呼叫沒多（暫停中同一個畫面，把沙包拿掉再放回來比）；第 N 步頁面＝Node
      for (let k = 0; k < 12; k++) await E('__rts.stepN(30)');
      await E('__rts.pause(true); 0');
      const bags = await E('__r089.bags()');
      assert(bags?.segments.length === 1 && bags.segments[0].left === 0 && bags.segments[0].hp === BAG1007.hp, `build: the sandbag stands finished (${JSON.stringify(bags)})`);
      await E(`__rts.focus(${spot[0]}, ${spot[1]}, 1.3); 0`); await frames(); await frames();
      const [s2, t2, h2, l2] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]'), nb = node(s2, l2, t2), want = bag1007Geo(new Geo(), nb).pos.length / 9;
      const withBags = await E('__rts.info()'); await E('__r089.bagsOff()'); await frames(); await frames();
      const noBags = await E('__rts.info()'); await E('__r089.bagsOn()'); await frames(); await frames();
      assert.equal(await E('__rts.hash()'), h2, 'render: fixture — the sandbags are back (same hash)');
      assert(want > 0 && withBags.townTris - noBags.townTris === want && withBags.calls <= noBags.calls, `render: the finished sandbag is in the town mesh (${noBags.townTris} → ${withBags.townTris}, ${want} expected) and adds no draw call (${noBags.calls} → ${withBags.calls})`);
      assert.equal(hashWorld(nb), h2, `replay: the page at tick ${t2} equals the Node replay of its own log`);
      // 驗收 26
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`sandbag1007 browser: 4 keys × 3 sizes; mud refused at ${mud.slice(0, 2)}; construct at ${spot.slice(0, 2)}; town ${before.townTris} before the tap, ${noBags.townTris} → ${withBags.townTris} with the sandbag (+${want}), calls ${noBags.calls} → ${withBags.calls}; replay at ${t2}`);
    });
    console.log('sandbag1007-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
