// R090 地圖 5（海斯，128×128）的尋路規則——只在 w.map === MAP_HYTHE 生效，地圖 0–4 的結果逐位不變（tests/path-scratch.mjs 的 hythe 群）。
// 1. 啟發多估一點：直走 13、斜走 18（原本 10／14）。128 圖上 47 個單位一起走省六到七倍；路平均長約 3%、最壞約 20%，理論上限 max(13/10, 18/14)＝1.30 倍。
// 2. 對稱時平手的上界跟著改成 18n＋1（h 最大 18×(n−1)）。
// 3. 終點擋住（用這個單位自己的「擋不擋」，所以鐵絲網也算）就在 8 圈以內換一個走得到的：先比離終點近、再比離單位近、
//    再比對稱的次序（跟 path.ts 的 enc 同一套：鏡像的指令換到鏡像的格）。走不到的終點不用再整片搜完。
import { inGrid, type World } from './world.ts';
import { MAP_HYTHE } from './hytheMap.ts';

export const rule90 = (w: World): boolean => w.map === MAP_HYTHE;
export const HA90 = 13, HD90 = -8;   // 13×(dx＋dz) − 8×min(dx, dz)：直走 13、斜走 18
export const heur90 = (x: number, z: number, gx: number, gz: number): number => {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return HA90 * (dx + dz) + HD90 * Math.min(dx, dz);
};
export const hb90 = (n: number): number => 18 * n + 1;

// 終點 (gx, gz) 擋住時：8 圈以內最好的走得到的格（格索引），沒有就 −1
export function snap90(w: World, blocked: (x: number, z: number) => boolean, sx: number, sz: number, gx: number, gz: number): number {
  const n = w.n, K = n * n, g0 = gz * n + gx, fl = g0 > K - 1 - g0 ? 1 : 0;
  const ord = (i: number) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i);
  let best = -1, bg = 0, bs = 0, bo = 0;
  for (let r = 1; r <= 8 && best < 0; r++) for (let z = gz - r; z <= gz + r; z++) for (let x = gx - r; x <= gx + r; x++) {
    if (Math.max(Math.abs(x - gx), Math.abs(z - gz)) !== r || !inGrid(w, x, z) || blocked(x, z)) continue;
    const i = z * n + x, hg = heur90(x, z, gx, gz), hs = heur90(x, z, sx, sz), o = ord(i);
    if (best < 0 || hg < bg || (hg === bg && (hs < bs || (hs === bs && o < bo)))) { best = i; bg = hg; bs = hs; bo = o; }
  }
  return best;
}
