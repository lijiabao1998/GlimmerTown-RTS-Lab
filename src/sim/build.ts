// R006 自己建城：開戰前（第 0 步）的布陣指令。純函式、只用整數；亂數只用自己的種子狀態，不碰 World.rng。
import { isqrt } from './math.ts';
import { nextU32, randInt, type RngState } from './rng.ts';
import {
  N, idx, inMap, cellOf, blocks, bldMaxHp, TER_ROAD, BK_COTTAGE, BK_HOUSE, BK_BARN, SIDE_PLAYER, SIDE_ENEMY,
  type World, type Building,
} from './world.ts';

export interface BuildCmd { t: 'build'; side: number; kind: number; x: number; z: number; rot?: number }

export interface BuildKind { name: string; kind: number; w: number; d: number; floors: number; cost: number }
// 指令裡的 kind＝建築種類碼（BK_*）；教堂、商店不能蓋
export const BUILD_KINDS: BuildKind[] = [
  { name: 'cottage', kind: BK_COTTAGE, w: 1, d: 1, floors: 1, cost: 1 },
  { name: 'house', kind: BK_HOUSE, w: 2, d: 1, floors: 2, cost: 2 },
  { name: 'barn', kind: BK_BARN, w: 2, d: 2, floors: 1, cost: 3 },
];
export const BUILD_POINTS = 8;

export const buildKind = (kind: number): BuildKind | null => BUILD_KINDS.find(k => k.kind === kind) ?? null;

// 半場：我方 x+z ≥ N+2、敵方 x+z ≤ N−4，中間是無人帶
export function territory(side: number, x: number, z: number): boolean {
  return side === SIDE_PLAYER ? x + z >= N + 2 : side === SIDE_ENEMY ? x + z <= N - 4 : false;
}

export function pointsUsed(w: World, side: number): number {
  let p = 0;
  for (const b of w.blds) if (b.builtBy === side) p += buildKind(b.kind)?.cost ?? 0;
  return p;
}

// 佔地（rot=1 時寬深互換）
export function footprint(cmd: BuildCmd): { x: number; z: number; w: number; d: number } | null {
  const k = buildKind(cmd.kind);
  if (!k) return null;
  return cmd.rot === 1 ? { x: cmd.x, z: cmd.z, w: k.d, d: k.w } : { x: cmd.x, z: cmd.z, w: k.w, d: k.d };
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// 把佔地當成擋路，從第一個活著的單位做廣度搜尋（跟 A* 一樣八方向、不切角），看每個活著的單位是不是都走得到
export function stillConnected(w: World, fx: number, fz: number, fw: number, fd: number): boolean {
  const unitCell = new Uint8Array(N * N);
  let start = -1;
  for (const u of w.units) if (u.alive) { const c = idx(cellOf(u.x), cellOf(u.z)); unitCell[c] = 1; if (start < 0) start = c; }
  if (start < 0) return true;
  const blocked = (x: number, z: number) => {
    if (x >= fx && z >= fz && x < fx + fw && z < fz + fd) return true;
    return blocks(w, x, z) && !unitCell[idx(x, z)];   // 單位站的格一定算走得到（觀測員可能在屋裡）
  };
  const seen = new Uint8Array(N * N), queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  seen[start] = 1; queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++], cx = cur % N, cz = (cur - cx) / N;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (!inMap(nx, nz) || blocked(nx, nz)) continue;
      if (k >= 4 && (blocked(cx + DX[k], cz) || blocked(cx, cz + DZ[k]))) continue;   // 不切角
      const ni = idx(nx, nz);
      if (!seen[ni]) { seen[ni] = 1; queue[tail++] = ni; }
    }
  }
  for (const u of w.units) if (u.alive && !seen[idx(cellOf(u.x), cellOf(u.z))]) return false;
  return true;
}

// 不能蓋的原因（代碼）；能蓋回傳 null。順序＝玩家看到的原因的優先順序。
// 註：跟別的建築隔一格的規矩下，合法的佔地四周一定有一圈空格，單獨一棟堵不死路；
// 所以「會堵死通路」排在「太靠近」之前：塞進兩棟房子（或房子與地圖邊）之間的窄巷時，玩家看到的是真正的後果。
export function buildError(w: World, cmd: BuildCmd): string | null {
  if (w.tick !== 0) return 'tick';
  if (cmd.side !== SIDE_PLAYER && cmd.side !== SIDE_ENEMY) return 'side';
  const k = buildKind(cmd.kind);
  if (!k) return 'kind';
  if (cmd.rot !== undefined && cmd.rot !== 0 && cmd.rot !== 1) return 'rot';
  if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.z)) return 'coord';
  const f = footprint(cmd)!;
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (!inMap(x, z)) return 'map';
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) {
    if (!territory(cmd.side, x, z)) return territory(1 - cmd.side, x, z) ? 'foreign' : 'neutral';
  }
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (w.ter[idx(x, z)] === TER_ROAD) return 'road';
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (w.occ[idx(x, z)]) return 'occupied';
  for (const u of w.units) {
    if (!u.alive) continue;
    const ux = cellOf(u.x), uz = cellOf(u.z);
    if (ux >= f.x && uz >= f.z && ux < f.x + f.w && uz < f.z + f.d) return 'unit';
  }
  if (pointsUsed(w, cmd.side) + k.cost > BUILD_POINTS) return 'points';
  if (!stillConnected(w, f.x, f.z, f.w, f.d)) return 'blocked';
  // 建築之間至少隔一格：跟 createWorld 的 free() 同一條規矩（地圖外的邊框格不算）
  for (let dz = -1; dz <= f.d; dz++) for (let dx = -1; dx <= f.w; dx++) {
    const cx = f.x + dx, cz = f.z + dz;
    if (inMap(cx, cz) && w.occ[idx(cx, cz)]) return 'gap';
  }
  return null;
}

// 合法就蓋（回傳 null），不合法世界不變（回傳原因）
export function applyBuild(w: World, cmd: BuildCmd): string | null {
  const err = buildError(w, cmd);
  if (err) return err;
  const k = buildKind(cmd.kind)!, f = footprint(cmd)!, id = w.blds.length + 1, maxHp = bldMaxHp(k.kind, f.w, f.d, k.floors);
  const b: Building = { id, kind: k.kind, x: f.x, z: f.z, w: f.w, d: f.d, floors: k.floors, hp: maxHp, maxHp, builtBy: cmd.side };
  w.blds.push(b);
  for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) w.occ[idx(x, z)] = id;
  w.events.push({ e: 'build', bld: id });
  return null;
}

// 敵方布陣：只看種子與地圖，用自己的亂數狀態；在草稿世界上試蓋，傳進來的世界不變。
// 想法：在敵軍重心往我方重心的方向 3–10 格、靠近那條線的地方放房子，替火砲與來路擋視線；用完建材為止。
export function enemyPlan(w: World): BuildCmd[] {
  const out: BuildCmd[] = [];
  if (w.tick !== 0) return out;
  const s: World = { ...w, occ: w.occ.slice(), blds: w.blds.slice(), events: [] };
  const r: RngState = { rng: (w.seed ^ 0x52303036) >>> 0 };   // 'R006'
  nextU32(r);
  let ex = 0, ez = 0, en = 0, px = 0, pz = 0, pn = 0;
  for (const u of w.units) {
    if (!u.alive) continue;
    const x = cellOf(u.x), z = cellOf(u.z);
    if (u.side === SIDE_ENEMY) { ex += x; ez += z; en++; } else if (u.side === SIDE_PLAYER) { px += x; pz += z; pn++; }
  }
  if (!en) return out;
  // 兩倍座標（格中心＝2c+1），避免小數
  const cx = Math.floor((2 * ex) / en) + 1, cz = Math.floor((2 * ez) / en) + 1;
  const tx = pn ? Math.floor((2 * px) / pn) + 1 : 2 * N - 1, tz = pn ? Math.floor((2 * pz) / pn) + 1 : 2 * N - 1;
  const dx = tx - cx, dz = tz - cz, L = Math.max(1, isqrt(dx * dx + dz * dz));
  let left = BUILD_POINTS - pointsUsed(s, SIDE_ENEMY);
  for (let pass = 0; pass < 2 && left > 0; pass++) {
    for (let guard = 0; guard < 2 * BUILD_POINTS && left > 0; guard++) {
      const kinds = BUILD_KINDS.filter(k => k.cost <= left);
      if (!kinds.length) break;
      const first = randInt(r, kinds.length);
      let placed: BuildCmd | null = null;
      for (let j = 0; j < kinds.length && !placed; j++) {
        const k = kinds[(first + j) % kinds.length];
        const cands: { cmd: BuildCmd; score: number; i: number }[] = [];
        for (let rot = 0; rot < (k.w === k.d ? 1 : 2); rot++) {
          const fw = rot ? k.d : k.w, fd = rot ? k.w : k.d;
          for (let z = 0; z + fd <= N; z++) for (let x = 0; x + fw <= N; x++) {
            if (!territory(SIDE_ENEMY, x + fw - 1, z + fd - 1)) continue;          // 最靠我方的那一角也要在敵方半場
            const ax = 2 * x + fw - cx, az = 2 * z + fd - cz;                      // 佔地中心－敵軍重心（兩倍座標）
            const along = ax * dx + az * dz, lat = Math.abs(ax * dz - az * dx);   // 都是 L 倍
            if (pass === 0 && (along < 6 * L || along > 20 * L)) continue;        // 3–10 格
            const score = Math.floor((4 * lat + Math.abs(along - 12 * L)) / L) + randInt(r, 10);
            cands.push({ cmd: { t: 'build', side: SIDE_ENEMY, kind: k.kind, x, z, rot }, score, i: (rot * N + z) * N + x });
          }
        }
        cands.sort((a, b) => a.score - b.score || a.i - b.i);
        for (const c of cands) if (!buildError(s, c.cmd)) { placed = c.cmd; break; }
      }
      if (!placed) break;
      applyBuild(s, placed);
      out.push(placed);
      left -= buildKind(placed.kind)!.cost;
    }
  }
  return out;
}
