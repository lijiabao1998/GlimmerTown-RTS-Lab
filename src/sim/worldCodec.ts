// R074 世界的編碼與解碼：把整個 World 轉成可以 JSON.stringify 的東西，再轉回來。存檔（繼續上一局）用。
// 轉回來的世界 hashWorld 跟原本相同、接著跑逐位相同（守衛 tests/savegame.mjs）。純函式、只用整數、不碰世界本身。
// 世界裡大部分是普通的數字與陣列，原樣留著；整張圖大小的表（型別陣列）用「值、連續幾格」壓起來。
// 只給畫面看的事件清單不存。之後哪張卡往 World 加新的型別陣列，要在這裡加一行（守衛會擋）。
import { platoonOk } from './platoon.ts';
import { swOk } from './support91.ts';   // R091
import { techOk } from './tech50.ts';   // R050
import { hq11Ok } from './hq1011.ts';   // R1011
import { bag1007Ok } from './sandbag1007.ts';   // R1007
import { mineOk } from './mines1009.ts';   // R1009
import { tpOk } from './transport92.ts';   // R092
import { airOk } from './air93.ts';   // R093
import { brOk1010 } from './bridge1010.ts';   // R1010
import { validBridgehead } from './bridgehead.ts';
import { UNIT_KINDS, type World } from './world.ts';
import { HEIGHT_MAX } from './terrain.ts';

export const CODEC_MAX_N = 512;   // 邊長上限（現在的地圖是 32、64、96）

// [值, 連續幾格, 值, 連續幾格, …]
function pack(a: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length;) {
    let j = i + 1;
    while (j < a.length && a[j] === a[i]) j++;
    out.push(a[i], j - i);
    i = j;
  }
  return out;
}

// 解回一張剛好 into.length 格的表；形狀不對、值超出範圍、格數加起來不對都回傳 null
function unpack<T extends Uint8Array | Int32Array>(x: unknown, into: T, lo: number, hi: number): T | null {
  if (!Array.isArray(x) || x.length % 2 !== 0) return null;
  let at = 0;
  for (let i = 0; i < x.length; i += 2) {
    const v: unknown = x[i], c: unknown = x[i + 1];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null;
    if (typeof c !== 'number' || !Number.isInteger(c) || c <= 0 || at + c > into.length) return null;
    into.fill(v, at, at + c);
    at += c;
  }
  return at === into.length ? into : null;
}

export function encodeWorld(w: World): unknown {
  return {
    ...w, events: [], ter: pack(w.ter), occ: pack(w.occ), crater: pack(w.crater), ...(w.height ? { height: pack(w.height) } : {}),
    ...(w.vegetation ? { vegetation: { ...w.vegetation, cells: pack(w.vegetation.cells) } } : {}),
    ...(w.br ? { br: { ...w.br, wet: pack(w.br.wet) } } : {}),   // R1010：河道遮罩跟植被一樣壓
  };
}

// 一定要有、而且是整數的欄位。hashWorld 把缺的欄位跟 0 當成一樣，所以「欄位不見了」要在這裡擋：缺了它們，模擬會算出 NaN
const WORLD_INTS = ['seed', 'tick', 'rng', 'nextShell', 'winner'];
const UNIT_INTS = ['id', 'side', 'kind', 'x', 'z', 'hp', 'order', 'target', 'tx', 'tz', 'pathIdx', 'cooldown', 'aimX', 'aimZ'];
const BLD_INTS = ['id', 'kind', 'x', 'z', 'w', 'd', 'floors', 'hp', 'maxHp'];
const SHELL_INTS = ['id', 'side', 'kind', 'shooter', 'sx', 'sz', 'ex', 'ez', 't', 'T', 'target', 'hitBld'];
const ints = (o: unknown, keys: readonly string[]): o is Record<string, number> => typeof o === 'object' && o !== null && keys.every(k => Number.isInteger((o as Record<string, unknown>)[k]));
// 單位與建築的編號＝在陣列裡的位置＋1（模擬到處用 units[id - 1] 找）
const unitOk = (u: unknown, i: number): boolean => ints(u, UNIT_INTS) && u.id === i + 1 && u.kind >= 0 && u.kind < UNIT_KINDS.length
  && typeof (u as Record<string, unknown>).alive === 'boolean' && Array.isArray((u as Record<string, unknown>).path) && ((u as Record<string, unknown>).path as unknown[]).every(Number.isInteger);

// x＝encodeWorld 的結果（通常剛從 JSON.parse 出來）。只檢查形狀；內容對不對由呼叫的人拿 hashWorld 比
export function decodeWorld(x: unknown): World | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>, n = r.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > CODEC_MAX_N) return null;
  const cells = n * n;
  const ter = unpack(r.ter, new Uint8Array(cells), 0, 255), occ = unpack(r.occ, new Int32Array(cells), -0x80000000, 0x7fffffff), crater = unpack(r.crater, new Uint8Array(cells), 0, 255);
  if (!ter || !occ || !crater || !Array.isArray(r.blds) || !Array.isArray(r.units) || !Array.isArray(r.shells)) return null;
  if (!ints(r, WORLD_INTS) || !r.units.every(unitOk) || !r.blds.every((b, i) => ints(b, BLD_INTS) && b.id === i + 1) || !r.shells.every(s => ints(s, SHELL_INTS))) return null;
  if (r.more !== undefined && r.more !== 1) return null;   // R087：更多房屋的旗標只有 1
  if (!platoonOk(r)) return null;   // R095：排的旗標只有 1、排號只在步兵班上、沒有旗標就沒有排的記號
  if (!validBridgehead(r)) return null;
  if (!swOk(r)) return null;   // R091：sw 只有 1；沒有 sw 就沒有 42、43 號單位
  if (!airOk(r)) return null;   // R093：air 只有 1；沒有 air 就沒有 sky、沒有 46 號
  if (!techOk(r)) return null;   // R050：tech 只有 1；沒有 tech 就沒有 w.tech、沒有 14–16 號建築；工地要指到那三種
  if (!hq11Ok(r)) return null;   // R1011：hq11 只有 1、要跟 tech；hqLv、hqUp 只在登記的指揮部上、範圍對、血上限對得上級數
  if (!bag1007Ok(r)) return null;   // R1007：bag 只有 1、要跟 tech 一起；沒有 bag 就沒有 r.bags；blds 裡不能有 17 號；每一筆的欄位與範圍、同一格一筆、每方 ≤ 8 處
  if (!mineOk(r)) return null;   // R1009：mine 只有 1、要 sw＝2；沒有 mine 就沒有 mines；每一格六個整數在範圍內、同一方同一格不重複、每方不超過 24
  if (!tpOk(r)) return null;   // R092：tp 只有 1、2（R030）；沒有 tp 就沒有 44、45 號單位與 ride／towBy
  let vegetation: World['vegetation'];
  if (r.vegetation !== undefined) {
    const v = r.vegetation;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const grid = unpack((v as Record<string, unknown>).cells, new Uint8Array(cells), 0, 255);
    if (!grid) return null;
    vegetation = { ...(v as { version: number }), cells: grid };
  }
  let br: World['br'] | null = undefined;   // R1010：有 br 才解；遮罩、橋、地形跟那張圖對不上就不收（bridge1010.ts 的 brOk1010）
  if (r.br !== undefined) { const b = r.br as { wet?: unknown } | null, wet = typeof b === 'object' && b !== null ? unpack(b.wet, new Uint8Array(cells), 0, 1) : null; if (!wet || !(br = brOk1010(r, ter, wet, b))) return null; }
  let height: Uint8Array | null | undefined;
  if (r.height !== undefined && !(height = unpack(r.height, new Uint8Array(cells), 0, HEIGHT_MAX))) return null;   // R055：高度表（有才有；長度不對、值超出 0–3 就不收）
  return { ...(r as unknown as World), ter, occ, crater, events: [], ...(br ? { br } : {}), ...(vegetation ? { vegetation } : {}), ...(height ? { height } : {}) };   // R1010 的 br 放在前面：terrain.mjs 錨著植被、高度那一段到結尾
}
