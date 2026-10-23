// R128：只供明確選擇的沙盒世界；普通世界不會由指令升格為沙盒。
import { createWorld, blocks, inGrid, center, UNIT_KINDS, UK_TANK, UK_HOWITZER, SIDE_PLAYER, SIDE_ENEMY, SUB, ORD_IDLE, type World } from './world.ts';
import { dist } from './math.ts';

export const SANDBOX_CAP = 32; // 包含殘骸；ID 永不重用，重置才清空。
export type SandboxPlace = { t: 'sandboxPlace'; side: number; kind: number; x: number; z: number };
export type SandboxCommand = SandboxPlace | { t: 'sandboxRun'; running: boolean } | { t: 'sandboxReset' };
export type SandboxError = 'mode' | 'side' | 'kind' | 'map' | 'building' | 'unit' | 'capacity';

export function createSandboxWorld(seed: number): World {
  const w = createWorld(seed);
  w.units = [];
  w.sandbox = { version: 1, running: false, frame: 0 };
  return w;
}

// UI 只讀同一支檢查；最後仍由 step 內 applySandbox 再檢查。
export function sandboxPlaceError(w: World, c: SandboxPlace): SandboxError | null {
  if (!w.sandbox) return 'mode';
  if (c.side !== SIDE_PLAYER && c.side !== SIDE_ENEMY) return 'side';
  if (c.kind !== UK_TANK && c.kind !== UK_HOWITZER) return 'kind';
  if (!Number.isInteger(c.x) || !Number.isInteger(c.z) || !inGrid(w, c.x, c.z)) return 'map';
  if (w.units.length >= SANDBOX_CAP) return 'capacity';
  if (blocks(w, c.x, c.z)) return 'building';
  const x = center(c.x), z = center(c.z), radius = UNIT_KINDS[c.kind].radius;
  if (w.units.some(u => u.alive && dist(u.x, u.z, x, z) < radius + UNIT_KINDS[u.kind].radius)) return 'unit';
  return null;
}

// 只能由 step／applyCommand 呼叫；不改 AI、單位數值或一般模式。
export function applySandbox(w: World, c: SandboxCommand): void {
  if (!w.sandbox) return;
  if (c.t === 'sandboxRun') {
    if (typeof c.running === 'boolean') w.sandbox.running = c.running;
    return;
  }
  if (c.t === 'sandboxReset') {
    const frame = w.sandbox.frame, fresh = createSandboxWorld(w.seed);
    // 刪掉前局才有的可選狀態（煙幕、聲測等），不能只 Object.assign 留舊資料。
    for (const key of Object.keys(w)) delete (w as unknown as Record<string, unknown>)[key];
    Object.assign(w, fresh);
    w.sandbox!.frame = frame;
    return;
  }
  if (sandboxPlaceError(w, c)) return;
  const k = UNIT_KINDS[c.kind], direction = c.side === SIDE_PLAYER ? -SUB : SUB;
  w.units.push({ id: w.units.length + 1, side: c.side, kind: c.kind, x: center(c.x), z: center(c.z), hp: k.hp, alive: true,
    order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: direction, aimZ: direction,
    ...(k.armored ? { hullX: direction, hullZ: direction } : {}) });
}
