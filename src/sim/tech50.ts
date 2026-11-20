// R050 建造與科技（第一段）：工兵在戰場上蓋兵營（14）、車廠（15）、補給站（16）。eco 帶 tech＝1 才有；沒有 tech 的局，這裡一行都不會走到。
// 兵營、車廠蓋好才造得出那幾種兵（科技）；補給站多給補給。卡面：docs/tasks/R050-建造與科技.md。只用整數、不抽亂數。
import { findPath } from './path.ts';
import { trenchAt } from './trenches.ts';
import { clearVegetation } from './vegetation.ts';
import { near1002 } from './engineer1002.ts';   // engineer1002.ts 也 import 這一支；只在呼叫時用，循環沒有關係
import {
  UNIT_KINDS, BK_BARRACKS, BK_DEPOT, BK_SUPPLY, UK_SNIPER, UK_AT91, UK_FLAME, UK_TRUCK, UK_HALFTRACK, UK_AA, TER_ROAD, ORD_IDLE, ORD_FIRE_AT,
  cellIdx, inGrid, cellOf, wireAt, bldMaxHp, stageOf, type World, type Building, type Unit,
} from './world.ts';

export interface Tech50 { cost: number; work: number; max: number }
// 補給、工作量（工兵·步）、每方最多幾座（還站著的加工地）；數字都是暫定，理由在卡面「數字」
export const TECH50: Record<number, Tech50> = {
  [BK_BARRACKS]: { cost: 40, work: 400, max: 1 },
  [BK_DEPOT]: { cost: 50, work: 500, max: 1 },
  [BK_SUPPLY]: { cost: 40, work: 300, max: 2 },
};
export const TECH_KINDS = [BK_BARRACKS, BK_DEPOT, BK_SUPPLY];
export const RANGE50 = 8;          // 工地離這一方的指揮部（佔地）八方向最多幾格
export const SUPPLY_TICKS50 = 40;  // 補給站每幾步多給 1
export const SUPPLY_MAX50 = 2;     // 最多算幾座補給站
// 要先蓋什麼才造得出來（tech 開著時）；其他兵種不受影響
export const LOCK50: Record<number, number> = { [UK_SNIPER]: BK_BARRACKS, [UK_AT91]: BK_BARRACKS, [UK_FLAME]: BK_BARRACKS, [UK_TRUCK]: BK_DEPOT, [UK_HALFTRACK]: BK_DEPOT, [UK_AA]: BK_DEPOT };

const hqOf = (w: World, side: number): Building | null => { const id = w.eco?.hq[side] ?? 0, b = id ? w.blds[id - 1] : null; return b && b.hp > 0 ? b : null; };
// 這一棟是不是還在蓋的工地（回傳那一筆）
export const site50 = (w: World, b: Building): { id: number; left: number } | null => w.tech?.sites.find(s => s.id === b.id) ?? null;
// 這一方蓋好、還站著的那一種有幾座（工地不算）
export const done50 = (w: World, side: number, kind: number): number => w.blds.filter(b => b.kind === kind && b.builtBy === side && b.hp > 0 && !site50(w, b)).length;
// 自己蓋好的那三種之一（工兵點了不炸）
export const own50 = (w: World, side: number, b: Building): boolean => !!w.eco?.tech && TECH50[b.kind] !== undefined && b.builtBy === side && !site50(w, b);
// tech 開著時這一方造不造得出這一種（true＝被鎖）
export const locked50 = (w: World, side: number, kind: number): boolean => !!w.eco?.tech && LOCK50[kind] !== undefined && done50(w, side, LOCK50[kind]) === 0;
// 補給站這一輪多給幾點
export const income50 = (w: World, side: number): number => Math.min(SUPPLY_MAX50, done50(w, side, BK_SUPPLY));
// ids 裡能蓋的工兵：這一方、活著、沒坐車、沒在潰退
export const builders50 = (w: World, side: number, ids: readonly number[]): Unit[] => ids.map(id => (Number.isInteger(id) && id >= 1 && id <= w.units.length ? w.units[id - 1] : null)).filter((u): u is Unit => !!u && u.alive && u.side === side && !u.ride && !u.rout && !!UNIT_KINDS[u.kind].demo).filter((u, i, a) => a.indexOf(u) === i);

// 能不能蓋：'' 可以；不然回原因（介面與模擬共用）。沒給位置時只看「這一種現在蓋不蓋得起」
export function why50(w: World, side: number, kind: number, at?: { x: number; z: number; ids: readonly number[] }): string {
  if (!w.eco?.tech || w.zombies || w.sandbox || w.winner >= 0 || (side !== 0 && side !== 1)) return '本局未開放';
  const hq = hqOf(w, side), spec = TECH50[kind];
  if (!hq) return '指揮部已毀';
  if (!spec) return '不能蓋這種';
  if (w.blds.filter(b => b.kind === kind && b.builtBy === side && b.hp > 0).length >= spec.max) return '已經有了';
  if (w.eco.supply[side] < spec.cost) return `補給不足，還差 ${spec.cost - w.eco.supply[side]}`;
  if (!at) return '';
  if (!builders50(w, side, at.ids).length) return '先選工兵';
  const { x, z } = at;
  if (!Number.isInteger(x) || !Number.isInteger(z) || !inGrid(w, x, z) || !inGrid(w, x + 1, z + 1)) return '超出地圖';
  const gap = Math.max(Math.max(hq.x - (x + 1), 0, x - (hq.x + hq.w - 1)), Math.max(hq.z - (z + 1), 0, z - (hq.z + hq.d - 1)));
  if (gap > RANGE50) return '離指揮部太遠';
  for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
    const cx = x + dx, cz = z + dz, inner = dx >= 0 && dz >= 0 && dx < 2 && dz < 2;
    if (!inGrid(w, cx, cz)) continue;
    const i = cellIdx(w, cx, cz);
    if (inner && (w.occ[i] || wireAt(w, cx, cz) || trenchAt(w, cx, cz) || w.ter[i] === TER_ROAD || w.units.some(u => u.alive && !u.ride && !u.towBy && cellOf(u.x) === cx && cellOf(u.z) === cz))) return '擋到了';
    if (!inner && (w.occ[i] || wireAt(w, cx, cz))) return '要跟建築隔一格';
  }
  // 不另外檢查會不會把路堵死：外面一圈都是空的，原本穿過這 2×2 的路都能沿著這一圈繞過去（卡面施工紀錄 1）
  return '';
}

// construct 指令：放得下才接——扣補給、放一棟血 1 的工地、記下工作量、叫工兵過去蓋
export function construct50(w: World, side: number, kind: number, x: number, z: number, ids: readonly number[]): void {
  if (why50(w, side, kind, { x, z, ids }) !== '') return;
  const spec = TECH50[kind], id = w.blds.length + 1, maxHp = bldMaxHp(kind, 2, 2, 1);
  const b: Building = { id, kind, x, z, w: 2, d: 2, floors: 1, hp: 1, maxHp, builtBy: side };
  w.blds.push(b);
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = id;
  clearVegetation(w, x, z, 2, 2);
  w.eco!.supply[side] -= spec.cost;
  (w.tech ??= { version: 1, sites: [] }).sites.push({ id, left: spec.work });
  w.events.push({ e: 'build', bld: id });
  for (const u of builders50(w, side, ids)) {
    u.order = ORD_FIRE_AT; u.tx = x; u.tz = z; u.target = 0;
    u.path = near1002(u, b) ? [] : findPath(w, cellOf(u.x), cellOf(u.z), x, z, 0, 0, u.kind); u.pathIdx = 0;
  }
}

// 工兵拿著打自己工地的指令（engineer1002.ts 的 demo1002 轉過來）：挨著、沒在走，每一步做 1；血跟著長（長的是增量：中間被打掉的照扣）；做完拿掉工地、回待命
export function build50(w: World, u: Unit, b: Building): void {
  const s = site50(w, b);
  if (!s || u.pathIdx < u.path.length || !near1002(u, b)) return;
  const need = TECH50[b.kind].work, done = need - s.left, before = stageOf(b);
  b.hp = Math.min(b.maxHp, b.hp + Math.floor(((b.maxHp - 1) * (done + 1)) / need) - Math.floor(((b.maxHp - 1) * done) / need));
  s.left--;
  const after = stageOf(b);
  if (after !== before) w.events.push({ e: 'stage', bld: b.id, stage: after });
  if (s.left > 0) return;
  w.tech!.sites = w.tech!.sites.filter(x => x !== s);
  u.order = ORD_IDLE; u.path = []; u.pathIdx = 0;
}

// 每一步（ecoStep 開頭）：打成瓦礫的工地拿掉（補給不退）
export function tech50Step(w: World): void {
  if (w.tech?.sites.some(s => w.blds[s.id - 1].hp <= 0)) w.tech.sites = w.tech.sites.filter(s => w.blds[s.id - 1].hp > 0);
}

// 存檔：tech 只能沒有或 1；沒有 tech 就沒有 w.tech、沒有 14–16 號建築；工地要指到那三種建築、剩餘工作量在 1 到上限之間
export function techOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { tech?: unknown } | undefined, t = r.tech as { version?: unknown; sites?: unknown } | undefined, blds = r.blds as Record<string, unknown>[];
  if (e && e.tech !== undefined && e.tech !== 1) return false;
  if (e?.tech !== 1) return t === undefined && !blds.some(b => TECH50[b.kind as number] !== undefined);
  if (t === undefined) return true;
  if (typeof t !== 'object' || t === null || t.version !== 1 || !Array.isArray(t.sites)) return false;
  return (t.sites as unknown[]).every(s => {
    const o = s as { id?: unknown; left?: unknown } | null, id = o?.id, left = o?.left;
    if (!Number.isInteger(id) || !Number.isInteger(left) || (id as number) < 1 || (id as number) > blds.length) return false;
    const spec = TECH50[blds[(id as number) - 1].kind as number];
    return !!spec && (left as number) >= 1 && (left as number) <= spec.work;
  });
}
