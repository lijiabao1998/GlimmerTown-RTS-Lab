// R090 更大的戰場：128×128 的海斯與皇家軍事運河（地圖 id 5；英格蘭東南海岸，1940 年 9 月——假設登陸真的發生）。
// 進攻方在左上（海灘），防守方在右下（丘陵）。運河沿反對角線、三格寬的泥地，每 12 格往內陸或往海錯開 2 格；五條公路過運河＝五座橋。
// 固定的部分（路、運河、地標）是格座標的純函式，守衛直接拿來比；填空的部分（田、溝、村裡的房子、農舍、植被）只在第 0 步、新的世界抽 World.rng。
// 地名只在地圖鍵與開局說明；建築上沒有字、沒有徽章，不寫入侵方的國籍、作戰代號或番號。
import { randInt } from './rng.ts';
import { ARMOUR_FORCE, SPAWN_CORNER } from './mapCommon.ts';
import { VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION, VEGETATION_MAX } from './vegetation.ts';
import {
  cellIdx, inGrid, center, cellOf, bldMaxHp, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY,
  TER_ROAD, TER_FIELD, TER_MUD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, BK_PILLBOX, BK_OAST, BK_WALL_STONE, type World,
} from './world.ts';

export const MAP_HYTHE = 5, HYTHE_N = 128;
const HN = HYTHE_N, C = SPAWN_CORNER;
export const inHytheSpawn = (x: number, z: number): boolean => (x < C && z < C) || (x >= HN - C && z >= HN - C);
export const canalZ = (x: number): number => HN - 3 - x + ((((x / 12) | 0) & 1) << 1);
export const isCanal = (x: number, z: number): boolean => z >= canalZ(x) && z <= canalZ(x) + 2;
const coast = (x: number, z: number) => x + z < 34;   // 海灘：不蓋房子（圓形砲塔除外），地形照樣是草和路
const TOWN = { lo: 40, hi: 88 } as const, STREETS = [40, 48, 56, 64, 72, 80, 88];
const town = (x: number, z: number) => x >= TOWN.lo && x <= TOWN.hi && z >= TOWN.lo && z <= TOWN.hi;

// 五條過運河的公路（0＝直的 x＝c、c+1；1＝橫的 z＝c、c+1）：博托夫橋、西海斯、海斯、海斯東、西布魯克
export const HYTHE_ROADS: readonly (readonly [number, number])[] = [[0, 20], [1, 86], [0, 64], [1, 40], [0, 106]];
// 路網（固定）：五條公路、出生角落接上來的斜路、海灘進鎮、丘陵接下來、丘陵上的路、鎮上的街（到運河就斷開）
export function isHytheRoad(x: number, z: number): boolean {
  if (!inGrid({ n: HN } as World, x, z)) return false;
  for (const [v, c] of HYTHE_ROADS) if (v === 0 ? x === c || x === c + 1 : z === c || z === c + 1) return true;
  if (x >= 6 && x <= 31 && (z === x || z === x - 1)) return true;                                // 左上角落斜接到海灘
  if (x >= HN - 32 && x <= HN - 7 && (z === x || z === x + 1)) return true;                        // 右下角落斜接到丘陵
  if (!isCanal(x, z) && ((z >= 30 && z <= 31 && x >= 30 && x <= 64) || (x >= 96 && x <= 97 && z >= 64 && z <= 96) || (z >= 110 && z <= 111 && x >= 22 && x <= 110))) return true;
  if (town(x, z) && !isCanal(x, z) && (STREETS.includes(x) || STREETS.includes(z))) return true;
  return false;
}
// 五座橋：每條公路在運河上的中心格
export const HYTHE_BRIDGES: readonly (readonly [number, number])[] = HYTHE_ROADS.map(([v, c]) => {
  if (v === 0) return [c, canalZ(c) + 1] as const;
  for (let x = 0; x < HN; x++) if (isCanal(x, c)) return [x + 1, c] as const;
  return [0, c] as const;
});

// 地標（固定；守衛逐項比對種類、位置、大小）：[種類, x, z, 寬, 深, 層]
// 圓形砲塔：1×1、2 層的石塔（BK_CHURCH，跟萊伊的 Ypres Tower 同一種畫法；真的圓塔另做美術）
export const MARTELLO: readonly (readonly [number, number])[] = [[3, 27], [9, 21], [27, 3]];   // 中間那座原本在 (14,16)：攻方出生角落的出口、正好在對角線上，等於替攻方基地加一座石塔（經典種子 1–40 逾時 22 → 16，見卡面）
// 看橋的碉堡：前四座橋，各一座在內陸那一頭、橋的 4 格以內（BK_PILLBOX 1×1）
export const HYTHE_PILLBOXES: readonly (readonly [number, number])[] = HYTHE_BRIDGES.slice(0, 4).map(([bx, bz]) => {
  for (let r = 2; r <= 4; r++) for (const [dx, dz] of [[r, r], [r - 1, r], [r, r - 1], [r + 1, r - 2], [r - 2, r + 1]]) {
    const x = bx + dx, z = bz + dz;
    if (!isHytheRoad(x, z) && !isCanal(x, z) && !coast(x, z) && x + z > bx + bz) return [x, z] as const;
  }
  return [bx + 3, bz + 3] as const;
});
export const HYTHE_LANDMARKS: readonly (readonly [number, number, number, number, number, number])[] = [
  ...MARTELLO.map(([x, z]) => [BK_CHURCH, x, z, 1, 1, 2] as const),
  ...HYTHE_PILLBOXES.map(([x, z]) => [BK_PILLBOX, x, z, 1, 1, 1] as const),
  [BK_CHURCH, 73, 65, 3, 3, 2],                                                                  // 聖李奧納德教堂（內陸那一邊的坡上）
  [BK_CHURCH, 30, 118, 2, 2, 3], [BK_CHURCH, 100, 76, 2, 2, 3],                                  // 林普恩、索爾特伍德的城堡主樓
  [BK_WALL_STONE, 28, 116, 2, 1, 1], [BK_WALL_STONE, 32, 116, 2, 1, 1], [BK_WALL_STONE, 28, 121, 2, 1, 1], [BK_WALL_STONE, 32, 121, 2, 1, 1],
  [BK_WALL_STONE, 98, 74, 2, 1, 1], [BK_WALL_STONE, 102, 74, 2, 1, 1], [BK_WALL_STONE, 98, 79, 2, 1, 1], [BK_WALL_STONE, 102, 79, 2, 1, 1],
  [BK_BARN, 52, 116, 3, 2, 1], [BK_BARN, 58, 116, 3, 2, 1], [BK_BARN, 67, 116, 3, 2, 1],        // 林普恩機場的機棚
];

export function applyHythe(w: World, vegetation?: number): void {
  if (w.tick !== 0 || w.map || w.sandbox || w.trenches?.segments.length || w.wires?.segments.length) return;
  const n = HN;
  w.n = n; w.ter = new Uint8Array(n * n); w.occ = new Int32Array(n * n); w.crater = new Uint8Array(n * n);
  w.blds = []; w.units = []; w.shells = []; w.winner = -1; delete w.vegetation;
  const at = (x: number, z: number) => cellIdx(w, x, z);
  const set = (x: number, z: number, t: number) => { if (inGrid(w, x, z)) w.ter[at(x, z)] = t; };
  // ---- 地形：羅姆尼沼澤的方田與排水溝（海側、西邊）→ 內陸與東邊的田 → 運河 → 路（路蓋過運河＝橋）----
  const fields: [number, number, number][] = [];
  for (let z = 8; z < n; z += 7) for (let x = 2; x < n; x += 8) {
    if (x + z >= n - 6 || x - z > -12 || coast(x, z)) continue;
    for (let dz = 0; dz < 6; dz++) for (let dx = 0; dx < 7; dx++) if (x + dx + z + dz < n - 6) set(x + dx, z + dz, TER_FIELD);
    for (let dx = -1; dx < 7; dx++) if (randInt(w, 4)) set(x + dx, z - 1, TER_MUD);
    fields.push([x, z, 7]);
  }
  for (let k = 0; k < 70; k++) {
    const fw = 5 + randInt(w, 7), fd = 4 + randInt(w, 6), x0 = 1 + randInt(w, n - fw - 2), z0 = 1 + randInt(w, n - fd - 2);
    if (town(x0, z0) || town(x0 + fw, z0 + fd) || coast(x0, z0) || (x0 - z0 < -12 && x0 + z0 < n)) continue;
    fields.push([x0, z0, fw]);
    for (let z = z0; z < z0 + fd; z++) for (let x = x0; x < x0 + fw; x++) set(x, z, TER_FIELD);
  }
  for (let x = 0; x < n; x++) for (let z = canalZ(x); z <= canalZ(x) + 2; z++) set(x, z, TER_MUD);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (isHytheRoad(x, z)) set(x, z, TER_ROAD);
  // ---- 房子 ----
  const place = (kind: number, x: number, z: number, bw: number, bd: number, floors: number): boolean => {
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) {
      const cx = x + dx, cz = z + dz;
      if (!inGrid(w, cx, cz) || inHytheSpawn(cx, cz)) return false;
      const t = w.ter[at(cx, cz)];
      if (w.occ[at(cx, cz)] || t === TER_ROAD || t === TER_MUD) return false;
    }
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[at(x + dx, z + dz)] = id;
    return true;
  };
  for (const [kind, x, z, bw, bd, floors] of HYTHE_LANDMARKS) place(kind, x, z, bw, bd, floors);   // 地標先放（守衛驗每一個都放得下）
  for (let iz = 0; iz < STREETS.length - 1; iz++) for (let ix = 0; ix < STREETS.length - 1; ix++) {   // 海斯鎮：逐街廓排連棟
    const x0 = STREETS[ix], x1 = STREETS[ix + 1], z0 = STREETS[iz], z1 = STREETS[iz + 1];
    for (const z of [z0 + 1, z1 - 2]) for (let x = x0 + 1; x < x1; ) {
      const bw = Math.min(1 + randInt(w, 2), x1 - x), central = x >= 52 && x <= 76 && z >= 52 && z <= 76;
      const r = randInt(w, 10), kind = central && r < 5 ? BK_SHOP : r < 8 ? BK_HOUSE : BK_COTTAGE;
      if (randInt(w, 100) < 92) place(kind, x, z, bw, 2, kind === BK_COTTAGE ? 1 : 2);
      x += bw;
    }
  }
  const isRoad = (x: number, z: number) => inGrid(w, x, z) && w.ter[at(x, z)] === TER_ROAD;
  // 小村：西海斯、博托夫橋、西布魯克、林普恩、索爾特伍德，內陸兩個
  for (const [cx, cz] of [[36, 80], [12, 100], [100, 18], [36, 112], [102, 92], [90, 112], [112, 60]]) {
    for (let z = cz - 6; z <= cz + 6; z++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (town(x, z) || coast(x, z) || (!isRoad(x - 1, z) && !isRoad(x + 1, z) && !isRoad(x, z - 1) && !isRoad(x, z + 1)) || randInt(w, 100) >= 62) continue;
      const r = randInt(w, 10), kind = r < 6 ? BK_COTTAGE : r < 8 ? BK_HOUSE : BK_BARN;
      const along = isRoad(x, z - 1) || isRoad(x, z + 1);
      place(kind, x, z, along ? 1 + randInt(w, 2) : 1, along ? 1 : 1 + randInt(w, 2), kind === BK_HOUSE ? 2 : 1);
    }
  }
  for (let k = 0; k < 70; k++) {   // 農舍、穀倉、內陸的啤酒花烘房
    const x = 2 + randInt(w, n - 5), z = 2 + randInt(w, n - 5);
    if (town(x - 2, z - 2) || town(x + 3, z + 3) || coast(x, z)) continue;
    const r = k % 5, oast = x + z > n + 4 && r === 0;
    place(oast ? BK_OAST : r < 2 ? BK_BARN : BK_COTTAGE, x, z, 2, r < 2 ? 2 : 1, oast ? 2 : 1);
  }
  // ---- 起手：每邊一支裝甲連（以 64×64 座標記，我方平移 n−64 到右下角落、敵方點對稱）----
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (const [kind, px, pz] of ARMOUR_FORCE) {
    const cx = side === SIDE_PLAYER ? px + n - 64 : 63 - px, cz = side === SIDE_PLAYER ? pz + n - 64 : 63 - pz;
    const k = UNIT_KINDS[kind], d = side === SIDE_PLAYER ? -SUB : SUB;
    w.units.push({ id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(k.armored ? { hullX: d, hullZ: d } : {}) });
  }
  if (vegetation === 1) {
    const cells = new Uint8Array(n * n); let count = 0;
    const units = new Set(w.units.map(u => at(cellOf(u.x), cellOf(u.z))));
    const put = (x: number, z: number, kind: number) => {
      if (!inGrid(w, x, z) || inHytheSpawn(x, z) || count >= VEGETATION_MAX) return;
      const c = at(x, z), t = w.ter[c];
      if (cells[c] || w.occ[c] || units.has(c) || t === TER_ROAD || t === TER_MUD) return;
      cells[c] = kind; count++;
    };
    for (const [x, z, width] of fields.slice(-10)) for (let dx = 0; dx < Math.min(width, 4); dx++) put(x + dx, z - 1, VEG_HEDGE);
    for (let k = 0; k < 6; k++) {   // 丘陵上的樹林
      const x = 2 + randInt(w, n - 5), z = 2 + randInt(w, n - 5);
      if (town(x, z) || x + z < n + 10) continue;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, z + dz, VEG_WOOD);
    }
    w.vegetation = { version: VEGETATION_VERSION, cells };
  }
  w.map = MAP_HYTHE;
}
