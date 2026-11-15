// R057 電腦對手 v2 的對戰回歸（三支之一）：一份小的固定樣本（村莊、萊伊各 15 個種子、兩邊對調），四組規則各 60 局，第二版要贏第一版至少 55%；
// 另外第二版對第二版不能僵住、一局的長度不能離第一版對第一版太遠。模擬是決定性的，所以這些數字每次都一樣。
// 拆成三支是因為 CI 每支守衛限 120 秒：ai2-duel.mjs（經典、穿甲）、ai2-duel-morale.mjs（士氣、兩條都開）、ai2-mirror.mjs（自己對自己）。
// 完整的量測（每組 400 局、大地圖）用 tools/duel.mjs 跑，指令與結果在 docs/tasks/R057-電腦對手v2.md。
import assert from 'node:assert/strict';
import { batch, summarize } from '../tools/duel.mjs';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1), V1 = { level: 3 }, V2 = { level: 3, v: 2 };
const both = opts => [0, 1].flatMap(map => batch({ ...opts, map }));

for (const [name, rules] of [['classic', null], ['armour', { ap: 1 }]]) {
  const s = summarize(both({ seeds, swap: true, rules, a: V2, b: V1 }));
  console.log(`duel ${name}: second version ${s.aWins}, first version ${s.bWins}, draws ${s.draws}, unfinished ${s.timeouts}; median ${s.medianSeconds} s`);
  assert.equal(s.timeouts, 0, `duel: ${name} — no battle runs out the 20-minute clock`);
  assert(s.aWins * 100 >= 55 * (s.aWins + s.bWins), `duel: ${name} — the second version wins at least 55% of the decided battles against the first (${s.aWins} of ${s.aWins + s.bWins})`);
}
console.log('ai2-duel: OK');
