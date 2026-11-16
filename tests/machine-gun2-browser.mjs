// R081 機槍組第二版：真實 Chrome（手機觸控 412×915）。新開的局 eco 帶 mg＝2、逃生閥送 mg＝1；
// 開局的步兵班與機槍組疊在同一點：點那個位置選到其中一個，隔一下再點同一個位置換到另一個（提示列寫「機槍組 1」）；很快地連點兩下不換；
// 選著步兵班時很快地連點兩下：第一下照常換到機槍組、第二下留在它身上（R081 複查：雙擊跟車照舊跟得到）；逃生閥關掉換選；故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, ROOT } from '../tools/cdp.mjs';
import { SIDE_PLAYER, UK_MG, UK_INFANTRY } from '../src/sim/world.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r081-browser-'));
// 故意弄壞（只編進 broken 那一份，網址帶 __r081mutant 才生效）
const mutations = {
  flag: ['src/main.ts', '...(V.r080 ? { mg: V.r081 ? 2 : 1 } : {}) });', "...(V.r080 ? { mg: V.r081 && !location.search.includes('__r081mutant=flag') ? 2 : 1 } : {}) });", 1],
  // 同一段原文的三種弄壞：__r081mutant=nocycle 不換、__r081mutant=nogate 連點也換、__r081mutant=nokeep 連點的第二下不留在第一下選到的
  cycle: ['src/main.ts', 'V.r081 && t !== undefined ? (t - lastTap.t >= 350 ? { selected } : { keep: lastTap.id }) : undefined', "V.r081 && t !== undefined ? ((t - lastTap.t >= 350 || location.search.includes('__r081mutant=nogate')) ? (location.search.includes('__r081mutant=nocycle') ? {} : { selected }) : (location.search.includes('__r081mutant=nokeep') ? {} : { keep: lastTap.id })) : undefined", 1],
};
const applied = new Set();
const plugin = { name: 'r081-dormant-negatives', enforce: 'pre', transform(code, id) {
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
  await withBrowser({ root: baseline, overlay, port: 8665, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const press = async id => { const r = await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await touchTap(page, r[0], r[1]); await frames(); };
    // 開一局、開戰、暫停；回傳 eco 指令與我方疊著的步兵班、機槍組
    const battle = async (q = '') => {
      await open(q, { menu: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames();
      await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco')?.cmd, units = await E('__rts.units()');
      const inf = units.find(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_INFANTRY), mg = units.find(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_MG);
      return { eco, inf, mg };
    };
    // 鏡頭拉近對著疊著的那一點，回傳螢幕座標
    const aim = async b => {
      assert(b.inf && b.mg && b.inf.x === b.mg.x && b.inf.z === b.mg.z, 'fixture: the opening squad and machine-gun team stand on the same point');
      await E(`__rts.focus(${b.mg.x / 256}, ${b.mg.z / 256}, 1.8)`); await frames(); await frames();
      return E(`__rts.screenOf(${b.mg.id})`);
    };
    const hint = () => E("document.getElementById('hint').textContent");
    // 點一下：事件時間（CDP 的 timestamp）照表——按下 base+at、放手 base+at+40（R037 的作法，不跟著機器忙不忙變）。
    // 等兩個時間都過了才一起送，不等按下的回應再送放手：機器忙的時候，按下與放手之間的真實時間超過 0.5 秒會被當成長按（R109 的計時器用真實時間）
    const tapAt = async (x, y, at, base) => {
      const wait = base + at + 40 - Date.now();
      if (wait > 0) await sleep(wait);
      await Promise.all([
        page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }], timestamp: (base + at) / 1000 }),
        page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: (base + at + 40) / 1000 }),
      ]);
      await frames();
    };
    // 同一個位置點兩下，兩次放手的事件時間相隔 gap 毫秒。回傳兩次之後各選到什麼
    const twice = async (x, y, gap) => {
      const base = Date.now();
      await tapAt(x, y, 0, base);
      const first = await selected();
      await tapAt(x, y, gap, base);
      return [first, await selected()];
    };
    const selected = () => E('__rts.selected()');

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const sendsSecond = async (extra = '') => {
      const b = await battle(extra);
      assert.equal(b.eco?.mg, 2, 'start: a new battle sends the second machine-gun version');
      return b;
    };
    // 點一下、隔 1.2 秒再點同一個位置：換到另一個；提示列寫機槍組
    const cycles = async (extra = '') => {
      const b = await battle(extra), [x, y] = await aim(b);
      const [first, second] = await twice(x, y, 1200);   // 隔 1.2 秒（遠大於 0.35 秒：機器忙、第一下處理得晚也不會被當成連點）
      assert(first.length === 1 && [b.inf.id, b.mg.id].includes(first[0]), `fixture: the first tap selects one of the two (${first})`);
      assert(second.length === 1 && second[0] !== first[0] && [b.inf.id, b.mg.id].includes(second[0]), `pick: tapping the same spot again selects the other unit stacked there (${first} then ${second})`);
      assert.equal(second[0], b.mg.id, 'fixture: the first tap goes to the infantry (the lower id on a tie), so the second one selects the machine-gun team');
      await E('__rts.pause(false)'); await frames(); await E('__rts.pause(true)');
      const mgSelected = await hint();
      assert(mgSelected.includes('機槍組 1') && !mgSelected.includes('進駐'), `pick: with the machine-gun team selected the hint names it (${mgSelected})`);
    };
    // 很快地連點兩下（0.1 秒）：不換（雙擊是鏡頭跟過去）
    const quick = async (extra = '') => {
      const b = await battle(extra), [x, y] = await aim(b);
      const [first, second] = await twice(x, y, 150);
      assert.deepEqual(second, first, 'pick: a quick double tap keeps the same unit (it is the camera-follow gesture)');
    };
    // 選著步兵班，隔 1.2 秒很快地連點兩下（0.15 秒）：第一下換到機槍組，第二下留在機槍組（雙擊是鏡頭跟過去，跟的是第一下選到的）
    const quickSelected = async (extra = '') => {
      const b = await battle(extra), [x, y] = await aim(b), base = Date.now();
      await tapAt(x, y, 0, base);
      assert.deepEqual(await selected(), [b.inf.id], 'fixture: the first tap selects the infantry');
      await tapAt(x, y, 1200, base);
      await tapAt(x, y, 1350, base);
      assert.deepEqual(await selected(), [b.mg.id], 'pick: a double tap on the selected stack stays on the unit its first tap chose');
    };
    const valved = async (extra = '') => {
      const b = await battle(`noR081=1${extra}`);
      assert.equal(b.eco?.mg, 1, 'valve: noR081 sends the first machine-gun version');
      const [x, y] = await aim(b), [first, second] = await twice(x, y, 1200);
      assert.deepEqual(second, first, 'valve: and taps do not cycle');
    };

    // ---- 正向 ----
    await sendsSecond();
    await cycles();
    await quick();
    await quickSelected();
    await valved();
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R081: mg 2 sent, a second tap on the stack selects the other unit, a quick double tap does not (and on the selected stack stays on the unit of its first tap), valve');

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['flag', async () => { await sendsSecond('__r081mutant=flag'); }, 'start: a new battle sends the second machine-gun version'],
      ['nocycle', async () => { await cycles('__r081mutant=nocycle'); }, 'pick: tapping the same spot again selects the other unit'],
      ['nogate', async () => { await quick('__r081mutant=nogate'); }, 'pick: a quick double tap keeps the same unit'],
      ['nokeep', async () => { await quickSelected('__r081mutant=nokeep'); }, 'pick: a double tap on the selected stack stays on the unit its first tap chose'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R081 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R081 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R081 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
