// R097 守衛：findPath 的暫存跟著模組走（陣列與堆重用、取餘換除法、每格的啟發值與速度只算一次）——結果要跟改之前逐位一樣，暖過之後不再配陣列。
// 參考答案：main 74fa704 的 src/sim/path.ts 原文（型別剝掉、原樣貼在下面），跟現在的 findPath 對同一批問題逐一比。
// 分群：identity（≥ 3,000 題）、odd（負的速度、不是整數的座標）、throw（搜到一半拋錯之後）、alloc（數 typed array 的建構子）、duel（兩場凍結的對打）、wiring（守衛釘住的行還在、行數）。
// node tests/path-scratch.mjs <群> 只跑一群。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorld, hashWorld, cellIdx, inGrid, blocks, wireBlocks, UK_TANK, UK_INFANTRY, UK_MG, BK_WIRE, UNIT_KINDS, speedPct } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { ECO, duel } from '../tools/duel.mjs';

// ---- 參考：改之前的 A*（74fa704，逐字；只剝掉型別、改了函式名）----

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

// 每一步的成本：直走 10、斜走 14，再除以地形速度倍率
function stepCost(w, x, z, diag) {
  return Math.floor(((diag ? 14 : 10) * 100) / speedPct(w, x, z));
}
function heur(x, z, gx, gz) {
  const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
  return 10 * (dx + dz) - 6 * Math.min(dx, dz);
}

// 最小堆：鍵＝f*K+格索引（K＝這個世界的格數 n*n，見 findPath），同 f 時小索引先出
class Heap {
  a = [];
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p] <= v) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mv = last;
        if (l < a.length && a[l] < mv) { m = l; mv = a[l]; }
        if (r < a.length && a[r] < mv) { m = r; mv = a[r]; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
  get size() { return this.a.length; }
}

// 回傳從起點下一格到終點的格索引；終點走不到時，走到離終點最近（啟發值最小）的可達格。
function refFindPath(w, sx, sz, gx, gz, enterBuilding = 0, exitBuilding = 0, unitKind = UK_TANK) {
  if (!inGrid(w, sx, sz) || !inGrid(w, gx, gz)) return [];
  const start = cellIdx(w, sx, sz), goal = cellIdx(w, gx, gz);
  if (start === goal) return [];
  const n = w.n, K = n * n;
  // R064：每格擋不擋，一次搜尋只算一次（原本每格最多被問十次，鐵絲網還要每次從頭找）；只在格內問，結果逐位不變
  const memo = new Uint8Array(K);   // 0＝還沒算、1＝可走、2＝擋
  const blocked = (x, z) => {
    const i = z * n + x;
    if (!memo[i]) memo[i] = wireBlocks(w, x, z, unitKind) || (blocks(w, x, z) && w.occ[i] !== enterBuilding && w.occ[i] !== exitBuilding) ? 2 : 1;
    return memo[i] === 2;
  };
  const g = new Int32Array(K).fill(-1), came = new Int32Array(K).fill(-1), done = new Uint8Array(K);
  // R084 左右對稱：堆的鍵＝f×M＋次序。原本次序＝格索引（平手時偏向小編號那一邊）；有 sym 時次序看「這一格與它的點鏡像那一格」這一對（小的那個索引×2），
  // 同一對裡的先後看終點在哪一半（fl）——終點跟它的鏡像一定在不同的兩半，所以鏡像的問題每一個鍵都跟原本那一格的一樣、每一個平手做的是鏡像的選擇。
  // f 平手時先比離終點的估計（h 小的先）：對稱不靠它（審查之後），留著是因為同樣 f 時先展開離終點近的格、搜得少
  const HB = 14 * n + 1, key = (f, h, i) => (w.sym ? (f * HB + h) * M + enc(i) : f * M + enc(i)), fl = goal > K - 1 - goal ? 1 : 0;
  const M = w.sym ? 2 * K : K, enc = (i) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i), dec = (e) => (w.sym ? ((e & 1) ^ fl ? K - 1 - (e >> 1) : e >> 1) : e);
  const open = new Heap();
  g[start] = 0;
  open.push(key(heur(sx, sz, gx, gz), heur(sx, sz, gx, gz), start));
  let best = start, bestH = heur(sx, sz, gx, gz);
  while (open.size) {
    const cur = dec(open.pop() % M);
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % n, cz = (cur - cx) / n;
    const h = heur(cx, cz, gx, gz);
    if (h < bestH || (h === bestH && g[cur] < g[best])) { best = cur; bestH = h; }
    if (cur === goal) break;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (!inGrid(w, nx, nz) || blocked(nx, nz)) continue;
      const diag = k >= 4;
      if (diag && (blocked(cx + DX[k], cz) || blocked(cx, cz + DZ[k]))) continue;   // 不切角
      const ni = cellIdx(w, nx, nz), ng = g[cur] + stepCost(w, nx, nz, diag);
      if (done[ni] || (g[ni] >= 0 && g[ni] <= ng)) continue;
      g[ni] = ng; came[ni] = cur;
      open.push(key(ng + heur(nx, nz, gx, gz), heur(nx, nz, gx, gz), ni));
    }
  }
  const end = done[goal] ? goal : best;
  const out = [];
  for (let c = end; c !== start && c >= 0; c = came[c]) out.push(c);
  return out.reverse();
}
// ---- 參考結束 ----

const only = process.argv[2], run = (name, f) => { if (only && only !== name) return; f(); console.log(`OK path-scratch/${name}`); };
let rs = 97; const rnd = m => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs % m; };
const KINDS = UNIT_KINDS.map((k, i) => (k ? i : -1)).filter(i => i >= 0);

// 一張圖：照遊戲開局（地圖、eco 帶 mg 2）；再撒一些鐵絲網（有的已經剪斷）、彈坑、倒掉的房子，讓每一種擋路與速度都出現
function make(map, seed, sym) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, ...(sym ? { sym: 1 } : {}) }, { ...ECO, end: 1, mg: 2, pla: 1 }]);
  step(w, []);
  dress(w);
  return w;
}
function dress(w) {
  const n = w.n, segs = [];
  for (let k = 0, id = 1; k < 4 * n && segs.length < n / 4; k++) {
    const x = rnd(n - 2), z = rnd(n - 2), rot = rnd(2);
    if (w.occ[cellIdx(w, x, z)] || w.occ[cellIdx(w, x + 1 - rot, z + rot)]) continue;
    segs.push({ id: id++, kind: BK_WIRE, x, z, w: rot ? 1 : 2, d: rot ? 2 : 1, floors: 1, hp: rnd(4) ? 60 : 0, maxHp: 60, builtBy: 0 });
  }
  w.wires = { version: 1, segments: segs };
  for (let k = 0; k < n; k++) w.crater[rnd(n * n)] = 1 + rnd(3);
  for (let k = 0; k < w.blds.length; k += 9) w.blds[k].hp = 0;
}
// 合成的 128×128：把 96 圖鋪滿 128 格（房子的編號照抄，擋路照樣查得到）
function tile(src, n) {
  const w = { ...src, n, ter: new Uint8Array(n * n), occ: new Int32Array(n * n), crater: new Uint8Array(n * n), wires: { version: 1, segments: [] } }, s = src.n;
  delete w.vegetation;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const a = z * n + x, b = (z % s) * s + (x % s); w.ter[a] = src.ter[b]; w.occ[a] = src.occ[b]; w.crater[a] = src.crater[b]; }
  dress(w);
  return w;
}
// 一個問題：[sx, sz, gx, gz, 進哪棟, 出哪棟, 兵種]
function query(w, q) {
  const n = w.n, kind = KINDS[q % KINDS.length], r = q % 10, b = w.blds[rnd(w.blds.length)];
  let sx = rnd(n), sz = rnd(n), gx = rnd(n), gz = rnd(n), en = 0, ex = 0;
  if (r === 1 && b) { gx = b.x; gz = b.z; en = b.id; }                                     // 進房子
  else if (r === 2 && b) { sx = b.x; sz = b.z; ex = b.id; }                                // 出房子
  else if (r === 3 && b) { gx = b.x + rnd(b.w); gz = b.z + rnd(b.d); }                     // 終點擋住（整片搜完）
  else if (r === 4) { gx = Math.min(n - 1, sx + rnd(5)); gz = Math.max(0, sz - rnd(5)); }  // 短路
  else if (r === 5 && q % 20 === 5) { gx = sx; gz = sz; }                                  // 起點等於終點
  else if (r === 6 && q % 30 === 6) { gx = n + rnd(3); }                                   // 出界
  const s = w.wires.segments[rnd(w.wires.segments.length || 1)];
  if (r === 7 && s) { gx = s.x; gz = s.z; }                                                // 終點在鐵絲網上
  return [sx, sz, gx, gz, en, ex, kind];
}

const tag = w => `map ${w.map ?? 0}${w.n === 128 ? ' tiled 128' : ''}${w.sym ? ' sym' : ''}`;
// 會用到模組裡的暫存（不在開頭就回傳）的問題
const searches = (w, a) => inGrid(w, a[0], a[1]) && inGrid(w, a[2], a[3]) && cellIdx(w, a[0], a[1]) !== cellIdx(w, a[2], a[3]);
// 改一下世界：倒房子或修好、彈坑、剪斷或修好鐵絲網
function poke(w) {
  const b = w.blds[rnd(w.blds.length)], s = w.wires.segments[rnd(w.wires.segments.length || 1)];
  if (b) b.hp = b.hp > 0 ? 0 : b.maxHp;
  for (let k = 0; k < 4; k++) w.crater[rnd(w.n * w.n)] = rnd(4);
  if (s) s.hp = s.hp > 0 ? 0 : 60;
}

run('identity', () => {
  // 十個世界（96、32、128、64、96、32、64、32、32、32），每個世界連問 4 題再換下一個；每 7 題改一下當下那個世界——
  // 同一個世界上前一題的暫存（擋不擋、速度、走到哪）不能留到下一題，換了世界、換了大小也一樣
  const m3 = make(3, 2, 1);
  const worlds = [m3, make(0, 3, 0), tile(m3, 128), make(2, 4, 1), make(3, 5, 0), make(1, 6, 1), make(2, 7, 0), make(4, 8, 0), make(0, 9, 1), make(4, 10, 1)];
  let total = 0, flood = 0, empty = 0, lastK = -1;
  const kinds = new Set(), sizes = new Set(), reuse = {}, poked = new Set();
  for (let q = 0; q < 3200; q++) {
    const wi = Math.floor(q / 4) % worlds.length, w = worlds[wi];
    if (q % 7 === 6) { poke(w); poked.add(wi); }
    const a = query(w, q), want = refFindPath(w, ...a), got = findPath(w, ...a);
    assert.deepEqual(got, want, `path: query ${q} (${tag(w)}: ${a.join(',')}) identical to the 74fa704 A*`);
    total++; kinds.add(a[6]); sizes.add(w.n); if (!want.length) empty++;
    if (inGrid(w, a[2], a[3]) && blocks(w, a[2], a[3]) && w.occ[cellIdx(w, a[2], a[3])] !== a[4]) flood++;
    if (searches(w, a)) { if (w.n * w.n === lastK) reuse[w.n] = (reuse[w.n] ?? 0) + 1; lastK = w.n * w.n; }
  }
  const r = n => reuse[n] ?? 0;
  assert(total >= 3000 && flood >= 200 && kinds.size === KINDS.length && sizes.size === 4 && empty >= 50 && poked.size === worlds.length && r(32) >= 300 && r(64) >= 150 && r(96) >= 150 && r(128) >= 50,
    `identity: coverage (${total} queries, ${flood} blocked goals, ${kinds.size} kinds, sizes ${[...sizes]}, ${empty} empty, ${poked.size} worlds changed, reuse ${JSON.stringify(reuse)})`);
  console.log(`  ${total} queries identical (${flood} blocked goals, ${kinds.size} unit kinds, sizes ${[...sizes].join('/')}, ${empty} empty answers; scratch reused on the same size ${JSON.stringify(reuse)})`);
});

run('odd', () => {
  // 遊戲裡碰不到、但存檔讀得進來或呼叫的人可能給的：彈坑 8 以上（速度變負數、堆的鍵變負數）、不是整數的座標、NaN（審查之後）
  const deep = (w, every) => { for (let i = 0; i < w.n * w.n; i++) if (rnd(every) === 0) w.crater[i] = 8 + rnd(40); return w; };
  const worlds = [deep(make(0, 21, 0), 6), deep(make(1, 22, 1), 6), deep(make(2, 23, 0), 10), deep(make(3, 24, 1), 12)];
  let negative = 0, fractional = 0;
  for (let q = 0; q < 1200; q++) {
    const w = worlds[Math.floor(q / 3) % worlds.length], a = query(w, q), r = q % 12;
    if (r === 0) { a[0] += 0.5; fractional++; } else if (r === 1) { a[3] += 0.25; fractional++; } else if (r === 2 && q % 48 === 2) a[2] = NaN;
    const want = refFindPath(w, ...a), got = findPath(w, ...a);
    assert.deepEqual(got, want, `odd: query ${q} (${tag(w)}: ${a.join(',')}) identical to the 74fa704 A*`);
    if (want.some(i => Number.isInteger(i) && i >= 0 && speedPct(w, i % w.n, (i - (i % w.n)) / w.n) < 0)) negative++;
  }
  assert(negative >= 50 && fractional >= 150, `odd: coverage (${negative} answers cross a negative-speed cell, ${fractional} fractional queries)`);
  console.log(`  1200 odd queries identical (${negative} cross a crater deep enough for a negative speed, ${fractional} fractional coordinates)`);
});

run('throw', () => {
  // 搜到一半拋錯（這裡讓 w.wires 第 N 次被讀的時候拋），下一題要從乾淨的暫存開始——在同一個世界、別的世界都一樣（審查之後）
  const m3 = make(3, 31, 1), worlds = [m3, make(1, 32, 0), tile(m3, 128), make(2, 33, 1)];
  let thrown = 0;
  for (let q = 0; q < 400; q++) {
    const w = worlds[q % worlds.length], bad = { ...w }, limit = 1 + rnd(600);
    let reads = 0;
    Object.defineProperty(bad, 'wires', { get() { if (++reads > limit) throw new Error('boom'); return w.wires; } });
    const a = query(w, q); a[6] = UK_INFANTRY;   // 徒步的才查鐵絲網
    try { findPath(bad, ...a); } catch (e) { if (e.message !== 'boom') throw e; thrown++; }
    const next = worlds[(q + (q & 1)) % worlds.length], b = query(next, q + 7);
    assert.deepEqual(findPath(next, ...b), refFindPath(next, ...b), `throw: after a search that threw, query ${q} (${tag(next)}: ${b.join(',')}) is identical to the 74fa704 A*`);
  }
  assert(thrown >= 200, `throw: coverage (${thrown} of 400 searches threw halfway)`);
  console.log(`  ${thrown} of 400 searches threw halfway; every next search identical`);
});

run('alloc', () => {
  // 數 typed array 的建構子：暖過一次之後，同一張圖上再問同一批問題一個也不新開；換了格數（變小、變大）才重開一次（五個陣列），之後又不開
  const names = ['Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Uint8ClampedArray'], saved = {};
  let made = 0;
  for (const nm of names) { const C = globalThis[nm]; saved[nm] = C; globalThis[nm] = class extends C { constructor(...a) { super(...a); made++; } }; }
  try {
    const big = make(3, 11, 1), small = make(1, 12, 0), qs = w => Array.from({ length: 150 }, (_, q) => query(w, q));
    const A = qs(big), B = qs(small), one = (w, Q) => Q.find(a => searches(w, a));
    for (const a of A) findPath(big, ...a);   // 暖身（堆在這裡長到夠大）
    made = 0; for (const a of A) findPath(big, ...a);
    assert.equal(made, 0, 'alloc: after warm-up 150 searches on the same map create no typed arrays');
    made = 0; findPath(small, ...one(small, B));
    assert.equal(made, 5, 'alloc: a different map size reallocates the five scratch arrays once');
    made = 0; for (const a of B) findPath(small, ...a);
    assert.equal(made, 0, 'alloc: and then none again on that size');
    made = 0; findPath(big, ...one(big, A));   // 變大沒重開的話這一題會讀到陣列外、停不下來（負面守衛斷言它逾時）
    assert.equal(made, 5, 'alloc: a bigger map size reallocates the five scratch arrays once');
    console.log('  150 + 150 searches after warm-up: 0 typed arrays; each size change: 5');
  } finally { for (const nm of names) globalThis[nm] = saved[nm]; }
});

run('duel', () => {
  // 在 74fa704 凍結的兩場（卡面驗收 4 的 20 場裡最短的兩場）：電腦第三版困難對困難、擬真、end、mg 2、pla、12,000 步
  for (const [map, seed, ticks, hash] of [[2, 4, 4962, '8379fc30'], [3, 8, 6114, '5fb58288']]) {
    const r = duel({ map, seed, ticks: 12000, rules: { ap: 1, morale: 2 }, end: true, mg: 2, pla: true, a: { level: 3, v: 3 }, b: { level: 3, v: 3 } });
    assert.deepEqual([r.ticks, r.hash], [ticks, hash], `duel: map ${map} seed ${seed} ends at the same tick with the same hash as 74fa704`);
  }
});

run('wiring', () => {
  const src = fs.readFileSync(new URL('../src/sim/path.ts', import.meta.url), 'utf8');
  for (const anchor of ['const i = z * n + x;', 'fl = goal > K - 1 - goal ? 1 : 0;', 'enc = (i: number) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i)'])
    assert.equal(src.split(anchor).length - 1, 1, `wiring: guarded line kept once: ${anchor}`);
  assert(src.split('\n').length <= 106, 'wiring: path.ts stays within 105 lines');
  assert(!/Math\.random|Date|performance/.test(src), 'wiring: no randomness or clocks');
  assert.equal((src.match(/new (Uint8|Int32|Float64)Array/g) ?? []).length, 12, 'wiring: typed arrays only at module level (5), on a size change (5) and for the heap (2)');
  // spd 存在 Int32Array 裡：speedPct 一定要是 Int32 範圍內的整數（每一種地形、有沒有房子、彈坑 0–255），存進去才跟算出來的一樣
  const w = createWorld(1);
  for (const ter of [0, 1, 2, 3]) for (const occ of [0, 1]) for (let c = 0; c < 256; c++) {
    w.ter[0] = ter; w.occ[0] = occ; w.crater[0] = c; const p = speedPct(w, 0, 0);
    assert(Number.isInteger(p) && (p | 0) === p, `wiring: speedPct is an Int32 integer (terrain ${ter}, building ${occ}, crater ${c}: ${p})`);
  }
});
console.log('path-scratch: all OK');
