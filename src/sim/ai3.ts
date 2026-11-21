// R078 電腦第三版的生產：主力優先、支援按比例。ai 指令帶 v＝3 才用；戰術照第二版（ai2.ts），第一版的 aiThink 照舊先跑（它還負責記住看過敵方裝甲的時間）。
// 病根與量到的數字在 docs/tasks/R078-難度校正.md：第一版普通以上的生產是一串「每種支援各保持一個」排在坦克前面，死一個補一個，幾乎輪不到造坦克，
// 所以電腦互打時簡單（只造坦克）反而贏困難。整數、決定性、不抽 World.rng；只看自己的單位、自己的佇列與補給、自己看得到的敵人。
import { PLATOON_ITEM, costOf, queueUnits } from './platoon.ts';
import { hqAlive } from './eco.ts';
import { dist } from './math.ts';
import { ARMOR_MEMORY, freeNear, type AiCmd } from './ai.ts';
import { first1005, support1005 } from './ai1005.ts';   // R1005（ai1005.ts 也 import 這一支；只在想的時候呼叫，循環沒有關係）
import { firstBlock, ridge } from './step.ts';   // R081（step.ts 也 import 這一支；只在想的時候呼叫，不在載入時用，循環沒有關係）
import {
  UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT,
  UK_MG, SUB, cellOf, center, inGrid, blocks, bldAt, wireBlocks, mgSecond, ORD_ATTACK, moraleState, MORALE_PINNED, type World, type Unit, type AiState,
} from './world.ts';

export const SUPPORT_RATIO = 2;   // 普通以上：每幾台主力才配一個支援單位（暫定；試過 3，差不多）
export const CORE_FIRST = 4;      // 主力滿幾台才開始出突擊砲、重坦克、輕坦克（暫定）
export const QUEUE_MAX = 2;       // 佇列裡最多排幾個（跟第一版一樣）

// 主力：有裝甲、不是裝甲車（裝甲車是偵察用的，算支援）。支援：其餘不是觀測員的（步兵、各種砲、裝甲車）
export const isCore = (kind: number): boolean => UNIT_KINDS[kind].armored && kind !== UK_ARMORED_CAR;

// 這一次要造什麼（兵種編號）；不造＝null。mine＝自己活著的單位，seen＝這一方現在看得到的敵人
export function produce3(w: World, st: AiState, mine: Unit[], seen: Unit[]): number | null {
  const e = w.eco, side = st.side, lv = st.level;
  if (!e || !hqAlive(w, side)) return null;
  const q = e.queue[side];
  if (q.length >= QUEUE_MAX) return null;
  if (st.four) { const k = first1005(w, st, mine, seen); if (k !== undefined) return k; }   // R1005 第四版：要先蓋兵營的工兵、看過飛機之後的防空砲
  const count = (ok: (kind: number) => boolean) => mine.filter(u => ok(u.kind)).length + queueUnits(q).filter(ok).length;   // 活著的＋排在佇列裡的（R095：排展開成三班）
  const has = (k: number) => count(x => x === k);
  let want: number;
  if (has(UK_OBSERVER) < 1) want = UK_OBSERVER;
  else if (lv < 2) {   // 簡單：跟第一版的簡單一樣——一班步兵、一門榴彈砲（有兩台車之後），其餘中坦克
    want = e.inf && has(UK_INFANTRY) < 1 ? UK_INFANTRY : has(UK_HOWITZER) < 1 && count(k => UNIT_KINDS[k].armored) >= 2 ? UK_HOWITZER : UK_TANK;
  } else {
    const guns = !!e.guns, a2 = !!e.armor2, top = lv >= 3 ? 2 : 1, core = count(isCore), sup = count(k => !isCore(k) && k !== UK_OBSERVER), plaHard = !!e.pla && lv >= 3 && w.n >= 64;   // R095：有排的局，困難的步兵在大地圖（64、96）改走「排」那一條；小地圖一局兩分鐘、出排只會輸（卡面的退路），照舊出單班
    const foeArmor = seen.some(u => UNIT_KINDS[u.kind].armored), sawArmor = a2 && st.armor !== undefined && w.tick - st.armor <= ARMOR_MEMORY;
    // 支援的清單（照順序、各有上限）：步兵、榴彈砲（普通 1、困難 2）→ 看得到敵方裝甲時的反戰車砲 → 迫擊砲 → 裝甲車 → 反戰車砲
    const support = e.inf && !plaHard && has(UK_INFANTRY) < top ? UK_INFANTRY : has(UK_HOWITZER) < top ? UK_HOWITZER : guns && foeArmor && has(UK_ATGUN) < 1 ? UK_ATGUN
      : guns && has(UK_MORTAR) < 1 ? UK_MORTAR : a2 && has(UK_ARMORED_CAR) < 1 ? UK_ARMORED_CAR : guns && has(UK_ATGUN) < 1 ? UK_ATGUN : st.four ? support1005(w, st, mine, seen) : -1;   // R1005：第三版的支援都滿了，再看新的四種兵
    // 特種車（各保持一台）：主力夠了才出突擊砲、重坦克（困難）、輕坦克（普通）；看過敵方裝甲就出驅逐戰車
    const enough = core >= CORE_FIRST;
    const special = a2 && enough && has(UK_ASSAULT) < 1 ? UK_ASSAULT : sawArmor && has(UK_DESTROYER) < 1 ? UK_DESTROYER
      : e.tanks && enough && lv >= 3 && has(UK_HEAVY) < 1 ? UK_HEAVY : e.tanks && enough && lv === 2 && has(UK_LIGHT) < 1 ? UK_LIGHT : -1;
    // 支援數 × 比例 < 主力數才輪得到支援；否則出主力（陣亡的支援單位不會一直排在坦克前面補）
    want = support >= 0 && sup * SUPPORT_RATIO < core ? support : special >= 0 ? special : UK_TANK;
    if (plaHard && e.inf && core >= CORE_FIRST && has(UK_INFANTRY) * 2 < core && has(UK_INFANTRY) < 6) want = PLATOON_ITEM;   // R095：主力夠了、班數×2 < 主力、班數不到 6 就出一個排（只在大地圖）
  }
  if (want === PLATOON_ITEM) return e.supply[side] >= costOf(want) ? want : null;   // R095：排的記號不是單位種類
  return e.supply[side] >= UNIT_KINDS[want].cost ? want : null;   // 補給不夠就等，跟第一版一樣
}

// ---- R080 機槍組（第三版才有；量到的數字在 docs/tasks/R080-機槍組.md）----
export const MG_FOLLOW = 3;   // 離主力重心超過幾格就跟上去（跟反戰車砲一樣）
export const MG_CHASE = 0;    // 直射的車為了打對方的機槍組，願意開出自己射程外幾格（0＝只打射程內的）
export const MG_SHIFT = 3;    // R081：射程內的目標都被擋住時，往自己幾格內找一個打得到的位置
export const MG_WALK = 2 * MG_SHIFT;   // R081 複查：換位置最多走幾步（隔著鐵絲網、房子要繞遠路的格子不算）

// R081：從 (x, z) 打不打得到 t——中間沒有房子、沒有稜線；或 t 就進駐在射線上的第一棟房子裡、而且有士氣規則
// （打那棟房子就是在壓它；經典規則下點射打房子只扣房子 1 點、碉堡 0 點，屋裡的人不受影響，所以不算——R081 複查）
export function canHit(w: World, x: number, z: number, t: Unit): boolean {
  if (ridge(w, x, z, t.x, t.z)) return false;
  const c = firstBlock(w, x, z, t.x, t.z, 0);
  if (c < 0) return true;
  const home = UNIT_KINDS[t.kind].garrison ? bldAt(w, cellOf(t.x), cellOf(t.z)) : null;
  return !!w.rules?.morale && !!home && home.hp > 0 && w.occ[c] === home.id;
}
// R081：直射的車打 t 的射線清不清楚（沒有房子、沒有稜線；機槍組不會進駐，所以不用管它在屋裡）
const clearShot = (w: World, u: Unit, t: Unit): boolean => !ridge(w, u.x, u.z, t.x, t.z) && firstBlock(w, u.x, u.z, t.x, t.z, 0) < 0;
// R081：射程內有沒有打得到的軟目標（第二版才看；集結波次時有的話留下來打）
export function mgBusy(w: World, g: Unit, seen: Unit[]): boolean {
  if (!mgSecond(w)) return false;
  const range = UNIT_KINDS[UK_MG].range;
  return seen.some(t => soft(t) && dist(g.x, g.z, t.x, t.z) <= range && canHit(w, g.x, g.z, t));
}
// R081 複查：從 (gx, gz) 往外走 MG_WALK 步以內，每一格最少要幾步（-1＝走不到）。規則跟 findPath 一樣：八方向、不切過擋路格的角，
// 房子與機槍組過不去的鐵絲網擋路。只看 (2·MG_WALK+1)² 格的方塊，不配置整張地圖。
const STEP_X = [1, -1, 0, 0, 1, 1, -1, -1], STEP_Z = [0, 0, 1, -1, 1, -1, 1, -1];
function walkSteps(w: World, gx: number, gz: number): Int8Array {
  const R = MG_WALK, S = 2 * R + 1, steps = new Int8Array(S * S).fill(-1);
  const at = (x: number, z: number) => (z - gz + R) * S + (x - gx + R);
  const free = (x: number, z: number) => Math.abs(x - gx) <= R && Math.abs(z - gz) <= R && inGrid(w, x, z) && !blocks(w, x, z) && !wireBlocks(w, x, z, UK_MG);
  let ring: [number, number][] = [[gx, gz]];
  steps[at(gx, gz)] = 0;
  for (let s = 1; s <= R && ring.length; s++) {
    const next: [number, number][] = [];
    for (const [x, z] of ring) for (let k = 0; k < 8; k++) {
      const nx = x + STEP_X[k], nz = z + STEP_Z[k];
      if (!free(nx, nz) || steps[at(nx, nz)] >= 0 || (k >= 4 && (!free(nx, z) || !free(x, nz)))) continue;
      steps[at(nx, nz)] = s; next.push([nx, nz]);
    }
    ring = next;
  }
  return steps;
}
// R081：t 在射程內卻被擋住——在機槍組 MG_SHIFT 格內找一格走得到（MG_WALK 步內）、從那裡打得到 t 的位置
// （走的步數最少的；平手比直線距離，再平手照 z 再照 x）
function shiftSpot(w: World, g: Unit, t: Unit): [number, number] | null {
  const gx = cellOf(g.x), gz = cellOf(g.z), range = UNIT_KINDS[UK_MG].range, steps = walkSteps(w, gx, gz), S = 2 * MG_WALK + 1;
  let best: [number, number] | null = null, bs = 0, bd = 0;
  for (let dz = -MG_SHIFT; dz <= MG_SHIFT; dz++) for (let dx = -MG_SHIFT; dx <= MG_SHIFT; dx++) {
    const x = gx + dx, z = gz + dz, s = steps[(dz + MG_WALK) * S + dx + MG_WALK];
    if ((!dx && !dz) || s < 0) continue;   // 走不到（出了地圖、房子、鐵絲網，或要繞超過 MG_WALK 步）
    const cx = center(x), cz = center(z);
    if (dist(cx, cz, t.x, t.z) > range || !canHit(w, cx, cz, t)) continue;
    const d = dist(g.x, g.z, cx, cz);
    if (!best || s < bs || (s === bs && d < bd)) { best = [x, z]; bs = s; bd = d; }
  }
  return best;
}

// 軟目標：機槍打得動的（沒有裝甲，或開頂的車）
const soft = (u: Unit): boolean => !UNIT_KINDS[u.kind].armored || !!UNIT_KINDS[u.kind].openTop;

// 自己的機槍組這一次該做什麼：[單位, 指令]，指令是 null＝這一次不下指令。taken(id)＝前面的段落已經替它決定了（在基地等波次）。
// 射程內有看得到的軟目標：打；先打還沒被釘住的（已經趴下的先放著，壓住的人越多越好），再比遠近。只打射程內的，不追。
// 沒有目標：跟著主力（坦克組）的重心，離超過 MG_FOLLOW 格才動（要停著才能打，不能一直走）。場上沒有自己的機槍組時回傳空的。
export function machineGuns3(w: World, st: AiState, mine: Unit[], seen: Unit[], taken: (id: number) => boolean): [Unit, AiCmd | null][] {
  const out: [Unit, AiCmd | null][] = [], side = st.side, guns = mine.filter(u => u.kind === UK_MG);
  if (!guns.length) return out;
  const targets = seen.filter(soft), range = UNIT_KINDS[UK_MG].range;
  const core = mine.filter(u => isCore(u.kind)), ref = core.length ? core : mine.filter(u => u.kind !== UK_MG && u.kind !== UK_OBSERVER);
  const pinned = (t: Unit) => (w.rules?.morale && moraleState(t) >= MORALE_PINNED ? 1 : 0);
  for (const g of guns) {
    if (taken(g.id)) continue;
    const second = mgSecond(w), inRange = targets.filter(t => dist(g.x, g.z, t.x, t.z) <= range);
    const near = inRange.filter(t => !second || canHit(w, g.x, g.z, t)).sort((a, b) => pinned(a) - pinned(b) || dist(g.x, g.z, a.x, a.z) - dist(g.x, g.z, b.x, b.z) || a.id - b.id);
    if (near.length) { out.push([g, g.order === ORD_ATTACK && g.target === near[0].id ? null : { t: 'attack', side, ids: [g.id], target: near[0].id }]); continue; }
    if (second && inRange.length && g.pathIdx >= g.path.length) {   // R081：射程內的都被擋住：換到打得到的位置（找不到就照下面跟主力）
      // R081 第二次審查：經典規則下進駐在房子裡的從哪裡都打不到（canHit），不拿它當換位置的目標
      const reachable = inRange.filter(e => !!w.rules?.morale || !(UNIT_KINDS[e.kind].garrison && blocks(w, cellOf(e.x), cellOf(e.z))));
      const t = reachable.sort((a, b) => dist(g.x, g.z, a.x, a.z) - dist(g.x, g.z, b.x, b.z) || a.id - b.id)[0], spot = t ? shiftSpot(w, g, t) : null;
      if (spot) { out.push([g, { t: 'move', side, ids: [g.id], x: spot[0], z: spot[1] }]); continue; }
    }
    const chasing = g.order === ORD_ATTACK;   // 手上的目標跑出射程（或看不到）了：不追，回去跟主力
    if ((!chasing && g.pathIdx < g.path.length) || !ref.length) continue;
    const cx = Math.trunc(ref.reduce((s, u) => s + u.x, 0) / ref.length), cz = Math.trunc(ref.reduce((s, u) => s + u.z, 0) / ref.length);
    if (!chasing && dist(g.x, g.z, cx, cz) <= MG_FOLLOW * SUB) continue;
    const at = freeNear(w, cellOf(cx), cellOf(cz));
    if (at) out.push([g, { t: 'move', side, ids: [g.id], x: at[0], z: at[1] }]);
  }
  return out;
}

// 對付對方的機槍組：這台直射的車（kind 的射程 range、要不要架起來 setup）手上的目標是 target，看得到的對方機槍組是 foeMg——該改打哪一組（不改＝undefined）。
// 正在打裝甲的不改（坦克先顧坦克）；已經在打機槍組的不改；只挑射程內（加上 MG_CHASE）的，取最近的。
// w（R081）：給了而且是機槍組第二版，只挑自己射線清楚的
export function mgTargetFor(u: Unit, target: Unit | null, foeMg: Unit[], w?: World): Unit | undefined {
  const k = UNIT_KINDS[u.kind];
  if (target && (UNIT_KINDS[target.kind].armored || target.kind === UK_MG)) return undefined;
  const reach = k.range + (k.setup ? 0 : MG_CHASE * SUB);
  return foeMg.filter(e => dist(u.x, u.z, e.x, e.z) <= reach && !(w && mgSecond(w) && !clearShot(w, u, e))).sort((a, b) => dist(u.x, u.z, a.x, a.z) - dist(u.x, u.z, b.x, b.z) || a.id - b.id)[0];
}
