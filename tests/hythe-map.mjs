// R090 更大的戰場：128×128 的海斯與皇家軍事運河（地圖 5）。卡面驗收 3（生成）與 4（尋路規則）。
// 群：gen（種子 0–19：建築數、壓到不該壓的、地標表逐項、運河、五座橋、坦克開得到、植被、指揮部）、first（第一個 map 指令的規則）、
//     pinned（種子 1–3 第 0 步的雜湊）、start（喪屍不收、三種起手都在自己的角落）、route（路長、47 個一起走、終點擋住、只在擋住時換）、
//     mirror（點對稱的合成世界：手排的換終點平手、500 對擋住、300 對沒擋）、white（HB 的白箱）。node tests/hythe-map.mjs <群> 只跑一群。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { performance } from 'node:perf_hooks';
import * as W from '../src/sim/world.ts';
import { step, formationAt, runLog } from '../src/sim/step.ts';
import { applyMap, MAP_RYE, MAP_HILLS } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { createSandboxWorld } from '../src/sim/sandbox.ts';
import { mapEntry } from '../src/sim/mapRegistry.ts';
import { findPath } from '../src/sim/path.ts';
import { randInt } from '../src/sim/rng.ts';
import * as H from '../src/sim/hytheMap.ts';
import { heur90, hb90 } from '../src/sim/pathRule90.ts';

const only = process.argv[2], run = (name, f) => { if (only && only !== name) return; f(); console.log(`OK hythe-map/${name}`); };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1, pla: 1, mg: 2 };
const hythe = (seed, extra = [], sym = 1) => { const w = W.createWorld(seed); step(w, [{ t: 'map', id: 5, vegetation: 1, ...(sym ? { sym: 1 } : {}) }, ...extra]); return w; };
const veg = w => (w.vegetation ? [...w.vegetation.cells].filter(Boolean).length : 0);

run('gen', () => {
  const counts = [];
  for (let seed = 0; seed < 20; seed++) {
    const w = hythe(seed), n = w.n;
    assert.equal(n, 128, 'gen: the map is 128×128');
    const pre = w.blds.length; counts.push(pre);
    assert(pre >= 350 && pre <= 460, `gen: seed ${seed} has 350–460 buildings before the HQs (${pre})`);
    for (const b of w.blds) for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) {
      const x = b.x + dx, z = b.z + dz, t = w.ter[z * n + x];
      assert(t !== W.TER_ROAD && t !== W.TER_MUD && !H.inHytheSpawn(x, z), `gen: seed ${seed} building ${b.id} (kind ${b.kind}) is not on a road, the mud, a bridge or a spawn corner (${x},${z})`);
    }
    for (const [kind, x, z, bw, bd, floors] of H.HYTHE_LANDMARKS)
      assert(w.blds.some(b => b.kind === kind && b.x === x && b.z === z && b.w === bw && b.d === bd && b.floors === floors), `gen: seed ${seed} landmark kind ${kind} ${bw}×${bd} at ${x},${z} is placed`);
    for (let k = 0; k < H.HYTHE_PILLBOXES.length; k++) {
      const [px, pz] = H.HYTHE_PILLBOXES[k], [bx, bz] = H.HYTHE_BRIDGES[k];
      assert(Math.max(Math.abs(px - bx), Math.abs(pz - bz)) <= 4 && px + pz > bx + bz, `gen: pillbox ${k} stands within 4 cells of its bridge, on the inland side`);
    }
    for (let x = 0; x < n; x++) for (let z = H.canalZ(x); z <= H.canalZ(x) + 2; z++) if (z >= 0 && z < n) {
      const t = w.ter[z * n + x]; assert(t === W.TER_MUD || t === W.TER_ROAD, `gen: seed ${seed} the canal is continuous at ${x},${z}`);
    }
    // 橋＝運河那三格裡的路格，八方向相連的算一座
    const seen = new Set(), groups = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const i = z * n + x; if (seen.has(i) || w.ter[i] !== W.TER_ROAD || !H.isCanal(x, z)) continue;
      const g = [], st = [[x, z]]; seen.add(i);
      while (st.length) { const [a, b] = st.pop(); g.push(b * n + a); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = a + dx, d = b + dz, j = d * n + c; if (c < 0 || d < 0 || c >= n || d >= n || seen.has(j) || w.ter[j] !== W.TER_ROAD || !H.isCanal(c, d)) continue; seen.add(j); st.push([c, d]); } }
      groups.push(g);
    }
    assert.equal(groups.length, 5, `gen: seed ${seed} the canal is crossed by exactly 5 bridges (${groups.length})`);
    for (const [bx, bz] of H.HYTHE_BRIDGES) assert(groups.some(g => g.includes(bz * n + bx)), `gen: bridge ${bx},${bz} is one of them`);
    assert(veg(w) <= 64 && veg(w) >= 20, `gen: seed ${seed} vegetation grows and stays ≤ 64 (${veg(w)})`);
    if (seed % 5 === 0) {   // 指揮部與坦克開得到每一座橋（開 eco 的世界）
      const e = hythe(seed, [ECO]), hqs = e.blds.filter(b => b.kind === W.BK_HQ);
      assert.equal(hqs.length, 2, 'gen: both headquarters are placed');
      for (const h of hqs) {
        const mine = h.builtBy === W.SIDE_PLAYER ? (x, z) => x >= n - 12 && z >= n - 12 : (x, z) => x < 12 && z < 12;
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) { const t = e.ter[(h.z + dz) * n + h.x + dx]; assert(mine(h.x + dx, h.z + dz) && (t === W.TER_GRASS || t === W.TER_FIELD), `gen: seed ${seed} HQ of side ${h.builtBy} stands on grass or field in its own corner`); }
        const sx = h.x === 0 ? 2 : h.x - 1;
        for (const [bx, bz] of H.HYTHE_BRIDGES) assert.equal(findPath(e, sx, h.z, bx, bz, 0, 0, W.UK_TANK).at(-1), bz * n + bx, `gen: seed ${seed} a tank from side ${h.builtBy}'s HQ reaches the bridge at ${bx},${bz}`);
      }
    }
  }
  const e = mapEntry(5); assert(e && e.n === 128 && e.label === '地圖：海斯' && e.n * W.SUB <= 32768, 'gen: the registry lists 地圖：海斯 at 128 (n·SUB ≤ 32768 keeps memoSpotted keys in range)');
  console.log(`  20 seeds: ${Math.min(...counts)}–${Math.max(...counts)} buildings, every landmark placed, 5 bridges, canal continuous`);
});

run('first', () => {
  const desc = w => `${w.map ?? 0}/${w.n}/${w.vegetation ? 'veg' : 'noveg'}`;
  const open = cmds => { const w = W.createWorld(77); step(w, cmds); return w; };
  for (const k of [0, 1, 2, 3, 4]) assert.equal(desc(open([{ t: 'map', id: 5, vegetation: 1 }, { t: 'map', id: k, vegetation: 1 }])), '5/128/veg', `first: [5, ${k}] opens map 5 with vegetation`);
  for (const k of [1, 2, 3, 4]) { const w = open([{ t: 'map', id: k, vegetation: 1 }, { t: 'map', id: 5, vegetation: 1 }]); assert.equal(w.map, k, `first: [${k}, 5] opens map ${k}`); }
  assert.equal(desc(open([{ t: 'map', id: 0, vegetation: 1 }, { t: 'map', id: 5, vegetation: 1 }])), '5/128/noveg', 'first: [0, 5] opens map 5 without vegetation (id 0 does not claim the map, like [0, 2]–[0, 4] today)');
  const a = open([{ t: 'map', id: 5, vegetation: 1 }]), h = W.hashWorld(a);
  step(a, [{ t: 'map', id: 5, vegetation: 1 }]); const b = open([{ t: 'map', id: 5, vegetation: 1 }]); step(b, []);
  assert.equal(W.hashWorld(a), W.hashWorld(b), 'first: a later map command does nothing (tick > 0)');
  H.applyHythe(b, 1); assert.equal(W.hashWorld(b), W.hashWorld(a), 'first: applying it again to a map-5 world does nothing');
  const t = W.createWorld(77); t.trenches = { version: 1, segments: [{ kind: 0, x: 10, z: 10, rot: 0 }] }; H.applyHythe(t, 1);
  assert.equal(t.n, 32, 'first: a world that is not fresh (trenches already dug) is refused');
  const later = W.createWorld(77); step(later, []); step(later, []); H.applyHythe(later, 1);
  assert.equal(later.n, 32, 'first: a fresh world past tick 0 is refused');
  assert(h.length > 0);
});

const PINNED = ['b54bf36d', '0e0ffac4', 'bb240d77'];   // R090 施工時取（map 5、植被、沒有 sym）
run('pinned', () => {
  const got = [1, 2, 3].map(s => W.hashWorld(hythe(s, [], 0)));
  assert.deepEqual(got, PINNED, `pinned: tick-0 hashes of seeds 1–3 (${got.join(' ')})`);
});

run('start', () => {
  const z = hythe(3, [{ t: 'zombies' }]), plain = hythe(3);
  assert(!z.zombies && W.hashWorld(z) === W.hashWorld(plain), 'start: map 5 refuses the zombies command (same world as without it)');
  for (const force of [0, 1, 3]) {
    const w = hythe(5, [...(force ? [{ t: 'rules', force }] : [])]), n = w.n;
    for (const u of w.units) {
      const ok = u.side === W.SIDE_PLAYER ? W.cellOf(u.x) >= n - 12 && W.cellOf(u.z) >= n - 12 : W.cellOf(u.x) < 12 && W.cellOf(u.z) < 12;
      assert(ok, `start: force ${force} unit ${u.id} (side ${u.side}) starts in its own corner (${W.cellOf(u.x)},${W.cellOf(u.z)})`);
    }
  }
});

// R097 的 A*（同一張圖、w.map 換成 3 就不走地圖 5 的規則）
const r097 = (w, ...a) => { const m = w.map; w.map = 3; try { return findPath(w, ...a); } finally { w.map = m; } };
const cost = (w, s, p) => { let c = 0, px = s[0], pz = s[1]; for (const i of p) { const x = i % w.n, z = (i - x) / w.n, d = x !== px && z !== pz; c += Math.floor(((d ? 14 : 10) * 100) / W.speedPct(w, x, z)); px = x; pz = z; } return c; };
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];

run('route', () => {
  const ratios = [];
  let tOld = 0, tNew = 0, bOld = 0, bNew = 0, snapped = 0, open = 0;
  const groupMs = [];
  for (const seed of [1, 2, 3]) {
    const w = hythe(seed, [ECO]), n = w.n, st = { rng: 1000 + seed }, seen = new Set();
    let k = 0;
    while (k < 1050 && seen.size < 30000) {   // randInt（高位元）抽，不用 s % k（n＝128 時只有 32 組）
      const a = [randInt(st, n), randInt(st, n)], b = [randInt(st, n), randInt(st, n)], key = a.concat(b).join(',');
      if (seen.has(key)) continue; seen.add(key);
      if (W.blocks(w, ...a) || W.blocks(w, ...b)) continue;
      const po = r097(w, ...a, ...b), pn = findPath(w, ...a, ...b);
      if (!po.length || po.at(-1) !== b[1] * n + b[0]) continue;
      assert.equal(pn.at(-1), po.at(-1), `route: seed ${seed} an open goal is never moved (${a} → ${b})`);
      ratios.push(cost(w, a, pn) / cost(w, a, po)); k++; open++;
    }
    const us = w.units.filter(u => u.alive && u.side === 0), jobs = [];
    for (let j = 0; j < 47; j++) { const u = us[j % us.length], [ox, oz] = formationAt(w, 0, j); jobs.push([W.cellOf(u.x), W.cellOf(u.z), Math.max(0, 8 + ox), Math.max(0, 8 + oz), 0, 0, u.kind]); }
    const blockedJobs = w.blds.filter(b => b.hp > 0).slice(0, 60).map(b => [W.cellOf(us[0].x), W.cellOf(us[0].z), b.x, b.z, 0, 0, W.UK_TANK]);
    const time = (f, js) => { const t = []; for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (const j of js) f(w, ...j); t.push(performance.now() - t0); } return med(t); };
    const go = time(r097, jobs), gn = time(findPath, jobs); tOld += go; tNew += gn; groupMs.push(gn);
    bOld += time(r097, blockedJobs); bNew += time(findPath, blockedJobs);
    for (const [sx, sz, gx, gz] of blockedJobs) {   // 擋住的終點：換到 8 圈以內走得到的格
      const p = findPath(w, sx, sz, gx, gz, 0, 0, W.UK_TANK), e = p.at(-1), ex = e % n, ez = (e - ex) / n;
      assert(p.length && !W.blocks(w, ex, ez) && Math.max(Math.abs(ex - gx), Math.abs(ez - gz)) <= 8, `route: a blocked goal ${gx},${gz} snaps to an open cell within 8 rings (${ex},${ez})`);
      snapped++;
    }
  }
  ratios.sort((a, b) => a - b);
  const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length, p99 = ratios[Math.floor(ratios.length * 0.99)], worst = ratios.at(-1);
  assert(ratios.length >= 3000, `route: ≥ 3,000 distinct open pairs compared (${ratios.length})`);
  assert(mean <= 1.05 && p99 <= 1.15 && worst <= 1.30, `route: routes are ≤ 1.05× on average, ≤ 1.15× at p99, ≤ 1.30× at worst (${mean.toFixed(4)} / ${p99.toFixed(4)} / ${worst.toFixed(4)})`);
  assert(tNew <= 0.2 * tOld && med(groupMs) <= 40, `route: a 47-unit order costs ≤ 0.2× R097's A* and ≤ 40 ms (${(tNew / tOld).toFixed(3)}×, ${med(groupMs).toFixed(1)} ms)`);
  assert(bNew <= 0.1 * bOld, `route: orders to blocked goals cost ≤ 0.1× (${(bNew / bOld).toFixed(3)}×)`);
  console.log(`  ${ratios.length} pairs: mean ${mean.toFixed(4)}, p99 ${p99.toFixed(4)}, worst ${worst.toFixed(4)}; 47-unit order ${(tNew / tOld).toFixed(3)}× (${med(groupMs).toFixed(1)} ms); blocked goals ${(bNew / bOld).toFixed(3)}× (${snapped} snapped)`);
});

// 點對稱的合成 128 世界（w.map＝5、sym＝1）：地形、房子、鐵絲網都成對鏡像
function mirrorWorld() {
  const w = W.createWorld(9), n = 128, K = n * n;
  Object.assign(w, { n, ter: new Uint8Array(K), occ: new Int32Array(K), crater: new Uint8Array(K), blds: [], units: [], map: 5, sym: 1 });
  delete w.vegetation;
  const st = { rng: 4242 }, put = (x, z, bw, bd) => {
    const mx = n - x - bw, mz = n - z - bd;
    for (const [px, pz] of [[x, z], [mx, mz]]) for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) if (w.occ[(pz + dz) * n + px + dx]) return;
    if (Math.abs(x - mx) < bw + 1 && Math.abs(z - mz) < bd + 1) return;
    for (const [px, pz] of [[x, z], [mx, mz]]) { const id = w.blds.length + 1, maxHp = W.bldMaxHp(W.BK_HOUSE, bw, bd, 2); w.blds.push({ id, kind: W.BK_HOUSE, x: px, z: pz, w: bw, d: bd, floors: 2, hp: maxHp, maxHp }); for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[(pz + dz) * n + px + dx] = id; }
  };
  for (let k = 0; k < 500; k++) { const bw = 1 + randInt(st, 2), bd = 1 + randInt(st, 2); put(2 + randInt(st, n - 5), 2 + randInt(st, n - 5), bw, bd); }
  for (let i = 0; i < K / 2; i++) { const t = randInt(st, 7) === 0 ? W.TER_FIELD : randInt(st, 11) === 0 ? W.TER_MUD : W.TER_GRASS; w.ter[i] = t; w.ter[K - 1 - i] = t; }
  for (let i = 0; i < K; i++) if (w.occ[i] && w.ter[i] === W.TER_MUD) w.ter[i] = W.TER_GRASS;
  for (let i = 0; i < K / 2; i++) if (w.ter[i] !== w.ter[K - 1 - i]) w.ter[K - 1 - i] = w.ter[i];
  const segs = [];
  for (let k = 0; segs.length < 60 && k < 2000; k++) { const x = 2 + randInt(st, n - 5), z = 2 + randInt(st, n - 5), mx = n - 1 - x - 1, mz = n - 1 - z; if (w.occ[z * n + x] || w.occ[z * n + x + 1] || w.occ[mz * n + mx] || w.occ[mz * n + mx + 1] || segs.some(s => Math.abs(s.x - x) < 3 && s.z === z) || Math.abs(x - mx) < 4) continue; segs.push({ id: segs.length + 1, kind: W.BK_WIRE, x, z, w: 2, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 0 }, { id: segs.length + 2, kind: W.BK_WIRE, x: mx, z: mz, w: 2, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 0 }); }
  w.wires = { version: 1, segments: segs };
  return w;
}

run('mirror', () => {
  const w = mirrorWorld(), n = w.n, K = n * n, mir = p => p.map(i => K - 1 - i);
  const same = (s, g, kind, why) => { const p = findPath(w, s[0], s[1], g[0], g[1], 0, 0, kind), q = findPath(w, n - 1 - s[0], n - 1 - s[1], n - 1 - g[0], n - 1 - g[1], 0, 0, kind); assert.deepEqual(q, mir(p), `mirror: ${why} (${s} → ${g})`); };
  // (a) 手排的換終點平手：(40,40) 一棟 1×1 的房子（鏡像在 (87,87)），單位在它的斜對角線上，相鄰兩格離終點、離單位都一樣遠
  for (const id of [w.occ[40 * n + 40], w.occ[87 * n + 87]]) if (id) { const b = w.blds[id - 1]; for (let dz = 0; dz < b.d; dz++) for (let dx = 0; dx < b.w; dx++) w.occ[(b.z + dz) * n + b.x + dx] = 0; b.hp = 0; }
  for (let z = 37; z <= 43; z++) for (let x = 37; x <= 43; x++) { w.occ[z * n + x] = 0; w.occ[(n - 1 - z) * n + (n - 1 - x)] = 0; w.ter[z * n + x] = w.ter[(n - 1 - z) * n + (n - 1 - x)] = W.TER_GRASS; }
  for (let z = 30; z <= 70; z++) for (let x = 30; x <= 70; x++) { if (Math.abs(x - z) > 2) continue; w.ter[z * n + x] = w.ter[(n - 1 - z) * n + (n - 1 - x)] = W.TER_GRASS; }
  const id = w.blds.length + 1, maxHp = W.bldMaxHp(W.BK_HOUSE, 1, 1, 2);
  w.blds.push({ id, kind: W.BK_HOUSE, x: 40, z: 40, w: 1, d: 1, floors: 2, hp: maxHp, maxHp }, { id: id + 1, kind: W.BK_HOUSE, x: 87, z: 87, w: 1, d: 1, floors: 2, hp: maxHp, maxHp });
  w.occ[40 * n + 40] = id; w.occ[87 * n + 87] = id + 1;
  for (const d of [5, 20]) same([40 + d, 40 + d], [40, 40], W.UK_TANK, `a hand-made snap tie (unit ${d} cells down the diagonal) snaps to mirrored cells and the paths mirror`);
  // (b) 500 對終點擋住（房子格用坦克、鐵絲網格用步兵）；(c) 300 對終點沒擋
  const st = { rng: 77 }, houses = [], wires = [], opens = [];
  for (let i = 0; i < K; i++) { const x = i % n, z = (i - x) / n; if (w.occ[i] && w.blds[w.occ[i] - 1].hp > 0) houses.push([x, z]); else if (W.wireAt(w, x, z)) wires.push([x, z]); else opens.push([x, z]); }
  const pick = a => a[randInt(st, a.length)];
  for (let k = 0; k < 500; k++) { const wire = k % 3 === 0 && wires.length; same(pick(opens), wire ? pick(wires) : pick(houses), wire ? W.UK_INFANTRY : W.UK_TANK, `blocked goal ${k}: the snapped paths are point mirrors`); }
  for (let k = 0; k < 300; k++) same(pick(opens), pick(opens), W.UK_TANK, `open goal ${k}: the paths are point mirrors`);
  for (let k = 0; k < 60 && wires.length; k++) {   // 換終點用這個單位自己的「擋不擋」：步兵不會換到鐵絲網上
    const s = pick(opens), g = pick(wires), p = findPath(w, s[0], s[1], g[0], g[1], 0, 0, W.UK_INFANTRY), e = p.at(-1);
    if (e === undefined) continue; const ex = e % n, ez = (e - ex) / n;
    assert(!W.wireAt(w, ex, ez), `mirror: an infantry order onto wire at ${g} does not end on wire (${ex},${ez})`);
  }
});

run('white', () => {
  // 行為上抓不到 HB 寫錯（sym＝0 不用 HB；平手的次序換了路也常常不變），所以直接驗：128 圖上 h 的最大值 < HB，鍵 (f, hmax) < (f＋1, 0)
  const hmax = heur90(0, 0, 127, 127);
  assert(hb90(128) > hmax, `white: HB ${hb90(128)} exceeds the largest map-5 heuristic on 128 (${hmax})`);
  const HB = hb90(128), M = 2 * 128 * 128, key = (f, h, e) => (f * HB + h) * M + e;
  assert(key(1000, hmax, M - 1) < key(1001, 0, 0), 'white: a key with f and the largest h still sorts before f + 1');
  assert(key(4e4, hmax, M - 1) < 2 ** 53, 'white: keys stay below 2^53 on 128');
  const src = fs.readFileSync(new URL('../src/sim/path.ts', import.meta.url), 'utf8');
  assert.equal(src.split('const HB = m5 ? hb90(n) : 14 * n + 1').length - 1, 1, 'white: path.ts takes the map-5 bound from hb90 and keeps 14n + 1 for maps 0–4');
});
run('page', () => {
  // main.ts 真的 reset()（抽出來在 vm 裡跑）：選海斯 → 地圖 5、鏡頭 n−9＝119、紀錄是一個 map 5 指令、Node 重播一樣；
  // 沒選海斯、沙盒環境裡根本沒有 MAP_HYTHE（其他守衛在沙盒裡跑 reset() 就是這樣）也不能出錯：MAP_HYTHE 只在選了海斯時才讀
  const src = stripTypeScriptTypes(fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
  const reset = src.match(/function reset\([^]*?\n\}/)?.[0], makeView = src.match(/function makeView\([^]*?\n\}/)?.[0];
  assert(reset && makeView, 'page: reset() and makeView() exist');
  const ctx = (extra) => { const c = vm.createContext({ setViewSide: () => {}, createWorld: W.createWorld, createSandboxWorld, applyMap, MAP_RYE, MAP_LARGE, MAP_TOWN, MAP_HILLS, seed: 1944,
    V: { r006: false, r018: false, r019: false, r026: true, r109: false }, large: false, expanded: false, townPick: undefined,
    q: new URLSearchParams(), fxOn: true, selected: new Set(), view: undefined, battleAudio: undefined, reportView: undefined,
    BattleView: class { constructor() { return { dispose() {}, target: { set(...p) { c.focus = p; } } }; } },
    newStats: () => ({}), ui() {}, planner: { clear() {}, refreshPreview() {} }, syncBattleAudio() {}, issue(cmd) { c.log.push({ tick: c.w.tick, cmd }); }, ...extra }); vm.runInContext(reset + makeView, c); return c; };
  const sk = (hythe) => ({ hythe, hills: false, village: false, start: () => undefined, adopt() {} });
  const c = ctx({ MAP_HYTHE: H.MAP_HYTHE, skirmish: sk(true) }); c.reset();
  assert.deepEqual([c.w.map, c.w.n], [5, 128], 'page: choosing 海斯 opens map 5');
  assert.deepEqual(Array.from(c.focus), [119, 0, 119], 'page: the opening camera looks at our corner (n − 9)');
  const recorded = JSON.parse(JSON.stringify(c.log));
  assert.deepEqual(recorded.map(x => x.cmd.t === 'map' ? { t: 'map', id: x.cmd.id } : x.cmd.t), [{ t: 'map', id: 5 }], 'page: the log starts with one map-5 command');
  step(c.w, recorded.map(x => x.cmd));
  assert.equal(W.hashWorld(c.w), W.hashWorld(runLog(W.createWorld(1944), recorded, 1)), 'page: the page opening equals replaying its own log');
  for (const extra of [{ skirmish: undefined }, { skirmish: sk(false) }]) assert.doesNotThrow(() => ctx(extra).reset(), 'sandbox: reset() without 海斯 never reads MAP_HYTHE');
  for (const [large, expanded, n] of [[true, false, 64], [false, true, 96]]) { const d = ctx({ large, expanded, skirmish: undefined }); d.reset(); assert.deepEqual([d.w.n, ...Array.from(d.focus)], [n, n - 9, 0, n - 9], `page: the ${n} map still opens its camera at ${n - 9}`); }
});

run('text', () => {
  // 地名只在地圖鍵與開局說明；不寫入侵方的國籍、作戰代號、番號
  const files = ['src/ui/startOrder.ts', 'src/sim/mapRegistry.ts', 'src/ui/replayStore.ts', 'src/ui/saveGame.ts', 'src/ui/startMenu.ts'].map(f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  assert(files[0].includes("map === 5 ? '海斯（Hythe）與皇家軍事運河，1940 年 9 月'"), 'text: the briefing names Hythe and the canal, September 1940');
  const lines = files.flatMap(f => f.split('\n').filter(l => /海斯|Hythe/.test(l)));
  assert(lines.length >= 5, `text: the Hythe strings are found (${lines.length})`);
  for (const l of lines) assert(!/德|納粹|海獅|Sea ?Lion|Wehrmacht|師|軍團/.test(l.replace(/\/\/.*$/, '')), `text: no invader nationality, operation or unit in ${l.trim().slice(0, 60)}`);
});
console.log('hythe-map: all OK');
