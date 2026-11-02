// R070 從總機搬出來的一支：畫面上最近的單位（原本在 src/main.ts，內容逐字相同）。
// 只讀世界與鏡頭，不改任何東西；桌機滑鼠與手機點按都走這支。
// main.ts 留一個同名薄接線 pickUnit，因為 R124／R123 的瀏覽器守衛會把 `pickUnit(x,y)` 注入總機。
import type { World } from '../sim/world.ts';
import { SUB } from '../sim/world.ts';
import type { BattleView } from '../render/battle.ts';

export function pickUnitAt(w: World, view: BattleView, cx: number, cy: number, cssW: number, cssH: number): number {
  let best = 0, bestD = 26 * 26;
  for (const u of w.units) {
    if (!u.alive || !view.visibleUnit(u)) continue;
    const [sx, sy] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, cssW, cssH);
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = u.id; }
  }
  return best;
}
