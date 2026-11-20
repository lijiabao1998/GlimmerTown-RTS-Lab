// 模擬只用整數算術：平方根用整數牛頓法，不用 Math.sqrt（跨瀏覽器、跨引擎都逐位元相同）。

export function isqrt(n: number): number {
  if (n <= 0) return 0;
  // R1006：起點取比 √n 大的最小的二的次方（n < 2^32；clz32 在白名單裡），不再從 n 本身對半砍十幾次。整數牛頓法從任何 ≥ ⌊√n⌋ 的起點都收斂到 ⌊√n⌋，答案逐位相同
  let x = n < 4294967296 ? 1 << ((33 - Math.clz32(n)) >> 1) : n, y = Math.floor((x + Math.floor(n / x)) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  return isqrt(dx * dx + dz * dz);
}
