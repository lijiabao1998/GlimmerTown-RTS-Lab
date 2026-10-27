// 格子 A*：八方向、不准切過擋路格的角；成本全是整數，平手時照格索引排，結果決定性。
import { cellIdx, inGrid, blocks, wireBlocks, UK_TANK, speedPct, type World } from './world.ts';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// 每一步的成本：直走 10、斜走 14，再除以地形速度倍率
function stepCost(w: World, x: number, z: number, diag: boolean): number {
  return Math.floor(((diag ? 14 : 10) * 100) / speedPct(w, x, z));
}
function heur(x: number, z: number, gx: number, gz: number): number {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return 10 * (dx + dz) - 6 * Math.min(dx, dz);
}

// 最小堆：鍵＝f*K+格索引（K＝這個世界的格數 n*n，見 findPath），同 f 時小索引先出
class Heap {
  a: number[] = [];
  push(v: number) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= v) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop(): number {
    const a = this.a, top = a[0], last = a.pop()!;
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
export function findPath(w: World, sx: number, sz: number, gx: number, gz: number, enterBuilding = 0, exitBuilding = 0, unitKind = UK_TANK): number[] {
  if (!inGrid(w, sx, sz) || !inGrid(w, gx, gz)) return [];
  const start = cellIdx(w, sx, sz), goal = cellIdx(w, gx, gz);
  if (start === goal) return [];
  const n = w.n, K = n * n;
  // R064：每格擋不擋，一次搜尋只算一次（原本每格最多被問十次，鐵絲網還要每次從頭找）；只在格內問，結果逐位不變
  const memo = new Uint8Array(K);   // 0＝還沒算、1＝可走、2＝擋
  const blocked = (x: number, z: number) => {
    const i = z * n + x;
    if (!memo[i]) memo[i] = wireBlocks(w, x, z, unitKind) || (blocks(w, x, z) && w.occ[i] !== enterBuilding && w.occ[i] !== exitBuilding) ? 2 : 1;
    return memo[i] === 2;
  };
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
  const out: number[] = [];
  for (let c = end; c !== start && c >= 0; c = came[c]) out.push(c);
  return out.reverse();
}
