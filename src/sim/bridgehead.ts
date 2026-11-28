import { HYTHE_BRIDGES, HYTHE_N, MAP_HYTHE } from './hytheMap.ts';
import { center, SUB, TICK_HZ, waterAt, type World } from './world.ts';

export const [BRIDGE_X, BRIDGE_Z] = HYTHE_BRIDGES[1]; // 西海斯
export const CAPTURE_RADIUS = 4, CAPTURE_TICKS = 5 * TICK_HZ, SUPPLY_TICKS = 10 * TICK_HZ;
const radius = CAPTURE_RADIUS * SUB;
const radiusSquared = radius * radius;

export interface Bridgehead {
  owner: number;       // -1 中立，0、1 為陣營
  claimant: number;    // 正在佔領的一方，爭奪時保留已走的進度
  progress: number;
  supplyTicks: number; // 現任守方已累積、還沒結算的駐守時間
}

export function startBridgehead(w: World): void {
  if (w.tick === 0 && w.map === MAP_HYTHE && w.eco && !w.sandbox && !w.zombies && !w.bridgehead) {
    w.bridgehead = { owner: -1, claimant: -1, progress: 0, supplyTicks: 0 };
  }
}

// 兩個低位元各代表一方。用單位的實際位置；乘員與被拖的砲在脫離運輸後才獨立計數。
export function bridgePresence(w: World): number {
  let present = 0;
  for (const u of w.units) {
    if (!u.alive || u.ride || u.towBy) continue;
    const dx = u.x - center(BRIDGE_X), dz = u.z - center(BRIDGE_Z);
    if (dx * dx + dz * dz <= radiusSquared) present |= 1 << u.side;
    if (present === 3) break;
  }
  return present;
}

export function stepBridgehead(w: World): void {
  const point = w.bridgehead;
  if (!point || !w.eco || w.winner >= 0) return;
  if (waterAt(w, BRIDGE_X, BRIDGE_Z)) {
    point.claimant = -1; point.progress = 0; point.supplyTicks = 0;
    return;
  }
  const present = bridgePresence(w);
  if (present === 3) return;
  if (present === 0) {
    point.claimant = -1; point.progress = 0;
    return;
  }
  const side = present === 1 ? 0 : 1;
  if (side === point.owner) {
    point.claimant = -1; point.progress = 0;
    if (++point.supplyTicks === SUPPLY_TICKS) {
      w.eco.supply[side]++;
      point.supplyTicks = 0;
    }
  } else {
    if (side !== point.claimant) { point.claimant = side; point.progress = 0; }
    if (++point.progress === CAPTURE_TICKS) {
      point.owner = side; point.claimant = -1; point.progress = 0; point.supplyTicks = 0;
    }
  }
}

export function validBridgehead(r: Record<string, unknown>): boolean {
  if (r.bridgehead === undefined) return true;
  if (r.map !== MAP_HYTHE || r.n !== HYTHE_N || !r.eco || r.zombies || r.sandbox) return false;
  if (!r.bridgehead || typeof r.bridgehead !== 'object') return false;
  const { owner, claimant, progress, supplyTicks } = r.bridgehead as Bridgehead;
  return [-1, 0, 1].includes(owner) && [-1, 0, 1].includes(claimant)
    && Number.isInteger(progress) && progress >= 0 && progress < CAPTURE_TICKS
    && (progress === 0 ? claimant === -1 : claimant >= 0 && claimant !== owner)
    && Number.isInteger(supplyTicks) && supplyTicks >= 0 && supplyTicks < SUPPLY_TICKS
    && (owner >= 0 || supplyTicks === 0);
}
