// R018 電腦對手 v1：在 step() 裡想、只看世界、整數、決定性；不抽 World.rng。
// 不偷看迷霧：敵人的位置只用「自己這一方看得到的」（spotted 由 step.ts 傳進來，避免循環 import）；對方出生角落算開局就知道的地圖情報。
import { dist } from './math.ts';
import { hqAlive } from './eco.ts';
import { armorPct, ARMOR_FRONT } from './armor.ts';
import {
  SUB, center, cellOf, inGrid, cellIdx, blocks, bldAt, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY,
  ORD_IDLE, ORD_ATTACK, SIDE_PLAYER, type World, type Unit, type AiState,
} from './world.ts';

export type AiCmd =
  | { t: 'produce'; side: number; kind: number }
  | { t: 'move'; side: number; ids: number[]; x: number; z: number }
  | { t: 'fireAt'; side: number; ids: number[]; x: number; z: number }
  | { t: 'attack'; side: number; ids: number[]; target: number };
type Spotted = (w: World, side: number, x: number, z: number) => boolean;

export const AI_THINK = [0, 90, 30, 20];           // 難度 1／2／3：每幾步想一次（4.5、1.5、1 秒）
const ADVANCE = [0, 4, 6, 8];                       // 難度 1／2／3：每次推進幾格

// ai 指令：讓電腦接手 side（同一方再送一次＝換難度）
export function setAi(w: World, side: number, level: number): void {
  if ((side !== 0 && side !== 1) || !(level >= 1 && level <= 3) || (level | 0) !== level) return;
  if (!w.ai) w.ai = [];
  const corner = side === SIDE_PLAYER ? 5 : w.n - 6;     // 對方的出生角落（開局就知道的地圖情報；32×32 是 26）
  const old = w.ai.find(a => a.side === side);
  if (old) { old.level = level; return; }
  w.ai.push({ side, level, next: w.tick, ox: center(corner), oz: center(corner), seen: 0, wp: 0 });
  w.ai.sort((a, b) => a.side - b.side);
}

const order = (u: Unit) => u.order;
// 最接近目標的那一台（同距離取 id 小的）
const front = (us: Unit[], st: AiState) => us.slice().sort((a, b) => dist(a.x, a.z, st.ox, st.oz) - dist(b.x, b.z, st.ox, st.oz) || a.id - b.id)[0];
// 一個點附近，旁邊有幾格站著的建築（掩體）
function cover(w: World, x: number, z: number): number {
  let c = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && blocks(w, x + dx, z + dz)) c++;
  return c;
}

// R036 裝甲面向（R104）：停著、目標在射程內、但目標打過來不會打在正面的坦克，回傳朝目標的那一格（走得過去才給）。
// 車體方向只會跟著真的移動改變（R104 的規則），所以先朝目標開一格，車頭就轉過去了。
function turnStep(w: World, u: Unit, t: Unit): [number, number] | null {
  if (u.hullX === undefined || u.hullZ === undefined || u.pathIdx < u.path.length) return null;
  if (dist(u.x, u.z, t.x, t.z) > UNIT_KINDS[u.kind].range || armorPct(u, t.x, t.z) <= ARMOR_FRONT) return null;
  const cx = cellOf(u.x), cz = cellOf(u.z), sx = Math.sign(cellOf(t.x) - cx), sz = Math.sign(cellOf(t.z) - cz);
  const x = cx + sx, z = cz + sz;
  if ((!sx && !sz) || !inGrid(w, x, z) || blocks(w, x, z)) return null;
  return [x, z];
}

// 想一次：回傳這一次要下的指令（step 會照一般指令套用）
export function aiThink(w: World, st: AiState, spotted: Spotted): AiCmd[] {
  const out: AiCmd[] = [], side = st.side, lv = st.level;
  const mine = w.units.filter(u => u.alive && u.side === side);
  const seen = w.units.filter(u => u.alive && u.side !== side && spotted(w, side, u.x, u.z));
  if (seen.length) {   // 記住最後看到敵人的地方（重心），之後朝那裡推進
    let sx = 0, sz = 0;
    for (const u of seen) { sx += u.x; sz += u.z; }
    st.ox = Math.trunc(sx / seen.length); st.oz = Math.trunc(sz / seen.length); st.seen = w.tick;
  }
  // R019：有指揮部時，看不到敵人就以對方指揮部為目標（建築在地圖上本來就看得到）；有補給就出兵
  const foeHq = w.eco ? hqAlive(w, 1 - side) : null;
  if (foeHq && !seen.length) { st.ox = center(foeHq.x) + (SUB >> 1); st.oz = center(foeHq.z) + (SUB >> 1); }
  if (w.eco && hqAlive(w, side)) {
    const e = w.eco, q = e.queue[side], has = (k: number) => mine.filter(u => u.kind === k).length + q.filter(x => x === k).length;
    if (q.length < 2) {
      // R022 有砲（guns）時普通以上各保持一門：看到敵方坦克就先補反戰車砲；平常排在榴彈砲後面
      const foeArmor = seen.some(u => UNIT_KINDS[u.kind].armored), guns = e.guns && lv >= 2;
      // R023 坦克以 armored 算（輕、中、重一起）；有 tanks 時普通以上各保持一台輕、重坦克，其餘出中坦克
      const tankN = mine.filter(u => UNIT_KINDS[u.kind].armored).length + q.filter(k => UNIT_KINDS[k].armored).length;
      const tankPick = e.tanks && lv >= 2 ? (has(UK_LIGHT) < 1 ? UK_LIGHT : has(UK_HEAVY) < 1 ? UK_HEAVY : UK_TANK) : UK_TANK;
      const want = has(UK_OBSERVER) < 1 ? UK_OBSERVER : guns && foeArmor && has(UK_ATGUN) < 1 ? UK_ATGUN : e.inf && has(UK_INFANTRY) < (lv >= 2 ? 2 : 1) ? UK_INFANTRY
        : has(UK_HOWITZER) < (lv >= 2 ? 2 : 1) && tankN >= 2 ? UK_HOWITZER : guns && has(UK_MORTAR) < 1 ? UK_MORTAR : guns && has(UK_ATGUN) < 1 ? UK_ATGUN : tankPick;
      if (e.supply[side] >= UNIT_KINDS[want].cost) out.push({ t: 'produce', side, kind: want });
    }
  }
  // 到了目標附近還看不到敵人：換下一個搜索點（對方角落 → 中央 → 另外兩角，輪流）
  const ref0 = mine.filter(u => u.kind !== UK_OBSERVER);
  if (!seen.length && ref0.length) {
    const cx = Math.trunc(ref0.reduce((s, u) => s + u.x, 0) / ref0.length), cz = Math.trunc(ref0.reduce((s, u) => s + u.z, 0) / ref0.length);
    if (!foeHq && dist(cx, cz, st.ox, st.oz) < 3 * SUB) {
      const far = side === SIDE_PLAYER ? 5 : w.n - 6, near = w.n - 1 - far, mid = w.n >> 1, pts = [[far, far], [mid, mid], [far, near], [near, far]];   // 32×32：26、31−far、16
      st.wp = (st.wp + 1) % pts.length; st.ox = center(pts[st.wp][0]); st.oz = center(pts[st.wp][1]);
    }
  }
  const tanks = mine.filter(u => UNIT_KINDS[u.kind].armored),   // R023：輕、中、重坦克一起（沒有新坦克時就是原本的坦克）
    guns = mine.filter(u => u.kind === UK_HOWITZER || u.kind === UK_MORTAR), obs = mine.filter(u => u.kind === UK_OBSERVER);

  // ---- 坦克 ----
  // 遊戲裡沒有維修，撤退等於放棄（第一版試過：受重傷的撤回老家就再也不出來，整局僵住），所以受傷的也一起打
  const fit = tanks;
  if (fit.length) {
    if (seen.length) {
      // 普通以上集火：先打快死的（血量比例最低），再打離組重心最近的；簡單各打各的最近
      const gx = Math.trunc(fit.reduce((s, u) => s + u.x, 0) / fit.length), gz = Math.trunc(fit.reduce((s, u) => s + u.z, 0) / fit.length);
      const rank = (t: Unit, ox: number, oz: number) => (lv >= 2 ? Math.trunc((t.hp * 1000) / UNIT_KINDS[t.kind].hp) * 100000 : 0) + dist(ox, oz, t.x, t.z);
      const pick = (ox: number, oz: number) => seen.slice().sort((a, b) => rank(a, ox, oz) - rank(b, ox, oz) || a.id - b.id)[0];
      if (lv >= 2) {
        // R036：困難的電腦會顧車頭：沒對著集火目標的坦克先朝目標開一格（轉成正面），其他照常集火
        const t = pick(gx, gz), ids: number[] = [];
        for (const u of fit) {
          const turn = lv >= 3 ? turnStep(w, u, t) : null;
          if (turn) { out.push({ t: 'move', side, ids: [u.id], x: turn[0], z: turn[1] }); continue; }
          if (!(order(u) === ORD_ATTACK && u.target === t.id)) ids.push(u.id);
        }
        if (ids.length) out.push({ t: 'attack', side, ids, target: t.id });
      } else for (const u of fit) {
        const t = pick(u.x, u.z);
        if (!(order(u) === ORD_ATTACK && u.target === t.id)) out.push({ t: 'attack', side, ids: [u.id], target: t.id });
      }
    } else if (foeHq && fit.some(u => dist(u.x, u.z, st.ox, st.oz) <= UNIT_KINDS[UK_TANK].range + SUB)) {
      // R019：看不到敵方單位、對方指揮部在射程附近：轟指揮部
      const ids = fit.filter(u => !(u.order === 3 && u.tx >= foeHq.x && u.tx < foeHq.x + foeHq.w && u.tz >= foeHq.z && u.tz < foeHq.z + foeHq.d)).map(u => u.id);
      if (ids.length) out.push({ t: 'fireAt', side, ids, x: foeHq.x, z: foeHq.z });
    } else if (w.eco
      ? (() => { const lead = front(fit, st); return order(lead) === ORD_IDLE || lead.pathIdx >= lead.path.length; })()
      : fit.every(u => order(u) === ORD_IDLE || u.pathIdx >= u.path.length)) {
      // 看不到敵人：沒有補給（R018）時整組停著就以重心往前推；有補給（R019）時以最前面那台為準推（後來出生的會追上）
      const lead = w.eco ? front(fit, st) : null;
      const gx = lead ? lead.x : Math.trunc(fit.reduce((s, u) => s + u.x, 0) / fit.length), gz = lead ? lead.z : Math.trunc(fit.reduce((s, u) => s + u.z, 0) / fit.length);
      const d = Math.max(1, dist(gx, gz, st.ox, st.oz)), step = Math.min(d, ADVANCE[lv] * SUB);
      const tx = cellOf(gx + Math.trunc(((st.ox - gx) * step) / d)), tz = cellOf(gz + Math.trunc(((st.oz - gz) * step) / d));
      let best = -1, bestScore = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = tx + dx, z = tz + dz;
        if (!inGrid(w, x, z) || blocks(w, x, z)) continue;
        const score = (Math.abs(dx) + Math.abs(dz)) * 10 - cover(w, x, z) * 12 + ((x * 7 + z * 13 + w.tick) % 5);
        if (best < 0 || score < bestScore) { best = cellIdx(w, x, z); bestScore = score; }
      }
      const n = w.n;
      if (best >= 0 && (cellOf(gx) !== best % n || cellOf(gz) !== (best - (best % n)) / n)) out.push({ t: 'move', side, ids: fit.map(u => u.id), x: best % n, z: (best - (best % n)) / n });
    }
  }

  // ---- 榴彈砲（R022 迫擊砲照同一套）：打看得到、在射程內（最小射程外）的敵人，先打坦克 ----
  for (const g of guns) {
    const k = UNIT_KINDS[g.kind];
    if (order(g) === ORD_ATTACK && w.units[g.target - 1]?.alive) continue;
    const ok = seen.filter(t => { const dd = dist(g.x, g.z, t.x, t.z); return dd <= k.range && dd >= k.minRange; });
    if (!ok.length) {
      // 打不到：往目標推進，直到目標進入射程（留 4 格餘裕）；移動中不能打，所以只在停著時才推
      const dd = dist(g.x, g.z, st.ox, st.oz);
      if (g.pathIdx >= g.path.length && dd > k.range - 4 * SUB) {
        const step = Math.min(dd, 6 * SUB);
        out.push({ t: 'move', side, ids: [g.id], x: cellOf(g.x + Math.trunc(((st.ox - g.x) * step) / dd)), z: cellOf(g.z + Math.trunc(((st.oz - g.z) * step) / dd)) });
      } else if (foeHq && order(g) === ORD_IDLE && dd >= k.minRange && dd <= k.range) {
        out.push({ t: 'fireAt', side, ids: [g.id], x: foeHq.x, z: foeHq.z });   // R019：轟對方指揮部
      } else if (lv >= 2 && st.seen > 0 && order(g) === ORD_IDLE && dd >= k.minRange && dd <= k.range) {
        // 看不到也打不到看得到的：盲射最後看到敵人的地方（R001 允許盲射，散布加倍；只用記憶，不偷看）
        out.push({ t: 'fireAt', side, ids: [g.id], x: cellOf(st.ox), z: cellOf(st.oz) });
      }
      continue;
    }
    ok.sort((a, b) => (UNIT_KINDS[a.kind].armored ? 0 : 1) - (UNIT_KINDS[b.kind].armored ? 0 : 1) || dist(g.x, g.z, a.x, a.z) - dist(g.x, g.z, b.x, b.z) || a.id - b.id);
    out.push({ t: 'attack', side, ids: [g.id], target: ok[0].id });
  }

  // ---- R022 反戰車砲：先打看得到、射程內的裝甲，沒有才打別的；沒有目標就跟在坦克（沒有坦克就自己人）重心附近，架好不亂動 ----
  for (const a of mine.filter(u => u.kind === UK_ATGUN)) {
    const k = UNIT_KINDS[a.kind];
    if (order(a) === ORD_ATTACK && w.units[a.target - 1]?.alive) continue;
    const ok = seen.filter(t => dist(a.x, a.z, t.x, t.z) <= k.range)
      .sort((p, q) => (UNIT_KINDS[p.kind].armored ? 0 : 1) - (UNIT_KINDS[q.kind].armored ? 0 : 1) || dist(a.x, a.z, p.x, p.z) - dist(a.x, a.z, q.x, q.z) || p.id - q.id);
    if (ok.length) { out.push({ t: 'attack', side, ids: [a.id], target: ok[0].id }); continue; }
    if (a.pathIdx < a.path.length) continue;
    const ref = tanks.length ? tanks : mine.filter(u => u.kind !== UK_ATGUN && u.kind !== UK_OBSERVER);
    if (!ref.length) continue;
    const gx = Math.trunc(ref.reduce((s, u) => s + u.x, 0) / ref.length), gz = Math.trunc(ref.reduce((s, u) => s + u.z, 0) / ref.length);
    if (dist(a.x, a.z, gx, gz) > 3 * SUB) out.push({ t: 'move', side, ids: [a.id], x: cellOf(gx), z: cellOf(gz) });
    else if (foeHq && order(a) === ORD_IDLE && dist(a.x, a.z, st.ox, st.oz) <= k.range) out.push({ t: 'fireAt', side, ids: [a.id], x: foeHq.x, z: foeHq.z });
  }

  // ---- R021 步兵：打看得到、射程附近的非裝甲目標；沒有目標就進駐前線附近的房子 ----
  for (const f of mine.filter(u => u.kind === UK_INFANTRY)) {
    if (order(f) === ORD_ATTACK && w.units[f.target - 1]?.alive) continue;
    const soft = seen.filter(t => !UNIT_KINDS[t.kind].armored && dist(f.x, f.z, t.x, t.z) <= UNIT_KINDS[f.kind].range + 2 * SUB)
      .sort((a, b) => dist(f.x, f.z, a.x, a.z) - dist(f.x, f.z, b.x, b.z) || a.id - b.id);
    if (soft.length) { out.push({ t: 'attack', side, ids: [f.id], target: soft[0].id }); continue; }
    const inside = bldAt(w, cellOf(f.x), cellOf(f.z));
    if ((inside && inside.hp > 0) || f.pathIdx < f.path.length) continue;
    const ref = tanks.length ? tanks : mine;
    const gx = Math.trunc(ref.reduce((s, u) => s + u.x, 0) / ref.length), gz = Math.trunc(ref.reduce((s, u) => s + u.z, 0) / ref.length);
    let pick: { x: number; z: number } | null = null, pd = 0;
    for (const b of w.blds) {
      if (b.hp <= 0 || b.builtBy === 1 - side) continue;
      const bd = dist(center(b.x), center(b.z), gx, gz);
      if (bd < 6 * SUB && (!pick || bd < pd)) { pick = { x: b.x, z: b.z }; pd = bd; }
    }
    if (pick) out.push({ t: 'move', side, ids: [f.id], x: pick.x, z: pick.z });
  }

  // ---- 觀測員：沒有坦克了就往前偵察（離開房子也要去）；普通以上平常進駐前線附近、還站著的房子 ----
  if (!fit.length) for (const o of obs) {
    if (o.pathIdx < o.path.length) continue;
    const d = Math.max(1, dist(o.x, o.z, st.ox, st.oz)), step = Math.min(d, 6 * SUB);
    if (d > 2 * SUB) out.push({ t: 'move', side, ids: [o.id], x: cellOf(o.x + Math.trunc(((st.ox - o.x) * step) / d)), z: cellOf(o.z + Math.trunc(((st.oz - o.z) * step) / d)) });
  }
  else if (lv >= 2) for (const o of obs) {
    const inside = bldAt(w, cellOf(o.x), cellOf(o.z));
    if ((inside && inside.hp > 0) || o.pathIdx < o.path.length) continue;
    const ref = fit.length ? fit : mine;
    const gx = Math.trunc(ref.reduce((s, u) => s + u.x, 0) / ref.length), gz = Math.trunc(ref.reduce((s, u) => s + u.z, 0) / ref.length);
    const d = Math.max(1, dist(gx, gz, st.ox, st.oz)), step = Math.min(d, 4 * SUB);
    const fx = gx + Math.trunc(((st.ox - gx) * step) / d), fz = gz + Math.trunc(((st.oz - gz) * step) / d);
    let pick: { x: number; z: number } | null = null, pd = 0;
    for (const b of w.blds) {
      if (b.hp <= 0) continue;
      const bd = dist(center(b.x), center(b.z), fx, fz);
      if (bd < 7 * SUB && (!pick || bd < pd)) { pick = { x: b.x, z: b.z }; pd = bd; }
    }
    if (pick) out.push({ t: 'move', side, ids: [o.id], x: pick.x, z: pick.z });
  }
  return out;
}
