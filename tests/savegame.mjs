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
import { runLog } from '../src/sim/step.ts';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { encodeWorld, decodeWorld, CODEC_MAX_N } from '../src/sim/worldCodec.ts';
import { SAVE_KEY, SAVE_VERSION, SAVE_MAX_TEXT, makeSave, checkSave, readSave, writeSave, clearSave, saveTitle, savable } from '../src/ui/saveGame.ts';

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
const mem = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; };

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
      const d = checkSave(typeof change === 'string' ? change : (() => { const x = JSON.parse(text); change(x); return JSON.stringify(x); })());
      assert(d.ok === false && d.why.length > 0, `record: ${why} is refused with a reason`);
      if (expect) assert.match(d.why, expect, `record: ${why} says why (${d.why})`);
    };
    refused('{ not json', 'text that is not JSON'); refused('[]', 'an array'); refused(x => { x.v = 2; }, 'version 2', /版本/);
    refused(x => { x.world.units[0].hp += 1; }, 'a world that does not match its hash', /雜湊/);
    refused(x => { x.tick += 1; }, 'a tick that disagrees with the world'); refused(x => { x.seed += 1; }, 'a seed that disagrees with the world');
    refused(x => { x.hash = 'xyz'; }, 'a hash that is not 8 hex digits'); refused(x => { x.log = [{ tick: 0, cmd: { t: 'move', side: 0, x: 1, z: 1 } }]; }, 'a log with a malformed command', /第 1 筆/);
    refused(x => { x.log = [...x.log, { tick: x.tick + 5, cmd: { t: 'stop', side: 0, ids: [1] } }]; }, 'a log that runs past the world');
    refused(x => { delete x.world.n; }, 'a world that does not decode');
    refused(`${' '.repeat(SAVE_MAX_TEXT)}${text}`, 'an oversized save');
    // 已經分出勝負、沙盒：連雜湊都對也不給接
    const rehash = change => { const x = JSON.parse(text); change(x.world); x.hash = hashWorld(decodeWorld(JSON.parse(JSON.stringify(x.world)))); return JSON.stringify(x); };
    assert.match(checkSave(rehash(v => { v.winner = 0; })).why ?? '', /勝負/, 'record: a finished battle is refused even with a matching hash');
    assert.match(checkSave(rehash(v => { v.sandbox = { version: 1, running: false, frame: 3 }; })).why ?? '', /沙盒/, 'record: a sandbox world is refused even with a matching hash');
    const stuck = rehash(v => { v.units[0].kind = 999; });   // 雜湊算得出來、也對得上，但走一步就會丟例外
    assert.doesNotThrow(() => checkSave(stuck), 'record: a world that cannot step never throws');
    assert.match(checkSave(stuck).why ?? '', /走不動/, 'record: a world that cannot step is refused');
    const mangled = (() => { const x = JSON.parse(text); x.world.units = [{ id: 1 }]; return JSON.stringify(x); })();   // 連雜湊都算不出來
    assert.doesNotThrow(() => checkSave(mangled), 'record: a world that cannot even be hashed never throws');
    assert.equal(checkSave(mangled).ok, false, 'record: a world that cannot even be hashed is refused');
    assert.equal(checkSave(JSON.stringify({ ...JSON.parse(text), cam: { x: 'left' } })).save.cam, null, 'record: a nonsense camera is dropped, the save still loads');
    // 戰報統計跟著存；形狀不對就丟掉統計，存檔照樣能用
    const stats = { start: [[3, 1, 1, 0], [3, 1, 1, 0]], fires: [12, 9], lastKill: { x: 5120, z: 4096, tick: 300 }, endTick: -1, bounces: [2, 0] };
    assert.equal(loaded.save.stats, null, 'record: a save made without statistics has none');
    assert.deepEqual(checkSave(makeSave(world(seed, log, ticks), log, cam, '', stats)).save.stats, stats, 'record: the battle-report statistics come back');
    assert.deepEqual(checkSave(makeSave(world(seed, log, ticks), log, cam, '', { ...stats, bounces: undefined, lastKill: null })).save.stats, { start: stats.start, fires: stats.fires, lastKill: null, endTick: -1 }, 'record: statistics without bounces or a last kill come back as they were');
    for (const [bad, why] of [[{ ...stats, fires: [1] }, 'a short row'], [{ ...stats, fires: [1, -1] }, 'a negative count'], [{ ...stats, start: [[1, 2, 3, 4]] }, 'one side only'], [{ ...stats, endTick: 50 }, 'an ended battle'], [{ ...stats, lastKill: { x: 'a', z: 0, tick: 0 } }, 'a nonsense last kill'], [{ ...stats, bounces: [1, 2, 3] }, 'three sides of bounces'], ['fires', 'a string']]) {
      const d = checkSave(JSON.stringify({ ...JSON.parse(text), stats: bad }));
      assert(d.ok && d.save.stats === null, `record: statistics with ${why} are dropped, the save still loads`);
    }
    // 不能存的時候
    assert.deepEqual([makeSave(createWorld(1), [], cam, ''), savable(createWorld(1))], [null, false], 'record: nothing to save before the first step');
    assert.equal(makeSave(createSandboxWorld(1), [], cam, ''), null, 'record: the sandbox is never saved');
    const over = world(seed, log, ticks); over.winner = 1;
    assert.equal(makeSave(over, log, cam, ''), null, 'record: a finished battle is never saved');
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

// 舊存檔還讀得回來：tools/save-v1.json 是 R074 上線時存的一局（萊伊、第 620 步）。以後的版本要嘛照樣讀得回來、接著打一模一樣，要嘛把 SAVE_VERSION 加一。
const OLD_SAVE = new URL('../tools/save-v1.json', import.meta.url), OLD_SAVE_300_LATER = '475fb070';
const oldSave = () => { const [, seed, log, ticks] = BATTLES[0]; return makeSave(world(seed, log, ticks), log, { x: 20.5, z: 22, zoom: 1.4 }, '2026-11-15T00:00:00.000Z', { start: [[3, 1, 1, 0], [3, 1, 1, 0]], fires: [12, 9], lastKill: null, endTick: -1 }); };
groups.old = () => {
  const fix = 'Old saves must keep working: either restore the behaviour, or add one to SAVE_VERSION in src/ui/saveGame.ts (saves that players made before are then ignored), rename this file for the new version and rewrite it with `node tests/savegame.mjs write-old`.';
  const text = readFileSync(OLD_SAVE, 'utf8'), l = checkSave(text);
  assert.equal(JSON.parse(text).v, SAVE_VERSION, `old save: the kept save is of the current version. ${fix}`);
  assert(l.ok, `old save: a save written when R074 shipped still loads (${l.ok ? '' : l.why}). ${fix}`);
  assert.equal(hashWorld(runLog(l.save.world, l.save.log, l.save.world.tick + 300)), OLD_SAVE_300_LATER, `old save: it continues into the same battle as when it was written. ${fix}`);
  assert.equal(oldSave(), text, `old save: the same battle saved today gives the same text. ${fix}`);
};

const only = process.argv[2];
if (only === 'write-old') { const text = oldSave(); writeFileSync(OLD_SAVE, text); console.log(`wrote tools/save-v1.json (${text.length} chars); OLD_SAVE_300_LATER = '${hashWorld(runLog(checkSave(text).save.world, BATTLES[0][2], BATTLES[0][3] + 300))}'`); process.exit(0); }
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
  assert.deepEqual(menuLayout({ ...base, resume: true, saved: 'x' }).main.map(i => i.id), ['sm-resume', 'sm-restart'], 'layout: the menu opened from the 選單 key does not offer it');
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
