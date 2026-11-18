// R098 布陣預覽只重畫改到的格（只改效能：畫出來的 groundPx 跟整張重畫的逐位一樣）。
// 布陣時每點一下 refreshPreview → setWorld（複製世界、套計畫）。同一張圖、同一個 n、同一個染色的那一方時，新舊兩個世界逐格比
// paintCell 會讀的每一樣東西：地形、彈坑、房子格（編號與是不是瓦礫）、戰壕（種類與跟鄰格的連接）、起伏；改到的格再加一圈
// （paintCell 的路緣看上下左右四格有沒有房子）。地圖、n、染色的那一方、起伏不同，同一個世界物件，或閥關著，就整張（回傳 null）。
import { stageOf, STAGE_RUBBLE, type World } from '../sim/world.ts';
import { view98 } from './view98.ts';

interface Raster { kinds: Uint8Array; links: Uint8Array }
export interface PreviewSnap98 { w: World; side: number; kinds: Uint8Array; links: Uint8Array }

// setWorld 換世界之前：記下舊的世界、染色的那一方、戰壕的格（trench118.sync 會改掉它們）
export const previewSnap98 = (w: World | undefined, side: number, raster: Raster): PreviewSnap98 | null =>
  view98() && w ? { w, side, kinds: raster.kinds.slice(), links: raster.links.slice() } : null;

// 換了之後（戰壕已經照新世界同步）：要重畫的格；null＝整張
export function previewCells98(s: PreviewSnap98 | null, w: World, side: number, raster: Raster): number[] | null {
  if (!s || s.w === w || s.side !== side || s.w.n !== w.n || s.w.map !== w.map || s.kinds.length !== raster.kinds.length) return null;   // 同一個物件（原地改過再叫）比不出差別：整張
  const a = s.w, n = w.n, K = n * n;
  if (!!a.height !== !!w.height) return null;
  if (w.height && a.height) for (let i = 0; i < w.height.length; i++) if (a.height[i] !== w.height[i]) return null;
  const key = (v: World, i: number) => { const id = v.occ[i]; return id ? id * 2 + (stageOf(v.blds[id - 1]) === STAGE_RUBBLE ? 1 : 0) : 0; };
  const hit = new Uint8Array(K), out: number[] = [];
  for (let i = 0; i < K; i++) {
    if (a.ter[i] === w.ter[i] && a.crater[i] === w.crater[i] && key(a, i) === key(w, i) && s.kinds[i] === raster.kinds[i] && s.links[i] === raster.links[i]) continue;
    const x = i % n, z = (i - x) / n;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx, cz = z + dz;
      if (cx < 0 || cz < 0 || cx >= n || cz >= n || hit[cz * n + cx]) continue;
      hit[cz * n + cx] = 1; out.push(cz * n + cx);
    }
  }
  return out;
}
