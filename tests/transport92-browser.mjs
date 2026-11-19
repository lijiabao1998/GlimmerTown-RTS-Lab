// R092 運輸在真的 Chrome（CI 是 SwiftShader；手機 412×915 觸控）：卡面驗收 25–28。網址帶 noR092=0（tools/cdp.mjs 預設關掉 R092）。
//   新開的局 eco 帶 tp；分組選單有「運輸」，兩顆鍵在四種尺寸都是完整、點得到的 44px 鍵；點了扣補給、排進佇列；
//   搭車：選一班步兵 →「搭車」出現 → 按下只改選取（指令紀錄不多一筆）→ 點地面：那一班上車、從畫面消失；點卡車的位置選到的是卡車；到了之後又畫出來；頁面雜湊＝Node 重播；
//   「搭車」在三種直的手機尺寸不壓到別的鍵和小地圖；860 寬另開非觸控桌機與觸控對照；
//   R030：新局送 tp 2、?noR030=1 送 tp 1；「開火」「全排」「搭車」三條同時打開量框，「搭車」不壓到另外兩條（直的手機三種、860×412 觸控）；
//   閥：?noR092=1 不送 tp、沒有那一組；帶 tp、乘員、拖砲的紀錄照樣重播；真的離頁存檔、關閥再開頁按「繼續上一局」，原步數、乘員、拖砲與後續步數仍一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT, touchTap } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { SAVE_KEY, checkSave } from '../src/ui/saveGame.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r092-browser-'));
// R030：把三條浮動鍵（和裡面的鍵）同時打開、量框、再照原樣藏回去（同一段同步程式，不會畫出來）
const BARS = `(()=>{const ids=['fire-discipline','platoon95','transport92'],saved=[];for(const id of ids){const e=document.getElementById(id);if(!e)continue;saved.push([e,e.hidden]);e.hidden=false;for(const b of e.querySelectorAll('button')){saved.push([b,b.hidden]);b.hidden=false;}}
  const r=Object.fromEntries(ids.map(id=>{const e=document.getElementById(id);if(!e||e.offsetParent===null)return [id,null];const q=e.getBoundingClientRect();return [id,[q.left,q.top,q.right,q.bottom]];}));for(const [e,h] of saved)e.hidden=h;return r;})()`;
const barsApart = r => { const t = r.transport92, cross = q => q && !(t[2] <= q[0] || q[2] <= t[0] || t[3] <= q[1] || q[3] <= t[1]); return !!(t && r.platoon95 && r['fire-discipline']) && !cross(r.platoon95) && !cross(r['fire-discipline']); };
await runOrSkip('transport92', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9986 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); });
      const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      const press = async id => {
        const r = await E(`(()=>{const b=document.getElementById(${JSON.stringify(id)});if(!b||b.hidden)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
        assert(r && r.w >= 44 && r.h >= 44 && r.hit, `save fixture: ${id} is a reachable 44px target (${JSON.stringify(r)})`);
        await touchTap(page, r.x, r.y); await frames();
      };
      // 驗收 25：新開的局與生產列
      await open('noR092=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.tp, 2, 'page: a new battle sends tp 2 (R030)');
      const groups = await pick('運輸'); await frames();
      assert(groups.includes('運輸'), `catalog: the group menu offers 運輸 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k44', 'pb-k45'], 'catalog: the group shows the truck and the half-track');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780], [860, 412]]) {
        await size(w, h);
        const r = await E(`['pb-k44','pb-k45'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = r[0].ri <= r[1].l || r[1].ri <= r[0].l || r[0].bo <= r[1].t || r[1].bo <= r[0].t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart, `catalog: at ${w}×${h} both keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      await pick('通用裝備'); await frames();
      assert.equal((await visible()).length, 12, 'catalog: the 通用裝備 row keeps its 12 keys (noR095=1, the cdp default)');
      await pick('運輸'); await frames();
      const s0 = (await E('__rts.eco()')).supply[0];
      await E("document.getElementById('pb-k44').click(); __rts.stepN(1); 0");   // 指令下一步才進模擬
      const e1 = await E('__rts.eco()'), income = (await E('__rts.tick()')) % 20 === 0 ? 1 : 0;
      assert.deepEqual([s0 - e1.supply[0] + income, e1.queue[0].at(-1)], [20, 44], 'catalog: a tap costs 20 supply and queues a truck');
      await pick('通用裝備'); await frames();
      // 驗收 26、27：搭車鍵、上車、看不見、點卡車選到卡車、到了又畫出來
      await open('noR092=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      const inf = await E('__r089.place(0, 3, 8, 24)'), tr = await E('__r089.place(0, 44, 9, 24)');
      assert(inf && tr, 'fixture: a section and an empty truck are on the map');
      const pos = await E(`__rts.units().filter(u => u.id === ${inf} || u.id === ${tr}).map(u => [u.id, Math.floor(u.x / 256), Math.floor(u.z / 256)])`);
      await E(`__r089.cam(${pos[0][1]}, ${pos[0][2]}, 1.6); 0`); await frames();
      const men0 = (await measure(E, frames)).men.alive;
      await E(`__rts.select([${inf}]); __rts.stepN(0); 0`); await E('__rts.ui && __rts.ui(); 0').catch(() => {}); await E('__rts.stepN(1); 0'); await frames();
      const ride = await E("(()=>{const b=document.getElementById('b-ride');return b?{shown:!b.hidden&&b.offsetParent!==null,r:(()=>{const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,r.width,r.height]})()}:null})()");
      assert(ride && ride.shown, `ride: 搭車 shows up for a section beside an empty truck (${JSON.stringify(ride)})`);
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const bad = await E(`(()=>{const b=document.getElementById('b-ride'),r=b.getBoundingClientRect(),others=[...document.querySelectorAll('button, select, #minimap')].filter(o=>o!==b&&!b.contains(o)&&o.offsetParent!==null&&!o.hidden);const hit=others.filter(o=>{const q=o.getBoundingClientRect();return q.width&&q.height&&!(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom)}).map(o=>o.id||o.tagName);return {w:r.width,h:r.height,hit,tap:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
        assert(bad.w >= 44 && bad.h >= 44 && !bad.hit.length && bad.tap, `ride: at ${w}×${h} 搭車 is a 44px key that overlaps no other key or the minimap (${JSON.stringify(bad)})`);
        const bars = await E(BARS);
        assert(barsApart(bars), `ride: at ${w}×${h} the 搭車 bar overlaps neither 全排 nor 開火 when all three show (R030; ${JSON.stringify(bars)})`);
      }
      await size(412, 915); await frames();
      const logLen = (await E('__rts.log()')).length;
      await E("document.getElementById('b-ride').click(); 0"); await frames();
      const sel = await E('__rts.selected()');
      assert(sel.includes(inf) && sel.includes(tr) && (await E('__rts.log()')).length === logLen, `ride: 搭車 adds the truck to the selection and sends no command (${sel})`);
      const goal = await E(`(()=>{const [x0,z0]=[${pos[0][1]},${pos[0][2]}];for(let r=8;r>=5;r--)for(const [dx,dz] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]]){const x=x0+dx,z=z0+dz;if(x<1||z<1||x>30||z>30)continue;const p=__rts.screenOfCell(x,z);if(p[0]<30||p[1]<160||p[0]>innerWidth-30||p[1]>innerHeight-260)continue;if(document.elementFromPoint(p[0],p[1])!==document.querySelector('body>canvas'))continue;return p}return null})()`);   // 5–8 格外、螢幕上點得到地圖的一格
      assert(goal, 'fixture: a ground cell 5–8 cells away is on screen');
      await touchTap(page, goal[0], goal[1]); await frames(); await E('__rts.stepN(2); 0'); await frames();
      assert.equal(await E(`__r089.ride(${inf})`), tr, `ride: a tap on the ground puts the section in the truck (${JSON.stringify((await E('__rts.log()')).slice(-3))}; selected ${await E('__rts.selected()')}; tap at ${goal}; units ${JSON.stringify(pos)})`);
      const aboard = await measure(E, frames);
      assert(aboard.men.alive < men0, `ride: the section is no longer drawn (${men0} → ${aboard.men.alive} figures)`);
      assert((await E("document.getElementById('hint').textContent")).includes('卡車 1'), 'ride: the hint names the truck');
      const at = await E(`__rts.screenOf(${tr})`);
      await E('__rts.select([]); 0'); await touchTap(page, at[0], at[1]); await frames();
      assert.deepEqual(await E('__rts.selected()'), [tr], 'ride: tapping where the truck is selects the truck (the rider is hidden)');
      for (let k = 0; k < 20 && (await E(`__r089.ride(${inf})`)); k++) { await E('__rts.stepN(30); 0'); await frames(); }
      assert.equal(await E(`__r089.ride(${inf})`), 0, 'ride: when the truck arrives the section gets off');
      const off = await measure(E, frames);
      assert(off.men.alive >= men0 - 1, `ride: and it is drawn again (${off.men.alive})`);
      const [tick, hash, log] = await E('[__rts.tick(), __rts.hash(), __rts.log()]');   // 這一幕的單位是夾具放的、不在紀錄裡：頁面＝Node 重播由下面閥那一段的 playLog 驗
      assert(log.some(c => c.cmd.t === 'move' && c.cmd.ids.includes(inf) && c.cmd.ids.includes(tr)), 'replay: the move with the truck and the section is in the log');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      // R030：沒有 R901（?noR901=1）的直的窄手機，小地圖跟搭車鍵在同一排；搭車鍵要畫在小地圖上面、點得到
      await open('noR092=0&noR901=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      { const i9 = await E('__r089.place(0, 3, 8, 24)'); await E('__r089.place(0, 44, 9, 24)'); await E(`__rts.select([${i9}]); __rts.stepN(1); 0`); await frames();
        for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
          await size(w, h);
          const k = await E("(()=>{const b=document.getElementById('b-ride');if(!b||b.hidden||b.offsetParent===null)return null;const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {r901:document.body.classList.contains('r901'),w:r.width,h:r.height,hit:b.contains(document.elementFromPoint(x,y)),at:document.elementFromPoint(x,y)?.id}})()");
          assert(k && !k.r901 && k.w >= 44 && k.h >= 44 && k.hit, `ride: with ?noR901=1 at ${w}×${h} the centre of 搭車 is the key itself, not the minimap (R030; ${JSON.stringify(k)})`);
        }
        await size(412, 915); }
      // R030 的閥：照舊送 tp 1
      await open('noR092=0&noR030=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.tp, 1, 'valve: ?noR030=1 sends tp 1 (the R092 rule)');
      // 驗收 28：閥
      await open('noR092=1&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0');
      assert.equal((await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd.tp, undefined, 'valve: ?noR092=1 sends no tp');
      assert.equal((await pick('通用裝備')).includes('運輸'), false, 'valve: ?noR092=1 offers no 運輸');
      const lg = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, tp: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 44 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 45 } }, { tick: 640, cmd: { t: 'produce', side: 0, kind: 4 } }];   // 開局補給只夠兩台車
      const pre = runLog(createWorld(1944), lg, 1000), ids = k => pre.units.filter(u => u.side === 0 && u.kind === k).map(u => u.id);
      const [t44] = ids(44), [t45] = ids(45), [inf0] = ids(3), [gun] = ids(4);
      assert(t44 && t45 && inf0 && gun, 'valve: fixture — a truck, a half-track, a section and an AT gun exist by step 1000');
      const lg2 = [...lg, { tick: 1000, cmd: { t: 'move', side: 0, ids: [t44, inf0], x: 20, z: 20 } }, { tick: 1000, cmd: { t: 'move', side: 0, ids: [t45, gun], x: 22, z: 18 } }];
      const want = runLog(createWorld(1944), lg2, 1060);
      assert(want.units.some(u => u.ride) && want.units.some(u => u.towBy), 'valve: in the replayed game someone rides and a gun is towed at step 1060');
      assert.equal(await E(`__rts.playLog(1944, ${JSON.stringify(lg2)}, 1060)`), hashWorld(want), 'valve: with the valve off the page replays a game with tp, a rider and a towed gun to the Node hash');
      // R146 補驗 28：由真正的頁面離開事件寫 SAVE_KEY，換成關閥的新頁面，再走正式選單的讀檔路徑。
      await open('noR092=0&seed=1944', { menu: true }); await press('sm-start');
      assert.equal(await E(`__rts.pause(true); __rts.playLog(1944, ${JSON.stringify(lg2)}, 1060)`), hashWorld(want), 'save fixture: the running page has the rider/towed-gun world before saving');
      assert.deepEqual(await E('[__rts.phase(), __rts.paused(), __rts.tick()]'), ['battle', true, 1060], 'save fixture: this is a paused, savable battle');
      await open('noR092=1&seed=9', { menu: true, keep: true }); await frames();
      const rawSave = await E(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
      assert.equal(typeof rawSave, 'string', 'save: leaving the enabled page writes a real localStorage save');
      const loaded = checkSave(rawSave);
      assert(loaded.ok, `save: the stored game passes the production decoder (${loaded.why ?? 'OK'})`);
      assert.equal(hashWorld(loaded.save.world), hashWorld(want), 'save: the stored world is the exact pre-navigation battle');
      assert.deepEqual(loaded.save.log, lg2, 'save: the stored command log is complete');
      assert(loaded.save.world.units.some(u => u.ride) && loaded.save.world.units.some(u => u.towBy), 'save: both mounted passengers and towed guns are in the stored world');
      assert.deepEqual(await E('[__rts.phase(), __rts.tick()]'), ['build', 0], 'save: before pressing Continue the new page has not adopted the save');
      await press('sm-continue');
      assert.deepEqual(await E('[__rts.phase(), __rts.paused(), __rts.tick(), __rts.hash()]'), ['battle', true, 1060, hashWorld(want)], 'save: with noR092=1 Continue restores the saved battle at the exact tick and hash');
      assert.deepEqual(await E('__rts.log()'), lg2, 'save: Continue restores the complete command log');
      assert.equal((await pick('通用裝備')).includes('運輸'), false, 'save: the resumed page keeps the transport catalogue valve off');
      const mounted = want.units.filter(u => u.alive && u.ride), seen = await E('__rts.seen()');
      for (const u of mounted) {
        assert.equal(await E(`__r089.ride(${u.id})`), u.ride, 'save: the loaded passenger still belongs to its original vehicle');
        assert(!seen.includes(u.id) && seen.includes(u.ride), 'save: the loaded passenger stays hidden while its vehicle is visible');
      }
      await E('__rts.stepN(100); 0');
      assert.equal(await E('__rts.hash()'), hashWorld(runLog(createWorld(1944), lg2, 1160)), 'save: after loading with the valve off another 100 steps equal uninterrupted Node simulation');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`transport92 browser: catalog 4 sizes, ride button and boarding (${men0} → ${aboard.men.alive} figures), replay tick ${tick} hash ${hash.slice(0, 8)}, valve, actual save/load tick 1060 → 1160`);
    });
    // R146 補驗 27：同為 860×412、同一對可搭車單位，分別真的建立無觸控與有觸控的頁面（不只把手機頁面改寬）。
    for (const mobile of [false, true]) await withBrowser({ root: tmp, width: 860, height: 412, mobile, port: mobile ? 12470 : 12460 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await open('noR092=0&noR070=0&seed=1944');
      await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); __r089.clean(); 0');
      const inf = await E('__r089.place(0, 3, 8, 24)'), tr = await E('__r089.place(0, 44, 9, 24)');
      const pair = await E(`__rts.units().filter(u=>u.id===${inf}||u.id===${tr})`);
      assert(pair.length === 2 && pair.every(u => u.alive && u.side === 0) && Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z) <= 512, 'pointer fixture: a living section and empty truck are within boarding reach');
      await E(`__rts.select([${inf}]); __rts.stepN(1); 0`); await frames();
      const input = await E(`({coarse:matchMedia('(pointer: coarse)').matches,touch:navigator.maxTouchPoints,desktop:document.body.classList.contains('r070'),width:innerWidth})`);
      assert.equal(input.width, 860, 'pointer fixture: both pages really have an 860px viewport');
      assert.equal(input.coarse, mobile, 'pointer fixture: the two pages have different primary pointer types');
      assert.equal(input.touch > 0, mobile, 'pointer fixture: only the touch page has touch points');
      assert.equal(input.desktop, !mobile, 'pointer fixture: only the non-touch page installs desktop controls');
      const ride = await E(`(()=>{const b=document.getElementById('b-ride');if(!b||b.hidden||b.offsetParent===null)return null;const r=b.getBoundingClientRect();return {w:r.width,h:r.height,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
      assert.equal(!!ride, mobile, `pointer: 搭車 is ${mobile ? 'shown on touch' : 'absent on a non-touch desktop'} at 860px (${JSON.stringify(input)})`);
      if (mobile) assert(ride.w >= 44 && ride.h >= 44 && ride.inside && ride.hit, 'pointer: the 860px touch control is a whole, reachable 44px key');
      if (mobile) { const bars = await E(BARS); assert(barsApart(bars), `pointer: at 860×412 touch the 搭車 bar overlaps neither 全排 nor 開火 when all three show (R030; ${JSON.stringify(bars)})`); }
      assert.equal(page.errors.length, 0, `pointer page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`transport92 pointer: 860×412 ${mobile ? 'touch, shown' : 'non-touch desktop, absent'}`);
    });
    console.log('transport92-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
