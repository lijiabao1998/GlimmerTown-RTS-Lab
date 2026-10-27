// R064 守衛：A* 每格擋不擋只算一次、喪屍近身先用格子篩——結果要跟改之前逐位相同。
// 參考答案：main 263ab52 的 src/sim/path.ts 原文（型別剝掉、原樣貼在下面），跟現在的 findPath 對同一批問題逐一比。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, cellIdx, inGrid, blocks, wireBlocks, UK_TANK, UK_INFANTRY, UK_ZOMBIE, BK_WIRE, SUB, UNIT_KINDS, SIDE_ENEMY, cellOf, center, speedPct } from '../src/sim/world.ts';
import { zombieAim } from '../src/sim/zombies.ts';
import { dist } from '../src/sim/math.ts';
import { step } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';

// ---- 參考：改之前的 A*（逐字）----
// 格子 A*：八方向、不准切過擋路格的角；成本全是整數，平手時照格索引排，結果決定性。

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// 每一步的成本：直走 10、斜走 14，再除以地形速度倍率
function stepCost(w       , x        , z        , diag         )         {
  return Math.floor(((diag ? 14 : 10) * 100) / speedPct(w, x, z));
}
function heur(x        , z        , gx        , gz        )         {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return 10 * (dx + dz) - 6 * Math.min(dx, dz);
}

// 最小堆：鍵＝f*K+格索引（K＝這個世界的格數 n*n，見 findPath），同 f 時小索引先出
class Heap {
  a           = [];
  push(v        ) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= v) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop()         {
    const a = this.a, top = a[0], last = a.pop() ;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mv = last;
        if (l < a.length && a[l] < mv) { m = l; mv = a[l]; }
        if (r < a.length && a[r] < mv) { m = r; mv = a[r]; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
  get size() { return this.a.length; }
}

// 回傳從起點下一格到終點的格索引；終點走不到時，走到離終點最近（啟發值最小）的可達格。
function oldFindPath(w       , sx        , sz        , gx        , gz        , enterBuilding = 0, exitBuilding = 0, unitKind = UK_TANK)           {
  if (!inGrid(w, sx, sz) || !inGrid(w, gx, gz)) return [];
  const blocked = (x        , z        ) => wireBlocks(w, x, z, unitKind) || (blocks(w, x, z) && w.occ[cellIdx(w, x, z)] !== enterBuilding && w.occ[cellIdx(w, x, z)] !== exitBuilding);
  const start = cellIdx(w, sx, sz), goal = cellIdx(w, gx, gz);
  if (start === goal) return [];
  const n = w.n, K = n * n;
  const g = new Int32Array(K).fill(-1), came = new Int32Array(K).fill(-1), done = new Uint8Array(K);
  const open = new Heap();
  g[start] = 0;
  open.push(heur(sx, sz, gx, gz) * K + start);
  let best = start, bestH = heur(sx, sz, gx, gz);
  while (open.size) {
    const cur = open.pop() % K;
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % n, cz = (cur - cx) / n;
    const h = heur(cx, cz, gx, gz);
    if (h < bestH || (h === bestH && g[cur] < g[best])) { best = cur; bestH = h; }
    if (cur === goal) break;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (!inGrid(w, nx, nz) || blocked(nx, nz)) continue;
      const diag = k >= 4;
      if (diag && (blocked(cx + DX[k], cz) || blocked(cx, cz + DZ[k]))) continue;   // 不切角
      const ni = cellIdx(w, nx, nz), ng = g[cur] + stepCost(w, nx, nz, diag);
      if (done[ni] || (g[ni] >= 0 && g[ni] <= ng)) continue;
      g[ni] = ng; came[ni] = cur;
      open.push((ng + heur(nx, nz, gx, gz)) * K + ni);
    }
  }
  const end = done[goal] ? goal : best;
  const out           = [];
  for (let c = end; c !== start && c >= 0; c = came[c]) out.push(c);
  return out.reverse();
}

// ---- 1. 同一批問題：四張地圖＋鐵絲網，三種單位，進出房子，答案逐格相同 ----
let s = 1944; const rnd = k => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % k; };
let asked = 0;
for (const map of [0, 1, 2, 3]) {
  const w = createWorld(1944 + map); step(w, [{ t: 'map', id: map, vegetation: 1 }]);
  // 撒一些鐵絲網段（不壓房子），讓徒步單位的擋路判斷也比到
  const segs = []; for (let i = 0; i < 24; i++) { const x = rnd(w.n - 2), z = rnd(w.n - 1), rot = rnd(2); segs.push({ id: 900 + i, kind: BK_WIRE, x, z, w: rot ? 1 : 2, d: rot ? 2 : 1, floors: 1, hp: rnd(3) ? 60 : 0, maxHp: 60 }); }
  w.wires = { version: 1, segments: segs };
  for (let i = 0; i < 150; i++) {
    const sx = rnd(w.n), sz = rnd(w.n), gx = rnd(w.n), gz = rnd(w.n), kind = [UK_TANK, UK_INFANTRY, UK_ZOMBIE][rnd(3)];
    const enter = rnd(4) === 0 ? w.occ[cellIdx(w, gx, gz)] : 0, exit = rnd(4) === 0 ? w.occ[cellIdx(w, sx, sz)] : 0;
    assert.deepEqual(findPath(w, sx, sz, gx, gz, enter, exit, kind), oldFindPath(w, sx, sz, gx, gz, enter, exit, kind), `path: map ${map} query ${i} identical to the pre-R064 A*`);
    asked++;
  }
}
console.log(`OK path-speed: ${asked} 個尋路問題跟改之前逐格相同（四張地圖、鐵絲網、坦克／步兵／喪屍、進出房子）`);

// ---- 2. 喪屍近身挑房子：跟改之前「每棟都算距離」的掃法逐一比（96 圖、貼著各棟房子的各種位置、擋住／沒擋住）----
const near = (b, u) => [center(Math.max(b.x, Math.min(b.x + b.w - 1, cellOf(u.x)))), center(Math.max(b.z, Math.min(b.z + b.d - 1, cellOf(u.z))))];
function oldBuildingAim(w, u) {   // main 263ab52 的 zombieAim 後半（沒有可追的人時），逐字照搬
  const reach = UNIT_KINDS[UK_ZOMBIE].range, id = w.eco?.hq[0] ?? 0, hq = id ? w.blds[id - 1] : undefined;
  const [gx, gz] = hq ? [center(hq.x), center(hq.z)] : [center(w.n - 6), center(w.n - 6)], t = null;
  let best = null, score = Number.MAX_SAFE_INTEGER;
  for (const b of [...w.blds, ...(w.wires?.segments ?? [])]) {
    if (b.hp <= 0) continue;
    const [x, z] = near(b, u);
    if (dist(u.x, u.z, x, z) > reach) continue;
    const blocked = u.pathIdx >= u.path.length && (u.tx !== 0 || u.tz !== 0);
    if (b !== hq && !blocked) continue;
    const d = b === hq ? -1 : dist(x, z, t?.x ?? gx, t?.z ?? gz);
    if (d < score) { score = d; best = { x, z, unit: null, bld: b, ...(b.kind === BK_WIRE ? { wire: true } : {}) }; }
  }
  return best;
}
{
  const w = createWorld(1944); step(w, [{ t: 'map', id: 3, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1 }]);
  for (const u of w.units) if (u.side === 0) { u.alive = false; u.hp = 0; }   // 沒有可追的人：只比挑房子
  let compared = 0, hits = 0;
  for (const b of [...w.blds, w.blds[w.eco.hq[0] - 1]]) for (let i = 0; i < 6; i++) {
    const x = (b.x - 3 + rnd(b.w + 6)) * SUB + rnd(SUB), z = (b.z - 3 + rnd(b.d + 6)) * SUB + rnd(SUB);
    if (x < 0 || z < 0 || x >= w.n * SUB || z >= w.n * SUB) continue;
    const blockedNow = rnd(2) === 0;
    const u = { id: 9999, side: SIDE_ENEMY, kind: UK_ZOMBIE, x, z, hp: 60, alive: true, order: 0, target: 0, tx: blockedNow ? 5 : 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
    const a = zombieAim(w, u, () => false), e = oldBuildingAim(w, u);
    assert.deepEqual(a && { ...a, bld: a.bld?.id }, e && { ...e, bld: e.bld?.id }, `aim: zombie at ${x},${z} picks the same building as the pre-R064 scan`);
    compared++; if (e) hits++;
  }
  assert(hits > 50, `aim: comparison covers real hits (${hits})`);
  console.log(`OK path-speed: 喪屍挑房子 ${compared} 個位置跟改之前相同（${hits} 個碰得到房子）`);
}

// ---- 3. 喪屍模式長局：雜湊凍結在改之前算的值（指揮部每步補滿，48 群一直圍著）----
const FROZEN = { 2: '8a5f7d15', 3: 'f5ab13b0' };   // main 263ab52 上第 3000 步的世界雜湊
for (const map of [2, 3]) {
  const w = createWorld(1944); step(w, [{ t: 'map', id: map, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }]);
  const hq = w.blds[w.eco.hq[0] - 1], full = hq.hp;
  while (w.tick < 3000) { hq.hp = full; w.winner = -1; step(w, []); }
  assert.equal(hashWorld(w), FROZEN[map], `zombies: map ${map} 3000-tick siege hash unchanged`);
}
console.log('OK path-speed: 喪屍模式 64、96 圖 3000 步雜湊跟改之前相同');
console.log('path-speed: all OK');
