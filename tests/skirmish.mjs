// R046 遭遇戰設定：不開瀏覽器的部分。
// 模擬（rules 指令：兵力、補給速度、只在第 0 步套一次、決定性、舊局不變）＋選單內容、讀網址、接線。
// 用法：node tests/skirmish.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/skirmish.mjs <群組名>   只跑那一群模擬守衛（隔離副本裡用）
// 真實 Chrome 在 tests/skirmish-browser.mjs（手機）與 tests/skirmish-desktop-browser.mjs（桌機）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, cellOf, cellIdx, inGrid, UNIT_KINDS, TER_MUD, SIDE_PLAYER, SIDE_ENEMY, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_LIGHT, UK_HEAVY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { applyRules, incomeTicks, FORCE_LEAN, FORCE_DOUBLE, INCOME_SLOW, INCOME_FAST } from '../src/sim/rules.ts';
import { startEco, ECO_START, ECO_INCOME_TICKS } from '../src/sim/eco.ts';
import { startZombies } from '../src/sim/zombies.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS, runScript } from '../src/sim/script.ts';

const MAP_VILLAGE = 0;
const MAPS = [[MAP_RYE, '萊伊 32'], [MAP_VILLAGE, '村莊 32'], [MAP_LARGE, '鄉間 64'], [MAP_TOWN, '河鎮 96']];
const at0 = (...cmds) => cmds.map(cmd => ({ tick: 0, cmd }));
const mapCmd = id => ({ t: 'map', id, vegetation: 1 });
// 第 0 步套完指令的世界（走 step()：重播的路徑）
const open = (seed, ...cmds) => { const w = createWorld(seed); step(w, cmds); return w; };
const alive = (w, side) => w.units.filter(u => u.alive && u.side === side);
const kinds = (w, side) => { const n = {}; for (const u of alive(w, side)) n[UNIT_KINDS[u.kind].name] = (n[UNIT_KINDS[u.kind].name] ?? 0) + 1; return n; };
const spot = u => `${u.side}:${u.kind}:${u.x}:${u.z}`;

const groups = {
  // 驗收 1：只在第 0 步、沒有指揮部、沒有喪屍、不是沙盒時生效，只生效一次
  guard() {
    const plain = runLog(createWorld(5), at0(mapCmd(MAP_RYE)), 3);
    const late = runLog(createWorld(5), [...at0(mapCmd(MAP_RYE)), { tick: 1, cmd: { t: 'rules', force: FORCE_DOUBLE, income: INCOME_FAST } }], 3);
    assert.equal(hashWorld(late), hashWorld(plain), 'guard: rules after tick 0 change nothing');
    assert.equal(late.rules, undefined, 'guard: late rules leave no state');
    const once = open(5, mapCmd(MAP_RYE), { t: 'rules', force: FORCE_DOUBLE }), twice = open(5, mapCmd(MAP_RYE), { t: 'rules', force: FORCE_DOUBLE }, { t: 'rules', force: FORCE_LEAN, income: INCOME_SLOW });
    assert.equal(hashWorld(twice), hashWorld(once), 'guard: the first rules command wins, a second one is ignored');
    // 全是標準值的指令不留任何狀態（驗收 2），所以它後面同一步的指令照樣生效：「只生效一次」指的是第一條不是全標準的指令
    assert.equal(hashWorld(open(5, mapCmd(MAP_RYE), { t: 'rules', force: 2 }, { t: 'rules', force: FORCE_DOUBLE })), hashWorld(once), 'guard: an all-standard rules command leaves no trace, so a later one in the same tick still applies');
    for (const [name, prepare] of [['headquarters', w => startEco(w)], ['zombies', w => startZombies(w)]]) {
      const w = createWorld(5); applyMap(w, MAP_RYE, 1); prepare(w);
      const before = hashWorld(w); applyRules(w, { force: FORCE_DOUBLE, income: INCOME_FAST });
      assert.equal(hashWorld(w), before, `guard: rules after ${name} change nothing`);
    }
    const sandbox = createSandboxWorld(5), before = hashWorld(sandbox);
    applyRules(sandbox, { force: FORCE_DOUBLE, income: INCOME_FAST });
    assert.equal(hashWorld(sandbox), before, 'guard: a sandbox world ignores a direct rules call');
    step(sandbox, [{ t: 'rules', force: FORCE_DOUBLE, income: INCOME_FAST }]);
    assert.equal(sandbox.rules, undefined, 'guard: a sandbox world ignores a rules command');
    const logOrder = open(5, { t: 'eco' }, { t: 'rules', income: INCOME_FAST }, mapCmd(MAP_RYE));
    assert.deepEqual(logOrder.rules, { income: INCOME_FAST }, 'guard: within tick 0 the map and rules apply before the headquarters whatever the log order');
  },
  // 驗收 2：標準值、不合法的值＝沒送
  values() {
    for (const [id, name] of MAPS) {
      const plain = hashWorld(open(11, mapCmd(id)));
      for (const v of [2, 0, -1, 1.5, 4, '1', '3', null, undefined, true, NaN]) {
        const w = open(11, mapCmd(id), { t: 'rules', force: v, income: v });
        assert.equal(hashWorld(w), plain, `values: ${name} force/income ${String(v)} (${typeof v}) is the same world as no rules command`);
        assert.equal(w.rules, undefined, `values: ${name} ${String(v)} leaves no rules state`);
      }
      assert.equal(hashWorld(open(11, mapCmd(id), { t: 'rules' })), plain, `values: ${name} an empty rules command is a no-op`);
    }
    assert.deepEqual(open(11, mapCmd(MAP_RYE), { t: 'rules', force: FORCE_LEAN, income: 2 }).rules, { force: FORCE_LEAN }, 'values: only non-standard fields are stored');
    assert.deepEqual(open(11, mapCmd(MAP_RYE), { t: 'rules', force: 2, income: INCOME_FAST }).rules, { income: INCOME_FAST }, 'values: only non-standard fields are stored (income)');
  },
  // 驗收 3：兵力
  force() {
    const LEAN = { 32: { tank: 2, observer: 1 }, 64: { tank: 3, light: 1, heavy: 1, howitzer: 1, observer: 1 }, 96: { tank: 3, light: 1, heavy: 1, howitzer: 1, observer: 1 } };
    const check = (seed, id, name) => {
      const std = open(seed, mapCmd(id)), lean = open(seed, mapCmd(id), { t: 'rules', force: FORCE_LEAN }), dbl = open(seed, mapCmd(id), { t: 'rules', force: FORCE_DOUBLE });
      const label = `${name} seed ${seed}`, n = std.n, per = alive(std, SIDE_PLAYER).length;
      assert.deepEqual(kinds(lean, SIDE_PLAYER), LEAN[n], `force: lean ${label} keeps about half (player)`);
      assert.deepEqual(kinds(lean, SIDE_ENEMY), LEAN[n], `force: lean ${label} keeps about half (enemy)`);
      assert.equal(alive(dbl, SIDE_PLAYER).length, per * 2, `force: double ${label} fields twice the standard force (player)`);
      assert.equal(alive(dbl, SIDE_ENEMY).length, per * 2, `force: double ${label} fields twice the standard force (enemy)`);
      for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (const [k, c] of Object.entries(kinds(std, side))) assert.equal(kinds(dbl, side)[k], c * 2, `force: double ${label} doubles every kind (${k}, side ${side})`);
      const doubled = new Set(dbl.units.map(spot));
      for (const u of std.units) assert(doubled.has(spot(u)), `force: double ${label} keeps every standard unit where it was (${spot(u)})`);
      for (const [w, what] of [[lean, 'lean'], [dbl, 'double']]) {
        const seen = new Set();
        w.units.forEach((u, i) => {
          const x = cellOf(u.x), z = cellOf(u.z), c = cellIdx(w, x, z);
          assert.equal(u.id, i + 1, `force: ${what} ${label} ids run from 1 without gaps`);
          assert(inGrid(w, x, z), `force: ${what} ${label} unit ${u.id} is on the map`);
          assert(!w.occ[c] && w.ter[c] !== TER_MUD && !w.vegetation?.cells[c], `force: ${what} ${label} unit ${u.id} stands on open ground (${x},${z})`);
          assert(!seen.has(c), `force: ${what} ${label} no two units share a cell (${x},${z})`);
          seen.add(c);
          assert.equal(u.hp, UNIT_KINDS[u.kind].hp, `force: ${what} ${label} unit ${u.id} starts at full strength`);
        });
        const lastMine = Math.max(...alive(w, SIDE_PLAYER).map(u => u.id)), firstTheirs = Math.min(...alive(w, SIDE_ENEMY).map(u => u.id));
        assert(lastMine < firstTheirs, `force: ${what} ${label} player ids come before enemy ids`);
      }
      assert.equal(hashWorld(open(seed, mapCmd(id), { t: 'rules', force: 2 })), hashWorld(std), `force: standard ${label} leaves the opening untouched`);
    };
    check(1944, MAP_RYE, '萊伊 32'); check(7, MAP_RYE, '萊伊 32');
    for (let seed = 0; seed < 200; seed++) check(seed, MAP_VILLAGE, '村莊 32');
    for (const seed of [0, 1, 7, 1944, 4294967295]) { check(seed, MAP_LARGE, '鄉間 64'); check(seed, MAP_TOWN, '河鎮 96'); }
    // 不帶地圖指令的舊式開局（createWorld 的村莊，沒有植被）也照樣能設兵力
    const bare = open(3, { t: 'rules', force: FORCE_DOUBLE });
    assert.equal(alive(bare, SIDE_PLAYER).length, 10, 'force: a bare createWorld village doubles too');
    assert.deepEqual([UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_LIGHT, UK_HEAVY].map(k => typeof UNIT_KINDS[k].name), Array(5).fill('string'), 'fixture: kinds used by the opening forces exist');
  },
  // 驗收 4：補給速度
  income() {
    const TICKS = 400, gain = income => { const w = runLog(createWorld(9), at0(mapCmd(MAP_RYE), { t: 'rules', income }, { t: 'eco' }), TICKS); return w.eco.supply.map(s => s - ECO_START); };
    const std = TICKS / ECO_INCOME_TICKS;
    assert.deepEqual(gain(2), [std, std], 'income: standard adds one supply every ECO_INCOME_TICKS');
    assert.deepEqual(gain(INCOME_SLOW), [std / 2, std / 2], 'income: slow adds half the standard supply for both sides');
    assert.deepEqual(gain(INCOME_FAST), [std * 2, std * 2], 'income: fast adds twice the standard supply for both sides');
    assert.equal(incomeTicks(createWorld(9)), 0, 'income: a world without rules falls back to the standard interval');
  },
  // 驗收 5：決定性
  determinism() {
    for (const [id, seed, name] of [[MAP_RYE, 21, '萊伊'], [MAP_LARGE, 22, '鄉間']]) {
      const rules = { t: 'rules', force: FORCE_DOUBLE, income: INCOME_FAST };
      const log = [...at0(mapCmd(id), rules, { t: 'build', side: SIDE_PLAYER, kind: 0, x: id === MAP_RYE ? 20 : 50, z: id === MAP_RYE ? 27 : 50, rot: 0 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 2 }),
        { tick: 40, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_TANK } }];
      const TICKS = 600, first = runLog(createWorld(seed), log, TICKS), a = hashWorld(first);
      assert(first.rules && first.eco && first.ai?.length === 2 && first.blds.some(b => b.builtBy === SIDE_PLAYER), `fixture: ${name} rules, headquarters, both AIs and the player's house are all in play`);
      assert(first.units.length > (id === MAP_RYE ? 20 : 60), `fixture: ${name} both sides produced units on top of the doubled opening (${first.units.length})`);
      assert.equal(hashWorld(runLog(createWorld(seed), log, TICKS)), a, `determinism: ${name} same seed and log give the same hash twice`);
      assert.equal(hashWorld(runLog(createWorld(seed), JSON.parse(JSON.stringify(log)), TICKS)), a, `determinism: ${name} log survives a JSON round trip`);
      const half = runLog(createWorld(seed), log, TICKS / 2), copy = structuredClone(half);
      assert.equal(hashWorld(runLog(half, log, TICKS)), a, `determinism: ${name} continuing from tick ${TICKS / 2} matches`);
      assert.equal(hashWorld(runLog(copy, log, TICKS)), a, `determinism: ${name} a structuredClone taken mid-battle finishes the same`);
      const preview = createWorld(seed); applyMap(preview, id, 1); applyRules(preview, rules);   // 遊戲裡布陣預覽的路徑：先直接套，開戰時 step() 再套一次（不重複生效）
      assert.equal(hashWorld(runLog(preview, log, TICKS)), a, `determinism: ${name} applying map and rules directly before step() equals replaying the log`);
      assert.notEqual(hashWorld(runLog(createWorld(seed + 1), log, TICKS)), a, `determinism: ${name} another seed gives another battle`);
    }
  },
  // 驗收 6：喪屍模式
  zombies() {
    for (const [id, name, lean] of [[MAP_RYE, '萊伊', 3], [MAP_LARGE, '鄉間', 7]]) {
      const a = open(31, mapCmd(id), { t: 'rules', force: FORCE_LEAN }, { t: 'zombies' }), b = open(31, { t: 'zombies' }, { t: 'rules', force: FORCE_LEAN }, mapCmd(id));
      assert.equal(hashWorld(a), hashWorld(b), `zombies: ${name} rules apply before zombies whatever the log order`);
      assert.equal(alive(a, SIDE_PLAYER).length, lean, `zombies: ${name} the player keeps the chosen force`);
      assert.equal(alive(a, SIDE_ENEMY).length, 0, `zombies: ${name} the enemy opening force is still removed`);
      assert(a.zombies, `zombies: ${name} mode is on`);
    }
  },
  // 規則有折進雜湊；舊局逐位不變
  hash() {
    const slow = open(41, mapCmd(MAP_RYE), { t: 'rules', income: INCOME_SLOW }), fast = open(41, mapCmd(MAP_RYE), { t: 'rules', income: INCOME_FAST }), plain = open(41, mapCmd(MAP_RYE));
    assert.equal(new Set([hashWorld(slow), hashWorld(fast), hashWorld(plain)]).size, 3, 'hash: rules state is folded into the world hash');
    const golden = JSON.parse(readFileSync(new URL('../tools/golden.json', import.meta.url), 'utf8'));
    assert.equal(hashWorld(runScript()), golden.hash, 'legacy: the scripted battle still matches tools/golden.json');
    assert.equal(SCRIPT.some(c => c.cmd.t === 'rules'), false, 'legacy: the scripted battle carries no rules command');
    assert.equal(golden.seed === SCRIPT_SEED && golden.ticks === SCRIPT_TICKS, true, 'legacy: golden fixture is the scripted battle');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`skirmish/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK skirmish/${name}`); }

// ---- 選單內容、讀網址、接線（不在隔離副本裡跑：那裡只有 src/sim）----
{
  const { menuLayout } = await import('../src/ui/startMenu.ts');
  const { initSkirmish, level, parseSeed, rulesCommand, setupSummary, SEED_MAX } = await import('../src/ui/skirmish.ts');
  const ids = items => items.map(i => i.id), read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const r069 = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye', 'large', 'town'], modes: ['battle', 'zombies', 'sandbox'], aiOn: true, rye: true, tutorial: true, audio: false, resume: false };
  const full = { ...r069, maps: ['rye', 'village', 'large', 'town'], setup: { force: 2, supply: 2, seed: 1944 } };
  // 開始頁
  const m = menuLayout(full);
  assert.deepEqual(m.rows.map(r => r.id), ['sm-maps', 'sm-modes', 'sm-ais', 'sm-setups'], 'layout: the setup key is its own row after map, mode and AI');
  assert.deepEqual(m.rows[0].items.map(i => [i.id, i.label, i.sub]), [['sm-map-rye', '萊伊', '32×32'], ['sm-map-village', '村莊', '32×32'], ['sm-map-large', '鄉間', '64×64'], ['sm-map-town', '河鎮', '96×96']], 'layout: four maps with sizes');
  assert.deepEqual(m.rows[3], { id: 'sm-setups', title: '', items: [{ id: 'sm-setup', label: '遭遇戰設定', sub: '兵力 標準 · 補給 標準 · 種子 1944' }] }, 'layout: the setup key shows force, supply and seed');
  assert.equal(menuLayout({ ...full, map: 'village' }).rows[0].items.filter(i => i.pressed)[0].id, 'sm-map-village', 'layout: the village shows as chosen');
  assert.deepEqual(menuLayout({ ...full, mode: 'zombies' }).rows.map(r => r.id), ['sm-maps', 'sm-modes', 'sm-setups'], 'layout: zombies keeps the setup key');
  assert.deepEqual(menuLayout({ ...full, mode: 'sandbox' }).rows.map(r => r.id), ['sm-modes'], 'layout: sandbox has no setup key');
  assert.deepEqual(menuLayout({ ...full, kind: 'pause', resume: true }).rows, [], 'layout: the pause menu cannot change the setup mid-battle');
  assert.deepEqual(menuLayout({ ...full, kind: 'pause', resume: true, page: 'setup' }).rows, [], 'layout: a pause menu never shows the setup page');
  assert.deepEqual(ids(menuLayout({ ...full, resume: true }).main), ['sm-resume', 'sm-restart'], 'layout: the menu key during build keeps 繼續 and 重新開始');
  // ?noR046=1：沒有 setup 欄位時，輸出跟 R069 那一版逐位相同
  assert.deepEqual(menuLayout(r069).rows.map(r => r.id), ['sm-maps', 'sm-modes', 'sm-ais'], 'valve: without setup the rows are exactly the R069 rows');
  assert.deepEqual(ids(menuLayout(r069).rows[0].items), ['sm-map-rye', 'sm-map-large', 'sm-map-town'], 'valve: without setup there are exactly the R069 maps');
  assert.deepEqual(menuLayout({ ...r069, page: 'setup' }), menuLayout(r069), 'valve: without setup there is no setup page');
  // 設定頁
  const p = menuLayout({ ...full, page: 'setup', setup: { force: 3, supply: 1, seed: 7 } });
  assert.equal(p.title, '遭遇戰設定', 'setup: page title');
  assert.deepEqual(p.rows.map(r => [r.id, ids(r.items)]), [['sm-forces', ['sm-force-1', 'sm-force-2', 'sm-force-3']], ['sm-supplies', ['sm-supply-1', 'sm-supply-2', 'sm-supply-3']], ['sm-seeds', ['sm-seed', 'sm-seed-roll']]], 'setup: force, supply and seed rows');
  assert.deepEqual(p.rows[0].items.map(i => i.label), ['精簡', '標準', '加倍'], 'setup: force names');
  assert.deepEqual(p.rows[1].items.map(i => i.label), ['慢', '標準', '快'], 'setup: supply names');
  assert.deepEqual(p.rows.slice(0, 2).map(r => r.items.filter(i => i.pressed).map(i => i.id)), [['sm-force-3'], ['sm-supply-1']], 'setup: current choices are pressed');
  assert.deepEqual(p.rows[2].items[0], { id: 'sm-seed', label: '7', input: true }, 'setup: the seed is a text box holding the current seed');
  assert.deepEqual([ids(p.main), p.extra], [['sm-setup-done'], []], 'setup: one primary 完成, no extras');
  // 讀網址
  assert.deepEqual(['1', '2', '3', null, undefined, '', '0', '4', '9', 'x', '1.0', ' 1', '-1'].map(level), [1, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 'url: only 1 and 3 leave the standard');
  assert.deepEqual(['0', '7', ' 42 ', String(SEED_MAX), String(SEED_MAX + 1), '', 'abc', '1e3', '-1', '1.5', '12345678901'].map(parseSeed), [0, 7, 42, SEED_MAX, null, null, null, null, null, null, null], 'seed: only whole numbers 0–4294967295');
  assert.deepEqual([rulesCommand(2, 2), rulesCommand(1, 2), rulesCommand(2, 3), rulesCommand(3, 1)], [undefined, { t: 'rules', force: 1 }, { t: 'rules', income: 3 }, { t: 'rules', force: 3, income: 1 }], 'rules: standard sends nothing; only non-standard fields are sent');
  assert.equal(setupSummary(1, 3, 42), '兵力 精簡 · 補給 快 · 種子 42', 'summary: text');
  const fromUrl = (query, canVillage = true) => { const s = initSkirmish(new URLSearchParams(query), canVillage); return [s.force, s.supply, s.village]; };
  assert.deepEqual(fromUrl('force=3&supply=1&map=village'), [3, 1, true], 'url: ?force, ?supply and ?map=village are read');
  assert.deepEqual(fromUrl(''), [2, 2, false], 'url: defaults are standard, standard, no village');
  assert.deepEqual(fromUrl('force=9&supply=x&map=64'), [2, 2, false], 'url: bad values mean standard');
  assert.deepEqual(fromUrl('map=village', false), [2, 2, false], 'url: with the Rye valve off there is no separate village');
  const sk = initSkirmish(new URLSearchParams(''), true), w = createWorld(3);
  assert.equal(sk.start(w), undefined, 'start: standard settings send no command');
  assert.equal(w.rules, undefined, 'start: standard settings leave the world untouched');
  sk.set({ force: 3, supply: 3, village: true });
  assert.deepEqual([sk.force, sk.supply, sk.village], [3, 3, true], 'set: values are stored');
  assert.deepEqual(sk.start(w), { t: 'rules', force: 3, income: 3 }, 'start: returns the command to log');
  assert.deepEqual(w.rules, { force: 3, income: 3 }, 'start: applies the rules to the world at once');
  sk.set({ force: 7 }); assert.equal(sk.force, 2, 'set: an unknown level falls back to standard');
  // 接線與閥
  const main = read('../src/main.ts'), valves = read('../src/valves.ts'), menu = read('../src/ui/startMenu.ts');
  assert.match(valves, /get r046\(\) \{ return on\('046'\); \}/, 'valve: r046 is on the table');
  assert.equal((main.match(/const skirmish = V\.r046 \? initSkirmish\(q, V\.r026\) : undefined;/g) ?? []).length, 1, 'wiring: main.ts creates the setup once, only with the valve on');
  assert.match(main, /let seed = /, 'wiring: the seed can be changed by the menu');
  assert.match(main, /const rules = !sandbox && \(map \|\| vegetation\) \? skirmish\?\.start\(w\) : undefined;/, 'wiring: reset() applies the rules for ordinary games only (not scripts, replays or the sandbox)');
  assert.match(main, /if \(rules\) issue\(rules\);/, 'wiring: reset() logs the rules command');
  assert(main.indexOf('const rules = !sandbox') < main.indexOf('if (zombies) startZombies(w);'), 'wiring: rules are applied before zombies, the same order as step()');
  assert.match(menu, /const sk = host\.skirmish;/, 'wiring: the menu reads the setup from its host');
  assert.match(read('../tests/start-menu-browser.mjs'), /noR046=1/, 'guards: the R069 browser guard opens with noR046=1');
  console.log('OK skirmish/menu, url, wiring');
}

// ---- 故意弄壞（驗收 7）：隔離副本只跑對應那一群；第一個錯誤必須是指定的 AssertionError ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r046-negative-'));
const mutants = [
  ['no_deploy', 'force', 'rules.ts', '  if (force) deploy(w, force);', '', 'force: lean 萊伊 32 seed 1944 keeps about half (player)'],
  ['income_ignored', 'income', 'eco.ts', '(incomeTicks(w) || ECO_INCOME_TICKS)', 'ECO_INCOME_TICKS', 'income: slow adds half the standard supply for both sides'],
  ['late_rules', 'guard', 'rules.ts', 'w.tick !== 0 || w.rules', 'w.rules', 'guard: rules after tick 0 change nothing'],
  ['missing_hash', 'hash', 'world.ts', 'if (w.rules.income) f.int(0x5249).int(w.rules.income);', '', 'hash: rules state is folded into the world hash'],
  ['zombies_first', 'zombies', 'step.ts', "  for (const c of cmds) if (c.t === 'rules') applyRules(w, c);   // R046：地圖之後、喪屍與布陣之前\n  for (const c of cmds) if (c.t === 'zombies') startZombies(w);\n", "  for (const c of cmds) if (c.t === 'zombies') startZombies(w);\n  for (const c of cmds) if (c.t === 'rules') applyRules(w, c);\n", 'zombies: 萊伊 the player keeps the chosen force'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    mkdirSync(join(dir, 'tools'), { recursive: true });
    cpSync(join(root, 'tools/golden.json'), join(dir, 'tools/golden.json'));
    cpSync(join(root, 'tests/skirmish.mjs'), join(dir, 'tests/skirmish.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/skirmish.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: intended assertion must fail first, got ${output.slice(-1500)}`);
    console.log(`OK skirmish-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`skirmish: sim groups OK, ${mutants.length} isolated mutants rejected`);
