// R078 電腦第三版的生產：主力優先、支援按比例。ai 指令帶 v＝3 才用；戰術照第二版（ai2.ts），第一版的 aiThink 照舊先跑（它還負責記住看過敵方裝甲的時間）。
// 病根與量到的數字在 docs/tasks/R078-難度校正.md：第一版普通以上的生產是一串「每種支援各保持一個」排在坦克前面，死一個補一個，幾乎輪不到造坦克，
// 所以電腦互打時簡單（只造坦克）反而贏困難。整數、決定性、不抽 World.rng；只看自己的單位、自己的佇列與補給、自己看得到的敵人。
import { hqAlive } from './eco.ts';
import { dist } from './math.ts';
import { ARMOR_MEMORY, freeNear, type AiCmd } from './ai.ts';
import {
  UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT,
  UK_MG, SUB, cellOf, ORD_ATTACK, moraleState, MORALE_PINNED, type World, type Unit, type AiState,
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
  const count = (ok: (kind: number) => boolean) => mine.filter(u => ok(u.kind)).length + q.filter(ok).length;   // 活著的＋排在佇列裡的
  const has = (k: number) => count(x => x === k);
  let want: number;
  if (has(UK_OBSERVER) < 1) want = UK_OBSERVER;
  else if (lv < 2) {   // 簡單：跟第一版的簡單一樣——一班步兵、一門榴彈砲（有兩台車之後），其餘中坦克
    want = e.inf && has(UK_INFANTRY) < 1 ? UK_INFANTRY : has(UK_HOWITZER) < 1 && count(k => UNIT_KINDS[k].armored) >= 2 ? UK_HOWITZER : UK_TANK;
  } else {
    const guns = !!e.guns, a2 = !!e.armor2, top = lv >= 3 ? 2 : 1, core = count(isCore), sup = count(k => !isCore(k) && k !== UK_OBSERVER);
    const foeArmor = seen.some(u => UNIT_KINDS[u.kind].armored), sawArmor = a2 && st.armor !== undefined && w.tick - st.armor <= ARMOR_MEMORY;
    // 支援的清單（照順序、各有上限）：步兵、榴彈砲（普通 1、困難 2）→ 看得到敵方裝甲時的反戰車砲 → 迫擊砲 → 裝甲車 → 反戰車砲
    const support = e.inf && has(UK_INFANTRY) < top ? UK_INFANTRY : has(UK_HOWITZER) < top ? UK_HOWITZER : guns && foeArmor && has(UK_ATGUN) < 1 ? UK_ATGUN
      : guns && has(UK_MORTAR) < 1 ? UK_MORTAR : a2 && has(UK_ARMORED_CAR) < 1 ? UK_ARMORED_CAR : guns && has(UK_ATGUN) < 1 ? UK_ATGUN : -1;
    // 特種車（各保持一台）：主力夠了才出突擊砲、重坦克（困難）、輕坦克（普通）；看過敵方裝甲就出驅逐戰車
    const enough = core >= CORE_FIRST;
    const special = a2 && enough && has(UK_ASSAULT) < 1 ? UK_ASSAULT : sawArmor && has(UK_DESTROYER) < 1 ? UK_DESTROYER
      : e.tanks && enough && lv >= 3 && has(UK_HEAVY) < 1 ? UK_HEAVY : e.tanks && enough && lv === 2 && has(UK_LIGHT) < 1 ? UK_LIGHT : -1;
    // 支援數 × 比例 < 主力數才輪得到支援；否則出主力（陣亡的支援單位不會一直排在坦克前面補）
    want = support >= 0 && sup * SUPPORT_RATIO < core ? support : special >= 0 ? special : UK_TANK;
  }
  return e.supply[side] >= UNIT_KINDS[want].cost ? want : null;   // 補給不夠就等，跟第一版一樣
}

// ---- R080 機槍組（第三版才有；量到的數字在 docs/tasks/R080-機槍組.md）----
export const MG_FOLLOW = 3;   // 離主力重心超過幾格就跟上去（跟反戰車砲一樣）
export const MG_CHASE = 0;    // 直射的車為了打對方的機槍組，願意開出自己射程外幾格（0＝只打射程內的）

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
    const near = targets.filter(t => dist(g.x, g.z, t.x, t.z) <= range).sort((a, b) => pinned(a) - pinned(b) || dist(g.x, g.z, a.x, a.z) - dist(g.x, g.z, b.x, b.z) || a.id - b.id);
    if (near.length) { out.push([g, g.order === ORD_ATTACK && g.target === near[0].id ? null : { t: 'attack', side, ids: [g.id], target: near[0].id }]); continue; }
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
export function mgTargetFor(u: Unit, target: Unit | null, foeMg: Unit[]): Unit | undefined {
  const k = UNIT_KINDS[u.kind];
  if (target && (UNIT_KINDS[target.kind].armored || target.kind === UK_MG)) return undefined;
  const reach = k.range + (k.setup ? 0 : MG_CHASE * SUB);
  return foeMg.filter(e => dist(u.x, u.z, e.x, e.z) <= reach).sort((a, b) => dist(u.x, u.z, a.x, a.z) - dist(u.x, u.z, b.x, b.z) || a.id - b.id)[0];
}
