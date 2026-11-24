// R1007 沙包：生產列「建造」一組的第四項（1017＝R050 的 ITEM50＋建築種類 17），與沒選「沙包」時點到沙包那一格的路由。只在這一頁，不進模擬。
// 選好之後點地圖那一段跟 R050 的三項共用 tech50.ts 的 armed（建造模式跟空中鍵互斥那一條也就跟著）；放得下的條件跟模擬同一支 why1007。
import { UNIT_KINDS, type World } from '../sim/world.ts';
import { BAG1007, bagAt1007 } from '../sim/sandbag1007.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { OrderRoute } from './smoke.ts';

export const BAG_ITEM = 1017;   // 生產列的假編號：1000＋17（兵種只到 48，步兵排是 256）
export const BAG_HINT = '建造沙包：先選工兵，再點工兵 7 格內要堆的那一格（1 格；路上、橋上可以，泥灘、樹籬、樹林、房子、鐵絲網、壕溝上不行）；再按一次取消';
const ROLE = '沙包 · 工兵在戰場上堆，1 格；站在裡面的步兵、機槍組、砲只吃一半（火焰不擋）；不擋路、不擋視線；高爆和炸藥打得散；選工兵點敵人的沙包＝炸掉';
export const bag1007Items = () => [{ kind: BAG_ITEM, label: '沙包', cost: BAG1007.cost, group: '建造', role: ROLE }];

// smoke.ts 的 routeBattleOrder（剪網那一行前面）：那一格有還站著的沙包——對方的（工地或堆好的）＝選取裡的工兵去炸、
// 自己的工地＝工兵去幫忙堆，其他的照舊走過去。自己堆好的、選取裡沒有工兵：回 null（照原本的路由：全部走過去＝走進去躲）
export function bag1007Route(w: World, ids: readonly number[], x: number, z: number): OrderRoute | null {
  const s = bagAt1007(w, x, z);
  if (!s || s.hp <= 0 || (s.builtBy === SIDE_PLAYER && s.left === 0)) return null;
  const eng = ids.filter(id => !!UNIT_KINDS[w.units[id - 1]?.kind]?.demo), rest = ids.filter(id => !eng.includes(id));
  if (!eng.length) return null;
  return {
    commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: eng, x, z }, ...(rest.length ? [{ t: 'move' as const, side: SIDE_PLAYER, ids: rest, x, z }] : [])],
    marker: { x: x + 0.5, z: z + 0.5, hostile: s.builtBy !== SIDE_PLAYER },
  };
}
