// R1008 直式手機的空中鍵移到左邊那一排（真的 Chrome，412×915 等三種直式尺寸，觸控）：卡面驗收 1–3。網址帶 noR093=0（tools/cdp.mjs 預設關掉 R093）。
//   版面：鍵 ≥ 44px、在畫面裡、點得到、中心離中線 ≥ 120px、不壓任何別的看得見的鍵、生產列、小地圖；
//   誤觸：畫面中央 120×120 每 20px 點一下（半徑 12px），空中鍵不會被按下；
//   對照：塞回舊位置，鍵左邊 6px 的畫布點一下，空中鍵被按下（證明這支守衛看得到 Chrome 的觸控校正）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1008-browser-'));
// 點一下：按下和放開一起送（R081 的教訓：一個一個送，機器忙時會變成長按）；半徑 12px 的手指
const tapNow = (page, x, y, r = 12) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: r, radiusY: r }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
// 空中鍵的框與狀態
const KEY = `(()=>{const b=document.getElementById('b-air');if(!b||b.hidden||b.offsetParent===null)return null;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
  return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,x,y,pressed:b.getAttribute('aria-pressed'),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(x,y)),mid:innerWidth/2}})()`;
// 其他看得見的東西的框：停火、全排、搭車三條先暫時拿掉 hidden；再加上所有看得見的鍵、生產列、小地圖
const OTHERS = `(()=>{const ids=['fire-discipline','platoon95','transport92'],saved=[];for(const id of ids){const e=document.getElementById(id);if(!e)continue;saved.push([e,e.hidden]);e.hidden=false;for(const b of e.querySelectorAll('button')){saved.push([b,b.hidden]);b.hidden=false;}}
  const box=e=>{const q=e.getBoundingClientRect();return {id:e.id||e.textContent.trim().slice(0,6),l:q.left,t:q.top,r:q.right,b:q.bottom}};
  const out=[...document.querySelectorAll('button')].filter(b=>b.id!=='b-air'&&!document.getElementById('air93')?.contains(b)&&b.offsetParent!==null&&b.getBoundingClientRect().width>0).map(box);
  for(const id of ['prodbar','minimap']){const e=document.getElementById(id);if(e&&e.offsetParent!==null)out.push(box(e));}
  for(const [e,h] of saved)e.hidden=h;return out;})()`;
// 現在看得見的鍵（點地圖時要離它們 30px 以上）
const BUTTONS = `[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null&&b.getBoundingClientRect().width>0).map(b=>{const q=b.getBoundingClientRect();return [q.left,q.top,q.right,q.bottom]})`;
const cross = (a, q) => !(a.r <= q.l || q.r <= a.l || a.b <= q.t || q.b <= a.t);
const gap = (x, y, q) => Math.max(q[0] - x, 0, x - q[2], q[1] - y, 0, y - q[3]);
const OLD = `body.r901 #hud #air93 { left: calc(max(8px, env(safe-area-inset-left)) + 148px) !important; top: calc(max(8px, env(safe-area-inset-top)) + 380px) !important; }`;

await runOrSkip('airkey1008', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 12610 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); });
      const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      await open('noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0'); await frames();
      assert(await E('document.body.classList.contains("r901")'), 'fixture: the portrait phone layout (body.r901) is on');
      // 驗收 1：版面
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const k = await E(KEY), others = await E(OTHERS);
        assert(k && k.w >= 44 && k.h >= 44 && k.inside && k.hit, `layout: at ${w}×${h} 空中 is a whole reachable 44px key (${JSON.stringify(k)})`);
        assert(Math.abs(k.x - k.mid) >= 120, `layout: at ${w}×${h} the key centre is ${Math.round(Math.abs(k.x - k.mid))}px from the middle of the screen (needs ≥ 120)`);
        const hit = others.filter(q => cross(k, q));
        assert.deepEqual(hit, [], `layout: at ${w}×${h} 空中 overlaps nothing else that shows (${JSON.stringify(hit)})`);
      }
      await size(412, 915);
      // 驗收 2：誤觸——畫面中央 120×120、每 20px 一點，離看得見的鍵 30px 以內的跳過
      await E('__r089.cam(16, 16, 1.4); 0'); await frames();
      const btns = await E(BUTTONS), cx = 206, cy = 457;
      let taps = 0;
      for (let dy = -60; dy <= 60; dy += 20) for (let dx = -60; dx <= 60; dx += 20) {
        const x = cx + dx, y = cy + dy;
        if (btns.some(q => gap(x, y, q) < 30)) continue;
        await tapNow(page, x, y); await frames(); taps++;
        const k = await E(KEY);
        assert.equal(k.pressed, 'false', `misfire: a tap on the map at (${x}, ${y}) arms the air key`);
      }
      assert(taps >= 40, `misfire: at least 40 map taps were tried (${taps})`);
      // 驗收 3：對照——塞回舊位置，鍵左邊 6px、畫布上的一點，Chrome 把這一下算到鍵上
      await E(`(()=>{const s=document.createElement('style');s.id='old1008';s.textContent=${JSON.stringify(OLD)};document.head.append(s);return 0})()`); await frames();
      const old = await E(KEY), px = old.l - 6, py = old.y;
      assert(Math.abs(old.x - old.mid) < 60, `control: the old position puts the key near the middle (${JSON.stringify(old)})`);
      assert.equal(await E(`document.elementFromPoint(${px}, ${py})?.tagName`), 'CANVAS', 'control: 6px left of the old key the page sees the map canvas');
      await tapNow(page, px, py); await frames();
      assert.equal((await E(KEY)).pressed, 'true', 'control: at the old position a tap 6px beside the key arms it (Chrome touch adjustment) — this guard can see the misfire');
      await E(`document.getElementById('old1008').remove(); 0`); await frames();
      while ((await E(KEY)).pressed === 'true') { await E("document.getElementById('b-air').click(); 0"); await frames(); }
      await tapNow(page, px, py); await frames();
      assert.equal((await E(KEY)).pressed, 'false', 'control: with the new position the same tap stays on the map');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`airkey1008 browser: 3 portrait sizes, ${taps} centre taps without a misfire, old position control armed by a tap 6px away`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
