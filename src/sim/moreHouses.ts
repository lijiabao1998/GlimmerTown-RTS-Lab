// R087 更多房屋：新開的局（map 指令帶 more＝1）第 0 步套完地圖之後多放幾棟房子。
// 三種新房型（world.ts 的 BK_OAST、BK_MILL、BK_WAREHOUSE）就是普通的建築：照材質算耐久、能駐守、擋視線、被打塌；布陣表不收。
// 規矩：
// - 只在第 0 步、只跑一次（w.more 是開關也是記號）；沒帶 more 的局完全不經過這裡。
// - 不抽 World.rng：自己一條亂數（種子 w.seed ^ 0x52303837）；不讀 sym、規則、喪屍（頁面開局時它們還沒套）。
// - 只往後加建築；萊伊另外把 The Strand 河邊的三棟穀倉改成倉庫（id、佔地不動）。
// - 萊伊、丘陵是手排的表；村莊、64、96 成對放：每一棟都有點對稱的另一棟（(n−x−w, n−z−d)），兩邊都要放得下。
import { randInt, type RngState } from './rng.ts';
import {
  cellIdx, inGrid, cellOf, bldMaxHp, TER_ROAD, TER_MUD, TER_GRASS, TER_FIELD,
  BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_OAST, BK_MILL, BK_WAREHOUSE, type World,
} from './world.ts';
import { MAP_LARGE } from './largeMap.ts';
import { MAP_TOWN, TOWN_CENTRE } from './expandedMap.ts';
import { MAP_HILLS } from './hillMap.ts';

const MAP_RYE = 1;              // maps.ts 的 MAP_RYE（maps.ts 匯入這個檔，這裡不反過來匯入）
export const MORE_SEED = 0x52303837;   // 'R087'
export const MORE_EDGE = 2;     // 離地圖邊至少幾格
export const MORE_UNIT_GAP = 2; // 離每個單位（契比雪夫距離）至少幾格
export const MORE_MILL_GAP = 6; // 風車離教堂、別的風車至少幾格（高的地標會擋住後面）
export const MORE_OAST_NEAR = 4;   // 烘房離既有的穀倉或小屋最多幾格
export const MORE_RIVER_NEAR = 3;  // 倉庫離河（泥灘）最多幾格
export const MORE_ROAD_NEAR = 3;   // 填空的住宅與小屋離路最多幾格
export const MORE_HOME_NEAR = 2;   // 或離別的住家最多幾格（中間隔一格巷子）
export const moreCorner = (n: number): number => (n === 32 ? 10 : 12);   // 開局角落（不放房子）：32 圖 10×10（村莊、丘陵原本就留的）、64／96 圖 12×12
const TOWN_BOX: Record<number, [number, number]> = { [MAP_LARGE]: [19, 44], [MAP_TOWN]: [TOWN_CENTRE.lo, TOWN_CENTRE.hi] };   // 市鎮範圍（含兩端）

// 每一種要放的東西：種類、佔地（長邊、短邊；1×1 的兩個都是 1）、層數
export interface MoreSpec { kind: number; long: number; short: number; floors: number }
const MILL: MoreSpec = { kind: BK_MILL, long: 1, short: 1, floors: 3 };
const OAST: MoreSpec = { kind: BK_OAST, long: 2, short: 1, floors: 2 };
const HOUSE: MoreSpec = { kind: BK_HOUSE, long: 2, short: 1, floors: 2 };
const COTTAGE: MoreSpec = { kind: BK_COTTAGE, long: 1, short: 1, floors: 1 };
const QUAY: MoreSpec = { kind: BK_WAREHOUSE, long: 2, short: 2, floors: 3 };
// 成對放的清單（每一項放一對）。照順序放：先放地標（限制多的先挑）
export const MORE_PAIRS: Record<number, readonly MoreSpec[]> = {
  0: [MILL, OAST, HOUSE],
  [MAP_LARGE]: [MILL, OAST, OAST, HOUSE, HOUSE, COTTAGE],
  [MAP_TOWN]: [MILL, QUAY, QUAY, OAST, OAST, OAST, HOUSE, HOUSE, HOUSE, HOUSE, COTTAGE, COTTAGE],
};
// 萊伊（不對稱、手排）：河西岸草地上的風車；The Strand 那三棟穀倉改成倉庫
export const RYE_MILL: readonly [number, number] = [29, 10];
export const RYE_QUAYS: readonly [number, number][] = [[26, 10], [26, 12], [26, 17]];
// 丘陵（點對稱、手排）：一對風車、一對烘房；表裡是我方那一份（右下），另一份照 (n−x−w, n−z−d)
export const HILLS_MORE: readonly [MoreSpec, number, number, number, number][] = [
  [MILL, 24, 18, 1, 1],   // 右邊小丘的山腳（高度 1；對面那一份在左邊小丘旁）
  [OAST, 20, 24, 2, 1],   // 村子南邊的田、小屋旁（高度 0；不上稜線）
];

const put = (w: World, s: MoreSpec, x: number, z: number, bw: number, bd: number): void => {
  const id = w.blds.length + 1, maxHp = bldMaxHp(s.kind, bw, bd, s.floors);
  w.blds.push({ id, kind: s.kind, x, z, w: bw, d: bd, floors: s.floors, hp: maxHp, maxHp });
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = id;
};

// 這一格能不能放（不看種類的那幾條）：不上路、泥、植被、已佔的格；離邊 ≥ 2；四周一圈沒有建築；不進開局角落；離每個單位 ≥ 2 格
export function moreFits(w: World, x: number, z: number, bw: number, bd: number, near: Uint8Array): boolean {
  const n = w.n, c = moreCorner(n);
  if (x < MORE_EDGE || z < MORE_EDGE || x + bw > n - MORE_EDGE || z + bd > n - MORE_EDGE) return false;
  for (let dz = -1; dz <= bd; dz++) for (let dx = -1; dx <= bw; dx++) {
    const cx = x + dx, cz = z + dz, i = cellIdx(w, cx, cz);
    if (w.occ[i]) return false;
    if (near[i]) return false;   // 離單位太近（near 是把單位那一格往外擴一格的表）
    if (dx < 0 || dz < 0 || dx >= bw || dz >= bd) continue;
    const t = w.ter[i];
    if (t === TER_ROAD || t === TER_MUD || w.vegetation?.cells[i]) return false;
    if ((cx < c && cz < c) || (cx >= n - c && cz >= n - c)) return false;
  }
  return true;
}

// 單位那一格往外擴 MORE_UNIT_GAP−1 格：佔地或它四周那一圈碰到就是太近
export function unitNear(w: World): Uint8Array {
  const near = new Uint8Array(w.n * w.n), r = MORE_UNIT_GAP - 1;
  for (const u of w.units) if (u.alive) {
    const ux = cellOf(u.x), uz = cellOf(u.z);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inGrid(w, ux + dx, uz + dz)) near[cellIdx(w, ux + dx, uz + dz)] = 1;
  }
  return near;
}

// 兩個佔地之間的契比雪夫格距（貼著＝1，重疊＝0）
const gap = (ax: number, az: number, aw: number, ad: number, bx: number, bz: number, bw: number, bd: number): number =>
  Math.max(Math.max(ax - (bx + bw - 1), bx - (ax + aw - 1), 0), Math.max(az - (bz + bd - 1), bz - (az + ad - 1), 0));

// 種類自己的規矩要的「離某樣東西幾格以內」的表：把那樣東西往外擴 r 格（佔地的任一格落在表上＝契比雪夫格距 ≤ r）
export interface MoreGrids { farm: Uint8Array; home: Uint8Array; tall: Uint8Array; road: Uint8Array; mud: Uint8Array }
const mark = (w: World, g: Uint8Array, x0: number, z0: number, x1: number, z1: number, r: number): void => {
  const n = w.n;
  for (let z = Math.max(0, z0 - r); z <= Math.min(n - 1, z1 + r); z++) for (let x = Math.max(0, x0 - r); x <= Math.min(n - 1, x1 + r); x++) g[z * n + x] = 1;
};
export function moreGrids(w: World, ground?: Pick<MoreGrids, 'road' | 'mud'>): MoreGrids {
  const cells = w.n * w.n, farm = new Uint8Array(cells), home = new Uint8Array(cells), tall = new Uint8Array(cells);
  for (const b of w.blds) {
    const x1 = b.x + b.w - 1, z1 = b.z + b.d - 1;
    if (b.kind === BK_BARN || b.kind === BK_COTTAGE) mark(w, farm, b.x, b.z, x1, z1, MORE_OAST_NEAR);
    if (b.kind === BK_HOUSE || b.kind === BK_COTTAGE || b.kind === BK_SHOP) mark(w, home, b.x, b.z, x1, z1, MORE_HOME_NEAR);
    if (b.kind === BK_CHURCH || b.kind === BK_MILL) mark(w, tall, b.x, b.z, x1, z1, MORE_MILL_GAP - 1);
  }
  let road = ground?.road, mud = ground?.mud;
  if (!road || !mud) {
    road = new Uint8Array(cells); mud = new Uint8Array(cells);
    for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) {
      const t = w.ter[cellIdx(w, x, z)];
      if (t === TER_ROAD) mark(w, road, x, z, x, z, MORE_ROAD_NEAR); else if (t === TER_MUD) mark(w, mud, x, z, x, z, MORE_RIVER_NEAR);
    }
  }
  return { farm, home, tall, road, mud };
}

// 種類自己的規矩（g：moreGrids 的表；不給就現算）
// 風車：草地或田上；離教堂、別的風車至少 MORE_MILL_GAP 格。烘房：大地圖在市鎮外；離既有的穀倉或小屋 ≤ MORE_OAST_NEAR 格。
// 倉庫：市鎮裡、離河 ≤ MORE_RIVER_NEAR 格。填空的住宅與小屋：離路 ≤ MORE_ROAD_NEAR 格，或離別的住家 ≤ MORE_HOME_NEAR 格（村莊的路不對稱，貼著路的位置對面常常是路）
export function moreKindFits(w: World, s: MoreSpec, x: number, z: number, bw: number, bd: number, g: MoreGrids = moreGrids(w)): boolean {
  const box = TOWN_BOX[w.map ?? 0];
  let any = 0, inBox = 0, ground = 0;
  const on = (grid: Uint8Array) => { for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) if (grid[cellIdx(w, x + dx, z + dz)]) return true; return false; };
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) {
    const px = x + dx, pz = z + dz, t = w.ter[cellIdx(w, px, pz)];
    if (box && px >= box[0] && px <= box[1] && pz >= box[0] && pz <= box[1]) inBox++;
    if (t === TER_GRASS || t === TER_FIELD) ground++;
    any++;
  }
  if (s.kind === BK_MILL) return ground === any && !on(g.tall);
  if (s.kind === BK_OAST) return inBox === 0 && on(g.farm);
  if (s.kind === BK_WAREHOUSE) return inBox === any && on(g.mud);
  return on(g.road) || on(g.home);
}

// 放一對：列出所有放得下的位置（兩份都要放得下），用自己的亂數挑一個；第二份放不下就換下一個（最多 60 次）。
// 不用再查路通不通：擋路的只有建築，新房子四周一圈一定是空的、離地圖邊至少兩格，從它旁邊繞那一圈就過去了（守衛另外從兩邊的指揮部走一遍確認）。
function placePair(w: World, s: MoreSpec, rng: RngState, near: Uint8Array, ground: Pick<MoreGrids, 'road' | 'mud'>): boolean {
  const n = w.n, cand: [number, number, number, number][] = [], g = moreGrids(w, ground);
  // moreFits 的快版（同一套規矩）：兩張累加表，佔地加一圈裡有沒有建築或太近的單位、佔地裡有沒有路、泥、植被、開局角落，各一次查表
  const S = n + 1, ringSum = new Int32Array(S * S), innerSum = new Int32Array(S * S), c = moreCorner(n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = cellIdx(w, x, z), t = w.ter[i], o = (z + 1) * S + x + 1;
    const ringBad = w.occ[i] || near[i] ? 1 : 0;
    const innerBad = t === TER_ROAD || t === TER_MUD || w.vegetation?.cells[i] || (x < c && z < c) || (x >= n - c && z >= n - c) ? 1 : 0;
    ringSum[o] = ringBad + ringSum[o - S] + ringSum[o - 1] - ringSum[o - S - 1];
    innerSum[o] = innerBad + innerSum[o - S] + innerSum[o - 1] - innerSum[o - S - 1];
  }
  const rect = (t: Int32Array, x0: number, z0: number, x1: number, z1: number) => t[(z1 + 1) * S + x1 + 1] - t[z0 * S + x1 + 1] - t[(z1 + 1) * S + x0] + t[z0 * S + x0];   // 含兩端
  const fits = (x: number, z: number, bw: number, bd: number) => rect(ringSum, x - 1, z - 1, x + bw, z + bd) === 0 && rect(innerSum, x, z, x + bw - 1, z + bd - 1) === 0;
  const shapes: [number, number][] = s.long === s.short ? [[s.long, s.short]] : [[s.long, s.short], [s.short, s.long]];
  for (const [bw, bd] of shapes) for (let z = MORE_EDGE; z + bd <= n - MORE_EDGE; z++) for (let x = MORE_EDGE; x + bw <= n - MORE_EDGE; x++) {
    const px = n - x - bw, pz = n - z - bd;
    if (gap(x, z, bw, bd, px, pz, bw, bd) < 2) continue;   // 自己跟自己的另一份要隔一圈
    if (!fits(x, z, bw, bd) || !fits(px, pz, bw, bd)) continue;
    if (!moreKindFits(w, s, x, z, bw, bd, g) || !moreKindFits(w, s, px, pz, bw, bd, g)) continue;
    cand.push([x, z, bw, bd]);
  }
  for (let k = 0; k < 60 && cand.length; k++) {
    const i = randInt(rng, cand.length), [x, z, bw, bd] = cand[i];
    cand[i] = cand[cand.length - 1]; cand.pop();
    const before = w.blds.length;
    put(w, s, x, z, bw, bd);
    const px = n - x - bw, pz = n - z - bd;
    if (moreKindFits(w, s, px, pz, bw, bd, moreGrids(w, ground))) { put(w, s, px, pz, bw, bd); return true; }
    // 第二份放不下（第一份改變了它的條件，例如風車太近）：拿掉第一份
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = 0;
    w.blds.length = before;
  }
  return false;
}

export function applyMoreHouses(w: World): void {
  if (w.more || w.tick !== 0 || w.sandbox) return;
  w.more = 1;
  const map = w.map ?? 0;
  if (map === MAP_RYE) {
    for (const [x, z] of RYE_QUAYS) {
      const b = w.blds[w.occ[cellIdx(w, x, z)] - 1];
      if (!b || b.kind !== BK_BARN || b.x !== x || b.z !== z) continue;
      b.kind = BK_WAREHOUSE; b.floors = 3; b.maxHp = b.hp = bldMaxHp(BK_WAREHOUSE, b.w, b.d, 3);
    }
    if (moreFits(w, RYE_MILL[0], RYE_MILL[1], 1, 1, unitNear(w))) put(w, MILL, RYE_MILL[0], RYE_MILL[1], 1, 1);
    return;
  }
  if (map === MAP_HILLS) {
    const near = unitNear(w);
    for (const [s, x, z, bw, bd] of HILLS_MORE) {
      const px = w.n - x - bw, pz = w.n - z - bd;
      if (!moreFits(w, x, z, bw, bd, near) || !moreFits(w, px, pz, bw, bd, near)) continue;
      put(w, s, x, z, bw, bd); put(w, s, px, pz, bw, bd);
    }
    return;
  }
  const list = MORE_PAIRS[map];
  if (!list || (map === 0 && w.n !== 32)) return;
  const rng: RngState = { rng: (w.seed ^ MORE_SEED) >>> 0 }, near = unitNear(w);
  const ground = moreGrids(w);   // 路與河不會變：算一次
  for (const s of list) placePair(w, s, rng, near, ground);
}
