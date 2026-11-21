// R1010 炸橋與修橋：eco 帶 br＝1、sw＝2，地圖是萊伊或海斯的新局才有 w.br。帶 br 的局車輛和砲過不了河、運河，只能走橋（徒步照舊涉水）；
// 工兵用既有的射擊指令炸橋（R1002 的爆破）、修橋（R050 的工地規矩）；炸斷、修好都直接寫進 w.ter。沒有 w.br 的局，這裡一行都不會走到。
// 卡面：docs/tasks/R1010-炸橋與修橋.md。只用整數、不抽亂數。
// 跟 engineer1002.ts 互相 import（它要 reach1010、這邊要 DEMO_BLD）：只在函式裡用，模組最上層不讀對方的常數（載入順序一換就是 TDZ 錯誤）。
import { findPath } from './path.ts';
import { DEMO_BLD, DEMO_BLAST } from './engineer1002.ts';
import { isCanal, isHytheRoad, MAP_HYTHE, HYTHE_N } from './hytheMap.ts';
import { UNIT_KINDS, TER_MUD, TER_ROAD, ORD_IDLE, ORD_FIRE_AT, SHELL_HE, cellOf, center, blocks, waterAt, wireAt, type World, type Unit, type Building, type Span1010 } from './world.ts';

// 數字（每格；都是暫定，理由在卡面「數字」）
export const HP1010 = 40;       // 原橋的血：萊伊一座 80（兩包）、海斯 240（四包）
export const WOOD1010 = 10;     // 木橋的血：一包就斷
export const COST1010 = 5;      // 修橋補給：萊伊 10、海斯 30
export const WORK1010 = 200;    // 修橋工作量（工兵·步）：萊伊 400、海斯 1,200
export const SINK1010 = 10000;  // 斷的時候站在橋上的車輛、砲吃多少（不吃掩護：一定死）
export const FALL1010 = 20;     // 斷的時候站在橋上的徒步吃多少（同房子塌下來）

const RYE1010 = 1, RYE_N1010 = 32;   // 萊伊＝maps.ts 的 MAP_RYE（不 import maps.ts：它牽著整串地圖產生器）
// 萊伊的四塊河（抄 maps.ts 的 applyRye，含兩端 [x0, z0, x1, z1]）：Rother、Rock Channel、Tillingham、Tillingham 上游。守衛證明跟 applyRye 畫的一樣
export const RYE_RIVERS1010: readonly (readonly [number, number, number, number])[] = [[7, 9, 8, 31], [9, 7, 31, 8], [27, 9, 28, 20], [29, 19, 31, 20]];
// 萊伊路蓋過河的六格：Harbour Road 過 Rock Channel、A259 過 Tillingham、Cinque Ports Street 過 Rother
const RYE_DECKS1010: readonly (readonly [number, number])[] = [[24, 7], [24, 8], [27, 15], [28, 15], [7, 21], [8, 21]];

// 開放的地圖：1＝萊伊（32×32）、5＝海斯（128×128）；其他回 0
export const map1010 = (w: { map?: number; n: number }): number => (w.map === RYE1010 && w.n === RYE_N1010 ? RYE1010 : w.map === MAP_HYTHE && w.n === HYTHE_N ? MAP_HYTHE : 0);

// 這張圖的河道遮罩（座標的純函式）；不開放的地圖回 null
export function wet1010(w: { map?: number; n: number }): Uint8Array | null {
  const m = map1010(w), n = w.n;
  if (!m) return null;
  const wet = new Uint8Array(n * n);
  if (m === RYE1010) { for (const [x0, z0, x1, z1] of RYE_RIVERS1010) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) wet[z * n + x] = 1; }
  else for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (isCanal(x, z)) wet[z * n + x] = 1;
  return wet;
}

// 這張圖的橋：遮罩裡、地圖上是路的格，四方向相連的算一座；每座的格照索引排，橋照第一格的索引排
export function spans1010(w: { map?: number; n: number }): number[][] {
  const m = map1010(w), n = w.n, wet = wet1010(w);
  if (!m || !wet) return [];
  const deck = new Uint8Array(n * n);
  if (m === RYE1010) for (const [x, z] of RYE_DECKS1010) deck[z * n + x] = 1;
  else for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (wet[z * n + x] && isHytheRoad(x, z)) deck[z * n + x] = 1;
  const out: number[][] = [];
  for (let c = 0; c < n * n; c++) {
    if (deck[c] !== 1) continue;
    const cells: number[] = [], todo = [c];
    deck[c] = 2;
    while (todo.length) {
      const i = todo.pop()!, x = i % n, z = (i - x) / n;
      cells.push(i);
      const go = (nx: number, nz: number) => { if (nx >= 0 && nz >= 0 && nx < n && nz < n && deck[nz * n + nx] === 1) { deck[nz * n + nx] = 2; todo.push(nz * n + nx); } };
      go(x + 1, z); go(x - 1, z); go(x, z + 1); go(x, z - 1);
    }
    out.push(cells.sort((a, b) => a - b));
  }
  return out;
}

// startEco 最後（eco.ts）：br＝1、sw＝2、不是喪屍防守、不是沙盒、地圖是萊伊或海斯才建；每座橋完好
export function start1010(w: World): void {
  if (w.br || w.zombies || w.sandbox || w.eco?.sw !== 2) return;
  const wet = wet1010(w);
  if (!wet) return;
  w.br = { version: 1, wet, spans: spans1010(w).map(cells => ({ cells, state: 0, hp: HP1010 * cells.length, left: 0 })) };
}

// 那一格屬於哪一座橋（−1＝不是橋）
export function span1010At(w: World, x: number, z: number): number {
  if (!w.br || !Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= w.n || z >= w.n) return -1;
  const c = z * w.n + x;
  return w.br.spans.findIndex(s => s.cells.includes(c));
}
// 射擊指令那一格是不是「橋的工作」：是橋格、而且那一格沒有還站著的建築、沒有還沒壞的鐵絲網（有的話照 R1002 炸房子、剪網）
export function job1010(w: World, x: number, z: number): number {
  const si = span1010At(w, x, z);
  return si < 0 || blocks(w, x, z) || (wireAt(w, x, z)?.hp ?? 0) > 0 ? -1 : si;
}

// 挨著：工兵那一格跟這座橋任一格的八方向距離 ≤ 1
export function near1010(w: World, u: Unit, s: Span1010): boolean {
  const ux = cellOf(u.x), uz = cellOf(u.z), n = w.n;
  return s.cells.some(c => { const x = c % n, z = (c - x) / n; return x - ux <= 1 && ux - x <= 1 && z - uz <= 1 && uz - z <= 1; });
}

// engineer1002.ts 的 reach1002 開頭問：目標是橋＝挨著那座橋就算到了；不是橋回 undefined（照 R1002）
export function reach1010(w: World, u: Unit): boolean | undefined {
  const si = job1010(w, u.tx, u.tz);
  return si < 0 ? undefined : near1010(w, u, w.br!.spans[si]);
}

// 車走得通的四方向廣度搜尋：從 a 外面一圈走得通的格開始，走到 b 外面一圈任一格就算開得到。擋：還站著的建築、水格、skip 那一座橋的格
let SEEN = new Uint8Array(0), Q = new Int32Array(0);   // 模擬是單執行緒、不會重入：重複用同一份
function drive1010(w: World, a: Building, b: Building, skip: number): boolean {
  const n = w.n, K = n * n, cut = skip >= 0 ? w.br!.spans[skip].cells : [];
  if (SEEN.length !== K) { SEEN = new Uint8Array(K); Q = new Int32Array(K); }
  SEEN.fill(0);
  let head = 0, tail = 0;
  const visit = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= n || z >= n) return;
    const c = z * n + x;
    if (SEEN[c] || blocks(w, x, z) || waterAt(w, x, z) || cut.includes(c)) return;
    SEEN[c] = 1; Q[tail++] = c;
  };
  for (let z = a.z - 1; z <= a.z + a.d; z++) for (let x = a.x - 1; x <= a.x + a.w; x++) visit(x, z);
  while (head < tail) {
    const c = Q[head++], x = c % n, z = (c - x) / n;
    if (x >= b.x - 1 && x <= b.x + b.w && z >= b.z - 1 && z <= b.z + b.d) return true;   // b 本身擋路，框裡走得通的就是外面那一圈
    visit(x + 1, z); visit(x - 1, z); visit(x, z + 1); visit(x, z - 1);
  }
  return false;
}
const hq1010 = (w: World, side: number): Building | null => { const id = w.eco?.hq[side] ?? 0, b = id ? w.blds[id - 1] : null; return b && b.hp > 0 ? b : null; };
// 兩個指揮部之間車連不連得上（守衛把開局時的結果印出來；卡面風險 6）；指揮部倒了回 false
export const linked1010 = (w: World): boolean => { const a = hq1010(w, 0), b = hq1010(w, 1); return !!a && !!b && drive1010(w, a, b, -1); };
// 「最後一座車過得去的橋」：兩邊的指揮部之間，車原本開得到、這座橋斷了就開不到。原本就開不到、指揮部倒了＝不管（false）
export function cuts1010(w: World, si: number): boolean {
  const a = hq1010(w, 0), b = hq1010(w, 1);
  if (!a || !b || drive1010(w, a, b, si)) return false;
  return drive1010(w, a, b, -1);
}

// 這一方的工兵能不能對這座橋下手：'' 可以；不然回原因（介面與模擬共用）。完好的橋、木橋＝炸；斷橋＝修
export function why1010(w: World, side: number, si: number): string {
  const s = w.br?.spans[si];
  if (!s || !w.eco || (side !== 0 && side !== 1)) return '本局未開放';
  if (s.state !== 1) return cuts1010(w, si) ? '這是兩邊之間最後一座車過得去的橋，不能炸' : '';
  for (const c of s.cells) if (blocks(w, c % w.n, (c - (c % w.n)) / w.n)) return '斷橋上有東西擋著';
  const cost = COST1010 * s.cells.length;
  return !s.left && w.eco.supply[side] < cost ? `補給不足，還差 ${cost - w.eco.supply[side]}` : '';
}

// applyCommand 的 fireAt 對工兵（step.ts 在 fireAt1002 前面問）：那一格是橋的工作就回 true（接或不接都是這裡決定），不是就回 false（照 R1002）。
// 接：炸＝倒數保持在至少一包（同 R1002）；修＝這座還沒人開工時第一個接的那一方付錢、記下工作量。路直接走向那一格，挨著就停
export function fireAt1010(w: World, u: Unit, gx: number, gz: number): boolean {
  const si = job1010(w, gx, gz);
  if (si < 0) return false;
  if (why1010(w, u.side, si) !== '') return true;   // 不接：指令、路、倒數都不變
  const s = w.br!.spans[si];
  if (s.state === 1 && !s.left) { w.eco!.supply[u.side] -= COST1010 * s.cells.length; s.left = WORK1010 * s.cells.length; }
  u.order = ORD_FIRE_AT; u.tx = gx; u.tz = gz; u.target = 0;
  if (s.state !== 1) u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].demo ?? 0);
  u.path = near1010(w, u, s) ? [] : findPath(w, cellOf(u.x), cellOf(u.z), gx, gz, 0, 0, u.kind); u.pathIdx = 0;
  return true;
}

// 拿著打這座橋的射擊指令的工兵（兩方都算）回待命
function stop1010(w: World, si: number): void {
  for (const t of w.units) if (t.alive && t.order === ORD_FIRE_AT && UNIT_KINDS[t.kind].demo && job1010(w, t.tx, t.tz) === si) { t.order = ORD_IDLE; t.path = []; t.pathIdx = 0; }
}

// fireUnit 對拿著射擊指令的工兵（step.ts 在 demo1002 前面問）：目標是橋的工作就做（回 true），不是回 false（照 R1002）。
// 修：同 R050 的蓋工地（挨著、沒在走，每一步做 1；被壓制不變慢，潰退的 fireUnit 前面就擋了）。
// 炸：同 R1002（還沒挨著或還在走＝倒數保持在至少一包；倒數到 0 放一包、扣 DEMO_BLD、出一個小爆炸事件）；會炸斷的那一包放之前再查一次「最後一座」
export function work1010(w: World, u: Unit, hurt: (t: Unit, dmg: number) => void): boolean {
  const si = job1010(w, u.tx, u.tz);
  if (si < 0) return false;
  const s = w.br!.spans[si], need = UNIT_KINDS[u.kind].demo ?? 0;
  if (s.state === 1) {
    if (!s.left) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return true; }   // 沒人付過錢（舊的、偽造的狀態）：不修
    if (u.pathIdx < u.path.length || !near1010(w, u, s)) return true;
    s.left--;
    if (s.left === 0) fix1010(w, si);
    return true;
  }
  if (u.pathIdx < u.path.length || !near1010(w, u, s)) { if (u.cooldown < need) u.cooldown = need; return true; }
  const ax = center(u.tx) - u.x, az = center(u.tz) - u.z;
  if (ax || az) { u.aimX = ax; u.aimZ = az; }
  if (u.cooldown > 0) return true;
  if (s.hp <= DEMO_BLD && cuts1010(w, si)) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return true; }   // 最後一包不放、血停在原值
  u.cooldown = need;
  s.hp = Math.max(0, s.hp - DEMO_BLD);
  w.events.push({ e: 'impact', kind: SHELL_HE, x: center(u.tx), z: center(u.tz), bld: 0, r: DEMO_BLAST });
  if (s.hp === 0) blow1010(w, si, hurt);
  return true;
}

// 斷的那一步：地形寫成泥；橋上的車輛、砲沉下去，徒步的吃 20（車上的人之後照 R092 的 carry92 跳車）；每格一個高爆落地事件（畫面把地面重畫成泥）；
// 打這座橋的工兵回待命；路上還要經過這幾格的車（照 id）重新找路，終點不變（寫法照 R1004 的 repath50）
function blow1010(w: World, si: number, hurt: (t: Unit, dmg: number) => void): void {
  const s = w.br!.spans[si], n = w.n;
  for (const c of s.cells) w.ter[c] = TER_MUD;
  s.state = 1; s.hp = 0; s.left = 0;
  for (const t of w.units) if (t.alive && !t.ride && s.cells.includes(cellOf(t.z) * n + cellOf(t.x))) hurt(t, UNIT_KINDS[t.kind].radius > 0 ? SINK1010 : FALL1010);
  for (const c of s.cells) { const x = c % n; w.events.push({ e: 'impact', kind: SHELL_HE, x: center(x), z: center((c - x) / n), bld: 0, r: DEMO_BLAST }); }
  w.events.push({ e: 'bridge', span: si });
  stop1010(w, si);
  for (const t of w.units) {
    if (!t.alive || t.ride || t.towBy || UNIT_KINDS[t.kind].radius <= 0 || t.pathIdx >= t.path.length) continue;
    let crosses = false;
    for (let i = t.pathIdx; i < t.path.length && !crosses; i++) crosses = s.cells.includes(t.path[i]);
    if (!crosses) continue;
    const end = t.path[t.path.length - 1], gx = end % n;
    t.path = findPath(w, cellOf(t.x), cellOf(t.z), gx, (end - gx) / n, 0, 0, t.kind); t.pathIdx = 0;
  }
}

// 修好：地形寫回路；變成木橋（每格 10 血）；修的工兵回待命（剛修好的人不會接著把它炸掉）
function fix1010(w: World, si: number): void {
  const s = w.br!.spans[si];
  for (const c of s.cells) w.ter[c] = TER_ROAD;
  s.state = 2; s.hp = WOOD1010 * s.cells.length; s.left = 0;
  stop1010(w, si);
  w.events.push({ e: 'bridge', span: si });
}

// step.ts 的 freeAt（只有車輛用：stepVehicle、separate）：從 (fx, fz) 走到 (x, z)（位置單位）。目的那一格不是水格；
// 斜著跨格（兩個格座標都變）時兩個正交的鄰格也都不是水格——跟 findPath 的不切角同一條（河道有只在角上相接的地方，推擠一步就斜著過河）
export function dry1010(w: World, fx: number, fz: number, x: number, z: number): boolean {
  const ax = cellOf(fx), az = cellOf(fz), bx = cellOf(x), bz = cellOf(z);
  if (waterAt(w, bx, bz)) return false;
  return ax === bx || az === bz || (!waterAt(w, bx, az) && !waterAt(w, ax, bz));
}

// 存檔（worldCodec.ts）：有 br 就要 sw＝2、不是喪屍、不是沙盒、地圖是萊伊或海斯；遮罩跟那張圖重算的一模一樣；橋的個數、格子一樣；
// state 只有 0、1、2，血與工作量在範圍裡；ter：斷橋的格是泥、完好與木橋的格是路、遮罩裡不是橋的格是泥。合格回傳整理好的 br，不合格回 null
export function brOk1010(r: Record<string, unknown>, ter: Uint8Array, wet: Uint8Array, raw: unknown): World['br'] | null {
  const e = r.eco as { sw?: unknown } | undefined, n = r.n as number, o = raw as { version?: unknown; spans?: unknown } | null;
  if (e?.sw !== 2 || r.zombies !== undefined || r.sandbox !== undefined) return null;
  const like = { map: r.map as number | undefined, n }, want = wet1010(like);
  if (!want || want.length !== wet.length || !want.every((v, i) => v === wet[i])) return null;
  if (typeof o !== 'object' || o === null || o.version !== 1 || !Array.isArray(o.spans)) return null;
  const canon = spans1010(like), raws = o.spans as unknown[];
  if (raws.length !== canon.length) return null;
  const deck = new Uint8Array(n * n), spans: Span1010[] = [];
  for (let k = 0; k < canon.length; k++) {
    const s = raws[k] as { cells?: unknown; state?: unknown; hp?: unknown; left?: unknown } | null;
    if (typeof s !== 'object' || s === null || !Array.isArray(s.cells) || s.cells.length !== canon[k].length || !canon[k].every((c, i) => (s.cells as unknown[])[i] === c)) return null;
    const { state, hp, left } = s, m = canon[k].length;
    if (!Number.isInteger(state) || !Number.isInteger(hp) || !Number.isInteger(left)) return null;
    const st = state as number, h = hp as number, l = left as number;
    if (st === 0 ? h < 1 || h > HP1010 * m || l !== 0 : st === 1 ? h !== 0 || l < 0 || l > WORK1010 * m : st === 2 ? h < 1 || h > WOOD1010 * m || l !== 0 : true) return null;
    for (const c of canon[k]) { if (ter[c] !== (st === 1 ? TER_MUD : TER_ROAD)) return null; deck[c] = 1; }
    spans.push({ cells: [...canon[k]], state: st, hp: h, left: l });
  }
  for (let c = 0; c < n * n; c++) if (wet[c] && !deck[c] && ter[c] !== TER_MUD) return null;
  return { version: 1, wet, spans };
}
