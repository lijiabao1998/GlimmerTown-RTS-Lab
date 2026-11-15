// R078 難度校正（電腦第三版）：不開瀏覽器的部分。版本旗標與第一、二版逐位不變；生產規則（主力優先、支援按比例；簡單照第一版）；
// 第三版真的用新的生產、第二版照舊；決定性與存檔。
// 用法：node tests/ai3.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/ai3.mjs <群組名>   只跑那一群（隔離副本裡用）
// 難度的高下（困難＞普通＞簡單）在 tests/ai3-duel.mjs；真實 Chrome 在 tests/ai3-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { setAi, aiThink, ARMOR_MEMORY } from '../src/sim/ai.ts';
import { produce3, isCore, SUPPORT_RATIO, CORE_FIRST, QUEUE_MAX } from '../src/sim/ai3.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { duel } from '../tools/duel.mjs';

assert.deepEqual([SUPPORT_RATIO, CORE_FIRST, QUEUE_MAX, ARMOR_MEMORY], [2, 4, 2, 1200], 'fixture: the numbers on the card are the numbers in src/sim/ai3.ts');
const ME = SIDE_ENEMY;   // 受測的電腦放在敵方那一側（左上角是它的家）
const O = UK_OBSERVER, T = UK_TANK, I = UK_INFANTRY, H = UK_HOWITZER, A = UK_ATGUN, M = UK_MORTAR, C = UK_ARMORED_CAR, D = UK_DESTROYER, S = UK_ASSAULT, L = UK_LIGHT, V = UK_HEAVY;
const NAME = k => (k === null ? 'nothing' : UNIT_KINDS[k].name);
const ALL = { inf: 1, guns: 1, tanks: 1, armor2: 1 }, PLAIN = { inf: 1, guns: 1 };   // PLAIN：沒有特種車可造，試比例的時候不讓它們攪進來
const tanks = n => Array(n).fill(T);
// 一片空地、雙方各一棟指揮部；受測的一方有這些單位（kinds）、這些補給與佇列
function camp(level, kinds, { flags = ALL, supply = 999, queue = [], armorAt, v = 3 } = {}) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  const house = (x, z) => { const b = { id: w.blds.length + 1, kind: 0, x, z, w: 1, d: 1, floors: 1, hp: 400, maxHp: 400 }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
  const mineHq = house(3, 3), theirs = house(27, 27);
  w.eco = { supply: [0, supply], hq: [theirs.id, mineHq.id], queue: [[], queue.slice()], prog: [0, 0], ...flags };
  kinds.forEach((kind, i) => { const k = UNIT_KINDS[kind]; w.units.push({ id: w.units.length + 1, side: ME, kind, x: center(5 + (i % 8)), z: center(5 + Math.floor(i / 8)), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) }); });
  setAi(w, ME, level, v);
  const st = w.ai.find(a => a.side === ME);
  if (armorAt !== undefined) st.armor = armorAt;
  return { w, st, mineHq, mine: w.units.filter(u => u.alive && u.side === ME) };
}
const foeTank = () => ({ id: 999, side: SIDE_PLAYER, kind: T, alive: true });
const wants = (level, kinds, opts = {}, seen = []) => { const c = camp(level, kinds, opts); return produce3(c.w, c.st, c.mine, seen); };
// 第一版在同一個場面要造什麼（照它自己的 aiThink）。v 傳 0＝第一版（不能傳 undefined：那會落到 camp 的預設值 3）
const firstWants = (level, kinds, opts = {}) => { const c = camp(level, kinds, { ...opts, v: 0 }); return aiThink(c.w, { ...c.st }, () => false).find(x => x.t === 'produce')?.kind ?? null; };
const is = (got, want, message) => assert.equal(NAME(got), NAME(want), message);

// 第二版對第二版在這張卡之前（main d904427）的雜湊：[地圖, 規則, 我方難度, 敵方難度, 雜湊]，種子 31＋地圖、帶 end、3,000 步
const SECOND_BEFORE = [[0, null, 3, 2, '793ecc38'], [0, null, 1, 3, '201941a8'], [0, { ap: 1, morale: 2 }, 3, 2, '250de2dd'], [0, { ap: 1, morale: 2 }, 1, 3, '6a9ae783'],
  [1, null, 3, 2, '56bee0bf'], [1, null, 1, 3, 'd789c081'], [1, { ap: 1, morale: 2 }, 3, 2, '534896f7'], [1, { ap: 1, morale: 2 }, 1, 3, 'c41f5692']];

const groups = {
  // 驗收 1、2：旗標；第二版逐位不變
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    for (const [map, rules, la, lb, hash] of SECOND_BEFORE)
      assert.equal(duel({ map, seed: 31 + map, ticks: 3000, rules, end: true, a: { level: la, v: 2 }, b: { level: lb, v: 2 } }).hash, hash, `flag: second version against second version on map ${map} with ${JSON.stringify(rules)} (levels ${la} and ${lb}) is bit for bit what it was before this card`);
    const two = createWorld(3), three = createWorld(3);
    setAi(two, ME, 3, 2); setAi(three, ME, 3, 3);
    assert.deepEqual([two.ai[0].v, three.ai[0].v], [2, 3], 'flag: v 3 is stored as the third version');
    assert.notEqual(hashWorld(two), hashWorld(three), 'flag: the second and third versions hash differently');
    for (const v of [0, 1, 4, 2.5, '3']) { const w = createWorld(3); setAi(w, ME, 3, v); assert.equal(w.ai[0].v, undefined, `flag: v ${JSON.stringify(v)} is the first version`); }
    setAi(three, ME, 1, 2);
    assert.deepEqual([three.ai[0].level, three.ai[0].v], [1, 3], 'flag: sending ai again changes the level, not the version');
    assert.equal(isCommand({ t: 'ai', side: 1, level: 2, v: 3 }), true, 'flag: the command check takes v 3');
    const log = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 2, v: 3 }].map(cmd => ({ tick: 0, cmd }));
    const mid = runLog(createWorld(41), log, 1500), direct = hashWorld(runLog(createWorld(41), log, 2800));
    assert(mid.ai.every(a => a.v === 3), 'fixture: both sides run the third version');
    assert.equal(hashWorld(runLog(structuredClone(mid), log, 2800)), direct, 'flag: a deep copy of a third-version battle continues bit for bit');
    assert.deepEqual(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(mid)))), { ...mid, events: [] }, 'flag: a third-version battle survives the save codec field for field');
  },
  // 驗收 3：簡單照第一版
  easy() {
    for (const [kinds, opts, what] of [[[], {}, 'an empty camp'], [[O], {}, 'an observer'], [[O, I], {}, 'no vehicles yet'], [[O, I, T], {}, 'one tank'], [[O, I, T, T], {}, 'two tanks'], [[O, I, T, T, H], {}, 'the whole short list'],
      [[O, T, T], { flags: { guns: 1, tanks: 1, armor2: 1 } }, 'no infantry allowed'], [[O, I, T, T], { supply: 30 }, 'too little supply for the howitzer'], [[O, I, T, T], { queue: [T, T] }, 'a full queue'], [[O, T, C], { queue: [I] }, 'a squad already queued']]) {
      const want = firstWants(1, kinds, opts);
      is(wants(1, kinds, opts), want, `easy: at the easy level the third version builds what the first did (${what}: ${NAME(want)})`);
    }
    is(firstWants(1, [O, I, T, T]), H, 'fixture: the first version\'s easy list reaches the howitzer after two vehicles');
  },
  // 驗收 4：主力優先、支援按比例
  ratio() {
    is(wants(3, []), O, 'ratio: with no observer the observer comes first');
    is(wants(3, [O, ...tanks(3), I, H], { flags: PLAIN }), T, 'ratio: with three core vehicles and two supports the next build is a tank');
    is(wants(3, [O, ...tanks(5), I, H], { flags: PLAIN }), I, 'ratio: with five core vehicles and two supports a support unit gets its turn');
    is(wants(3, [O, ...tanks(4), I, H], { flags: PLAIN }), T, 'ratio: exactly two to one is not yet enough for another support');
    // 跟第一版比：兩台車、一班步兵、一門榴彈砲——第一版先補第二班步兵，第三版先造坦克
    assert.deepEqual([NAME(firstWants(3, [O, T, T, I, H])), NAME(wants(3, [O, T, T, I, H]))], [NAME(I), NAME(T)], 'ratio: where the first version tops up its infantry, the third builds a tank');
    is(wants(3, [O, ...tanks(3), C, I, H]), T, 'ratio: the armoured car counts as support, not as a core vehicle');
    assert.deepEqual([isCore(T), isCore(S), isCore(D), isCore(V), isCore(L), isCore(C), isCore(I), isCore(H)], [true, true, true, true, true, false, false, false], 'fixture: which kinds are core');
  },
  // 支援的清單：順序與上限
  support() {
    const many = tanks(20);   // 主力多到比例不是限制
    is(wants(3, [O, ...many], { flags: PLAIN }), I, 'support: infantry first');
    is(wants(3, [O, ...many, I], { flags: PLAIN }), I, 'support: the hard level keeps two squads');
    is(wants(3, [O, ...many, I, I], { flags: PLAIN }), H, 'support: then howitzers');
    is(wants(3, [O, ...many, I, I, H], { flags: PLAIN }), H, 'support: the hard level keeps two howitzers');
    is(wants(3, [O, ...many, I, I, H, H], { flags: ALL }), M, 'support: then a mortar');
    is(wants(3, [O, ...many, I, I, H, H], { flags: ALL }, [foeTank()]), A, 'support: with enemy armour in sight the anti-tank gun comes before the mortar');
    is(wants(3, [O, ...many, I, I, H, H, M], { flags: ALL }), C, 'support: then an armoured car');
    is(wants(3, [O, ...many, I, I, H, H, M, C], { flags: ALL }), A, 'support: then an anti-tank gun');
    is(wants(3, [O, ...many, I, I, H, H, M, C, A], { flags: PLAIN }), T, 'support: with the list complete it builds core vehicles');
    is(wants(2, [O, ...many, I], { flags: PLAIN }), H, 'support: the normal level keeps one squad');
    is(wants(2, [O, ...many, I, H], { flags: PLAIN }), M, 'support: and one howitzer');
    is(wants(3, [O, ...many, I, I, H, H], { flags: { inf: 1, tanks: 1, armor2: 1 } }), C, 'support: without the guns flag there is no mortar or anti-tank gun');
    is(wants(3, [O, ...many, I, I, H, H], { flags: { inf: 1, tanks: 1 } }), V, 'support: without guns and the second armour set the list is done, and core vehicles follow');
    is(wants(3, [O, ...many], { flags: { guns: 1 } }), H, 'support: without the infantry flag there are no squads');
    is(wants(3, [O, ...many, I], { flags: PLAIN, queue: [I] }), H, 'support: a squad in the queue already counts');
  },
  // 特種車：主力夠了才出；驅逐戰車要看過敵方裝甲
  special() {
    is(wants(3, [O, ...tanks(4), I, H]), S, 'special: with four core vehicles an assault gun is added');
    is(wants(3, [O, ...tanks(3), I, H]), T, 'special: below four core vehicles there are only plain tanks');
    is(wants(3, [O, T, T, T, S, I, H]), V, 'special: the hard level then keeps one heavy tank');
    is(wants(2, [O, T, T, T, S, I, H]), L, 'special: the normal level keeps one light tank instead');
    is(wants(3, [O, T, T, S, V, I, H]), T, 'special: one of each, the rest are medium tanks');
    is(wants(3, [O, T, T, T, I, H], { armorAt: 0 }), D, 'special: having seen enemy armour it keeps a tank destroyer, even with a small core');
    is(wants(3, [O, T, T, T, D, I, H], { armorAt: 0 }), S, 'special: one destroyer is enough');
    is(wants(3, [O, T, T, T, I, H], { armorAt: -ARMOR_MEMORY - 1 }), T, 'special: armour seen more than a minute ago no longer counts');
    is(wants(3, [O, ...tanks(4), I, H], { flags: { inf: 1, guns: 1, tanks: 1 } }), V, 'special: without the second armour set there is no assault gun or destroyer');
    is(wants(3, [O, T, T, T, S, I, H], { flags: { inf: 1, guns: 1, armor2: 1 } }), T, 'special: without the tanks flag there is no heavy or light tank');
  },
  // 補給、佇列、指揮部
  limits() {
    is(wants(3, [O, ...tanks(5), I, H], { flags: PLAIN, supply: 24 }), null, 'limits: too little supply for what it wants means it waits');
    is(wants(3, [O, ...tanks(5), I, H], { flags: PLAIN, supply: 25 }), I, 'fixture: with exactly the price it builds');
    is(wants(3, [O, ...tanks(5), I, H], { flags: PLAIN, queue: [T, T] }), null, 'limits: with two in the queue it orders nothing more');
    is(wants(3, [O, ...tanks(3), I, H], { flags: PLAIN, queue: [T] }), T, 'fixture: with one in the queue it still orders');
    { const c = camp(3, [O, T]); c.mineHq.hp = 0; is(produce3(c.w, c.st, c.mine, []), null, 'limits: with the headquarters down there is no production'); }
    { const c = camp(3, [O, T]); delete c.w.eco; is(produce3(c.w, c.st, c.mine, []), null, 'limits: without an economy there is no production'); }
  },
  // 第三版真的用新的生產；第二版、第一版照舊
  wiring() {
    const queued = v => { const c = camp(3, [O, T, T, I, H], { v }); step(c.w, []); return c.w.eco.queue[ME].map(NAME); };
    assert.deepEqual(queued(0), [NAME(I)], 'fixture: the first version orders its second squad');
    assert.deepEqual(queued(2), [NAME(I)], 'wiring: the second version still produces like the first');
    assert.deepEqual(queued(3), [NAME(T)], 'wiring: the third version produces by the new rule, and only by it');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`ai3/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK ai3/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts');
  assert.match(read('../src/valves.ts'), /get r078\(\) \{ return on\('078'\); \}/, 'valve: r078 is on the table');
  assert.equal((main.match(/\.\.\.\(V\.r057 \? \{ v: V\.r078 \? 3 : 2 \} : \{\}\)/g) ?? []).length, 2, 'wiring: both places that hand the enemy to the computer send version 3, behind the valves');
  assert.match(read('../README.md'), /\?noR078=1/, 'readme: the valve is documented');
  console.log('OK ai3/files');
}

// ---- 故意弄壞（驗收 5）----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r078-negative-'));
const mutants = [
  ['third_not_stored', 'flag', 'ai.ts', '...(v === 2 || v === 3 ? { v } : {})', '...(v === 2 ? { v } : {})', 'flag: v 3 is stored as the third version'],
  ['second_gets_new_production', 'flag', 'ai2.ts', 'if (st.v === 3) { const kind = produce3(w, st, mine, seen);', 'if (st.v) { const kind = produce3(w, st, mine, seen);', 'flag: second version against second version on map 0 with null (levels 3 and 2) is bit for bit what it was before this card'],
  ['easy_changed', 'easy', 'ai3.ts', 'has(UK_HOWITZER) < 1 && count(k => UNIT_KINDS[k].armored) >= 2 ? UK_HOWITZER : UK_TANK;', 'has(UK_HOWITZER) < 1 ? UK_HOWITZER : UK_TANK;', 'easy: at the easy level the third version builds what the first did (no vehicles yet'],
  ['ratio_ignored', 'ratio', 'ai3.ts', 'want = support >= 0 && sup * SUPPORT_RATIO < core ? support', 'want = support >= 0 ? support', 'ratio: with three core vehicles and two supports the next build is a tank'],
  ['ratio_off_by_one', 'ratio', 'ai3.ts', 'sup * SUPPORT_RATIO < core ? support', 'sup * SUPPORT_RATIO <= core ? support', 'ratio: exactly two to one is not yet enough for another support'],
  ['car_is_core', 'ratio', 'ai3.ts', 'UNIT_KINDS[kind].armored && kind !== UK_ARMORED_CAR;', 'UNIT_KINDS[kind].armored;', 'ratio: the armoured car counts as support, not as a core vehicle'],
  ['hard_caps_for_normal', 'support', 'ai3.ts', 'top = lv >= 3 ? 2 : 1,', 'top = 2,', 'support: the normal level keeps one squad'],
  ['gun_order', 'support', 'ai3.ts', 'guns && foeArmor && has(UK_ATGUN) < 1 ? UK_ATGUN\n', 'guns && foeArmor && has(UK_MORTAR) < 1 ? UK_MORTAR\n', 'support: with enemy armour in sight the anti-tank gun comes before the mortar'],
  ['specials_at_once', 'special', 'ai3.ts', 'const enough = core >= CORE_FIRST;', 'const enough = true;', 'special: below four core vehicles there are only plain tanks'],
  ['memory_forever', 'special', 'ai3.ts', 'sawArmor = a2 && st.armor !== undefined && w.tick - st.armor <= ARMOR_MEMORY;', 'sawArmor = a2 && st.armor !== undefined;', 'special: armour seen more than a minute ago no longer counts'],
  ['ignores_supply', 'limits', 'ai3.ts', 'return e.supply[side] >= UNIT_KINDS[want].cost ? want : null;', 'return want;', 'limits: too little supply for what it wants means it waits'],
  ['queue_unbounded', 'limits', 'ai3.ts', '  if (q.length >= QUEUE_MAX) return null;\n', '', 'limits: with two in the queue it orders nothing more'],
  ['third_is_first', 'wiring', 'step.ts', 'for (const c of st.v ? aiThink2(w, st, see, thought) : thought)', 'for (const c of st.v === 2 ? aiThink2(w, st, see, thought) : thought)', 'wiring: the third version produces by the new rule, and only by it'],
  ['third_keeps_both', 'wiring', 'ai2.ts', "if (c.t === 'produce') { if (st.v !== 3) out.push(c); continue; }", "if (c.t === 'produce') { out.push(c); continue; }", 'wiring: the third version produces by the new rule, and only by it'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tools/duel.mjs'), join(dir, 'tools/duel.mjs'));
    cpSync(join(root, 'tests/ai3.mjs'), join(dir, 'tests/ai3.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/ai3.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK ai3-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`ai3: all groups OK, ${mutants.length} isolated mutants rejected`);
