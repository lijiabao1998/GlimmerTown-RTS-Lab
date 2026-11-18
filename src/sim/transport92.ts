// R092 運輸：卡車（44）、半履帶車（45）。eco 帶 tp＝1 才造得出來；沒有這兩種車的局，這裡一行都不會走到。
// 一條規則管載人和拖砲：車跟要載的人、要拖的砲在同一道移動指令裡，兩格內的就上車／掛上；車的移動走完（或被打爛、被釘住）就放下。一台只載一個。
// 卡面：docs/tasks/R092-運輸.md。只用整數、不抽亂數。
import { dist } from './math.ts';
import { UNIT_KINDS, UK_ZOMBIE, UK_TRUCK, UK_HALFTRACK, ORD_IDLE, ORD_MOVE, SUB, MORALE_PINNED, moraleState, type Unit, type World } from './world.ts';

export const REACH92 = 2 * SUB;   // 兩格內的才掛得上（整數距離 ≤ 512）
export const BAIL92 = [50, 25];   // 車被打爛時坐車的扣血量上限的幾 %：[沒裝甲（卡車）, 有裝甲（半履帶車）]

// 能坐車的：沒有碰撞半徑的徒步單位（觀測員、步兵班、迫擊砲、機槍組、狙擊手、反戰車小組），喪屍不算
export const rides92 = (kind: number): boolean => UNIT_KINDS[kind].radius === 0 && kind !== UK_ZOMBIE;
// 能被拖的：沒有裝甲、沒有人數、有碰撞半徑、要架設或間接射擊的砲
export const tows92 = (kind: number): boolean => { const k = UNIT_KINDS[kind]; return !k.armored && k.men === 0 && k.radius > 0 && (k.setup || k.indirect); };
const pinned = (w: World, u: Unit): boolean => !!w.rules?.morale && moraleState(u) >= MORALE_PINNED;
const unhitch = (g: Unit): void => { delete g.towBy; g.cooldown = Math.max(g.cooldown, UNIT_KINDS[g.kind].reload); };

// 指令逐單位算完之後（step.ts 的 applyCommand）：us 是這道指令收下的單位
export function hitch92(w: World, isMove: boolean, us: Unit[]): void {
  if (!isMove) { for (const g of us) if (g.towBy) unhitch(g); return; }   // 攻擊、射擊、停：拖著的砲解掛，砲自己那一道指令照舊生效
  const sorted = us.slice().sort((a, b) => a.id - b.id), ids = new Set(sorted.map(u => u.id));
  for (const g of sorted) if (g.towBy) {
    if (!ids.has(g.towBy)) unhitch(g);   // 車沒一起動：解掛，照自己剛算的路走
    else { g.order = ORD_IDLE; g.path = []; g.pathIdx = 0; }   // 車也在：留著，跟車走
  }
  const busy = new Set<number>();
  for (const u of w.units) if (u.alive) { if (u.ride) busy.add(u.ride); if (u.towBy) busy.add(u.towBy); }
  for (const c of sorted) {   // 照車配：每台空車挑兩格內（距離、id）最小的那一個
    if (!UNIT_KINDS[c.kind].carry || c.order !== ORD_MOVE || !c.path.length || pinned(w, c) || busy.has(c.id)) continue;
    let best: Unit | null = null, bd = 0;
    for (const u of sorted) {
      if (u.ride || u.towBy || !(rides92(u.kind) || tows92(u.kind)) || pinned(w, u)) continue;
      const d = dist(c.x, c.z, u.x, u.z);
      if (d <= REACH92 && (!best || d < bd)) { best = u; bd = d; }
    }
    if (!best) continue;
    if (rides92(best.kind)) best.ride = c.id; else best.towBy = c.id;
    best.order = ORD_IDLE; best.path = []; best.pathIdx = 0; best.target = 0; delete best.fireAmmo;
    best.x = c.x; best.z = c.z; busy.add(c.id);
  }
}

// 每一步、updateShells 之後（這一步該死的都死了）：放下或跟著車。hurt＝不吃地形掩護的傷害（step.ts 的 damageUnit）
export function carry92(w: World, hurt: (u: Unit, dmg: number) => void): void {
  for (const u of w.units) {
    const cid = u.ride || u.towBy;
    if (!cid) continue;
    if (!u.alive) { delete u.ride; delete u.towBy; continue; }   // 拖著的砲被打掉了
    const c = w.units[cid - 1], dead = !c || !c.alive;
    if (dead || c.order !== ORD_MOVE || pinned(w, c)) {
      const rider = !!u.ride;
      delete u.ride; delete u.towBy;
      if (c) { u.x = c.x; u.z = c.z; }
      u.order = ORD_IDLE; u.path = []; u.pathIdx = 0;
      u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].reload);   // 下車、卸砲之後先裝填一輪
      if (dead && rider && c) hurt(u, Math.floor((UNIT_KINDS[u.kind].hp * BAIL92[UNIT_KINDS[c.kind].armored ? 1 : 0]) / 100));
      continue;
    }
    u.x = c.x; u.z = c.z;
  }
}

// 存檔：tp 只有 1；沒有 tp 就沒有 44／45、沒有 ride／towBy；活著的連結要指向活著、同一方的車，一台只掛一個
export function tpOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { tp?: unknown; queue?: unknown } | undefined, units = r.units as Record<string, unknown>[];
  if (e && e.tp !== undefined && e.tp !== 1) return false;
  const car = (k: unknown) => k === UK_TRUCK || k === UK_HALFTRACK;
  if (e?.tp !== 1) {
    if (units.some(u => car(u.kind) || u.ride !== undefined || u.towBy !== undefined)) return false;
    return !(e && Array.isArray(e.queue) && e.queue.some(q => Array.isArray(q) && q.some(car)));
  }
  const used = new Set<number>();
  for (const u of units) {
    if (u.ride === undefined && u.towBy === undefined) continue;
    if (u.ride !== undefined && u.towBy !== undefined) return false;
    const cid = (u.ride ?? u.towBy) as number;
    if (!Number.isInteger(cid) || cid < 1 || cid > units.length || cid === u.id) return false;
    if (!u.alive) continue;   // 死掉的單位身上留著的連結照收
    const c = units[cid - 1], kind = u.kind as number;
    if (u.ride !== undefined ? !rides92(kind) : !tows92(kind)) return false;
    if (!c || !c.alive || c.side !== u.side || !UNIT_KINDS[c.kind as number]?.carry || used.has(cid)) return false;
    used.add(cid);
  }
  return true;
}
