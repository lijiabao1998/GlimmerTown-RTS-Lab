// R074 世界的編碼與解碼：把整個 World 轉成可以 JSON.stringify 的東西，再轉回來。存檔（繼續上一局）用。
// 轉回來的世界 hashWorld 跟原本相同、接著跑逐位相同（守衛 tests/savegame.mjs）。純函式、只用整數、不碰世界本身。
// 世界裡大部分是普通的數字與陣列，原樣留著；整張圖大小的表（型別陣列）用「值、連續幾格」壓起來。
// 只給畫面看的事件清單不存。之後哪張卡往 World 加新的型別陣列，要在這裡加一行（守衛會擋）。
import type { World } from './world.ts';

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
    ...w, events: [], ter: pack(w.ter), occ: pack(w.occ), crater: pack(w.crater),
    ...(w.vegetation ? { vegetation: { ...w.vegetation, cells: pack(w.vegetation.cells) } } : {}),
  };
}

// x＝encodeWorld 的結果（通常剛從 JSON.parse 出來）。只檢查形狀；內容對不對由呼叫的人拿 hashWorld 比
export function decodeWorld(x: unknown): World | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>, n = r.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > CODEC_MAX_N) return null;
  const cells = n * n;
  const ter = unpack(r.ter, new Uint8Array(cells), 0, 255), occ = unpack(r.occ, new Int32Array(cells), -0x80000000, 0x7fffffff), crater = unpack(r.crater, new Uint8Array(cells), 0, 255);
  if (!ter || !occ || !crater || !Array.isArray(r.blds) || !Array.isArray(r.units) || !Array.isArray(r.shells)) return null;
  let vegetation: World['vegetation'];
  if (r.vegetation !== undefined) {
    const v = r.vegetation;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const grid = unpack((v as Record<string, unknown>).cells, new Uint8Array(cells), 0, 255);
    if (!grid) return null;
    vegetation = { ...(v as { version: number }), cells: grid };
  }
  return { ...(r as unknown as World), ter, occ, crater, events: [], ...(vegetation ? { vegetation } : {}) };
}
