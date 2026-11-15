// R080 機槍組的對戰回歸：開局多了機槍組之後，電腦第三版三個難度的高下還在。
// 跟 tests/ai3-duel.mjs 同一份固定樣本（村莊、萊伊各 15 個種子、兩邊對調＝每一組 60 局，經典規則、帶 end），只多帶 mg；門檻照舊：
// 困難對簡單至少 65%、普通對簡單至少 60%、困難對普通至少 55%。模擬是決定性的，所以這些數字每次都一樣。
// 另外確認這批對局裡雙方的機槍組真的有在打（第三版會帶著它走、會開火）。完整的量測（每格 100 局、擬真）在 docs/tasks/R080-機槍組.md。
import assert from 'node:assert/strict';
import { batch, summarize } from '../tools/duel.mjs';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1);
const NAME = ['', 'easy', 'normal', 'hard'];
for (const [high, low, need] of [[3, 1, 65], [2, 1, 60], [3, 2, 55]]) {
  const s = summarize([0, 1].flatMap(map => batch({ seeds, swap: true, map, end: true, mg: true, a: { level: high, v: 3 }, b: { level: low, v: 3 } })));
  console.log(`levels ${NAME[high]} against ${NAME[low]} with machine-gun teams: ${s.aWins} to ${s.bWins}, unfinished ${s.timeouts}; median ${s.medianSeconds} s; bursts fired ${s.mgFires.join(' and ')}, teams lost ${s.mgLost.join(' and ')}`);
  assert(s.aWins * 100 >= need * (s.aWins + s.bWins), `levels: with machine-gun teams ${NAME[high]} still beats ${NAME[low]} in at least ${need}% of the decided battles (${s.aWins} of ${s.aWins + s.bWins})`);
  assert(s.timeouts <= 2, `levels: ${NAME[high]} against ${NAME[low]} — at most 2 of 60 battles run out the 20-minute clock (${s.timeouts})`);
  assert(s.mgFires[0] >= 60 && s.mgFires[1] >= 60, `use: both sides' teams fire at least once a battle on average (${s.mgFires.join(' and ')} bursts in 60 battles)`);
}
console.log('machine-gun-duel: OK');
