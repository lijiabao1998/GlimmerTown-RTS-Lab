// R1011 指揮部升級在真的 Chrome（CI 是 SwiftShader）：卡面驗收 19–21。網址帶 noR1011=0、noR050=0、noR1002=0、noR091=0（tools/cdp.mjs 預設關掉這幾張）。
//   19：新開的局 eco 帶 sw＝2、tech＝1、hq11＝1；分組選單的「指揮部」剛好兩顆鍵，三種手機尺寸都是完整、點得到的 44px 鍵；交換台說「要先加固指揮部」；「建造」照舊剛好三顆。
//   20：用生產列的鍵（element.click()）按加固、交換台；R127 那一行寫加固中、生產暫停、已加固、交換台通；360 寬時那一行最多兩行、不蓋住生產鍵；交換台之後步兵班 90 步出生；第 1,200 步頁面＝Node 重播。
//   21（閥、__rts.playLog）在 tests/hq1011-valve-browser.mjs（分兩支：每支 CI 限 120 秒）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld, UK_INFANTRY } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1011-browser-'));
await runOrSkip('hq1011', async () => {
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 915, mobile: true, port: 9711 }, async ({ open, page }) => {
      const E = s => page.evaluate(s).catch(e => { throw new Error(`${e.message} ← ${String(s).slice(0, 120)}`); }), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const size = async (w, h) => { await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await frames(); await frames(); };
      const pick = group => E(`(()=>{const c=document.querySelector('#pb-catalog');c.value=${JSON.stringify(group)};c.dispatchEvent(new Event('change'));return [...c.options].map(o=>o.value)})()`);
      const visible = () => E(`[...document.querySelectorAll('#prodbar button')].filter(b=>!b.hidden&&b.offsetParent!==null&&b.id.startsWith('pb-k')).map(b=>b.id)`);
      const title = id => E(`document.getElementById('${id}')?.title ?? ''`);
      const hqLine = async () => { await frames(); return E("document.getElementById('pb-hq')?.textContent ?? ''"); };
      const replayed = async () => { const [s, t, h, l] = await E('[__rts.seed(), __rts.tick(), __rts.hash(), __rts.log()]'); return { t, h, node: hashWorld(runLog(createWorld(s), l, t)), log: l }; };
      // 360 寬時 R127 那一行最多兩行，生產列每一顆看得到的鍵中心點點到的還是自己
      const layout = () => E(`(()=>{const el=document.getElementById('pb-hq'),r=el.getBoundingClientRect(),lh=parseFloat(getComputedStyle(el).lineHeight);
        const keys=[...document.querySelectorAll('#prodbar button,#prodbar select')].filter(b=>b.offsetParent!==null).map(b=>{const q=b.getBoundingClientRect();return [b.id,b.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))]});
        return {lines:Math.round(r.height/lh),h:r.height,lh,keys:keys.filter(k=>!k[1]).map(k=>k[0]),n:keys.length}})()`);
      // 驗收 19：新開的局與生產列
      await open('noR1011=0&noR050=0&noR1002=0&noR091=0&seed=1944'); await E('__rts.pause(true); __rts.startBattle(); __rts.pause(true); 0'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco').cmd;
      assert.deepEqual([eco.sw, eco.tech, eco.hq11], [2, 1, 1], 'page: a new battle sends sw 2, tech 1 and hq11 1');
      const groups = await pick('指揮部'); await frames();
      assert(groups.includes('指揮部') && groups.includes('建造'), `catalog: the group menu offers 指揮部 next to 建造 (${groups.join('、')})`);
      assert.deepEqual(await visible(), ['pb-k1201', 'pb-k1202'], 'catalog: the 指揮部 group shows exactly the two upgrade keys');
      assert.deepEqual(await E("['pb-k1201','pb-k1202'].map(id=>document.getElementById(id).textContent)"), ['加固指揮部30', '電話交換台40'], 'catalog: 加固指揮部 30, 電話交換台 40');
      for (const [w, h] of [[412, 915], [390, 844], [360, 780]]) {
        await size(w, h);
        const r = await E(`['pb-k1201','pb-k1202'].map(id=>{const b=document.getElementById(id),r=b.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top,ri:r.right,bo:r.bottom,clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})`);
        const apart = (a, b) => a.ri <= b.l || b.ri <= a.l || a.bo <= b.t || b.bo <= a.t;
        assert(r.every(b => b.w >= 44 && b.h >= 44 && !b.clip && b.hit && b.l >= 0 && b.ri <= w && b.t >= 0 && b.bo <= h) && apart(r[0], r[1]), `catalog: at ${w}×${h} the two keys are whole, unclipped, reachable 44px targets that do not overlap (${JSON.stringify(r)})`);
      }
      await size(412, 915);
      assert.match(await title('pb-k1202'), /要先加固指揮部/, 'catalog: the switchboard key says 要先加固指揮部');
      assert.match(await title('pb-k1201'), /加固指揮部 · 沙包牆加高/, 'catalog: the sandbag key says what it does');
      await pick('建造'); await frames();
      assert.deepEqual(await visible(), ['pb-k1014', 'pb-k1015', 'pb-k1016'], 'catalog: the 建造 group still shows exactly the barracks, the depot and the supply depot');
      // 驗收 20：用生產列的鍵按加固、交換台
      await pick('指揮部'); await frames();
      const n0 = (await E('__rts.log()')).length;
      await E("document.getElementById('pb-k1201').click(); 0");
      const sent = (await E('__rts.log()')).slice(n0).map(c => c.cmd);
      assert.deepEqual(sent, [{ t: 'produce', side: 0, kind: 1201 }], `upgrade: the key sends produce 1201 for our side (${JSON.stringify(sent)})`);
      await E('__rts.stepN(1); 0');
      const busy = await hqLine();
      assert(busy.includes('加固中') && busy.includes('生產暫停'), `upgrade: the R127 line says 加固中 and 生產暫停 (${busy})`);
      await size(360, 780); await frames();
      { const l = await layout(); assert(l.lines <= 2 && l.keys.length === 0 && l.n > 0, `upgrade: at 360×780 the line takes at most two lines and covers no production key (${JSON.stringify(l)})`); }
      await size(412, 915);
      await E('__rts.stepN(299); 0');
      assert.match(await hqLine(), /1800\/1800 · 完好 · 已加固$/, 'upgrade: 300 steps later the HQ is 1800/1800 · 完好 · 已加固');
      assert.equal((await E('__rts.blds()')).find(b => b.kind === 5 && b.builtBy === 0).hqLv, 1, 'upgrade: level 1 in the world');
      await E("document.getElementById('pb-k1202').click(); __rts.stepN(1); 0");
      const busy2 = await hqLine();
      assert(busy2.includes('架交換台中') && busy2.includes('生產暫停'), `upgrade: the switchboard is going in (${busy2})`);
      await size(360, 780); await frames();
      { const l = await layout(); assert(l.lines <= 2 && l.keys.length === 0, `upgrade: at 360×780 the longest line takes at most two lines and covers no production key (${JSON.stringify(l)})`); }
      await size(412, 915);
      await E('__rts.stepN(399); 0');
      assert.match(await hqLine(), /· 已加固 · 交換台通$/, 'upgrade: 400 steps later the line says 交換台通');
      // 交換台之後排一個步兵班：90 步出生（不是 120）
      const ours = () => E(`__rts.units().filter(u => u.side === 0 && u.kind === ${UK_INFANTRY}).length`);
      while ((await E('__rts.eco().supply[0]')) < 25) await E('__rts.stepN(20); 0');
      await pick('通用裝備'); await frames();
      const before = await ours(), t1 = await E('__rts.tick()');
      await E(`document.getElementById('pb-k${UK_INFANTRY}').click(); __rts.stepN(1); 0`);
      assert.deepEqual((await E('__rts.eco().queue[0]')), [UK_INFANTRY], 'phone: fixture — the infantry is queued');
      await E('__rts.stepN(89); 0');
      const at89 = await ours(); await E('__rts.stepN(1); 0');
      assert.deepEqual([at89, await ours()], [before, before + 1], `phone: ordered at ${t1}, the infantry comes out 90 steps later (not 120)`);
      await E(`__rts.stepN(${1200} - __rts.tick()); 0`);
      { const r = await replayed(); assert.equal(r.h, r.node, `replay: the page at tick ${r.t} equals the Node replay of its own log`); assert.equal(r.t, 1200, 'replay: at step 1,200'); }
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`hq1011 browser: catalog 3 sizes, sandbags → 1800 → switchboard → infantry in 90 steps, replay at 1200`);
    });
    console.log('hq1011-browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
