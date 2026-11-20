// R091 步兵支援兵器（一）：狙擊手（42）、反戰車小組（43）。eco 帶 sw＝1 才造得出來；沒有這兩種兵的局，這裡一行都不會走到。
// 卡面：docs/tasks/R091-狙擊手與反戰車小組.md。只用整數、不抽亂數。
import { apHit } from './ballistics.ts';
import { armorFace } from './armor.ts';
import { dist } from './math.ts';
import { firstBlock, ridge, spotted } from './step.ts';   // step.ts 也 import 這一支；只在找目標時呼叫，不在載入時用，循環沒有關係（ai3.ts 也這樣）
import { UNIT_KINDS, UK_OBSERVER, UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME, type UnitKind, type Unit, type World } from './world.ts';

const T32 = 4294967296, T45 = 35184372088832;   // 2^32、2^45（模擬裡不准用次方）
const CAND91: number[] = [];   // 模擬是單執行緒、找目標不會重入：重複用同一個陣列

// 狙擊手的類別：0 觀測員；1 機槍組、狙擊手、反戰車小組、沒有裝甲的砲組；2 步兵班、喪屍；3 開頂車。封閉車身的裝甲不挑（回傳 -1）
function sniperTier(t: Unit): number {
  const tk = UNIT_KINDS[t.kind];
  if (t.kind === UK_OBSERVER) return 0;
  if (tk.armored) return tk.openTop ? 3 : -1;
  if (tk.team91 || tk.sup || (!tk.men && tk.range > 0)) return 1;
  return 2;
}

// 反戰車小組的類別：只挑有裝甲的（開頂車也算）。擬真規則下打得穿的在前；再照面：後面 0、側面 1、正面 2
function atTier(w: World, u: Unit, t: Unit): number {
  const tk = UNIT_KINDS[t.kind];
  if (!tk.armored) return -1;
  const face = armorFace(t, u.x, u.z), rank = face === 2 ? 0 : face === 1 ? 1 : 2;   // armor.ts：0 正面、1 側面、2 後面
  const bounces = w.rules?.ap && apHit(u.kind, u.x, u.z, t) === 0 ? 1 : 0;
  return bounces * 3 + rank;
}

// 待命時自己找目標（攻擊指令、射擊指令在 pickAim 前面那兩段已經處理）。跟 pickAim 一樣四個檢查：射程、稜線、射線上的房子、看不看得到；
// 排序照（類別、距離、id）：類別 × 2^45 ＋ 距離 × 2^32 ＋ id，小於 2^53 還是精確的
export function aim91(w: World, u: Unit, home: number): { x: number; z: number; unit: Unit | null; bld: null } | null {
  const k = UNIT_KINDS[u.kind], cand = CAND91; cand.length = 0;
  for (const t of w.units) {
    if (!t.alive || t.ride || t.side === u.side) continue;
    if (Math.abs(t.x - u.x) > k.range || Math.abs(t.z - u.z) > k.range) continue;   // R1006：方框外的一定超出射程（不開根號）
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > k.range || d < k.minRange) continue;
    const tier = k.team91 === 1 ? sniperTier(t) : atTier(w, u, t);
    if (tier < 0) continue;
    cand.push(tier * T45 + d * T32 + t.id);
  }
  cand.sort((a, b) => a - b);
  for (const c of cand) {
    const t = w.units[(c % T32) - 1];
    if (ridge(w, u.x, u.z, t.x, t.z)) continue;
    if (firstBlock(w, u.x, u.z, t.x, t.z, home) >= 0) continue;
    if (!spotted(w, u.side, t.x, t.z)) continue;
    return { x: t.x, z: t.z, unit: t, bld: null };
  }
  return null;
}

// 一發打掉多少（land() 裡小彈那一條的傷害；別的兵種回傳原本的 dmgUnit）。狙擊手一發打倒一個人：
// 有人數的＝最大血量 ÷ 人數（進位）；觀測員整個；沒有裝甲的砲組＝最大血量 ÷ 4（進位）；其他（開頂車）照表
export function shotDmg91(k: UnitKind, t: Unit): number {
  if (k.team91 !== 1) return k.dmgUnit;
  const tk = UNIT_KINDS[t.kind];
  if (t.kind === UK_OBSERVER) return tk.hp;
  if (tk.men > 0) return Math.ceil(tk.hp / tk.men);
  if (!tk.armored && tk.range > 0) return Math.ceil(tk.hp / 4);
  return k.dmgUnit;
}

// 存檔：sw 只能沒有、1 或 2（R1002）；沒有 sw 卻有 42、43 號單位，或 sw 不是 2 卻有 47、48 號單位（或排在佇列裡）的不收
export function swOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { sw?: unknown; queue?: unknown } | undefined;
  if (e && e.sw !== undefined && e.sw !== 1 && e.sw !== 2) return false;
  if (e?.sw === 2) return true;
  const lvl = e?.sw === 1 ? 1 : 0, ours = (k: unknown) => (lvl < 1 && (k === UK_SNIPER || k === UK_AT91)) || k === UK_ENGINEER || k === UK_FLAME;   // R1002：sw＝1 收 42、43，不收 47、48
  if ((r.units as Record<string, unknown>[]).some(u => ours(u.kind))) return false;
  return !(e && Array.isArray(e.queue) && e.queue.some(q => Array.isArray(q) && q.some(ours)));
}
