// R098 大地圖的畫面先撐住（只改效能、畫出來的像素逐位一樣）：三件共用的閥，與屋頂高度的鍵。
// 地面貼圖只傳改過的格列在 groundUpload.ts、布陣預覽只重畫改到的格在 previewDiff.ts。
import { stageOf, wireAt, cellIdx, inGrid, type Building, type World } from '../sim/world.ts';
import { wearTier } from './wearArt.ts';

let on98 = true;
export const setView98 = (on: boolean): void => { on98 = on; };
export const view98 = (): boolean => on98;

// 一棟的樣子：同一個世界裡一棟房子的種類、位置、大小、層數不會變，會變的只有段（完好／沒屋頂／瓦礫）、磨損等級（R088）、
// 還在不在升起（R016：升起時不在城鎮網格裡）。
export const roofKey98 = (b: Building, rising: boolean): number => stageOf(b) * 64 + wearTier(b) * 2 + (rising ? 1 : 0);

// 屋頂高度的鍵：對整鎮打的射線會先碰到「蓋在這一點上的」幾何——通常是腳下那一棟，但鄰居的幾何會伸過來一點
// （萊伊的教堂伸進隔壁房子 0.03 格、塌了的牆的瓦礫伸進下一段 0.06 格；審查 R098 時找到的）。伸出來的都遠小於一格，
// 所以鍵是單位所在格四周 3×3 格內每一棟房子的樣子、每一段鐵絲網在不在；有一樣變了才對整鎮重打。
export function roofSig98(w: World, x: number, z: number, rising: (id: number) => boolean): string {
  let s = '';
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx, cz = z + dz;
    if (!inGrid(w, cx, cz)) continue;
    const id = w.occ[cellIdx(w, cx, cz)], b = id ? w.blds[id - 1] : null, wire = wireAt(w, cx, cz);
    s += (b ? `${b.id}.${roofKey98(b, rising(b.id))}` : '') + (wire ? `w${wire.id}.${wire.hp > 0 ? 1 : 0}` : '') + ',';
  }
  return s;
}
