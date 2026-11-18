// R091 模擬每一步的時間（卡面驗收 29；不進 CI）：node tools/r091-time.mjs [--check]
// 河鎮 96、三倍兵力、困難第三版對困難第三版、帶 sw，3,000 步；第 0 步之後雙方各在自己的指揮部旁邊多擺 4 組狙擊手、4 組反戰車小組（電腦不指揮它們，站著打）；
// 對照組把這 16 組換成步兵班。兩邊輪流各跑 5 次，取每一步時間的 p99 的中位數。量之前確認沒有別的工作階段的無頭瀏覽器在跑。
import { performance } from 'node:perf_hooks';
import { createWorld, center, cellOf, UNIT_KINDS, ORD_IDLE, SUB, UK_INFANTRY, UK_SNIPER, UK_AT91 } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { freeNear } from '../src/sim/ai.ts';
import { ECO } from './duel.mjs';

const RUNS = 5, TICKS = 3000, CHECK = process.argv.includes('--check');
function scene(teams) {
  const w = createWorld(31);
  step(w, [{ t: 'map', id: 3, vegetation: 1, sym: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 1 }, { t: 'rules', force: 3 }, { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]);
  for (const side of [0, 1]) {
    const hq = w.blds[w.eco.hq[side] - 1];
    for (let i = 0; i < 8; i++) {
      const kind = teams ? (i % 2 ? UK_AT91 : UK_SNIPER) : UK_INFANTRY, k = UNIT_KINDS[kind];
      const at = freeNear(w, hq.x + (side ? 3 + (i % 4) : -2 - (i % 4)), hq.z + (side ? 3 + (i >> 2) : -2 - (i >> 2)));
      w.units.push({ id: w.units.length + 1, side, kind, x: center(at[0]), z: center(at[1]), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 });
    }
  }
  return w;
}
function run(teams) {
  const w = scene(teams), t = [];
  while (w.tick < TICKS && w.winner < 0) { const t0 = performance.now(); step(w, []); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  return { p99: t[Math.floor(t.length * 0.99)], mean: t.reduce((s, v) => s + v, 0) / t.length, ticks: w.tick };
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const out = { teams: [], sections: [] };
for (let r = 0; r < RUNS; r++) for (const teams of r % 2 ? [false, true] : [true, false]) out[teams ? 'teams' : 'sections'].push(run(teams));
const p = k => med(out[k].map(x => x.p99)), m = k => med(out[k].map(x => x.mean));
console.log(JSON.stringify({ teamsP99: +p('teams').toFixed(3), sectionsP99: +p('sections').toFixed(3), ratio: +(p('teams') / p('sections')).toFixed(3), teamsMean: +m('teams').toFixed(3), sectionsMean: +m('sections').toFixed(3), ticks: out.teams.map(x => x.ticks) }));
if (CHECK && p('teams') > 1.1 * p('sections')) { console.error(`r091-time: p99 ${p('teams').toFixed(3)} ms is more than 1.1× the sections' ${p('sections').toFixed(3)} ms`); process.exit(1); }
