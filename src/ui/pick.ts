// R070 從總機搬出來的一支：畫面上最近的單位（原本在 src/main.ts，內容逐字相同）。
// 只讀世界與鏡頭，不改任何東西；桌機滑鼠與手機點按都走這支。
// main.ts 留一個同名薄接線 pickUnit，因為 R124／R123 的瀏覽器守衛會把 `pickUnit(x,y)` 注入總機。
import type { World } from '../sim/world.ts';
import { SUB, SIDE_PLAYER } from '../sim/world.ts';
import type { BattleView } from '../render/battle.ts';

// selected（R081）：給了的話，點的位置上疊著好幾個我方單位、而現在唯一選著的就是其中一個 → 換選下一個（照編號輪流）。
// 「疊著」＝離點的位置跟最近那一個差不到 STACK_PX 像素。很快地連點（雙擊跟車）由呼叫的人不給 selected。
export const STACK_PX = 8;
export function pickUnitAt(w: World, view: BattleView, cx: number, cy: number, cssW: number, cssH: number, selected?: ReadonlySet<number>): number {
  let best = 0, bestD = 26 * 26;
  const mine: [number, number][] = [];   // R081：（距離、編號）——只收我方的
  for (const u of w.units) {
    if (!u.alive || !view.visibleUnit(u)) continue;
    const [sx, sy] = view.screenOf(u.x / SUB, view.unitHeight(u) + 0.15, u.z / SUB, cssW, cssH);
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bestD) { bestD = d; best = u.id; }
    if (selected && u.side === SIDE_PLAYER && d < 26 * 26) mine.push([Math.sqrt(d), u.id]);
  }
  if (selected && selected.size === 1 && mine.length > 1) {
    const near = Math.min(...mine.map(([d]) => d)), stack = mine.filter(([d]) => d <= near + STACK_PX).map(([, id]) => id).sort((a, b) => a - b);
    const at = stack.indexOf([...selected][0]);
    if (at >= 0 && stack.length > 1) return stack[(at + 1) % stack.length];
  }
  return best;
}
