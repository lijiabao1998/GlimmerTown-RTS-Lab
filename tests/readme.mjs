// R013 守衛：遊戲讀的每一個逃生閥 ?noR<號>=1，都要寫在 README 的逃生閥對照表裡（新閥沒寫說明就紅）。
// R060：閥收在 src/valves.ts 一張表（每閥一行 get r<號>() { return on('<號>'); }），改看那張表。
// 影響 GPT 車道：GPT 新增逃生閥時要順手在 README 表裡加一列（README 在白名單裡）。
import fs from 'node:fs';
const table0 = fs.readFileSync(new URL('../src/valves.ts', import.meta.url), 'utf8'), readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const valves = [...new Set([...table0.matchAll(/get r\d+\(\) \{ return on\('(\d+)'\); \}/g)].map(m => `noR${m[1]}`))];
const table = readme.slice(readme.indexOf('## 逃生閥對照'));
const missing = valves.filter(v => !table.includes(`\`?${v}=1\``));
const ok = valves.length >= 52 && missing.length === 0;   // main 263ab52 時 main.ts 讀 52 個；閥表少於這個數就是漏搬
console.log(`${ok ? 'OK' : 'NG'}  README 逃生閥對照表涵蓋 src/valves.ts 的每一個 ?noR…=1　— 閥表 ${valves.length} 個：${valves.join(' ')}${missing.length ? `；README 缺 ${missing.join(' ')}` : ''}`);
process.exit(ok ? 0 : 1);
