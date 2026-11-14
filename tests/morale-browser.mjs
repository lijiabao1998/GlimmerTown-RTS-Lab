// R052 士氣與壓制：真實 Chrome（手機觸控 412×915；版面另量三個尺寸）。設定頁的開關、網址、記憶與恢復預設、
// 實戰裡畫面上的壓制標記跟世界對得上、開著規則存檔接回（R074）、逃生閥、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, shot, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r052-browser-'));
const SHOTS = path.join(ROOT, 'shots');
// 故意弄壞（只編進 broken 那一份，網址帶 __r052mutant 才生效）
const mutations = {
  toggle: ['src/ui/startMenu.ts', "    else if (sk && id === 'sm-morale') { sk.set({ morale: !sk.morale }); fresh = true; }", "    else if (sk && id === 'sm-morale') { if (!location.search.includes('__r052mutant=toggle')) sk.set({ morale: !sk.morale }); fresh = true; }"],
  nomarks: ['src/render/healthBars.ts', '      if (ms) this.pips9(', "      if (ms && !location.search.includes('__r052mutant=nomarks')) this.pips9("],
  valve: ['src/ui/skirmish.ts', '  const canMorale = valves(q).r052, keptMorale', "  const canMorale = valves(q).r052 || location.search.includes('__r052mutant=valve'), keptMorale"],
};
const applied = new Set();
const plugin = { name: 'r052-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, 1, `negative anchor: ${name}`);
    code = code.replace(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));
const stateOf = sup => (sup >= 90 ? 3 : sup >= 60 ? 2 : sup >= 30 ? 1 : 0);

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8507, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let mobile = true;
    const size = async (w, h, m = true) => { mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await sleep(120); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    const menu = () => E(`(()=>{const m=document.getElementById('start-menu');return m?{open:!m.hidden,ids:[...m.querySelectorAll('button, input')].map(b=>b.id),pressed:[...m.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id),setup:document.getElementById('sm-setup')?.textContent??null,morale:document.getElementById('sm-morale')?.textContent??null}:null})()`);
    const state = () => E(`({phase:__rts.phase(),paused:__rts.paused(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),winner:__rts.winner(),rules:__rts.log().filter(c=>c.tick===0&&c.cmd.t==='rules').map(c=>c.cmd),log:__rts.log()})`);
    const offenders = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    // 畫面上實際畫了幾個壓制標記（世界裡該有幾個：受壓 1、釘住 2、潰退 3，在 marks() 裡算）
    const drawn = async () => { await frames(); return (await E('__rts.bars()')).pips; };
    let lastCalls = 0;   // marks() 走到那一步時這一幀的繪製呼叫數（有標記與沒有標記的兩次要一樣）

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const toggles = async (extra = '') => {
      await opened(extra); await press('sm-setup');
      let m = await menu(), s = await state();
      assert(m.ids.includes('sm-ap') && m.ids.includes('sm-morale') && !m.pressed.includes('sm-morale') && m.morale.includes('關') && s.rules.length === 0, `toggle: the setup page has the morale switch next to the armour switch, off by default (${m.morale})`);
      await press('sm-morale');
      m = await menu(); s = await state();
      assert.deepEqual(s.rules, [{ t: 'rules', morale: 1 }], 'toggle: the switch puts morale into the tick-0 rules command');
      assert(m.pressed.includes('sm-morale') && m.morale.includes('開') && s.phase === 'build' && s.tick === 0, 'toggle: the switch shows as on and the game is back at build step 0');
    };
    // 開著規則、看得到全場（沒有戰場迷霧）、雙方電腦：走到有人被壓制為止，畫面上的標記數要等於世界裡該有的
    const marks = async (extra = '') => {
      await opened(`morale=1&noR100=1${extra}`); await press('sm-start');
      await E("(() => { __rts.startBattle(); __rts.pause(true); __rts.issue({ t: 'ai', side: 0, level: 3 }); })()");
      let want = 0, seen = [0, 0, 0, 0];
      for (let i = 0; i < 80 && (await E('__rts.winner()')) < 0; i++) {
        await E('__rts.stepN(25)');
        const us = await E('__rts.units().filter(u => u.alive)');
        for (const u of us) seen[stateOf(u.sup)]++;
        want = us.reduce((n, u) => n + stateOf(u.sup), 0);
        if (want >= 2) break;
      }
      assert(want >= 2, `fixture: somebody is suppressed within 2000 steps (${want})`);
      await frames(); lastCalls = (await E('__rts.info()')).calls;
      assert.equal(await drawn(), want, 'marks: the suppression marks on screen match the units that are suppressed');
      return seen;
    };
    const valved = async (extra = '') => {
      await opened(`noR052=1&morale=1${extra}`); await press('sm-setup');
      const m = await menu(), s = await state();
      assert(m.ids.includes('sm-ap') && !m.ids.includes('sm-morale'), 'valve: noR052 removes the switch');
      assert.equal(s.rules.length, 0, 'valve: noR052 ignores ?morale=1');
    };

    // ---- 正向 ----
    await toggles();
    for (const [w, h, mob] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
      await size(w, h, mob);
      const off = await offenders();
      assert.deepEqual(off, [], `layout: with the morale switch every key of the setup page is a whole reachable 44px target without scrolling at ${w}×${h} (${JSON.stringify(off)})`);
    }
    await size(412, 915, true); await shot(page, path.join(SHOTS, 'r052-phone-setup.png'));
    await press('sm-setup-done');
    let m = await menu();
    assert(m.setup.includes('士氣'), `toggle: the setup summary says so (${m.setup})`);
    // 記得住；恢復預設會關
    await opened('', true);
    m = await menu(); let s = await state();
    assert(m.setup.includes('士氣') && s.rules[0]?.morale === 1, 'memory: reopening the page keeps the rule on');
    await press('sm-setup'); await press('sm-setup-reset');
    m = await menu(); s = await state();
    assert(!m.pressed.includes('sm-morale') && s.rules.length === 0, 'memory: 恢復預設 turns the rule off');
    // 再按一次關掉；兩顆一起開
    await opened(); await press('sm-setup'); await press('sm-morale'); await press('sm-morale');
    s = await state();
    assert.equal(s.rules.length, 0, 'toggle: pressing again turns the rule off and the rules command disappears');
    await press('sm-ap'); await press('sm-morale');
    s = await state();
    assert.deepEqual(s.rules, [{ t: 'rules', ap: 1, morale: 1 }], 'toggle: both realism rules can be on together');
    // 網址
    await opened('morale=1');
    m = await menu(); s = await state();
    assert(s.rules[0]?.morale === 1 && m.setup.includes('士氣'), '?morale=1: the address turns the rule on');
    console.log('OK R052: switch, four sizes, summary, memory, 恢復預設, both rules, address');

    // 實戰：標記
    const seen = await marks(), info = { calls: lastCalls };
    assert(info.calls > 0 && info.calls <= 22, `marks: draw calls stay within the phone budget (${info.calls})`);
    // 鏡頭湊近一個被壓制的單位拍一張
    const near = await E('__rts.units().filter(u => u.alive && u.sup >= 30).sort((a, b) => b.sup - a.sup)[0]');
    await E(`__rts.focus(${near.x / 256}, ${near.z / 256}, 2.4)`); await frames(); await sleep(200);
    await shot(page, path.join(SHOTS, 'r052-phone-suppressed.png'));
    // R074：開著規則、有人被壓制的時候存檔，重新開頁接回來
    const before = await state(), supBefore = await E('__rts.units().map(u => u.sup)');
    assert(supBefore.some(x => x > 0) && before.winner < 0, 'fixture: a battle in progress with suppressed units');
    assert.equal(node(before.seed, before.log, before.tick), before.hash, 'fixture: Node reproduces this battle from its log');
    await opened('', true);
    await press('sm-continue');
    s = await state();
    assert.deepEqual([s.tick, s.hash, await E('__rts.units().map(u => u.sup)')], [before.tick, before.hash, supBefore], 'save: a battle saved with suppressed units resumes at the same step with the same suppression');
    await E('__rts.stepN(100)');
    assert.equal(await E('__rts.hash()'), node(before.seed, before.log, before.tick + 100), 'save: and continues like the uninterrupted battle');
    // 逃生閥
    await valved();
    assert.equal(await E('__rts.runScript()'), JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/golden.json'), 'utf8')).hash, 'valve: golden hash unchanged');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R052: marks match the world (unit-samples by state ${seen.join('/')}), ${info.calls} draw calls, save and resume with suppression, valve`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['toggle', async () => { await toggles('__r052mutant=toggle'); }, 'toggle: the switch puts morale into the tick-0 rules command'],
      ['nomarks', async () => { await marks('&__r052mutant=nomarks'); }, 'marks: the suppression marks on screen match'],
      ['valve', async () => { await valved('&__r052mutant=valve'); }, 'valve: noR052 removes the switch'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R052 ${name}: ${failure.message.split('\n')[0]}`);
      if (name === 'nomarks') assert.equal(lastCalls, info.calls, 'marks: drawing the marks adds no draw call (same battle, same step, with the marks and without)');
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R052 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R052 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
