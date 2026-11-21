// R050 建造與科技：生產列 R142 分組選單裡的「建造」一組（兵營、車廠、補給站）。按了不是生產，是「選好要蓋哪一種」；
// 選好之後點地圖：選取裡有工兵就送 construct（放不下的原因跟模擬同一支 why50）。只在這一頁，不進模擬。
import { BK_BARRACKS, BK_DEPOT, BK_SUPPLY, UNIT_KINDS, type World } from '../sim/world.ts';
import { TECH50, why50, builders50 } from '../sim/tech50.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { OrderHit, OrderRoute } from './smoke.ts';
import { air93Arm } from './air93.ts';   // R1004：建造模式跟空中鍵互斥（air93.ts 也 import 這一支；只在按鍵時呼叫，循環沒有關係）
import { pick1009, block1009, hint1009 } from './mines1009.ts';   // R1009 地雷：main.ts 叫的是這裡的 pick50、block50、hint50（那三行被守衛逐字錨著），地雷從這三支轉過去

export const ITEM50 = 1000;   // 生產列的假編號：1000＋建築種類（1014、1015、1016；兵種只到 48，步兵排是 256）
const NAME: Record<number, string> = { [BK_BARRACKS]: '兵營', [BK_DEPOT]: '車廠', [BK_SUPPLY]: '補給站' };
const ROLE: Record<number, string> = {
  [BK_BARRACKS]: '兵營 · 工兵蓋，2×2；蓋好才造得出狙擊手、反戰車小組、火焰噴射器',
  [BK_DEPOT]: '車廠 · 工兵蓋，2×2；蓋好才造得出卡車、半履帶車、防空砲',
  [BK_SUPPLY]: '補給站 · 工兵蓋，2×2；每座每 2 秒多 1 補給（最多算兩座）',
};
export const tech50Items = () => [BK_BARRACKS, BK_DEPOT, BK_SUPPLY].map(k => ({ kind: ITEM50 + k, label: NAME[k], cost: TECH50[k].cost, group: '建造', role: ROLE[k] }));

let armed = 0, flash = '', flashTick = -1, world: World | null = null;
const isItem = (kind: number) => TECH50[kind - ITEM50] !== undefined;

// 生產列按了：建造那三項＝選好／再按一次取消（回傳 true＝接了，不要當生產送）；其他照舊
export function pick50(kind: number): boolean {
  if (pick1009(kind)) { armed = 0; flash = ''; return true; }   // R1009：地雷那兩項（選好地雷就放掉建造）；別的鍵順便放掉地雷
  if (!isItem(kind)) return false;
  armed = armed === kind - ITEM50 ? 0 : kind - ITEM50; flash = '';
  if (armed) air93Arm(0);   // R1004：選了要蓋的就把空中鍵放下（兩個都開著時點地圖會叫來轟炸、炸在自己基地）
  return true;
}
export const armed50 = (): number => armed;
export function arm50(kind: number): void { armed = kind; flash = ''; pick1009(0); }   // 守衛用

// 不能按的理由：建造那三項看 why50（不給位置）；其他回 undefined（照原本的理由）
export function block50(w: World, kind: number): string | undefined {
  const m9 = block1009(w, kind); if (m9 !== undefined) return m9;   // R1009
  return isItem(kind) ? why50(w, SIDE_PLAYER, kind - ITEM50) : undefined;
}

// smoke.ts 的 routeBattleOrder 開頭：沒選好＝undefined（照原本的路由）；選好了＝送 construct，或 null（放不下：說原因、保持選好）
export function tech50Route(w: World, selected: Iterable<number>, hit: OrderHit): OrderRoute | null | undefined {
  if (!armed) return undefined;
  const cell = hit.building ?? (hit.ground ? [Math.floor(hit.ground.x), Math.floor(hit.ground.z)] : null);
  if (!cell) return null;
  const [x, z] = cell, ids = [...selected].filter(id => UNIT_KINDS[w.units[id - 1]?.kind]?.demo), why = why50(w, SIDE_PLAYER, armed, { x, z, ids });
  if (why) { flash = why; flashTick = w.tick; return null; }
  const kind = armed; armed = 0; flash = '';
  return { commands: [{ t: 'construct', side: SIDE_PLAYER, ids: builders50(w, SIDE_PLAYER, ids).map(u => u.id), kind, x, z }], marker: { x: x + 1, z: z + 1, hostile: false } };
}

// 提示列（HUD 每次更新都問）：選好的時候說怎麼放；剛放不下就說原因（3 秒）。順便：換了世界就取消、生產列那一顆亮著
export function hint50(w: World): string | undefined {
  if (w !== world) { world = w; armed = 0; flash = ''; }
  if (typeof document !== 'undefined') for (const k of [BK_BARRACKS, BK_DEPOT, BK_SUPPLY]) { const b = document.getElementById('pb-k' + (ITEM50 + k)); if (b && b.classList.contains('armed50') !== (armed === k)) { b.classList.toggle('armed50', armed === k); b.setAttribute('aria-pressed', String(armed === k)); } }
  const m9 = hint1009(w); if (!armed) return m9;   // R1009：地雷的提示與按鍵亮不亮每次都問（建造沒選好時用地雷的提示）
  if (!armed) return undefined;
  const how = `建造${NAME[armed]}：先選工兵，再點指揮部 8 格內的空地（2×2，點的那一格是左上角）；再按一次取消`;
  return flash && w.tick - flashTick < 60 ? `放不下：${flash}。${how}` : how;
}
if (typeof addEventListener !== 'undefined') addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') { armed = 0; flash = ''; } });
