// 固定種子亂數與雜湊。mulberry32／fnv1a／hash2 的算法照搬 GlimmerTown3D-lab@bece722 src/sim/rng.ts。
// 跟 3D-lab 不同的一點：亂數狀態存在世界裡（World.rng），讀檔、重播都從同一個位置接著抽，不重設。

export interface RngState { rng: number }

// 抽一個 32 位元無號整數，狀態往前走一步
export function nextU32(s: RngState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

// [0, n) 的整數（n ≤ 2^21 時 u32*n 仍在 2^53 內，結果精確）
export function randInt(s: RngState, n: number): number {
  return Math.floor((nextU32(s) * n) / 4294967296);
}

// [-r, r] 的整數
export function randSym(s: RngState, r: number): number {
  return randInt(s, 2 * r + 1) - r;
}

// 32 位元 FNV-1a：字串版
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// 32 位元 FNV-1a：逐個整數折進去（世界雜湊用，比 JSON 快）
export class Fnv {
  h = 0x811c9dc5;
  int(v: number): this {
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193) >>> 0;
      x >>>= 8;
    }
    return this;
  }
  hex(): string { return this.h.toString(16).padStart(8, '0'); }
}

// 整數座標的決定性雜湊 → [0,1)；渲染端的點綴（樹、碎石、草色）用它，不碰模擬的亂數流
export function hash2(x: number, z: number, k: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(k | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
