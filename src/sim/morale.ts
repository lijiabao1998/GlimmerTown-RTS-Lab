// R052 士氣與壓制（擬真規則，rules 指令帶 morale＝1 才生效；預設關）。整數、決定性、不抽 World.rng。
// R075 士氣第二版（morale＝2）：潰退真的會發生。跟第一版差四處，都標著「第二版」；morale＝1 的局逐位照舊。
// 沒有裝甲的單位（步兵、觀測員、各種砲的砲組）被火力打到會累積壓制值（Unit.sup，0–100）：受壓 → 釘住 → 潰退。
// 數字的相對關係與出處在 docs/tasks/R052-士氣與壓制.md；下面標「暫定」的是遊戲設計，沒有出處。
import {
  SUB, cellOf, cellIdx, inGrid, blocks, bldAt, UNIT_KINDS, UK_ZOMBIE, BK_PILLBOX, ORD_IDLE, ORD_MOVE, SIDE_PLAYER, type World, type Unit,
  moraleState, MORALE_OK, MORALE_SHAKEN, MORALE_PINNED, MORALE_BROKEN,
} from './world.ts';
export { SUP_SHAKEN, SUP_PINNED, SUP_BROKEN, MORALE_OK, MORALE_SHAKEN, MORALE_PINNED, MORALE_BROKEN, moraleState } from './world.ts';   // 門檻與狀態定義在 world.ts（畫面與介面也要讀）
import { dist } from './math.ts';
import { vegetationAt } from './vegetation.ts';
import { trenchCover } from './trenches.ts';
import { findPath } from './path.ts';

export const SUP_MAX = 100;
export const SUP_SMALL = 25;     // 步槍齊射打在身上（暫定：空地上一個班第 2 輪讓對手受壓、第 3 輪釘住）
export const SUP_DIRECT = 30;    // 直射砲彈打在身上（暫定）
export const SUP_LOSS = 15;      // 附近友軍陣亡（暫定）
export const SUP_LOSS_RANGE = 3 * SUB;
export const SUP_HQ_RANGE = 6 * SUB;   // 離自己還在的指揮部這麼近：吃到的壓制 ×3/4（暫定）
export const SUP_DECAY_TICKS = 4;      // 每幾步 −1（100 → 0 要 20 秒；暫定）
export const ROUT_CELLS = 3;           // 潰退時往自己那一側退幾格（暫定）
export const ROUT_CHECK = 20;          // 每幾步看一次「潰退的人該不該再退一段」（暫定）
// 第二版（R075，暫定；調整前後量到的數字在 docs/tasks/R075-看得懂.md）
export const SUP_LOSS_2 = 30;               // 附近友軍陣亡：加得比第一版多一倍
export const SUP_LOSS_RANGE_2 = 4 * SUB;    // 而且看得比較遠
export const ROUT_CELLS_2 = 5;              // 一退退五格，看得出來是在跑
export const WOUNDED_PCT = 150;             // 血量不到一半的單位吃到的壓制 ×1.5（打殘的班更容易垮）
const second = (w: World): boolean => w.rules?.morale === 2;


export const suppressible = (u: Unit): boolean => !UNIT_KINDS[u.kind].armored && u.kind !== UK_ZOMBIE;
// 高爆彈在落點中心加多少壓制（照距離線性遞減到壓制半徑＝殺傷半徑的兩倍）
export const blastSup = (dmgUnit: number): number => 35 + (dmgUnit >> 1);

// 這個單位現在的掩體讓它吃到幾成傷害（跟 step.ts damageUnit 的算法同一套；tests/morale.mjs 拿實際扣的血驗兩邊一致）
export function coverPct(w: World, u: Unit): number {
  const x = cellOf(u.x), z = cellOf(u.z);
  const home = UNIT_KINDS[u.kind].garrison && blocks(w, x, z) ? bldAt(w, x, z) : null;
  const terrain = vegetationAt(w, x, z) ? 50 : inGrid(w, x, z) && w.crater[cellIdx(w, x, z)] > 0 ? 75 : 100;
  const ground = Math.min(terrain, trenchCover(w, x, z));
  return !home ? ground : Math.min(ground, home.kind === BK_PILLBOX ? 25 : 50);
}
// 掩體擋壓制的效果只有擋傷害的六成：人躲著不容易死，但照樣抬不起頭
export const supPct = (cover: number): number => 100 - Math.floor(((100 - cover) * 3) / 5);

function nearHq(w: World, u: Unit): boolean {
  const id = w.eco?.hq[u.side] ?? 0, b = id ? w.blds[id - 1] : null;
  return !!b && b.hp > 0 && dist(u.x, u.z, Math.floor((b.x * 2 + b.w) * SUB / 2), Math.floor((b.z * 2 + b.d) * SUB / 2)) <= SUP_HQ_RANGE;
}

function setSup(w: World, u: Unit, value: number): void {
  const before = moraleState(u), v = Math.max(0, Math.min(SUP_MAX, value));
  if (v > 0) u.sup = v; else delete u.sup;
  const after = moraleState(u);
  if (after !== before) w.events.push({ e: 'morale', unit: u.id, state: after });
  if (after === MORALE_BROKEN && before !== MORALE_BROKEN) startRout(w, u);
  if (u.rout && after < MORALE_PINNED) { delete u.rout; u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; }   // 回神：停下來，重新聽指揮
}

// 加壓制：amount 是還沒算掩體、指揮部之前的量
export function suppress(w: World, u: Unit, amount: number): void {
  if (!u.alive || amount <= 0 || !suppressible(u)) return;
  let a = Math.floor((amount * supPct(coverPct(w, u))) / 100);
  if (nearHq(w, u)) a = Math.floor((a * 3) / 4);
  if (second(w) && u.hp * 2 < UNIT_KINDS[u.kind].hp) a = Math.floor((a * WOUNDED_PCT) / 100);
  if (a > 0) setSup(w, u, (u.sup ?? 0) + a);
}

// 高爆彈落地：壓制半徑（殺傷半徑的兩倍）內每個單位照距離加
export function suppressBlast(w: World, x: number, z: number, splash: number, dmgUnit: number): void {
  const R = splash * 2, top = blastSup(dmgUnit);
  for (const u of w.units) {
    if (!u.alive) continue;
    const d = dist(u.x, u.z, x, z);
    if (d < R) suppress(w, u, Math.floor((top * (R - d)) / R));
  }
}

// R080 機槍組的掃射區：落點 area 內、開槍那一方的敵人（except＝被直接打中的那個，它已經加過了）各加 amount。掩體等折扣在 suppress 裡照算
export function suppressZone(w: World, side: number, x: number, z: number, area: number, amount: number, except: Unit | null): void {
  for (const o of w.units) if (o.alive && o.side !== side && o !== except && dist(o.x, o.z, x, z) <= area) suppress(w, o, amount);
}

// 直射打在一棟房子或碉堡上：裡面進駐的人也被壓（房子、碉堡的倍率在 coverPct 裡）
export function suppressHouse(w: World, bld: number, amount: number): void {
  if (!((w.blds[bld - 1]?.hp ?? 0) > 0)) return;   // 已經是瓦礫（砲彈還在飛的時候房子倒了）：沒有人在「裡面」
  for (const u of w.units) if (u.alive && UNIT_KINDS[u.kind].garrison && bldAt(w, cellOf(u.x), cellOf(u.z))?.id === bld) suppress(w, u, amount);
}

// 潰退：步兵、觀測員人在空地上（沒有任何掩體，彈坑也算掩體）才退；往自己那一側退 ROUT_CELLS 格，三個方向都找不到路就原地趴著。
// 第二版：只有碉堡與戰壕留得住；在房子裡的會棄屋往後跑，草叢與彈坑留不住。退 ROUT_CELLS_2 格。
// 剛潰退的那一刻看一次；之後每 ROUT_CHECK 步再看（掩體沒了、上一段退完了卻還是潰退 → 再退一段）
function startRout(w: World, u: Unit): void {
  const x = cellOf(u.x), z = cellOf(u.z), cells = second(w) ? ROUT_CELLS_2 : ROUT_CELLS;
  if (!UNIT_KINDS[u.kind].garrison || (second(w) ? bldAt(w, x, z)?.kind === BK_PILLBOX || trenchCover(w, x, z) < 100 : coverPct(w, u) < 100)) return;
  const s = u.side === SIDE_PLAYER ? cells : -cells, cl = (v: number) => Math.max(0, Math.min(w.n - 1, v));
  for (const [gx, gz] of [[cl(x + s), cl(z + s)], [cl(x + s), z], [x, cl(z + s)]]) {
    if ((gx === x && gz === z) || blocks(w, gx, gz)) continue;
    const path = findPath(w, x, z, gx, gz, 0, 0, u.kind);
    if (!path.length) continue;
    u.rout = 1; u.order = ORD_MOVE; u.tx = gx; u.tz = gz; u.target = 0; u.path = path; u.pathIdx = 0; delete u.fireAmmo;
    return;
  }
}

// 每一步最後呼叫一次：這一步有人陣亡 → 附近友軍加壓制；然後大家照時間退
export function moraleStep(w: World): void {
  for (const e of [...w.events]) {
    if (e.e !== 'kill') continue;
    const dead = w.units[e.unit - 1];
    if (!dead) continue;
    for (const u of w.units) if (u.alive && u.side === dead.side && dist(u.x, u.z, dead.x, dead.z) <= (second(w) ? SUP_LOSS_RANGE_2 : SUP_LOSS_RANGE)) suppress(w, u, second(w) ? SUP_LOSS_2 : SUP_LOSS);
  }
  for (const u of w.units) if (u.alive && u.sup && (w.tick + u.id) % SUP_DECAY_TICKS === 0) setSup(w, u, u.sup - 1);
  for (const u of w.units) if (u.alive && (w.tick + u.id) % ROUT_CHECK === 0 && moraleState(u) === MORALE_BROKEN && (!u.rout || u.pathIdx >= u.path.length)) startRout(w, u);
}

// 這一步裝填會不會往前走：受壓每 2 步走 1 步、釘住每 4 步走 1 步（潰退根本不開火，見 canFire）
export function reloads(w: World, u: Unit): boolean {
  const s = moraleState(u);
  return s === MORALE_OK || ((w.tick + u.id) & (s === MORALE_SHAKEN ? 1 : 3)) === 0;
}
export const canFire = (u: Unit): boolean => moraleState(u) !== MORALE_BROKEN;
// 移動：0＝這一步不動、50＝半速、100＝照常。潰退中的照常跑。
// 釘住的單位路徑還留著（壓制退了繼續走）；所以搬到一半被釘住的砲組（榴彈砲、迫擊砲、反戰車砲）趴在路上、砲沒架好，不開火
export function movePct(u: Unit): number {
  if (u.rout) return 100;
  const s = moraleState(u);
  return s >= MORALE_PINNED ? 0 : s === MORALE_SHAKEN ? 50 : 100;
}
