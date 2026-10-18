// R107：持續煙幕只存在 World，沒有模組快取。查視線不抽亂數、不動世界。
import { N, SUB, cellOf, inMap, type World, type Shell } from './world.ts';
import { randInt } from './rng.ts';

export const SMOKE_RADIUS = 2 * SUB;
export const SMOKE_LIFETIME = 400;
export const SMOKE_CAP = 8;

// 閉線段／閉圓相交，連起點與終點都算。全圖座標的 cross² < 2^53，乘法仍精確；不開根、不除浮點。
export function smokeBlocks(w: World, ax: number, az: number, bx: number, bz: number, ignoreSmokeId = 0): boolean {
  if (!w.smoke) return false;
  const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz, radius2 = SMOKE_RADIUS * SMOKE_RADIUS;
  for (const c of w.smoke.clouds) {
    if (c.id === ignoreSmokeId || c.born > w.tick || c.expires <= w.tick) continue;
    const qx = c.x - ax, qz = c.z - az, dot = qx * dx + qz * dz;
    if (dot <= 0) { if (qx * qx + qz * qz <= radius2) return true; }
    else if (dot >= length2) { const ex = c.x - bx, ez = c.z - bz; if (ex * ex + ez * ez <= radius2) return true; }
    else { const cross = qx * dz - qz * dx; if (cross * cross <= radius2 * length2) return true; }
  }
  return false;
}

// 只由 step() 的實際落地呼叫；未落地、地圖外的彈不選風向。id 沿用砲彈的整局唯一 id。
export function spawnSmoke(w: World, s: Shell): void {
  if (!inMap(cellOf(s.ex), cellOf(s.ez))) return;
  if (!w.smoke) {
    const wind = randInt(w, 4);
    w.smoke = { windX: wind === 0 ? 1 : wind === 1 ? -1 : 0, windZ: wind === 2 ? 1 : wind === 3 ? -1 : 0, clouds: [] };
  }
  const clouds = w.smoke.clouds;
  // 同一步落地依砲彈更新順序；同出生 tick 的先進先出，重播不靠引擎排序。
  while (clouds.length >= SMOKE_CAP) clouds.shift();
  clouds.push({ id: s.id, side: s.side, x: s.ex, z: s.ez, born: w.tick, expires: w.tick + SMOKE_LIFETIME });
}

// 每次 step 尾端、tick 遞增後呼叫一次。新落地也隨這一步漂移；邊界夾住而非環繞。
export function advanceSmoke(w: World): void {
  if (!w.smoke) return;
  const s = w.smoke, limit = N * SUB - 1;
  s.clouds = s.clouds.filter(c => c.expires > w.tick);
  for (const c of s.clouds) {
    c.x = Math.max(0, Math.min(limit, c.x + s.windX));
    c.z = Math.max(0, Math.min(limit, c.z + s.windZ));
  }
}
