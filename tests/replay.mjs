// R047 重播：不開瀏覽器的部分。指令檢查、紀錄格式（第 1 版）、來回重播、本機儲存、接線。
// 用法：node tests/replay.mjs            全部跑，另外把指令檢查故意弄壞（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/replay.mjs <群組名>   只跑那一群（隔離副本裡用；只有 check 這一群不需要 src/ui）
// 真實 Chrome 在 tests/replay-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY, UK_TANK } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { MAP_RYE } from '../src/sim/maps.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { isCommand, checkLog, MAX_IDS, MAX_LOG, MAX_TICK } from '../src/sim/commandCheck.ts';

const GOOD = [
  { t: 'map', id: 1, vegetation: 1 }, { t: 'map', id: 0 }, { t: 'rules', force: 3, income: 1 }, { t: 'rules' }, { t: 'zombies' },
  { t: 'build', side: 0, kind: 0, x: 20, z: 27, rot: 1 }, { t: 'build', side: 1, kind: 6, x: 3, z: 3 }, { t: 'trench', side: 0, kind: 0, x: 22, z: 25, rot: 0 },
  { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1 }, { t: 'eco' }, { t: 'ai', side: 1, level: 2 }, { t: 'produce', side: 0, kind: 0 },
  { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 }, { t: 'move', side: 0, ids: [], x: 0, z: 0 }, { t: 'attack', side: 0, ids: [1], target: 5 },
  { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 }, { t: 'fireAt', side: 0, ids: [4], x: 24, z: 24, ammo: 'smoke' },
  { t: 'fireDiscipline', side: 0, ids: [1, 4], hold: true }, { t: 'stop', side: 0, ids: [1] },
  { t: 'sandboxPlace', side: 1, kind: 0, x: 5, z: 5 }, { t: 'sandboxRun', running: true }, { t: 'sandboxReset' },
];
const BAD = [
  null, undefined, 7, 'move', [], [{ t: 'stop', side: 0, ids: [] }], {}, { t: 7 }, { t: 'teleport', side: 0, ids: [1] },
  { t: 'move', side: 0, x: 1, z: 1 }, { t: 'move', side: 0, ids: 'all', x: 1, z: 1 }, { t: 'move', side: 0, ids: [1.5], x: 1, z: 1 }, { t: 'move', side: 0, ids: ['1'], x: 1, z: 1 },
  { t: 'move', side: 0, ids: Array(MAX_IDS + 1).fill(1), x: 1, z: 1 }, { t: 'move', side: 2, ids: [1], x: 1, z: 1 }, { t: 'move', side: 0, ids: [1], x: 1.5, z: 1 },
  { t: 'move', side: 0, ids: [1], x: 1 }, { t: 'move', side: 0, ids: [1], x: 1e12, z: 1 }, { t: 'move', side: 0, ids: [1], x: NaN, z: 1 },
  { t: 'attack', side: 0, ids: [1] }, { t: 'fireAt', side: 0, ids: [4], x: 1, z: 1, ammo: 'he' }, { t: 'fireDiscipline', side: 0, ids: [1], hold: 1 },
  { t: 'stop', side: 0 }, { t: 'build', side: 0, kind: 0, x: 1 }, { t: 'build', side: 0, kind: 0, x: 1, z: 1, rot: 'x' }, { t: 'ai', side: 1 }, { t: 'map' },
  { t: 'eco', inf: 'yes' }, { t: 'produce', side: 0 }, { t: 'rules', force: '3' }, { t: 'sandboxRun', running: 1 }, { t: 'sandboxPlace', side: 0, kind: 0, x: 1 },
];

// 一局真的仗：萊伊、精簡兵力、快補給、布陣一棟、補給全開、雙方都交給電腦；跑到分出勝負或 limit 步
export function battle(seed = 47, limit = 1200) {
  const log = [
    ...[{ t: 'map', id: MAP_RYE, vegetation: 1 }, { t: 'rules', force: 1, income: 3 }, { t: 'build', side: SIDE_PLAYER, kind: 0, x: 20, z: 27, rot: 0 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 1 }].map(cmd => ({ tick: 0, cmd })),
    { tick: 60, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_TANK } }, { tick: 200, cmd: { t: 'fireDiscipline', side: SIDE_PLAYER, ids: [1, 2], hold: true } }, { tick: 260, cmd: { t: 'fireDiscipline', side: SIDE_PLAYER, ids: [1, 2], hold: false } },
  ];
  const w = createWorld(seed);
  let i = 0;
  while (w.tick < limit && w.winner < 0) runLog(w, log, w.tick + 1), i++;
  return { seed, log, w, steps: i };
}

const groups = {
  // 驗收 1–3：指令檢查
  check() {
    for (const c of GOOD) assert.equal(isCommand(c), true, `check: accepts ${JSON.stringify(c)}`);
    assert.deepEqual([...new Set(GOOD.map(c => c.t))].sort(), ['ai', 'attack', 'build', 'eco', 'fireAt', 'fireDiscipline', 'map', 'move', 'produce', 'rules', 'sandboxPlace', 'sandboxReset', 'sandboxRun', 'stop', 'trench', 'zombies'], 'fixture: every command type the game can log has a good example');
    for (const e of SCRIPT) assert.equal(isCommand(e.cmd), true, `check: accepts the scripted battle command ${JSON.stringify(e.cmd)}`);
    for (const c of BAD) assert.equal(isCommand(c), false, `check: rejects ${JSON.stringify(c)?.slice(0, 80)}`);
    assert.equal(isCommand({ t: 'move', side: 0, ids: Array(MAX_IDS).fill(1), x: 1, z: 1 }), true, 'check: exactly MAX_IDS units is still fine');
    assert.equal(isCommand({ t: 'stop', side: 0, ids: [1], note: 'extra fields are ignored by step()' }), true, 'check: unknown extra fields are tolerated');
    assert.equal(checkLog(SCRIPT), null, 'log: the scripted battle passes');
    assert.equal(checkLog([]), null, 'log: an empty log passes');
    assert.match(checkLog([{ tick: 0, cmd: GOOD[0] }, { tick: 3, cmd: BAD[9] }]) ?? '', /第 2 筆/, 'log: a bad command is reported with its position');
    for (const [bad, why] of [[null, 'not an array'], [{ length: 1 }, 'array-like'], [[null], 'null entry'], [[{ tick: -1, cmd: GOOD[0] }], 'negative tick'], [[{ tick: 0.5, cmd: GOOD[0] }], 'fractional tick'],
      [[{ tick: MAX_TICK + 1, cmd: GOOD[0] }], 'tick past the limit'], [[{ tick: 5, cmd: GOOD[0] }, { tick: 4, cmd: GOOD[0] }], 'tick going backwards'], [[{ cmd: GOOD[0] }], 'missing tick']]) {
      assert.equal(typeof checkLog(bad), 'string', `log: rejects ${why}`);
    }
    assert.equal(typeof checkLog(Array(MAX_LOG + 1).fill({ tick: 0, cmd: { t: 'zombies' } })), 'string', 'log: rejects more than MAX_LOG entries');
    assert.equal(checkLog([{ tick: 5, cmd: GOOD[0] }, { tick: 5, cmd: GOOD[1] }]), null, 'log: several commands may share a tick');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`replay/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK replay/${name}`); }

// ---- 紀錄格式、來回、儲存、接線（需要 src/ui，不在隔離副本裡跑）----
{
  const { makeRecord, checkRecord, encodeReplay, decodeReplay, loadReplays, addReplay, replayTitle, sameReplay, REPLAY_KEY, REPLAY_KEEP, REPLAY_MAX_TEXT, REPLAY_BUDGET } = await import('../src/ui/replayStore.ts');
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  // 驗收 4：來回
  const b = battle();
  assert(b.w.eco && b.w.rules && b.w.ai?.length === 2 && b.w.blds.some(x => x.builtBy === SIDE_PLAYER), 'fixture: the battle has rules, headquarters, both AIs and a built house');
  assert(b.w.tick >= 300, `fixture: the battle ran long enough to matter (${b.w.tick} ticks, winner ${b.w.winner})`);
  const rec = makeRecord(b.seed, b.w.tick, hashWorld(b.w), [...b.log, { tick: b.w.tick, cmd: { t: 'stop', side: 0, ids: [1] } }], { map: b.w.map ?? 0, n: b.w.n, winner: b.w.winner, seconds: Math.floor(b.w.tick / 20) }, '2026-11-13T12:00:00.000Z');
  assert.equal(rec.log.length, b.log.length, 'record: commands issued at the save tick itself (not yet applied) are left out');
  assert.notEqual(rec.log, b.log, 'record: the log is a copy');
  const text = encodeReplay(rec), back = decodeReplay(text);
  assert.equal(back.ok, true, `round trip: the text decodes (${back.ok ? '' : back.why})`);
  assert.deepEqual(back.rec, rec, 'round trip: decoding gives the same record');
  assert.equal(hashWorld(runLog(createWorld(back.rec.seed), back.rec.log, back.rec.ticks)), rec.hash, 'round trip: replaying the decoded record reaches the recorded hash');
  assert.equal(hashWorld(runLog(createWorld(back.rec.seed + 1), back.rec.log, back.rec.ticks)) === rec.hash, false, 'round trip: the hash really depends on the battle (another seed differs)');
  // 驗收 5：讀檔
  const bad = (change, name) => { const d = decodeReplay(typeof change === 'string' ? change : JSON.stringify({ ...rec, ...change })); assert(d.ok === false && typeof d.why === 'string' && d.why.length > 0, `decode: rejects ${name} with a reason`); return d.why; };
  bad('not json {', 'text that is not JSON'); bad('[]', 'an array'); bad('null', 'null');
  assert.match(bad({ v: 2 }, 'version 2'), /版本/, 'decode: says the version is unknown');
  bad({ seed: undefined }, 'a missing seed'); bad({ seed: -1 }, 'a negative seed'); bad({ seed: 2 ** 32 }, 'a seed above 32 bits');
  bad({ ticks: -5 }, 'negative ticks'); bad({ ticks: 0 }, 'zero ticks'); bad({ ticks: 1.5 }, 'fractional ticks'); bad({ hash: 'xyz' }, 'a hash that is not 8 hex digits');
  assert.match(bad({ log: [{ tick: 0, cmd: { t: 'move', side: 0, x: 1, z: 1 } }] }, 'a bad command'), /第 1 筆/, 'decode: points at the bad command');
  bad('x'.repeat(REPLAY_MAX_TEXT + 1), 'an oversized file');
  // 審查找到的：超深的巢狀陣列會讓 String() 爆堆疊；不管塞什麼都只能回「讀不出來」，不能丟例外
  for (const field of ['v', 'seed', 'hash', 'log', 'meta', 'at']) assert.doesNotThrow(() => decodeReplay(JSON.stringify(rec).replace(`"${field}":`, `"${field}":${'['.repeat(5000)}${']'.repeat(5000)},"x${field}":`)), `decode: a 5,000-deep array in ${field} never throws`);
  assert.equal(decodeReplay(`{"v":${'['.repeat(5000)}${']'.repeat(5000)}}`).ok, false, 'decode: a 5,000-deep version is refused, not thrown');
  const loose = decodeReplay(JSON.stringify({ v: 1, seed: rec.seed, ticks: rec.ticks, hash: rec.hash, log: rec.log, future: { anything: true } }));
  assert(loose.ok && loose.rec.at === '' && loose.rec.meta.seconds === Math.floor(rec.ticks / 20) && !('future' in loose.rec), 'decode: a version-1 record without meta or date, with unknown extra fields, still loads');
  assert.equal(checkRecord({ ...rec, meta: { map: 'x', n: -3, winner: 9, seconds: 'long' } }).rec.meta.winner, -1, 'decode: nonsense display data falls back to defaults instead of failing');
  assert.deepEqual(replayTitle(rec).label.includes('萊伊'), true, 'title: names the map');
  // 驗收 6：儲存（假的 storage）
  const mem = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
  assert.equal(REPLAY_KEY.startsWith('gtrts.v1.'), true, 'storage: the key starts with gtrts.v1.');
  const s = mem();
  assert.deepEqual(loadReplays(s), [], 'storage: empty at first');
  for (let i = 0; i < REPLAY_KEEP + 2; i++) addReplay(s, { ...rec, seed: i, at: `2026-11-13T12:00:${String(i).padStart(2, '0')}.000Z` });
  const kept = loadReplays(s);
  assert.deepEqual(kept.map(r => r.seed), Array.from({ length: REPLAY_KEEP }, (_, i) => REPLAY_KEEP + 1 - i), 'storage: keeps the newest ten, newest first');
  addReplay(s, kept[3]);
  assert.deepEqual(loadReplays(s).map(r => r.seed).slice(0, 2), [kept[3].seed, kept[0].seed], 'storage: saving the same battle again moves it to the front instead of duplicating');
  assert.equal(loadReplays(s).length, REPLAY_KEEP, 'storage: still ten after the duplicate');
  s.m.set(REPLAY_KEY, '{ broken'); assert.deepEqual(loadReplays(s), [], 'storage: broken text reads as empty');
  s.m.set(REPLAY_KEY, JSON.stringify([{ v: 9 }, rec, 'junk'])); assert.deepEqual(loadReplays(s).map(r => r.hash), [rec.hash], 'storage: bad entries are skipped, good ones kept');
  assert.deepEqual(addReplay(s, { ...rec, seed: 77 }).map(r => r.seed), [77, rec.seed], 'storage: adding after a partly broken list keeps the good entries');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadReplays(throwing), [], 'storage: a storage that throws reads as empty');
  assert.doesNotThrow(() => addReplay(throwing, rec), 'storage: a storage that throws never breaks saving');
  assert.deepEqual(loadReplays(null), [], 'storage: no storage at all reads as empty');
  let room = 3; const small = { ...mem(), setItem(k, v) { if (JSON.parse(v).length > room) throw new Error('quota'); this.m.set(k, v); } };
  for (let i = 0; i < 6; i++) addReplay(small, { ...rec, seed: 100 + i });
  assert.deepEqual(loadReplays(small).map(r => r.seed), [105, 104, 103], 'storage: when space runs out the oldest are dropped until it fits');
  // 審查找到的：一直存不進去時，回傳的要是本機真的存著的列表（舊的還在、新的不在），不是空的
  const stuck = mem(); for (const seed of [1, 2]) addReplay(stuck, { ...rec, seed });
  stuck.setItem = () => { throw new Error('quota'); };
  const after = addReplay(stuck, { ...rec, seed: 3 });
  assert.deepEqual([after.map(r => r.seed), after.some(r => sameReplay(r, { ...rec, seed: 3 }))], [[2, 1], false], 'storage: when nothing can be written the old list is returned and the new record is not in it');
  // 總量上限：這個網域跟另外三條線共用本機空間
  const fatLog = Array.from({ length: 9000 }, () => ({ tick: 5, cmd: { t: 'stop', side: 0, ids: [1, 2, 3] } })), fat = seed => ({ ...rec, seed, log: fatLog });
  assert(JSON.stringify(fat(1)).length > REPLAY_BUDGET / 4 && JSON.stringify(fat(1)).length < REPLAY_MAX_TEXT, 'fixture: a fat record is big but importable');
  const roomy = mem(); for (let seed = 1; seed <= 6; seed++) addReplay(roomy, fat(seed));
  assert(roomy.m.get(REPLAY_KEY).length <= REPLAY_BUDGET && loadReplays(roomy)[0].seed === 6 && loadReplays(roomy).length < 6, `storage: the total stays inside the budget by dropping the oldest (${loadReplays(roomy).length} kept, ${roomy.m.get(REPLAY_KEY).length} chars)`);
  const huge = { ...rec, seed: 9, log: Array.from({ length: 30000 }, () => ({ tick: 5, cmd: { t: 'stop', side: 0, ids: [1, 2, 3] } })) };
  assert(JSON.stringify(huge).length > REPLAY_MAX_TEXT, 'fixture: the huge record is past the import limit');
  assert.deepEqual(addReplay(roomy, huge).map(r => r.seed), loadReplays(roomy).map(r => r.seed), 'storage: a record too big to import back is not stored and the list is left alone');
  assert.equal(loadReplays(roomy).some(r => r.seed === 9), false, 'storage: the huge record is not in the list');
  // 審查找到的：看重播時戰報不能改到自己的喪屍最佳紀錄
  {
    const { zombiesBest } = await import('../src/ui/zombiesMode.ts');
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), data = new Map([['gtrts.v1.zombies.best', '4']]);
    try {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) } });
      assert.deepEqual([zombiesBest(9, false), data.get('gtrts.v1.zombies.best')], [4, '4'], 'zombies: while watching a replay the best wave is read, not raised');
      assert.deepEqual([zombiesBest(9), data.get('gtrts.v1.zombies.best')], [9, '9'], 'zombies: an ordinary battle still raises it');
    } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; }
    assert.match(read('../src/ui/reportView.ts'), /zombiesBest\(r\.zombies\.wave, document\.getElementById\('replay-bar'\)\?\.hidden !== false\)/, 'zombies: the report only saves the best wave when no replay bar is showing');
  }
  // 接線與閥
  const main = read('../src/main.ts'), valves = read('../src/valves.ts');
  assert.match(valves, /get r047\(\) \{ return on\('047'\); \}/, 'valve: r047 is on the table');
  assert.equal((main.match(/const replay = V\.r047 \? initReplay\(/g) ?? []).length, 1, 'wiring: main.ts creates the replay once, only with the valve on');
  assert.match(main, /const now = replay\?\.feed\(w, pending\) \?\? pending; pending = \[\];/, 'wiring: tick() asks the replay first, then falls back to the player commands');
  assert.match(read('../tools/cdp.mjs'), /gtrts\.v1\.replays/, 'harness: cdp open() clears stored replays unless a guard keeps them');
  assert.match(read('../AGENTS.md'), /keep: true/, 'rules: AGENTS.md tells guard writers about { keep: true }');
  console.log('OK replay/record, round trip, decode, storage, wiring');
}

// ---- 故意弄壞（驗收 7）----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r047-negative-'));
const mutants = [
  ['ids_unchecked', 'commandCheck.ts', "const ids = (v: unknown): boolean => Array.isArray(v) && v.length <= MAX_IDS && v.every(int);", 'const ids = (v: unknown): boolean => Array.isArray(v) && v.length <= MAX_IDS;', 'check: rejects {"t":"move","side":0,"ids":[1.5],"x":1,"z":1}'],
  ['ticks_backwards', 'commandCheck.ts', "    if (e.tick < last) return `第 ${i + 1} 筆的步數往回走`;\n", '', 'log: rejects tick going backwards'],
];
try {
  for (const [name, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/replay.mjs'), join(dir, 'tests/replay.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/replay.mjs'), 'check'], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: intended assertion must fail first, got ${output.slice(-1500)}`);
    console.log(`OK replay-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`replay: all OK, ${mutants.length} isolated mutants rejected`);
