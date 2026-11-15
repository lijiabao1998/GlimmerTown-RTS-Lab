// R078 難度校正（電腦第三版）：真實 Chrome（手機觸控 412×915）。開戰送的 ai 指令帶 v＝3、逃生閥送 2、第三版打到一半存檔接回（R074）跟 Node 一致、
// 帶 v＝2 的舊重播照樣播而且雜湊對得上、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { REPLAY_KEY, makeRecord, decodeReplay } from '../src/ui/replayStore.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r078-browser-'));
const SAME = '重播結束 · 跟原局相同';
// 故意弄壞（只編進 broken 那一份，網址帶 __r078mutant 才生效）。main.ts 那一段出現兩次，兩處一起改
const mutations = {
  second: ['src/main.ts', '{ v: V.r078 ? 3 : 2 }', "{ v: V.r078 && !location.search.includes('__r078mutant=second') ? 3 : 2 }", 2],
  valve: ['src/valves.ts', "get r078() { return on('078'); }", "get r078() { return on('078') || location.search.includes('__r078mutant=valve'); }", 1],
};
const applied = new Set();
const plugin = { name: 'r078-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));

// 一筆 R057 之後、這張卡之前的重播：ai 指令帶 v＝2（只有前 300 步）
function secondVersionReplay() {
  const seed = 1944, log = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 2 }].map(cmd => ({ tick: 0, cmd }));
  const w = runLog(createWorld(seed), log, 300), rec = makeRecord(seed, 300, hashWorld(w), log, { map: 1, n: w.n, winner: -1, seconds: 15 }, '2026-11-16T00:00:00.000Z');
  assert(decodeReplay(JSON.stringify(rec)).ok && w.ai.every(a => a.v === 2), 'fixture: a well-formed replay whose computers are the second version');
  return rec;
}

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {}, rec = secondVersionReplay();
  await withBrowser({ root: baseline, overlay, port: 8525, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => { const r = await rect(id); assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`); await touchTap(page, r.x, r.y); await frames(); };
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const state = () => E(`({tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),log:__rts.log()})`);
    const aiCmds = async () => (await E('__rts.log()')).filter(c => c.cmd.t === 'ai').map(c => c.cmd);

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const sendsThird = async (extra = '') => {
      await opened(extra); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await aiCmds(), [{ t: 'ai', side: SIDE_ENEMY, level: 2, v: 3 }], 'start: a new battle hands the enemy to the third-version computer');
    };
    const valved = async (extra = '') => {
      await opened(`noR078=1${extra}`); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await aiCmds(), [{ t: 'ai', side: SIDE_ENEMY, level: 2, v: 2 }], 'valve: noR078 starts the second-version computer');
    };

    // ---- 正向 ----
    await sendsThird();
    // 我方也交給第三版，打一段：瀏覽器跟 Node 一致；離開頁面、接回來，接著打等於沒中斷（電腦的記憶與佇列都回來了）
    await E("(() => { __rts.issue({ t: 'ai', side: 0, level: 3, v: 3 }); __rts.stepN(400); })()");
    const before = await state();
    assert.equal(node(before.seed, before.log, before.tick), before.hash, 'battle: Node reproduces a third-version battle from its log');
    await opened('', true); await press('sm-continue');
    const back = await state();
    assert.deepEqual([back.tick, back.hash], [before.tick, before.hash], 'save: a battle against the third-version computer resumes at the same step');
    await E('__rts.stepN(200)');
    assert.equal(await E('__rts.hash()'), node(before.seed, before.log, before.tick + 200), 'save: and continues like the uninterrupted battle');
    await valved();
    // 帶 v＝2 的舊重播：照第二版播，雜湊對得上
    await opened(); await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([rec]))})`);
    await opened('', true);
    await press('sm-replays'); await press('rpl-watch-0');
    await E('__rts.pause(true)');
    await E(`__rts.stepN(${rec.ticks} - __rts.tick())`);
    assert.equal(await E('__rts.hash()'), rec.hash, 'replay: a second-version replay plays back to the same hash');
    await E('__rts.stepN(1)');
    assert.equal(await E("document.getElementById('replay-text')?.textContent ?? ''"), SAME, 'replay: and the player is told it matches the original');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R078: version 3 sent, ${before.tick} steps equal to Node, save and resume, valve, second-version replay unchanged`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['second', async () => { await sendsThird('__r078mutant=second'); }, 'start: a new battle hands the enemy to the third-version computer'],
      ['valve', async () => { await valved('&__r078mutant=valve'); }, 'valve: noR078 starts the second-version computer'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R078 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R078 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R078 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
