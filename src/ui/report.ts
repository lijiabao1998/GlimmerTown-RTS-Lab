// R010 戰報：從世界與模擬事件算出一局的戰果。純函式、不碰 DOM、不改世界（Node 守衛直接測）。
import { INTERNATIONAL_KINDS, INTERNATIONAL_GUNS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_MG, UK_SNIPER, UK_AT91, UK_TRUCK, UK_HALFTRACK, STAGE_ROOFLESS, stageOf, UK_AA, UK_ENGINEER, UK_FLAME, type World, type SimEvent } from '../sim/world.ts';
import { SIDE_PLAYER, SIDE_ENEMY } from '../side.ts';   // R085「我方」可以換（連線對戰）

const KINDS = [UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY];   // R021 加步兵
export interface BattleStats { start: number[][]; fires: number[]; lastKill: { x: number; z: number; tick: number } | null; endTick: number; bounces?: number[]; dead?: number[] }   // bounces（R051）：雙方各有幾發穿甲彈被彈開；有發生才有這一欄。dead（R081）：雙方各陣亡幾個（數 kill 事件；有補給的新局才有）
export interface Report {
  zombies?: { wave: number; killed: number; lost: number };
  winner: number; endTick: number; seconds: number;   // winner（R085）：照「我方」——0＝我方贏、1＝敵方贏、2＝同歸於盡、−1＝還沒分出來
  start: number[][]; left: number[][];          // [我方、敵方][坦克、榴彈砲、觀測員]（R085：照「我方」排，連線對戰的加入的人是第 1 方）
  kills: number; lost: number;                   // 擊毀敵方、我方損失（台）
  rubble: number; roofless: number;              // 轟塌（瓦礫）、打成空殼的建築
  fires: number[];                               // 雙方開火（發）：[我方、敵方]
  bounces?: number[];                            // R051：雙方被彈開的穿甲彈（發）；規則開著而且有發生才有
  built: number; builtStanding: number;          // 我方布陣蓋的、還站著的
  lastKill: { x: number; z: number; tick: number } | null;
}

const sameCol = (kind: number, k: number) => kind === k || (INTERNATIONAL_KINDS.includes(kind) && k === (INTERNATIONAL_GUNS.includes(kind) ? UK_HOWITZER : UK_TANK)) || (kind >= 12 && (k === UK_TANK ? kind <= 20 : k === UK_HOWITZER && kind >= 21 && kind <= 22)) || (k === UK_HOWITZER && (kind === UK_ATGUN || kind === UK_MORTAR)) || (k === UK_TANK && (kind === UK_LIGHT || kind === UK_HEAVY || kind === UK_ARMORED_CAR || kind === UK_DESTROYER || kind === UK_ASSAULT)) || (k === UK_INFANTRY && kind === UK_MG) || (k === UK_INFANTRY && (kind === UK_SNIPER || kind === UK_AT91)) || (k === UK_INFANTRY && (kind === UK_ENGINEER || kind === UK_FLAME)) || (k === UK_TANK && (kind === UK_TRUCK || kind === UK_HALFTRACK)) || (k === UK_HOWITZER && kind === UK_AA);   // R022 反戰車砲、迫擊砲算在「砲」那一欄；R023 輕、重坦克（R044 裝甲車、驅逐戰車、突擊砲）算在「坦克」
const count = (w: World, side: number, alive: boolean) => KINDS.map(k => w.units.filter(u => u.side === side && sameCol(u.kind, k) && (!alive || u.alive)).length);

// ecoStart（R081 第二次審查）：重播在第一步之後重建統計，這時候也要從這一步開始數陣亡
export function newStats(w: World, ecoStart = false): BattleStats {
  return { start: [count(w, SIDE_PLAYER, false), count(w, SIDE_ENEMY, false)], fires: [0, 0], lastKill: null, endTick: -1, ...(ecoStart && w.tick === 1 && w.eco ? { dead: [0, 0] } : {}) };
}

// 每一步之後呼叫（events＝這一步的模擬事件）
// ecoStart（R081）：打完第一步、世界有補給時，把開局重算一次（第 0 步補給送的步兵班、機槍組才算得進去），
// 並且從這一步起數雙方的陣亡（R081 複查：有補給的局會造新的，「開局減還活著的」會少算、甚至是負的）
export function statsStep(st: BattleStats, w: World, events: SimEvent[], ecoStart = false): void {
  if (ecoStart && w.tick === 1 && w.eco) st.start = [count(w, SIDE_PLAYER, false), count(w, SIDE_ENEMY, false)];
  if (ecoStart && w.tick === 1 && w.eco) st.dead = [0, 0];
  for (const e of events) {
    if (e.e === 'fire') { const u = w.units[e.unit - 1]; if (u && (u.side === SIDE_PLAYER || u.side === SIDE_ENEMY)) st.fires[u.side]++; }
    else if (e.e === 'kill') {
      const u = w.units[e.unit - 1];
      if (u) st.lastKill = { x: u.x, z: u.z, tick: w.tick - 1 };
      if (u && st.dead && (u.side === SIDE_PLAYER || u.side === SIDE_ENEMY) && KINDS.some(k => sameCol(u.kind, k))) st.dead[u.side]++;
    }
    else if (e.e === 'impact' && e.bounce && (e.side === SIDE_PLAYER || e.side === SIDE_ENEMY)) (st.bounces ??= [0, 0])[e.side]++;
  }
  if (w.winner >= 0 && st.endTick < 0) st.endTick = w.tick;
}

export function makeReport(w: World, st: BattleStats): Report {
  const left = [count(w, SIDE_PLAYER, true), count(w, SIDE_ENEMY, true)];
  const sum = (a: number[]) => a.reduce((p, x) => p + x, 0);
  const endTick = st.endTick >= 0 ? st.endTick : w.tick;
  return {
    ...(w.zombies ? { zombies: { wave: w.zombies.wave, killed: w.zombies.killed, lost: w.zombies.lost } } : {}),
    winner: w.winner === SIDE_ENEMY ? 1 : w.winner === SIDE_PLAYER ? 0 : w.winner, endTick, seconds: Math.floor(endTick / 20),
    start: st.start.map(a => a.slice()), left,
    kills: st.dead ? st.dead[SIDE_ENEMY] : sum(st.start[1]) - sum(left[1]), lost: st.dead ? st.dead[SIDE_PLAYER] : sum(st.start[0]) - sum(left[0]),   // R085：開局、剩下照「我方」排（[0]＝我方）；陣亡照陣營記
    rubble: w.blds.filter(b => b.hp <= 0).length, roofless: w.blds.filter(b => stageOf(b) === STAGE_ROOFLESS).length,
    fires: [st.fires[SIDE_PLAYER], st.fires[SIDE_ENEMY]], ...(st.bounces ? { bounces: [st.bounces[SIDE_PLAYER], st.bounces[SIDE_ENEMY]] } : {}),   // R085：統計照陣營記，戰報照「我方」排
    built: w.blds.filter(b => b.builtBy === SIDE_PLAYER).length, builtStanding: w.blds.filter(b => b.builtBy === SIDE_PLAYER && b.hp > 0).length,
    lastKill: st.lastKill ? { ...st.lastKill } : null,
  };
}

// 結局慢動作：勝負出現後 SLOWMO_MS 毫秒內模擬以 SLOWMO 倍速推進
export const SLOWMO = 0.25, SLOWMO_MS = 2500;
export const slowmoFactor = (msSinceEnd: number): number => (msSinceEnd >= 0 && msSinceEnd < SLOWMO_MS ? SLOWMO : 1);
