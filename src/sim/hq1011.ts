// R1011 指揮部升級：生產列直接買兩級——沙包加固（1201）、電話交換台（1202）。eco 帶 hq11＝1 才有；沒有 hq11 的局，這裡一行都不會走到。
// 升級的那幾步這一方生產暫停；第 1 級指揮部血上限與血各 +600；第 2 級每一個兵開工那一步，指揮部還有屋頂就先做好四分之一。
// 卡面：docs/tasks/R1011-指揮部升級.md。只用整數、不抽亂數；只 import ./world.ts（指揮部照 tech50.ts 的 hqOf 自己找，不 import eco.ts，免得循環）。
import { BK_HQ, STAGE_INTACT, bldMaxHp, stageOf, type World, type Building } from './world.ts';

export const HQ_SAND = 1201;    // produce 的假編號：1200＋級（兵種只到 48、步兵排 256、R050 的 1014–1016；R1009 的草稿用 1101、1102）
export const HQ_PHONE = 1202;
export interface Hq11 { lv: number; cost: number; ticks: number }
// 做好之後是第幾級、補給、要做幾步；數字都是暫定，理由在卡面「數字與出處」
export const HQ11: Record<number, Hq11> = {
  [HQ_SAND]: { lv: 1, cost: 30, ticks: 300 },
  [HQ_PHONE]: { lv: 2, cost: 40, ticks: 400 },
};
export const SAND_HP = 600;     // 沙包加固：指揮部血上限與血各加這麼多（1,200 → 1,800）

const hqOf = (w: World, side: number): Building | null => { const id = w.eco?.hq[side] ?? 0, b = id ? w.blds[id - 1] : null; return b && b.hp > 0 ? b : null; };

// 接不接：'' 接；不然回原因（介面與模擬共用，照卡面 2.2 的順序）
export function why1011(w: World, side: number, kind: number): string {
  if (!w.eco?.hq11 || w.zombies || w.sandbox || w.winner >= 0 || (side !== 0 && side !== 1)) return '本局未開放';
  const hq = hqOf(w, side), spec = HQ11[kind];
  if (!hq) return '指揮部已毀';
  if (!spec) return '不能這樣升級';
  if (hq.hqUp !== undefined) return '正在升級';
  if (kind === HQ_SAND && hq.hqLv !== undefined) return '已經加固';
  if (kind === HQ_PHONE && hq.hqLv === undefined) return '要先加固指揮部';
  if (kind === HQ_PHONE && hq.hqLv !== 1) return '已經有交換台';
  if (w.eco.supply[side] < spec.cost) return `補給不足，還差 ${spec.cost - w.eco.supply[side]}`;
  return '';
}

// produce 1201／1202（eco.ts 的 produce 最前面轉過來）：接了就扣補給、開始倒數；這一步沒有別的變化
export function order1011(w: World, side: number, kind: number): void {
  if (why1011(w, side, kind) !== '') return;
  const hq = hqOf(w, side)!, spec = HQ11[kind];
  w.eco!.supply[side] -= spec.cost;
  hq.hqUp = spec.ticks;
}

// ecoStep 每一步（補給進帳之後、讀生產佇列之前）：升級中＝這一方生產暫停。回 true＝這一步暫停。
// 減到 0 的那一步做好：級數加 1；第 1 級血上限與血各 +600（段數變了照 R050 推 stage）；一律推 hq11（畫面重建城鎮網格）；這一步也算暫停
export function tick1011(w: World, hq: Building): boolean {
  const up = (hq.hqUp ?? 1) - 1;
  if (up > 0) { hq.hqUp = up; return true; }
  delete hq.hqUp;
  const lv = (hq.hqLv ?? 0) + 1, before = stageOf(hq);
  hq.hqLv = lv;
  if (lv === 1) { hq.maxHp += SAND_HP; hq.hp += SAND_HP; }
  const after = stageOf(hq);
  if (after !== before) w.events.push({ e: 'stage', bld: hq.id, stage: after });
  w.events.push({ e: 'hq11', bld: hq.id });
  return true;
}

// 交換台通不通（只看開工那一刻）：第 2 級、指揮部還有屋頂（stageOf 完好：血 × 10 > 上限 × 7）
export const phone1011 = (w: World, hq: Building): boolean => !!w.eco?.hq11 && hq.hqLv === 2 && stageOf(hq) === STAGE_INTACT;

// 存檔：hq11 只能沒有或 1、要跟 tech 一起；沒有 hq11 就沒有任何 hqLv、hqUp；有的話只在登記的指揮部上，
// hqLv 是 1 或 2，hqUp 在 1 到那一級的步數之間（第 2 級不會再有 hqUp），登記的指揮部血上限是 1,200（0 級）或 1,800（1、2 級）
export function hq11Ok(r: Record<string, unknown>): boolean {
  const e = r.eco as { hq11?: unknown; tech?: unknown; hq?: unknown } | undefined, blds = r.blds as Record<string, unknown>[];
  const marked = (b: Record<string, unknown>) => b.hqLv !== undefined || b.hqUp !== undefined;
  if (e && e.hq11 !== undefined && e.hq11 !== 1) return false;
  if (e?.hq11 !== 1) return !blds.some(marked);
  if (e.tech !== 1 || !Array.isArray(e.hq)) return false;
  const hqs = new Set<number>();
  for (const id of e.hq as unknown[]) if (Number.isInteger(id) && (id as number) >= 1 && (id as number) <= blds.length && blds[(id as number) - 1].kind === BK_HQ) hqs.add(id as number);
  if (blds.some((b, i) => marked(b) && !hqs.has(i + 1))) return false;
  for (const id of hqs) {
    const b = blds[id - 1], lv = b.hqLv, up = b.hqUp;
    if (lv !== undefined && lv !== 1 && lv !== 2) return false;
    const next = lv === undefined ? HQ_SAND : HQ_PHONE;
    if (up !== undefined && (lv === 2 || !Number.isInteger(up) || (up as number) < 1 || (up as number) > HQ11[next].ticks)) return false;
    if (b.maxHp !== bldMaxHp(BK_HQ, 2, 2, 1) + (lv ? SAND_HP : 0)) return false;
  }
  return true;
}
