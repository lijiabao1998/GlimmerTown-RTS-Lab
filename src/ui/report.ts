// R010 戰報：從世界與模擬事件算出一局的戰果。純函式、不碰 DOM、不改世界（Node 守衛直接測）。
import { UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, SIDE_PLAYER, SIDE_ENEMY, STAGE_ROOFLESS, stageOf, type World, type SimEvent } from '../sim/world.ts';

const KINDS = [UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY];   // R021 加步兵
export interface BattleStats { start: number[][]; fires: number[]; lastKill: { x: number; z: number; tick: number } | null; endTick: number }
export interface Report {
  winner: number; endTick: number; seconds: number;
  start: number[][]; left: number[][];          // [陣營][坦克、榴彈砲、觀測員]
  kills: number; lost: number;                   // 擊毀敵方、我方損失（台）
  rubble: number; roofless: number;              // 轟塌（瓦礫）、打成空殼的建築
  fires: number[];                               // 雙方開火（發）
  built: number; builtStanding: number;          // 我方布陣蓋的、還站著的
  lastKill: { x: number; z: number; tick: number } | null;
}

const sameCol = (kind: number, k: number) => kind === k || (k === UK_HOWITZER && (kind === UK_ATGUN || kind === UK_MORTAR)) || (k === UK_TANK && (kind === UK_LIGHT || kind === UK_HEAVY || kind === UK_ARMORED_CAR || kind === UK_DESTROYER || kind === UK_ASSAULT));   // R022 反戰車砲、迫擊砲算在「砲」那一欄；R023 輕、重坦克（R044 裝甲車、驅逐戰車、突擊砲）算在「坦克」
const count = (w: World, side: number, alive: boolean) => KINDS.map(k => w.units.filter(u => u.side === side && sameCol(u.kind, k) && (!alive || u.alive)).length);

export function newStats(w: World): BattleStats {
  return { start: [count(w, SIDE_PLAYER, false), count(w, SIDE_ENEMY, false)], fires: [0, 0], lastKill: null, endTick: -1 };
}

// 每一步之後呼叫（events＝這一步的模擬事件）
export function statsStep(st: BattleStats, w: World, events: SimEvent[]): void {
  for (const e of events) {
    if (e.e === 'fire') { const u = w.units[e.unit - 1]; if (u && (u.side === SIDE_PLAYER || u.side === SIDE_ENEMY)) st.fires[u.side]++; }
    else if (e.e === 'kill') { const u = w.units[e.unit - 1]; if (u) st.lastKill = { x: u.x, z: u.z, tick: w.tick - 1 }; }
  }
  if (w.winner >= 0 && st.endTick < 0) st.endTick = w.tick;
}

export function makeReport(w: World, st: BattleStats): Report {
  const left = [count(w, SIDE_PLAYER, true), count(w, SIDE_ENEMY, true)];
  const sum = (a: number[]) => a.reduce((p, x) => p + x, 0);
  const endTick = st.endTick >= 0 ? st.endTick : w.tick;
  return {
    winner: w.winner, endTick, seconds: Math.floor(endTick / 20),
    start: st.start.map(a => a.slice()), left,
    kills: sum(st.start[SIDE_ENEMY]) - sum(left[SIDE_ENEMY]), lost: sum(st.start[SIDE_PLAYER]) - sum(left[SIDE_PLAYER]),
    rubble: w.blds.filter(b => b.hp <= 0).length, roofless: w.blds.filter(b => stageOf(b) === STAGE_ROOFLESS).length,
    fires: st.fires.slice(),
    built: w.blds.filter(b => b.builtBy === SIDE_PLAYER).length, builtStanding: w.blds.filter(b => b.builtBy === SIDE_PLAYER && b.hp > 0).length,
    lastKill: st.lastKill ? { ...st.lastKill } : null,
  };
}

// 結局慢動作：勝負出現後 SLOWMO_MS 毫秒內模擬以 SLOWMO 倍速推進
export const SLOWMO = 0.25, SLOWMO_MS = 2500;
export const slowmoFactor = (msSinceEnd: number): number => (msSinceEnd >= 0 && msSinceEnd < SLOWMO_MS ? SLOWMO : 1);
