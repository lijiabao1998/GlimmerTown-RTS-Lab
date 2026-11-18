// 格子 A*：八方向、不准切過擋路格的角；成本全是整數，平手時照格索引排，結果決定性。
import { cellIdx, inGrid, blocks, wireBlocks, UK_TANK, speedPct, type World } from './world.ts';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// 每一步的成本：直走 10、斜走 14，再除以地形速度倍率（p＝speedPct，R097 起每格只問一次）
function stepCost(p: number, diag: boolean): number {
  return Math.floor(((diag ? 14 : 10) * 100) / p);
}
function heur(x: number, z: number, gx: number, gz: number): number {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return 10 * (dx + dz) - 6 * Math.min(dx, dz);
}

// 最小堆：鍵＝f*M+次序（見 findPath），同 f 時次序小的先出。R097：存在 Float64Array 裡、不夠大才加倍（跟著模組重用）；比較與搬動一步不差
class Heap {
  a = new Float64Array(1024); size = 0;
  push(v: number) {
    if (this.size === this.a.length) { const b = new Float64Array(this.size * 2); b.set(this.a); this.a = b; }
    const a = this.a;
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= v) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop(): number {
    const a = this.a, top = a[0], len = --this.size, last = a[len];
    if (len) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mv = last;
        if (l < len && a[l] < mv) { m = l; mv = a[l]; }
        if (r < len && a[r] < mv) { m = r; mv = a[r]; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

// R097：暫存跟著模組走，只有格數（n*n）變了才重開；每次呼叫先清成跟以前新開的陣列一模一樣（came 也清：守衛故意弄壞次序時，舊的走到 -1 就停，不能讀到上一次的）
let K0 = -1, memo = new Uint8Array(0), spd = new Int32Array(0), g = new Int32Array(0), came = new Int32Array(0), done = new Uint8Array(0);
const open = new Heap();

// 回傳從起點下一格到終點的格索引；終點走不到時，走到離終點最近（啟發值最小）的可達格。
export function findPath(w: World, sx: number, sz: number, gx: number, gz: number, enterBuilding = 0, exitBuilding = 0, unitKind = UK_TANK): number[] {
  if (!inGrid(w, sx, sz) || !inGrid(w, gx, gz)) return [];
  const start = cellIdx(w, sx, sz), goal = cellIdx(w, gx, gz);
  if (start === goal) return [];
  const n = w.n, K = n * n;
  if (K !== K0) { K0 = K; memo = new Uint8Array(K); spd = new Int32Array(K); g = new Int32Array(K); came = new Int32Array(K); done = new Uint8Array(K); }
  memo.fill(0); spd.fill(0); g.fill(-1); came.fill(-1); done.fill(0); open.size = 0;
  // R064：每格擋不擋，一次搜尋只算一次（原本每格最多被問十次，鐵絲網還要每次從頭找）；只在格內問，結果逐位不變
  // memo：0＝還沒算、1＝可走、2＝擋。R097：每格的地形速度也一次搜尋只問一次（spd，0＝還沒問；搜尋中世界不變）
  const blocked = (x: number, z: number) => {
    const i = z * n + x;
    if (!memo[i]) memo[i] = wireBlocks(w, x, z, unitKind) || (blocks(w, x, z) && w.occ[i] !== enterBuilding && w.occ[i] !== exitBuilding) ? 2 : 1;
    return memo[i] === 2;
  };
  // R084 左右對稱：堆的鍵＝f×M＋次序。原本次序＝格索引（平手時偏向小編號那一邊）；有 sym 時次序看「這一格與它的點鏡像那一格」這一對（小的那個索引×2），
  // 同一對裡的先後看終點在哪一半（fl）——終點跟它的鏡像一定在不同的兩半，所以鏡像的問題每一個鍵都跟原本那一格的一樣、每一個平手做的是鏡像的選擇。
  // f 平手時先比離終點的估計（h 小的先）：對稱不靠它（審查之後），留著是因為同樣 f 時先展開離終點近的格、搜得少
  const HB = 14 * n + 1, key = (f: number, h: number, i: number) => (w.sym ? (f * HB + h) * M + enc(i) : f * M + enc(i)), fl = goal > K - 1 - goal ? 1 : 0;
  const M = w.sym ? 2 * K : K, enc = (i: number) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i), dec = (e: number) => (w.sym ? ((e & 1) ^ fl ? K - 1 - (e >> 1) : e >> 1) : e);
  g[start] = 0;
  open.push(key(heur(sx, sz, gx, gz), heur(sx, sz, gx, gz), start));
  let best = start, bestH = heur(sx, sz, gx, gz);
  while (open.size) {
    // R097：鍵超過 2^31 時 v % M 走浮點取餘（慢）。鍵是 (0, 2^53) 的數時改成除法取商、再把可能差一的餘數修回 [0, M)——跟 % 一樣（都是精確的）；
    // 其他的鍵（負的：彈坑深到速度變負數；0、NaN；2^53 以上）照舊用 %，審查之後
    const v = open.pop(); let e = 0;
    if (v > 0 && v < 9007199254740992) { e = v - Math.floor(v / M) * M; if (e < 0) e += M; else if (e >= M) e -= M; } else e = v % M;
    const cur = dec(e);
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % n, cz = (cur - cx) / n;
    const h = heur(cx, cz, gx, gz);
    if (h < bestH || (h === bestH && g[cur] < g[best])) { best = cur; bestH = h; }
    if (cur === goal) break;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (!(nx >= 0 && nz >= 0 && nx < n && nz < n) || blocked(nx, nz)) continue;   // 跟 inGrid 一樣（NaN 也擋：座標不是整數時跟以前一樣搜完就停）
      const diag = k >= 4;
      if (diag && (blocked(cx + DX[k], cz) || blocked(cx, cz + DZ[k]))) continue;   // 不切角
      const ni = nz * n + nx, ng = g[cur] + stepCost(spd[ni] || (spd[ni] = speedPct(w, nx, nz)), diag);
      if (done[ni] || (g[ni] >= 0 && g[ni] <= ng)) continue;
      g[ni] = ng; came[ni] = cur;
      const hn = heur(nx, nz, gx, gz);
      open.push(key(ng + hn, hn, ni));
    }
  }
  const end = done[goal] ? goal : best;
  const out: number[] = [];
  for (let c = end; c !== start && c >= 0; c = came[c]) out.push(c);
  return out.reverse();
}
