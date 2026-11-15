// R057 電腦對手 v2 的對戰回歸：一份小的固定樣本（村莊、萊伊各 15 個種子、兩邊對調），四組規則各 60 局，第二版要贏第一版至少 55%；
// 另外第二版對第二版不能僵住、一局的長度不能離第一版對第一版太遠。模擬是決定性的，所以這些數字每次都一樣。
// 完整的量測（每組 400 局、大地圖）用 tools/duel.mjs 跑，指令與結果在 docs/tasks/R057-電腦對手v2.md。
import assert from 'node:assert/strict';
import { batch, summarize } from '../tools/duel.mjs';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1), V1 = { level: 3 }, V2 = { level: 3, v: 2 };
const both = opts => [0, 1].flatMap(map => batch({ ...opts, map }));

for (const [name, rules] of [['classic', null], ['armour', { ap: 1 }], ['morale', { morale: 1 }], ['armour and morale', { ap: 1, morale: 1 }]]) {
  const s = summarize(both({ seeds, swap: true, rules, a: V2, b: V1 }));
  console.log(`duel ${name}: second version ${s.aWins}, first version ${s.bWins}, draws ${s.draws}, unfinished ${s.timeouts}; median ${s.medianSeconds} s`);
  assert.equal(s.timeouts, 0, `duel: ${name} — no battle runs out the 20-minute clock`);
  assert(s.aWins * 100 >= 55 * (s.aWins + s.bWins), `duel: ${name} — the second version wins at least 55% of the decided battles against the first (${s.aWins} of ${s.aWins + s.bWins})`);
}

// 第二版對第二版：不僵住；中位數長度落在第一版對第一版的 0.5–2 倍
for (const [name, rules] of [['classic', null], ['armour and morale', { ap: 1, morale: 1 }]]) {
  const few = seeds.slice(0, 10), old = summarize(both({ seeds: few, rules, a: V1, b: V1 })), now = summarize(both({ seeds: few, rules, a: V2, b: V2 }));
  console.log(`mirror ${name}: first version median ${old.medianSeconds} s (${old.timeouts} unfinished), second version median ${now.medianSeconds} s (${now.timeouts} unfinished), sides ${now.aWins}/${now.bWins}`);
  assert.equal(now.timeouts, 0, `mirror: ${name} — second version against itself always finishes`);
  assert(now.medianSeconds * 2 >= old.medianSeconds && now.medianSeconds <= old.medianSeconds * 2, `mirror: ${name} — a battle between two second-version computers lasts between half and twice as long as between two first-version ones (${now.medianSeconds} s against ${old.medianSeconds} s)`);
}
console.log('ai2-duel: OK');
