import { SIDE_PLAYER, TICK_HZ, UNIT_KINDS, type World } from '../sim/world.ts';
import { hqAlive } from '../sim/eco.ts';

const labels = ['坦克', '榴彈砲', '觀測員', '步兵', '反戰車砲', '迫擊砲', '輕坦克', '重坦克', '裝甲車', '驅逐戰車', '突擊砲'];
// R125: manufacturing time only, not an arrival promise. Completed work can wait indefinitely.
export function productionCountdown(w: World, enabled = true): string {
  if (!enabled || w.winner >= 0 || !w.eco || !hqAlive(w, SIDE_PLAYER)) return '';
  const queue = w.eco.queue[SIDE_PLAYER];
  if (!queue.length) return '';
  const kind = queue[0], remaining = UNIT_KINDS[kind].buildTicks - w.eco.prog[SIDE_PLAYER];
  const status = remaining > 0 ? `製造剩餘 ${Math.ceil(remaining / TICK_HZ)} 遊戲秒` : '等待部署';
  return `${labels[kind] ?? UNIT_KINDS[kind].name}：${status} · 後續 ${queue.length - 1}`;
}
