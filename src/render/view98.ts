// R098 大地圖的畫面先撐住（只改效能、畫出來的像素逐位一樣）：三件共用的閥，與屋頂高度的鍵。
// 地面貼圖只傳改過的格列在 groundUpload.ts、布陣預覽只重畫改到的格在previewDiff.ts。
import { stageOf, type Building } from '../sim/world.ts';
import { wearTier } from './wearArt.ts';

let on98 = true;
export const setView98 = (on: boolean): void => { on98 = on; };
export const view98 = (): boolean => on98;

// 屋頂高度的鍵：一個單位的屋頂高度只跟它腳下那一棟的樣子有關。同一個世界裡一棟房子的種類、位置、大小、層數不會變，
// 會變的只有段（完好／沒屋頂）、磨損等級（R088）、還在不在升起（R016：升起時不在城鎮網格裡）——鍵變了才對整鎮重打射線。
// 鄰居的變化不進鍵：tests/roof98.mjs 每一次事件之後拿快取的值跟重新對整鎮打的比。
export const roofKey98 = (b: Building, rising: boolean): number => stageOf(b) * 64 + wearTier(b) * 2 + (rising ? 1 : 0);
