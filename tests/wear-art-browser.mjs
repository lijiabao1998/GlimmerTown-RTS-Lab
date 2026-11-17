// R088 建築破壞的過程（真的 Chrome）：
// 1. 五張地圖的手機開局（412×860）：R088 開著與 ?noR088=1 繪製次數、三角形一樣（滿耐久＝T0，逐位一樣），≤ 20 次、80,000；96 圖同一個遠近層級。
// 2. 96 圖：每一棟都打到 T3（夾具直接改耐久，只為了量畫面），標準鏡頭那一區的遠近層級跟 ?noR088=1 一樣，不然印出數字（卡面驗收第 13 條）。
// 3. 對照圖：萊伊的住宅、穀倉、教堂從 T0 到瓦礫，開與 ?noR088=1（桌機），住宅另外拍手機；存到 shots/r088-*.png。
// 真的開火打到 T3、T5 在 tests/wear-art-fire-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r088-browser-')), shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
// 夾具：只在這一份測試的建置裡——擺鏡頭、直接改一棟（或全部）的耐久（只為了量畫面；不是玩法）；換階段時照模擬會送的那樣送 stage 事件，閥關著的畫面才會重建
const fixture = { name: 'r088-fixture', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `\nwindow.__r088={cam:(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);},hp:(id,f)=>{const b=w.blds[id-1],s0=b.hp<=0?2:b.hp*10<=b.maxHp*7?1:0;b.hp=Math.floor(b.maxHp*f);const s1=b.hp<=0?2:b.hp*10<=b.maxHp*7?1:0;if(s1!==s0)view.onEvents([{e:'stage',bld:id,stage:s1}],w.tick/20);},all:f=>{for(const b of w.blds)if(b.kind<=4||(b.kind>=11&&b.kind<=13))b.hp=Math.floor(b.maxHp*f);},clean:()=>document.querySelectorAll('#start-order').forEach(e=>e.remove())};`;
} };
const MAPS = [['rye', ''], ['village', 'map=village&'], ['m64', 'map=64&'], ['m96', 'map=96&'], ['hills', 'map=hills&']];
const LEVELS = [['t0', 1], ['t1', 0.9], ['t2', 0.82], ['t3', 0.74], ['t4', 0.5], ['t5', 0.25], ['rubble', 0]];

await runOrSkip('wear-art', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9981 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (wd, ht) => { await page.send('Emulation.setDeviceMetricsOverride', { width: wd, height: ht, deviceScaleFactor: 1, mobile: wd < 600 }); await frames(); };
      // 1. 手機開局
      for (const [name, q] of MAPS) {
        const info = {};
        for (const on of [true, false]) { await open(`${q}seed=1944&noR100=1${on ? '' : '&noR088=1'}`); await E('__rts.pause(true)'); await frames(); info[on] = await E('__rts.info()'); }
        console.log(`r088 ${name} phone opening: on ${info.true.calls}/${info.true.triangles}, off ${info.false.calls}/${info.false.triangles}, lod ${info.true.town.lod}/${info.false.town.lod}`);
        assert.deepEqual([info.true.calls, info.true.triangles], [info.false.calls, info.false.triangles], `opening: at full health R088 draws the same calls and triangles (${name})`);
        assert(info.true.calls <= 20 && info.true.triangles <= 80000, `opening: the phone budget holds (${name}: ${info.true.calls}/${info.true.triangles})`);
        assert.equal(info.true.town.lod, info.false.town.lod, `opening: the same distance level (${name})`);
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      }
      // 2. 96 圖每一棟都打到 T3
      const lod = {};
      for (const on of [true, false]) {
        await open(`map=96&seed=1944&noR100=1${on ? '' : '&noR088=1'}`);
        await E('__rts.startBattle(); __rts.pause(true); __r088.all(0.74); __rts.stepN(1)'); await frames();
        lod[on] = await E('__rts.info()');
      }
      console.log(`r088 96 every building at T3 (standard camera): on ${lod.true.calls}/${lod.true.triangles} lod ${lod.true.town.lod}, off ${lod.false.calls}/${lod.false.triangles} lod ${lod.false.town.lod}`);
      assert.equal(lod.true.town.lod, lod.false.town.lod, `region: with every building at T3 the 96 standard camera keeps its distance level (on ${lod.true.town.lod}, off ${lod.false.town.lod})`);
      assert(lod.true.calls <= 22 && lod.true.triangles <= 80000, `region: the budget holds with every building at T3 (${lod.true.calls}/${lod.true.triangles})`);
      // 3. 對照圖
      for (const on of [true, false]) {
        await size(1280, 800);
        await open(`seed=1944&noR100=1${on ? '' : '&noR088=1'}`);
        await E('__rts.startBattle(); __rts.pause(true)');
        const picks = await E(`(() => { const bs = __rts.blds(); const pick = k => bs.filter(b => b.kind === k).sort((a, b) => b.w * b.d - a.w * a.d || a.id - b.id)[0]; return [['house', pick(0)], ['barn', pick(2)], ['church', pick(3)]].filter(p => p[1]).map(([n, b]) => [n, b.id, b.x + b.w / 2, b.z + b.d / 2]); })()`);
        for (const [kind, id, cx, cz] of picks) for (const [lvl, f] of LEVELS) {
          await E(`__r088.hp(${id}, ${f}); __rts.stepN(1); __r088.cam(${cx}, ${cz}, 3.2); __r088.clean()`); await frames();
          await shot(page, path.join(shots, `r088-${kind}-${lvl}-${on ? 'on' : 'off'}.png`));
          const info = await E('__rts.info()');
          assert(info.calls <= 22 && info.triangles <= 80000, `close-up: within 22 calls and 80,000 triangles (${kind} ${lvl}, R088 ${on}: ${info.calls}/${info.triangles})`);
        }
        if (on) {   // 手機：住宅
          await size(412, 860);
          await open('seed=1944&noR100=1');
          await E('__rts.startBattle(); __rts.pause(true)');
          const [, id, cx, cz] = picks[0];
          for (const [lvl, f] of LEVELS) { await E(`__r088.hp(${id}, ${f}); __rts.stepN(1); __r088.cam(${cx}, ${cz}, 2.6); __r088.clean()`); await frames(); await shot(page, path.join(shots, `r088-house-${lvl}-phone.png`)); }
        }
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      }
    });
    console.log('wear-art browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
