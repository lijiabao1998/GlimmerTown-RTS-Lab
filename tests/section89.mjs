// R089 更大規模的步兵（Node，只改畫面）：src/render/section89.ts 與 battle.ts 的接線。
// 用法：node tests/section89.mjs            全部的群組（故意弄壞在 tests/section89-negative.mjs；真的 Chrome 在 tests/section89-browser.mjs）
//       node tests/section89.mjs <群組名>   只跑那一群
// 凍結的指紋是在 7bc015f 與 7d411a1（動手之前，兩個量出來一樣）量的，見卡面 docs/tasks/R089-更大規模的步兵.md。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import * as S89 from '../src/render/section89.ts';
import { BattleView, PRONE_TILT, PRONE_LIFT, setSection89 } from '../src/render/battle.ts';

const DEFAULT_ON = S89.section89On();   // 還沒有人碰開關之前的值
const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const OPTS = { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true };
const { UK_INFANTRY, UK_ZOMBIE, UK_MG, UK_MORTAR, SUB } = W;
const fnv = (h, x) => Math.imul(h ^ x, 0x01000193) >>> 0;
// men 網格的實例指紋：數量、陰影、哪一個網格、每個實例的矩陣與顏色（逐位）
function menDigest(v) {
  const m = v.men, n = m.count, a = new Uint32Array(m.instanceMatrix.array.buffer, m.instanceMatrix.array.byteOffset, n * 16), c = new Uint32Array(m.instanceColor.array.buffer, m.instanceColor.array.byteOffset, n * 3);
  let h = 0x811c9dc5; h = fnv(h, n); h = fnv(h, m.castShadow ? 1 : 0); h = fnv(h, m.geometry === v.menNormal ? 1 : 2);
  for (let i = 0; i < a.length; i++) h = fnv(h, a[i]);
  for (let i = 0; i < c.length; i++) h = fnv(h, c[i]);
  return h.toString(16).padStart(8, '0');
}
const AI = s => ({ t: 'ai', side: s, level: 3, v: 3 });
const SCEN = {
  rye: [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 1, guns: 1 }, AI(0), AI(1)],
  large: [{ t: 'map', id: 2, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 1, guns: 1 }, AI(0), AI(1)],
  town: [{ t: 'map', id: 3, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 1, guns: 1 }, AI(0), AI(1)],
  zombie: [{ t: 'map', id: 1, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, AI(0)],
  crowd: [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 2 }],
};
// 擠滿的局：萊伊、士氣第二版；第 1 步之後每邊放 16 個班（面對面），下一步一半往前走、兩個走進房子（上屋頂）
function crowd(w) {
  const add = (side, cx, cz) => { const id = w.units.length + 1, d = side ? SUB : -SUB; w.units.push({ id, side, kind: UK_INFANTRY, x: W.center(cx), z: W.center(cz), hp: W.UNIT_KINDS[UK_INFANTRY].hp, alive: true, order: W.ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d }); return id; };
  const free = (x, z) => W.inGrid(w, x, z) && !w.occ[W.cellIdx(w, x, z)] && !w.units.some(u => W.cellOf(u.x) === x && W.cellOf(u.z) === z);
  const ids = [[], []];
  for (const side of [0, 1]) for (let r = 0, n = 0; n < 16 && r < 400; r++) { const x = 6 + (r % 20), z = side ? 9 + Math.floor(r / 20) : 21 - Math.floor(r / 20); if (free(x, z)) { ids[side].push(add(side, x, z)); n++; } }
  const house = w.blds.find(b => b.kind === W.BK_HOUSE && b.hp > 0 && Math.abs(b.x - 14) + Math.abs(b.z - 18) < 12);
  return [{ t: 'move', side: 0, ids: ids[0].slice(0, 6), x: 16, z: 14 }, { t: 'move', side: 1, ids: ids[1].slice(0, 6), x: 14, z: 17 }, ...(house ? [{ t: 'move', side: 0, ids: ids[0].slice(14, 16), x: house.x, z: house.z }] : [])];
}
// 跑一局：每一步 snapshot → step → onEvents → update（鏡頭固定在地圖中間、zoom 1），每 every 步記一次指紋
function scenario(name, on, { every = 150, until = 3000, pure = false } = {}) {
  setSection89(on);
  const w = W.createWorld(1944), v = new BattleView(w, OPTS), sel = new Set(), digests = [];
  let later = null;
  while (w.tick < until && w.winner < 0) {
    v.snapshot(); step(w, w.tick === 0 ? SCEN[name] : w.tick === 1 && later ? later : []);
    if (name === 'crowd' && w.tick === 1) later = crowd(w);
    v.onEvents(w.events, w.tick / 20);
    v.target.set(w.n / 2, 0, w.n / 2); v.zoom = 1;
    const h = pure && w.tick % every === 0 ? [W.hashWorld(w), w.rng] : null;
    v.update(0.5, w.tick / 20, sel);
    if (h) assert.deepEqual([W.hashWorld(w), w.rng], h, `purity: update() leaves hashWorld and w.rng unchanged (${name}, tick ${w.tick})`);
    if (w.tick % every === 0) digests.push(menDigest(v));
  }
  const out = { digests, hash: W.hashWorld(w), w, v };
  return out;
}
// 在 7bc015f／7d411a1 凍結（閥關著必須一樣）：每 150 步的 men 指紋、最後的世界雜湊
const FROZEN = {
  rye: { hash: 'e62b0486', men: 'a4df2fac a4df2fac a2b8f621 871bfe21 8a67f621 8a67f621 8b461eec 8b461eec d7871f0e feb80753 feb80753 feb80753 feb80753 feb80753 feb80753' },
  large: { hash: '19505017', men: '2802236e 0bbbda29 1289d331 5ac06b0d ef0f0fdd 4a98d2f6 4e3985a9 0655255b 5b65faeb 5b65faeb f0f94f7c 10d3d49c 10d3d49c 10d3d49c 10d3d49c 10d3d49c 10d3d49c 10d3d49c 10d3d49c 10d3d49c' },
  town: { hash: '7504ab1a', men: 'e9aa0d72 f3849f9a 42d2e186 2f9b6d4b 2dc42bf3 6f164bbf 71f7bf89 d214ba40 a603866b cd540bee 244e33ee 244e33ee c5a88889 17950ba0 ec1077a0 9a582ba0 9f0baba0 35a54ba0 10270ba0 8c992ba0' },
  zombie: { hash: '6a4a5f71', men: 'd9842a7e d9842a7e acbe22a9 acbe22a9 acbe22a9 acbe22a9 acbe22a9 acbe22a9 65859055 c8081249 90fcdda0 671996ef 74dd8f9d ac8337c6 f6397f43 19e6220c d2a46d3e f12d5878 c2c1a382 826e9339' },
  crowd: { hash: 'a4d9e6d7', men: '3b4fcd3c 694dfe00 458a828a 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7 4ad5d5e7' },
};

// 小世界：32 格、沒有地形與建築
const blank = () => { const w = W.createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const add = (w, side, kind, cx, cz, hp) => { const id = w.units.length + 1; w.units.push({ id, side, kind, x: W.center(cx), z: W.center(cz), hp: hp ?? W.UNIT_KINDS[kind].hp, alive: true, order: W.ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
const addBld = (w, x, z, hp = 1000) => { const id = w.blds.length + 1; w.blds.push({ id, kind: W.BK_HOUSE, x, z, w: 1, d: 1, floors: 1, hp, maxHp: hp }); w.occ[W.cellIdx(w, x, z)] = id; return w.blds[id - 1]; };
const seeAll = (v, cx = 16, cz = 16) => { v.target.set(cx, 0, cz); v.zoom = 0.05; v.layout(1000, 1000); };
// 一幀：先記位置（插值用 alpha 1＝現在的位置），再畫
const framer = v => { let t = 1; const f = (dt = 0.05) => { v.snapshot(); v.update(1, t, new Set()); t += dt; return t; }; f.at = () => t; return f; };
const instances = v => { const a = v.men.instanceMatrix.array, out = []; for (let i = 0; i < v.men.count; i++) out.push({ x: a[i * 16 + 12], y: a[i * 16 + 13], z: a[i * 16 + 14], tilt: a[i * 16 + 1], m: Array.from(a.subarray(i * 16, i * 16 + 16)) }); return out; };
const L = S89.LAYOUTS89;
const minD = T => { let m = 9; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) m = Math.min(m, Math.hypot(T[i][0] - T[j][0], T[i][1] - T[j][1])); return m; };
const near = (p, q, eps = 1e-5) => Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps;

export const groups = {
  // 閥：開關關著（?noR089=1）時 men 網格逐位等於動手之前；世界雜湊不變
  valve() {
    for (const name of Object.keys(FROZEN)) {
      const r = scenario(name, false);
      assert.equal(r.hash, FROZEN[name].hash, `valve: the world hash is unchanged (${name})`);
      assert.equal(r.digests.join(' '), FROZEN[name].men, `valve: with ?noR089=1 the men instances are bit-identical to before R089 (${name})`);
      r.v.dispose();
    }
    console.log('  valve: rye, large, town, zombie, crowd — men buffers bit-identical to 7bc015f with the switch off');
  },
  // 人數：每 6 點血一個人；少的人躺下；最後剩 0–2 號；喪屍與砲手照舊
  count() {
    setSection89(true);
    const w = blank(), u = add(w, 0, UK_INFANTRY, 10, 10), v = new BattleView(w, OPTS), f = framer(v);
    seeAll(v); f(); const full = v.sec89.dbg.live, b0 = v.bodies.n;
    u.hp = 41; f(); const mid = v.sec89.dbg.live, b1 = v.bodies.n;
    u.hp = 0; u.alive = false; f(); const dead = v.sec89.dbg.live, b2 = v.bodies.n;
    assert(full === 10 && mid === 7 && dead === 0 && b0 === 0 && b1 === 3 && b2 === 10, `count: hp 60 shows 10, hp 41 shows 7, dead shows 0, and every lost figure leaves a body (${full}/${mid}/${dead}; bodies ${b0}/${b1}/${b2})`);
    assert.equal(v.menDbg.alive, 0, 'count: menDbg.alive follows the drawn figures');
    v.dispose();
    const w2 = blank(), u2 = add(w2, 0, UK_INFANTRY, 10, 10), v2 = new BattleView(w2, OPTS), f2 = framer(v2);
    seeAll(v2);
    for (let k = 10; k >= 1; k--) {
      u2.hp = 6 * k; f2();
      assert(v2.sec89.dbg.live === k && v2.bodies.n === 10 - k, `count: hp 6k shows k figures and 10 − k bodies (k=${k}: ${v2.sec89.dbg.live}, ${v2.bodies.n})`);
      if (k === 3) {
        const got = instances(v2).filter(p => Math.abs(p.tilt) < 0.5), cx = u2.x / SUB, cz = u2.z / SUB;
        const want = L[S89.L_HALT].slice(0, 3).map(([lx, lz]) => [cx + lx, cz + lz]);
        assert(got.length === 3 && want.every(q => got.some(p => near([p.x, p.z], q))), `count: the last three standing are slots 0–2 (leader and the Bren pair) ${JSON.stringify(got.map(p => [p.x, p.z]))}`);
      }
    }
    v2.dispose();
    // 喪屍、機槍組、迫擊砲的人在開關開著時跟關著逐位一樣（躺著的人只差浮點的最後幾位）
    const run = on => {
      setSection89(on);
      const w = blank(); add(w, 0, UK_ZOMBIE, 8, 8); add(w, 0, UK_ZOMBIE, 9, 8); add(w, 0, UK_ZOMBIE, 10, 8); add(w, 0, UK_MG, 12, 12); add(w, 0, UK_MORTAR, 14, 12);
      const v = new BattleView(w, OPTS), f = framer(v); seeAll(v);
      f(); w.units[0].hp = 25; f(); w.units[1].hp = 0; w.units[1].alive = false; f(); f();
      const out = { count: v.men.count, bodies: v.bodies.n, shadow: v.men.castShadow, normal: v.men.geometry === v.menNormal, m: instances(v), c: Array.from(v.men.instanceColor.array.subarray(0, v.men.count * 3)) };
      v.dispose(); return out;
    };
    const off = run(false), on = run(true), live = off.count - off.bodies;
    assert(off.count === on.count && off.bodies === on.bodies && off.bodies === 9 && off.shadow === on.shadow && off.normal === on.normal, `count: zombies, MG and mortar crews draw the same number of figures and bodies with the switch on (${off.count}/${on.count}, bodies ${off.bodies}/${on.bodies})`);
    for (let i = 0; i < off.count; i++) {
      const same = i < live ? off.m[i].m.every((x, k) => x === on.m[i].m[k]) : off.m[i].m.every((x, k) => Math.abs(x - on.m[i].m[k]) <= 1e-6);
      assert(same, `count: zombie and crew matrices equal the switch-off run (instance ${i}${i >= live ? ', a body' : ''})`);
    }
    assert.deepEqual(on.c, off.c, 'count: zombie, crew and body colours equal the switch-off run');
    console.log(`  count: 10/7/0 figures, k figures at 6k hp, slots 0–2 last; zombies and crews ${live} figures + ${off.bodies} bodies unchanged`);
  },
  // 隊形：表的距離、深寬；畫出來的位置照表；屋頂、趴下
  layout() {
    for (const [k, T] of L.entries()) {
      assert(T.length === S89.SECTION_MEN && T.every(p => Math.hypot(p[0], p[1]) <= 0.32), `layout: every figure stays within 0.32 of the centre (layout ${k})`);
      assert(minD(T) >= (k >= S89.L_ROOF ? 0.09 : 0.12) - 1e-9, `layout: settled figures stand at least 0.12 apart on the ground and 0.09 on a roof (layout ${k}: ${minD(T).toFixed(4)})`);
    }
    let blend = 9;
    for (let a = 0; a < L.length; a++) for (let b = 0; b < L.length; b++) if (a !== b) for (let s = 0; s <= 100; s++) blend = Math.min(blend, minD(L[a].map((p, i) => [p[0] + (L[b][i][0] - p[0]) * s / 100, p[1] + (L[b][i][1] - p[1]) * s / 100])));
    assert(blend >= 0.06, `layout: while changing formation figures stay at least 0.06 apart (${blend.toFixed(4)})`);
    const ext = T => [Math.max(...T.map(p => p[0])) - Math.min(...T.map(p => p[0])), Math.max(...T.map(p => p[1])) - Math.min(...T.map(p => p[1]))];
    const [md, mw] = ext(L[S89.L_MOVE]), [hd, hw] = ext(L[S89.L_HALT]), ranks = [...new Set(L[S89.L_PRONE].map(p => p[0]))].sort((a, b) => a - b);
    assert(md >= 2 * mw && hw >= 2 * hd, `layout: moving is a column (depth ${md} ≥ 2 × width ${mw}) and halted is a line (width ${hw} ≥ 2 × depth ${hd})`);
    assert(ranks.length === 2 && ranks[1] - ranks[0] >= 0.3 - 1e-9, `layout: prone ranks are at least 0.30 apart (${ranks})`);
    // 畫出來的：走的時候＝行進的表；停下來 0.2 秒時在兩個表之間、0.45 秒後＝停下的表
    setSection89(true);
    const w = blank(), u = add(w, 0, UK_INFANTRY, 10, 10), v = new BattleView(w, OPTS), f = framer(v), cx = u.x / SUB, cz = u.z / SUB;
    seeAll(v); u.path = [W.cellIdx(w, 20, 10)]; f();
    const pos = () => instances(v).map(p => [p.x, p.z]), table = k => L[k].map(([lx, lz]) => [cx + lx, cz + lz]);
    const isTable = (got, k) => got.length === 10 && table(k).every((q, i) => near(got[i], q));
    assert(isTable(pos(), S89.L_MOVE), `layout: a moving section is drawn as the two-file column ${JSON.stringify(pos())}`);
    u.path = []; f(0.2); f(0.2);
    const mid = pos();
    assert(!isTable(mid, S89.L_MOVE) && !isTable(mid, S89.L_HALT) && minD(mid) >= 0.06, 'layout: 0.2 s after stopping the section is between the two formations');
    f(0.25); f();
    assert(isTable(pos(), S89.L_HALT), `layout: 0.45 s after stopping the section stands in two ranks ${JSON.stringify(pos())}`);
    v.dispose();
    // 屋頂：在那一棟的範圍裡、高過地面
    const w2 = blank(), b = addBld(w2, 12, 12); add(w2, 0, UK_INFANTRY, 12, 12);
    const v2 = new BattleView(w2, OPTS), f2 = framer(v2); seeAll(v2); f2();
    const roof = instances(v2);
    assert(roof.length === 10 && roof.every(p => p.x > b.x && p.x < b.x + 1 && p.z > b.z && p.z < b.z + 1 && p.y > 0.2), `layout: roof figures lie inside the building footprint ${JSON.stringify(roof.map(p => [p.x, p.y, p.z].map(n => +n.toFixed(3))))}`);
    const roofR = Math.max(...roof.map(p => Math.hypot(p.x - (b.x + 0.5), p.z - (b.z + 0.5))));
    assert(roofR <= 0.32 * 0.75 + 1e-6, `layout: roof figures stand closer together (the ground layout × 0.75; farthest ${roofR.toFixed(3)})`);
    v2.dispose();
    // 方向：停下來在打（剛開過火）的班把隊形轉向瞄準的方向，最快 4 弧度／秒；沒在打的不轉
    const w4 = blank(), u4 = add(w4, 0, UK_INFANTRY, 10, 10), v4 = new BattleView(w4, OPTS), f4 = framer(v4), c4 = [u4.x / SUB, u4.z / SUB];
    const turned = th => L[S89.L_HALT].map(([lx, lz]) => [c4[0] + lx * Math.cos(th) + lz * Math.sin(th), c4[1] - lx * Math.sin(th) + lz * Math.cos(th)]);
    const at4 = th => { const got = instances(v4).map(p => [p.x, p.z]); return got.length === 10 && turned(th).every((q, i) => near(got[i], q, 1e-4)); };
    seeAll(v4); f4();
    const still = at4(0);
    u4.aimX = 0; u4.aimZ = -SUB; v4.fire44[u4.id] = f4.at(); f4(0.2); f4(0.2);
    const part = at4(1.0); f4();
    const full = at4(Math.PI / 2);
    assert(still && part && full, `layout: a halted section that is firing turns its line toward the target at 4 rad/s (start ${still}, 0.25 s ${part}, done ${full})`);
    v4.fire44[u4.id] = -99; u4.aimX = SUB; u4.aimZ = 0; f4(); f4(0.5); f4();
    assert(at4(Math.PI / 2), 'layout: a halted section that is not firing keeps its line where it is');
    v4.dispose();
    // 趴下：士氣第二版釘住時趴、第一版不趴
    for (const morale of [2, 1]) {
      const w3 = blank(), u3 = add(w3, 0, UK_INFANTRY, 10, 10); w3.rules = { morale }; u3.sup = 70;
      const v3 = new BattleView(w3, OPTS), f3 = framer(v3); seeAll(v3); f3();
      const ps = instances(v3), lying = ps.filter(p => Math.abs(p.tilt - Math.sin(PRONE_TILT)) < 1e-6 && Math.abs(p.y - PRONE_LIFT) < 1e-6).length;
      assert(morale === 2 ? lying === 10 && v3.menDbg.prone === 10 : lying === 0 && v3.menDbg.prone === 0, `layout: a pinned section lies prone under morale 2 and not under morale 1 (morale ${morale}: ${lying} lying)`);
      v3.dispose();
    }
    console.log(`  layout: radius ≤ 0.32, spacing ≥ 0.12 (roof 0.09), blends ≥ ${blend.toFixed(3)}, column ${md}×${mw}, line ${hw}×${hd}, prone ranks ${ranks}`);
  },
  // 純：畫面不改世界；同一串更新兩次逐位一樣；新檔不用亂數與時鐘
  purity() {
    const a = scenario('crowd', true, { every: 50, until: 900, pure: true }), b = scenario('crowd', true, { every: 50, until: 900 });
    assert.deepEqual(a.digests, b.digests, 'purity: the same sequence of updates gives the same men buffer twice');
    assert.equal(a.hash, b.hash, 'purity: the world is the same after both runs');
    a.v.dispose(); b.v.dispose();
    const code = src('src/render/section89.ts').replace(/\/\/[^\n]*/g, '');
    assert(!/Math\.random|Date\b|performance\.now/.test(code), 'purity: section89.ts uses no Math.random, Date or performance.now');
    console.log(`  purity: crowd 900 ticks twice → ${a.digests.length} identical digests; world unchanged by update()`);
  },
  // 看不到的不畫：畫面外的班不寫實例、少的人照樣躺下；鏡頭轉回來看得到；畫面裡的一定畫；id 700
  cull() {
    setSection89(true);
    const w = blank(), u = add(w, 0, UK_INFANTRY, 4, 4), v = new BattleView(w, OPTS), f = framer(v);
    v.layout(412, 860); v.zoom = 1; v.target.set(26, 0, 26); f();
    assert(v.sec89.dbg.live === 0 && v.sec89.dbg.culled === 10 && v.men.count === 0, `cull: an off-screen section writes no instances (${JSON.stringify(v.sec89.dbg)})`);
    u.hp = 30; f();
    assert(v.bodies.n === 5 && v.sec89.dbg.bodies === 0 && v.men.count === 0, `cull: men lost off screen are still laid down (bodies ${v.bodies.n})`);
    v.target.set(4.5, 0, 4.5); f();
    assert(v.sec89.dbg.live === 5 && v.sec89.dbg.bodies === 5, `cull: the bodies appear when the camera comes back (${JSON.stringify(v.sec89.dbg)})`);
    v.dispose();
    // 24 個鏡頭：中心在畫面裡的班一定畫；離畫面 2.2 格以上的不畫
    const w2 = blank(), cells = [];
    for (let z = 1; z < 32; z += 3) for (let x = 1; x < 32; x += 3) { add(w2, 0, UK_INFANTRY, x, z); cells.push([x + 0.5, z + 0.5]); }
    const v2 = new BattleView(w2, OPTS), f2 = framer(v2);
    let inside = 0, outside = 0;
    for (let k = 0; k < 24; k++) {
      const [cw, ch] = k % 2 ? [412, 860] : [1440, 900], hz = (k * 0.6180339887) % 1, hx = (k * 0.7548776662) % 1, hy = (k * 0.5698402910) % 1;
      v2.zoom = 0.55 + 2.45 * hz; v2.target.set(32 * hx, 0, 32 * hy); v2.layout(cw, ch); f2();
      const drawn = instances(v2), inv = v2.cam.matrixWorldInverse;
      for (const [x, z] of cells) {
        const p = new THREE.Vector3(x, 0, z).project(v2.cam), q = new THREE.Vector3(x, 0, z).applyMatrix4(inv), has = drawn.some(d => Math.hypot(d.x - x, d.z - z) < 0.35);
        if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) { inside++; assert(has, `cull: every section whose centre is on screen is drawn (camera ${k}, section at ${x},${z})`); }
        if (Math.abs(q.x) > v2.cam.right + 2.2 || Math.abs(q.y) > v2.cam.top + 2.2) { outside++; assert(!has, `cull: sections well off screen are not drawn (camera ${k}, section at ${x},${z})`); }
      }
    }
    v2.dispose();
    // 64 圖 id 700 的步兵班：畫得出來、位置是有限的數、沒有 console.error
    const w3 = W.createWorld(1944); step(w3, [{ t: 'map', id: 2, vegetation: 1 }]);
    while (w3.units.length < 699) { const d = add(w3, 0, UK_INFANTRY, 2, 2, 0); d.alive = false; }
    const big = add(w3, 0, UK_INFANTRY, 32, 32);
    const v3 = new BattleView(w3, OPTS), errs = [], ce = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    try { v3.onEvents([], 1); v3.target.set(32.5, 0, 32.5); v3.zoom = 1; v3.layout(412, 860); v3.snapshot(); v3.update(1, 1, new Set()); } finally { console.error = ce; }
    const ps = instances(v3);
    assert(big.id === 700 && errs.length === 0 && ps.length >= 10 && ps.every(p => p.m.every(Number.isFinite)) && v3.sec89.dbg.live === 10, `cull: on the 64 map an infantry unit with id 700 draws finite figures with no console error (${errs[0] ?? ''}; ${v3.sec89.dbg.live} figures)`);
    v3.dispose();
    console.log(`  cull: off-screen section culled and its bodies kept; 24 cameras: ${inside} on-screen sections all drawn, ${outside} far ones skipped; id 700 draws`);
  },
  // 降級：F＝228／229、457／458、800 的網格、陰影、三角形；回升要等 1 秒；T2 躺著的人最多 min(64, 800 − 活著的)；喪屍模式不用 T0
  tiers() {
    setSection89(true);
    const make = figs => { const w = blank(); let left = figs, i = 0; while (left > 0) { const k = Math.min(10, left); add(w, 0, UK_INFANTRY, 1 + (i % 30), 1 + 2 * Math.floor(i / 30), 6 * k); left -= k; i++; } return w; };
    const want = [[228, 0, 140], [229, 1, 70], [457, 1, 70], [458, 2, 40], [800, 2, 40]];
    for (const [F, tier, per] of want) {
      const w = make(F), v = new BattleView(w, OPTS), f = framer(v); seeAll(v); f();
      const d = v.sec89.dbg, dense = v.men.geometry !== v.menNormal;
      assert(d.F === F && d.tier === tier && v.men.castShadow === (tier === 0) && dense === (tier === 2) && d.tris === F * per && d.tris <= S89.MEN_TRIS89, `tiers: ${F} figures → T${tier} (${tier === 2 ? 'dense' : 'full'}, ${tier === 0 ? 'shadow' : 'no shadow'}, ${F * per} triangles ≤ 32,000) — got ${JSON.stringify(d)}, shadow ${v.men.castShadow}, dense ${dense}`);
      v.dispose();
    }
    // 回升：229 → T1；只剩 220（≤ 228 但 > 九成）一直是 T1；剩 200（≤ 九成）要等滿 1 秒才回 T0；再到 229 馬上 T1
    // 人數用「搬到畫面外」來減（減血會多出躺著的人，F 不會變少）
    const w = make(229), v = new BattleView(w, OPTS), f = framer(v), away = u => { u.x = W.center(600); u.z = W.center(600); }, home = w.units.map(u => [u.x, u.z]);
    seeAll(v); f(); const t229 = v.sec89.dbg.tier;
    away(w.units[w.units.length - 1]); f(); f(1.5); f(); const stay = [v.sec89.dbg.F, v.sec89.dbg.tier];
    away(w.units[0]); away(w.units[1]); f(0.5); const f0 = v.sec89.dbg.F, t0 = v.sec89.dbg.tier; f(0.45); const t1 = v.sec89.dbg.tier; f(0.15); f(); const t2 = v.sec89.dbg.tier;
    assert(t229 === 1 && stay[0] === 220 && stay[1] === 1 && f0 === 200 && t0 === 1 && t1 === 1 && t2 === 0, `tiers: stepping back to a richer tier waits 1 s at ≤ 90 % of its limit (229: T${t229}; ${stay[0]} after 1.5 s: T${stay[1]}; ${f0}: T${t0} → T${t1} → T${t2})`);
    w.units.forEach((u, i) => { [u.x, u.z] = home[i]; }); f();
    assert(v.sec89.dbg.F === 229 && v.sec89.dbg.tier === 1, 'tiers: a crowd steps down at once');
    v.dispose();
    // T2 的躺著的人：活著的 790 → 10 個；780 → 20 個；680 → 最多 64 個（留最新的）
    const w2 = make(800), v2 = new BattleView(w2, OPTS), f2 = framer(v2); seeAll(v2); f2();
    const kill = n => { for (const u of w2.units.filter(u => u.alive).slice(0, n)) { u.hp = 0; u.alive = false; } f2(); return v2.sec89.dbg; };
    const k1 = kill(1), k2 = kill(1), first = w2.units[0];
    const k3 = kill(10), bodies = instances(v2).filter(p => p.tilt > 0.5);
    assert(k1.bodies === 10 && k2.bodies === 20 && k3.bodies === 64 && k3.tier === 2 && k3.tris <= S89.MEN_TRIS89, `tiers: at T2 bodies shown ≤ min(64, 800 − live) (${k1.bodies}, ${k2.bodies}, ${k3.bodies})`);
    assert(!bodies.some(p => Math.hypot(p.x - first.x / SUB, p.z - first.z / SUB) < 0.4), 'tiers: at T2 the newest bodies are the ones kept');
    v2.dispose();
    // 喪屍模式不用 T0
    setSection89(true);
    const wz = W.createWorld(1944); step(wz, SCEN.zombie);
    const vz = new BattleView(wz, OPTS), fz = framer(vz); seeAll(vz); fz();
    assert(vz.sec89.dbg.tier >= 1 && !vz.men.castShadow, `tiers: zombie mode never uses T0 (T${vz.sec89.dbg.tier}, ${vz.sec89.dbg.F} figures)`);
    vz.dispose();
    console.log(`  tiers: 228→T0, 229→T1, 457→T1, 458→T2, 800→T2 (32,000 triangles); back to T0 after 1 s; T2 bodies ${k1.bodies}/${k2.bodies}/${k3.bodies}`);
  },
  // 直接寫的矩陣＝Object3D 的；跟 battle.ts 共用的數一樣
  matrix() {
    const o = new THREE.Object3D(), a = new Float32Array(16);
    let worst = 0;
    for (let i = 0; i < 64; i++) {
      const r = k => ((i * 0.7548776662 + k * 0.5698402910) % 1);
      const yaw = (r(1) * 2 - 1) * Math.PI, tilt = [0, PRONE_TILT, Math.PI / 2, (r(2) * 2 - 1) * 1.5][i % 4], s = [0.5 + r(3), 0.5 + r(4), 0.5 + r(5)];
      o.position.set(r(6) * 64, r(7), r(8) * 64); o.rotation.set(0, yaw, tilt); o.scale.set(...s); o.updateMatrix();
      S89.put89(a, 0, o.position.x, o.position.y, o.position.z, yaw, tilt, ...s);
      for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a[k] - o.matrix.elements[k]));
    }
    assert(worst <= 1e-5, `matrix: the directly written matrices equal Object3D's (worst ${worst})`);
    const b = src('src/render/battle.ts');
    assert(b.includes(`const BASE_HALF_H = ${S89.HALF_H89};`) && b.includes('const ELEV = Math.PI / 6;') && S89.ELEV89 === Math.PI / 6, 'matrix: the culling camera matches battle.ts (BASE_HALF_H, ELEV)');
    assert(S89.PRONE_TILT89 === PRONE_TILT && S89.PRONE_LIFT89 === PRONE_LIFT, 'matrix: the prone pose matches battle.ts (R075)');
    console.log(`  matrix: 64 poses, worst difference ${worst.toExponential(2)}`);
  },
  // 接線：總機開、閥、battle.ts 三行、cdp 的預設；模組預設關
  wiring() {
    assert.equal(DEFAULT_ON, false, 'wiring: the module switch starts off');
    assert.match(src('src/main.ts'), /setWearArt\(V\.r088\); setSection89\(V\.r089\);/, 'wiring: the hub turns R089 on unless ?noR089=1');
    assert.match(src('src/valves.ts'), /get r089\(\) \{ return on\('089'\); \}/, 'wiring: ?noR089=1 is a valve');
    const b = src('src/render/battle.ts');
    assert(b.includes('if (this.sec89.has(u.kind)) nm = this.sec89.draw(u, x, z, simT, col, nm); else if (u.kind === UK_INFANTRY || u.kind === UK_ZOMBIE) nm = this.squad21(') &&
      b.includes('nm = section89On() ? this.sec89.bodies(nm) : this.bodies21(nm);') && b.includes('this.men.geometry = section89On() ? this.sec89.finish(nm) :') &&
      b.includes('    this.zombieUnitSlots();   // R089'), 'wiring: battle.ts sends infantry, bodies and the tier to section89 only when the switch is on, and grows unit arrays on every map');
    const c = src('tools/cdp.mjs');
    assert(c.includes('const url89 = /(^|&)noR089=/.test(url) ? url : `${url}&noR089=1`;') && c.includes('/${entry}?${url89}`'), 'wiring: tools/cdp.mjs adds noR089=1 unless a guard asks for R089');
    setSection89(false); const s = new S89.Section89({});
    const off = s.has(UK_INFANTRY); setSection89(true);
    assert(!off && s.has(UK_INFANTRY) && !s.has(UK_ZOMBIE) && !s.has(UK_MG), 'wiring: only rifle sections are drawn as ten, and only with the switch on');
    console.log('  wiring: hub, valve, battle.ts, cdp default');
  },
  // 處理器時間（假局 B：64 圖、每邊 40 個班、躺下 300 個人；手機鏡頭 zoom 0.55）：開著比關著 update() 多 ≤ 1.0 毫秒（五次的中位數）
  bench() {
    const w = W.createWorld(1944); step(w, [{ t: 'map', id: 2, vegetation: 1 }]); w.units = [];
    for (const side of [0, 1]) for (let r = 0, n = 0; n < 40 && r < 2000; r++) {
      const x = 18 + (r % 28), z = side ? 34 + Math.floor(r / 28) : 30 - Math.floor(r / 28);
      if (!w.occ[W.cellIdx(w, x, z)]) { add(w, side, UK_INFANTRY, x, z); n++; }
    }
    const opt = { ...OPTS, fog: false }, views = [true, false].map(on => { setSection89(on); const v = new BattleView(w, opt); v.layout(412, 860); v.target.set(32, 0, 32); v.zoom = 0.55; return { on, v, t: 1 }; });
    const frame = V => { setSection89(V.on); V.v.snapshot(); V.v.update(1, V.t, new Set()); V.t += 0.05; };
    for (const V of views) frame(V);
    for (let k = 0; k < 4; k++) { for (const u of w.units) u.hp -= 6; for (const V of views) frame(V); }
    for (const u of w.units) u.hp = 60;   // 人回來了，躺著的人還在：活著的 800＋躺著的 300
    const times = { true: [], false: [] };
    for (let run = 0; run < 5; run++) for (const V of run % 2 ? views : [...views].reverse()) {
      for (let i = 0; i < 5; i++) frame(V);
      const t0 = performance.now(); for (let i = 0; i < 30; i++) frame(V); times[V.on].push((performance.now() - t0) / 30);
    }
    const med = a => [...a].sort((x, y) => x - y)[2], on = med(times.true), off = med(times.false), d = views[0].v.sec89.dbg;
    console.log(`  bench: update() ${on.toFixed(3)} ms on vs ${off.toFixed(3)} ms off (+${(on - off).toFixed(3)}); ring ${views[0].v.bodies.n} bodies; ${JSON.stringify(d)}`);
    assert(views[0].v.bodies.n === 300 && d.tier === 2 && d.tris <= S89.MEN_TRIS89, `bench: fixture B has 300 bodies and stays within the men budget (${JSON.stringify(d)})`);
    assert(on - off <= 1.0, `bench: R089 adds at most 1.0 ms to update() on fixture B (${on.toFixed(3)} vs ${off.toFixed(3)} ms)`);
    for (const V of views) V.v.dispose();
  },
};
export const ALL = ['valve', 'count', 'layout', 'purity', 'cull', 'tiers', 'matrix', 'wiring', 'bench'];
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const only = process.argv[2];
  for (const g of only ? [only] : ALL) { assert(groups[g], `unknown group ${g}`); const t0 = Date.now(); groups[g](); console.log(`OK section89/${g} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  console.log('section89: all OK');
}
