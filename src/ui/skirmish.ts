// R046 遭遇戰設定（介面這一半）：兵力、補給速度、亂數村莊的狀態；讀網址；產生第 0 步的 rules 指令。
// 模擬那一半在 src/sim/rules.ts。種子由 main.ts 自己拿著（重播、守衛都用它），這裡只管怎麼讀、怎麼抽。
// 亂數村莊＝萊伊那一格換成 createWorld 原本的村莊（地圖 0）；main.ts 的 reset() 看 village 決定地圖編號。
import { applyRules, type RulesCmd } from '../sim/rules.ts';
import type { World } from '../sim/world.ts';

export const FORCE_TEXT = ['', '精簡', '標準', '加倍'];
export const FORCE_SUB = ['', '約一半', '照原樣', '兩倍'];
export const SUPPLY_TEXT = ['', '慢', '標準', '快'];
export const SUPPLY_SUB = ['', '每 2 秒 +1', '每秒 +1', '每秒 +2'];
export const SEED_MAX = 0xffffffff;

// 網址的 ?force=、?supply=：只認 1 與 3，其他（含沒給、亂寫）都是標準
export const level = (v: string | null | undefined): number => (v === '1' ? 1 : v === '3' ? 3 : 2);
// 種子輸入：只收 0–4294967295 的十進位整數；其他回傳 null（輸入框改回原值）
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= SEED_MAX ? n : null;
}
// 兩項都是標準就不發指令（世界、紀錄都跟沒有這張卡時一樣）
export const rulesCommand = (force: number, supply: number): RulesCmd | undefined =>
  force === 2 && supply === 2 ? undefined : { t: 'rules', ...(force !== 2 ? { force } : {}), ...(supply !== 2 ? { income: supply } : {}) };
export const setupSummary = (force: number, supply: number, seed: number): string => `兵力 ${FORCE_TEXT[force]} · 補給 ${SUPPLY_TEXT[supply]} · 種子 ${seed}`;
export const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

export interface Skirmish {
  readonly force: number; readonly supply: number;
  readonly village: boolean;    // 現在選的是不是亂數村莊（R026 閥關著時萊伊那一格本來就是村莊，這裡永遠是 false）
  set: (patch: { force?: number; supply?: number; village?: boolean }) => void;
  start: (w: World) => RulesCmd | undefined;   // 新的一局：直接套到世界上（布陣時就看得到），回傳要記進紀錄的指令
}

// canVillage：R026 閥開著（萊伊在）才另外有「村莊」可選
export function initSkirmish(q: URLSearchParams, canVillage: boolean): Skirmish {
  const s = { force: level(q.get('force')), supply: level(q.get('supply')), village: canVillage && q.get('map') === 'village' };
  return {
    get force() { return s.force; }, get supply() { return s.supply; }, get village() { return s.village; },
    set: p => {
      if (p.force !== undefined) s.force = level(String(p.force));
      if (p.supply !== undefined) s.supply = level(String(p.supply));
      if (p.village !== undefined) s.village = canVillage && p.village;
    },
    start: w => { const cmd = rulesCommand(s.force, s.supply); if (cmd) applyRules(w, cmd); return cmd; },
  };
}
