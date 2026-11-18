// R095 步兵排：新開的局 eco 指令帶 pla＝1 才有（舊紀錄、存檔、?noR095=1 都沒有這個旗標，逐位不變）。
// 一個排＝三個步兵班一起出、共用一個排號（u.pl＝第一班的 id）；人口上限提高；多選移動的隊形 25 格。整數、決定性、不抽 World.rng。
import { UNIT_KINDS, UK_INFANTRY, type World } from './world.ts';
import { MAP_LARGE } from './largeMap.ts';
import { MAP_TOWN } from './expandedMap.ts';

export const PLATOON_ITEM = 256;       // 生產佇列裡「步兵排」的記號（不是單位種類：UNIT_KINDS 只有 42 種）
export const PLATOON_COST = 66;        // 三個單班 75
export const PLATOON_TICKS = 300;      // 三個單班 360
export const PLATOON_SECTIONS = 3;
// 人口上限（有旗標時）：32 格的圖 24、64 圖 48、96 圖 64（沒有旗標：16／40／40）。64 圖原本要 56：手機上一半坦克時超過 80,000 個三角形，照卡面的退路減 8
export const popCap95 = (w: World): number => (w.map === MAP_TOWN ? 64 : w.map === MAP_LARGE ? 48 : 24);
// 讀佇列的地方都經過這幾個：記號換成單位種類（步兵）、要做幾步、要多少補給、佔幾格人口
export const queueKind = (k: number): number => (k === PLATOON_ITEM ? UK_INFANTRY : k);
export const ticksOf = (k: number): number => (k === PLATOON_ITEM ? PLATOON_TICKS : UNIT_KINDS[k].buildTicks);
export const costOf = (k: number): number => (k === PLATOON_ITEM ? PLATOON_COST : UNIT_KINDS[k].cost);
export const popOf = (k: number): number => (k === PLATOON_ITEM ? PLATOON_SECTIONS : 1);
export const queueKinds = (q: readonly number[]): number[] => q.map(queueKind);
// 佇列裡會出生的單位（排展開成三班）：數「有幾班、幾台」的地方用這個
export const queueUnits = (q: readonly number[]): number[] => q.flatMap(k => (k === PLATOON_ITEM ? [UK_INFANTRY, UK_INFANTRY, UK_INFANTRY] : [k]));

// 多選移動的隊形（有旗標時）：前 9 格跟 step.ts 的 FORMATION 一樣（偏向 +x、+z），再補滿 5×5
export const FORMATION_PLA: [number, number][] = [
  [0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [2, 0], [0, 2],
  [-1, 1], [1, -1], [2, 1], [1, 2], [2, -1], [-1, 2], [-2, 0], [0, -2], [2, 2], [-2, 1], [1, -2], [-2, -1], [-1, -2], [2, -2], [-2, 2], [-2, -2],
];

// 開局：有旗標就記下來、換人口上限（startEco 叫）
export function startPlatoons(w: World): void {
  if (!w.eco) return;
  w.eco.pla = 1;
  w.eco.pop = popCap95(w);
}

// 存檔讀回來的檢查（worldCodec 叫）：旗標只有 1；排號只在步兵班上、指向同一方更早或同一個步兵班；沒有旗標卻有排的記號＝壞的
export function platoonOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { pla?: unknown; queue?: unknown } | undefined;
  if (e && e.pla !== undefined && e.pla !== 1) return false;
  const pla = !!e && e.pla === 1, units = r.units as Record<string, unknown>[];
  if (!pla && e && Array.isArray(e.queue) && e.queue.some(q => Array.isArray(q) && q.includes(PLATOON_ITEM))) return false;
  for (const u of units) {
    if (u.pl === undefined) continue;
    const head = Number.isInteger(u.pl) ? units[(u.pl as number) - 1] : undefined;
    if (!pla || u.kind !== UK_INFANTRY || !head || (u.pl as number) > (u.id as number) || head.kind !== UK_INFANTRY || head.side !== u.side) return false;
  }
  return true;
}
