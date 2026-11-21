// R1011 指揮部升級的介面：生產列 R142 分組選單的「指揮部」一組（加固指揮部、電話交換台；按了就送 produce 1201／1202，不用選、不用點地圖）、
// 不能按的理由（跟模擬同一支 why1011）、R127「我方指揮部」那一行的尾巴（幾級、在升級、交換台通不通）。只讀世界，不進模擬。
import { HQ_SAND, HQ_PHONE, HQ11, why1011 } from '../sim/hq1011.ts';
import { TICK_HZ, STAGE_INTACT, stageOf, type World, type Building } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）

const NAME: Record<number, string> = { [HQ_SAND]: '加固指揮部', [HQ_PHONE]: '電話交換台' };
const ROLE: Record<number, string> = {
  [HQ_SAND]: '加固指揮部 · 沙包牆加高、門口擋一道：指揮部血 1,200 → 1,800；做 15 秒，這段時間不出兵',
  [HQ_PHONE]: '電話交換台 · 要先加固；之後每個兵少等四分之一的時間（指揮部打到七成血以下就斷線）；做 20 秒，這段時間不出兵',
};
export const hq1011Items = () => [HQ_SAND, HQ_PHONE].map(k => ({ kind: k, label: NAME[k], cost: HQ11[k].cost, group: '指揮部', role: ROLE[k] }));

// 不能按的理由：那兩項看 why1011；別的回 undefined（照原本的理由）
export function block1011(w: World, kind: number): string | undefined {
  return kind === HQ_SAND || kind === HQ_PHONE ? why1011(w, SIDE_PLAYER, kind) : undefined;
}

// R127 那一行的尾巴（hqDurability.ts 接在 return 的字後面）：沒有 hq11 的局、沒升過也沒在升的指揮部回 ''
export function tag1011(w: World, b: Building): string {
  if (!w.eco?.hq11 || b.hp <= 0 || (b.hqLv === undefined && b.hqUp === undefined)) return '';
  const left = b.hqUp !== undefined ? `，還要 ${Math.ceil(b.hqUp / TICK_HZ)} 遊戲秒（生產暫停）` : '';
  if (b.hqLv === undefined) return ` · 加固中${left}`;
  if (b.hqLv === 1) return b.hqUp !== undefined ? ` · 已加固 · 架交換台中${left}` : ' · 已加固';
  return ` · 已加固 · 交換台${stageOf(b) === STAGE_INTACT ? '通' : '斷線'}`;
}
