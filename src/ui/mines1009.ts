// R1009 地雷與排雷（介面）：生產列 R142 分組選單裡的「地雷」一組（反戰車雷、反人員雷）。按了不是生產，是「選好要布哪一種」；
// 選好之後點地圖：選取裡的工兵布一條三格的雷帶（放不下就只布一格；原因跟模擬同一支 why1009）。沒選好時點到我方知道的雷＝工兵去排、自己還沒布好的＝接著布。
// 三個模式互斥：地雷、R050 建造、R093 空中鍵（R1004 第 3 條）。只在這一頁，不進模擬。import 這個模組時不碰 DOM（Node 的守衛會 import）。
import { UNIT_KINDS, cellOf, type World } from '../sim/world.ts';
import { MINES1009, LEN1009, why1009, mineAt1009, known1009 } from '../sim/mines1009.ts';
import { builders50 } from '../sim/tech50.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { OrderHit, OrderRoute } from './smoke.ts';
import { air93Arm } from './air93.ts';   // 選好地雷就把空中鍵放下（air93.ts → tech50.ts 的 arm50 → 這裡的 pick1009：只在按鍵時呼叫，循環沒有關係）

export const ITEM1009 = 1100;   // 生產列的假編號：1100＋雷的種類（1101、1102；兵種只到 48、步兵排 256、R050 是 1014–1016、R1007 沙包的草稿用 1017）
const NAME: Record<number, string> = { 1: '反戰車雷', 2: '反人員雷' };
const ROLE: Record<number, string> = {
  1: '反戰車雷 · 工兵布，每格 15；車和砲壓到就炸（坦克扣 60、裝甲車和卡車一顆就毀），人走過去不響；敵人要派工兵戳到才排得掉',
  2: '反人員雷 · 工兵布，每格 10；任何地面單位踩到就炸（步兵班倒一半），有裝甲的車壓過去不掉血；敵人要派工兵戳到才排得掉',
};
export const mine1009Items = () => [1, 2].map(k => ({ kind: ITEM1009 + k, label: NAME[k], cost: MINES1009[k].cost, group: '地雷', role: ROLE[k] }));
// 生產列的「地雷」組、新開的局 eco 帶 mine：條件＝送得出 sw＝2（R091 加 R1002，R1004）、而且 R1009 開著。main.ts 兩處共用這一支
export const on1009 = (V: { r1009: boolean; r1002: boolean; r091: boolean }): boolean => V.r1009 && V.r1002 && V.r091;

let armed = 0, flash = '', flashTick = -1, world: World | null = null;

// 生產列按了（R050 的 pick50 最前面先問這裡）：地雷那兩項＝選好／再按一次取消，順便放下空中鍵，回傳 true；
// 其他編號（別的生產鍵、R050 的建造鍵、空中鍵經過 arm50(0)）一律放掉地雷、回 false
export function pick1009(kind: number): boolean {
  const k = kind - ITEM1009;
  if (k !== 1 && k !== 2) { armed = 0; flash = ''; return false; }
  armed = armed === k ? 0 : k; flash = '';
  if (armed) air93Arm(0);
  return true;
}
export const armed1009 = (): number => armed;

// 不能按的理由：地雷那兩項看 why1009（不給位置）；其他回 undefined（照原本的理由）
export function block1009(w: World, kind: number): string | undefined {
  const k = kind - ITEM1009;
  return k === 1 || k === 2 ? why1009(w, SIDE_PLAYER, k) : undefined;
}

// smoke.ts 的 routeBattleOrder（R050 建造那一行後面）：
//   選好了＝送 mine（以點的那一格為中心的三格，跟工兵過來的方向垂直；放不下就只布一格），或 null（都放不下：說原因、保持選好）；
//   沒選好＝點到自己還沒布好的、我方知道的敵方雷，選取裡有工兵：只有工兵收射擊指令；點到敵兵、煙幕射擊模式、其他情況回 undefined（照原本的路由）
export function route1009(w: World, selected: Iterable<number>, hit: OrderHit, fireMode: boolean, ammo: string): OrderRoute | null | undefined {
  const cell = hit.building ?? (hit.ground ? [Math.floor(hit.ground.x), Math.floor(hit.ground.z)] : null);
  if (armed) {
    if (!cell) return null;
    const [cx, cz] = cell, eng = builders50(w, SIDE_PLAYER, [...selected]), ids = eng.map(u => u.id);
    const ex = eng.reduce((a, u) => a + cellOf(u.x), 0) / Math.max(1, eng.length), ez = eng.reduce((a, u) => a + cellOf(u.z), 0) / Math.max(1, eng.length);
    const rot = Math.abs(cx - ex) >= Math.abs(cz - ez) ? 1 : 0, half = (LEN1009 - 1) / 2;
    const tries = [{ x: rot ? cx : cx - half, z: rot ? cz - half : cz, len: LEN1009 }, { x: cx, z: cz, len: 1 }];
    let why = '';
    for (const t of tries) {
      why = why1009(w, SIDE_PLAYER, armed, { x: t.x, z: t.z, ids, rot, len: t.len });
      if (why) continue;
      const kind = armed; armed = 0; flash = '';
      return { commands: [{ t: 'mine', side: SIDE_PLAYER, ids, kind, x: t.x, z: t.z, rot, len: t.len }], marker: { x: cx + 0.5, z: cz + 0.5, hostile: false } };
    }
    flash = why; flashTick = w.tick;
    return null;
  }
  if (!cell || hit.building || (fireMode && ammo === 'smoke')) return undefined;
  const t = hit.unit ? w.units[hit.unit - 1] : null;
  if (t && t.side !== SIDE_PLAYER) return undefined;   // 點到站在那一格上的敵人：照原本的攻擊
  const [x, z] = cell;
  if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= w.n || z >= w.n) return undefined;
  const own = mineAt1009(w, SIDE_PLAYER, x, z), foe = mineAt1009(w, 1 - SIDE_PLAYER, x, z);
  if (!(own && own.left > 0) && !(foe && known1009(w, SIDE_PLAYER, foe))) return undefined;   // 我方不知道的雷＝點空地（介面本來也不知道）
  const eng = [...selected].filter(id => { const u = w.units[id - 1]; return !!u && u.alive && u.side === SIDE_PLAYER && !!UNIT_KINDS[u.kind].demo; });
  if (!eng.length) return undefined;
  return { commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: eng, x, z }], marker: { x: x + 0.5, z: z + 0.5, hostile: true } };   // 選取裡其他單位不下指令（不讓它們走進雷裡）
}

// 提示列（R050 的 hint50 每次都先問這裡）：選好的時候說怎麼放；剛放不下就說原因（3 秒）。順便：換了世界就取消、生產列那兩顆亮不亮
export function hint1009(w: World): string | undefined {
  if (w !== world) { world = w; armed = 0; flash = ''; }
  if (typeof document !== 'undefined') for (const k of [1, 2]) { const b = document.getElementById('pb-k' + (ITEM1009 + k)); if (b && b.classList.contains('armed50') !== (armed === k)) { b.classList.toggle('armed50', armed === k); b.setAttribute('aria-pressed', String(armed === k)); } }
  if (!armed) return undefined;
  const how = `布${NAME[armed]}：先選工兵，再點要布的那一格；會往兩邊延伸成三格的雷帶，跟工兵過來的方向垂直，三格放不下就只布一格；再按一次取消`;
  return flash && w.tick - flashTick < 60 ? `放不下：${flash}。${how}` : how;
}
if (typeof addEventListener !== 'undefined') addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') { armed = 0; flash = ''; } });
