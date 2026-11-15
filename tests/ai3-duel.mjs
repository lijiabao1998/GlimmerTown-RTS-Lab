// R078 難度校正的對戰回歸：電腦第三版三個難度互打，一份小的固定樣本（村莊、萊伊各 15 個種子、兩邊對調＝每一組 60 局，經典規則、帶 end）。
// 困難對簡單至少 65%、普通對簡單至少 60%、困難對普通至少 55%（卡面驗收 6–8 的「合計」門檻）。模擬是決定性的，所以這些數字每次都一樣。
// 完整的量測（每格 100 局、經典與擬真）用 tools/duel.mjs 跑，指令與結果在 docs/tasks/R078-難度校正.md。
import assert from 'node:assert/strict';
import { batch, summarize } from '../tools/duel.mjs';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1);
const NAME = ['', 'easy', 'normal', 'hard'];
for (const [high, low, need] of [[3, 1, 65], [2, 1, 60], [3, 2, 55]]) {
  const s = summarize([0, 1].flatMap(map => batch({ seeds, swap: true, map, end: true, a: { level: high, v: 3 }, b: { level: low, v: 3 } })));
  console.log(`levels ${NAME[high]} against ${NAME[low]}: ${s.aWins} to ${s.bWins}, unfinished ${s.timeouts}; median ${s.medianSeconds} s`);
  assert(s.aWins * 100 >= need * (s.aWins + s.bWins), `levels: ${NAME[high]} beats ${NAME[low]} in at least ${need}% of the decided battles (${s.aWins} of ${s.aWins + s.bWins})`);
  assert(s.timeouts <= 2, `levels: ${NAME[high]} against ${NAME[low]} — at most 2 of 60 battles run out the 20-minute clock (${s.timeouts})`);
}
console.log('ai3-duel: OK');
