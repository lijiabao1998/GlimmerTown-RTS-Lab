// R1007 建造與科技（第二段）：工兵在戰場上堆沙包（建築種類 17，只住在 w.bags：不進 w.blds、不寫 occ，不擋路、不擋視線、不擋射線）。
// eco 帶 bag＝1（要跟 tech 一起）的局才有；沒有 bag 的局，這裡一行都不會走到。卡面：docs/tasks/R1007-沙包.md。只用整數、不抽亂數。
import { findPath } from './path.ts';
import { trenchAt } from './trenches.ts';
import { vegetationAt } from './vegetation.ts';
import { dist } from './math.ts';
import { near1002 } from './engineer1002.ts';   // engineer1002.ts 也 import 這一支；只在呼叫時用，循環沒有關係（同 R050）
import { builders50 } from './tech50.ts';
import { reloads } from './morale.ts';   // morale.ts 也 import 這一支（coverPct）；同上
import { UNIT_KINDS, BK_SANDBAG, TER_MUD, HALF, ORD_IDLE, ORD_FIRE_AT, cellIdx, inGrid, cellOf, center, wireAt, type World, type Building, type Unit } from './world.ts';

export type Bag1007 = Building & { left: number };
// 補給、工作量（工兵·步）、血、掩護（承傷百分比）、每方最多幾處（還站著的，含工地）、離工兵最多幾格（八方向）；數字是暫定，理由在卡面「數字與出處」
export const BAG1007 = { cost: 10, work: 200, hp: 120, cover: 50, max: 8, range: 7 };
export const RANGE1007 = 7;      // 工兵的視野（UNIT_KINDS[47].sight＝7 格）：看得到的地方才叫人去堆
export const BAGS_MAX1007 = 16;  // 清單上限：重用打散的那一筆推出來的（每方還站著的 ≤ 8）
// 樣子（畫面與模擬共用）：打散、工地、受損、完好
export const BAG_SCATTERED = 0, BAG_SITE = 1, BAG_DAMAGED = 2, BAG_INTACT = 3;
export const look1007 = (s: { hp: number; maxHp: number; left: number }): number => (s.hp <= 0 ? BAG_SCATTERED : s.left > 0 ? BAG_SITE : s.hp * 2 <= s.maxHp ? BAG_DAMAGED : BAG_INTACT);

// 那一格的那一筆（同一格最多一筆；打散的也算）
export function bagAt1007(w: World, x: number, z: number): Bag1007 | null {
  const list = w.bags?.segments;
  if (!list) return null;
  for (const s of list) if (s.x === x && s.z === z) return s;
  return null;
}
const standing1007 = (w: World, side: number): number => w.bags?.segments.filter(s => s.builtBy === side && s.hp > 0).length ?? 0;

// 能不能堆：'' 可以；不然回原因（介面與模擬共用）。沒給位置時只看「這一項現在按不按得下去」
export function why1007(w: World, side: number, kind: number, at?: { x: number; z: number; ids: readonly number[] }): string {
  if (w.eco?.bag !== 1 || w.zombies || w.sandbox || w.winner >= 0 || (side !== 0 && side !== 1)) return '本局未開放';
  if (kind !== BK_SANDBAG) return '不能蓋這種';
  if (standing1007(w, side) >= BAG1007.max) return `沙包已經 ${BAG1007.max} 處`;
  if (w.eco.supply[side] < BAG1007.cost) return `補給不足，還差 ${BAG1007.cost - w.eco.supply[side]}`;
  if (!at) return '';
  const eng = builders50(w, side, at.ids);
  if (!eng.length) return '先選工兵';
  const { x, z } = at;
  if (!Number.isInteger(x) || !Number.isInteger(z) || !inGrid(w, x, z)) return '超出地圖';
  if (!eng.some(u => Math.max(Math.abs(cellOf(u.x) - x), Math.abs(cellOf(u.z) - z)) <= RANGE1007)) return '離工兵太遠';
  const i = cellIdx(w, x, z);
  if (w.ter[i] === TER_MUD) return '不能堆在泥灘上';
  if (vegetationAt(w, x, z)) return '樹籬、樹林裡已經有掩護';
  if (w.occ[i] || wireAt(w, x, z) || trenchAt(w, x, z) || (bagAt1007(w, x, z)?.hp ?? 0) > 0) return '擋到了';
  return '';
}

// construct 指令 kind 17：取值跟 R050 那一行一樣（| 0、Array.isArray）。回傳 true＝是沙包、這裡處理了（放不下就什麼都不做）；其他種類回 false、什麼都不碰
export function construct1007(w: World, cmd: { side: number; ids: readonly number[]; kind: number; x: number; z: number }): boolean {
  const side = cmd.side | 0, kind = cmd.kind | 0, x = cmd.x | 0, z = cmd.z | 0, ids = Array.isArray(cmd.ids) ? cmd.ids : [];
  if (kind !== BK_SANDBAG) return false;
  if (why1007(w, side, kind, { x, z, ids }) !== '') return true;
  const list = (w.bags ??= { version: 1, segments: [] }).segments;
  let s = bagAt1007(w, x, z) ?? list.find(b => b.hp <= 0) ?? null;   // 這一格打散的那一筆 → 別處打散的（編號最小）→ 新的一筆
  if (!s) list.push(s = { id: list.length + 1, kind: BK_SANDBAG, x, z, w: 1, d: 1, floors: 1, hp: 1, maxHp: BAG1007.hp, builtBy: side, left: BAG1007.work });
  Object.assign(s, { kind: BK_SANDBAG, x, z, w: 1, d: 1, floors: 1, hp: 1, maxHp: BAG1007.hp, builtBy: side, left: BAG1007.work });
  w.eco!.supply[side] -= BAG1007.cost;
  w.events.push({ e: 'wire' });   // 借鐵絲網的事件：畫面只重建城鎮網格（卡面 3.8）
  for (const u of builders50(w, side, ids)) {
    u.order = ORD_FIRE_AT; u.tx = x; u.tz = z; u.target = 0;
    u.path = near1002(u, s) ? [] : findPath(w, cellOf(u.x), cellOf(u.z), x, z, 0, 0, u.kind); u.pathIdx = 0;
  }
  return true;
}

// 工兵拿著打自己沙包的指令（engineer1002.ts 的 demo1002 轉過來）：挨著、沒在走，每一步做 1（士氣規則開著時受壓、釘住照裝填變慢）；
// 血跟著長（長的是增量：中間被打掉的照扣）；做完出 wire 事件、回待命。已經蓋好（別的工兵剛蓋完）＝回待命
export function build1007(w: World, u: Unit, s: Bag1007): void {
  if (s.left <= 0) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }
  if (u.cooldown < (UNIT_KINDS[u.kind].demo ?? 0)) u.cooldown = UNIT_KINDS[u.kind].demo ?? 0;   // 審查：堆的時候炸藥倒數保持滿的——這一格換了主人（被炸、被打散後對方在同一格重堆），倒數從頭算，不會一放下就被炸
  if (u.pathIdx < u.path.length || !near1002(u, s)) return;
  if (w.rules?.morale && !reloads(w, u)) return;
  const need = BAG1007.work, done = need - s.left, before = look1007(s);
  s.hp = Math.min(s.maxHp, s.hp + Math.floor(((s.maxHp - 1) * (done + 1)) / need) - Math.floor(((s.maxHp - 1) * done) / need));
  s.left--;
  if (look1007(s) !== before) w.events.push({ e: 'wire' });
  if (s.left > 0) return;
  u.order = ORD_IDLE; u.path = []; u.pathIdx = 0;
}

// land() 的高爆：格中心離落點 ≤ R + HALF 的還站著的沙包扣 dmg（跟鐵絲網同一個判斷）；樣子變了才出 wire 事件
export function blast1007(w: World, ex: number, ez: number, R: number, dmg: number): void {
  for (const s of w.bags?.segments ?? []) {
    if (s.hp <= 0 || dist(center(s.x), center(s.z), ex, ez) > R + HALF) continue;
    const before = look1007(s);
    s.hp = Math.max(0, s.hp - dmg);
    if (look1007(s) !== before) w.events.push({ e: 'wire' });
  }
}

// 掩護：站在堆好、還站著的沙包那一格、沒有裝甲、不是卡車／半履帶車的單位，承傷取 min（原本, 50）。
// ground＝damageUnit 的 allowGroundCover（火焰、房子倒塌不打折）；coverPct 給 true
export function cover1007(w: World, u: Unit, x: number, z: number, ground: boolean, cover: number): number {
  if (!ground || !w.bags) return cover;
  const k = UNIT_KINDS[u.kind];
  if (k.armored || k.carry) return cover;
  const s = bagAt1007(w, x, z);
  return s && s.hp > 0 && s.left === 0 ? Math.min(cover, BAG1007.cover) : cover;
}

// 存檔：bag 只能沒有或 1、要跟 tech 一起；沒有 bag 就沒有 r.bags；每一筆的欄位、範圍、同一格最多一筆、每方還站著的 ≤ 8；
// blds 裡不能有 17 號（沙包只住在 w.bags；畫面查不到 17 號建築的顏色），有沒有 bag 都一樣
const BAG_INTS = ['id', 'kind', 'x', 'z', 'w', 'd', 'floors', 'hp', 'maxHp', 'builtBy', 'left'];
export function bag1007Ok(r: Record<string, unknown>): boolean {
  const e = r.eco as { bag?: unknown; tech?: unknown } | null | undefined, g = r.bags as { version?: unknown; segments?: unknown } | null | undefined, n = r.n as number;
  if ((r.blds as Record<string, unknown>[]).some(b => b.kind === BK_SANDBAG)) return false;
  if (e && e.bag !== undefined && e.bag !== 1) return false;
  if (e?.bag === 1 && e.tech !== 1) return false;
  if (e?.bag !== 1) return g === undefined;
  if (g === undefined) return true;
  if (typeof g !== 'object' || g === null || g.version !== 1 || !Array.isArray(g.segments) || g.segments.length > BAGS_MAX1007) return false;
  const seen = new Set<number>(), up = [0, 0];
  for (let i = 0; i < g.segments.length; i++) {
    const s = g.segments[i] as Record<string, number> | null;
    if (typeof s !== 'object' || s === null || !BAG_INTS.every(k => Number.isInteger(s[k]))) return false;
    if (s.id !== i + 1 || s.kind !== BK_SANDBAG || s.w !== 1 || s.d !== 1 || s.floors !== 1 || s.maxHp !== BAG1007.hp || s.hp < 0 || s.hp > BAG1007.hp || s.left < 0 || s.left > BAG1007.work) return false;
    if ((s.builtBy !== 0 && s.builtBy !== 1) || s.x < 0 || s.z < 0 || s.x >= n || s.z >= n) return false;
    const c = s.z * n + s.x;
    if (seen.has(c)) return false;
    seen.add(c);
    if (s.hp > 0 && ++up[s.builtBy] > BAG1007.max) return false;
  }
  return true;
}
