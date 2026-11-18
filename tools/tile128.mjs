// R098：把一個 96×96 的世界（河鎮）鋪滿 n×n（預設 128）——地形、彈坑照位置重複；房子在每一個鋪的位置複製一份、給新的編號（整棟放得進去的才放），
// 鐵絲網與植被不帶過去。單位照原本的位置留著。給畫面的守衛與量測用：R090 的海斯地圖還沒有之前，用它當「128 格的鎮」。
// 只讀 src/sim 的世界格式，不碰模擬（world.ts 的 bldMaxHp 等都不用：房子照抄原本的耐久）。
export function tile128(src, n = 128) {
  const s = src.n, w = { ...src, n, ter: new Uint8Array(n * n), occ: new Int32Array(n * n), crater: new Uint8Array(n * n), blds: [], wires: undefined };
  delete w.vegetation; delete w.wires; delete w.trenches;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const a = z * n + x, b = (z % s) * s + (x % s); w.ter[a] = src.ter[b]; w.crater[a] = src.crater[b]; }
  for (const [ox, oz] of [[0, 0], [s, 0], [0, s], [s, s]]) for (const b of src.blds) {
    const x = b.x + ox, z = b.z + oz;
    if (x + b.w > n || z + b.d > n) continue;
    const id = w.blds.length + 1;
    w.blds.push({ ...b, id, x, z });
    for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) w.occ[(z + dz) * n + x + dx] = id;
  }
  w.units = src.units.map(u => ({ ...u, path: [], pathIdx: 0 }));
  return w;
}
