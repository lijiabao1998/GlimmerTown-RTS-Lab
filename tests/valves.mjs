// R060 逃生閥表守衛：閥只在 src/valves.ts 讀網址；一個都不少；main.ts 只建一次畫面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { valves } from '../src/valves.ts';
import { viewOptions } from '../src/render/battle.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);

// 1. main 263ab52 用到的每一個閥（R040 載入畫面在 index.html 自己讀，不在表上）
const FROZEN = ['004', '006', '008', '009', '010', '011', '012', '014', '015', '016', '018', '019', '021', '022', '023', '024', '026', '027', '028',
  '037', '041', '043', '044', '045', '100', '101', '104', '105', '107', '109', '113', '115', '116', '117', '118', '120', '121', '122', '123', '124',
  '125', '126', '127', '128', '130', '131', '134', '135', '136', '137', '138', '139'];
const table = read('src/valves.ts'), listed = [...table.matchAll(/get r(\d{3})\(\) \{ return on\('(\d{3})'\); \}/g)];
for (const [, a, b] of listed) assert.equal(a, b, `valves: getter r${a} reads its own number`);
const numbers = listed.map(m => m[1]);
assert.equal(new Set(numbers).size, numbers.length, 'valves: no duplicate valve');
for (const n of FROZEN) assert(numbers.includes(n), `valves: R${n} is still in the table`);
console.log(`OK valves table: ${numbers.length} valves, all ${FROZEN.length} from main 263ab52 present`);

// 2. 每個閥：網址沒寫＝開；?noR<號>=1＝關；別的號不受影響；每次讀都看網址當下的值
const q = new URLSearchParams(), V = valves(q);
for (const n of numbers) assert.equal(V[`r${n}`], true, `valves: R${n} defaults on`);
for (const n of numbers) {
  q.set(`noR${n}`, '1');
  assert.equal(V[`r${n}`], false, `valves: ?noR${n}=1 turns R${n} off (live read)`);
  for (const m of numbers) if (m !== n) assert.equal(V[`r${m}`], true, `valves: ?noR${n}=1 leaves R${m} on`);
  q.delete(`noR${n}`);
}
assert.equal(new URLSearchParams('noR118=0').get('noR118') !== '1', valves(new URLSearchParams('noR118=0')).r118, 'valves: only the exact value 1 disables');
console.log('OK valves semantics: default on, ?noR<n>=1 off, independent, live');

// 3. src/ 裡讀 noR 參數的只有閥表（註解不算）
const code = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[^]*?\*\//g, '');
for (const f of walk('src').filter(f => /\.ts$/.test(f) && f !== 'src/valves.ts')) {
  assert(!/noR\d{3}|['"`]noR['"`$]|`noR\$\{/.test(code(read(f))), `valves: ${f} reads a ?noR valve outside src/valves.ts`);
}
const main = read('src/main.ts');
assert(!main.includes("q.get('noR"), 'valves: main.ts has no direct q.get(\'noR…\')');
console.log('OK valves location: only src/valves.ts reads ?noR parameters');

// 4. 畫面：建構子只收 (world, options)；main.ts 只有一處 new BattleView；runScript 與開局都走 makeView
const battle = read('src/render/battle.ts');
assert.match(battle, /constructor\(w: World, options: ViewOptions = \{\}\)/, 'view: constructor takes (world, options)');
assert.equal((main.match(/new BattleView\(/g) ?? []).length, 1, 'view: main.ts constructs BattleView in exactly one place');
assert.equal((main.match(/\bmakeView\(\);/g) ?? []).length, 2, 'view: reset and runScript both call makeView');
assert.deepEqual(viewOptions({}), { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true,
  r107: true, r113: true, r118: true, r104: true, r123: true, rubbleMarks: true, multiRange: true }, 'view: unspecified options default on');
assert.equal(viewOptions({ r118: undefined, fog: false }).r118, true, 'view: undefined keeps the default like an omitted positional argument');
assert.equal(viewOptions({ fog: false }).fog, false, 'view: explicit false is kept');
console.log('OK valves view: one constructor call, options object, defaults on');
console.log('valves: all OK');
