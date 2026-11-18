// R092 模擬每一步的時間（卡面驗收 23；不進 CI）：node tools/r092-time.mjs [--check]
// 一、只有電腦的河鎮 96（三倍兵力、困難對困難、3,000 步）：帶 tp 對不帶 tp。門檻：每一步的 p99 與平均都 ≤ 1.1 倍。
// 二、上下車本身（只記不判）：同一個場面雙方各多擺 4 台卡車、4 班步兵，每 200 步照同一份腳本來回開；車空著開 對 載著開。
// 兩邊輪流各跑 5 次，取中位數。量之前確認沒有別的工作階段的無頭瀏覽器在跑。
import { performance } from 'node:perf_hooks';
import { createWorld, center, UNIT_KINDS, ORD_IDLE, SUB, UK_INFANTRY, UK_TRUCK } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { freeNear } from '../src/sim/ai.ts';
import { ECO } from './duel.mjs';

const RUNS = 5, TICKS = 3000, CHECK = process.argv.includes('--check');
function open(tp, cars) {
  const w = createWorld(31);
  step(w, [{ t: 'map', id: 3, vegetation: 1, sym: 1, more: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, ...(tp ? { tp: 1 } : {}) }, { t: 'rules', force: 3 }, { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]);
  const pairs = [];
  if (cars) for (const side of [0, 1]) { const hq = w.blds[w.eco.hq[side] - 1]; for (let i = 0; i < 4; i++) {
    const at = freeNear(w, hq.x + (side ? 4 + i : -3 - i), hq.z + (side ? 4 : -3)), mk = kind => { const k = UNIT_KINDS[kind], u = { id: w.units.length + 1, side, kind, x: center(at[0]), z: center(at[1]), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
    pairs.push([side, mk(UK_TRUCK), mk(UK_INFANTRY), at]); } }
  return { w, pairs };
}
function run(tp, cars, load) {
  const { w, pairs } = open(tp, cars), t = [];
  while (w.tick < TICKS && w.winner < 0) {
    const cmds = [];
    if (cars && w.tick % 200 === 0) for (const [side, tr, inf, at] of pairs) { const out = (w.tick / 200) % 2 === 0, x = Math.max(1, Math.min(w.n - 2, at[0] + (out ? (side ? -8 : 8) : 0))), z = at[1]; cmds.push({ t: 'move', side, ids: load && tr.alive && inf.alive ? [tr.id, inf.id] : [tr.id], x, z }); }
    const t0 = performance.now(); step(w, cmds); t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return { p99: t[Math.floor(t.length * 0.99)], mean: t.reduce((s, v) => s + v, 0) / t.length };
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pair = (fa, fb) => { const a = [], b = []; for (let r = 0; r < RUNS; r++) { if (r % 2) { b.push(fb()); a.push(fa()); } else { a.push(fa()); b.push(fb()); } } return { a: { p99: med(a.map(x => x.p99)), mean: med(a.map(x => x.mean)) }, b: { p99: med(b.map(x => x.p99)), mean: med(b.map(x => x.mean)) } }; };
const ai = pair(() => run(true, false, false), () => run(false, false, false));
const ld = pair(() => run(true, true, true), () => run(true, true, false));
const r = (x, y) => +(x / y).toFixed(3), f = v => +v.toFixed(3);
console.log(JSON.stringify({ aiOnly: { tp: ai.a, noTp: ai.b, p99Ratio: r(ai.a.p99, ai.b.p99), meanRatio: r(ai.a.mean, ai.b.mean) }, loadedVsEmpty: { loaded: ld.a, empty: ld.b, p99Ratio: r(ld.a.p99, ld.b.p99), meanRatio: r(ld.a.mean, ld.b.mean) } }, (k, v) => typeof v === 'number' ? f(v) : v));
if (CHECK && (ai.a.p99 > 1.1 * ai.b.p99 || ai.a.mean > 1.1 * ai.b.mean)) { console.error('r092-time: with tp the AI-only battle is more than 1.1× slower'); process.exit(1); }
