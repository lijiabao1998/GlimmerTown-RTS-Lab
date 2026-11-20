// R1005 電腦第四版的量測（不進 CI）：第四版對第三版，eco 跟新開的局一樣（sw＝2、tech＝1、tp＝2、air、pla、mg＝2、end），map 指令帶 sym。
// 用法：node tools/r1005-duel.mjs [--map 2] [--seeds 21-80] [--level 3] [--a 4] [--b 3] [--ticks 24000] [--rows]
//   每個種子跑兩局（a 在右下、a 在左上），數 a 贏幾局；另記 a、b 兩邊造了幾組新的四種兵、放了幾個工地、蓋好幾棟、工兵炸了幾包、火焰噴射器噴了幾次、每一局多少毫秒。
import { createWorld, UK_ENGINEER, UK_FLAME, UK_SNIPER, UK_AT91 } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from './duel.mjs';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const [lo, hi] = String(arg('seeds', '21-80')).split('-').map(Number), map = Number(arg('map', 2)), lv = Number(arg('level', 3)), TICKS = Number(arg('ticks', 24000));
const va = Number(arg('a', 4)), vb = Number(arg('b', 3)), rows = process.argv.includes('--rows');
const NEW = [UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME];
export const ECO1005 = { ...ECO, air: 1, end: 1, tp: 2, sw: 2, pla: 1, mg: 2, tech: 1 };

export function battle(seed, aSide, opts = {}) {
  const w = createWorld(seed), bSide = 1 - aSide, vOf = s => (s === aSide ? opts.va ?? va : opts.vb ?? vb);
  step(w, [{ t: 'map', id: opts.map ?? map, vegetation: 1, sym: 1 }, ECO1005, { t: 'ai', side: 1, level: opts.lv ?? lv, v: vOf(1) }, { t: 'ai', side: 0, level: opts.lv ?? lv, v: vOf(0) }]);
  const start = w.units.length, st = { built: [[0, 0, 0, 0], [0, 0, 0, 0]], sites: [0, 0], done: [0, 0], demo: [0, 0], flame: [0, 0] };
  const t0 = performance.now();
  while (w.winner < 0 && w.tick < (opts.ticks ?? TICKS)) {
    step(w, []);
    for (const e of w.events) {
      if (e.e === 'build') { const b = w.blds[e.bld - 1]; if (b?.builtBy !== undefined && b.builtBy < 2) st.sites[b.builtBy]++; }
      else if (e.e === 'fire') { const u = w.units[e.unit - 1]; if (u?.kind === UK_FLAME && u.side < 2) st.flame[u.side]++; }
      else if (e.e === 'impact' && e.r === 128) { const near = w.units.filter(u => u.alive && u.kind === UK_ENGINEER).sort((p, q) => Math.abs(p.x - e.x) + Math.abs(p.z - e.z) - Math.abs(q.x - e.x) - Math.abs(q.z - e.z))[0]; if (near && near.side < 2) st.demo[near.side]++; }
    }
  }
  const ms = performance.now() - t0;
  for (const u of w.units.slice(start)) if (u.side < 2 && NEW.includes(u.kind)) st.built[u.side][NEW.indexOf(u.kind)]++;
  for (const b of w.blds) if (b.builtBy !== undefined && b.builtBy < 2 && b.kind >= 14 && b.kind <= 16 && b.hp > 0 && !w.tech?.sites.some(s => s.id === b.id)) st.done[b.builtBy]++;
  const pick = arr => [arr[aSide], arr[bSide]];   // 照 a、b 排
  return { seed, aSide, winner: w.winner === aSide ? 'a' : w.winner === bSide ? 'b' : w.winner === 2 ? 'draw' : 'timeout', ticks: w.tick, ms: Math.round(ms), built: pick(st.built), sites: pick(st.sites), done: pick(st.done), demo: pick(st.demo), flame: pick(st.flame) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const out = [];
  for (let s = lo; s <= (hi ?? lo); s++) for (const aSide of [0, 1]) { const r = battle(s, aSide); out.push(r); if (rows) console.log(JSON.stringify(r)); }
  const n = k => out.filter(r => r.winner === k).length, sum = (f, i) => out.reduce((t, r) => t + (Array.isArray(r[f][i]) ? r[f][i].reduce((a, b) => a + b, 0) : r[f][i]), 0);
  const per = (f, i) => out.reduce((acc, r) => r[f][i].map((v, j) => (acc[j] ?? 0) + v), []);
  const decided = n('a') + n('b');
  console.log(JSON.stringify({ map, level: lv, a: va, b: vb, games: out.length, a_wins: n('a'), b_wins: n('b'), draw: n('draw'), timeout: n('timeout'), a_rate: decided ? +(n('a') / decided).toFixed(3) : null,
    built_a: per('built', 0), built_b: per('built', 1), sites: [sum('sites', 0), sum('sites', 1)], done: [sum('done', 0), sum('done', 1)], demo: [sum('demo', 0), sum('demo', 1)], flame: [sum('flame', 0), sum('flame', 1)],
    ms_mean: Math.round(out.reduce((t, r) => t + r.ms, 0) / out.length), ticks_mean: Math.round(out.reduce((t, r) => t + r.ticks, 0) / out.length) }));
}
