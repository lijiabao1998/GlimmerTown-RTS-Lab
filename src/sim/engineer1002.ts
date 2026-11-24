// R1002 步兵支援兵器（二）：工兵（47）、火焰噴射器（48）。eco 帶 sw＝2 才造得出來；沒有這兩種兵的局，這裡一行都不會走到。
// 卡面：docs/tasks/R1002-工兵與火焰噴射器.md。只用整數、不抽亂數。
import { dist } from './math.ts';
import { findPath } from './path.ts';
import { firstBlock, ridge, spotted } from './step.ts';   // step.ts 也 import 這一支；只在找目標時呼叫，不在載入時用，循環沒有關係（support91.ts 也這樣）
import { site50, own50, build50 } from './tech50.ts';   // R050：自己的工地＝蓋、自己蓋好的那三種＝不接
import { bagAt1007, build1007, type Bag1007 } from './sandbag1007.ts';   // R1007：自己的沙包工地＝堆、自己堆好的＝不接
import { target1009, fireAt1009, work1009 } from './mines1009.ts';   // R1009：射擊指令點到雷那一格（mines1009.ts 也 import 這一支；只在呼叫時用）
import { UNIT_KINDS, ORD_IDLE, ORD_FIRE_AT, SHELL_HE, cellOf, center, bldAt, wireAt, type Unit, type World, type Building } from './world.ts';

export const DEMO_BLD = 60;      // 一包炸藥打掉建築多少血：碉堡、指揮部也是整整這麼多（直射打碉堡只刮四分之一那條不套用）
export const DEMO_BLAST = 128;   // 炸開時的小爆炸事件半徑（只給畫面、聲音；不濺射、不挖坑、不傷人）
const T32 = 4294967296;          // 2^32（模擬裡不准用次方）
const CANDF: number[] = [];      // 模擬是單執行緒、找目標不會重入：重複用同一個陣列

// 射擊指令那一格的爆破目標：還站著的建築；不是建築就看還沒壞的鐵絲網；都沒有回傳 null
function demoTarget(w: World, x: number, z: number): { b: Building; wire: boolean; bag?: 1 } | null {
  const b = bldAt(w, x, z);
  if (b && b.hp > 0) return { b, wire: false };
  const r = wireAt(w, x, z);
  if (!(r && r.hp > 0) && w.bags) { const s = bagAt1007(w, x, z); if (s && s.hp > 0) return { b: s, wire: true, bag: 1 }; }   // R1007：還站著的沙包（wire: true——沙包的編號跟建築是兩套，R050 那幾行不能拿它去找工地；炸它走打網那一條）
  return r && r.hp > 0 ? { b: r, wire: true } : null;
}

// 挨著：工兵那一格跟佔地的八方向距離 ≤ 1
export function near1002(u: Unit, b: { x: number; z: number; w: number; d: number }): boolean {
  const ux = cellOf(u.x), uz = cellOf(u.z);
  const dx = Math.max(b.x - ux, 0, ux - (b.x + b.w - 1)), dz = Math.max(b.z - uz, 0, uz - (b.z + b.d - 1));
  return dx <= 1 && dz <= 1;
}

// moveUnit 問「射擊指令到了沒」：工兵是挨著目標（還站著的建築、還沒壞的網）
export function reach1002(w: World, u: Unit): boolean {
  const m9 = w.mines ? target1009(w, u) : null; if (m9) return near1002(u, { x: m9.x, z: m9.z, w: 1, d: 1 });   // R1009：雷那一格也是挨著就到
  const t = demoTarget(w, u.tx, u.tz);
  return !!t && near1002(u, t.b);
}

// applyCommand 的 fireAt 對工兵：那一格有還站著的建築或還沒壞的網才接（其他的照舊不改指令）；
// 路直接走向那一格（建築、網的格走不進去，findPath 本來就停在最近的可達格）。倒數從接到指令就保持在至少 demo 步：已經挨著的也要等放好才炸
export function fireAt1002(w: World, u: Unit, gx: number, gz: number): void {
  if (w.mines && fireAt1009(w, u, gx, gz)) return;   // R1009：自己還沒布好的＝接著布、這一方知道的敵方雷＝排
  const t = demoTarget(w, gx, gz);
  if (!t) return;
  if (!t.wire && own50(w, u.side, t.b)) return;   // R050：自己蓋好的兵營、車廠、補給站不炸
  if (t.bag && t.b.builtBy === u.side && (t.b as Bag1007).left === 0) return;   // R1007：自己堆好的沙包不接（不改指令、不撐倒數、不算路）
  u.order = ORD_FIRE_AT; u.tx = gx; u.tz = gz; u.target = 0; u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].demo ?? 0);
  u.path = near1002(u, t.b) ? [] : findPath(w, cellOf(u.x), cellOf(u.z), gx, gz, 0, 0, u.kind); u.pathIdx = 0;
}

// fireUnit 對拿著射擊指令的工兵：還沒挨著（或還在走）就把倒數保持在至少 demo 步；挨著、倒數到 0 就炸：
// 建築扣 DEMO_BLD（hurt＝step.ts 的 damageBld：分段、倒塌傷裡面的人照舊），網整段血歸零；出一個小爆炸事件；倒數重設。目標沒了就回待命
export function demo1002(w: World, u: Unit, hurt: (w: World, b: Building, dmg: number) => void): void {
  if (w.mines && work1009(w, u)) return;   // R1009：布雷、排雷
  const t = demoTarget(w, u.tx, u.tz), need = UNIT_KINDS[u.kind].demo ?? 0;
  if (!t) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }
  if (t.bag && t.b.builtBy === u.side) { build1007(w, u, t.b as Bag1007); return; }   // R1007：自己的沙包＝堆（不倒數、不炸）；堆好了＝回待命
  if (!t.wire && t.b.builtBy === u.side && site50(w, t.b)) { build50(w, u, t.b); return; }   // R050：自己的工地＝蓋（不倒數、不炸）
  if (!t.wire && own50(w, u.side, t.b)) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }   // R050：蓋好了（別的工兵剛蓋完）＝回待命
  if (u.pathIdx < u.path.length || !near1002(u, t.b)) { if (u.cooldown < need) u.cooldown = need; return; }
  const ax = center(u.tx) - u.x, az = center(u.tz) - u.z;
  if (ax || az) { u.aimX = ax; u.aimZ = az; }
  if (u.cooldown > 0) return;
  u.cooldown = need;
  if (t.wire) { t.b.hp = 0; w.events.push({ e: 'wire' }); }
  else hurt(w, t.b, DEMO_BLD);
  w.events.push({ e: 'impact', kind: SHELL_HE, x: center(u.tx), z: center(u.tz), bld: 0, r: DEMO_BLAST });
}

// 火焰燒得進去：射線上第一棟擋住的（blockCell），就是目標自己躲著的那一棟
export function burns1002(w: World, blockCell: number, t: Unit | null): boolean {
  const id = w.occ[blockCell];
  return !!t && id > 0 && bldAt(w, cellOf(t.x), cellOf(t.z))?.id === id;
}

// 火焰噴射器的射擊指令打一棟建築：那棟裡面射程內的敵人（活的、沒坐車），挑 id 最小的；沒有回傳 null（照舊打建築）
export function burnIn1002(w: World, u: Unit): Unit | null {
  const b = bldAt(w, u.tx, u.tz), k = UNIT_KINDS[u.kind];
  if (!b || b.hp <= 0) return null;
  for (const t of w.units) if (t.alive && !t.ride && t.side !== u.side && bldAt(w, cellOf(t.x), cellOf(t.z))?.id === b.id && dist(u.x, u.z, t.x, t.z) <= k.range) return t;
  return null;
}

// 火焰噴射器待命時自己找目標：照（距離、id）；不挑封閉車身的車；跟直射一樣檢查稜線、看不看得到；
// 射線上的建築：第一棟擋住的就是目標躲著的那一棟（還站著）時照樣挑
export function aimFlame(w: World, u: Unit): { x: number; z: number; unit: Unit | null; bld: null } | null {
  const k = UNIT_KINDS[u.kind], cand = CANDF; cand.length = 0;
  for (const t of w.units) {
    if (!t.alive || t.ride || t.side === u.side) continue;
    const tk = UNIT_KINDS[t.kind];
    if (tk.armored && !tk.openTop) continue;
    if (Math.abs(t.x - u.x) > k.range || Math.abs(t.z - u.z) > k.range) continue;   // R1006：方框外的一定超出射程（不開根號；剛好在射程上的照樣往下算）
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > k.range || d < k.minRange) continue;
    cand.push(d * T32 + t.id);
  }
  cand.sort((a, b) => a - b);
  for (const c of cand) {
    const t = w.units[(c % T32) - 1];
    if (ridge(w, u.x, u.z, t.x, t.z)) continue;
    const blk = firstBlock(w, u.x, u.z, t.x, t.z, 0);
    if (blk >= 0 && !burns1002(w, blk, t)) continue;
    if (!spotted(w, u.side, t.x, t.z)) continue;
    return { x: t.x, z: t.z, unit: t, bld: null };
  }
  return null;
}
