// R118：開戰前的可穿行戰壕。格子清單是唯一佔地來源，不改道路、尋路或視線。
import { BUILD_POINTS, pointsUsed, territory } from './build.ts';
import { clearVegetation } from './vegetation.ts';
import { cellIdx, inGrid, cellOf, wireAt, TER_ROAD, TER_MUD, SIDE_PLAYER, SIDE_ENEMY, type World, type TrenchSegment } from './world.ts';

export interface TrenchCmd { t: 'trench'; side: number; kind: number; x: number; z: number; rot?: number }
export interface TrenchKind { kind: number; name: string; cost: number; cover: number; cells: readonly (readonly [number, number])[] }
export const TRENCH_KINDS: readonly TrenchKind[] = [
  { kind: 0, name: 'straight', cost: 1, cover: 75, cells: [[0, 0], [1, 0]] },
  { kind: 1, name: 'bend', cost: 2, cover: 75, cells: [[0, 0], [1, 0], [1, 1]] },
  { kind: 2, name: 'communication', cost: 1, cover: 90, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { kind: 3, name: 'reinforced', cost: 2, cover: 50, cells: [[0, 0], [1, 0]] },
];
export const trenchKind = (kind: number): TrenchKind | null => TRENCH_KINDS.find(k => k.kind === kind) ?? null;

// 四個整數四分之一轉；轉完平移到非負包圍盒，cmd.x/z 永遠是包圍盒左上。
export function trenchCells(cmd: Pick<TrenchCmd, 'kind' | 'x' | 'z' | 'rot'>): Array<[number, number]> {
  const k = trenchKind(cmd.kind), rot = cmd.rot ?? 0;
  if (!k || !Number.isInteger(rot) || rot < 0 || rot > 3 || !Number.isInteger(cmd.x) || !Number.isInteger(cmd.z)) return [];
  const cells: Array<[number, number]> = k.cells.map(([x, z]) => rot === 0 ? [x, z] : rot === 1 ? [-z, x] : rot === 2 ? [-x, -z] : [z, -x]);
  const minX = Math.min(...cells.map(c => c[0])), minZ = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, z]) => [cmd.x + x - minX, cmd.z + z - minZ]);
}

export function trenchAt(w: World, x: number, z: number): TrenchSegment | null {
  if (!Number.isInteger(x) || !Number.isInteger(z) || !inGrid(w, x, z) || w.trenches?.version !== 1) return null;
  for (const s of w.trenches.segments) if (trenchCells(s).some(([cx, cz]) => cx === x && cz === z)) return s;
  return null;
}
export function trenchCover(w: World, x: number, z: number): number {
  const s = trenchAt(w, x, z);
  return s ? trenchKind(s.kind)!.cover : 100;
}
export function trenchPointsUsed(w: World, side: number): number {
  let p = 0;
  for (const s of w.trenches?.segments ?? []) if (s.side === side) p += trenchKind(s.kind)?.cost ?? 0;
  return p;
}

export function trenchError(w: World, cmd: TrenchCmd): string | null {
  if (w.tick !== 0) return 'tick';
  if (cmd.side !== SIDE_PLAYER && cmd.side !== SIDE_ENEMY) return 'side';
  const k = trenchKind(cmd.kind);
  if (!k) return 'kind';
  if (cmd.rot !== undefined && (!Number.isInteger(cmd.rot) || cmd.rot < 0 || cmd.rot > 3)) return 'rot';
  if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.z)) return 'coord';
  const cells = trenchCells(cmd);
  if (cells.some(([x, z]) => !inGrid(w, x, z))) return 'map';
  for (const [x, z] of cells) if (!territory(cmd.side, x, z, w.n)) return territory(1 - cmd.side, x, z, w.n) ? 'foreign' : 'neutral';
  if (cells.some(([x, z]) => w.ter[cellIdx(w, x, z)] === TER_ROAD)) return 'road';
  if (cells.some(([x, z]) => w.ter[cellIdx(w, x, z)] === TER_MUD)) return 'mud';
  if (cells.some(([x, z]) => w.occ[cellIdx(w, x, z)] || trenchAt(w, x, z) || wireAt(w, x, z))) return 'occupied';
  if (w.units.some(u => u.alive && cells.some(([x, z]) => cellOf(u.x) === x && cellOf(u.z) === z))) return 'unit';
  if (pointsUsed(w, cmd.side) + k.cost > BUILD_POINTS) return 'points';
  return null;
}

// 成功才建立持久狀態；失敗不改欄位、事件、植被或 RNG。
export function applyTrench(w: World, cmd: TrenchCmd): string | null {
  const err = trenchError(w, cmd);
  if (err) return err;
  const s: TrenchSegment = { side: cmd.side, kind: cmd.kind, x: cmd.x, z: cmd.z, rot: cmd.rot ?? 0 };
  if (!w.trenches) w.trenches = { version: 1, segments: [] };
  w.trenches.segments.push(s);
  for (const [x, z] of trenchCells(s)) clearVegetation(w, x, z, 1, 1);
  w.events.push({ e: 'trench' });
  return null;
}
