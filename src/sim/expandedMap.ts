// R130：新 96×96 河鎮，獨立生成；不改 R026／R043 的亂數順序或資料。
import { randInt } from './rng.ts';
import { ARMOUR_FORCE, SPAWN_CORNER } from './mapCommon.ts';
import { VEG_HEDGE, VEG_WOOD, VEGETATION_VERSION, VEGETATION_MAX } from './vegetation.ts';
import {
  cellIdx, inGrid, center, cellOf, bldMaxHp, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY,
  TER_ROAD, TER_FIELD, TER_MUD, BK_HOUSE, BK_COTTAGE, BK_BARN, BK_CHURCH, BK_SHOP, type World,
} from './world.ts';

export const MAP_TOWN = 3, TOWN_N = 96;
export const TOWN_CENTRE = { lo: 24, hi: 71 } as const;
export const TOWN_VILLAGES = [[18, 18], [76, 22], [16, 60]] as const;
export const inTownSpawn = (x: number, z: number): boolean =>
  (x < SPAWN_CORNER && z < SPAWN_CORNER) || (x >= TOWN_N - SPAWN_CORNER && z >= TOWN_N - SPAWN_CORNER);

export function applyExpandedTown(w: World, vegetation?: number): void {
  if (w.tick !== 0 || w.map || w.sandbox || w.trenches?.segments.length || w.wires?.segments.length) return;
  const n = TOWN_N;
  w.n = n; w.ter = new Uint8Array(n * n); w.occ = new Int32Array(n * n); w.crater = new Uint8Array(n * n);
  w.blds = []; w.units = []; w.shells = []; w.winner = -1; delete w.vegetation;
  const at = (x: number, z: number) => cellIdx(w, x, z);
  const set = (x: number, z: number, t: number) => { if (inGrid(w, x, z)) w.ter[at(x, z)] = t; };
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) set(x, z, TER_ROAD);
  };
  const town = (x: number, z: number) => x >= 24 && x <= 71 && z >= 24 && z <= 71;
  const fields: [number, number, number][] = [];
  for (let k = 0; k < 60; k++) {
    const fw = 5 + randInt(w, 6), fd = 4 + randInt(w, 5), x0 = 1 + randInt(w, n - fw - 2), z0 = 1 + randInt(w, n - fd - 2);
    if (town(x0, z0) || town(x0 + fw, z0 + fd)) continue;
    fields.push([x0, z0, fw]);
    for (let z = z0; z < z0 + fd; z++) for (let x = x0; x < x0 + fw; x++) set(x, z, TER_FIELD);
  }
  let off = 0, prior = -1;
  for (let x = 0; x < n; x++) {
    if (x % 3 === 0) off = Math.max(-3, Math.min(3, off + randInt(w, 3) - 1));
    const z0 = n - 2 - x + off;
    for (let z = z0; z <= Math.max(z0 + 1, prior); z++) set(x, z, TER_MUD);
    prior = z0 + 1;
  }
  road(0, 47, n - 1, 48); road(47, 0, 48, n - 1);
  // 六條市街圍成街廓，兩條主幹道較寬；空出的後院也是通路。
  const streets = [27, 35, 43, 51, 59, 67];
  for (const c of streets) { road(c, 24, c, 71); road(24, c, 71, c); }
  for (let k = 5; k <= 27; k++) { road(k, k, k + 1, k); road(n - 2 - k, n - 1 - k, n - 1 - k, n - 1 - k); }
  for (const [cx, cz] of TOWN_VILLAGES) {
    road(cx - 8, cz, cx + 8, cz); road(cx + 1, cz - 7, cx + 1, cz + 7);
    if (cx < 24) road(cx + 1, cz, cx + 1, 48); else road(48, cz, cx, cz);
  }
  road(36, 36, 41, 36); road(55, 57, 58, 57); // 教堂前院與市集通道
  const place = (kind: number, x: number, z: number, bw: number, bd: number, floors: number): boolean => {
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) {
      const cx = x + dx, cz = z + dz;
      if (!inGrid(w, cx, cz) || inTownSpawn(cx, cz)) return false;
      const t = w.ter[at(cx, cz)];
      if (w.occ[at(cx, cz)] || t === TER_ROAD || t === TER_MUD) return false;
    }
    const id = w.blds.length + 1, maxHp = bldMaxHp(kind, bw, bd, floors);
    w.blds.push({ id, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp });
    for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[at(x + dx, z + dz)] = id;
    return true;
  };
  place(BK_CHURCH, 37, 38, 3, 3, 2); place(BK_SHOP, 55, 55, 3, 2, 2);
  // 逐街廓排連棟，前後兩排之間留後巷；主街店面多、外圈混入農舍。
  for (let iz = 0; iz < streets.length - 1; iz++) for (let ix = 0; ix < streets.length - 1; ix++) {
    const x0 = streets[ix], x1 = streets[ix + 1], z0 = streets[iz], z1 = streets[iz + 1];
    for (const z of [z0 + 1, z1 - 2]) for (let x = x0 + 1; x < x1; ) {
      const bw = Math.min(1 + randInt(w, 2), x1 - x), central = x >= 35 && x <= 59 && z >= 35 && z <= 59;
      const r = randInt(w, 10), kind = central && r < 5 ? BK_SHOP : r < 8 ? BK_HOUSE : BK_COTTAGE;
      if (randInt(w, 100) < 92) place(kind, x, z, bw, 2, kind === BK_COTTAGE ? 1 : 2);
      x += bw;
    }
  }
  const isRoad = (x: number, z: number) => inGrid(w, x, z) && w.ter[at(x, z)] === TER_ROAD;
  for (const [cx, cz] of TOWN_VILLAGES) {
    place(BK_CHURCH, cx + 3, cz + 2, 1, 1, 2);
    for (let z = cz - 6; z <= cz + 6; z++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (town(x, z) || !isRoad(x - 1, z) && !isRoad(x + 1, z) && !isRoad(x, z - 1) && !isRoad(x, z + 1) || randInt(w, 100) >= 58) continue;
      const r = randInt(w, 10), kind = r < 6 ? BK_COTTAGE : r < 8 ? BK_HOUSE : BK_BARN;
      const along = isRoad(x, z - 1) || isRoad(x, z + 1);
      place(kind, x, z, along ? 1 + randInt(w, 2) : 1, along ? 1 : 1 + randInt(w, 2), kind === BK_HOUSE ? 2 : 1);
    }
  }
  for (let k = 0; k < 45; k++) {
    const x = 2 + randInt(w, n - 5), z = 2 + randInt(w, n - 5);
    if (x >= 22 && x <= 73 && z >= 22 && z <= 73) continue;
    place(k % 3 === 0 ? BK_BARN : BK_COTTAGE, x, z, 2, k % 3 === 0 ? 2 : 1, 1);
  }
  for (const side of [SIDE_PLAYER, SIDE_ENEMY]) for (const [kind, px, pz] of ARMOUR_FORCE) {
    const cx = side === SIDE_PLAYER ? px + 32 : n - 1 - px - 32, cz = side === SIDE_PLAYER ? pz + 32 : n - 1 - pz - 32;
    const k = UNIT_KINDS[kind], d = side === SIDE_PLAYER ? -SUB : SUB;
    w.units.push({ id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(k.armored ? { hullX: d, hullZ: d } : {}) });
  }
  if (vegetation === 1) {
    const cells = new Uint8Array(n * n); let count = 0;
    const units = new Set(w.units.map(u => at(cellOf(u.x), cellOf(u.z))));
    const put = (x: number, z: number, kind: number) => {
      if (!inGrid(w, x, z) || inTownSpawn(x, z) || count >= VEGETATION_MAX) return;
      const c = at(x, z), t = w.ter[c];
      if (cells[c] || w.occ[c] || units.has(c) || t === TER_ROAD || t === TER_MUD) return;
      cells[c] = kind; count++;
    };
    for (const [x, z, width] of fields.slice(0, 10)) for (let dx = 0; dx < Math.min(width, 4); dx++) put(x + dx, z - 1, VEG_HEDGE);
    for (let k = 0; k < 8; k++) {
      const x = 2 + randInt(w, n - 5), z = 2 + randInt(w, n - 5);
      if (town(x, z)) continue;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) put(x + dx, z + dz, VEG_WOOD);
    }
    w.vegetation = { version: VEGETATION_VERSION, cells };
  }
  w.map = MAP_TOWN;
}
