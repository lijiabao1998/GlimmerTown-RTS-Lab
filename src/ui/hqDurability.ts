// R127: only the player's registered HQ; stored durability, no simulation writes.
import { BK_HQ, SIDE_PLAYER, stageOf, type World } from '../sim/world.ts';

export function hqDurability(w: World, enabled = true): string {
  if (!enabled || !w.eco || w.winner >= 0) return '';
  const id = w.eco.hq[SIDE_PLAYER], b = id > 0 ? w.blds[id - 1] : undefined;
  if (!b || b.id !== id || b.kind !== BK_HQ || b.builtBy !== SIDE_PLAYER) return '我方指揮部：未設置';
  const state = b.hp <= 0 ? '已毀' : b.hp >= b.maxHp ? '完好' : stageOf(b) === 1 ? '重損' : '受損';
  return `我方指揮部：${b.hp}/${b.maxHp} · ${state}`;
}
