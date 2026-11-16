// R055 地勢與視線（第一段）：真實 Chrome（手機觸控 412×915）。設定頁選「丘陵」開局送 map 4、打一段跟 Node 一致、
// 下次開頁還記得、把車開上小丘提示列寫高度、逃生閥（沒有這個選項；記著的丘陵退回萊伊而且不被洗掉）、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER, UK_TANK, SUB } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { MAP_HILLS, HILLS_KNOLLS, hillHeight } from '../src/sim/hillMap.ts';
import { MAP_RYE } from '../src/sim/maps.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r055-browser-'));
// 故意弄壞（只編進 broken 那一份，網址帶 __r055mutant 才生效）
const mutations = {
  nomap: ['src/main.ts', 'skirmish?.hills ? MAP_HILLS : MAP_RYE', "skirmish?.hills && !location.search.includes('__r055mutant=nomap') ? MAP_HILLS : MAP_RYE", 1],
  valve: ['src/valves.ts', "get r055() { return on('055'); }", "get r055() { return on('055') || location.search.includes('__r055mutant=valve'); }", 1],
  height: ['src/ui/unitSpec.ts', 'return hi > 0 ? (', "return hi > 0 && !location.search.includes('__r055mutant=height') ? (", 1],
  forgot: ['src/ui/skirmish.ts', "w.map === MAP_HILLS ? 'hills' :", "w.map === MAP_HILLS && !location.search.includes('__r055mutant=forgot') ? 'hills' :", 2],
};
const applied = new Set();
const plugin = { name: 'r055-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));
const [KX, KZ] = HILLS_KNOLLS[1];   // 我方那一側的小丘
assert.equal(hillHeight(KX, KZ), 2, 'fixture: the knoll on the player side is two levels high');

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8605, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),pressed:e.getAttribute('aria-pressed')}})()`);
    const press = async id => { const r = await rect(id); assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`); await touchTap(page, r.x, r.y); await frames(); };
    const menu = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };   // 地圖那一列在選單的第一頁
    const begin = async () => { await press('sm-start'); await E('(() => { __rts.startBattle(); __rts.pause(true); })()'); await frames(); return (await E('__rts.log()')).find(c => c.cmd.t === 'map')?.cmd; };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    // 選單上選丘陵、開局：map 指令是 4
    const picks = async (extra = '') => {
      await menu(extra);
      const b = await rect('sm-map-hills');
      assert(b && b.hit && b.w >= 44 && b.h >= 44, 'pick: the menu offers 丘陵 as a reachable 44px target');
      await press('sm-map-hills');
      assert.equal((await rect('sm-map-hills')).pressed, 'true', 'pick: once chosen it is lit');
      const map = await begin();
      assert.deepEqual([map?.id, await E('__rts.map()'), await E('__rts.mapSize()')], [MAP_HILLS, MAP_HILLS, 32], 'pick: choosing 丘陵 starts on map 4');
    };
    // 下次開頁（不清本機儲存）：選單上亮的還是丘陵
    const remembers = async (extra = '') => {
      await picks(extra);
      await menu(extra, true);
      assert.equal((await rect('sm-map-hills'))?.pressed, 'true', 'memory: the next visit remembers 丘陵');
    };
    // 把一台坦克開上小丘：提示列寫高度；還在平地的時候不寫。這一段把電腦關掉（noR018）——有電腦的時候，爬上小丘的那台會被看到、被打掉
    const climbs = async (extra = '') => {
      await picks(`noR018=1${extra}`);
      const tank = (await E('__rts.units()')).find(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_TANK);
      await E(`__rts.select([${tank.id}])`); await E('__rts.pause(false)'); await frames(); await E('__rts.pause(true)');
      const low = await E("document.getElementById('hint').textContent");
      assert(!low.includes('高度'), `fixture: on the flat the hint says nothing about height (${low})`);
      await E(`(() => { __rts.issue({ t: 'move', side: 0, ids: [${tank.id}], x: ${KX}, z: ${KZ} }); __rts.stepN(400); })()`);
      const at = (await E('__rts.units()')).find(u => u.id === tank.id);
      assert.deepEqual([at.alive, Math.floor(at.x / SUB), Math.floor(at.z / SUB)], [true, KX, KZ], 'fixture: the tank has reached the top of the knoll alive');
      await E('__rts.pause(false)'); await frames(); await E('__rts.pause(true)');
      const high = await E("document.getElementById('hint').textContent");
      assert(high.includes('高度 2'), `hint: a unit on high ground shows its height (${high})`);
    };
    // 逃生閥：沒有這個選項；本機記著丘陵的時候開出來是萊伊
    const valved = async (extra = '') => {
      await menu(`noR055=1${extra}`, true);
      assert.equal(await rect('sm-map-hills'), null, 'valve: noR055 offers no 丘陵');
      const map = await begin();
      assert.equal(map?.id, MAP_RYE, 'valve: a remembered 丘陵 falls back to 萊伊');
    };

    // ---- 正向 ----
    await remembers();
    await valved();
    await menu('', true);
    assert.equal((await rect('sm-map-hills'))?.pressed, 'true', 'valve: and the visit with the valve off does not wipe the remembered choice');
    // 打一段：瀏覽器跟 Node 一致（把我方也交給電腦，稜線兩邊都有人在動）
    await picks();
    await E("(() => { __rts.issue({ t: 'ai', side: 0, level: 3, v: 3 }); __rts.stepN(500); })()");
    const s = await E('({tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),log:__rts.log()})');
    assert.equal(node(s.seed, s.log, s.tick), s.hash, 'battle: Node reproduces a battle on the hill map from its log');
    await climbs();
    await climbs('&noR075=1');   // 高度不綁在 R075 的閥上
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R055: 丘陵 offered and chosen (map 4), remembered, valve (falls back to 萊伊, memory kept), ${s.tick} steps equal to Node, height in the hint`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nomap', async () => { await picks('__r055mutant=nomap'); }, 'pick: choosing 丘陵 starts on map 4'],
      ['forgot', async () => { await remembers('__r055mutant=forgot'); }, 'memory: the next visit remembers 丘陵'],
      ['height', async () => { await climbs('&__r055mutant=height'); }, 'hint: a unit on high ground shows its height'],
      ['valve', async () => { await picks(); await valved('&__r055mutant=valve'); }, 'valve: noR055 offers no 丘陵'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R055 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R055 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R055 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
