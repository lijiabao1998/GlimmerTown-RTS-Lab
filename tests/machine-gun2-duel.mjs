// R081 機槍組第二版的對戰回歸：
// 一、難度的高下照舊：跟 tests/machine-gun-duel.mjs 同一份固定樣本（村莊、萊伊各 15 個種子、兩邊對調＝每一組 60 局，經典規則、帶 end），只把 mg 換成 2；
//     門檻照舊：困難對簡單至少 65%、普通對簡單至少 60%、困難對普通至少 55%；每 60 局打不完的不超過 2 局。
// 二、電腦下令的點射不打牆：第三版困難互打、擬真、村莊與萊伊各 5 個種子，電腦下令（攻擊指令）的點射打進「不含目標的房子」的比例 ≤ 15%
//     （卡面驗收 11 的門檻；完整的量測是各 15 個種子，指令與結果在 docs/tasks/R081-機槍組第二版.md）。模擬是決定性的，所以這些數字每次都一樣。
import assert from 'node:assert/strict';
import { batch, summarize, ECO } from '../tools/duel.mjs';
import { createWorld, UNIT_KINDS, cellOf, bldAt, SIDE_PLAYER, SIDE_ENEMY, ORD_ATTACK } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';

const seeds = Array.from({ length: 15 }, (_, i) => i + 1);
const NAME = ['', 'easy', 'normal', 'hard'];
for (const [high, low, need] of [[3, 1, 65], [2, 1, 60], [3, 2, 55]]) {
  const s = summarize([0, 1].flatMap(map => batch({ seeds, swap: true, map, end: true, mg: 2, a: { level: high, v: 3 }, b: { level: low, v: 3 } })));
  console.log(`levels ${NAME[high]} against ${NAME[low]} with version-2 machine-gun teams: ${s.aWins} to ${s.bWins}, unfinished ${s.timeouts}; median ${s.medianSeconds} s; bursts ${s.mgFires.join(' and ')}`);
  assert(s.aWins * 100 >= need * (s.aWins + s.bWins), `levels: with version-2 machine-gun teams ${NAME[high]} still beats ${NAME[low]} in at least ${need}% of the decided battles (${s.aWins} of ${s.aWins + s.bWins})`);
  assert(s.timeouts <= 2, `levels: ${NAME[high]} against ${NAME[low]} — at most 2 of 60 battles run out the 20-minute clock (${s.timeouts})`);
}
let ordered = 0, walls = 0, onTarget = 0;
for (const map of [0, 1]) for (let seed = 1; seed <= 5; seed++) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 3 }]);
  while (w.winner < 0 && w.tick < 24000) {
    const fired = [];
    w.shells.push = function (...xs) { for (const s of xs) { const u = w.units[s.shooter - 1]; if (UNIT_KINDS[u.kind].sup) fired.push({ s, order: u.order, target: u.target }); } return Array.prototype.push.apply(this, xs); };
    step(w, []);
    for (const { s, order, target } of fired) {
      const t = target ? w.units[target - 1] : null, inHouse = !!s.hitBld && !!t && UNIT_KINDS[t.kind].garrison && bldAt(w, cellOf(t.x), cellOf(t.z))?.id === s.hitBld;
      if (!s.hitBld || inHouse) onTarget++;
      if (order !== ORD_ATTACK) continue;
      ordered++;
      if (s.hitBld && !inHouse) walls++;
    }
  }
}
console.log(`computer-ordered bursts: ${ordered}, into a house the target is not in: ${walls}; bursts on target ${onTarget}`);
assert(ordered >= 50, `fixture: the computer's machine-gun teams fire (${ordered} ordered bursts)`);
assert(walls * 100 <= 15 * ordered, `walls: at most 15% of the computer-ordered bursts go into a house the target is not in (${walls} of ${ordered})`);
console.log('machine-gun2-duel: OK');
