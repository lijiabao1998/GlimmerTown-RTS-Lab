// R1010 炸橋與修橋的介面：沒有新指令、沒有新按鍵。smoke.ts 的路由點到地面、那一格是橋時先問這裡；提示列接在 ui/tech50.ts 的 hint50 後面。
// 只讀世界、產生指令（理由跟模擬同一支 why1010）。地名只是地名；提示不寫入侵方的國籍或番號。
import { UNIT_KINDS, type World } from '../sim/world.ts';
import { DEMO_BLD } from '../sim/engineer1002.ts';
import { job1010, why1010, COST1010 } from '../sim/bridge1010.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { OrderRoute } from './smoke.ts';

let flash = '', flashTick = -1, world: World | null = null;
const say = (w: World, s: string) => { world = w; flash = s; flashTick = w.tick; };
export const HOW1010 = '要炸橋：先按「砲擊」再點橋';

// 點到地面那一格（smoke.ts 已經篩過：是我方活著的選取、格在圖內、不是點到單位或建築）。
// 回 undefined＝照原本的路由；回 null＝什麼都不送（工兵那一份被拒、也沒有別人要送）；回路由＝送出去
export function bridge1010Route(w: World, ids: readonly number[], fireMode: boolean, x: number, z: number): OrderRoute | null | undefined {
  if (!w.br) return undefined;
  const si = job1010(w, x, z);
  if (si < 0) return undefined;
  const eng = ids.filter(id => !!UNIT_KINDS[w.units[id - 1].kind].demo);
  if (!eng.length) return undefined;
  const s = w.br.spans[si], broken = s.state === 1;
  if (!broken && !fireMode) { say(w, HOW1010); return undefined; }   // 點自己的橋不會誤炸：照舊走過去，提示怎麼炸
  const rest = ids.filter(id => !eng.includes(id)), guns = rest.filter(id => UNIT_KINDS[w.units[id - 1].kind].indirect);
  const why = why1010(w, SIDE_PLAYER, si), cost = COST1010 * s.cells.length;
  const commands: OrderRoute['commands'] = [];
  if (why) say(w, why);
  else {
    commands.push({ t: 'fireAt', side: SIDE_PLAYER, ids: eng, x, z });
    say(w, !broken ? `工兵去炸橋：要放 ${Math.ceil(s.hp / DEMO_BLD)} 包炸藥` : s.left ? '工兵去幫忙修橋（已經付過）' : `工兵去修橋：扣 ${cost} 補給`);
  }
  // 其他：砲擊模式開著、有砲＝砲打那一格（照舊）；斷橋照原本的路由，沒有砲要打就走過去（涉水）；完好的橋、木橋其他人不動
  if (fireMode && guns.length) commands.push({ t: 'fireAt', side: SIDE_PLAYER, ids: guns, x, z });
  else if (broken && rest.length) commands.push({ t: 'move', side: SIDE_PLAYER, ids: rest, x, z });
  return commands.length ? { commands, marker: { x: x + 0.5, z: z + 0.5, hostile: !broken } } : null;
}

// 提示列（ui/tech50.ts 的 hint50 沒選好要蓋的時候問）：剛點過橋就說 3 秒；沒有 w.br、沒有話要說＝undefined（hint50 照原本一個字都不變）
export function hint1010(w: World): string | undefined {
  if (w !== world) { world = w; flash = ''; }
  return w.br && flash && w.tick - flashTick < 60 ? flash : undefined;
}
