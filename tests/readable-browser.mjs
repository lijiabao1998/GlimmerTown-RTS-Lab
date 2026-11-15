// R075 看得懂：真實 Chrome。新開的局士氣開關送第二版、選中單位那一行字（厚度、穿深、士氣）、釘住的步兵趴下（畫面上趴的人數等於世界裡該趴的）、
// 設定頁的規則說明（四個尺寸不溢出）、逃生閥、士氣第一版的舊重播照播、故意弄壞。
// 「有人被釘住」的那一刻用 R074 的存檔接進去（Node 先把同一局算到那一步）：頁面逐步推進很慢，不在瀏覽器裡從頭打。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, touchTap, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK, UK_INFANTRY, SIDE_PLAYER, SIDE_ENEMY, moraleState, MORALE_PINNED } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { REPLAY_KEY, makeRecord, decodeReplay } from '../src/ui/replayStore.ts';
import { SAVE_KEY, makeSave } from '../src/ui/saveGame.ts';
import { unitSpec } from '../src/ui/unitSpec.ts';
import { AP_NOTE, MORALE_NOTE } from '../src/ui/startMenu.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r075-browser-'));
const SAME = '重播結束 · 跟原局相同';
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1 };
const TANK_LINE = '裝甲 正 30／側 20／後 15 公釐；穿深 近 44／遠 33 公釐';
// 故意弄壞（只編進 broken 那一份，網址帶 __r075mutant 才生效）
const mutations = {
  nospec: ['src/main.ts', "${V.r075 ? unitSpec(w, selected, phase === 'battle', '｜') : ''}", "${V.r075 && !location.search.includes('__r075mutant=nospec') ? unitSpec(w, selected, phase === 'battle', '｜') : ''}", 1],
  first: ['src/ui/skirmish.ts', 'valves(q).r075 ? 2 : 1', "valves(q).r075 && !location.search.includes('__r075mutant=first') ? 2 : 1", 1],
  noprone: ['src/render/battle.ts', 'this.w.rules?.morale === 2 && moraleState(u) >= MORALE_PINNED;', "this.w.rules?.morale === 2 && moraleState(u) >= MORALE_PINNED && !location.search.includes('__r075mutant=noprone');", 1],
  nonote: ['src/ui/startMenu.ts', '...(s.help ? { note: rulesNote(s.ap !== undefined, s.morale !== undefined) } : {})', "...(s.help && !location.search.includes('__r075mutant=nonote') ? { note: rulesNote(s.ap !== undefined, s.morale !== undefined) } : {})", 1],
  valve: ['src/valves.ts', "get r075() { return on('075'); }", "get r075() { return on('075') || location.search.includes('__r075mutant=valve'); }", 1],
};
const applied = new Set();
const plugin = { name: 'r075-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
const menOf = u => Math.min(UNIT_KINDS[u.kind].men, Math.ceil((u.hp * UNIT_KINDS[u.kind].men) / UNIT_KINDS[u.kind].hp));
// 世界裡該趴下幾個人：活著的步兵班、釘住或垮掉、不是正在潰退跑的
const proneIn = units => units.filter(u => u.alive && u.kind === UK_INFANTRY && (u.sup ?? 0) >= 60 && !u.rout).reduce((n, u) => n + menOf(u), 0);

// 兩條規則都開（士氣第二版）、雙方電腦的一局：Node 算到「我方有一個步兵班被釘住（沒在潰退）」的那一步，做成存檔
function pinnedBattle() {
  // 村莊、種子 1942：第 532 步我方有一個班被釘住、中坦克還在（試了村莊與萊伊各 20 個種子，只有兩個種子在分出勝負前同時有這兩件事）
  const seed = 1942, log = [{ t: 'map', id: 0, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, ECO, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 2 }].map(cmd => ({ tick: 0, cmd }));
  const w = createWorld(seed);
  step(w, log.map(c => c.cmd));
  const pinned = () => w.units.find(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_INFANTRY && moraleState(u) >= MORALE_PINNED && !u.rout);
  const tank = () => w.units.find(u => u.alive && u.side === SIDE_PLAYER && u.kind === UK_TANK);
  while (w.winner < 0 && w.tick < 12000 && !(pinned() && tank())) step(w, []);
  const squad = pinned(), t = tank();
  assert(squad && t && w.winner < 0, `fixture: a pinned friendly squad and a living friendly tank at the same step (tick ${w.tick})`);
  const save = makeSave(w, log, null, '2026-11-16T00:00:00.000Z');
  assert(typeof save === 'string', 'fixture: the moment can be saved');
  return { seed, log, tick: w.tick, hash: hashWorld(w), save, squad: squad.id, tank: t.id, prone: proneIn(w.units), squadLine: unitSpec(w, new Set([squad.id])), w };
}
// 一筆士氣第一版的舊重播（只有前 300 步）
function oldReplay() {
  const seed = 1944, log = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 1 }, { t: 'eco', inf: 1, guns: 1, tanks: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 3 }].map(cmd => ({ tick: 0, cmd }));
  const w = runLog(createWorld(seed), log, 300), rec = makeRecord(seed, 300, hashWorld(w), log, { map: 1, n: w.n, winner: -1, seconds: 15 }, '2026-11-14T00:00:00.000Z');
  assert(decodeReplay(JSON.stringify(rec)).ok, 'fixture: a well-formed replay under the first version');
  return rec;
}

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {}, fight = pinnedBattle(), rec = oldReplay();
  assert(fight.prone > 0 && /釘住|潰退/.test(fight.squadLine), `fixture: Node expects somebody lying down and says so (${fight.prone}, ${fight.squadLine})`);
  await withBrowser({ root: baseline, overlay, port: 8517, width: 412, height: 915, mobile: true, settle: 300 }, async ({ open, page }) => {
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
    const opened = async (q = '', keep = false) => { await open(q, { menu: true, keep }); assert(await E('!!window.__rts?.ready'), 'fixture: RTS ready'); await frames(); };
    const rules = async () => (await E('__rts.log()')).filter(c => c.tick === 0 && c.cmd.t === 'rules').map(c => c.cmd);
    const hint = () => E("document.getElementById('hint')?.textContent ?? ''");
    const note = () => E("document.querySelector('#sm-rules .sm-note')?.textContent ?? null");
    const offenders = () => E(`(()=>{const bs=[...document.querySelectorAll('#start-menu button, #start-menu input')];return bs.map(b=>{const r=b.getBoundingClientRect();return {id:b.id,w:Math.round(r.width),h:Math.round(r.height),inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),clip:b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1}}).filter(b=>b.w<44||b.h<44||!b.inside||!b.hit||b.clip)})()`);
    const noteBox = () => E(`(()=>{const p=document.querySelector('#sm-rules .sm-note');if(!p)return null;const r=p.getBoundingClientRect();return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,clip:p.scrollWidth>p.clientWidth+1}})()`);

    // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
    // 新開一局、兩顆開關都開：送的是士氣第二版；選中一台中坦克，下面那行字有厚度與穿深
    const starts = async (extra = '') => {
      await opened(`ap=1&morale=1${extra}`); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await rules(), [{ t: 'rules', ap: 1, morale: 2 }], 'start: with the morale switch on, a new battle uses the second version of the rule');
      const tank = (await E('__rts.units()')).find(u => u.alive && u.side === 0 && u.kind === 0);
      assert(tank, 'fixture: a friendly medium tank');
      await E(`__rts.select([${tank.id}])`); await frames();
      const text = await hint();
      assert(text.includes(`｜${TANK_LINE}`), `spec: selecting a tank shows its plates and penetration (${text})`);
    };
    // 接進「有人被釘住」的那一刻（沒有戰場迷霧，全場都畫）：畫面上趴的人數等於世界裡該趴的；選中被釘住的班，字寫得出來
    const lies = async (extra = '') => {
      await opened(`noR100=1${extra}`); await E(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(fight.save)})`);
      await opened(`noR100=1${extra}`, true); await press('sm-continue');
      assert.deepEqual([await E('__rts.tick()'), await E('__rts.hash()')], [fight.tick, fight.hash], 'fixture: the saved moment is back');
      await frames();
      const men = await E('__rts.men()');
      assert.equal(men.prone, fight.prone, `prone: the soldiers drawn lying down are the ones pinned or broken in the world (${men.prone} drawn, ${fight.prone} expected)`);
      return men;
    };
    const describes = async (extra = '') => {
      await lies(extra);
      await E(`__rts.select([${fight.squad}])`); await frames();
      let text = await hint();
      assert(text.includes(`｜${fight.squadLine}`), `spec: selecting the pinned squad says so (${text}; expected ${fight.squadLine})`);
      await E(`__rts.select([${fight.tank}])`); await frames();
      text = await hint();
      assert(text.includes(`｜${TANK_LINE}`), `spec: and a tank still shows its plates in a resumed battle (${text})`);
    };
    // 設定頁「擬真規則」下面的說明
    const explains = async (extra = '') => {
      await opened(extra); await press('sm-setup');
      assert.equal(await note(), `${AP_NOTE}\n${MORALE_NOTE}`, 'help: the setup page explains both realism rules under their switches');
    };
    const valved = async (extra = '') => {
      await opened(`noR075=1&ap=1&morale=1${extra}`); await press('sm-setup');
      assert.equal(await note(), null, 'valve: noR075 removes the explanation');
      await press('sm-setup-done'); await press('sm-start');
      await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
      assert.deepEqual(await rules(), [{ t: 'rules', ap: 1, morale: 1 }], 'valve: noR075 sends the first version of the rule');
      const tank = (await E('__rts.units()')).find(u => u.alive && u.side === 0 && u.kind === 0);
      await E(`__rts.select([${tank.id}])`); await frames();
      assert(!(await hint()).includes('裝甲 正'), 'valve: noR075 removes the spec from the selection line');
    };

    // ---- 正向 ----
    await starts();
    const men = await lies();
    // 往下打：趴的人數一直跟世界對得上（有人站起來、有人又被釘住）；同一批實例（人數＝活著的小兵）
    for (let i = 0; i < 6; i++) {
      await E('__rts.stepN(40)'); await frames();
      const now = await E('__rts.men()'), want = proneIn(await E('__rts.units()'));
      assert.equal(now.prone, want, `prone: after ${40 * (i + 1)} more steps the picture still matches the world (${now.prone} drawn, ${want} expected)`);
    }
    await describes();
    // 沒開規則的局：沒有那一行
    await opened(); await press('sm-start');
    await E('(() => { __rts.startBattle(); __rts.pause(true); })()');
    const plain = (await E('__rts.units()')).find(u => u.alive && u.side === 0 && u.kind === 0);
    await E(`__rts.select([${plain.id}])`); await frames();
    assert(!(await hint()).includes('裝甲 正') && !(await hint()).includes('士氣'), 'spec: with neither rule on the selection line is as before');
    // 設定頁的說明：四個尺寸都看得到、按鈕都按得到
    await explains();
    for (const [w, h, mob] of [[412, 915, true], [360, 780, true], [860, 412, true], [1280, 800, false]]) {
      await size(w, h, mob);
      await opened(); await press('sm-setup');
      const off = await offenders(), box = await noteBox();
      assert.deepEqual(off, [], `help: at ${w}×${h} every control on the setup page is still a reachable 44px target (${JSON.stringify(off)})`);
      // 橫放的手機（矮螢幕）放不下說明：那個版面不顯示（display: none，量得到的方框是 0×0）；其餘三個尺寸要完整看得到
      if (h <= 480) assert.equal(await E("getComputedStyle(document.querySelector('#sm-rules .sm-note')).display"), 'none', `help: at ${w}×${h} the short layout leaves the explanation out`);
      else assert(box && box.inside && !box.clip, `help: at ${w}×${h} the explanation fits on the page (${JSON.stringify(box)})`);
    }
    await size(412, 915, true);
    await valved();
    // 士氣第一版的舊重播照播
    await opened(); await E(`localStorage.setItem(${JSON.stringify(REPLAY_KEY)}, ${JSON.stringify(JSON.stringify([rec]))})`);
    await opened('', true);
    await press('sm-replays'); await press('rpl-watch-0');
    await E('__rts.pause(true)');
    await E(`__rts.stepN(${rec.ticks} - __rts.tick())`);
    assert.equal(await E('__rts.hash()'), rec.hash, 'replay: a replay under the first version of the rule plays back to the same hash');
    await E('__rts.stepN(1)');
    assert.equal(await E("document.getElementById('replay-text')?.textContent ?? ''"), SAME, 'replay: and the player is told it matches the original');
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log(`OK R075: second version sent, spec line, ${men.prone} of ${men.alive} soldiers lying down at step ${fight.tick} and tracked for 240 more, help text at four sizes, valve, old replay`);

    // ---- 故意弄壞 ----
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    const negatives = [
      ['nospec', async () => { await starts('&__r075mutant=nospec'); }, 'spec: selecting a tank shows its plates and penetration'],
      ['first', async () => { await starts('&__r075mutant=first'); }, 'start: with the morale switch on, a new battle uses the second version of the rule'],
      ['noprone', async () => { await lies('&__r075mutant=noprone'); }, 'prone: the soldiers drawn lying down are the ones pinned or broken in the world'],
      ['nonote', async () => { await explains('__r075mutant=nonote'); }, 'help: the setup page explains both realism rules under their switches'],
      ['valve', async () => { await valved('&__r075mutant=valve'); }, 'valve: noR075 removes the explanation'],
    ];
    for (const [name, run, prefix] of negatives) {
      const errors = page.errors.length; let failure;
      try { await run(); } catch (e) { failure = e; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length, errors, `negative ${name}: no runtime error`);
      console.log(`RED R075 ${name}: ${failure.message.split('\n')[0]}`);
    }
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R075 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R075 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
