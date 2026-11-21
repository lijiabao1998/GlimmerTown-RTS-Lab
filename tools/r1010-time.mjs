// R1010 驗收 27（不進 CI）：海斯帶／不帶 br 的電腦對電腦 3,000 步，每一步花多少時間（只記錄，不當門檻）。
// 用法：node tools/r1010-time.mjs [種子…]（預設 1 2）。量之前先等別的工作階段的無頭瀏覽器停下來（機器忙時差兩倍以上）。
// 兩種輪流跑（帶、不帶、帶、不帶…），每一局印總時間、每步的中位數、第 99 百分位、最慢的一步，以及那一局的雜湊（兩次跑要一樣）。
import { performance } from 'node:perf_hooks';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from './duel.mjs';

const seeds = process.argv.slice(2).map(Number).filter(Number.isInteger);
const AIS = [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }];
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function run(seed, br) {
  const w = createWorld(seed), times = [];
  step(w, [{ t: 'map', id: 5, vegetation: 1 }, { ...ECO, end: 1, sw: 2, ...(br ? { br: 1 } : {}) }, ...AIS]);
  const t0 = performance.now();
  while (w.tick < 3000 && w.winner < 0) { const a = performance.now(); step(w, []); times.push(performance.now() - a); }
  return { total: performance.now() - t0, med: q(times, 0.5), p99: q(times, 0.99), max: Math.max(...times), ticks: w.tick, hash: hashWorld(w) };
}
const f = x => x.toFixed(3);
for (const seed of seeds.length ? seeds : [1, 2]) for (const br of [1, 0, 1, 0]) {
  const r = run(seed, br);
  console.log(`Hythe seed ${seed} ${br ? 'br   ' : 'no br'}: ${r.ticks} steps ${r.total.toFixed(0)} ms; per step median ${f(r.med)} ms, p99 ${f(r.p99)} ms, max ${f(r.max)} ms; hash ${r.hash}`);
}
