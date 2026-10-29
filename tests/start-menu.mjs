// R069 開始選單：不開瀏覽器的部分。選單內容怎麼隨模式、閥、教學狀態變；選地圖／模式時按舊鍵的步驟走得到目標；接線與閥。
// 真實 Chrome（滑鼠、觸控、版面、暫停、跟舊鍵逐位相同）在 tests/start-menu-browser.mjs 與 tests/start-menu-desktop-browser.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { menuLayout, mapStep, modeStep } from '../src/ui/startMenu.ts';

const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const ids = items => items.map(i => i.id);
const full = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye', 'large', 'town'], modes: ['battle', 'zombies', 'sandbox'], aiOn: true, rye: true, tutorial: true, audio: false, resume: false };

// ---- 選單內容 ----
{
  const m = menuLayout(full);
  assert.equal(m.title, '微光小鎮·二戰 RTS', 'layout: start menu title');
  assert.deepEqual(m.rows.map(r => r.id), ['sm-maps', 'sm-modes', 'sm-ais'], 'layout: start menu has map, mode and AI rows');
  assert.deepEqual(ids(m.rows[0].items), ['sm-map-rye', 'sm-map-large', 'sm-map-town'], 'layout: three maps');
  assert.deepEqual(m.rows[0].items.map(i => [i.label, i.sub]), [['萊伊', '32×32'], ['鄉間', '64×64'], ['河鎮', '96×96']], 'layout: map names with sizes');
  assert.deepEqual(ids(m.rows[1].items), ['sm-mode-battle', 'sm-mode-zombies', 'sm-mode-sandbox'], 'layout: three modes');
  assert.deepEqual(m.rows[2].items.map(i => i.label), ['簡單', '普通', '困難'], 'layout: three AI levels');
  assert.deepEqual(m.rows.map(r => r.items.filter(i => i.pressed).map(i => i.id)), [['sm-map-rye'], ['sm-mode-battle'], ['sm-ai-2']], 'layout: current choices are pressed');
  assert.deepEqual(ids(m.main), ['sm-start'], 'layout: page-open menu has one primary 開始');
  assert.deepEqual(ids(m.extra), ['sm-tutorial', 'sm-help', 'sm-audio'], 'layout: tutorial, help, audio');
  assert.equal(m.extra[2].label, '音效：關', 'layout: audio label follows state');
  assert.equal(menuLayout({ ...full, audio: true }).extra[2].label, '音效：開', 'layout: audio on label');
}
{
  assert.deepEqual(menuLayout({ ...full, mode: 'zombies' }).rows.map(r => r.id), ['sm-maps', 'sm-modes'], 'layout: zombies has no AI row (no enemy AI)');
  assert.deepEqual(menuLayout({ ...full, mode: 'sandbox' }).rows.map(r => r.id), ['sm-modes'], 'layout: sandbox has no map or AI row (fixed field)');
  assert.deepEqual(menuLayout({ ...full, aiOn: false }).rows.map(r => r.id), ['sm-maps', 'sm-modes'], 'layout: AI row only when the enemy AI is on');
  assert.deepEqual(menuLayout({ ...full, maps: ['rye'], modes: ['battle'] }).rows.map(r => r.id), ['sm-ais'], 'layout: single-choice rows are hidden (their valves are off)');
  assert.equal(menuLayout({ ...full, rye: false }).rows[0].items[0].label, '村莊', 'layout: noR026 names the 32×32 map village');
  assert.deepEqual(ids(menuLayout({ ...full, tutorial: false, audio: null }).extra), ['sm-help'], 'layout: finished tutorial and missing audio key are hidden');
  const bar = menuLayout({ ...full, resume: true });
  assert.deepEqual(ids(bar.main), ['sm-resume', 'sm-restart'], 'layout: menu key during build offers 繼續 and 重新開始 (↺ moved into the menu)');
  const pause = menuLayout({ ...full, kind: 'pause', resume: true });
  assert.equal(pause.title, '暫停', 'layout: pause menu title');
  assert.deepEqual(pause.rows, [], 'layout: pause menu cannot change map, mode or AI mid-battle');
  assert.deepEqual(ids(pause.main), ['sm-resume', 'sm-restart', 'sm-main'], 'layout: pause menu 繼續／重新開始／回主選單');
  assert.deepEqual(ids(pause.extra), ['sm-help', 'sm-audio'], 'layout: pause menu has no tutorial');
}

// ---- 選地圖／模式：照 main.ts 舊鍵的切換規則模擬，三步內一定到目標 ----
const main = read('../src/main.ts');
// 錨定 main.ts 舊鍵的切換規則；改了這幾行，這裡的模擬也要跟著改
assert(main.includes("toggle: () => { if (expanded) { expanded = false; large = false; } else large = !large; reset(); },"), 'anchor: map key rule in main.ts');
assert(main.includes('toggle: () => { expanded = !expanded; large = false; reset(); },'), 'anchor: town key rule in main.ts');
assert(main.includes("toggle: () => { if (w.zombies) q.delete('mode'); else q.set('mode', 'zombies'); reset(); },"), 'anchor: zombies key rule in main.ts');
assert(main.includes("const zombies = !sandbox && (map || vegetation) && V.r045 && q.get('mode') === 'zombies';"), 'anchor: zombies follow ?mode after any reset');
const mapOf = s => (s.expanded ? 'town' : s.large ? 'large' : 'rye');
const modeOf = s => (s.sandbox ? 'sandbox' : s.zombiesQ ? 'zombies' : 'battle');
const press = (s, b) => {
  if (b === 'map-pick') { if (s.expanded) { s.expanded = false; s.large = false; } else s.large = !s.large; s.sandbox = false; }
  else if (b === 'town-pick') { s.expanded = !s.expanded; s.large = false; s.sandbox = false; }
  else if (b === 'zombies-pick') { s.zombiesQ = !(modeOf(s) === 'zombies'); s.sandbox = false; }
  else if (b === 'sb-enter') s.sandbox = true;
  else if (b === 'sb-exit') s.sandbox = false;   // ?mode=zombies 還在就回到喪屍
  return s;
};
for (const from of ['rye', 'large', 'town']) for (const to of ['rye', 'large', 'town']) {
  const s = { large: from === 'large', expanded: from === 'town', zombiesQ: false, sandbox: false };
  let n = 0;
  for (let b; n < 3 && (b = mapStep(mapOf(s), to)); n++) press(s, b);
  assert.equal(mapOf(s), to, `map: ${from} → ${to} reaches the target`);
  assert(n <= 2, `map: ${from} → ${to} takes at most two key presses (${n})`);
}
for (const zombiesQ of [false, true]) for (const sandbox of [false, true]) for (const to of ['battle', 'zombies', 'sandbox']) {
  const s = { large: false, expanded: false, zombiesQ, sandbox }, from = modeOf(s);
  let n = 0;
  for (let b; n < 3 && (b = modeStep(modeOf(s), to)); n++) press(s, b);
  assert.equal(modeOf(s), to, `mode: ${from}${sandbox && zombiesQ ? ' (zombies still in the URL)' : ''} → ${to} reaches the target`);
}
assert.equal(mapStep('large', 'large'), null, 'map: same choice presses nothing');
assert.equal(modeStep('zombies', 'zombies'), null, 'mode: same choice presses nothing');

// ---- 接線、閥、共用開頁工具 ----
const valves = read('../src/valves.ts'), menu = read('../src/ui/startMenu.ts'), cdp = read('../tools/cdp.mjs');
assert.match(valves, /get r069\(\) \{ return on\('069'\); \}/, 'valve: r069 is on the table');
assert.equal((main.match(/if \(V\.r069\) initStartMenu\(/g) ?? []).length, 1, 'wiring: main.ts mounts the menu once, only with the valve on');
assert.match(main, /let aiLevel = /, 'wiring: AI level can be changed by the menu');
assert.match(menu, /body\.r069 #sb-enter, body\.r069 #map-pick, body\.r069 #zombies-pick, body\.r069 #town-pick, body\.r069 #b-restart \{ display: none; \}/, 'css: the four entry keys and ↺ fold into the menu only under body.r069');
assert.match(cdp, /const q = menu \|\| \/\(\^\|&\)noR069=\/\.test\(query\) \? query : `\$\{query \? query \+ '&' : ''\}noR069=1`;/, 'harness: cdp open() adds noR069=1 unless a guard asks for the menu');
assert.match(read('../AGENTS.md'), /open\(query, \{ menu: true \}\)/, 'rules: AGENTS.md tells guard writers how to test the menu');
console.log('start-menu: all OK');
