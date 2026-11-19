// R092 驗收 4：電腦一行都不多下。帶 tp 與不帶 tp：第一、二、三版 × 地圖 0、1 × 種子 1–5，打到分出勝負（≤ 36,000 步）；
// 每 50 步與結束那一步，世界的雜湊（扣掉 tp 那一項）一樣，勝負與結束的步數一樣，佇列從來沒有 44、45。單獨一支，免得 transport92.mjs 超過每支 120 秒。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, UK_TRUCK, UK_HALFTRACK } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from '../tools/duel.mjs';

const noTp = w => { const t = w.eco?.tp; if (t) delete w.eco.tp; const h = hashWorld(w); if (t) w.eco.tp = t; return h; };
let games = 0;
for (const v of [undefined, 2, 3]) for (const map of [0, 1]) for (let seed = 1; seed <= 5; seed++) {
  const open = tp => { const w = createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1, more: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, ...(tp ? { tp: 1 } : {}) }, { t: 'ai', side: 0, level: 3, ...(v ? { v } : {}) }, { t: 'ai', side: 1, level: 3, ...(v ? { v } : {}) }]); return w; };
  const a = open(true), b = open(false), tag = `v${v ?? 1} map ${map} seed ${seed}`;
  assert.equal(a.eco.tp, 1, `quiet: ${tag} — the world carries tp`);
  while (a.tick < 36000 && (a.winner < 0 || b.winner < 0)) {
    step(a, []); step(b, []);
    if (a.tick % 50 === 0 || a.winner >= 0 || b.winner >= 0) assert.equal(noTp(a), noTp(b), `quiet: ${tag}: with tp the world is the same as without it at step ${a.tick}`);
    assert(!a.eco.queue.some(q => q.includes(UK_TRUCK) || q.includes(UK_HALFTRACK)), `quiet: ${tag}: the computer never queues a truck or a half-track`);
  }
  assert.deepEqual([a.winner, a.tick], [b.winner, b.tick], `quiet: ${tag}: same winner, same last step`);
  games++;
}
console.log(`transport92-quiet: ${games} games, with tp bit for bit the same as without it (apart from the tp fold)`);
