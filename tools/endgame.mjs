// 一場一定會打完的固定指令紀錄（R010 戰報守衛與煙霧測試共用）：我方每 20 步讓沒有目標的單位攻擊最近的敵人，觀測員每 200 步往最近的敵人靠。
// 只是產生指令紀錄的方法；紀錄一旦產生，重播就跟任何玩家的紀錄一樣決定性。
import { createWorld, SUB, UK_OBSERVER, ORD_ATTACK } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';

export function endgameLog(seed = 1944, cap = 8000) {
  const w = createWorld(seed), log = [];
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  while (w.winner < 0 && w.tick < cap) {
    const cmds = [];
    if (w.tick % 20 === 0) {
      const foes = w.units.filter(u => u.alive && u.side === 1);
      for (const u of w.units.filter(u => u.alive && u.side === 0)) {
        if (!foes.length) break;
        const near = foes.slice().sort((a, b) => d2(u, a) - d2(u, b) || a.id - b.id)[0];
        if (u.kind === UK_OBSERVER) { if (w.tick % 200 === 0) cmds.push({ t: 'move', side: 0, ids: [u.id], x: Math.floor(near.x / SUB) + 3, z: Math.floor(near.z / SUB) + 3 }); continue; }
        if (u.order === ORD_ATTACK && w.units[u.target - 1]?.alive) continue;
        cmds.push({ t: 'attack', side: 0, ids: [u.id], target: near.id });
      }
    }
    for (const c of cmds) log.push({ tick: w.tick, cmd: c });
    step(w, cmds);
  }
  return { log, endTick: w.tick, winner: w.winner };
}
