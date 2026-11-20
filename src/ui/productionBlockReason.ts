// R126: read-only explanation of the existing purchase guards, not deployment limits.
import { ECO_QUEUE, PRODUCIBLE, ARMOR2, hqAlive } from '../sim/eco.ts';
import { INTERNATIONAL_KINDS, SOVIET_KINDS, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_MG, UK_SNIPER, UK_AT91, UK_TRUCK, UK_HALFTRACK, UK_AA, UK_ENGINEER, UK_FLAME, UNIT_KINDS, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）

export function productionBlockReason(w: World, kind: number, enabled = true): string {
  if (!enabled || !w.eco || w.winner >= 0) return '';
  const e = w.eco;
  if (!hqAlive(w, SIDE_PLAYER)) return '指揮部已毀或不存在';
  const closed91 = (kind === UK_SNIPER || kind === UK_AT91) && (!e.sw || !!w.zombies);   // R091：同 eco.ts 的門（下一行的「本局未開放此單位」只能出現一次，瀏覽器守衛錨著）
  const closed92 = (kind === UK_TRUCK || kind === UK_HALFTRACK) && (!e.tp || !!w.zombies);   // R092：同 eco.ts 的門
  const closed93 = kind === UK_AA && (!e.air || !!w.zombies);   // R093：同 eco.ts 的門
  const closed1002 = (kind === UK_ENGINEER || kind === UK_FLAME) && (e.sw !== 2 || !!w.zombies);   // R1002：同 eco.ts 的門
  if (closed93 || closed92 || closed91 || closed1002 || !PRODUCIBLE.includes(kind) || (INTERNATIONAL_KINDS.includes(kind) && !e.international) || (SOVIET_KINDS.includes(kind) && !e.soviet) || (kind === UK_INFANTRY && !e.inf) || ((kind === UK_ATGUN || kind === UK_MORTAR) && !e.guns) || ((kind === UK_LIGHT || kind === UK_HEAVY) && !e.tanks) || (ARMOR2.includes(kind) && !e.armor2) || (kind === UK_MG && !e.mg)) return '本局未開放此單位';
  if (e.queue[SIDE_PLAYER].length >= ECO_QUEUE) return '生產佇列已滿';
  const missing = UNIT_KINDS[kind].cost - e.supply[SIDE_PLAYER];
  return missing > 0 ? `補給不足，還差 ${missing}` : '';
}
