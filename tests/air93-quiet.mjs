// R093 驗收 4：電腦一行都不多下。兩個世界只差 eco 有沒有 air: 1（地圖、eco 照新開一局送的；雙方都是困難的電腦）。
// 第一、二、三版 × 地圖 0、1 × 種子 1–3（18 對）打到分出勝負（≤ 36,000 步）；地圖 2、3、5 用第三版、種子 1 跑固定步數。
// 每一步：佇列和單位從來沒有 46、從來沒有 w.sky；每 50 步和最後一步：刪掉 eco.air 再算雜湊，兩邊一樣；勝方和結束的步數一樣；電腦有在生產、開火。
// QUIET_ONE=1：只跑第一對（故意弄壞的隔離副本裡用；tests/air93-negative.mjs）。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, UK_AA } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { ECO } from '../tools/duel.mjs';

const NEW_GAME = { t: 'map', vegetation: 1, sym: 1, more: 1 }, NEW_ECO = { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, tp: 2 };
const noAir = w => { const a = w.eco?.air; if (a) delete w.eco.air; const h = hashWorld(w); if (a) w.eco.air = a; return h; };
const ONE = process.env.QUIET_ONE === '1';
let games = 0, fired = 0, made = 0;
function pair(map, seed, v, ticks) {
  const open = air => { const w = createWorld(seed); step(w, [{ ...NEW_GAME, id: map }, { ...NEW_ECO, ...(air ? { air: 1 } : {}) }, { t: 'ai', side: 0, level: 3, ...(v ? { v } : {}) }, { t: 'ai', side: 1, level: 3, ...(v ? { v } : {}) }]); return w; };
  const a = open(true), b = open(false), tag = `v${v ?? 1} map ${map} seed ${seed}`, n0 = a.units.length;
  assert.equal(a.eco.air, 1, `quiet: ${tag} — the world carries air`);
  while (a.tick < ticks && (a.winner < 0 || b.winner < 0)) {
    step(a, []); step(b, []);
    assert(!a.sky, `quiet: AI-only battles never get w.sky (${tag}, step ${a.tick})`);
    assert(!a.eco.queue.some(q => q.includes(UK_AA)) && !a.units.some(u => u.kind === UK_AA), `quiet: ${tag} never queues or owns kind 46 (step ${a.tick})`);
    fired += a.events.filter(e => e.e === 'fire').length;
    if (a.tick % 50 === 0 || a.winner >= 0 || b.winner >= 0) assert.equal(noAir(a), hashWorld(b), `quiet: ${tag}: with air the world is the same as without it at step ${a.tick}`);
  }
  made += a.units.length - n0;
  assert.deepEqual([a.winner, a.tick], [b.winner, b.tick], `quiet: ${tag}: same winner, same last step`);
  games++;
}
for (const v of [undefined, 2, 3]) for (const map of [0, 1]) for (let seed = 1; seed <= 3; seed++) { pair(map, seed, v, 36000); if (ONE) break; }
if (!ONE) for (const map of [2, 3, 5]) pair(map, 1, 3, map === 5 ? 4000 : 3000);
assert(fired > 0 && made > 0, `quiet: the computers produced (${made}) and fired (${fired})`);
console.log(`air93-quiet: ${games} games, with air bit for bit the same as without it (apart from the air fold); ${made} units made, ${fired} shots`);
