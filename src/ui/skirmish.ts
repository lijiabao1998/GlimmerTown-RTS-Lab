// R046 遭遇戰設定（介面這一半）：兵力、補給速度、亂數村莊的狀態；讀網址；產生第 0 步的 rules 指令。
// 模擬那一半在 src/sim/rules.ts。種子由 main.ts 自己拿著（重播、守衛都用它），這裡只管怎麼讀、怎麼抽。
// 亂數村莊＝萊伊那一格換成 createWorld 原本的村莊（地圖 0）；main.ts 的 reset() 看 village 決定地圖編號。
import { applyRules, type RulesCmd } from '../sim/rules.ts';
import { SCRIPT_SEED } from '../sim/script.ts';
import type { World } from '../sim/world.ts';
import { valves } from '../valves.ts';
import { browserStore, type Store } from './replayStore.ts';

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
export const rulesCommand = (force: number, supply: number, ap = false): RulesCmd | undefined =>
  force === 2 && supply === 2 && !ap ? undefined : { t: 'rules', ...(force !== 2 ? { force } : {}), ...(supply !== 2 ? { income: supply } : {}), ...(ap ? { ap: 1 } : {}) };   // ap（R051）：穿甲與裝甲厚度
export const setupSummary = (force: number, supply: number, seed: number, ap = false): string => `兵力 ${FORCE_TEXT[force]} · 補給 ${SUPPLY_TEXT[supply]} · 種子 ${seed}${ap ? ' · 穿甲' : ''}`;
export const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

// ---- R073 記住上次的設定：存本機，下次開頁（網址沒帶任何設定時）照舊 ----
export const SETUP_KEY = 'gtrts.v1.setup';
export const DEFAULT_SEED = SCRIPT_SEED;
export const SETUP_PARAMS = ['seed', 'map', 'mode', 'ai', 'force', 'supply', 'ap'];   // 網址帶了其中任何一項＝整份照網址，不用存下來的
export type SetupMap = 'rye' | 'village' | '64' | '96';
export interface SavedSetup { v: 1; map: SetupMap; mode: 'battle' | 'zombies'; ai: number; force: number; supply: number; seed: number; ap?: 1 }   // ap（R051）：開著才有這一欄
const aiLevel = (v: unknown): number => (v === 1 || v === 3 ? v : 2);
const three = (v: unknown): number => (v === 1 || v === 3 ? v : 2);

// 讀本機那一份：讀不到、不是第 1 版、壞掉 → null；個別欄位亂填 → 那一欄用預設值。不丟例外
export function loadSetup(store: Store | null): SavedSetup | null {
  try {
    const raw = store?.getItem(SETUP_KEY);
    if (!raw) return null;
    const x: unknown = JSON.parse(raw);
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (r.v !== 1) return null;
    const seed = typeof r.seed === 'number' && Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= SEED_MAX ? r.seed : DEFAULT_SEED;
    return { v: 1, map: r.map === 'village' || r.map === '64' || r.map === '96' ? r.map : 'rye', mode: r.mode === 'zombies' ? 'zombies' : 'battle', ai: aiLevel(r.ai), force: three(r.force), supply: three(r.supply), seed, ...(r.ap === 1 ? { ap: 1 as const } : {}) };
  } catch { return null; }
}
export function saveSetup(store: Store | null, setup: SavedSetup): void {
  try { store?.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* 存不了（隱私模式、空間滿）就算了 */ }
}

let memory: Store | null = null;   // 這一頁有沒有開記憶（restoreSetup 決定；initSkirmish 照它存）
let linked = false;                // 這一頁是不是用帶設定的網址開的（是的話，沒動過設定就不蓋掉原本記住的那一份）
// main.ts 讀網址參數時先過這一關：開始選單、遭遇戰設定、這張卡的閥都開著才記；
// 網址沒帶任何設定項時，把存下來的那一份填進這次的參數（只改記憶體裡這一份，不動網址列）
export function restoreSetup(q: URLSearchParams, store: Store | null = browserStore()): URLSearchParams {
  const V = valves(q);
  memory = V.r069 && V.r046 && V.r073 ? store : null;
  linked = SETUP_PARAMS.some(k => q.has(k) && !(k === 'ap' && !V.r051));   // R051 的閥關著時，網址上的 ap 不算帶了設定
  if (!memory || linked) return q;
  const s = loadSetup(memory);
  if (!s) return q;
  if (s.map !== 'rye') q.set('map', s.map);
  if (s.mode === 'zombies') q.set('mode', 'zombies');
  if (s.ai !== 2) q.set('ai', String(s.ai));
  if (s.force !== 2) q.set('force', String(s.force));
  if (s.supply !== 2) q.set('supply', String(s.supply));
  if (s.seed !== DEFAULT_SEED) q.set('seed', String(s.seed));
  if (s.ap) q.set('ap', '1');
  return q;
}

export interface Skirmish {
  readonly force: number; readonly supply: number;
  readonly village: boolean;    // 現在選的是不是亂數村莊（R026 閥關著時萊伊那一格本來就是村莊，這裡永遠是 false）
  readonly remembers: boolean;  // R073：這一頁會把設定存到本機（設定頁才有「恢復預設」）
  readonly ap: boolean;         // R051：穿甲與裝甲厚度開著
  readonly canAp: boolean;      // R051：這一頁有這顆開關（閥開著）
  set: (patch: { force?: number; supply?: number; village?: boolean; ai?: number; ap?: boolean }) => void;
  start: (w: World) => RulesCmd | undefined;   // 新的一局：直接套到世界上（布陣時就看得到），回傳要記進紀錄的指令
}

// canVillage：R026 閥開著（萊伊在）才另外有「村莊」可選
export function initSkirmish(q: URLSearchParams, canVillage: boolean): Skirmish {
  const store = memory, canAp = valves(q).r051;
  const keptAp = !canAp && loadSetup(store)?.ap === 1;   // R051 的閥關著的這一頁：本機原本記著的 ap 原樣留著，不因為這一頁看不到就洗掉
  let owned = !linked, pristine: string | null = null;   // 用連結開的頁：第一次只記下「連結給的那一份」，之後跟它不一樣了才開始存
  const s = { force: level(q.get('force')), supply: level(q.get('supply')), village: canVillage && q.get('map') === 'village', ai: Math.max(1, Math.min(3, Number(q.get('ai') ?? 2) | 0 || 2)), ap: canAp && q.get('ap') === '1' };   // 難度的讀法跟 main.ts 一樣
  // R073：最近開的那一局是哪張圖、哪個模式、哪個種子（start() 從世界讀）；還沒開過局就還沒有東西可存
  let last: { map: SetupMap; mode: 'battle' | 'zombies'; seed: number } | null = null;
  const persist = () => {
    if (!store || !last) return;
    const now: SavedSetup = { v: 1, ...last, ai: s.ai, force: s.force, supply: s.supply, ...(s.ap || keptAp ? { ap: 1 as const } : {}) }, text = JSON.stringify(now);
    if (!owned) { if (pristine === null) { pristine = text; return; } if (text === pristine) return; owned = true; }
    saveSetup(store, now);
  };
  return {
    get force() { return s.force; }, get supply() { return s.supply; }, get village() { return s.village; }, remembers: !!store, get ap() { return s.ap; }, canAp,
    set: p => {
      if (p.force !== undefined) s.force = level(String(p.force));
      if (p.supply !== undefined) s.supply = level(String(p.supply));
      if (p.village !== undefined) s.village = canVillage && p.village;
      if (p.ai !== undefined) s.ai = aiLevel(p.ai);
      if (p.ap !== undefined) s.ap = canAp && p.ap;
      persist();
    },
    start: w => {
      const cmd = rulesCommand(s.force, s.supply, s.ap);
      if (cmd) applyRules(w, cmd);
      if (w.sandbox) return cmd;   // 沙盒不記（main.ts 本來就不會拿沙盒世界來，這裡再擋一次）
      // 地圖、種子從世界讀；模式跟 main.ts 的 reset() 用同一個條件（喪屍要等這裡回去之後才開始，世界上還看不到）
      last = { map: w.map === 2 ? '64' : w.map === 3 ? '96' : w.map === 1 ? 'rye' : 'village', mode: valves(q).r045 && q.get('mode') === 'zombies' ? 'zombies' : 'battle', seed: w.seed };
      persist();
      return cmd;
    },
  };
}
