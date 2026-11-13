// R104：車體面向只讀整數狀態；正／後各 90 度，側面為其餘。
import { UNIT_KINDS, type Unit } from './world.ts';

export const ARMOR_FRONT = 75, ARMOR_SIDE = 100, ARMOR_REAR = 125;

export const FACE_FRONT = 0, FACE_SIDE = 1, FACE_REAR = 2;

// 從 (sx, sz) 打來的一發，打在車體的哪一面（R051 的厚度也用這個判定）
export function armorFace(u: Unit, sx: number, sz: number): number {
  if (!UNIT_KINDS[u.kind].armored || u.hullX === undefined || u.hullZ === undefined) return FACE_SIDE;
  const hx = u.hullX, hz = u.hullZ, dx = sx - u.x, dz = sz - u.z;
  const h2 = hx * hx + hz * hz, d2 = dx * dx + dz * dz;
  if (!h2 || !d2) return FACE_SIDE;
  const dot = hx * dx + hz * dz;
  // hull 是實際一 tick 位移（出生為 ±256）；32 格世界內中間值都在安全整數範圍。
  if (2 * dot * dot < h2 * d2) return FACE_SIDE;
  return dot > 0 ? FACE_FRONT : FACE_REAR;
}

const FACE_PCT = [ARMOR_FRONT, ARMOR_SIDE, ARMOR_REAR];
export function armorPct(u: Unit, sx: number, sz: number): number {
  return FACE_PCT[armorFace(u, sx, sz)];
}
