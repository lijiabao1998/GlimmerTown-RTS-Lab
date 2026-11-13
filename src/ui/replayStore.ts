// R047 重播紀錄：格式（第 1 版）、檢查、轉成文字與讀回、本機儲存。不碰 DOM、不碰世界（Node 守衛直接測）。
// 紀錄＝種子＋指令紀錄＋存檔那一刻的步數與世界雜湊；重播跑到那一步時比對雜湊，對得上才說「跟原局相同」。
// 之後改格式就加版本號；第 1 版永遠要讀得進來，讀不懂的東西一律拒收並說原因，不讓頁面壞掉。
import { checkLog, MAX_TICK } from '../sim/commandCheck.ts';
import type { LoggedCommand } from '../sim/step.ts';

export const REPLAY_KEY = 'gtrts.v1.replays';
export const REPLAY_KEEP = 10;                 // 本機最多留幾筆（最新在前）
export const REPLAY_MAX_TEXT = 1_000_000;      // 一筆紀錄的文字最多幾個字元（半小時的一局大約二十萬）
export const REPLAY_BUDGET = 1_500_000;        // 本機全部紀錄加起來最多幾個字元（這個網域跟另外三條線共用本機空間）

export interface ReplayMeta { map: number; n: number; winner: number; seconds: number; wave?: number }   // 只給列表顯示，不影響重播
export interface ReplayRecord { v: 1; seed: number; ticks: number; hash: string; log: LoggedCommand[]; at: string; meta: ReplayMeta }
export type Decoded = { ok: true; rec: ReplayRecord } | { ok: false; why: string };
export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }

const no = (why: string): Decoded => ({ ok: false, why });
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

// 存檔：只留已經套用過的指令（tick < ticks）；紀錄跟遊戲手上的那份分開（深拷貝）
export function makeRecord(seed: number, ticks: number, hash: string, log: readonly LoggedCommand[], meta: ReplayMeta, at: string): ReplayRecord {
  return { v: 1, seed: seed >>> 0, ticks, hash, log: JSON.parse(JSON.stringify(log.filter(c => c.tick < ticks))) as LoggedCommand[], at, meta: { ...meta } };
}

export function checkRecord(x: unknown): Decoded {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return no('這不是重播紀錄');
  const r = x as Record<string, unknown>;
  if (r.v !== 1) return no(`不認得的紀錄版本（${typeof r.v === 'number' || typeof r.v === 'string' ? String(r.v).slice(0, 12) : '看不懂'}）；這一版遊戲只讀第 1 版`);
  if (!int(r.seed, 0, 0xffffffff)) return no('紀錄的種子不對');
  if (!int(r.ticks, 1, MAX_TICK)) return no('紀錄的步數不對');
  if (typeof r.hash !== 'string' || !/^[0-9a-f]{8}$/.test(r.hash)) return no('紀錄的雜湊不對');
  const why = checkLog(r.log);
  if (why) return no(why);
  const m = (typeof r.meta === 'object' && r.meta !== null ? r.meta : {}) as Record<string, unknown>;
  const meta: ReplayMeta = {
    map: int(m.map, 0, 99) ? m.map : 0, n: int(m.n, 1, 4096) ? m.n : 0, winner: int(m.winner, -1, 2) ? m.winner : -1,
    seconds: int(m.seconds, 0, MAX_TICK) ? m.seconds : Math.floor(r.ticks / 20), ...(int(m.wave, 0, 1000000) ? { wave: m.wave } : {}),
  };
  return { ok: true, rec: { v: 1, seed: r.seed, ticks: r.ticks, hash: r.hash, log: r.log as LoggedCommand[], at: typeof r.at === 'string' ? r.at.slice(0, 40) : '', meta } };
}

export const encodeReplay = (rec: ReplayRecord): string => JSON.stringify(rec);
export function decodeReplay(text: string): Decoded {
  if (typeof text !== 'string' || text.length > REPLAY_MAX_TEXT) return no('檔案太大，不像重播紀錄');
  let x: unknown;
  try { x = JSON.parse(text); } catch { return no('這個檔不是 JSON，讀不出來'); }
  try { return checkRecord(x); } catch { return no('這個檔的內容看不懂'); }   // 不管裡面塞什麼，都只回「讀不出來」，不往外丟例外
}

export const sameReplay = (a: ReplayRecord, b: ReplayRecord): boolean => a.seed === b.seed && a.ticks === b.ticks && a.hash === b.hash && a.log.length === b.log.length;

// 讀本機的紀錄：讀不到、讀到壞掉的東西都當作沒有；壞掉的單筆略過
export function loadReplays(store: Store | null): ReplayRecord[] {
  try {
    const raw = store?.getItem(REPLAY_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: ReplayRecord[] = [];
    for (const x of list) { const d = checkRecord(x); if (d.ok && out.length < REPLAY_KEEP) out.push(d.rec); }
    return out;
  } catch { return []; }
}

// 加一筆到最前面（同一局已經在裡面就先拿掉舊的），只留 REPLAY_KEEP 筆、總字數不超過 REPLAY_BUDGET；放不下就從最舊的丟到放得下為止。
// 回傳本機現在真的存著的列表：新的那一筆連自己都放不下、或瀏覽器根本不讓存時，它不會在裡面（呼叫的人用 sameReplay 找得到才算存成功）
export function addReplay(store: Store | null, rec: ReplayRecord): ReplayRecord[] {
  if (JSON.stringify(rec).length > REPLAY_MAX_TEXT) return loadReplays(store);   // 單筆就超過匯入上限的不存（存了也匯不回來）
  const list = [rec, ...loadReplays(store).filter(r => !sameReplay(r, rec))].slice(0, REPLAY_KEEP);
  while (list.length) {
    const text = JSON.stringify(list);
    if (text.length <= REPLAY_BUDGET) { try { store?.setItem(REPLAY_KEY, text); break; } catch { /* 空間不夠：丟最舊的再試 */ } }
    list.pop();
  }
  return loadReplays(store);
}

export const browserStore = (): Store | null => { try { return localStorage; } catch { return null; } };

const MAP_NAME: Record<number, string> = { 0: '村莊', 1: '萊伊', 2: '鄉間', 3: '河鎮' };
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
// 存檔時間存的是世界協調時間（ISO 字串）；列表上換成這台機器的當地時間。讀不懂就不顯示
function when(at: string): string {
  const d = new Date(at), two = (n: number) => String(n).padStart(2, '0');
  return at && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}` : '';
}
// 列表上的兩行字
export function replayTitle(rec: ReplayRecord): { label: string; sub: string } {
  const m = rec.meta, result = m.wave !== undefined ? `喪屍第 ${m.wave} 波` : m.winner === 0 ? '勝利' : m.winner === 1 ? '戰敗' : m.winner === 2 ? '同歸於盡' : '未分勝負';
  return { label: `${result} · ${MAP_NAME[m.map] ?? '地圖'}${m.n ? ` ${m.n}×${m.n}` : ''}`, sub: `${clock(m.seconds)} · 種子 ${rec.seed}${when(rec.at) ? ` · ${when(rec.at)}` : ''}` };
}
