// R051 穿甲與裝甲厚度：真實 Chrome（手機觸控 412×915）。設定頁的開關、網址、實戰裡的跳彈與戰報、記憶、版面、預算、逃生閥、故意弄壞。
// 模擬規則本身（表、彈開／穿透、方向、距離、對照表、決定性）在 tests/ballistics.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { SUB, UK_HEAVY, UNIT_KINDS } from '../src/sim/world.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r051-browser-'));
const SHOTS = path.join(ROOT, 'shots');
const BIG = 'map=64&noR019=1&seed=51';   // 鄉間 64×64：雙方各有兩輛重坦克；沒有指揮部，不會中途出新的兵
const HEAVY = 24;                          // 敵方第一輛重坦克（我方 1–15、敵方 16–30，重坦克是每方第 9、10 台）
// 故意弄壞（只編進 broken 那一份，網址帶 __r051mutant 才生效）
const mutations = {
  toggle: ['src/ui/startMenu.ts', "    else if (sk && id === 'sm-ap') { sk.set({ ap: !sk.ap }); fresh = true; }", "    else if (sk && id === 'sm-ap') { if (!location.search.includes('__r051mutant=toggle')) sk.set({ ap: !sk.ap }); fresh = true; }"],
  report: ['src/ui/report.ts', "    else if (e.e === 'impact' && e.bounce && (e.side === SIDE_PLAYER || e.side === SIDE_ENEMY))", "    else if (e.e === 'impact' && e.bounce && !location.search.includes('__r051mutant=report') && (e.side === SIDE_PLAYER || e.side === SIDE_ENEMY))"],
  valve: ['src/ui/skirmish.ts', '  const store = memory, canAp = valves(q).r051;', "  const store = memory, canAp = valves(q).r051 || location.search.includes('__r051mutant=valve');"],
};
const applied = new Set();
const plugin = { name: 'r051-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, 1, `negative anchor: ${name}`);
    code = code.replace(from, to); applied.add(name);
  }
  return code;
} };

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8503, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let mobile = true, width = 412, height = 915;
    const size = async (w, h, m = true) => { mobile = m; width = w; height = h; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const menu = () => E(`(()=>{const m=document.getElementById('start-menu');return m?{open:!m.hidden,ids:[...m.querySelectorAll('button, input')].map(b=>b.id),pressed:[...m.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id),setup:document.getElementById('sm-setup')?.textContent??null,ap:document.getElementById('sm-ap')?.textContent??null}:null})()`);
    const state = () => E(`({phase:__rts.phase(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),map:__rts.map(),rules:__rts.log().filter(c=>c.tick===0&&c.cmd.t==='rules').map(c=>c.cmd),log:__rts.log()})`);
    const geometry = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const bounces = () => E('__rts.report().data.bounces ?? null');

    // ---- 共用的檢查 ----
    const toggles = async (extra = '') => {
      await opened(extra); await press('sm-setup');
      let m = await menu();
      assert(m.ids.includes('sm-ap') && !m.pressed.includes('sm-ap') && m.ap.includes('關'), `toggle: the setup page has the armour switch, off by default (${m.ap})`);
      assert.deepEqual((await state()).rules, [], 'fixture: no rules command before the switch is pressed');
      await press('sm-ap');
      const s = await state(); m = await menu();
      assert.deepEqual(s.rules, [{ t: 'rules', ap: 1 }], 'toggle: the switch puts ap into the tick-0 rules command');
      assert(m.pressed.includes('sm-ap') && m.ap.includes('開') && s.phase === 'build' && s.tick === 0, 'toggle: the switch shows as on and the game is back at build step 0');
      return s;
    };
    // 大地圖：開戰、叫我方六輛中坦克去打敵方重坦克，走到我方有一發被彈開為止（或走滿 limit 步）
    const fight = async (q, limit = 3000) => {
      await open(q); await frames();
      assert.equal(await E('__rts.map()'), MAP_LARGE, 'fixture: the large map is up');
      await E(`(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'attack', side: 0, ids: [1, 2, 3, 4, 5, 6], target: ${HEAVY} }); })()`);
      const kinds = await E(`__rts.units().filter(u => u.id === ${HEAVY} || u.id === 1).map(u => u.kind)`);
      assert.deepEqual(kinds, [0, UK_HEAVY], 'fixture: unit 1 is a medium tank and the target is an enemy heavy tank');
      let b = null;
      for (let i = 0; i < limit / 50 && !(b && b[0] > 0); i++) { await E('__rts.stepN(50)'); b = await bounces(); }
      return { bounces: b, tick: await E('__rts.tick()') };
    };
    const counted = async (extra = '') => {
      const r = await fight(`${BIG}&ap=1${extra}`);
      assert(r.bounces && r.bounces[0] > 0, `battle: the report counts the player's bounced shots (${JSON.stringify(r.bounces)} by tick ${r.tick})`);
      return r;
    };
    const valveOff = async (extra = '') => {
      await opened(`noR051=1&ap=1${extra}`); await press('sm-setup');
      const m = await menu(), s = await state();
      assert(!m.ids.includes('sm-ap'), 'valve: noR051 removes the switch');
      assert.deepEqual(s.rules, [], 'valve: noR051 ignores ?ap=1');
    };

    // ---- 正向：開關、設定鍵上的字、網址 ----
    const viaMenu = await toggles();
    await shot(page, path.join(SHOTS, 'r051-phone-setup.png'));
    for (const [w, h, m] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) { await size(w, h, m); assert.deepEqual(await geometry(), [], `layout: setup page with the rules row ${w}×${h} every key is a whole, unclipped, reachable 44px target`); }
    await size(860, 412, true); await shot(page, path.join(SHOTS, 'r051-landscape-setup.png'));
    await size(412, 915, true);
    await press('sm-setup-done');
    assert.equal((await menu()).setup, '遭遇戰設定兵力 標準 · 補給 標準 · 種子 1944 · 穿甲', 'toggle: the setup key on the start page says the rule is on');
    await open('ap=1'); await frames();
    const viaUrl = await state();
    assert.deepEqual([viaUrl.hash, viaUrl.log, viaUrl.seed, viaUrl.map], [viaMenu.hash, viaMenu.log, viaMenu.seed, viaMenu.map], 'url: ?ap=1 opens the same game as the switch');
    await opened(); await press('sm-setup'); await press('sm-ap'); await press('sm-ap');
    let s = await state(), m = await menu();
    assert(s.rules.length === 0 && !m.pressed.includes('sm-ap'), 'toggle: pressing again turns the rule off and the rules command disappears');
    await press('sm-setup-done');
    assert.equal((await menu()).setup, '遭遇戰設定兵力 標準 · 補給 標準 · 種子 1944', 'toggle: the setup key drops the mark');

    // ---- 實戰：中坦克打重坦克，彈開；戰報有數字；沒開規則時沒有 ----
    const on = await counted();
    // 特寫：同一場仗再打一次（決定性，結果一樣），先走到跳彈前五十步，再一步一步走到彈開的那一步，鏡頭對準那輛重坦克
    await open(`${BIG}&ap=1&noR016=1`); await frames();
    await E(`(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'attack', side: 0, ids: [1, 2, 3, 4, 5, 6], target: ${HEAVY} }); __rts.stepN(${Math.max(1, on.tick - 60)}); })()`);
    const early = await bounces();
    assert(!early || early[0] === 0, 'fixture: none of the player\'s shots has bounced yet sixty steps before the first one');
    let at = -1;
    for (let i = 0; i < 80 && at < 0; i++) { await E('__rts.stepN(1)'); const b = await bounces(); if (b && b[0] > 0) at = await E('__rts.tick()'); }
    assert(at > 0 && at <= on.tick, `fixture: the same battle bounces at the same moment again (tick ${at}, first seen by tick ${on.tick})`);
    const target = await E(`(() => { const us = __rts.units(), tanks = us.filter(u => u.side === 0 && u.kind === 0 && u.alive), heavies = us.filter(u => u.side === 1 && u.kind === ${UK_HEAVY} && u.alive); let best = heavies[0], d = Infinity; for (const h of heavies) for (const t of tanks) { const q = (h.x - t.x) ** 2 + (h.z - t.z) ** 2; if (q < d) { d = q; best = h; } } return best ? [best.x / ${SUB}, best.z / ${SUB}] : null; })()`);
    assert(target, 'fixture: an enemy heavy tank is still alive after the bounce');
    await E(`__rts.focus(${target[0]}, ${target[1]}, 2.6)`); await E('__rts.stepN(1)'); await frames(); await sleep(200); await frames();
    await shot(page, path.join(SHOTS, 'r051-phone-bounce.png'));
    await E('__rts.pause(false)');
    const off = await fight(BIG, on.tick);
    assert.equal(off.bounces, null, `battle: without the rule nothing bounces and the report has no such row (${JSON.stringify(off.bounces)} by tick ${off.tick})`);
    assert(off.tick >= on.tick, 'fixture: the comparison battle ran at least as long');
    // 帶 ap 的紀錄重播：閥開、閥關結果相同
    await open(`${BIG}&ap=1`); await frames();
    await E(`(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'attack', side: 0, ids: [1, 2, 3, 4, 5, 6], target: ${HEAVY} }); __rts.stepN(${Math.min(on.tick + 20, 900)}); })()`);
    const rec = await state();
    assert(rec.rules.length === 1 && rec.rules[0].ap === 1, 'fixture: the recorded battle carries the ap rule');
    const replayOn = await E(`__rts.playLog(${rec.seed}, ${JSON.stringify(rec.log)}, ${rec.tick})`);
    assert.equal(replayOn, rec.hash, 'replay: a battle with the rule equals replaying its own log');

    // ---- 記憶（R073）與恢復預設 ----
    await opened(); await press('sm-setup'); await press('sm-ap'); await press('sm-setup-done');
    await opened('', true);
    m = await menu(); s = await state();
    assert(m.setup.endsWith('· 穿甲') && s.rules.length === 1 && s.rules[0].ap === 1, `memory: the rule is still on after reopening the page (${m.setup})`);
    await press('sm-setup'); await press('sm-setup-reset');
    s = await state(); m = await menu();
    assert(s.rules.length === 0 && !m.pressed.includes('sm-ap'), 'memory: 恢復預設 turns the rule off');

    // ---- 預算：開著規則的大地圖開局 ----
    await size(412, 860, true);
    await open('map=64&ap=1'); await frames();
    const withRule = await E('__rts.info()');
    await open('map=64'); await frames();
    const without = await E('__rts.info()');
    assert(withRule.calls <= 20 && withRule.triangles <= 80000, `budget: large map with the rule ${withRule.calls} calls / ${withRule.triangles} triangles`);
    assert.deepEqual([withRule.calls, withRule.triangles], [without.calls, without.triangles], 'budget: the rule costs nothing at the opening');
    console.log(`  鄉間開著規則開局 412×860：${withRule.calls} calls / ${withRule.triangles} triangles`);
    await size(412, 915, true);

    // ---- 逃生閥 ----
    await valveOff();
    assert.equal(await E(`__rts.playLog(${rec.seed}, ${JSON.stringify(rec.log)}, ${rec.tick})`), rec.hash, 'valve: a log with the ap rule replays the same with the valve off');
    assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R051: switch, setup key, address, four sizes, bounce in battle (first by tick ${on.tick}, ${JSON.stringify(on.bounces)}), no bounce without the rule, replay, memory, reset, budget, valve`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['toggle', async () => { await toggles('__r051mutant=toggle'); }, 'toggle: the switch puts ap into the tick-0 rules'],
      ['report', async () => { await counted('&__r051mutant=report'); }, "battle: the report counts the player's bounced shots"],
      ['valve', async () => { await valveOff('&__r051mutant=valve'); }, 'valve: noR051 removes the switch'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R051 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R051 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R051 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
