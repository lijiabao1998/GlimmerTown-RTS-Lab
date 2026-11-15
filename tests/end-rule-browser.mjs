// R077 指揮部倒了就結束：真實 Chrome（手機觸控 412×915）。開局的 eco 指令帶不帶 end、逃生閥、帶 end 開的局跟 Node 一致、
// 指揮部倒的那一步跟 Node 相同（帶 end 與不帶 end 各一局：Node 算到分出勝負前 40 步做成 R074 的存檔，瀏覽器接著打）、帶 end 的重播照播、故意弄壞。
// 不在瀏覽器裡把整局從頭推到尾：頁面上一步一步推進比 Node 慢上百倍，兩整局會超過 CI 每支守衛 120 秒的上限。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, sleep, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { REPLAY_KEY, makeRecord, decodeReplay } from '../src/ui/replayStore.ts';
import { SAVE_KEY, makeSave } from '../src/ui/saveGame.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r077-browser-'));
const SAME = '重播結束 · 跟原局相同';
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1 };
// 故意弄壞（只編進 broken 那一份，網址帶 __r077mutant 才生效）
const mutations = {
  noend: ['src/main.ts', '...(V.r077 ? { end: 1 } : {})', "...(V.r077 && !location.search.includes('__r077mutant=noend') ? { end: 1 } : {})", 1],
  valve: ['src/valves.ts', "get r077() { return on('077'); }", "get r077() { return on('077') || location.search.includes('__r077mutant=valve'); }", 1],
};
const applied = new Set();
const plugin = { name: 'r077-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => { const w = runLog(createWorld(seed), log, ticks); return { hash: hashWorld(w), winner: w.winner }; };

const BEFORE = 40;   // 存檔存在分出勝負前幾步
// 一局有指揮部、雙方都是電腦的仗（end＝eco 指令帶不帶新判定；不帶的就是這張卡之前的局）：
// Node 算到分出勝負，回傳那一步、贏家、雜湊，以及「分出勝負前 BEFORE 步」的存檔（R074 的格式）與一筆只有前 300 步的重播
function battle(end) {
  const seed = 1944, log = [{ t: 'map', id: 1, vegetation: 1 }, end ? { ...ECO, end: 1 } : ECO, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 2, v: 2 }].map(cmd => ({ tick: 0, cmd }));
  const w = createWorld(seed);
  step(w, log.map(c => c.cmd));
  while (w.winner < 0 && w.tick < 24000) step(w, []);
  assert(w.winner >= 0, `fixture: the ${end ? 'new' : 'old'}-style battle ends (tick ${w.tick})`);
  const mid = runLog(createWorld(seed), log, w.tick - BEFORE), save = makeSave(mid, log, null, '2026-11-16T00:00:00.000Z');
  assert(mid.winner < 0 && typeof save === 'string', 'fixture: a save taken shortly before the decision');
  const early = runLog(createWorld(seed), log, 300), rec = makeRecord(seed, 300, hashWorld(early), log, { map: 1, n: early.n, winner: -1, seconds: 15 }, '2026-11-16T00:00:00.000Z');
  assert(decodeReplay(JSON.stringify(rec)).ok, 'fixture: a well-formed replay');
  return { tick: w.tick, winner: w.winner, hash: hashWorld(w), midHash: hashWorld(mid), save, rec };
}

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {}, fresh = battle(true), old = battle(false);
  assert(fresh.tick < old.tick, `fixture: on this seed the new rule decides the battle earlier (${fresh.tick} against ${old.tick})`);
  await withBrowser({ root: baseline, overlay, port: 8513, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => { const r = await rect(id); assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`); await touchTap(page, r.x, r.y); await frames(); };
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const state = () => E(`({tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),winner:__rts.winner(),log:__rts.log()})`);
    const ecoCmds = async () => (await E('__rts.log()')).filter(c => c.cmd.t === 'eco').map(c => c.cmd);

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const sendsEnd = async (extra = '') => {
      await opened(extra); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await ecoCmds(), [{ ...ECO, end: 1, mg: 1 }], 'start: a new battle carries the new end rule on its eco command');   // mg：R080 之後新開的局也帶機槍組
    };
    const valved = async (extra = '') => {
      await opened(`noR077=1${extra}`); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await ecoCmds(), [{ ...ECO, mg: 1 }], 'valve: noR077 starts a battle with the old end rule');
    };
    // 接回一份「分出勝負前 BEFORE 步」的存檔，往下打：跟 Node 在同一步分出勝負、同一個贏家、同一個雜湊
    const decides = async (b, what) => {
      await opened(); await E(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(b.save)})`);
      await opened('', true); await press('sm-continue');
      let st = await state();
      assert.deepEqual([st.tick, st.hash, st.winner], [b.tick - BEFORE, b.midHash, -1], `decision: ${what} resumes ${BEFORE} steps before the end, undecided`);
      await E(`__rts.stepN(${BEFORE - 1})`);
      assert.equal(await E('__rts.winner()'), -1, `decision: ${what} is still undecided one step before Node decides it`);
      await E('__rts.stepN(1)'); await frames();
      st = await state();
      assert.deepEqual([st.tick, st.winner, st.hash], [b.tick, b.winner, b.hash], `decision: ${what} is decided on the same step, for the same side, with the same hash as in Node`);
      // 戰報在分出勝負之後照舊先放一小段慢動作才出來（main.ts 的 SLOWMO_MS），等它，最多 8 秒
      let shown = false;
      for (let i = 0; i < 40 && !shown; i++) { await sleep(200); shown = (await E('__rts.report()')).shown; }
      assert.equal(shown, true, `decision: ${what} — the battle report comes up once the battle is decided`);
    };
    const plays = async (rec, what) => {
      await opened(); await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([rec]))})`);
      await opened('', true);
      await press('sm-replays'); await press('rpl-watch-0');
      await E('__rts.pause(true)');
      const at = await E('__rts.tick()');
      await E(`__rts.stepN(${rec.ticks - at})`);
      assert.equal(await E('__rts.hash()'), rec.hash, `replay: ${what} plays back to the same hash`);
      await E('__rts.stepN(1)');
      assert.equal(await E("document.getElementById('replay-text')?.textContent ?? ''"), SAME, `replay: ${what} — the player is told it matches the original`);
    };

    // ---- 正向 ----
    await sendsEnd();
    // 這一局（真的從開始選單開的）讓我方也交給電腦打 600 步：瀏覽器跟 Node 一致
    await E("(() => { __rts.issue({ t: 'ai', side: 0, level: 3, v: 2 }); __rts.stepN(600); })()");
    const s = await state();
    assert.deepEqual(node(s.seed, s.log, s.tick), { hash: s.hash, winner: s.winner }, 'battle: the browser and Node agree on a battle started with the new end rule');
    await valved();
    await decides(fresh, 'a battle with the new end rule');
    await decides(old, 'a battle saved before this card');
    await plays(fresh.rec, 'a replay with the new end rule');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R077: end rule sent, ${s.tick} steps equal to Node, decided on Node's step with the rule (${fresh.tick}) and without it (${old.tick}), replay, valve`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['noend', async () => { await sendsEnd('__r077mutant=noend'); }, 'start: a new battle carries the new end rule on its eco command'],
      ['valve', async () => { await valved('&__r077mutant=valve'); }, 'valve: noR077 starts a battle with the old end rule'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R077 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R077 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R077 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
