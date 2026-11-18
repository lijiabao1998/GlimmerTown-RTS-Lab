// R090 海斯（地圖 5）的對打：CI 跑短的（種子 1、4,000 步，兩次結果逐位一樣、雜湊釘住）；
// 本機加 --time 跑卡面驗收 5（困難第三版對困難第三版、擬真、end、mg 2、pla、sym，種子 1–6、12,000 步、三次取中位數；
// 每一步 p99 ≤ 6 毫秒、電腦想事情那一步 p99 ≤ 25 毫秒、最大 ≤ 60 毫秒；同一次量測也記河鎮）。量之前先確認沒有無頭瀏覽器在跑。
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from '../tools/duel.mjs';

const TIME = process.argv.includes('--time');
const PINNED = ['04f9c51d', 4000];   // R090 施工時取（MARTELLO 移到 (9,21) 之後）
const first = map => [{ t: 'map', id: map, vegetation: 1, sym: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2, pla: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 3 }];
// 一局：每一步的時間；「想事情」＝這一步有一方電腦到了它的 next
function game(map, seed, ticks, clock) {
  const w = createWorld(seed), steps = [], thinks = [];
  step(w, first(map));
  while (w.winner < 0 && w.tick < ticks) {
    const think = (w.ai ?? []).some(a => a.next <= w.tick);
    const t0 = clock ? performance.now() : 0; step(w, []); const dt = clock ? performance.now() - t0 : 0;
    if (clock) { steps.push(dt); if (think) thinks.push(dt); }
  }
  return { w, hash: hashWorld(w), tick: w.tick, winner: w.winner, steps, thinks };
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];

if (!TIME) {
  const a = game(5, 1, 4000, false), b = game(5, 1, 4000, false);
  assert.deepEqual([b.hash, b.tick], [a.hash, a.tick], 'duel: two runs of map 5 seed 1 end identically');
  assert.deepEqual([a.hash, a.tick], PINNED, `duel: map 5 seed 1 after 4,000 ticks (${a.hash} at ${a.tick})`);
  console.log(`hythe-duel: map 5 seed 1, 4,000 ticks → ${a.hash} (deterministic); timing with --time`);
} else {
  const out = {};
  for (const map of [5, 3]) {
    const runs = [];
    for (let r = 0; r < 3; r++) {
      const steps = [], thinks = [];
      for (let seed = 1; seed <= 6; seed++) { const g = game(map, seed, 12000, true); steps.push(...g.steps); thinks.push(...g.thinks); }
      runs.push({ p99: pct(steps, 0.99), think: pct(thinks, 0.99), max: Math.max(...steps), n: steps.length });
    }
    out[map] = { p99: med(runs.map(r => r.p99)), think: med(runs.map(r => r.think)), max: med(runs.map(r => r.max)), steps: runs[0].n };
    console.log(`map ${map}: step p99 ${out[map].p99.toFixed(2)} ms, think p99 ${out[map].think.toFixed(2)} ms, max ${out[map].max.toFixed(1)} ms (${out[map].steps} steps, median of 3 runs)`);
  }
  const m = out[5];
  assert(m.p99 <= 6 && m.think <= 25 && m.max <= 60, `time: map 5 step p99 ≤ 6, think p99 ≤ 25, max ≤ 60 ms (${m.p99.toFixed(2)} / ${m.think.toFixed(2)} / ${m.max.toFixed(1)})`);
  console.log('hythe-duel --time: all thresholds met');
}
