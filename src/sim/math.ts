// 模擬只用整數算術：平方根用整數牛頓法，不用 Math.sqrt（跨瀏覽器、跨引擎都逐位元相同）。

export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n, y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  return isqrt(dx * dx + dz * dz);
}
