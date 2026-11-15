// R076 擬真／經典：不開瀏覽器的部分。新預設什麼時候才套（沒有任何依據時）、選過的記得住、設定頁一個選擇的排法、摘要的寫法、逃生閥、接線。
// 用法：node tests/realism.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/realism.mjs <群組名>   只跑那一群（隔離副本裡用）
// 真實 Chrome 在 tests/realism-browser.mjs；判準與量到的數字在 docs/tasks/R076-擬真成為預設選項.md。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld } from '../src/sim/world.ts';
import { SETUP_KEY, DEFAULT_SEED, DEFAULT_REALISM, loadSetup, restoreSetup, initSkirmish, setupSummary } from '../src/ui/skirmish.ts';
import { menuLayout, mixedNote, rulesNote } from '../src/ui/startMenu.ts';

const mem = value => { const m = new Map(value === undefined ? [] : [[SETUP_KEY, JSON.stringify(value)]]); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, saved: () => (m.has(SETUP_KEY) ? JSON.parse(m.get(SETUP_KEY)) : null) }; };
const STANDARD = { v: 1, map: 'rye', mode: 'battle', ai: 2, force: 2, supply: 2, seed: DEFAULT_SEED };
// 用這個網址、這份本機紀錄開頁之後，參數變成什麼；real＝沒有依據時的預設是不是擬真
const fill = (query, store, real) => restoreSetup(new URLSearchParams(query), store, real).toString();
// 開一頁：回傳設定物件與那份本機紀錄
const page = (query, saved, real = false) => { const store = mem(saved), q = restoreSetup(new URLSearchParams(query), store, real); return { sk: initSkirmish(q, true), store }; };
const rules = sk => sk.start(createWorld(5));

const groups = {
  // 新預設什麼時候才套
  default() {
    assert.deepEqual([fill('', mem(), true), fill('', mem(), false)], ['ap=1&morale=1', ''], 'default: with nothing to go on, a new page takes the default (realistic or classic)');
    assert.equal(fill('', null, true), 'ap=1&morale=1', 'default: the same when the browser gives no storage at all');
    for (const link of ['seed=7', 'map=village', 'ai=3', 'force=3', 'ap=1', 'morale=1', 'mode=zombies', 'supply=1']) assert.equal(fill(link, mem(), true), link, `default: an address that carries ${link} is left exactly as it is`);
    assert.deepEqual([fill('', mem(STANDARD), true), fill('', mem(STANDARD), false)], ['ap=1&morale=1', ''], 'default: a setup saved before this card with both rules off was never a choice, so it takes the default');
    assert.equal(fill('', mem({ ...STANDARD, map: '64', seed: 9 }), true), 'map=64&seed=9&ap=1&morale=1', 'default: and keeps everything else it remembered');
    assert.deepEqual([fill('', mem({ ...STANDARD, ap: 1 }), true), fill('', mem({ ...STANDARD, morale: 1 }), true)], ['ap=1', 'morale=1'], 'default: a setup saved before this card with one rule on is kept (that was a choice)');
    assert.equal(fill('', mem({ ...STANDARD, rules: 1 }), true), '', 'default: classic chosen on purpose is not overridden by a realistic default');
    assert.equal(fill('', mem({ ...STANDARD, ap: 1, morale: 1, rules: 1 }), false), 'ap=1&morale=1', 'default: realistic chosen on purpose is not overridden by a classic default');
    for (const off of ['noR076=1', 'noR069=1', 'noR046=1', 'noR051=1', 'noR052=1']) assert.equal(fill(off, mem(), true), off, `default: with ${off} there is no single choice to show, so no new default`);
    assert.equal(DEFAULT_REALISM, false, 'default: the shipped default is classic (the difficulty criterion on the card was not met)');
  },
  // 選了記得住；回到預設不算選過
  choice() {
    let { sk, store } = page('', undefined);
    assert.deepEqual([sk.merged, sk.ap, sk.morale], [true, false, false], 'fixture: a plain page offers the single choice and starts classic');
    assert.equal(rules(sk), undefined, 'choice: classic sends no rules command');
    assert.equal(store.saved().rules, undefined, 'choice: starting a battle without touching the choice does not count as choosing');
    sk.choose(true);
    assert.deepEqual([sk.ap, sk.morale, rules(sk)], [true, true, { t: 'rules', ap: 1, morale: 2 }], 'choice: realistic turns both rules on and sends them');
    assert.deepEqual([store.saved().ap, store.saved().morale, store.saved().rules], [1, 1, 1], 'choice: choosing is remembered as a choice');
    sk.choose(false);
    assert.deepEqual([sk.ap, sk.morale, rules(sk), store.saved().ap, store.saved().morale, store.saved().rules], [false, false, undefined, undefined, undefined, 1], 'choice: classic chosen on purpose is remembered too');
    assert.equal(/(^|&)(ap|morale)=/.test(fill('', store, true)), false, 'choice: and the next page respects it even if the default has become realistic');
    sk.choose(null);
    assert.deepEqual([sk.ap, sk.morale, store.saved().rules], [false, false, undefined], 'choice: back to default is not a choice');
    // 只開一條（舊網址）：照原樣送，兩個選項都不亮（在 layout 那一群驗）
    ({ sk, store } = page('ap=1', undefined));
    assert.deepEqual([sk.ap, sk.morale, rules(sk)], [true, false, { t: 'rules', ap: 1 }], 'choice: an old link with only armour on still starts exactly that');
    // 閥關著：兩顆開關、存檔不多記東西，原本有的記號留著
    ({ sk, store } = page('noR076=1', undefined));
    sk.set({ ap: true }); rules(sk);
    assert.deepEqual([sk.merged, store.saved().ap, 'rules' in store.saved()], [false, 1, false], 'valve: with noR076 the page has two switches and saves what it always saved');
    ({ sk, store } = page('noR076=1', { ...STANDARD, rules: 1 }));
    sk.set({ force: 3 }); rules(sk);
    assert.equal(store.saved().rules, 1, 'valve: a choice remembered earlier is not wiped by a page that cannot show it');
  },
  // 設定頁的排法
  layout() {
    const row = setup => menuLayout({ page: 'setup', mode: 'battle', setup: { force: 2, supply: 2, seed: 1, ...setup } }).rows.find(r => r.id === 'sm-rules');
    const pressed = r => r.items.filter(i => i.pressed).map(i => i.id);
    let r = row({ ap: true, morale: true, merged: true, help: true });
    assert.deepEqual([r.title, r.items.map(i => i.id), pressed(r), r.note], ['規則', ['sm-real', 'sm-classic'], ['sm-real'], rulesNote(true, true)], 'layout: one choice of two; realistic lit when both rules are on');
    assert.deepEqual(pressed(row({ ap: false, morale: false, merged: true })), ['sm-classic'], 'layout: classic lit when both are off');
    r = row({ ap: true, morale: false, merged: true, help: true });
    assert.deepEqual([pressed(r), r.note], [[], `${mixedNote(true)}\n${rulesNote(true, true)}`], 'layout: with only armour on neither is lit and the note says why');
    assert.equal(row({ ap: false, morale: true, merged: true, help: true }).note.startsWith(mixedNote(false)), true, 'layout: the same with only morale on');
    assert.deepEqual(row({ ap: true, morale: false }).items.map(i => i.id), ['sm-ap', 'sm-morale'], 'layout: without the single choice the two switches are back');
    assert(mixedNote(true).includes('穿甲') && mixedNote(false).includes('士氣'), 'layout: the note names the one rule that is on');
  },
  // 開始選單上那行摘要
  summary() {
    const tail = (...a) => setupSummary(2, 2, 7, ...a).replace('兵力 標準 · 補給 標準 · 種子 7', '');
    assert.deepEqual([tail(true, true, true), tail(false, false, true), tail(true, false, true), tail(false, true, true)], [' · 擬真', ' · 經典', ' · 穿甲', ' · 士氣'], 'summary: with the single choice it says realistic, classic, or the one rule that is on');
    assert.deepEqual([tail(true, true), tail(false, false), tail(true, false)], [' · 穿甲 · 士氣', '', ' · 穿甲'], 'summary: without it the line is what it was');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`realism/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK realism/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const menu = read('../src/ui/startMenu.ts'), cdp = read('../tools/cdp.mjs');
  assert.match(read('../src/valves.ts'), /get r076\(\) \{ return on\('076'\); \}/, 'valve: r076 is on the table');
  assert.match(menu, /sk\?\.merged && \(id === 'sm-real' \|\| id === 'sm-classic'\)\) \{ sk\.choose\(id === 'sm-real'\); fresh = true; \}/, 'wiring: the two buttons choose and restart');
  assert.match(menu, /sk\?\.merged && id === 'sm-setup-reset'\) \{ sk\.set\(\{ force: 2, supply: 2 \}\); sk\.choose\(null\); host\.seed\?\.\(DEFAULT_SEED\); fresh = true; \}/, 'wiring: 恢復預設 puts the rules back to the default and forgets the choice');
  assert.match(cdp, /const open = async \(query, \{ menu = false, keep = false, realism = false \} = \{\}\) => \{/, 'harness: cdp open() takes a realism option');
  assert.match(cdp, /const full = realism \|\| \/\(\^\|&\)noR076=\/\.test\(q\) \? q : `\$\{q \? q \+ '&' : ''\}noR076=1`;/, 'harness: cdp open() adds noR076=1 unless a guard asks for the single choice');
  assert.match(read('../README.md'), /\?noR076=1/, 'readme: the valve is documented');
  assert.equal(loadSetup({ getItem: () => JSON.stringify({ ...STANDARD, rules: 2 }) }).rules, undefined, 'format: only the number 1 marks a choice');
  console.log('OK realism/wiring');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r076-negative-'));
const SK = 'src/ui/skirmish.ts', SM = 'src/ui/startMenu.ts';
const mutants = [
  ['no_default', 'default', SK, "  if (!s) { if (fresh) { q.set('ap', '1'); q.set('morale', '1'); } return q; }", '  if (!s) return q;', 'default: with nothing to go on, a new page takes the default'],
  ['overrides_links', 'default', SK, '  if (linked) return q;', '  if (linked && !fresh) return q;', 'default: an address that carries seed=7 is left exactly as it is'],
  ['old_off_is_a_choice', 'default', SK, "  if (fresh && !chose) { q.set('ap', '1'); q.set('morale', '1'); }", '', 'default: a setup saved before this card with both rules off was never a choice'],
  ['old_on_overridden', 'default', SK, 'chose = s.rules === 1 || !!s.ap || !!s.morale;', 'chose = s.rules === 1;', 'default: a setup saved before this card with one rule on is kept'],
  ['mark_ignored', 'default', SK, 'chose = s.rules === 1 || !!s.ap || !!s.morale;', 'chose = !!s.ap || !!s.morale;', 'default: classic chosen on purpose is not overridden'],
  ['valve_ignored', 'default', SK, 'const fresh = realism && V.r069 && V.r046 && V.r076 && V.r051 && V.r052;', 'const fresh = realism && V.r069 && V.r046 && V.r051 && V.r052;', 'default: with noR076=1 there is no single choice to show'],
  ['mark_never_saved', 'choice', SK, '...(chosen ? { rules: 1 as const } : {}) }, text', '}, text', 'choice: choosing is remembered as a choice'],
  ['starting_is_choosing', 'choice', SK, 'chosen = merged && real !== null;', 'chosen = merged;', 'choice: back to default is not a choice'],
  ['choice_sets_one', 'choice', SK, 's.ap = canAp && on; s.morale = canMorale && on;', 's.ap = canAp && on;', 'choice: realistic turns both rules on and sends them'],
  ['mixed_lights_realistic', 'layout', SM, "label: '擬真', sub: '穿不透會彈開、被壓住會趴下會退', pressed: !!s.ap && !!s.morale }", "label: '擬真', sub: '穿不透會彈開、被壓住會趴下會退', pressed: !!s.ap || !!s.morale }", 'layout: with only armour on neither is lit'],
  ['no_mixed_note', 'layout', SM, "(s.ap !== s.morale ? `${mixedNote(!!s.ap)}\\n` : '') + rulesNote(true, true)", 'rulesNote(true, true)', 'layout: with only armour on neither is lit and the note says why'],
  ['summary_split', 'summary', SK, "merged && ap === morale ? (ap ? ' · 擬真' : ' · 經典') : ", '', 'summary: with the single choice it says realistic, classic, or the one rule that is on'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/realism.mjs'), join(dir, 'tests/realism.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/realism.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK realism-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`realism: all groups OK, ${mutants.length} isolated mutants rejected`);
