// 腳本戰鬥：固定種子＋固定指令。Node 守衛、無頭 Chrome、黃金雜湊都跑同一場，用來證明決定性。
// 改這份腳本＝改黃金雜湊，卡面要寫明。
import { createWorld, type World } from './world.ts';
import { runLog, type LoggedCommand } from './step.ts';

export const SCRIPT_SEED = 1944;
export const SCRIPT_TICKS = 1200;   // 60 秒

// 單位編號：玩家 1–3 坦克、4 榴彈砲；敵人 5–7 坦克、8 榴彈砲（見 createWorld）
export const SCRIPT: LoggedCommand[] = [
  { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } },
  { tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [1, 2], target: 5 } },
  { tick: 240, cmd: { t: 'attack', side: 0, ids: [3], target: 6 } },
  { tick: 500, cmd: { t: 'move', side: 1, ids: [5, 6, 7], x: 14, z: 12 } },
  { tick: 700, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 9, z: 9 } },
  { tick: 900, cmd: { t: 'fireAt', side: 0, ids: [4], x: 6, z: 6 } },
];

export function runScript(ticks = SCRIPT_TICKS, seed = SCRIPT_SEED): World {
  return runLog(createWorld(seed), SCRIPT, ticks);
}
