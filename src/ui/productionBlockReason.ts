// R126: read-only explanation of the existing purchase guards, not deployment limits.
import { ECO_QUEUE, PRODUCIBLE, ARMOR2, hqAlive } from '../sim/eco.ts';
import { SOVIET_KINDS, SIDE_PLAYER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UNIT_KINDS, type World } from '../sim/world.ts';

export function productionBlockReason(w: World, kind: number, enabled = true): string {
  if (!enabled || !w.eco || w.winner >= 0) return '';
  const e = w.eco;
  if (!hqAlive(w, SIDE_PLAYER)) return '指揮部已毀或不存在';
  if (!PRODUCIBLE.includes(kind) || (SOVIET_KINDS.includes(kind) && !e.soviet) || (kind === UK_INFANTRY && !e.inf) || ((kind === UK_ATGUN || kind === UK_MORTAR) && !e.guns) || ((kind === UK_LIGHT || kind === UK_HEAVY) && !e.tanks) || (ARMOR2.includes(kind) && !e.armor2)) return '本局未開放此單位';
  if (e.queue[SIDE_PLAYER].length >= ECO_QUEUE) return '生產佇列已滿';
  const missing = UNIT_KINDS[kind].cost - e.supply[SIDE_PLAYER];
  return missing > 0 ? `補給不足，還差 ${missing}` : '';
}
