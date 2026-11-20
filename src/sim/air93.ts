// R093 空中支援與防空：俯衝轟炸（kind 1）、偵察機（kind 2）、防空砲（兵種 46）。eco 帶 air＝1 才有；沒有 air 的局，這裡一行都不會走到。
// 飛機不是單位：放在 w.sky（第一次叫才建）。炸彈不存成砲彈：投彈那一步把一顆臨時的高爆彈直接交給 step.ts 的 land()。
// 防空不擲骰：每發扣固定的血。只用整數、不抽亂數、模組層級沒有跨步的狀態。卡面：docs/tasks/R093-空中支援與防空.md
import { dist } from './math.ts';
import { UNIT_KINDS, SUB, center, cellOf, blocks, gridLimit, SHELL_HE, type World, type Shell, type Plane93, type UnitKind } from './world.ts';
import { reloads, canFire } from './morale.ts';
import { hqAlive } from './eco.ts';
import { smokeBlocks } from './smoke.ts';
import { vegetationAt, VEG_WOOD } from './vegetation.ts';

export const STRIKE93 = 1, RECON93 = 2;
// 照種類編號查：[0, 轟炸, 偵察]（數字與出處在卡面「數字」；都是暫定）
export const DELAY93 = [0, 160, 80];     // 叫了之後幾步才進地圖
export const SPEED93 = [0, 160, 128];    // 每步飛幾個位置單位
export const HOLD93 = [0, 30, 200];      // 在目標上空幾步（俯衝／盤旋）
export const HP93 = [0, 100, 60];
export const COST93 = [0, 60, 20];
export const COOL93 = [0, 1200, 600];
export const MIN_T93 = 20;               // 飛到目標最少幾步
export const RECON_R93 = 6 * SUB;        // 偵察看得到的半徑
export const MISS93 = 2 * SUB;           // 打到剩 0 血時落點最多偏多遠
export const SMOKE_MISS93 = 384;         // 落彈時目標在煙裡，至少偏這麼多
export const AA_DMG93 = 15;              // 防空每發扣多少（期望值，不擲骰）
// 炸彈：跟 UnitKind 同形狀，不放進 UNIT_KINDS（land() 讀射手的兵種；炸彈沒有射手）
export const BOMB93: UnitKind = { name: '炸彈', hp: 1, speed: 0, range: 0, minRange: 0, reload: 0, indirect: true, dmgUnit: 100, dmgBld: 160, splash: 2 * SUB, sight: 0, armor: 100, radius: 0, cost: 0, buildTicks: 0, garrison: false, armored: false, pierce: 100, men: 0, soft: 100, setup: false };

export interface AirCmd { t: 'air'; side: number; kind: number; x: number; z: number }
type Spot = (w: World, side: number, x: number, z: number) => boolean;
const slotOf = (side: number, kind: number): number => side * 2 + kind - 1;   // ready：我方轟炸、我方偵察、敵方轟炸、敵方偵察
const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);
// 進場點：自己那一角的格子中心（第 0 方 n−1、第 1 方 0，跟 eco.ts 的角落一樣；用格子中心，鏡像才剛好對得上）
const entry = (w: World, side: number): number => center(side === 0 ? w.n - 1 : 0);

// 空中指令（step.ts 的 applyCommand）：門全部成立才接，任一條不成立世界一個位元都不變
export function call93(w: World, side: number, kind: number, x: number, z: number, see: Spot): void {
  const e = w.eco;
  if (!e?.air || w.zombies || w.winner >= 0) return;
  if ((side !== 0 && side !== 1) || (kind !== STRIKE93 && kind !== RECON93) || !hqAlive(w, side)) return;
  const gx = Math.max(0, Math.min(w.n - 1, x)), gz = Math.max(0, Math.min(w.n - 1, z)), slot = slotOf(side, kind);
  if (w.sky && (w.sky.ready[slot] > w.tick || w.sky.planes.some(p => p.side === side && p.kind === kind))) return;   // 冷卻中；這一方這一種已經有一架
  if (e.supply[side] < COST93[kind]) return;
  const tx = center(gx), tz = center(gz);
  if (kind === STRIKE93 && !see(w, side, tx, tz)) return;   // 不准炸霧裡的格；偵察哪一格都能叫
  if (!w.sky) w.sky = { version: 1, next: 1, ready: [0, 0, 0, 0], planes: [] };
  const sky = w.sky, sx = entry(w, side), sz = sx, v = SPEED93[kind];
  e.supply[side] -= COST93[kind];
  sky.ready[slot] = w.tick + COOL93[kind];
  sky.planes.push({ id: sky.next++, side, kind, x: sx, z: sz, sx, sz, tx, tz, t: -DELAY93[kind], T: Math.max(MIN_T93, ceilDiv(dist(sx, sz, tx, tz), v)), hp: HP93[kind] });
}

// 照 t 算位置：還沒進地圖停在進場點；飛去；在目標上空；原路飛回
export function place93(p: Plane93): void {
  const H = HOLD93[p.kind];
  if (p.t < 0) { p.x = p.sx; p.z = p.sz; }
  else if (p.t <= p.T) { p.x = p.sx + Math.trunc(((p.tx - p.sx) * p.t) / p.T); p.z = p.sz + Math.trunc(((p.tz - p.sz) * p.t) / p.T); }
  else if (p.t <= p.T + H) { p.x = p.tx; p.z = p.tz; }
  else { const k = p.t - p.T - H; p.x = p.tx + Math.trunc(((p.sx - p.tx) * k) / p.T); p.z = p.tz + Math.trunc(((p.sz - p.tz) * k) / p.T); }
}

// 每一步、updateShells 之後（step.ts）：飛、防空、投彈、拿掉。順序固定（會進雜湊）
export function air93Step(w: World, land: (w: World, s: Shell) => void): void {
  const sky = w.sky!;
  for (const p of sky.planes) { p.t++; place93(p); }
  for (const u of w.units) {   // 防空：照 id
    const k = UNIT_KINDS[u.kind], a = k.aa;
    if (!a || !u.alive || u.towBy) continue;
    if (u.cooldown > 0 && (!w.rules?.morale || reloads(w, u))) u.cooldown--;   // 照 step.ts 的 fireUnit：受壓每 2 步、釘住每 4 步才裝填一步
    if (w.rules?.morale && !canFire(u)) continue;   // 潰退不打
    if (u.pathIdx < u.path.length) continue;        // 在走不打（要架好）
    let best: Plane93 | null = null, bd = 0;
    for (const p of sky.planes) {
      if (p.side === u.side || p.t < 0 || p.hp <= 0) continue;
      const dx = p.x - u.x, dz = p.z - u.z, d2 = dx * dx + dz * dz;
      if (d2 > a * a) continue;
      if (!best || d2 < bd || (d2 === bd && p.id < best.id)) { best = p; bd = d2; }
    }
    if (!best) continue;
    const ax = best.x - u.x, az = best.z - u.z;
    if (ax || az) { u.aimX = ax; u.aimZ = az; }
    if (u.cooldown > 0) continue;
    u.cooldown = k.reload; best.hp -= AA_DMG93;
    w.events.push({ e: 'fire', unit: u.id, x: u.x, z: u.z });
    if (best.hp <= 0) { const s = slotOf(best.side, best.kind); sky.ready[s] = Math.max(sky.ready[s], w.tick + COOL93[best.kind]); }   // 打下來：冷卻從這一步重算
  }
  for (const p of sky.planes) {   // 投彈：在目標上空的最後一步，炸彈同一步落地
    if (p.kind !== STRIKE93 || p.hp <= 0 || p.t !== p.T + HOLD93[STRIKE93]) continue;
    let miss = Math.trunc((MISS93 * (HP93[STRIKE93] - p.hp)) / HP93[STRIKE93]);
    if (smokeBlocks(w, p.tx, p.tz, p.tx, p.tz)) miss = Math.max(miss, SMOKE_MISS93);
    const d = dist(p.sx, p.sz, p.tx, p.tz), lim = gridLimit(w);
    const ex = d ? Math.max(0, Math.min(lim, p.tx + Math.trunc(((p.tx - p.sx) * miss) / d))) : p.tx;   // 往進場方向的前面偏（提早拉起、投長了）
    const ez = d ? Math.max(0, Math.min(lim, p.tz + Math.trunc(((p.tz - p.sz) * miss) / d))) : p.tz;
    land(w, { id: 0, side: p.side, kind: SHELL_HE, shooter: 0, sx: p.tx, sz: p.tz, ex, ez, t: 0, T: 0, target: 0, hitBld: 0 });
  }
  sky.planes = sky.planes.filter(p => p.hp > 0 && p.t < 2 * p.T + HOLD93[p.kind]);
}

// 偵察（step.ts 的 spotted 開頭）：自己那一方、正在盤旋的偵察機，半徑 6 格內；看不進還站著的建築、小樹林、煙裡（不然直射可以借偵察機打穿煙幕）
export function seen93(w: World, side: number, x: number, z: number): boolean {
  for (const p of w.sky!.planes) {
    if (p.side !== side || p.kind !== RECON93 || p.hp <= 0 || p.t <= p.T || p.t > p.T + HOLD93[RECON93]) continue;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > RECON_R93 * RECON_R93) continue;
    const cx = cellOf(x), cz = cellOf(z);
    return !blocks(w, cx, cz) && vegetationAt(w, cx, cz) !== VEG_WOOD && !smokeBlocks(w, x, z, x, z);
  }
  return false;
}

// 存檔：air 只有 1；沒有 air 就沒有 sky、沒有 46 號、佇列沒有 46；喪屍防守沒有 sky；sky 每一欄都要對
const PLANE_KEYS = ['id', 'side', 'kind', 'x', 'z', 'sx', 'sz', 'tx', 'tz', 't', 'T', 'hp'];
export function airOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { air?: unknown; queue?: unknown } | undefined, units = r.units as Record<string, unknown>[], sky = r.sky as Record<string, unknown> | undefined;
  if (e && e.air !== undefined && e.air !== 1) return false;
  if (e?.air !== 1) {
    if (sky !== undefined || units.some(u => u.kind === 46)) return false;
    return !(e && Array.isArray(e.queue) && e.queue.some(q => Array.isArray(q) && q.includes(46)));
  }
  if (sky === undefined) return true;
  if (r.zombies !== undefined) return false;
  if (typeof sky !== 'object' || sky === null || sky.version !== 1 || !Number.isInteger(sky.next) || (sky.next as number) < 1) return false;
  if (!Array.isArray(sky.ready) || sky.ready.length !== 4 || !sky.ready.every(v => Number.isInteger(v))) return false;
  if (!Array.isArray(sky.planes) || sky.planes.length > 4) return false;
  const n = r.n as number, lim = n * SUB - 1, ids = new Set<number>(), slots = new Set<number>();
  for (const p of sky.planes as Record<string, unknown>[]) {
    if (typeof p !== 'object' || p === null || !PLANE_KEYS.every(k => Number.isInteger(p[k]))) return false;
    const q = p as unknown as Plane93;
    if ((q.side !== 0 && q.side !== 1) || (q.kind !== STRIKE93 && q.kind !== RECON93)) return false;
    if (q.id < 1 || q.id >= (sky.next as number) || ids.has(q.id)) return false;
    if (q.hp < 1 || q.hp > HP93[q.kind] || q.T < MIN_T93 || q.t < -DELAY93[q.kind] || q.t >= 2 * q.T + HOLD93[q.kind]) return false;
    if (![q.x, q.z, q.sx, q.sz, q.tx, q.tz].every(v => v >= 0 && v <= lim)) return false;
    const s = slotOf(q.side, q.kind);
    if (slots.has(s)) return false;   // 同一方同一種只有一架
    ids.add(q.id); slots.add(s);
  }
  return true;
}
