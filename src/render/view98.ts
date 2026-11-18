// R098 大地圖的畫面先撐住（只改效能、畫出來的像素逐位一樣）：三件共用的閥，與屋頂高度的鍵。
// 地面貼圖只傳改過的格列在 groundUpload.ts、布陣預覽只重畫改到的格在 previewDiff.ts。
import { wireAt, cellIdx, inGrid, type World } from '../sim/world.ts';

let on98 = true;
export const setView98 = (on: boolean): void => { on98 = on; };
export const view98 = (): boolean => on98;

// 城鎮網格「建的時候」每一棟的樣子：耐久（幾何跟著耐久變——段、R088 的磨損等級、各畫面模組自己的門檻）、還在不在升起（R016：
// 升起時不在網格裡），以及每段鐵絲網在不在。要用建的時候的、不是現在的：模擬扣了耐久之後，網格要等「換段」事件才重建，
// 這段空檔裡打的射線碰到的還是舊網格（CI 的 section89 抓到：第一版用現在的耐久，網格重建時耐久沒再變，屋頂高度就留著舊的）。
export interface TownSnap98 { hp: Int32Array; rising: Uint8Array; wires: Map<number, number> }
export function townSnap98(w: World, rising: (id: number) => boolean): TownSnap98 {
  const hp = new Int32Array(w.blds.length), up = new Uint8Array(w.blds.length), wires = new Map<number, number>();
  for (let i = 0; i < w.blds.length; i++) { hp[i] = w.blds[i].hp; up[i] = rising(w.blds[i].id) ? 1 : 0; }
  for (const s of w.wires?.segments ?? []) wires.set(s.id, s.hp > 0 ? 1 : 0);
  return { hp, rising: up, wires };
}

// 屋頂高度的鍵：對整鎮打的射線會先碰到「蓋在這一點上的」幾何——通常是腳下那一棟，但鄰居的幾何會伸過來一點
// （萊伊的教堂伸進隔壁房子 0.03 格、塌了的牆的瓦礫伸進下一段 0.06 格、鐵絲網的鐵線伸到隔壁房子邊上；審查 R098 時找到的）。
// 伸出來的都遠小於一格，所以鍵是單位所在格四周 3×3 格內每一棟、每一段鐵絲網在網格建的時候的樣子；網格重建時有一樣變了才對整鎮重打。
export function roofSig98(w: World, x: number, z: number, snap: TownSnap98 | null): string {
  if (!snap) return '';
  let s = '';
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx, cz = z + dz;
    if (!inGrid(w, cx, cz)) continue;
    const id = w.occ[cellIdx(w, cx, cz)], wire = wireAt(w, cx, cz);
    if (id) s += id <= snap.hp.length ? `${id}.${snap.hp[id - 1]}${snap.rising[id - 1] ? 'r' : ''}` : `${id}.new`;
    if (wire) s += `w${wire.id}.${snap.wires.get(wire.id) ?? 'new'}`;
    s += ',';
  }
  return s;
}
