// R061 總機長度守衛：src/main.ts、src/render/battle.ts 的行數不准超過 tools/hub-budget.json 的上限。
// 上限只准往下調（tools/ 只有 Claude 改）。新功能寫在自己的檔，總機只加接線；空間用完就先把總機裡別的東西搬出去。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/hub-budget.json'), 'utf8'));
const hubs = Object.keys(budget).filter(k => k !== 'note');
assert.deepEqual(hubs.sort(), ['src/main.ts', 'src/render/battle.ts'], 'hub-budget: both hub files have a ceiling');
const lines = file => { const s = fs.readFileSync(path.join(ROOT, file), 'utf8'); return s.split('\n').length - (s.endsWith('\n') ? 1 : 0); };   // 跟 wc -l 一樣數
let ok = true;
for (const file of hubs) {
  const n = lines(file), cap = budget[file];
  assert(Number.isInteger(cap) && cap > 0, `hub-budget: ${file} ceiling is a positive integer`);
  const fine = n <= cap; ok &&= fine;
  console.log(`${fine ? 'OK' : 'NG'}  ${file} ${n} 行，上限 ${cap}，${fine ? `還剩 ${cap - n} 行` : `超過 ${n - cap} 行：新功能寫在自己的檔，總機只加接線；不夠就先把總機裡的東西搬出去`}`);
}
process.exit(ok ? 0 : 1);
