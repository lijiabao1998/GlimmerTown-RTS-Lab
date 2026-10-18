// R013 守衛：src/main.ts 讀的每一個逃生閥 ?noR<號>=1，都要寫在 README 的逃生閥對照表裡（新閥沒寫說明就紅）。
// 影響 GPT 車道：GPT 新增逃生閥時要順手在 README 表裡加一列（README 在白名單裡）。
import fs from 'node:fs';
const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const valves = [...new Set([...main.matchAll(/q\.get\('(noR\d+)'\)/g)].map(m => m[1]))];
const table = readme.slice(readme.indexOf('## 逃生閥對照'));
const missing = valves.filter(v => !table.includes(`\`?${v}=1\``));
const ok = valves.length >= 5 && missing.length === 0;
console.log(`${ok ? 'OK' : 'NG'}  README 逃生閥對照表涵蓋 main.ts 的每一個 ?noR…=1　— main.ts ${valves.length} 個：${valves.join(' ')}${missing.length ? `；README 缺 ${missing.join(' ')}` : ''}`);
process.exit(ok ? 0 : 1);
