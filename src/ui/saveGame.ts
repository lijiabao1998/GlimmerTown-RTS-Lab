// R074 繼續上一局：打到一半的局存在本機（只有一格），下次開頁可以接著打。
// 存的是整個世界（src/sim/worldCodec.ts）＋到目前為止的指令紀錄＋戰報統計＋鏡頭；讀回來要通過一串檢查才算數（見 checkSave）。
// 什麼時候存：開戰之後每 5 秒看一次（世界有往前走才存）、分頁被切到背景、頁面要離開、從暫停選單回主選單。
// 不存：布陣階段、沙盒、正在看的重播。分出勝負就把存檔清掉（那一局已經在 R047 的重播裡）。
import { hashWorld, type World } from '../sim/world.ts';
import { step, type LoggedCommand } from '../sim/step.ts';
import { checkLog, MAX_TICK } from '../sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../sim/worldCodec.ts';
import type { Store } from './replayStore.ts';
import type { BattleStats } from './report.ts';

export const SAVE_KEY = 'gtrts.v1.save';
export const SAVE_VERSION = 1;          // 存檔的版本。舊存檔在新版讀不回來、或接著打會不一樣時加一（舊的就當作沒有）；tests/savegame.mjs 的 old 那一群拿一份當初存的檔看著這件事
export const SAVE_MAX_TEXT = 1_500_000;   // 一筆存檔的文字最多幾個字元（這個網域跟另外三條線共用本機空間）
export const SAVE_EVERY_MS = 5000;

export interface Camera { x: number; z: number; zoom: number }
export interface SaveGame { world: World; log: LoggedCommand[]; at: string; cam: Camera | null; stats: BattleStats | null }   // stats：戰報的統計（開火數、跳彈數、最後一擊）；讀不出來就是 null，接回去時從那一刻重新算
export type Loaded = { ok: true; save: SaveGame } | { ok: false; why: string };
export interface SaveStore extends Store { removeItem(key: string): void }

const no = (why: string): Loaded => ({ ok: false, why });
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 這個世界現在能不能存：開戰之後、還沒分出勝負、不是沙盒
export const savable = (w: World): boolean => !w.sandbox && w.winner < 0 && w.tick > 0;

// 做成存檔的文字；不能存、或太大，回傳 null
export function makeSave(w: World, log: readonly LoggedCommand[], cam: Camera | null, at: string, stats: BattleStats | null = null): string | null {
  if (!savable(w)) return null;
  const text = JSON.stringify({ v: SAVE_VERSION, at, seed: w.seed, tick: w.tick, hash: hashWorld(w), world: encodeWorld(w), log, cam, stats });
  return text.length <= SAVE_MAX_TEXT ? text : null;
}

// 戰報統計：形狀不對就整份不要（回 null），不會讓存檔作廢
function readStats(x: unknown): BattleStats | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>, nat = (v: unknown): v is number => int(v, 0, 1e9);
  const row = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(nat);
  if (!Array.isArray(r.start) || r.start.length !== 2 || !r.start.every(a => row(a, 4)) || !row(r.fires, 2) || r.endTick !== -1) return null;
  if (r.bounces !== undefined && !row(r.bounces, 2)) return null;
  const k = r.lastKill as Record<string, unknown> | null;
  if (k !== null && !(typeof k === 'object' && int(k.x, -1e8, 1e8) && int(k.z, -1e8, 1e8) && int(k.tick, 0, MAX_TICK))) return null;
  return { start: (r.start as number[][]).map(a => [...a]), fires: [...r.fires], lastKill: k ? { x: k.x as number, z: k.z as number, tick: k.tick as number } : null, endTick: -1, ...(r.bounces ? { bounces: [...(r.bounces as number[])] } : {}) };
}

// 讀回來：下面每一條都要成立，少一條就不算有存檔。不管塞什麼進來都只回「不行」與原因，不丟例外
export function checkSave(text: string): Loaded {
  try {
    if (typeof text !== 'string' || text.length > SAVE_MAX_TEXT) return no('存檔太大');
    let x: unknown;
    try { x = JSON.parse(text); } catch { return no('存檔不是 JSON'); }
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return no('這不是存檔');
    const r = x as Record<string, unknown>;
    if (r.v !== SAVE_VERSION) return no('不認得的存檔版本');
    if (!int(r.seed, 0, 0xffffffff) || !int(r.tick, 1, MAX_TICK) || typeof r.hash !== 'string' || !/^[0-9a-f]{8}$/.test(r.hash)) return no('存檔的種子、步數或雜湊不對');
    const why = checkLog(r.log);
    if (why) return no(why);
    const log = r.log as LoggedCommand[];
    if (log.length && log[log.length - 1].tick > r.tick) return no('指令紀錄比世界走得還遠');
    const world = decodeWorld(r.world);
    if (!world) return no('存檔的世界讀不出來');
    if (world.seed !== r.seed || world.tick !== r.tick) return no('世界的種子或步數跟存檔記的對不上');
    if (world.sandbox) return no('沙盒不能接著打');
    if (world.winner !== -1) return no('這一局已經分出勝負');
    if (hashWorld(world) !== r.hash) return no('存檔的內容跟它記的雜湊對不上');
    step(structuredClone(world), []);   // 拿複本先走一步：走不動的世界不給接
    const c = r.cam as Record<string, unknown> | null | undefined;
    const cam = c && typeof c === 'object' && finite(c.x) && finite(c.z) && finite(c.zoom) && c.zoom > 0 ? { x: c.x, z: c.z, zoom: c.zoom } : null;
    return { ok: true, save: { world, log, at: typeof r.at === 'string' ? r.at.slice(0, 40) : '', cam, stats: readStats(r.stats) } };
  } catch { return no('存檔的世界走不動'); }
}

export function readSave(store: Store | null): Loaded {
  let raw: string | null = null;
  try { raw = store?.getItem(SAVE_KEY) ?? null; } catch { raw = null; }
  return raw ? checkSave(raw) : no('沒有存檔');
}
export function writeSave(store: Store | null, text: string): boolean {
  try { if (!store) return false; store.setItem(SAVE_KEY, text); return true; } catch { return false; }
}
export function clearSave(store: SaveStore | null): void {
  try { store?.removeItem(SAVE_KEY); } catch { /* 清不掉就算了 */ }
}
export const browserSaveStore = (): SaveStore | null => { try { return localStorage; } catch { return null; } };

const MAP_NAME: Record<number, string> = { 0: '村莊', 1: '萊伊', 2: '鄉間', 3: '河鎮' };
// 「繼續上一局」那顆鍵下面的小字：哪張圖、打到幾分幾秒、種子
export function saveTitle(save: SaveGame): string {
  const w = save.world, s = Math.floor(w.tick / 20);
  return `${w.zombies ? '喪屍防守 · ' : ''}${MAP_NAME[w.map ?? 0] ?? '地圖'} ${w.n}×${w.n} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · 種子 ${w.seed}`;
}

export interface SaveHost {
  world: () => World;
  log: () => readonly LoggedCommand[];
  battle: () => boolean;      // 開戰了沒（布陣階段不存）
  replaying: () => boolean;   // 正在看重播（不存，也不清）
  cam: () => Camera;
  stats: () => BattleStats;
  adopt: (w: World, log: LoggedCommand[], cam: Camera | null, stats: BattleStats | null) => void;   // 把遊戲換成存檔裡的這一局，停在暫停
}
export interface Saves {
  offer: () => string | null;   // 有可以接的存檔：回傳那行小字；沒有：null
  resume: () => boolean;        // 接回去；存檔不能用就什麼都不做
  saveNow: () => boolean;       // 現在存一次（不能存的時候不動原本的存檔；分出勝負了就清掉）
}

export function initSaves(host: SaveHost, store: SaveStore | null = browserSaveStore()): Saves {
  let lastTick = -1, seenRaw: string | null | undefined, seenTitle: string | null = null;
  function saveNow(): boolean {
    const w = host.world();
    if (!host.battle() || host.replaying() || w.sandbox) return false;
    if (w.winner >= 0) { clearSave(store); return false; }
    const text = makeSave(w, host.log(), host.cam(), new Date().toISOString(), host.stats());
    if (!text) return false;
    lastTick = w.tick;
    return writeSave(store, text);
  }
  function offer(): string | null {
    let raw: string | null = null;
    try { raw = store?.getItem(SAVE_KEY) ?? null; } catch { raw = null; }
    if (raw !== seenRaw) { const l = raw ? checkSave(raw) : null; seenRaw = raw; seenTitle = l?.ok ? saveTitle(l.save) : null; }   // 驗一次要解整個世界，同一份文字不重驗
    return seenTitle;
  }
  function resume(): boolean {
    const l = readSave(store);
    if (!l.ok) return false;
    host.adopt(l.save.world, l.save.log, l.save.cam, l.save.stats);
    lastTick = l.save.world.tick;
    return true;
  }
  setInterval(() => { const w = host.world(); if (host.battle() && (w.tick !== lastTick || w.winner >= 0)) saveNow(); }, SAVE_EVERY_MS);
  addEventListener('pagehide', () => { saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  return { offer, resume, saveNow };
}
