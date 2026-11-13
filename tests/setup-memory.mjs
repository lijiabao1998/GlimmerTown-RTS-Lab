// R073 記住上次的遭遇戰設定：不開瀏覽器的部分。存下來的格式、填進網址參數的規則、設定物件什麼時候存、接線。
// 真實 Chrome 在 tests/setup-memory-browser.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld } from '../src/sim/world.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { SETUP_KEY, SETUP_PARAMS, DEFAULT_SEED, SEED_MAX, loadSetup, saveSetup, restoreSetup, initSkirmish } from '../src/ui/skirmish.ts';
import { menuLayout } from '../src/ui/startMenu.ts';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const mem = (value) => { const m = new Map(value === undefined ? [] : [[SETUP_KEY, typeof value === 'string' ? value : JSON.stringify(value)]]); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const SAVED = { v: 1, map: '64', mode: 'zombies', ai: 3, force: 3, supply: 1, seed: 77 };
const STANDARD = { v: 1, map: 'rye', mode: 'battle', ai: 2, force: 2, supply: 2, seed: DEFAULT_SEED };
const fill = (query, store) => restoreSetup(new URLSearchParams(query), store).toString();

// ---- 驗收 1：格式 ----
assert.equal(SETUP_KEY.startsWith('gtrts.v1.'), true, 'format: the key starts with gtrts.v1.');
{
  const s = mem(); saveSetup(s, SAVED);
  assert.deepEqual(loadSetup(s), SAVED, 'format: a saved setup reads back the same');
  assert.deepEqual(loadSetup(mem()), null, 'format: nothing stored reads as null');
  for (const [bad, name] of [['{ broken', 'broken text'], ['null', 'null'], ['[]', 'an array'], ['7', 'a number'], [{ ...SAVED, v: 2 }, 'version 2'], [{ map: '64' }, 'no version']]) assert.equal(loadSetup(mem(bad)), null, `format: ${name} is not used`);
  assert.deepEqual(loadSetup(mem({ v: 1, map: 'moon', mode: 'chess', ai: 9, force: 'big', supply: null, seed: -1 })), STANDARD, 'format: nonsense fields fall back to the standard value one by one');
  for (const seed of [1.5, SEED_MAX + 1, '77', null, true, [77], { n: 77 }]) assert.equal(loadSetup(mem({ ...SAVED, seed })).seed, DEFAULT_SEED, `format: seed ${String(seed)} falls back to ${DEFAULT_SEED}`);
  assert.deepEqual([loadSetup(mem({ ...SAVED, seed: 0 })).seed, loadSetup(mem({ ...SAVED, seed: SEED_MAX })).seed], [0, SEED_MAX], 'format: seeds 0 and 4294967295 are kept');
  assert.deepEqual(['rye', 'village', '64', '96'].map(map => loadSetup(mem({ ...SAVED, map })).map), ['rye', 'village', '64', '96'], 'format: the four maps are kept');
  assert.equal(loadSetup(throwing), null, 'format: a storage that throws reads as null');
  assert.equal(loadSetup(null), null, 'format: no storage reads as null');
  assert.doesNotThrow(() => { saveSetup(throwing, SAVED); saveSetup(null, SAVED); }, 'format: saving never throws');
}

// ---- 驗收 2：填進網址參數的規則 ----
assert.deepEqual(SETUP_PARAMS, ['seed', 'map', 'mode', 'ai', 'force', 'supply'], 'fixture: the six setup items');
assert.equal(fill('', mem(SAVED)), 'map=64&mode=zombies&ai=3&force=3&supply=1&seed=77', 'restore: an address with no setup item takes all six from storage');
assert.equal(fill('', mem(STANDARD)), '', 'restore: standard values are not written');
assert.equal(fill('', mem({ ...STANDARD, map: 'village', seed: 5 })), 'map=village&seed=5', 'restore: only the non-standard items are written');
for (const k of SETUP_PARAMS) assert.equal(fill(`${k}=1`, mem(SAVED)), `${k}=1`, `restore: an address that carries ${k} is used alone, nothing is mixed in`);
assert.equal(fill('noR065=1&px=3', mem(SAVED)), 'noR065=1&px=3&map=64&mode=zombies&ai=3&force=3&supply=1&seed=77', 'restore: valves and other switches do not count as setup items');
for (const valve of ['noR069', 'noR046', 'noR073']) {
  const store = mem(SAVED), q = restoreSetup(new URLSearchParams(`${valve}=1`), store), sk = initSkirmish(q, true);
  assert.equal(q.toString(), `${valve}=1`, `valve: ${valve}=1 restores nothing`);
  sk.start(createWorld(9)); sk.set({ ai: 1, force: 1 });
  assert.deepEqual([sk.remembers, loadSetup(store)], [false, SAVED], `valve: ${valve}=1 saves nothing either`);
}
assert.equal(fill('', mem('{ broken')), '', 'restore: broken storage restores nothing');
assert.doesNotThrow(() => fill('', throwing), 'restore: a storage that throws never breaks page load');
assert.equal(fill('', null), '', 'restore: no storage restores nothing');

// ---- 驗收 3：設定物件什麼時候存 ----
{
  const store = mem(), q = restoreSetup(new URLSearchParams(''), store), sk = initSkirmish(q, true);
  assert.equal(sk.remembers, true, 'save: with the menu and the valves on, the setup remembers');
  sk.set({ ai: 3, force: 3 });
  assert.equal(loadSetup(store), null, 'save: nothing is stored before the first game exists');
  const large = createWorld(5); applyMap(large, MAP_LARGE, 1);
  sk.start(large);
  assert.deepEqual(loadSetup(store), { v: 1, map: '64', mode: 'battle', ai: 3, force: 3, supply: 2, seed: 5 }, 'save: starting a game stores map, mode, seed and the current force, supply and AI level');
  sk.set({ ai: 1 });
  assert.equal(loadSetup(store).ai, 1, 'save: changing the AI level stores at once (it does not restart the game)');
  sk.set({ supply: 3 });
  assert.equal(loadSetup(store).supply, 3, 'save: changing the supply speed stores');
  q.set('mode', 'zombies');
  const town = createWorld(6); applyMap(town, MAP_TOWN, 1); sk.start(town);
  assert.deepEqual([loadSetup(store).map, loadSetup(store).mode, loadSetup(store).seed], ['96', 'zombies', 6], 'save: the river town in zombies mode is stored as such');
  q.delete('mode');
  const rye = createWorld(7); applyMap(rye, MAP_RYE, 1); sk.start(rye);
  const village = createWorld(8); applyMap(village, 0, 1);
  assert.equal(loadSetup(store).map, 'rye', 'save: Rye is stored as rye');
  sk.start(village);
  assert.deepEqual([loadSetup(store).map, loadSetup(store).mode, loadSetup(store).seed], ['village', 'battle', 8], 'save: the seeded village is stored as village');
  // 存下來的再讀回去＝同一份設定
  const again = restoreSetup(new URLSearchParams(''), store);
  assert.equal(again.toString(), 'map=village&ai=1&force=3&supply=3&seed=8', 'round trip: what was stored comes back as this page\'s address items');
  // 審查找到的：模式要跟 main.ts 用同一個條件——喪屍的閥關著時，網址寫了 mode=zombies 也是一般對戰
  {
    const st = mem(), qq = restoreSetup(new URLSearchParams('noR045=1'), st), k = initSkirmish(qq, true);
    qq.set('mode', 'zombies'); k.start(createWorld(4));
    assert.equal(loadSetup(st).mode, 'battle', 'save: with the zombies valve off the stored mode is battle whatever the address says');
  }
  // 沙盒世界不存
  {
    const st = mem(), k = initSkirmish(restoreSetup(new URLSearchParams(''), st), true);
    k.start(rye); const before = JSON.stringify(loadSetup(st));
    k.start(createSandboxWorld(99));
    assert.equal(JSON.stringify(loadSetup(st)), before, 'save: a sandbox world changes nothing that is remembered');
  }
  // 用帶設定的網址開的頁：沒動過設定就不蓋掉原本記住的；動了任何一項才變成記住的那一局
  {
    const st = mem(SAVED), k = initSkirmish(restoreSetup(new URLSearchParams('seed=5'), st), true);
    const w5 = createWorld(5); applyMap(w5, MAP_RYE, 1);
    k.start(w5);
    assert.deepEqual(loadSetup(st), SAVED, 'link: merely opening an address with setup items leaves the remembered setup alone');
    k.start(w5);
    assert.deepEqual(loadSetup(st), SAVED, 'link: restarting the same game still leaves it alone');
    k.set({ ai: 3 });
    assert.deepEqual(loadSetup(st), { v: 1, map: 'rye', mode: 'battle', ai: 3, force: 2, supply: 2, seed: 5 }, 'link: once a setting is changed, this game becomes the remembered one');
    k.set({ ai: 2 }); k.start(w5);
    assert.equal(loadSetup(st).ai, 2, 'link: after that every change is stored as usual');
    const st2 = mem(SAVED), k2 = initSkirmish(restoreSetup(new URLSearchParams('map=64'), st2), true), big = createWorld(5), other = createWorld(6);
    applyMap(big, MAP_LARGE, 1); applyMap(other, MAP_LARGE, 1);
    k2.start(big); k2.start(other);
    assert.deepEqual([loadSetup(st2).seed, loadSetup(st2).map], [6, '64'], 'link: a different seed in the same linked page counts as a change');
  }
  const off = mem(), plain = initSkirmish(restoreSetup(new URLSearchParams('noR073=1'), off), true);
  plain.start(createWorld(3));
  assert.equal(off.m.size, 0, 'save: with the valve off nothing is ever written');
}

// ---- 選單內容、接線 ----
{
  const base = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye', 'village', 'large', 'town'], modes: ['battle', 'zombies', 'sandbox'], aiOn: true, rye: true, tutorial: true, audio: false, resume: false, page: 'setup' };
  assert.deepEqual(menuLayout({ ...base, setup: { force: 2, supply: 2, seed: 1944, reset: true } }).extra, [{ id: 'sm-setup-reset', label: '恢復預設' }], 'layout: the setup page offers 恢復預設 when the setup remembers');
  assert.deepEqual(menuLayout({ ...base, setup: { force: 2, supply: 2, seed: 1944 } }).extra, [], 'layout: without memory (noR073) the setup page is exactly the R046 page');
  const main = read('../src/main.ts'), valves = read('../src/valves.ts'), menu = read('../src/ui/startMenu.ts'), cdp = read('../tools/cdp.mjs');
  assert.match(valves, /get r073\(\) \{ return on\('073'\); \}/, 'valve: r073 is on the table');
  assert.equal((main.match(/const q = restoreSetup\(new URLSearchParams\(location\.search\)\);/g) ?? []).length, 1, 'wiring: main.ts reads its address items through restoreSetup, once');
  assert(main.indexOf('const q = restoreSetup(') < main.indexOf('let seed = ') && main.indexOf('const q = restoreSetup(') < main.indexOf('let aiLevel = ') && main.indexOf('const q = restoreSetup(') < main.indexOf('let large = '), 'wiring: the restore happens before seed, map and AI level are read');
  assert.match(menu, /sk\?\.set\(\{ ai: Number\(id\.slice\(6\)\) \}\)/, 'wiring: the menu tells the setup about a new AI level');
  assert.match(menu, /id === 'sm-setup-reset'\) \{ sk\.set\(\{ force: 2, supply: 2 \}\); host\.seed\?\.\(DEFAULT_SEED\); fresh = true; \}/, 'wiring: 恢復預設 resets force, supply and seed and restarts');
  assert.match(cdp, /localStorage\.removeItem\('gtrts\.v1\.setup'\)/, 'harness: cdp open() clears the stored setup unless a guard keeps it');
  assert.match(read('../AGENTS.md'), /gtrts\.v1\.setup/, 'rules: AGENTS.md tells guard writers the stored setup is cleared');
  assert.match(read('../tests/skirmish-browser.mjs'), /noR073=1/, 'guards: the R046 browser guard opens with noR073=1');
}
console.log('setup-memory: all OK');
