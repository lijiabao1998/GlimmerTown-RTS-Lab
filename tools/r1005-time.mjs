// R1005 卡面驗收 9（不進 CI）：node tools/r1005-time.mjs
// 第四版對第三版：鄉間 64 種子 61–70，記「電腦這一步有想」的那幾步的時間（p50、p99），和每一步平均；兩組輪流跑。量之前確認沒有別的工作階段的無頭瀏覽器在跑
import { performance } from 'node:perf_hooks';
import { createWorld } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO1005 } from './r1005-duel.mjs';
const res = { 4: { think: [], all: [] }, 3: { think: [], all: [] } };
for (let seed = 61; seed <= 70; seed++) for (const v of seed % 2 ? [4, 3] : [3, 4]) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, ECO1005, { t: 'ai', side: 1, level: 3, v }, { t: 'ai', side: 0, level: 3, v }]);
  while (w.winner < 0 && w.tick < 12000) {
    const thinks = w.ai.some(a => a.next <= w.tick), t0 = performance.now(); step(w, []); const d = performance.now() - t0;
    res[v].all.push(d); if (thinks) res[v].think.push(d);
  }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * p)]; };
const out = {}; for (const v of [4, 3]) out[v] = { thinkP50: +q(res[v].think, 0.5).toFixed(3), thinkP99: +q(res[v].think, 0.99).toFixed(3), mean: +(res[v].all.reduce((s, x) => s + x, 0) / res[v].all.length).toFixed(3), steps: res[v].all.length };
out.ratio = { thinkP99: +(out[4].thinkP99 / out[3].thinkP99).toFixed(3), mean: +(out[4].mean / out[3].mean).toFixed(3) };
console.log(JSON.stringify(out));
