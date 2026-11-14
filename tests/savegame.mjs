// R074 繼續上一局：不開瀏覽器的部分。世界的編碼與解碼（來回後雜湊相同、接著跑逐位相同）、存檔紀錄的檢查、本機儲存、接線。
// 用法：node tests/savegame.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/savegame.mjs <群組名>   只跑那一群（隔離副本裡用）
// 真實 Chrome 在 tests/savegame-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, BK_WIRE } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { encodeWorld, decodeWorld, CODEC_MAX_N } from '../src/sim/worldCodec.ts';
import { SAVE_KEY, SAVE_VERSION, SAVE_MAX_TEXT, SAVE_EVERY_MS, SAVE_WATCH_MS, makeSave, checkSave, readSave, writeSave, clearSave, saveTitle, savable, textSum, initSaves } from '../src/ui/saveGame.ts';

const at0 = (...cmds) => cmds.map(cmd => ({ tick: 0, cmd }));
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, BOTH = [{ t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 2 }];
// 幾局打到一半的仗：[名字, 種子, 指令紀錄, 存檔那一步]
const BATTLES = [
  ['萊伊：布陣、戰壕、鐵絲網、補給、煙幕、高爆', 61, [
    ...at0({ t: 'map', id: MAP_RYE, vegetation: 1 }, { t: 'build', side: SIDE_PLAYER, kind: 0, x: 20, z: 27, rot: 0 }, { t: 'trench', side: SIDE_PLAYER, kind: 0, x: 22, z: 29, rot: 0 },
      { t: 'build', side: SIDE_PLAYER, kind: BK_WIRE, x: 19, z: 29, rot: 0 }, ECO, { t: 'ai', side: SIDE_ENEMY, level: 3 }),
    { tick: 5, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [4], x: 12, z: 12, ammo: 'smoke' } }, { tick: 40, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_TANK } },
    { tick: 260, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [4], x: 8, z: 8 } }, { tick: 300, cmd: { t: 'fireDiscipline', side: SIDE_PLAYER, ids: [1], hold: true } }], 620],
  ['鄉間 64：加倍、快補給、穿甲規則、雙方電腦', 62, at0({ t: 'map', id: MAP_LARGE, vegetation: 1 }, { t: 'rules', force: 3, income: 3, ap: 1 }, ECO, ...BOTH), 700],
  ['河鎮 96：雙方電腦', 63, at0({ t: 'map', id: MAP_TOWN, vegetation: 1 }, ECO, ...BOTH), 400],
  ['萊伊：喪屍防守', 64, at0({ t: 'map', id: MAP_RYE, vegetation: 1 }, { t: 'zombies' }, ECO), 1100],
];
const world = (seed, log, ticks) => runLog(createWorld(seed), log, ticks);
const round = w => decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
const typedPaths = (x, path = '', out = []) => {
  if (ArrayBuffer.isView(x)) out.push(path);
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) typedPaths(v, path ? `${path}.${k}` : k, out);
  return out;
};
const mem = () => { const m = new Map(), s = { m, sets: 0, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { s.sets++; m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; return s; };
// 存檔的文字＝8 個字的檢查碼＋JSON：拆開、改完再封回去（檢查碼重算）
const parse = t => JSON.parse(t.slice(8)), seal = x => { const b = JSON.stringify(x); return textSum(b) + b; };
const runningSandbox = () => { const sb = createSandboxWorld(1); step(sb, [{ t: 'sandboxRun', running: true }]); for (let i = 0; i < 5; i++) step(sb, []); return sb; };

const groups = {
  // 驗收 1–3：來回、接著跑、每一張表都有編碼
  codec() {
    const seen = { built: 0, trench: 0, wire: 0, smoke: 0, counterbattery: 0, eco: 0, ai: 0, rules: 0, zombies: 0, crater: 0, vegetation: 0, shells: 0, hold: 0 };
    for (const [name, seed, log, ticks] of BATTLES) {
      const w = world(seed, log, ticks), back = round(w);
      assert(back, `codec: ${name} decodes`);
      assert.equal(hashWorld(back), hashWorld(w), `codec: ${name} has the same hash after encode → text → decode`);
      assert.deepEqual([back.n, back.tick, back.seed, back.units.length, back.blds.length], [w.n, w.tick, w.seed, w.units.length, w.blds.length], `codec: ${name} keeps size, tick, seed, units and buildings`);
      assert.deepEqual(back.events, [], `codec: ${name} does not store render-only events`);
      assert.deepEqual(back, { ...w, events: [] }, `codec: ${name} comes back field for field (every table, unit, building, shell and optional part; only the render-only events are left out)`);
      const a = hashWorld(runLog(w, log, ticks + 300)), b = hashWorld(runLog(back, log, ticks + 300));
      assert.equal(b, a, `codec: ${name} continues bit for bit after the round trip`);
      assert.equal(hashWorld(world(seed, log, ticks + 300)), a, `codec: ${name} continued equals the uninterrupted battle`);
      const fresh = world(seed, log, ticks);
      assert.deepEqual(typedPaths(fresh).sort(), ['crater', 'occ', 'ter', ...(fresh.vegetation ? ['vegetation.cells'] : [])].sort(), `codec: ${name} the typed arrays in a World are exactly the ones the codec knows`);
      assert.deepEqual(typedPaths(encodeWorld(fresh)), [], `codec: ${name} nothing typed is left in the encoded form`);
      seen.built += fresh.blds.filter(x => x.builtBy !== undefined).length; seen.trench += fresh.trenches?.segments.length ?? 0; seen.wire += fresh.wires?.segments.length ?? 0;
      seen.smoke += fresh.smoke ? 1 : 0; seen.counterbattery += fresh.counterbattery?.length ?? 0; seen.eco += fresh.eco ? 1 : 0; seen.ai += fresh.ai?.length ?? 0; seen.rules += fresh.rules ? 1 : 0;
      seen.zombies += fresh.zombies?.wave ?? 0; seen.crater += fresh.crater.some(c => c > 0) ? 1 : 0; seen.vegetation += fresh.vegetation ? 1 : 0; seen.shells += fresh.shells.length; seen.hold += fresh.units.filter(u => u.holdFire === 1).length;
    }
    for (const [k, v] of Object.entries(seen)) if (k !== 'shells') assert(v > 0, `fixture: the battles between them exercise ${k} (${JSON.stringify(seen)})`);
    const blank = createWorld(1);
    assert.equal(hashWorld(round(blank)), hashWorld(blank), 'codec: a brand-new world survives too');
  },
  // 驗收 4：拒收
  decode() {
    const good = () => JSON.parse(JSON.stringify(encodeWorld(world(61, BATTLES[0][2], 50))));
    assert(decodeWorld(good()), 'fixture: the untouched encoding decodes');
    for (const [bad, why] of [[null, 'null'], [7, 'a number'], ['x', 'a string'], [[], 'an array'], [{}, 'an empty object']]) assert.equal(decodeWorld(bad), null, `decode: rejects ${why}`);
    const broken = (change, why) => { const x = good(); change(x); let out; assert.doesNotThrow(() => { out = decodeWorld(x); }, `decode: ${why} never throws`); assert.equal(out, null, `decode: rejects ${why}`); };
    broken(x => { delete x.n; }, 'a missing size');
    broken(x => { x.n = 0; }, 'size 0');
    broken(x => { x.n = 32.5; }, 'a fractional size');
    broken(x => { x.n = CODEC_MAX_N + 1; }, 'an absurd size');
    broken(x => { x.n = 64; }, 'a size that does not match the tables');
    broken(x => { x.ter = x.ter.slice(0, -2); }, 'a table shorter than the map');
    broken(x => { x.occ = [...x.occ, 0, 5]; }, 'a table longer than the map');
    broken(x => { x.crater[1] = -x.crater[1]; }, 'a negative run length');
    broken(x => { x.crater = [0, 0, ...x.crater]; }, 'a zero run length');
    broken(x => { x.ter[0] = 256; }, 'a terrain value out of range');
    broken(x => { x.ter = x.ter.slice(0, -1); }, 'an odd-length table');
    broken(x => { x.ter = 'grass'; }, 'a table that is not an array');
    broken(x => { x.units = {}; }, 'units that are not a list');
    broken(x => { x.vegetation = { version: 1, cells: [0, 3] }; }, 'vegetation with the wrong cell count');
    broken(x => { x.vegetation = 5; }, 'vegetation that is not an object');
    // 欄位不見了：hashWorld 把缺的欄位當 0，所以要在解碼時擋（缺了它們模擬會算出 NaN）
    broken(x => { delete x.winner; }, 'a world without its winner field');
    broken(x => { x.tick = 'soon'; }, 'a tick that is not a number');
    broken(x => { delete x.units[0].pathIdx; }, 'a unit missing a field the simulation needs');
    broken(x => { x.units[0].id = 7; }, 'a unit whose id is not its place in the list');
    broken(x => { x.units[0].kind = 999; }, 'a unit of a kind that does not exist');
    broken(x => { x.units[0].kind = -1; }, 'a unit of a negative kind');
    broken(x => { x.units[0].alive = 1; }, 'a unit whose alive flag is not true or false');
    broken(x => { x.units[0].path = [3, 'x']; }, 'a unit path that is not all numbers');
    broken(x => { x.units[1] = null; }, 'a hole in the unit list');
    broken(x => { delete x.blds[0].hp; }, 'a building missing its durability');
    broken(x => { x.blds[0].id = 9; }, 'a building whose id is not its place in the list');
    broken(x => { x.shells = [{ id: 1 }]; }, 'a shell missing its fields');
  },
  // 驗收 5：存檔紀錄
  record() {
    const [, seed, log, ticks] = BATTLES[0], w = world(seed, log, ticks), cam = { x: 20.5, z: 22, zoom: 1.4 };
    const text = makeSave(w, log, cam, '2026-11-15T08:00:00.000Z'), loaded = checkSave(text);
    assert(text && loaded.ok, `record: a real mid-battle save passes (${loaded.ok ? '' : loaded.why})`);
    assert.deepEqual([hashWorld(loaded.save.world), loaded.save.world.tick, loaded.save.log, loaded.save.cam, loaded.save.at], [hashWorld(w), ticks, log, cam, '2026-11-15T08:00:00.000Z'], 'record: world, log, camera and time come back');
    assert.match(saveTitle(loaded.save), /^萊伊 32×32 · 0:31 · 種子 61$/, `record: the menu line names the map, the time and the seed (${saveTitle(loaded.save)})`);
    assert.equal(hashWorld(runLog(loaded.save.world, loaded.save.log, ticks + 200)), hashWorld(world(seed, log, ticks + 200)), 'record: the loaded game continues like the original');   // 這一行會把讀回來的世界往下跑，放最後
    const refused = (change, why, expect) => {
      const d = checkSave(typeof change === 'string' ? change : (() => { const x = parse(text); change(x); return seal(x); })());
      assert(d.ok === false && d.why.length > 0, `record: ${why} is refused with a reason`);
      if (expect) assert.match(d.why, expect, `record: ${why} says why (${d.why})`);
    };
    refused('{ not json', 'text that is not a save'); refused(seal([]), 'an array'); refused(`${textSum('{ not json')}{ not json`, 'a body that is not JSON', /JSON/); refused(x => { x.v = 2; }, 'version 2', /版本/);
    refused(x => { x.world.units[0].hp += 1; }, 'a world that does not match its hash', /雜湊/);
    refused(x => { x.tick += 1; }, 'a tick that disagrees with the world'); refused(x => { x.seed += 1; }, 'a seed that disagrees with the world');
    refused(x => { x.hash = 'xyz'; }, 'a hash that is not 8 hex digits'); refused(x => { x.log = [{ tick: 0, cmd: { t: 'move', side: 0, x: 1, z: 1 } }]; }, 'a log with a malformed command', /第 1 筆/);
    refused(x => { x.log = [...x.log, { tick: x.tick + 5, cmd: { t: 'stop', side: 0, ids: [1] } }]; }, 'a log that runs past the world');
    refused(x => { delete x.world.n; }, 'a world that does not decode');
    refused(`${' '.repeat(SAVE_MAX_TEXT)}${text}`, 'an oversized save');
    // 已經分出勝負、沙盒：連雜湊都對也不給接
    const rehash = change => { const x = parse(text); change(x.world); x.hash = hashWorld(decodeWorld(JSON.parse(JSON.stringify(x.world)))); return seal(x); };
    assert.match(checkSave(rehash(v => { v.winner = 0; })).why ?? '', /勝負/, 'record: a finished battle is refused even with a matching hash');
    assert.match(checkSave(rehash(v => { v.sandbox = { version: 1, running: false, frame: 3 }; })).why ?? '', /沙盒/, 'record: a sandbox world is refused even with a matching hash');
    const stuck = rehash(v => { v.shells = [{ id: 1, side: 0, kind: 0, shooter: 999, sx: 0, sz: 0, ex: 0, ez: 0, t: 0, T: 1, target: 0, hitBld: 0 }]; });   // 形狀對、雜湊也對得上，但走一步就會丟例外（砲彈的射手不存在）
    assert.doesNotThrow(() => checkSave(stuck), 'record: a world that cannot step never throws');
    assert.match(checkSave(stuck).why ?? '', /走不動/, 'record: a world that cannot step is refused');
    const mangled = seal((x => { x.world.units = [{ id: 1 }]; return x; })(parse(text)));   // 連雜湊都算不出來
    assert.doesNotThrow(() => checkSave(mangled), 'record: a world that cannot even be hashed never throws');
    assert.equal(checkSave(mangled).ok, false, 'record: a world that cannot even be hashed is refused');
    assert.equal(checkSave(seal({ ...parse(text), cam: { x: 'left' } })).save.cam, null, 'record: a nonsense camera is dropped, the save still loads');
    // 文字本身壞掉：欄位名被改壞一個字，世界的雜湊看不出來（缺的欄位當 0），文字的檢查碼看得出來
    const cut = text.replace('"pathIdx"', '"pathI"');
    assert.notEqual(cut, text, 'fixture: the save text has a pathIdx field to damage');
    assert.match(checkSave(cut).why ?? '', /檢查碼/, 'record: a save with one damaged field name is refused by the checksum');
    for (const at of [0, 8, 9, 100, text.length >> 1, text.length - 2]) {
      const d = checkSave(text.slice(0, at) + (text[at] === '0' ? '1' : '0') + text.slice(at + 1));
      assert(d.ok === false && /檢查碼|不是存檔/.test(d.why), `record: one changed character at ${at} is refused (${d.ok ? 'accepted' : d.why})`);
    }
    assert.match(checkSave(text.slice(0, -1)).why ?? '', /檢查碼/, 'record: a save missing its last character is refused');
    // 檢查碼對得上、但世界少了欄位（以後的版本改了形狀，或有人改過內容再重算）：形狀檢查馬上擋，不會先拿去走一步
    const t0 = Date.now(), holed = checkSave(seal((x => { delete x.world.units[0].pathIdx; return x; })(parse(text))));
    assert(holed.ok === false && /讀不出來/.test(holed.why) && Date.now() - t0 < 2000, `record: a world missing a unit field is refused at once (${holed.ok ? 'accepted' : holed.why}, ${Date.now() - t0} ms)`);
    // 戰報統計跟著存；形狀不對就丟掉統計，存檔照樣能用
    const stats = { start: [[3, 1, 1, 0], [3, 1, 1, 0]], fires: [12, 9], lastKill: { x: 5120, z: 4096, tick: 300 }, endTick: -1, bounces: [2, 0] };
    assert.equal(loaded.save.stats, null, 'record: a save made without statistics has none');
    assert.deepEqual(checkSave(makeSave(world(seed, log, ticks), log, cam, '', stats)).save.stats, stats, 'record: the battle-report statistics come back');
    assert.deepEqual(checkSave(makeSave(world(seed, log, ticks), log, cam, '', { ...stats, bounces: undefined, lastKill: null })).save.stats, { start: stats.start, fires: stats.fires, lastKill: null, endTick: -1 }, 'record: statistics without bounces or a last kill come back as they were');
    for (const [bad, why] of [[{ ...stats, fires: [1] }, 'a short row'], [{ ...stats, fires: [1, -1] }, 'a negative count'], [{ ...stats, start: [[1, 2, 3, 4]] }, 'one side only'], [{ ...stats, endTick: 50 }, 'an ended battle'], [{ ...stats, lastKill: { x: 'a', z: 0, tick: 0 } }, 'a nonsense last kill'], [{ ...stats, bounces: [1, 2, 3] }, 'three sides of bounces'], ['fires', 'a string']]) {
      const d = checkSave(seal({ ...parse(text), stats: bad }));
      assert(d.ok && d.save.stats === null, `record: statistics with ${why} are dropped, the save still loads`);
    }
    // 不能存的時候
    assert.deepEqual([makeSave(createWorld(1), [], cam, ''), savable(createWorld(1))], [null, false], 'record: nothing to save before the first step');
    assert.equal(makeSave(createSandboxWorld(1), [], cam, ''), null, 'record: the sandbox is never saved');
    const sb = runningSandbox();
    assert(sb.tick > 0 && sb.winner < 0 && sb.sandbox?.running, 'fixture: a running sandbox whose clock has moved');
    assert.deepEqual([savable(sb), makeSave(sb, [], cam, '')], [false, null], 'record: a running sandbox is never saved');
    assert.equal(makeSave(world(seed, log, ticks), log, cam, 'x'.repeat(SAVE_MAX_TEXT)), null, 'record: a save that would be too large is not made');
    const over = world(seed, log, ticks); over.winner = 1;
    assert.equal(makeSave(over, log, cam, ''), null, 'record: a finished battle is never saved');
  },
  // 什麼時候存、什麼時候清（假的計時與離開事件；審查之後加的）
  lifecycle() {
    const [, seed, log, ticks] = BATTLES[0];
    const newStats = () => ({ start: [[3, 1, 1, 0], [3, 1, 1, 0]], fires: [4, 2], lastKill: null, endTick: -1 });
    const rig = (s = mem()) => {
      const timers = [], leaving = [], adopted = [];
      const st = { w: world(seed, log, ticks), log, battle: true, replaying: false, stats: newStats() };
      const host = { world: () => st.w, log: () => st.log, battle: () => st.battle, replaying: () => st.replaying, cam: () => ({ x: 1, z: 2, zoom: 1.5 }), stats: () => st.stats,
        adopt: (w, lg, cam, stats) => { adopted.push({ w, lg, cam, stats }); st.w = w; st.log = lg; st.battle = true; st.stats = stats ?? newStats(); } };
      const saves = initSaves(host, s, { every: (fn, ms) => { timers.push([fn, ms]); }, onLeave: fn => { leaving.push(fn); } });
      const fire = ms => { for (const [fn, t] of timers) if (t === ms) fn(); };
      return { s, st, saves, adopted, timers, save5: () => fire(SAVE_EVERY_MS), watch: () => fire(SAVE_WATCH_MS), leave: () => { for (const fn of leaving) fn(); }, raw: () => s.getItem(SAVE_KEY),
        tick: () => { const r = s.getItem(SAVE_KEY); return r ? parse(r).tick : null; },
        decide: () => { st.w.winner = 0; st.stats.endTick = st.w.tick; },   // 分出勝負的那一步剛走完（戰報統計在這時記下步數）
        oneMore: () => { st.w.tick += 1; },                                 // 再走一步（R047 的重播在這一步開頭存好）
        swap: (w, battle) => { st.w = w; st.battle = battle; st.stats = newStats(); } };
    };
    let r = rig();
    assert.deepEqual(r.timers.map(t => t[1]).sort((a, b) => a - b), [SAVE_WATCH_MS, SAVE_EVERY_MS], 'fixture: one fast look and one 5 s save are scheduled');
    r.watch();
    assert.equal(r.raw(), null, 'timer: the fast look never saves');
    r.save5();
    assert.equal(r.tick(), ticks, 'timer: every 5 s a battle in progress is saved');
    r.save5(); r.save5();
    assert.equal(r.s.sets, 1, 'timer: nothing is rewritten while the world has not moved');
    runLog(r.st.w, log, ticks + 40); r.save5();
    assert.deepEqual([r.tick(), r.s.sets], [ticks + 40, 2], 'timer: once the world has moved the next save replaces the old one');
    r = rig(); r.st.battle = false; r.save5(); r.leave(); r.saves.saveNow();
    assert.equal(r.raw(), null, 'build: nothing is saved before the battle starts, by timer, on leaving, or when asked');
    r = rig(); r.leave();
    assert.equal(r.tick(), ticks, 'leave: leaving the page or going to the background saves');
    // 看重播：不存，播到結束也不清
    r = rig(); r.save5(); let kept = r.raw();
    r.swap(world(seed, log, 100), true); r.st.replaying = true; r.watch(); r.save5(); r.leave(); r.saves.saveNow();
    assert.equal(r.raw(), kept, 'replay: watching a replay neither overwrites nor clears the save');
    r.decide(); r.oneMore(); r.oneMore(); r.watch(); r.save5(); r.leave(); r.saves.saveNow();
    assert.equal(r.raw(), kept, 'replay: a replay that plays to its end does not clear the save either');
    // 沙盒（跑起來、時鐘有走）：不存不清
    r = rig(); r.save5(); kept = r.raw();
    r.swap(runningSandbox(), true); r.watch(); r.save5(); r.leave(); r.saves.saveNow();
    assert.equal(r.raw(), kept, 'sandbox: a running sandbox neither saves nor clears');
    // 打完：再走一步才清
    r = rig(); r.save5(); r.decide(); r.watch(); r.leave(); r.save5(); r.saves.saveNow();
    assert.equal(r.tick(), ticks, 'end: the save stays until the decided battle has run one more step (its replay is stored in that step)');
    r.oneMore(); r.watch();
    assert.equal(r.raw(), null, 'end: one step after the battle is decided the save is cleared');
    r = rig(); r.save5(); r.decide(); r.oneMore(); r.leave();
    assert.equal(r.raw(), null, 'end: leaving after the battle is decided clears it too');
    // 兩個分頁：只清自己存的
    r = rig(); r.save5(); r.s.setItem(SAVE_KEY, 'another tab wrote this'); r.decide(); r.oneMore(); r.watch(); r.leave(); r.saves.saveNow();
    assert.equal(r.raw(), 'another tab wrote this', 'tabs: a finished battle never clears a save this page did not write');
    r = rig(); r.s.setItem(SAVE_KEY, 'another tab wrote this'); r.decide(); r.oneMore(); r.watch(); r.leave(); r.save5();
    assert.equal(r.raw(), 'another tab wrote this', 'tabs: a page that never saved leaves the slot alone when its battle ends');
    // 打完（又走了一步）之後馬上換局（再來一局、重新開始）：下一次看、或下一次離開頁面的時候清掉
    r = rig(); r.save5(); r.decide(); r.oneMore(); r.swap(createWorld(5), false); r.watch();
    assert.equal(r.raw(), null, 'restart: a finished battle that was replaced before the next look is cleared at that look');
    r = rig(); r.save5(); r.decide(); r.oneMore(); r.swap(createWorld(5), false); r.leave();
    assert.equal(r.raw(), null, 'restart: or when the page is left before any look');
    // 分出勝負的那一步之後、下一步之前就換局：重播還沒存，存檔留著（下次接回去再打完一次）
    r = rig(); r.save5(); kept = r.raw(); r.decide(); r.swap(createWorld(5), false); r.watch(); r.leave();
    assert.equal(r.raw(), kept, 'restart: a battle replaced in the very step it was decided keeps its save (its replay was never stored)');
    // 沒打完就換局，接著的那一局打完、有人要它存：不會清到前一局的存檔
    r = rig(); r.save5(); kept = r.raw(); r.swap(world(seed, log, 50), true); r.decide(); r.oneMore(); r.saves.saveNow();
    assert.equal(r.raw(), kept, 'restart: asking to save in a later, finished battle never clears the unfinished one before it');
    // 沒打完就換局：存檔留著；之後這一頁別的局打完也不會清到它
    r = rig(); r.save5(); kept = r.raw(); r.swap(createWorld(5), false); r.watch(); r.leave();
    assert.equal(r.raw(), kept, 'restart: an unfinished battle that was replaced keeps its save');
    r.swap(world(seed, log, 50), true); r.decide(); r.oneMore(); r.watch(); r.leave();
    assert.equal(r.raw(), kept, 'restart: a later battle that ends without ever having saved does not clear it');
    // 接回：世界、紀錄、鏡頭、統計交給遊戲；接回來的這一局打完會清存檔
    const b = rig(r.s); b.swap(createWorld(1), false);
    assert.equal(b.saves.offer(), '萊伊 32×32 · 0:31 · 種子 61', 'resume: the save is offered by its map, time and seed');
    assert.equal(b.saves.resume(), true, 'resume: resuming succeeds');
    const got = b.adopted[0];
    assert(b.adopted.length === 1 && got.w.tick === ticks && hashWorld(got.w) === hashWorld(world(seed, log, ticks)), 'resume: the game is handed the saved world');
    assert.deepEqual([got.lg, got.cam, got.stats], [log, { x: 1, z: 2, zoom: 1.5 }, newStats()], 'resume: with its command log, camera and battle-report statistics');
    b.save5();
    assert.equal(b.raw(), kept, 'resume: nothing is rewritten until the resumed battle moves');
    b.decide(); b.oneMore(); b.watch();
    assert.equal(b.raw(), null, 'resume: finishing the resumed battle clears the save');
    const bad = mem(); bad.setItem(SAVE_KEY, kept.slice(0, 600));
    const c = rig(bad);
    assert.deepEqual([c.saves.offer(), c.saves.resume(), c.adopted.length], [null, false, 0], 'resume: a damaged save is neither offered nor resumed');
  },
  // 驗收 6：本機儲存
  store() {
    assert.equal(SAVE_KEY.startsWith('gtrts.v1.'), true, 'store: the key starts with gtrts.v1.');
    const [, seed, log, ticks] = BATTLES[0], text = makeSave(world(seed, log, ticks), log, null, '');
    const s = mem();
    assert.equal(readSave(s).ok, false, 'store: nothing stored reads as no save');
    assert.equal(writeSave(s, text), true, 'store: writing works');
    assert.equal(readSave(s).ok, true, 'store: what was written reads back');
    clearSave(s);
    assert.deepEqual([readSave(s).ok, s.m.size], [false, 0], 'store: clearing removes it');
    s.m.set(SAVE_KEY, text.slice(0, text.length >> 1));
    assert.equal(readSave(s).ok, false, 'store: a truncated save reads as no save');
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    assert.doesNotThrow(() => { readSave(throwing); writeSave(throwing, text); clearSave(throwing); clearSave(null); }, 'store: a storage that throws never breaks anything');
    assert.deepEqual([readSave(throwing).ok, writeSave(throwing, text), readSave(null).ok, writeSave(null, text)], [false, false, false, false], 'store: a storage that throws, or none at all, means no save');
  },
};

// 舊存檔還讀得回來：tools/save-v1.txt 是 R074 上線時存的一局（萊伊、第 620 步）。以後的版本要嘛照樣讀得回來、接著打一模一樣，要嘛把 SAVE_VERSION 加一。
// 往世界加新的選用欄位不會讓這裡變紅（舊存檔沒有那個欄位，照樣讀、照樣打）；會變紅的是舊存檔讀不回來、或接著打的結果變了。
const OLD_SAVE = new URL('../tools/save-v1.txt', import.meta.url), OLD_SAVE_300_LATER = '475fb070';
const oldSave = () => { const [, seed, log, ticks] = BATTLES[0]; return makeSave(world(seed, log, ticks), log, { x: 20.5, z: 22, zoom: 1.4 }, '2026-11-15T00:00:00.000Z', { start: [[3, 1, 1, 0], [3, 1, 1, 0]], fires: [12, 9], lastKill: null, endTick: -1 }); };
groups.old = () => {
  const fix = 'Old saves must keep working: either restore the behaviour, or add one to SAVE_VERSION in src/ui/saveGame.ts (saves that players made before are then ignored), rename this file for the new version and rewrite it with `node tests/savegame.mjs write-old`.';
  const text = readFileSync(OLD_SAVE, 'utf8'), l = checkSave(text);
  assert.equal(parse(text).v, SAVE_VERSION, `old save: the kept save is of the current version. ${fix}`);
  assert(l.ok, `old save: a save written when R074 shipped still loads (${l.ok ? '' : l.why}). ${fix}`);
  assert.equal(hashWorld(runLog(l.save.world, l.save.log, l.save.world.tick + 300)), OLD_SAVE_300_LATER, `old save: it continues into the same battle as when it was written. ${fix}`);
};

const only = process.argv[2];
if (only === 'write-old') { const text = oldSave(); writeFileSync(OLD_SAVE, text); console.log(`wrote tools/save-v1.txt (${text.length} chars); OLD_SAVE_300_LATER = '${hashWorld(runLog(checkSave(text).save.world, BATTLES[0][2], BATTLES[0][3] + 300))}'`); process.exit(0); }
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`savegame/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK savegame/${name}`); }

// ---- 接線與閥（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts'), valves = read('../src/valves.ts'), menu = read('../src/ui/startMenu.ts');
  const { menuLayout } = await import('../src/ui/startMenu.ts');
  assert.match(valves, /get r074\(\) \{ return on\('074'\); \}/, 'valve: r074 is on the table');
  assert.equal((main.match(/const saves = V\.r074 && V\.r069 \? initSaves\(/g) ?? []).length, 1, 'wiring: main.ts creates the saves once, only with the valve on and only when there is a start menu to continue from');
  assert.equal((main.match(/initSaves\(/g) ?? []).length, 1, 'wiring: nothing else creates saves');
  assert.match(main, /saved: saves\?\.offer, resume: saves\?\.resume, saveNow: saves\?\.saveNow/, 'wiring: the start menu gets the save actions');
  assert.match(menu, /if \(id === 'sm-main'\) \{ host\.saveNow\?\.\(\);/, 'wiring: 回主選單 saves first');
  const base = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye', 'large', 'town'], modes: ['battle', 'zombies', 'sandbox'], aiOn: true, rye: true, tutorial: true, audio: false, resume: false };
  assert.deepEqual(menuLayout({ ...base, saved: '萊伊 32×32 · 0:31 · 種子 61' }).main, [{ id: 'sm-continue', label: '繼續上一局', sub: '萊伊 32×32 · 0:31 · 種子 61' }, { id: 'sm-start', label: '開始' }], 'layout: with a save 繼續上一局 comes first, then 開始');
  assert.deepEqual(menuLayout(base).main, [{ id: 'sm-start', label: '開始' }], 'layout: without a save the menu is unchanged');
  assert.deepEqual(menuLayout({ ...base, resume: true, saved: 'x' }).main.map(i => i.id), ['sm-resume', 'sm-continue', 'sm-restart'], 'layout: the build-phase menu opened from the 選單 key offers it too, between 繼續 and 重新開始');
  assert.deepEqual(menuLayout({ ...base, resume: true }).main.map(i => i.id), ['sm-resume', 'sm-restart'], 'layout: without a save that menu is unchanged');
  assert.deepEqual(menuLayout({ ...base, kind: 'pause', resume: true, saved: 'x' }).main.map(i => i.id), ['sm-resume', 'sm-restart', 'sm-main'], 'layout: the pause menu does not offer it');
  assert.match(read('../tools/cdp.mjs'), /localStorage\.removeItem\('gtrts\.v1\.save'\)/, 'harness: cdp open() clears the save unless a guard keeps it');
  assert.match(read('../AGENTS.md'), /gtrts\.v1\.save/, 'rules: AGENTS.md tells guard writers the save is cleared');
  console.log('OK savegame/wiring');
}

// ---- 故意弄壞（驗收 7）----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r074-negative-'));
const mutants = [
  ['crater_dropped', 'codec', 'src/sim/worldCodec.ts', 'crater: pack(w.crater),', 'crater: pack(new Uint8Array(w.crater.length)),', 'codec: 萊伊：布陣、戰壕、鐵絲網、補給、煙幕、高爆 has the same hash after encode → text → decode'],
  ['count_unchecked', 'decode', 'src/sim/worldCodec.ts', '  return at === into.length ? into : null;', '  return into;', 'decode: rejects a size that does not match the tables'],
  ['hash_unchecked', 'record', 'src/ui/saveGame.ts', "    if (hashWorld(world) !== r.hash) return no('存檔的內容跟它記的雜湊對不上');\n", '', 'record: a world that does not match its hash is refused with a reason'],
  ['sum_unchecked', 'record', 'src/ui/saveGame.ts', "    if (textSum(body) !== text.slice(0, 8)) return no('存檔壞了（檢查碼對不上）');\n", '', 'record: a save with one damaged field name is refused by the checksum'],
  ['shape_unchecked', 'decode', 'src/sim/worldCodec.ts', '!r.units.every(unitOk) || ', '', 'decode: rejects a unit missing a field the simulation needs'],
  ['kind_unchecked', 'decode', 'src/sim/worldCodec.ts', ' && u.kind >= 0 && u.kind < UNIT_KINDS.length', '', 'decode: rejects a unit of a kind that does not exist'],
  ['bld_id_unchecked', 'decode', 'src/sim/worldCodec.ts', 'ints(b, BLD_INTS) && b.id === i + 1', 'ints(b, BLD_INTS)', 'decode: rejects a building whose id is not its place in the list'],
  ['sandbox_saved', 'record', 'src/ui/saveGame.ts', 'export const savable = (w: World): boolean => !w.sandbox && w.winner < 0 && w.tick > 0;', 'export const savable = (w: World): boolean => w.winner < 0 && w.tick > 0;', 'record: a running sandbox is never saved'],
  ['early_clear', 'lifecycle', 'src/ui/saveGame.ts', 'if (ownerStats.endTick >= 0 && owner.tick > ownerStats.endTick) {', 'if (ownerStats.endTick >= 0) {', 'end: the save stays until the decided battle has run one more step (its replay is stored in that step)'],
  ['clears_others', 'lifecycle', 'src/ui/saveGame.ts', 'if (mine !== null && rawSave(store) === mine) clearSave(store);', 'if (mine !== null) clearSave(store);', 'tabs: a finished battle never clears a save this page did not write'],
  ['replay_saves', 'lifecycle', 'src/ui/saveGame.ts', 'if (!host.battle() || host.replaying() || w.winner >= 0) return false;', 'if (!host.battle() || w.winner >= 0) return false;', 'replay: watching a replay neither overwrites nor clears the save'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'src/ui'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    for (const f of ['saveGame.ts', 'replayStore.ts']) cpSync(join(root, 'src/ui', f), join(dir, 'src/ui', f));
    cpSync(join(root, 'tests/savegame.mjs'), join(dir, 'tests/savegame.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/savegame.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: intended assertion must fail first, got ${output.slice(-1500)}`);
    console.log(`OK savegame-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`savegame: all groups OK, ${mutants.length} isolated mutants rejected`);
