// R076 擬真／經典：真實 Chrome。設定頁是一個選擇、預設亮的是判準決定的那個（現在是經典）、選了送出對的規則、記得住、恢復預設、
// 舊網址只開一條時兩個都不亮、帶設定的網址照舊、四個尺寸、逃生閥、守衛預設帶 noR076=1（tools/cdp.mjs）、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, ROOT } from '../tools/cdp.mjs';
import { SETUP_KEY, DEFAULT_REALISM } from '../src/ui/skirmish.ts';
import { mixedNote, rulesNote } from '../src/ui/startMenu.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r076-browser-'));
const REAL = { t: 'rules', ap: 1, morale: 2 };
const DEFAULT_ID = DEFAULT_REALISM ? 'sm-real' : 'sm-classic', DEFAULT_RULES = DEFAULT_REALISM ? [REAL] : [];
// 故意弄壞（只編進 broken 那一份，網址帶 __r076mutant 才生效）
const mutations = {
  nochoice: ['src/ui/startMenu.ts', "sk.choose(id === 'sm-real');", "sk.choose(id === 'sm-real' && !location.search.includes('__r076mutant=nochoice'));", 1],
  forgets: ['src/ui/skirmish.ts', '...(chosen ? { rules: 1 as const } : {}) }, text', "...(chosen && !location.search.includes('__r076mutant=forgets') ? { rules: 1 as const } : {}) }, text", 1],
  summary: ['src/ui/startMenu.ts', 'v.setup.ap, v.setup.morale, v.setup.merged)', "v.setup.ap, v.setup.morale, v.setup.merged && !location.search.includes('__r076mutant=summary'))", 1],
  valve: ['src/valves.ts', "get r076() { return on('076'); }", "get r076() { return on('076') || location.search.includes('__r076mutant=valve'); }", 1],
};
const applied = new Set();
const plugin = { name: 'r076-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8521, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    let mobile = true;
    const size = async (w, h, m = true) => { mobile = m; await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: m, maxTouchPoints: 5 }); await frames(); };
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => {
      const r = await rect(id);
      assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`);
      if (mobile) await touchTap(page, r.x, r.y);
      else { for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); }
      await frames();
    };
    // 這支守衛每一頁都要「擬真／經典」那個版面：realism: true（不讓 open() 自動加 noR076=1）
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep, realism: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const rules = async () => (await E('__rts.log()')).filter(c => c.tick === 0 && c.cmd.t === 'rules').map(c => c.cmd);
    const row = () => E(`(()=>{const r=document.getElementById('sm-rules');return r?{ids:[...r.querySelectorAll('button')].map(b=>b.id),pressed:[...r.querySelectorAll('button[aria-pressed="true"]')].map(b=>b.id),title:r.querySelector('h2')?.textContent??'',note:r.querySelector('.sm-note')?.textContent??null}:null})()`);
    const summary = () => E("document.getElementById('sm-setup')?.textContent ?? ''");
    const saved = () => E(`JSON.parse(localStorage.getItem(${JSON.stringify(SETUP_KEY)}) ?? 'null')`);
    const offenders = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const begin = async () => { await press('sm-start'); await E('(() => { __rts.startBattle(); __rts.pause(true); })()'); };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    // 選「擬真」：亮起來、回到布陣第 0 步、送出兩條規則、摘要寫擬真、存下來的是「選過的」
    const chooses = async (extra = '') => {
      await opened(extra); await press('sm-setup'); await press('sm-real');
      const r = await row();
      assert.deepEqual([r.pressed, await rules(), await E('__rts.phase()'), await E('__rts.tick()')], [['sm-real'], [REAL], 'build', 0], 'choice: pressing 擬真 lights it and sends both rules, back at build step 0');
      await press('sm-setup-done');
      assert((await summary()).includes('擬真'), `summary: the start menu says 擬真 (${await summary()})`);
      await begin();
      const s = await saved();
      assert.deepEqual([s?.ap, s?.morale, s?.rules], [1, 1, 1], `memory: the choice is stored as a choice (${JSON.stringify(s)})`);
    };
    const valved = async (extra = '') => {
      await opened(`noR076=1${extra}`); await press('sm-setup');
      const r = await row();
      assert.deepEqual([r.ids, r.pressed, r.title], [['sm-ap', 'sm-morale'], [], '擬真規則'], 'valve: noR076 brings back the two switches, both off');
    };

    // ---- 正向 ----
    // 乾淨的瀏覽器、不帶參數：一個選擇，亮的是判準決定的那個；直接開局，規則相符
    await opened(); await press('sm-setup');
    let r = await row();
    assert.deepEqual([r.ids, r.pressed, r.title, r.note], [['sm-real', 'sm-classic'], [DEFAULT_ID], '規則', rulesNote(true, true)], 'default: a clean page shows one choice of two with the default lit and the rules explained');
    await press('sm-setup-done');
    assert((await summary()).includes(DEFAULT_REALISM ? '擬真' : '經典'), `summary: the start menu names the default (${await summary()})`);
    await begin();
    assert.deepEqual(await rules(), DEFAULT_RULES, 'default: a battle started without touching the choice uses the default rules');
    assert.equal((await saved())?.rules, undefined, 'default: and that does not count as having chosen');
    // 選擬真 → 記得住 → 恢復預設
    await chooses();
    await opened('', true); await press('sm-setup');
    assert.deepEqual((await row()).pressed, ['sm-real'], 'memory: the next visit still has 擬真 lit');
    await press('sm-setup-reset');
    assert.deepEqual([(await row()).pressed, await rules()], [[DEFAULT_ID], DEFAULT_RULES], '恢復預設: the rules go back to the default');
    await press('sm-setup-done'); await begin();
    assert.equal((await saved())?.rules, undefined, '恢復預設: and the remembered choice is forgotten');
    // 選經典也是選過的
    await opened(); await press('sm-setup'); await press('sm-real'); await press('sm-classic');
    assert.deepEqual([(await row()).pressed, await rules()], [['sm-classic'], []], 'choice: pressing 經典 lights it and sends no rules');
    await press('sm-setup-done'); await begin();
    assert.deepEqual([(await saved())?.rules, (await saved())?.ap], [1, undefined], 'memory: 經典 chosen on purpose is stored as a choice');
    // 舊網址只開一條：兩個都不亮、說明寫為什麼、照原樣開局
    await opened('ap=1'); await press('sm-setup');
    r = await row();
    assert.deepEqual([r.pressed, r.note], [[], `${mixedNote(true)}\n${rulesNote(true, true)}`], 'old link: with only armour on neither is lit and the note says why');
    await press('sm-setup-done');
    assert((await summary()).includes('穿甲') && !(await summary()).includes('擬真'), 'old link: the summary still says 穿甲');
    await begin();
    assert.deepEqual(await rules(), [{ t: 'rules', ap: 1 }], 'old link: and the battle has exactly that rule');
    // 帶了別的設定的網址：照舊是經典
    await opened('seed=7'); await press('sm-setup');
    assert.deepEqual((await row()).pressed, ['sm-classic'], 'old link: an address with a seed and no rules is classic, as before');
    // 四個尺寸
    for (const [w, h, mob] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
      await size(w, h, mob);
      await opened(); await press('sm-setup');
      const off = await offenders();
      assert.deepEqual(off, [], `layout: at ${w}×${h} every control on the setup page is a reachable 44px target (${JSON.stringify(off)})`);
      await press('sm-real'); await press('sm-classic');
      assert.deepEqual((await row()).pressed, ['sm-classic'], `layout: at ${w}×${h} both buttons can be pressed`);
    }
    await size(412, 915, true);
    await valved();
    // 守衛的預設：open() 不傳 realism 就自動帶 noR076=1（既有守衛照舊看到兩顆開關）；傳了就不帶
    await open('', { menu: true }); await frames();
    assert((await E('location.search')).includes('noR076=1'), 'harness: by default a guard page carries noR076=1');
    await open('', { menu: true, realism: true }); await frames();
    assert(!(await E('location.search')).includes('noR076'), 'harness: a guard that asks for the single choice gets the plain address');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R076: one choice with ${DEFAULT_ID} lit by default, choosing, remembering, resetting, old links, four sizes, valve, harness default`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nochoice', async () => { await chooses('__r076mutant=nochoice'); }, 'choice: pressing 擬真 lights it and sends both rules'],
      ['summary', async () => { await chooses('__r076mutant=summary'); }, 'summary: the start menu says 擬真'],
      ['forgets', async () => { await chooses('__r076mutant=forgets'); }, 'memory: the choice is stored as a choice'],
      ['valve', async () => { await valved('&__r076mutant=valve'); }, 'valve: noR076 brings back the two switches'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R076 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R076 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R076 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
