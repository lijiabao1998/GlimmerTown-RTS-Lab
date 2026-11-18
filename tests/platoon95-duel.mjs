// R095 步兵排的對戰回歸（卡面驗收第 12 條）：跟 tests/ai3-duel.mjs 同一份樣本（村莊、萊伊各 15 個種子、兩邊對調＝每一組 60 局、帶 end），
// 但用遊戲現在開局送的設定——機槍組第二版（mg 2）與步兵排（pla）。困難對簡單至少 65%、普通對簡單至少 60%、困難對普通至少 55%；每一組逾時最多 2 局。
// 擬真規則與大地圖的數字是收據，在 docs/tasks/R095-步兵排.md（用 tools/duel.mjs --pla 跑）。
import assert from 'node:assert/strict';
import { batch, summarize } from '../tools/duel.mjs';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1);
const NAME = ['', 'easy', 'normal', 'hard'];
for (const [high, low, need] of [[3, 1, 65], [2, 1, 60], [3, 2, 55]]) {
  const s = summarize([0, 1].flatMap(map => batch({ seeds, swap: true, map, end: true, mg: 2, pla: true, a: { level: high, v: 3 }, b: { level: low, v: 3 } })));
  console.log(`levels ${NAME[high]} against ${NAME[low]} (pla, mg 2): ${s.aWins} to ${s.bWins}, unfinished ${s.timeouts}; median ${s.medianSeconds} s`);
  assert(s.aWins * 100 >= need * (s.aWins + s.bWins), `levels: with platoons ${NAME[high]} beats ${NAME[low]} in at least ${need}% of the decided battles (${s.aWins} of ${s.aWins + s.bWins})`);
  assert(s.timeouts <= 2, `levels: with platoons ${NAME[high]} against ${NAME[low]} — at most 2 of 60 battles run out the clock (${s.timeouts})`);
}
console.log('platoon95-duel: OK');
