// R057 電腦對手 v2：真實 Chrome（手機觸控 412×915）。開戰送的 ai 指令帶不帶版本、逃生閥、不帶版本的舊重播照樣播得完而且雜湊對得上、
// 開著第二版存檔接回（R074）、雙方第二版打到分出勝負而且跟 Node 一致、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { REPLAY_KEY, makeRecord, decodeReplay } from '../src/ui/replayStore.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r057-browser-'));
const SAME = '重播結束 · 跟原局相同';
// 故意弄壞（只編進 broken 那一份，網址帶 __r057mutant 才生效）。main.ts 那一段出現兩次，兩處一起改
const mutations = {
  nov: ['src/main.ts', '...(V.r057 ? { v: 2 } : {})', "...(V.r057 && !location.search.includes('__r057mutant=nov') ? { v: 2 } : {})", 2],
  valve: ['src/valves.ts', "get r057() { return on('057'); }", "get r057() { return on('057') || location.search.includes('__r057mutant=valve'); }", 1],
};
const applied = new Set();
const plugin = { name: 'r057-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));

// 一筆「這張卡之前」的重播：ai 指令不帶版本。精簡兵力、沒有指揮部、雙方第一版，幾百步就分出勝負
function oldReplay() {
  const seed = 1944, log = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', force: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 3 }].map(cmd => ({ tick: 0, cmd }));
  const w = createWorld(seed);
  step(w, log.map(c => c.cmd));
  while (w.winner < 0 && w.tick < 8000) step(w, []);
  assert(w.winner >= 0, `fixture: the old-style battle ends (tick ${w.tick})`);
  step(w, []);
  const rec = makeRecord(seed, w.tick, hashWorld(w), log, { map: 1, n: w.n, winner: w.winner, seconds: Math.floor(w.tick / 20) }, '2026-11-14T00:00:00.000Z');
  assert(decodeReplay(JSON.stringify(rec)).ok && log.every(c => c.cmd.v === undefined), 'fixture: a well-formed replay whose ai commands carry no version');
  return rec;
}

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {}, rec = oldReplay();
  await withBrowser({ root: baseline, overlay, port: 8509, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => { const r = await rect(id); assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`); await touchTap(page, r.x, r.y); await frames(); };
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const state = () => E(`({phase:__rts.phase(),tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),winner:__rts.winner(),log:__rts.log()})`);
    const aiCmds = async () => (await E('__rts.log()')).filter(c => c.cmd.t === 'ai').map(c => c.cmd);

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const sendsVersion = async (extra = '') => {
      await opened(extra); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await aiCmds(), [{ t: 'ai', side: SIDE_ENEMY, level: 2, v: 2 }], 'start: a new battle hands the enemy to the second-version computer');
    };
    const valved = async (extra = '') => {
      await opened(`noR057=1${extra}`); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await aiCmds(), [{ t: 'ai', side: SIDE_ENEMY, level: 2 }], 'valve: noR057 starts the first-version computer');
    };

    // ---- 正向 ----
    await sendsVersion();
    // R074：第二版開著，打一段、離開頁面、接回來
    await E("(() => { __rts.issue({ t: 'ai', side: 0, level: 3, v: 2 }); __rts.stepN(400); })()");
    const before = await state();
    assert.equal(node(before.seed, before.log, before.tick), before.hash, 'fixture: Node reproduces the second-version battle from its log');
    await opened('', true); await press('sm-continue');
    let s = await state();
    assert.deepEqual([s.tick, s.hash], [before.tick, before.hash], 'save: a battle against the second-version computer resumes at the same step');
    await E('__rts.stepN(200)');
    assert.equal(await E('__rts.hash()'), node(before.seed, before.log, before.tick + 200), 'save: and continues like the uninterrupted battle (the computer\'s memory came back)');
    // 接著打到分出勝負（雙方都是第二版），最後的雜湊跟 Node 從頭跑一樣
    for (let i = 0; i < 300 && (await E('__rts.winner()')) < 0; i++) await E('__rts.stepN(100)');
    s = await state();
    assert(s.winner >= 0, `battle: two second-version computers fight it out to a decision (tick ${s.tick})`);
    assert.equal(node(s.seed, s.log, s.tick), s.hash, 'battle: the browser and Node agree on the whole battle');
    await valved();
    // 不帶版本的舊重播：照第一版播完，雜湊對得上
    await opened(); await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([rec]))})`);
    await opened('', true);
    await press('sm-replays'); await press('rpl-watch-0');
    await E('__rts.pause(true)');
    const at = await E('__rts.tick()');
    await E(`__rts.stepN(${rec.ticks - at})`);
    assert.equal(await E('__rts.hash()'), rec.hash, 'replay: a replay recorded before this card plays back to the same hash');
    await E('__rts.stepN(1)');
    assert.equal(await E("document.getElementById('replay-text')?.textContent ?? ''"), SAME, 'replay: and the player is told it matches the original');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R057: version sent, save and resume, full battle (${Math.round(s.tick / 20)} s) equal to Node, valve, old replay unchanged`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nov', async () => { await sendsVersion('__r057mutant=nov'); }, 'start: a new battle hands the enemy to the second-version computer'],
      ['valve', async () => { await valved('&__r057mutant=valve'); }, 'valve: noR057 starts the first-version computer'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R057 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R057 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R057 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
