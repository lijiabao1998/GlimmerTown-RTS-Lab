// R093 模擬每一步的時間（卡面驗收 36；不進 CI）：node tools/r093-time.mjs [--check]
// A：只有電腦的河鎮 96（地圖 3，三倍兵力、困難第三版對困難第三版、3,000 步）：帶 air 對不帶。門檻：每一步的 p99 與平均都 ≤ 1.1 倍。
// B（只記）：同一幕，雙方第 0 步各擺 4 門防空砲，工具替第 0 方在冷卻一好就叫偵察（地圖中心）和轟炸（看得到的格）；
//   對照組不帶 air，改擺 4 門反戰車砲、不叫。兩邊輪流各跑 5 次取中位數。量之前確認沒有 Codex 或別的工作階段的無頭瀏覽器在跑。
import { performance } from 'node:perf_hooks';
import { createWorld, center, cellOf, UNIT_KINDS, ORD_IDLE, SUB, UK_AA, UK_ATGUN } from '../src/sim/world.ts';
import { step, spotted } from '../src/sim/step.ts';
import { freeNear } from '../src/sim/ai.ts';
import { why93 } from '../src/ui/air93.ts';
import { ECO } from './duel.mjs';

const RUNS = 5, TICKS = 3000, CHECK = process.argv.includes('--check');
function open(air, guns) {
  const w = createWorld(31);
  step(w, [{ t: 'map', id: 3, vegetation: 1, sym: 1, more: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, tp: 2, ...(air ? { air: 1 } : {}) }, { t: 'rules', force: 3 }, { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]);
  if (guns) for (const side of [0, 1]) { const hq = w.blds[w.eco.hq[side] - 1]; for (let i = 0; i < 4; i++) {
    const at = freeNear(w, hq.x + (side ? 4 + i : -3 - i), hq.z + (side ? 4 : -3)), k = UNIT_KINDS[guns];
    w.units.push({ id: w.units.length + 1, side, kind: guns, x: center(at[0]), z: center(at[1]), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); } }
  return w;
}
function run(air, guns, calls) {
  const w = open(air, guns), t = [], mid = w.n >> 1;
  while (w.tick < TICKS && w.winner < 0) {
    const cmds = [];
    if (calls) {
      if (why93(w, 0, 2) === '') cmds.push({ t: 'air', side: 0, kind: 2, x: mid, z: mid });
      if (why93(w, 0, 1) === '') { const e = w.units.find(u => u.alive && u.side === 1 && spotted(w, 0, u.x, u.z)); if (e) cmds.push({ t: 'air', side: 0, kind: 1, x: cellOf(e.x), z: cellOf(e.z) }); }
    }
    const t0 = performance.now(); step(w, cmds); t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return { p99: t[Math.floor(t.length * 0.99)], mean: t.reduce((s, v) => s + v, 0) / t.length };
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pair = (fa, fb) => { const a = [], b = []; for (let r = 0; r < RUNS; r++) { if (r % 2) { b.push(fb()); a.push(fa()); } else { a.push(fa()); b.push(fb()); } } return { a: { p99: med(a.map(x => x.p99)), mean: med(a.map(x => x.mean)) }, b: { p99: med(b.map(x => x.p99)), mean: med(b.map(x => x.mean)) } }; };
const A = pair(() => run(true, 0, false), () => run(false, 0, false));
const B = pair(() => run(true, UK_AA, true), () => run(false, UK_ATGUN, false));
const r = (x, y) => +(x / y).toFixed(3), f = v => +v.toFixed(3);
console.log(JSON.stringify({ aiOnly: { air: A.a, noAir: A.b, p99Ratio: r(A.a.p99, A.b.p99), meanRatio: r(A.a.mean, A.b.mean) }, airWar: { air: B.a, control: B.b, p99Ratio: r(B.a.p99, B.b.p99), meanRatio: r(B.a.mean, B.b.mean) } }, (k, v) => typeof v === 'number' ? f(v) : v));
if (CHECK && (A.a.p99 > 1.1 * A.b.p99 || A.a.mean > 1.1 * A.b.mean)) { console.error('r093-time: with air the AI-only battle is more than 1.1× slower'); process.exit(1); }
