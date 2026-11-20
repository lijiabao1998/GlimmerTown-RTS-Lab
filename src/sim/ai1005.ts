// R1005 電腦第四版：步兵支援兵器（狙擊手 42、反戰車小組 43、工兵 47、火焰噴射器 48）與建造（兵營、補給站、車廠）。
// ai 指令帶 v＝4 才有（setAi 存成 v: 3, four: 1）：第三版的生產與戰術一行都不改，這裡只多下新的四種兵與工地的指令。卡面：docs/tasks/R1005-電腦用步兵支援與建造.md
// 整數、決定性、不抽 World.rng。敵人只用這一方現在看得到的（seen）；建築、鐵絲網本來就在地圖上看得到；對方的飛機在天上，雙方都看得到。
import { dist } from './math.ts';
import { hqAlive } from './eco.ts';
import { queueUnits } from './platoon.ts';
import { freeNear, ARMOR_MEMORY, type AiCmd } from './ai.ts';
import { isCore, SUPPORT_RATIO } from './ai3.ts';   // ai3.ts 也 import 這一支（生產）；只在想的時候呼叫，循環沒有關係
import { TECH50, RANGE50, why50, locked50, site50 } from './tech50.ts';
import { trenchAt } from './trenches.ts';
import {
  UNIT_KINDS, UK_OBSERVER, UK_ENGINEER, UK_FLAME, UK_SNIPER, UK_AT91, UK_AA, BK_BARRACKS, BK_DEPOT, BK_SUPPLY, BK_PILLBOX, BK_HQ,
  SUB, center, cellOf, bldAt, ORD_FIRE_AT, ORD_ATTACK, ORD_MOVE, SIDE_PLAYER, type World, type Unit, type AiState, type Building,
} from './world.ts';

export const ENG_KEEP = [0, 0, 1, 1];   // 難度 1／2／3：工兵保持幾組（簡單不造新的四種兵；蓋東西的那一組另外算）
export const AT_KEEP = [0, 0, 1, 1];    // 看得到或看過敵方裝甲時，反戰車小組保持幾組（試過困難 2：一直死一直補，狙擊手、火焰噴射器 120 局只輪到 6 組）
export const AA_KEEP = [0, 0, 1, 2];    // 看過對方的飛機、有車廠之後，防空砲保持幾門
export const BUILD_CORE = [0, 0, 3, 3];  // 主力（活的＋排著的）滿幾台才開始蓋（R078：支援把主力餓死是困難輸給簡單的病根，先有主力）
export const NEAR_CORE = 9;             // 爆破、燒的目標離主力重心最多幾格（有人掩護才去；中坦克的射程。第一輪用 6 格，120 局只炸了 1 次）
export const ENG_REACH = 14;            // 爆破目標離工兵最多幾格
export const FLAME_REACH = 8;           // 火焰噴射器找目標：離它自己幾格內
export const AT_REACH = 5;              // 反戰車小組追打幾格內的裝甲
export const FOLLOW = 3;                // 離主力重心超過幾格才跟上去（同 R080 機槍組）
export const BUILD_N = 64;              // 地圖至少這麼大才蓋（萊伊 32×32 一局五分鐘：存錢蓋房子、造工兵把主力拖慢，量到第四版只贏 35%；R095 的排也只在大地圖出）
export const SITE_NEAR = 4;             // 工地先找指揮部幾格內（找不到才放寬到 RANGE50）
const NEW4 = [UK_ENGINEER, UK_FLAME, UK_SNIPER, UK_AT91];

// 這一種在這一局造不造得出來（跟 eco.ts produce 的門一樣；被兵營、車廠鎖住的也算造不出來）
function allowed(w: World, side: number, k: number): boolean {
  const e = w.eco;
  if (!e || w.zombies || locked50(w, side, k)) return false;
  if (k === UK_SNIPER || k === UK_AT91) return !!e.sw;
  if (k === UK_ENGINEER || k === UK_FLAME) return e.sw === 2;
  if (k === UK_AA) return !!e.air;
  return false;
}
// 活著的＋排在佇列裡的（R095：排展開成三班）
const counter = (w: World, side: number, mine: Unit[]) => { const q = queueUnits(w.eco!.queue[side]); return (k: number) => mine.filter(u => u.kind === k).length + q.filter(x => x === k).length; };
// 這一方還站著（含工地）的那一種有幾座
const have = (w: World, side: number, kind: number) => w.blds.filter(b => b.kind === kind && b.builtBy === side && b.hp > 0).length;

// ---- 生產 ----
// produce3 開頭問一次（第三版自己的支援清單之前）：要蓋東西時先造一組工兵、工兵在了就先存錢蓋；看過飛機之後的防空砲。undefined＝照第三版；null＝先存錢
export function first1005(w: World, st: AiState, mine: Unit[], seen: Unit[] = []): number | null | undefined {
  const e = w.eco, side = st.side, lv = st.level;
  if (!e || lv < 2) return undefined;
  const has = counter(w, side, mine), build = plan1005(w, st, mine);
  if (build >= 0) {
    if (has(UK_ENGINEER) < 1) return allowed(w, side, UK_ENGINEER) ? (e.supply[side] >= UNIT_KINDS[UK_ENGINEER].cost ? UK_ENGINEER : null) : undefined;
    if (mine.some(u => u.kind === UK_ENGINEER) && e.supply[side] < TECH50[build].cost) return null;   // 工兵在場上了：先存到蓋得起（蓋的那一下在 act1005）
  }
  if (st.air !== undefined && allowed(w, side, UK_AA) && has(UK_AA) < AA_KEEP[lv]) return e.supply[side] >= UNIT_KINDS[UK_AA].cost ? UK_AA : null;
  // 看得到敵人躲在主力附近的房子、碉堡裡（火焰噴射器用得上的時候），場上沒有火焰噴射器就先造一組（排在比例前面：比例輪到時常常被別的支援佔走）
  if (allowed(w, side, UK_FLAME) && has(UK_FLAME) < 1 && hidden1005(w, mine, seen)) return e.supply[side] >= UNIT_KINDS[UK_FLAME].cost ? UK_FLAME : null;
  // 輪到支援（第三版同一條比例：支援數 × 2 < 主力數）時，新的四種兵排在第三版的支援清單前面（排在後面時一局一組都輪不到：第一輪量的 120 局裡 0 組）
  const q = queueUnits(e.queue[side]), core = mine.filter(u => isCore(u.kind)).length + q.filter(isCore).length;
  const sup = mine.filter(u => !isCore(u.kind) && u.kind !== UK_OBSERVER).length + q.filter(k => !isCore(k) && k !== UK_OBSERVER).length;
  if (sup * SUPPORT_RATIO < core) { const k = support1005(w, st, mine, seen); if (k >= 0) return e.supply[side] >= UNIT_KINDS[k].cost ? k : null; }
  return undefined;
}
// 看得到的敵人裡，有沒有躲在還站著的建築裡、離自己主力重心 NEAR_CORE 格內的
function hidden1005(w: World, mine: Unit[], seen: Unit[]): boolean {
  const core = mine.filter(u => isCore(u.kind));
  if (!core.length) return false;
  const gx = Math.trunc(core.reduce((s, u) => s + u.x, 0) / core.length), gz = Math.trunc(core.reduce((s, u) => s + u.z, 0) / core.length);
  return seen.some(t => (bldAt(w, cellOf(t.x), cellOf(t.z))?.hp ?? 0) > 0 && dist(t.x, t.z, gx, gz) <= NEAR_CORE * SUB);
}
// 第三版的支援清單都滿了才問：照順序挑第一個還不夠的（-1＝沒有）
export function support1005(w: World, st: AiState, mine: Unit[], seen: Unit[]): number {
  const side = st.side, lv = st.level, has = counter(w, side, mine);
  const armor = seen.some(u => UNIT_KINDS[u.kind].armored) || (st.armor !== undefined && w.tick - st.armor <= ARMOR_MEMORY);
  if (armor && allowed(w, side, UK_AT91) && has(UK_AT91) < AT_KEEP[lv]) return UK_AT91;
  if (allowed(w, side, UK_SNIPER) && has(UK_SNIPER) < 1) return UK_SNIPER;
  if (allowed(w, side, UK_FLAME) && has(UK_FLAME) < 1) return UK_FLAME;
  if (allowed(w, side, UK_ENGINEER) && has(UK_ENGINEER) < ENG_KEEP[lv]) return UK_ENGINEER;
  return -1;
}

// ---- 蓋 ----
// 這一次想要蓋哪一種（-1＝不蓋）：一次只蓋一棟；看過飛機先蓋車廠，其次兵營（主力 ≥ 2）→ 補給站（主力 ≥ 4）→ 困難的第二座補給站（主力 ≥ 6）
export function plan1005(w: World, st: AiState, mine: Unit[]): number {
  const e = w.eco, side = st.side;
  if (!e?.tech || w.n < BUILD_N || !hqAlive(w, side) || w.tech?.sites.some(s => w.blds[s.id - 1].builtBy === side)) return -1;   // 小地圖不蓋（BUILD_N）
  const core = mine.filter(u => isCore(u.kind)).length + queueUnits(e.queue[side]).filter(isCore).length;
  if (core < BUILD_CORE[st.level]) return -1;
  if (st.air !== undefined && have(w, side, BK_DEPOT) < 1) return BK_DEPOT;
  if (have(w, side, BK_BARRACKS) < 1) return BK_BARRACKS;
  if (have(w, side, BK_SUPPLY) < 1) return core >= 4 ? BK_SUPPLY : -1;
  if (st.level >= 3 && have(w, side, BK_SUPPLY) < 2) return core >= 6 ? BK_SUPPLY : -1;
  return -1;
}
// 放在哪：指揮部周圍 SITE_NEAR 格內 why50 說可以的 2×2，挑離對方出生角落最遠的（躲在指揮部後面；平手照 z、再照 x）；都沒有才放寬到 RANGE50
export function spot1005(w: World, side: number, kind: number, ids: number[]): [number, number] | null {
  const hq = hqAlive(w, side);
  if (!hq) return null;
  const fc = center(side === SIDE_PLAYER ? 5 : w.n - 6);   // 對方的出生角落（setAi 的 corner）
  for (const lim of [SITE_NEAR, RANGE50]) {
    let best: [number, number] | null = null, bd = -1;
    for (let z = hq.z - lim - 1; z <= hq.z + hq.d + lim; z++) for (let x = hq.x - lim - 1; x <= hq.x + hq.w + lim; x++) {
      const gap = Math.max(Math.max(hq.x - (x + 1), 0, x - (hq.x + hq.w - 1)), Math.max(hq.z - (z + 1), 0, z - (hq.z + hq.d - 1)));
      if (gap > lim || why50(w, side, kind, { x, z, ids }) !== '') continue;
      const d = dist(center(x) + (SUB >> 1), center(z) + (SUB >> 1), fc, fc);
      if (d > bd) { best = [x, z]; bd = d; }   // 照 z、再照 x 掃：同距離留先找到的
    }
    if (best) return best;
  }
  return null;
}

// ---- 戰術：新的四種兵（ai2.ts 合起來之前呼叫；只碰新的四種兵，前面的段落已經替它決定的不改）----
export function act1005(w: World, st: AiState, mine: Unit[], seen: Unit[], override: Map<number, AiCmd | null>): void {
  const side = st.side, foe = 1 - side, e = w.eco;
  if (w.sky?.planes.some(p => p.side !== side)) st.air = w.tick;   // 看過對方的飛機（之後蓋車廠、造防空砲）
  const free = mine.filter(u => NEW4.includes(u.kind) && !u.ride && !override.has(u.id));
  if (!free.length) return;
  const core = mine.filter(u => isCore(u.kind)), ref = core.length ? core : mine.filter(u => !NEW4.includes(u.kind) && u.kind !== UK_OBSERVER);
  const gx = ref.length ? Math.trunc(ref.reduce((s, u) => s + u.x, 0) / ref.length) : -1, gz = ref.length ? Math.trunc(ref.reduce((s, u) => s + u.z, 0) / ref.length) : -1;
  const hq = e ? hqAlive(w, side) : null, homeX = hq ? center(hq.x) : gx, homeZ = hq ? center(hq.z) : gz;
  const moveTo = (u: Unit, x: number, z: number) => { if (!(u.order === ORD_MOVE && u.pathIdx < u.path.length && Math.abs(u.tx - x) <= 1 && Math.abs(u.tz - z) <= 1) && !(cellOf(u.x) === x && cellOf(u.z) === z)) override.set(u.id, { t: 'move', side, ids: [u.id], x, z }); };
  const fireAt = (u: Unit, x: number, z: number) => { if (!(u.order === ORD_FIRE_AT && u.tx === x && u.tz === z)) override.set(u.id, { t: 'fireAt', side, ids: [u.id], x, z }); };
  const attack = (u: Unit, t: Unit) => { if (!(u.order === ORD_ATTACK && u.target === t.id)) override.set(u.id, { t: 'attack', side, ids: [u.id], target: t.id }); };
  // 跟著主力：離重心超過 FOLLOW 格才走，停在重心往自己指揮部那一側 2 格（沒在走的時候才下）
  const follow = (u: Unit) => {
    if (gx < 0 || u.pathIdx < u.path.length || dist(u.x, u.z, gx, gz) <= FOLLOW * SUB) return;
    const d = Math.max(1, dist(gx, gz, homeX, homeZ)), step = Math.min(d, 2 * SUB);
    const at = freeNear(w, cellOf(gx + Math.trunc(((homeX - gx) * step) / d)), cellOf(gz + Math.trunc(((homeZ - gz) * step) / d)));
    if (at) moveTo(u, at[0], at[1]);
  };
  const nearCore = (x: number, z: number, cells: number) => gx >= 0 && dist(x, z, gx, gz) <= cells * SUB;
  const bcx = (b: Building) => center(b.x) + ((b.w - 1) * SUB >> 1), bcz = (b: Building) => center(b.z) + ((b.d - 1) * SUB >> 1);

  // 工兵：先蓋（自己的工地沒人蓋就派最近的閒著的；要蓋新的就放工地），再爆破，最後跟著主力
  const engs = free.filter(u => u.kind === UK_ENGINEER);
  const busy = (u: Unit) => u.order === ORD_FIRE_AT && (bldAt(w, u.tx, u.tz)?.hp ?? 0) > 0;
  const idle = engs.filter(u => !busy(u) && !u.rout);
  const mySites = (w.tech?.sites ?? []).map(s => w.blds[s.id - 1]).filter(b => b.builtBy === side && b.hp > 0);
  for (const b of mySites) {
    if (engs.some(u => busy(u) && bldAt(w, u.tx, u.tz) === b) || !idle.length) continue;
    idle.sort((p, q) => dist(p.x, p.z, bcx(b), bcz(b)) - dist(q.x, q.z, bcx(b), bcz(b)) || p.id - q.id);
    fireAt(idle.shift()!, b.x, b.z);
  }
  const want = e && idle.length ? plan1005(w, st, mine) : -1;
  if (want >= 0 && e!.supply[side] >= TECH50[want].cost) {
    const u = idle[0], at = spot1005(w, side, want, [u.id]);
    if (at) { override.set(u.id, { t: 'construct', side, ids: [u.id], kind: want, x: at[0], z: at[1] }); idle.shift(); }
  }
  // 爆破目標：看得到有敵人躲著的房子、對方蓋的碉堡與三種建築與指揮部、對方的鐵絲網；離主力重心 NEAR_CORE 格內
  const targets = new Map<number, Building>(), wires: Building[] = [];
  for (const t of seen) { const b = bldAt(w, cellOf(t.x), cellOf(t.z)); if (b && b.hp > 0) targets.set(b.id, b); }
  for (const b of w.blds) if (b.hp > 0 && b.builtBy === foe && (b.kind === BK_PILLBOX || b.kind === BK_HQ || TECH50[b.kind] !== undefined)) targets.set(b.id, b);
  for (const s of w.wires?.segments ?? []) if (s.hp > 0 && s.builtBy === foe) wires.push(s);
  const pool = [...targets.values(), ...wires].filter(b => nearCore(bcx(b), bcz(b), NEAR_CORE));
  // 帶 tech 的局：id 最小的那一組工兵留在指揮部旁邊等著蓋（還有要蓋的時候；不跟主力上前線）
  if (e?.tech && hq && idle.length && (want >= 0 || plan1005(w, st, mine) >= 0)) {
    const u = idle.sort((p, q) => p.id - q.id).shift()!;
    if (dist(u.x, u.z, homeX, homeZ) > FOLLOW * SUB && u.pathIdx >= u.path.length) { const at = freeNear(w, cellOf(homeX), cellOf(homeZ)); if (at) moveTo(u, at[0], at[1]); }
  }
  for (const u of idle) {
    const t = pool.filter(b => dist(u.x, u.z, bcx(b), bcz(b)) <= ENG_REACH * SUB).sort((p, q) => dist(u.x, u.z, bcx(p), bcz(p)) - dist(u.x, u.z, bcx(q), bcz(q)) || p.x - q.x || p.z - q.z)[0];
    if (t) fireAt(u, t.x, t.z); else follow(u);
  }

  // 火焰噴射器：看得到的敵人（不挑封閉車身的車），躲在房子、碉堡、壕溝裡的優先；在房子裡的對那一棟下射擊指令（燒裡面的人），其他下攻擊指令
  for (const f of free.filter(u => u.kind === UK_FLAME)) {
    if (f.order === ORD_ATTACK && w.units[f.target - 1]?.alive) continue;
    const covered = (t: Unit) => ((bldAt(w, cellOf(t.x), cellOf(t.z))?.hp ?? 0) > 0 || !!trenchAt(w, cellOf(t.x), cellOf(t.z)) ? 0 : 1);
    const cand = seen.filter(t => { const k = UNIT_KINDS[t.kind]; return !(k.armored && !k.openTop) && dist(f.x, f.z, t.x, t.z) <= FLAME_REACH * SUB && nearCore(t.x, t.z, NEAR_CORE + 2); })
      .sort((a, b) => covered(a) - covered(b) || dist(f.x, f.z, a.x, a.z) - dist(f.x, f.z, b.x, b.z) || a.id - b.id);
    const t = cand[0];
    if (!t) { if (f.order === ORD_FIRE_AT) override.set(f.id, { t: 'stop', side, ids: [f.id] }); else follow(f); continue; }   // 燒完了（或看不到裡面有人了）就停，不拿火去燒空房子
    const home = bldAt(w, cellOf(t.x), cellOf(t.z));
    if (home && home.hp > 0) fireAt(f, home.x, home.z); else attack(f, t);
  }

  // 狙擊手：進離主力重心 6 格內最近的、還站著、不是對方蓋的房子；待命時自己找目標（R091 的 aim91）
  for (const s of free.filter(u => u.kind === UK_SNIPER)) {
    if ((bldAt(w, cellOf(s.x), cellOf(s.z))?.hp ?? 0) > 0 || s.pathIdx < s.path.length || gx < 0) continue;
    let pick: Building | null = null, pd = 0;
    for (const b of w.blds) {
      if (b.hp <= 0 || b.builtBy === foe || b.kind === BK_HQ || site50(w, b) || !nearCore(bcx(b), bcz(b), 6)) continue;
      const d = dist(s.x, s.z, bcx(b), bcz(b));
      if (!pick || d < pd) { pick = b; pd = d; }
    }
    if (pick) moveTo(s, pick.x, pick.z); else follow(s);
  }

  // 反戰車小組：看得到的敵方裝甲離它 AT_REACH 格內 → 攻擊最近的；不然跟著主力
  for (const a of free.filter(u => u.kind === UK_AT91)) {
    if (a.order === ORD_ATTACK && w.units[a.target - 1]?.alive) continue;
    const t = seen.filter(e2 => UNIT_KINDS[e2.kind].armored && dist(a.x, a.z, e2.x, e2.z) <= AT_REACH * SUB).sort((p, q) => dist(a.x, a.z, p.x, p.z) - dist(a.x, a.z, q.x, q.z) || p.id - q.id)[0];
    if (t) attack(a, t); else follow(a);
  }
}
