// R070 從總機搬出來的一支：畫面上最近的單位（原本在 src/main.ts，內容逐字相同）。
// 只讀世界與鏡頭，不改任何東西；桌機滑鼠與手機點按都走這支。
// main.ts 留一個同名薄接線 pickUnit，因為 R124／R123 的瀏覽器守衛會把 `pickUnit(x,y)` 注入總機。
import type { World } from '../sim/world.ts';
import { SUB, SIDE_PLAYER } from '../sim/world.ts';
import type { BattleView } from '../render/battle.ts';

// stack（R081，只有點選才給；下指令、長按不給）：點到的最近那一個是我方的、而且那一點疊著好幾個我方單位
// （離點的位置跟最近那一個差不到 STACK_PX 像素）時——
//   selected：現在唯一選著的就是其中一個 → 換選下一個（照編號輪流）；
//   keep：很快地連點的第二下，第一下選到的那一個離手指跟最近的我方單位差不到 KEEP_PX 像素（疊在同一點＝平手）→ 留在它身上
//         （雙擊跟車照舊跟得到）；手指點在旁邊另一個單位身上就照舊選最近的（R081 第二次審查）。
// 最近的是敵人就照舊回傳敵人：疊著的旁邊的敵人照樣點得到（R081 複查）。
export const STACK_PX = 8, KEEP_PX = 2;
export type StackPick = { selected?: ReadonlySet<number>; keep?: number };
export function pickUnitAt(w: World, view: BattleView, cx: number, cy: number, cssW: number, cssH: number, stack?: StackPick): number {
  let best = 0, bestD = 26 * 26;
  const mine: [number, number][] = [];   // R081：（距離、編號）——只收我方的
  for (const u of w.units) {
    if (!u.alive || !view.visibleUnit(u)) continue;
    const [sx, sy] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, cssW, cssH);
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = u.id; }
    if (stack && u.side === SIDE_PLAYER && d < 26 * 26) mine.push([Math.sqrt(d), u.id]);
  }
  if (stack && mine.length > 1 && w.units[best - 1]?.side === SIDE_PLAYER) {
    const near = Math.min(...mine.map(([d]) => d)), ids = mine.filter(([d]) => d <= near + STACK_PX).map(([, id]) => id).sort((a, b) => a - b);
    const kept = stack.keep ? mine.find(([, id]) => id === stack.keep) : undefined;
    if (kept && kept[0] <= near + KEEP_PX) return kept[1];
    const sel = stack.selected, at = sel && sel.size === 1 ? ids.indexOf([...sel][0]) : -1;
    if (at >= 0 && ids.length > 1) return ids[(at + 1) % ids.length];
  }
  return best;
}
