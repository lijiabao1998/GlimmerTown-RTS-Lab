// 地圖共用常數：大地圖（R043）與 96×96 河鎮（R130）共用的出生角落與起手裝甲連。
// 原本定義在 largeMap.ts，河鎮直接 import largeMap 的常數；搬到這裡後兩張圖互不依賴（數值、順序逐位不變）。
import { UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_LIGHT, UK_HEAVY } from './world.ts';

export const SPAWN_CORNER = 12;   // 出生角落邊長（不蓋房子、不長植被）

// 我方起手（以 64×64 座標記，格）；敵方是點對稱。順序就是 id 順序。
export const ARMOUR_FORCE: [number, number, number][] = [
  [UK_TANK, 52, 56], [UK_TANK, 54, 54], [UK_TANK, 56, 52], [UK_TANK, 53, 59], [UK_TANK, 59, 53], [UK_TANK, 56, 56],
  [UK_LIGHT, 52, 61], [UK_LIGHT, 61, 52],
  [UK_HEAVY, 55, 58], [UK_HEAVY, 58, 55],
  [UK_HOWITZER, 60, 60], [UK_HOWITZER, 62, 57], [UK_HOWITZER, 57, 62],
  [UK_OBSERVER, 53, 52], [UK_OBSERVER, 52, 53],
];
