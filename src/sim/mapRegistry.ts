// 地圖登記表：每張可選地圖的 id、邊長與名稱集中在這裡；ui/mapPick.ts 從這裡讀。
// main.ts 的 reset() 暫時照舊寫死選圖與開局鏡頭：有 10 支守衛把 reset() 原始碼抽出來在 vm 裡跑（注入 MAP_RYE／MAP_LARGE／MAP_TOWN），
// 改它要同時改這些守衛，另開一張卡做。
// 生成仍在各自的檔（maps.ts／largeMap.ts／expandedMap.ts），經 maps.ts 的 applyMap 套用；這裡不改任何亂數順序或資料。
// 加新地圖：在各自的檔寫生成、在 applyMap 分派，然後在下面加一列。
import { MAP_RYE } from './maps.ts';
import { MAP_LARGE, LARGE_N } from './largeMap.ts';
import { MAP_TOWN, TOWN_N } from './expandedMap.ts';

export interface MapEntry {
  id: number;
  n: number;                          // 邊長（格）
  label: string;                      // 地圖鍵上顯示的字（手機窄，字短）
}

export const MAP_ENTRIES: readonly MapEntry[] = [
  { id: MAP_RYE, n: 32, label: '地圖：萊伊' },
  { id: MAP_LARGE, n: LARGE_N, label: '地圖：鄉間大圖' },
  { id: MAP_TOWN, n: TOWN_N, label: '地圖：大河鎮' },
];

export const mapEntry = (id: number): MapEntry | undefined => MAP_ENTRIES.find(m => m.id === id);

