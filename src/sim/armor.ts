// R104：車體面向只讀整數狀態；正／後各 90 度，側面為其餘。
import { UNIT_KINDS, type Unit } from './world.ts';

export const ARMOR_FRONT = 75, ARMOR_SIDE = 100, ARMOR_REAR = 125;

export function armorPct(u: Unit, sx: number, sz: number): number {
  if (!UNIT_KINDS[u.kind].armored || u.hullX === undefined || u.hullZ === undefined) return ARMOR_SIDE;
  const hx = u.hullX, hz = u.hullZ, dx = sx - u.x, dz = sz - u.z;
  const h2 = hx * hx + hz * hz, d2 = dx * dx + dz * dz;
  if (!h2 || !d2) return ARMOR_SIDE;
  const dot = hx * dx + hz * dz;
  // hull 是實際一 tick 位移（出生為 ±256）；32 格世界內中間值都在安全整數範圍。
  if (2 * dot * dot < h2 * d2) return ARMOR_SIDE;
  return dot > 0 ? ARMOR_FRONT : ARMOR_REAR;
}
