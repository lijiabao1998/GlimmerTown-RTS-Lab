// R043 大地圖：64×64 的英格蘭東南鄉間。只在第 0 步由 map 指令（id 2）套用；只抽 World.rng，同種子同圖。
// 中間一座有河穿過的市鎮（十字大街在河上交會、教堂廣場、環鎮小路、沿街房子與連棟），河兩岸各一個小村、零散農舍；
// 河從東北斜到西南、兩格寬，路蓋過河＝橋（十字大街、兩條村路各一座）。雙方出生角落（我方右下、敵方左上）各留 12×12 不蓋房子。
// 雙方起手兵力對稱（點對稱）：中坦克 6、輕坦克 2、重坦克 2、榴彈砲 3、觀測員 2；單位 id 從 1 起，我方 1–15、敵方 16–30。
import { randInt } from './rng.ts';
import { VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION, VEGETATION_MAX } from './vegetation.ts';
import {
  cellIdx, inGrid, center, cellOf, bldMaxHp, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY,
  TER_GRASS, TER_ROAD, TER_FIELD, TER_MUD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_LIGHT, UK_HEAVY, type World,
} from './world.ts';

export const MAP_LARGE = 2;
export const LARGE_N = 64;
export const LARGE_POP = 40;      // 大地圖有指揮部時，每方同時活著的上限（一般 16）
export const LARGE_CORNER = 12;   // 出生角落邊長（不蓋房子、不長植被）
const TOWN_LO = 19, TOWN_HI = 44;  // 市鎮範圍（含兩端）

// 我方起手（格）；敵方是點對稱 (63−x, 63−z)。順序就是 id 順序。
export const LARGE_FORCE: [number, number, number][] = [
  [UK_TANK, 52, 56], [UK_TANK, 54, 54], [UK_TANK, 56, 52], [UK_TANK, 53, 59], [UK_TANK, 59, 53], [UK_TANK, 56, 56],
  [UK_LIGHT, 52, 61], [UK_LIGHT, 61, 52],
  [UK_HEAVY, 55, 58], [UK_HEAVY, 58, 55],
  [UK_HOWITZER, 60, 60], [UK_HOWITZER, 62, 57], [UK_HOWITZER, 57, 62],
  [UK_OBSERVER, 53, 52], [UK_OBSERVER, 52, 53],
];

export const inSpawnCorner = (x: number, z: number): boolean =>
  (x < LARGE_CORNER && z < LARGE_CORNER) || (x >= LARGE_N - LARGE_CORNER && z >= LARGE_N - LARGE_CORNER);

export function applyLarge(w: World, vegetation?: number): void {
  if (w.tick !== 0 || w.map || w.sandbox || w.trenches?.segments.length || w.wires?.segments.length) return;
  const n = LARGE_N;
  w.n = n; w.ter = new Uint8Array(n * n); w.occ = new Int32Array(n * n); w.crater = new Uint8Array(n * n);
  w.blds = []; w.units = []; w.shells = []; w.winner = -1;
  delete w.vegetation;
  const at = (x: number, z: number) => cellIdx(w, x, z);
  const setTer = (t: number, x: number, z: number) => { if (inGrid(w, x, z)) w.ter[at(x, z)] = t; };

  // ---- 地形：田 → 河 → 路（路蓋過河＝橋）----
  const fields: [number, number, number, number][] = [];
  for (let k = 0; k < 14; k++) {
    const fw = 4 + randInt(w, 5), fd = 3 + randInt(w, 4), fx = randInt(w, n - fw), fz = randInt(w, n - fd);
    if (fx + fw > TOWN_LO - 1 && fx < TOWN_HI + 2 && fz + fd > TOWN_LO - 1 && fz < TOWN_HI + 2) continue;   // 不進市鎮
    fields.push([fx, fz, fw, fd]);
    for (let z = fz; z < fz + fd; z++) for (let x = fx; x < fx + fw; x++) setTer(TER_FIELD, x, z);
  }
  // 河：沿反對角線 x+z≈62，兩格寬，每兩欄左右擺一格（最多 ±3），欄與欄之間補滿，泥灘連成一條
  let off = 0, prevTop = -1;
  for (let x = 0; x < n; x++) {
    if (x % 2 === 0) off = Math.max(-3, Math.min(3, off + randInt(w, 3) - 1));
    const z0 = 62 - x + off, z1 = Math.max(z0 + 1, prevTop);
    for (let z = z0; z <= z1; z++) setTer(TER_MUD, x, z);
    prevTop = z0 + 1;
  }
  const road = (x0: number, z0: number, x1: number, z1: number) => {   // 含兩端的長方形
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) setTer(TER_ROAD, x, z);
  };
  road(0, 31, n - 1, 32);                  // 東西大街（市鎮中央過河）
  road(31, 0, 32, n - 1);                  // 南北大街
  road(22, 22, 41, 22); road(22, 41, 41, 41); road(22, 22, 22, 41); road(41, 22, 41, 41);   // 環鎮小路
  for (let k = 0; k <= 16; k++) { road(5 + k, 5 + k, 6 + k, 5 + k); road(57 - k, 58 - k, 58 - k, 58 - k); }   // 兩邊出生角落往鎮上的斜路
  road(44, 4, 44, 30); road(36, 8, 56, 8);    // 東北的村子：村路往南過河接大街
  road(19, 33, 19, 59); road(7, 55, 27, 55);  // 西南的村子（點對稱）

  // ---- 房子 ----
  const free = (x: number, z: number, bw: number, bd: number) => {   // 不上路、不上泥灘、不進出生角落；跟別的建築至少隔一格
    for (let dz = -1; dz <= bd; dz++) for (let dx = -1; dx <= bw; dx++) {
      const cx = x + dx, cz = z + dz, inner = dx >= 0 && dz >= 0 && dx < bw && dz < bd;
      if (!inGrid(w, cx, cz)) { if (inner) return false; continue; }
      const t = w.ter[at(cx, cz)];
      if (inner && (t === TER_ROAD || t === TER_MUD || inSpawnCorner(cx, cz))) return false;
      if (w.occ[at(cx, cz)]) return false;
    }
    return true;
  };
  const place = (kind: number, x: number, z: number, bw: number, bd: number, floors: number): boolean => {
    if (!free(x, z, bw, bd)) return false;
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[at(x + dx, z + dz)] = id;
    return true;
  };
  const isRoad = (x: number, z: number) => inGrid(w, x, z) && w.ter[at(x, z)] === TER_ROAD;
  // 沿路蓋：路邊那一格開始往遠離路的方向長；主街兩旁多是兩層的店與連棟（寬 3–4）
  const alongRoads = (x0: number, z0: number, x1: number, z1: number, pct: number, town: boolean) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (!inGrid(w, x, z) || w.ter[at(x, z)] !== TER_GRASS && w.ter[at(x, z)] !== TER_FIELD) continue;
      const rN = isRoad(x, z - 1), rS = isRoad(x, z + 1), rW = isRoad(x - 1, z), rE = isRoad(x + 1, z);
      if (!rN && !rS && !rW && !rE) continue;
      if (randInt(w, 100) >= pct) continue;
      const main = town && (Math.abs(2 * x - 63) <= 3 || Math.abs(2 * z - 63) <= 3 || x === 30 || x === 33 || z === 30 || z === 33);
      const r = randInt(w, 10);
      const kind = !town ? (r < 6 ? BK_COTTAGE : r < 8 ? BK_HOUSE : BK_BARN) : main ? (r < 6 ? BK_SHOP : BK_HOUSE) : (r < 6 ? BK_HOUSE : r < 8 ? BK_COTTAGE : BK_SHOP);
      const long = 1 + (town ? 1 + randInt(w, 3) : randInt(w, 2)), deep = kind === BK_BARN ? 2 : 1 + randInt(w, 2);
      const along = rN || rS;   // 路在南北邊：房子沿東西向排開
      const bw = kind === BK_BARN ? 2 : along ? long : deep, bd = kind === BK_BARN ? 2 : along ? deep : long;
      const ox = rE && !rW ? x - bw + 1 : x, oz = rS && !rN ? z - bd + 1 : z;
      const floors = kind === BK_COTTAGE || kind === BK_BARN ? 1 : town ? 2 : 1 + randInt(w, 2);
      place(kind, ox, oz, bw, bd, floors);
    }
  };
  // 教堂廣場（西北岸）與市集會堂（東南岸），點對稱
  road(24, 24, 29, 24); road(24, 24, 24, 29);
  place(BK_CHURCH, 25, 25, 3, 3, 2);
  road(34, 39, 39, 39); road(39, 34, 39, 39);
  place(BK_SHOP, 35, 36, 3, 2, 2);
  alongRoads(TOWN_LO, TOWN_LO, TOWN_HI, TOWN_HI, 80, true); alongRoads(TOWN_LO, TOWN_LO, TOWN_HI, TOWN_HI, 70, true);   // 第二輪補空出來的臨街
  // 兩個小村：各一座小教堂塔、沿村路的農舍
  place(BK_CHURCH, 46, 10, 1, 1, 2); place(BK_CHURCH, 17, 53, 1, 1, 2);
  alongRoads(36, 3, 56, 14, 55, false); alongRoads(7, 49, 27, 60, 55, false);
  // 零散農舍：田邊、鎮外
  for (let k = 0; k < 16; k++) {
    const x = 1 + randInt(w, n - 3), z = 1 + randInt(w, n - 3);
    if (x >= TOWN_LO - 2 && x <= TOWN_HI + 2 && z >= TOWN_LO - 2 && z <= TOWN_HI + 2) continue;
    if (k % 3 === 0) place(BK_BARN, x, z, 2, 2, 1); else place(BK_COTTAGE, x, z, 1 + (k & 1), 1, 1);
  }

  // ---- 單位：雙方點對稱 ----
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (const [kind, px, pz] of LARGE_FORCE) {
    const cx = side === SIDE_PLAYER ? px : n - 1 - px, cz = side === SIDE_PLAYER ? pz : n - 1 - pz, k = UNIT_KINDS[kind];
    const d = side === SIDE_PLAYER ? -SUB : SUB;
    w.units.push({ id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(k.armored ? { hullX: d, hullZ: d } : {}) });
  }

  // ---- 植被（R116 的格子與規則；只在明確要求時長）：田邊的樹籬、鄉間小樹林，總數不超過 VEGETATION_MAX ----
  if (vegetation === 1) {
    const cells = new Uint8Array(n * n), unitCells = new Set(w.units.map(u => at(cellOf(u.x), cellOf(u.z))));
    let count = 0;
    const put = (x: number, z: number, kind: number) => {
      if (count >= VEGETATION_MAX || !inGrid(w, x, z)) return;
      const c = at(x, z), t = w.ter[c];
      if (cells[c] || w.occ[c] || unitCells.has(c) || t === TER_ROAD || t === TER_MUD || inSpawnCorner(x, z)) return;
      cells[c] = kind; count++;
    };
    for (const [fx, fz, fw] of fields.slice(0, 8)) for (let dx = 0; dx < Math.min(fw, 4); dx++) put(fx + dx, fz - 1, VEG_HEDGE);
    for (let k = 0; k < 6 && count < VEGETATION_MAX; k++) {
      const x = 2 + randInt(w, n - 5), z = 2 + randInt(w, n - 5);
      if (x >= TOWN_LO - 1 && x <= TOWN_HI + 1 && z >= TOWN_LO - 1 && z <= TOWN_HI + 1) continue;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, z + dz, VEG_WOOD);
    }
    w.vegetation = { version: VEGETATION_VERSION, cells };
  }
  w.map = MAP_LARGE;
}
