// R080 機槍組：真實 Chrome（手機觸控 412×915）。新開的局 eco 帶 mg、雙方開局各一組、生產列的按鈕點得到而且真的排進佇列、
// 打一段之後瀏覽器跟 Node 一致、選到它提示列寫「機槍組」、畫出三個組員而且不多繪製呼叫、逃生閥、故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UNIT_KINDS, UK_MG, SIDE_PLAYER, SIDE_ENEMY, SUB } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r080-browser-'));
const COST = UNIT_KINDS[UK_MG].cost;
// 故意弄壞（只編進 broken 那一份，網址帶 __r080mutant 才生效）
const mutations = {
  flag: ['src/main.ts', '...(V.r080 ? { mg: 1 } : {}) });', "...(V.r080 && !location.search.includes('__r080mutant=flag') ? { mg: 1 } : {}) });", 1],
  valve: ['src/valves.ts', "get r080() { return on('080'); }", "get r080() { return on('080') || location.search.includes('__r080mutant=valve'); }", 1],
  hint: ['src/ui/hud.ts', "${s.mg ? ` 機槍組 ${s.mg}` : ''}", "${s.mg && !location.search.includes('__r080mutant=hint') ? ` 機槍組 ${s.mg}` : ''}", 1],
  crew: ['src/render/battle.ts', '(u.kind === UK_MORTAR || u.kind === UK_MG) && u.alive) nm = this.crew22(', "(u.kind === UK_MORTAR || (u.kind === UK_MG && !location.search.includes('__r080mutant=crew'))) && u.alive) nm = this.crew22(", 1],
};
const applied = new Set();
const plugin = { name: 'r080-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const node = (seed, log, ticks) => hashWorld(runLog(createWorld(seed), log, ticks));

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8545, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const rect = id => E(`(()=>{const e=document.getElementById(${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    const press = async id => { const r = await rect(id); assert(r && r.hit && r.w >= 44 && r.h >= 44, `fixture: ${id} is a reachable 44px target`); await touchTap(page, r.x, r.y); await frames(); };
    // 開一局、開戰、暫停；回傳 eco 指令與雙方的機槍組
    const battle = async (q = '') => {
      await open(q, { menu: true }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames();
      await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()'); await frames();
      const eco = (await E('__rts.log()')).find(c => c.cmd.t === 'eco')?.cmd, units = await E('__rts.units()');
      return { eco, mine: units.filter(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_MG), theirs: units.filter(u => u.alive && u.side === SIDE_ENEMY && u.kind === UK_MG) };
    };
    // 鏡頭對著我方機槍組出生的地方，回傳這一幀的繪製呼叫與畫了幾個組員
    const look = async at => { await E(`(() => { __rts.focus(${at.x / SUB}, ${at.z / SUB}, 1.6); })()`); await frames(); await frames(); return { calls: (await E('__rts.info()')).calls, crew: (await E('__rts.men()')).crew }; };

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    const starts = async (extra = '') => {
      const b = await battle(extra);
      assert.equal(b.eco?.mg, 1, 'start: a new battle carries mg in its eco command');
      assert.deepEqual([b.mine.length, b.theirs.length], [1, 1], 'start: both sides begin with one machine-gun team');
      return b;
    };
    const valved = async (extra = '') => {
      const b = await battle(`noR080=1${extra}`);
      assert.deepEqual([b.eco?.mg, b.mine.length, b.theirs.length, await rect('pb-k41')], [undefined, 0, 0, null], 'valve: noR080 leaves mg out — no flag, no teams, no button');
      return b;
    };
    const named = async (extra = '') => {
      const b = await starts(extra);
      assert.deepEqual(await E(`__rts.select([${b.mine[0].id}])`), [b.mine[0].id], 'fixture: the team is selected');
      await E('__rts.pause(false)'); await frames();
      const hint = await E("document.getElementById('hint').textContent");
      assert(hint.includes('機槍組 1') && !hint.includes('進駐'), `hint: selecting the team names it and does not offer a house (${hint})`);
    };
    const drawn = async (extra = '') => {
      const b = await starts(extra), seen = await look(b.mine[0]);
      assert.equal(seen.crew, 3, 'draw: the three gunners are drawn');
      return { at: b.mine[0], calls: seen.calls };
    };

    // ---- 正向 ----
    await starts();
    // 生產列的按鈕：夠大、點得到、扣補給、排進佇列
    const before = await E('__rts.eco()');
    await press('pb-k41'); await E('__rts.stepN(1)');
    const after = await E('__rts.eco()');
    assert.deepEqual(after.queue[SIDE_PLAYER], [UK_MG], 'button: a tap puts a machine-gun team in the queue');
    assert([COST - 1, COST].includes(before.supply[SIDE_PLAYER] - after.supply[SIDE_PLAYER]), `button: and takes ${COST} supply (${before.supply[SIDE_PLAYER]} → ${after.supply[SIDE_PLAYER]})`);
    // 打一段（做出第二組）：瀏覽器跟 Node 一致
    await E('__rts.stepN(400)');
    const s = await E('({tick:__rts.tick(),hash:__rts.hash(),seed:__rts.seed(),log:__rts.log(),units:__rts.units()})');
    assert(s.log.some(c => c.cmd.t === 'produce' && c.cmd.kind === UK_MG), 'fixture: the tap is in the log as a produce command');
    assert.equal(s.units.filter(u => u.side === SIDE_PLAYER && u.kind === UK_MG).length, 2, 'button: twenty seconds later the second team has arrived');
    assert.equal(node(s.seed, s.log, s.tick), s.hash, 'battle: Node reproduces the battle from its log');
    await named();
    const withTeam = await drawn();
    const without = await valved();
    assert.equal(without.mine.length, 0, 'fixture');
    const bare = await look(withTeam.at);
    assert.equal(bare.crew, 0, 'fixture: without the team no crew is drawn at that spot');
    assert(withTeam.calls <= bare.calls, `draw: the team adds no draw calls (${withTeam.calls} with, ${bare.calls} without)`);
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R080: flag and starting teams, button (${COST} supply), ${s.tick} steps equal to Node, hint, three gunners in ${withTeam.calls} draw calls (${bare.calls} without), valve`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['flag', async () => { await starts('__r080mutant=flag'); }, 'start: a new battle carries mg in its eco command'],
      ['valve', async () => { await valved('&__r080mutant=valve'); }, 'valve: noR080 leaves mg out'],
      ['hint', async () => { await named('__r080mutant=hint'); }, 'hint: selecting the team names it'],
      ['crew', async () => { await drawn('__r080mutant=crew'); }, 'draw: the three gunners are drawn'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R080 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R080 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R080 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
