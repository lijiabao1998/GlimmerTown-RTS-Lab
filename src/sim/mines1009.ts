// R1009 地雷與排雷：工兵布反戰車雷（1）、反人員雷（2）；挨著戳得到敵方的雷、知道了才排得掉；敵方的車和砲壓響反戰車雷、什麼地面單位都會踩響反人員雷。
// eco 帶 mine＝1 的局才有（w.eco.mine）；沒有 w.mines 的世界，這裡一行都不會走到。卡面：docs/tasks/R1009-地雷與排雷.md。只用整數、不抽亂數。
// 雷不是單位、不是建築：w.mines.cells 一筆一格（side、kind、x、z、left＝還差多少工作量、seen＝對方知不知道）。畫面、介面只准經過 known1009 看雷。
import { findPath } from './path.ts';
import { spotted } from './step.ts';   // step.ts 也 import 這一支；只在布好那一步呼叫，載入時不碰（engineer1002.ts 也這樣）
import { builders50 } from './tech50.ts';
import { near1002 } from './engineer1002.ts';   // engineer1002.ts 也 import 這一支；只在呼叫時用，循環沒有關係
import { suppressBlast } from './morale.ts';
import { trenchAt } from './trenches.ts';
import { UNIT_KINDS, SUB, TER_MUD, ORD_IDLE, ORD_FIRE_AT, SHELL_HE, cellIdx, inGrid, cellOf, center, blocks, wireAt, wireBlocks, type World, type Unit, type Mine1009 } from './world.ts';

export interface MineCmd { t: 'mine'; side: number; ids: number[]; kind: number; x: number; z: number; rot?: number; len?: number }
export interface MineSpec1009 { cost: number; lay: number; clear: number; armored: number; soft: number; foot: number }
// 補給（每格）、布一格（工兵·步）、排一格（倒數步數）、炸到有裝甲的車、沒裝甲的車和砲、徒步單位（再乘目標的承傷；不吃掩護）。數字都是暫定，理由在卡面「換算」
export const MINES1009: Record<number, MineSpec1009> = {
  1: { cost: 15, lay: 120, clear: 160, armored: 60, soft: 60, foot: 20 },   // 反戰車雷：只有車和砲（radius ＞ 0）壓得響
  2: { cost: 10, lay: 80, clear: 200, armored: 0, soft: 10, foot: 30 },     // 反人員雷：什麼地面單位都踩得響
};
export const MAX1009 = 24;       // 每一方最多幾格（布好的加還在布的）
export const HQ_GAP1009 = 5;     // 每一格跟敵方指揮部佔地的八方向距離要大於這個（出生那一圈、集結點都在 5 格內）
export const PROBE1009 = 1;      // 工兵戳得到幾格（八方向，含站在上面）
export const NEXT1009 = 2;       // 布好一格之後，找下一格最遠幾格（一條雷帶一個工兵從頭布到尾）
export const LEN1009 = 3;        // 一條雷帶最多幾格
export const BLAST1009 = 128;    // 觸雷的高爆落地事件半徑（迫擊砲那一級的畫面和聲音；同 R1002 的爆破）
export const CELLS1009 = 48;     // 存檔：w.mines 最多幾筆（兩方各 24）
export const BOX1009 = 4;        // 布雷、排雷的工兵挨近目標時，繞開知道的雷最多看幾格（只走直的；施工紀錄 2）
export const CLR1009 = 1;        // 工兵射擊指令的 target：排雷指令是 1（布雷的 send、R1002 的爆破、R050 的建造都是 0）；疊在同一格的敵方雷只有排雷指令碰（施工紀錄 13）

const isKind = (k: unknown): k is number => k === 1 || k === 2;
const cheb = (ax: number, az: number, bx: number, bz: number): number => Math.max(Math.abs(ax - bx), Math.abs(az - bz));
const halt = (u: Unit): void => { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; };
const cellBox = (m: { x: number; z: number }) => ({ x: m.x, z: m.z, w: 1, d: 1 });
// 一條雷帶的格：rot 0 從 (x, z) 往 +x 排、1 往 +z 排
export const cells1009 = (x: number, z: number, rot: number, len: number): [number, number][] => Array.from({ length: len }, (_, i): [number, number] => (rot ? [x, z + i] : [x + i, z]));
// 那一方在那一格的雷（同一方同一格最多一筆）
export const mineAt1009 = (w: World, side: number, x: number, z: number): Mine1009 | null => w.mines?.cells.find(m => m.side === side && m.x === x && m.z === z) ?? null;
// 誰知道哪一格：自己布的，或對方已經知道了（seen）。畫面、介面、以後的電腦都只能經過這一支看雷
export const known1009 = (w: World, side: number, m: Mine1009): boolean => m.side === side || m.seen === 1;   // w 留著：以後「誰知道」要看世界（例如偵察）時不用改呼叫的地方
// 那一格是不是 R1002 的事（還站著的建築、還沒壞的鐵絲網）
const demoAt = (w: World, x: number, z: number): boolean => blocks(w, x, z) || (wireAt(w, x, z)?.hp ?? 0) > 0;

// 能不能布：'' 可以；不然回原因（介面與模擬共用，照卡面 2.2 的順序）。沒給位置時只看「這一種現在布不布得起一格」
export function why1009(w: World, side: number, kind: number, at?: { x: number; z: number; ids: unknown; rot?: unknown; len?: unknown }): string {
  if (!w.eco?.mine || w.zombies || w.sandbox || w.winner >= 0 || w.tick === 0 || (side !== 0 && side !== 1)) return '本局未開放';
  const hq = w.eco.hq[side] ? w.blds[w.eco.hq[side] - 1] : undefined;
  if (!hq || hq.hp <= 0) return '指揮部已毀';
  const len = at?.len === undefined ? 1 : at.len, rot = at?.rot === undefined ? 0 : at.rot;
  if (!isKind(kind) || !Number.isInteger(len) || (len as number) < 1 || (len as number) > LEN1009 || (rot !== 0 && rot !== 1)) return '不能布這種';
  const n = len as number, spec = MINES1009[kind];
  if ((w.mines?.cells.filter(m => m.side === side).length ?? 0) + n > MAX1009) return `已經布滿 ${MAX1009} 格`;
  if (w.eco.supply[side] < spec.cost * n) return `補給不足，還差 ${spec.cost * n - w.eco.supply[side]}`;
  if (!at) return '';
  if (!builders50(w, side, Array.isArray(at.ids) ? at.ids : []).length) return '先選工兵';
  if (!Number.isInteger(at.x) || !Number.isInteger(at.z)) return '超出地圖';
  const cells = cells1009(at.x, at.z, rot, n);
  if (cells.some(([x, z]) => !inGrid(w, x, z))) return '超出地圖';
  const fid = w.eco.hq[1 - side], foe = fid ? w.blds[fid - 1] : undefined;
  if (foe && cells.some(([x, z]) => Math.max(Math.max(foe.x - x, 0, x - (foe.x + foe.w - 1)), Math.max(foe.z - z, 0, z - (foe.z + foe.d - 1))) <= HQ_GAP1009)) return '離敵方指揮部太近';
  if (cells.some(([x, z]) => w.ter[cellIdx(w, x, z)] === TER_MUD)) return '不能布在水裡';
  for (const [x, z] of cells) {
    const other = mineAt1009(w, 1 - side, x, z);
    if (w.occ[cellIdx(w, x, z)] || wireAt(w, x, z) || trenchAt(w, x, z) || mineAt1009(w, side, x, z) || (other && known1009(w, side, other))
      || w.units.some(u => u.alive && !u.ride && !u.towBy && cellOf(u.x) === x && cellOf(u.z) === z)) return '擋到了';
  }
  return '';
}

// 叫工兵去那一格（射擊指令；已經挨著就不給路）
function send(w: World, u: Unit, x: number, z: number): void {
  u.order = ORD_FIRE_AT; u.tx = x; u.tz = z; u.target = 0;
  u.path = near1002(u, { x, z, w: 1, d: 1 }) ? [] : findPath(w, cellOf(u.x), cellOf(u.z), x, z, 0, 0, u.kind); u.pathIdx = 0;
}

// mine 指令：放得下才接（整條一起接或一起不接）——扣補給、每格記一筆還在布的雷、叫工兵去第一格。不出事件（畫面自己比對）
export function lay1009(w: World, c: MineCmd): void {
  const ids = Array.isArray(c.ids) ? c.ids : [];
  if (why1009(w, c.side, c.kind, { x: c.x, z: c.z, ids, rot: c.rot, len: c.len }) !== '') return;
  const len = c.len ?? 1, spec = MINES1009[c.kind], cells = cells1009(c.x, c.z, c.rot ?? 0, len);
  w.eco!.supply[c.side] -= spec.cost * len;
  const list = (w.mines ??= { version: 1, cells: [] }).cells;
  for (const [x, z] of cells) list.push({ side: c.side, kind: c.kind, x, z, left: spec.lay, seen: 0 });
  for (const u of builders50(w, c.side, ids)) send(w, u, cells[0][0], cells[0][1]);
}

// 工兵射擊指令那一格跟雷有關的那一筆：自己還沒布好的；不然布雷指令＝自己布好的（剛被別人布完：要找下一格）或 null（不在了：回待命），
// 排雷指令（target＝CLR1009）＝這一方知道的敵方雷，不在了就是 null（回待命）。那一格有還站著的建築或還沒壞的鐵絲網＝R1002 的事，回傳 null
export function target1009(w: World, u: Unit): Mine1009 | null {
  if (demoAt(w, u.tx, u.tz)) return null;
  const own = mineAt1009(w, u.side, u.tx, u.tz);
  if (own && own.left > 0) return own;
  if (u.target !== CLR1009) return own;   // 布雷指令不碰疊在同一格的敵方雷（施工紀錄 13：以前布好那一步會變成排雷，倒數沒撐就當場拿掉）
  const foe = mineAt1009(w, 1 - u.side, u.tx, u.tz);
  return foe && known1009(w, u.side, foe) ? foe : null;
}

// applyCommand 的 fireAt 對工兵（engineer1002.ts 的 fireAt1002 最前面）：自己還沒布好的＝接著布；這一方知道的敵方雷＝排（倒數撐在排一格那麼多）。
// 都不是回 false（照 R1002）：對方不知道的雷、自己布好的雷，下了跟對空地下一模一樣
export function fireAt1009(w: World, u: Unit, gx: number, gz: number): boolean {
  if (demoAt(w, gx, gz)) return false;
  const own = mineAt1009(w, u.side, gx, gz), foe = mineAt1009(w, 1 - u.side, gx, gz);
  if (own && own.left > 0) { send(w, u, gx, gz); return true; }
  if (!foe || !known1009(w, u.side, foe)) return false;
  send(w, u, gx, gz); u.cooldown = Math.max(u.cooldown, MINES1009[foe.kind].clear);
  u.target = CLR1009;   // 記下這是排雷指令（send 布雷時是 0）
  return true;
}

// 布好之後找下一格：自己的、還沒布好的、離剛布好那一格八方向 ≤ 2，照 w.mines 的順序第一筆；沒有就回待命
function next1009(w: World, u: Unit, done: Mine1009): void {
  const m = w.mines!.cells.find(c => c.side === u.side && c.left > 0 && cheb(c.x, c.z, done.x, done.z) <= NEXT1009);
  if (m) send(w, u, m.x, m.z); else halt(u);
}

// fireUnit 對拿著射擊指令的工兵（engineer1002.ts 的 demo1002 最前面）：是雷的事就做完回 true；不是回 false（照 R1002）
// 布：挨著、沒在走，每一步 left 減 1（不看倒數、被壓制不變慢）；布好那一步敵方看得到就曝光，然後找下一格。
// 排：還沒挨著或還在走，倒數撐在至少排一格那麼多；挨著之後倒數（fireUnit 每步減，被壓制照 R052 變慢）到 0 就拿掉、回待命
export function work1009(w: World, u: Unit): boolean {
  const m = target1009(w, u);
  if (!m) return false;
  const moving = u.pathIdx < u.path.length, near = near1002(u, cellBox(m));
  if (m.side === u.side && m.left === 0) { next1009(w, u, m); return true; }
  if (m.side === u.side) {
    if (moving || !near) return true;
    m.left--;
    if (m.left > 0) return true;
    if (spotted(w, 1 - m.side, center(m.x), center(m.z))) reveal1009(w, m);   // 在敵人眼前布雷，敵人就知道
    next1009(w, u, m);
    return true;
  }
  const need = MINES1009[m.kind].clear;
  if (moving || !near) { if (u.cooldown < need) u.cooldown = need; return true; }
  const ax = center(m.x) - u.x, az = center(m.z) - u.z;
  if (ax || az) { u.aimX = ax; u.aimZ = az; }
  if (u.cooldown > 0) return true;
  w.mines!.cells.splice(w.mines!.cells.indexOf(m), 1);
  halt(u);
  return true;
}

// seen 從 0 變 1 的唯一入口（布好時被看到、工兵戳到、炸了帶出旁邊的）：看到的那一方所有活著、沒坐車、沒在潰退的單位，
// 剩下的路會走進那一格的，全部停下（看到就停）。工兵自己射擊指令的目標就是那一格的不停（挨著就停，本來就不會走進去）
export function reveal1009(w: World, m: Mine1009): void {
  if (m.seen) return;
  m.seen = 1;
  const side = 1 - m.side, c = cellIdx(w, m.x, m.z);
  for (const u of w.units) {
    if (!u.alive || u.ride || u.rout || u.side !== side) continue;
    if (UNIT_KINDS[u.kind].demo && u.order === ORD_FIRE_AT && u.tx === m.x && u.tz === m.z) continue;
    for (let i = u.pathIdx; i < u.path.length; i++) if (u.path[i] === c) { halt(u); break; }
  }
}

// 一步從 (ax, az) 走到 (bx, bz) 會不會踩進這一方知道的敵方雷：那一格本身，或斜著走時擦過的兩個角（走到格線交點那一步會落在角上那一格）
function touches(w: World, side: number, ax: number, az: number, bx: number, bz: number): boolean {
  const bad = (x: number, z: number): boolean => { const m = mineAt1009(w, 1 - side, x, z); return !!m && known1009(w, side, m); };
  return bad(bx, bz) || (ax !== bx && az !== bz && (bad(bx, az) || bad(ax, bz)));
}
const STEPS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// 繞：從工兵那一格只走直的（四方向，不擦角），在 9×9 格內找最近一個挨著目標、不是知道的雷、走得進去的格（照 STEPS4 的順序，決定性）；找不到回 null
function detour(w: World, u: Unit): number[] | null {
  const B = BOX1009, S = 2 * B + 1, ux = cellOf(u.x), uz = cellOf(u.z), prev = new Int32Array(S * S).fill(-2), queue = [B * S + B];
  const free = (x: number, z: number): boolean => { const m = mineAt1009(w, 1 - u.side, x, z); return inGrid(w, x, z) && !(x === u.tx && z === u.tz) && !blocks(w, x, z) && !wireBlocks(w, x, z, u.kind) && !(m && known1009(w, u.side, m)); };
  prev[B * S + B] = -1;
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h], lx = c % S, lz = (c - lx) / S;
    if (h > 0 && cheb(ux + lx - B, uz + lz - B, u.tx, u.tz) <= 1) {
      const out: number[] = [];
      for (let k = c; k !== B * S + B; k = prev[k]) { const kx = k % S; out.push(cellIdx(w, ux + kx - B, uz + (k - kx) / S - B)); }
      return out.reverse();
    }
    for (const [dx, dz] of STEPS4) {
      const nx = lx + dx, nz = lz + dz, k = nz * S + nx;
      if (nx < 0 || nz < 0 || nx >= S || nz >= S || prev[k] !== -2 || !free(ux + nx - B, uz + nz - B)) continue;
      prev[k] = c; queue.push(k);
    }
  }
  return null;
}

// 這一格炸到這個單位扣多少（再乘承傷；不吃掩護、不看穿甲率）
export const blast1009 = (spec: MineSpec1009, u: Unit): number => { const k = UNIT_KINDS[u.kind]; return k.radius === 0 ? spec.foot : k.armored ? spec.armored : spec.soft; };
const ENG: Unit[] = [], FOOT: Unit[] = [], FX: number[] = [], FZ: number[] = [];   // 模擬是單執行緒、這一支不會重入：每一步重複用同一組陣列（engineer1002.ts 的 CANDF 也這樣）

// 每一步、全部單位移動和推擠之後（step.ts，carry92 之前）：前半是戳到、工兵不走進知道的雷；後半是觸雷。hurt＝step.ts 的 damageUnit（不吃掩護）
// 先把這一步站在地上的單位（活著、沒坐車；沒被拖著的才算在格裡）和工兵各列一次（照 id 的順序），雷再對這兩張表看：不必每一格雷掃一遍全部單位（施工紀錄 9）
export function mines1009Step(w: World, hurt: (u: Unit, dmg: number) => void): void {
  const list = w.mines!.cells, n = w.n;
  ENG.length = 0; FOOT.length = 0; FX.length = 0; FZ.length = 0;
  for (const u of w.units) {
    if (!u.alive || u.ride) continue;
    if (UNIT_KINDS[u.kind].demo) ENG.push(u);
    if (!u.towBy) { FOOT.push(u); FX.push(cellOf(u.x)); FZ.push(cellOf(u.z)); }
  }
  for (const m of list) {   // 戳到：對方的工兵（活著、沒坐車）站在八方向 1 格以內。不看視線、不看煙（用手戳的）
    if (m.seen) continue;
    for (const u of ENG) if (u.side !== m.side && cheb(cellOf(u.x), cellOf(u.z), m.x, m.z) <= PROBE1009) { reveal1009(w, m); break; }
  }
  for (const u of ENG) {   // 工兵不走進知道的雷：往下一個路點那一步會踩進（或斜著擦過角）這一方知道的敵方雷、又不是射擊指令的目標，就停在這一格（尋路不繞雷）；
    if (u.rout || u.pathIdx >= u.path.length) continue;   // 正在布雷、排雷的，先試著只走直的繞到目標旁邊（施工紀錄 2）
    const c = u.path[u.pathIdx], x = c % n, z = (c - x) / n;
    if (u.order === ORD_FIRE_AT && u.tx === x && u.tz === z) continue;
    if (!touches(w, u.side, cellOf(u.x), cellOf(u.z), x, z)) continue;
    const way = u.order === ORD_FIRE_AT && target1009(w, u) ? detour(w, u) : null;
    if (way) { u.path = way; u.pathIdx = 0; } else halt(u);
  }
  for (let i = 0; i < list.length;) {   // 觸雷：照 w.mines 的順序看每一格布好的雷；那一格裡 id 最小、弄得響它的敵方單位
    const m = list[i];
    let by: Unit | null = null;
    if (m.left === 0) for (let j = 0; j < FOOT.length && !by; j++) { const u = FOOT[j]; if (u.alive && u.side !== m.side && FX[j] === m.x && FZ[j] === m.z && (m.kind !== 1 || UNIT_KINDS[u.kind].radius > 0)) by = u; }
    if (!by) { i++; continue; }
    const spec = MINES1009[m.kind], x = center(m.x), z = center(m.z);
    for (let j = 0; j < FOOT.length; j++) { const t = FOOT[j]; if (t.alive && t.side !== m.side && FX[j] === m.x && FZ[j] === m.z) hurt(t, blast1009(spec, t)); }
    if (by.alive) halt(by);
    if (!blocks(w, m.x, m.z)) { const c = cellIdx(w, m.x, m.z); if (w.crater[c] < 3) w.crater[c]++; }
    w.events.push({ e: 'impact', kind: SHELL_HE, x, z, bld: 0, r: BLAST1009 });
    if (w.rules?.morale) suppressBlast(w, x, z, SUB, spec.foot);
    list.splice(i, 1);   // 一格只炸一次
    for (const o of list) if (o.side === m.side && !o.seen && cheb(o.x, o.z, m.x, m.z) <= 1) reveal1009(w, o);   // 炸了一顆，整隊停下來找旁邊的
  }
}

// 存檔：eco.mine 只能沒有或 1；沒有就不能有 mines；有的話 sw 要是 2、不是喪屍防守；mines 版本 1、最多 48 筆、每筆六個整數在範圍內、同一方同一格不重複、每方不超過 24
export function mineOk(r: Record<string, unknown>): boolean {
  const e = r.eco as { mine?: unknown; sw?: unknown } | null | undefined, m = r.mines as { version?: unknown; cells?: unknown } | null | undefined, n = r.n as number;
  if (e && e.mine !== undefined && e.mine !== 1) return false;
  if (e?.mine !== 1) return m === undefined;
  if (e.sw !== 2 || r.zombies !== undefined) return false;
  if (m === undefined) return true;
  if (typeof m !== 'object' || m === null || Array.isArray(m) || m.version !== 1 || !Array.isArray(m.cells) || m.cells.length > CELLS1009) return false;
  const taken = new Set<number>(), count = [0, 0];
  for (const o of m.cells as unknown[]) {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return false;
    const { side, kind, x, z, left, seen } = o as Record<string, unknown>;
    if (![side, kind, x, z, left, seen].every(v => Number.isInteger(v))) return false;
    const s = side as number, k = kind as number, cx = x as number, cz = z as number, l = left as number;
    if ((s !== 0 && s !== 1) || !isKind(k) || cx < 0 || cz < 0 || cx >= n || cz >= n || l < 0 || l > MINES1009[k].lay || (seen !== 0 && seen !== 1)) return false;
    const key = (s * n + cz) * n + cx;
    if (taken.has(key)) return false;
    taken.add(key);
    if (++count[s] > MAX1009) return false;
  }
  return true;
}
