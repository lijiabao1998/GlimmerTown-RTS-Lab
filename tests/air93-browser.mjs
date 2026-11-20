// R093 空中支援與防空在真的 Chrome（CI 是 SwiftShader；手機 412×915 觸控）：卡面驗收 25–27、30、32。網址帶 noR093=0（tools/cdp.mjs 預設關掉 R093）。
//   新局 eco 帶 air；分組選單有「防空」，防空砲鍵完整、點得到，點了扣 35、排進佇列；「空中」鍵：點一下轟炸、再點偵察、再點取消；
//   選轟炸點看得到的敵方坦克＝送一條空中指令（那一格）；點看不到的格＝不送、鍵上閃「看不到」；四種尺寸鍵 ≥ 44px、不壓到別的條和小地圖；
//   ?noR901=1 的窄手機中心點得到；1280×720 滑鼠也有這顆鍵；閥：?noR093=1 不送 air、沒有「防空」、沒有空中鍵；同一頁重播一份帶 air 的紀錄＝Node。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, UK_TANK, UK_OBSERVER, UK_AA } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r093-browser-'));
// 點一下：按下和放開一起送，各帶時間戳（相隔 60 毫秒）。機器忙時一個一個送，頁面會把它當成長按（R109 的 500 毫秒）
const tapNow = (page, x, y) => { const base = Date.now(); return Promise.all([page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: base / 1000 }), page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + 60) / 1000 })]); };
// 一份帶 air 的紀錄：第 100 步轟炸自己指揮部旁邊看得到的格、第 300 步偵察
const LOG93 = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, air: 1 } },
  { tick: 100, cmd: { t: 'air', side: 0, kind: 1, x: 27, z: 27 } }, { tick: 300, cmd: { t: 'air', side: 0, kind: 2, x: 6, z: 6 } }];
const BARS = `(()=>{const ids=['fire-discipline','platoon95','transport92','air93'],saved=[];for(const id of ids){const e=document.getElementById(id);if(!e)continue;saved.push([e,e.hidden]);e.hidden=false;for(const b of e.querySelectorAll('button')){saved.push([b,b.hidden]);b.hidden=false;}}
  const r=Object.fromEntries(ids.map(id=>{const e=document.getElementById(id);if(!e||e.offsetParent===null)return [id,null];const q=e.getBoundingClientRect();return [id,[q.left,q.top,q.right,q.bottom]];}));for(const [e,h] of saved)e.hidden=h;return r;})()`;
const apart = r => { const t = r.air93, cross = q => q && !(t[2] <= q[0] || q[2] <= t[0] || t[3] <= q[1] || q[3] <= t[1]); return !!t && ['fire-discipline', 'platoon95', 'transport92'].every(k => !cross(r[k])); };
const KEY = `(()=>{const b=document.getElementById('b-air');if(!b||b.hidden||b.offsetParent===null)return null;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,m=document.getElementById('minimap')?.getBoundingClientRect();
  return {w:r.width,h:r.height,x,y,text:b.textContent,pressed:b.getAttribute('aria-pressed'),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(x,y)),at:document.elementFromPoint(x,y)?.id,mini:m?!(r.right<=m.left||m.right<=r.left||r.bottom<=m.top||m.bottom<=r.top):false}})()`;

await runOrSkip('air93', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9994 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); });
      const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      // 驗收 25：新開的局與生產
      await open('noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.air, 1, 'page: a new battle sends air 1');
      const groups = await pick('防空'); await frames();
      assert(groups.includes('防空'), `catalog: the group menu offers 防空 (${groups.join('、')})`);
      assert.deepEqual(await visible(), [`pb-k${UK_AA}`], 'catalog: the group shows the AA gun');
      const s0 = (await E('__rts.eco()')).supply[0];
      await E(`document.getElementById('pb-k${UK_AA}').click(); __rts.stepN(1); 0`);
      const e1 = await E('__rts.eco()'), income = (await E('__rts.tick()')) % 20 === 0 ? 1 : 0;
      assert.deepEqual([s0 - e1.supply[0] + income, e1.queue[0].at(-1)], [35, UK_AA], 'catalog: a tap costs 35 and queues an AA gun');
      await pick('通用裝備'); await frames();
      // 驗收 26：空中鍵
      await open('noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0'); await frames();
      const obs = await E(`__r089.place(0, ${UK_OBSERVER}, 10, 22)`), tank = await E(`__r089.place(1, ${UK_TANK}, 12, 22)`);
      assert(obs && tank, 'fixture: our observer and an enemy tank it can see');
      await E(`__r089.cam(11, 22, 1.4); __rts.stepN(1); 0`); await frames();
      let k = await E(KEY);
      assert(k && k.text === '空中' && k.w >= 44 && k.h >= 44 && k.hit, `key: 空中 shows in battle, a whole reachable 44px key (${JSON.stringify(k)})`);
      const labels = [];
      for (let i = 0; i < 3; i++) { await E("document.getElementById('b-air').click(); 0"); await frames(); k = await E(KEY); labels.push(`${k.text}/${k.pressed}`); }
      assert.deepEqual(labels, ['轟炸/true', '偵察/true', '空中/false'], 'key: tap = strike, again = recon, again = cancel');
      // 看不到的格：不送、鍵上閃「看不到」
      const n2 = (await E('__rts.log()')).length;
      await E("document.getElementById('b-air').click(); 0"); await frames();
      await E('__r089.cam(26, 6, 1.4); 0'); await frames();   // 地圖另一角：觀測員（視野 14 格）和指揮部旁的人都看不到
      const far = await E('__rts.screenOfCell(26, 6)');
      await tapNow(page, far[0], far[1]); await frames(); k = await E(KEY);
      assert((await E('__rts.log()')).length === n2 && k.pressed === 'true', `key: a strike on a cell we cannot see sends nothing and stays armed (${k.text})`);
      await E('__r089.cam(11, 22, 1.4); 0'); await frames();
      await E("document.getElementById('b-air').click(); document.getElementById('b-air').click(); 0"); await frames();
      const logLen = (await E('__rts.log()')).length;
      await E("document.getElementById('b-air').click(); 0"); await frames();
      const at = await E(`__rts.screenOf(${tank})`); await tapNow(page, at[0], at[1]); await frames();
      const log = await E('__rts.log()'), cell = await E(`(()=>{const u=__rts.units().find(u=>u.id===${tank});return [Math.floor(u.x/256),Math.floor(u.z/256)]})()`);
      assert.deepEqual(log.slice(logLen).map(c => c.cmd), [{ t: 'air', side: 0, kind: 1, x: cell[0], z: cell[1] }], `key: armed strike + tap on the visible enemy tank sends one air command for its cell (${JSON.stringify(log.slice(logLen))})`);
      k = await E(KEY); assert.equal(k.pressed, 'false', 'key: after sending, the key is disarmed');
      // 驗收 27：版面
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h); k = await E(KEY); const bars = await E(BARS);
        assert(k && k.w >= 44 && k.h >= 44 && k.inside && k.hit && !k.mini && apart(bars), `layout: at ${w}×${h} 空中 is a whole 44px key that overlaps no other bar or the minimap (${JSON.stringify({ k, bars })})`);
      }
      await size(412, 915);
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      // 驗收 32：閥與重播
      await open('noR093=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.air, undefined, 'valve: ?noR093=1 sends no air');
      assert(!(await pick('通用裝備')).includes('防空') && !(await E(KEY)), 'valve: ?noR093=1 offers no 防空 group and no 空中 key');
      const want = runLog(createWorld(1944), LOG93, 700);
      assert(want.sky && want.eco.air === 1, 'valve: fixture — the Node replay of the air log has planes');
      assert.equal(await E(`__rts.pause(true); __rts.playLog(1944, ${JSON.stringify(LOG93)}, 700)`), hashWorld(want), 'valve: with ?noR093=1 a log with air replays to the Node hash');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`air93 browser: catalog, key flow ${labels.join(' → ')}, strike sent for cell ${cell}, 3 portrait sizes, valve and replay ${hashWorld(want)}`);
    });
    // 860×412 觸控、1280×720 滑鼠：都有這顆鍵、點得到、不壓到別的條
    for (const [w, h, mobile] of [[860, 412, true], [1280, 720, false]]) await withBrowser({ root: tmp, width: w, height: h, mobile, port: mobile ? 12480 : 12490 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await open('noR093=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); __rts.stepN(1); 0'); await frames();
      const k = await E(KEY), bars = await E(BARS);
      assert(k && k.w >= 44 && k.h >= 44 && k.inside && k.hit && !k.mini && apart(bars), `layout: at ${w}×${h} ${mobile ? 'touch' : 'mouse'} 空中 is a whole reachable key clear of the other bars (${JSON.stringify({ k, bars })})`);
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
    });
    // ?noR901=1 的窄手機：小地圖跟空中鍵在同一排，鍵要畫在小地圖上面（R030 的驗法）
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 12500 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await open('noR093=0&noR901=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); __rts.stepN(1); 0'); await frames();
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames();
        const k = await E(KEY);
        assert(k && k.hit, `layout: with ?noR901=1 at ${w}×${h} the centre of 空中 is the key itself, not the minimap (${JSON.stringify(k)})`);
      }
    });
    console.log('air93-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
