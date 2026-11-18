// R096 先把大仗撐住（Node）：找目標從最近的試起（src/sim/step.ts 的 pickAim，結果逐位一樣）；畫面上超過 800 個人時每班少畫幾個（src/render/section89.ts 的 T3）。
// 用法：node tests/crowd96.mjs            全部的群組（故意弄壞在 tests/crowd96-negative.mjs；真的 Chrome 在 tests/crowd96-browser.mjs）
//       node tests/crowd96.mjs <群組名>   只跑那一群
// 凍結的雜湊是在 8a7351a（動手之前）量的；64 場對打全部的收據在卡面 docs/tasks/R096-先把大仗撐住.md。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../src/sim/world.ts';
import { step, pickAim, spotted, firstBlock, ridge } from '../src/sim/step.ts';
import { dist } from '../src/sim/math.ts';
import { duel, ECO } from '../tools/duel.mjs';
import * as S89 from '../src/render/section89.ts';
import { BattleView, setSection89, setCrowd96 } from '../src/render/battle.ts';

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { UNIT_KINDS, UK_INFANTRY, UK_TANK, UK_ZOMBIE, SUB, ORD_ATTACK, ORD_FIRE_AT } = W;

// ---- 8a7351a 的 pickAim「自己找目標」那一段，一字不差（只包成函式、homeOf 抄過來） ----
const homeOf = (w, u) => { if (!UNIT_KINDS[u.kind].garrison) return 0; const b = W.bldAt(w, W.cellOf(u.x), W.cellOf(u.z)); return b && b.hp > 0 ? b.id : 0; };
function oldPick(w, u) {
  const k = UNIT_KINDS[u.kind];
  let best = null, bestD = 0;
  for (const t of w.units) {
    if (!t.alive || t.side === u.side) continue;
    const d = dist(u.x, u.z, t.x, t.z);
    if (d > k.range || d < k.minRange) continue;
    if (!spotted(w, u.side, t.x, t.z) || (!k.indirect && firstBlock(w, u.x, u.z, t.x, t.z, homeOf(w, u)) >= 0)) continue;
    if (!k.indirect && ridge(w, u.x, u.z, t.x, t.z)) continue;   // R055：直射的不挑被稜線擋住的目標
    if (k.sup && UNIT_KINDS[t.kind].armored && !UNIT_KINDS[t.kind].openTop) continue;   // R080：機槍組待命時不自己去打封閉車身的裝甲（打不動）
    if (!best || d < bestD || (d === bestD && t.id < best.id)) { best = t; bestD = d; }
  }
  return best;
}
// 在這個世界上，每一個「自己找目標」的單位（不是攻擊指令、不是射擊指令、有射程）新舊挑到同一個；回 [比了幾個, 挑到東西的幾個]
function sameAim(w, where) {
  let n = 0, picked = 0;
  for (const u of w.units) {
    if (!u.alive || u.order === ORD_ATTACK || u.order === ORD_FIRE_AT || !(UNIT_KINDS[u.kind].range > 0)) continue;
    const a = pickAim(w, u)?.unit?.id ?? 0, b = oldPick(w, u)?.id ?? 0;
    assert.equal(a, b, `aim: the nearest-first search picks the same target as before (${where}, unit ${u.id}: ${a} vs ${b})`);
    n++; if (b) picked++;
  }
  return [n, picked];
}
const AI = s => ({ t: 'ai', side: s, level: 3, v: 3 });
const SCEN = {
  rye: [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 1, guns: 1 }, AI(0), AI(1)],
  large: [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2 }, AI(0), AI(1)],
  town: [{ t: 'map', id: 3, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 1, guns: 1 }, AI(0), AI(1)],
  hills: [{ t: 'map', id: 4, vegetation: 1 }, { t: 'eco', inf: 1, mg: 2, guns: 1, tanks: 1 }, AI(0), AI(1)],
  zombie: [{ t: 'map', id: 1, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, AI(0)],
};
// 擠滿的萊伊（第 1 步之後每邊 16 個班面對面、一半往前走、兩個走進房子）與 96 圖的大戰（每邊 40 個班交戰）：跟 tests/section89.mjs 同一組
function crowdSim(w) {
  const add = (side, cx, cz) => { const id = w.units.length + 1, d = side ? SUB : -SUB; w.units.push({ id, side, kind: UK_INFANTRY, x: W.center(cx), z: W.center(cz), hp: UNIT_KINDS[UK_INFANTRY].hp, alive: true, order: W.ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d }); return id; };
  const free = (x, z) => W.inGrid(w, x, z) && !w.occ[W.cellIdx(w, x, z)] && !w.units.some(u => W.cellOf(u.x) === x && W.cellOf(u.z) === z);
  const ids = [[], []];
  for (const side of [0, 1]) for (let r = 0, n = 0; n < 16 && r < 400; r++) { const x = 6 + (r % 20), z = side ? 9 + Math.floor(r / 20) : 21 - Math.floor(r / 20); if (free(x, z)) { ids[side].push(add(side, x, z)); n++; } }
  const house = w.blds.find(b => b.kind === W.BK_HOUSE && b.hp > 0 && Math.abs(b.x - 14) + Math.abs(b.z - 18) < 12);
  return [{ t: 'move', side: 0, ids: ids[0].slice(0, 6), x: 16, z: 14 }, { t: 'move', side: 1, ids: ids[1].slice(0, 6), x: 14, z: 17 }, ...(house ? [{ t: 'move', side: 0, ids: ids[0].slice(14, 16), x: house.x, z: house.z }] : [])];
}
function massSim(w) {
  const add = (side, cx, cz) => { const id = w.units.length + 1, d = side ? SUB : -SUB; w.units.push({ id, side, kind: UK_INFANTRY, x: W.center(cx), z: W.center(cz), hp: UNIT_KINDS[UK_INFANTRY].hp, alive: true, order: W.ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d }); return id; };
  const free = (x, z) => W.inGrid(w, x, z) && !w.occ[W.cellIdx(w, x, z)] && !w.units.some(u => u.alive && W.cellOf(u.x) === x && W.cellOf(u.z) === z);
  for (const side of [0, 1]) for (let r = 0, n = 0; n < 40 && r < 4000; r++) { const x = 34 + (r % 28), z = side ? 46 - Math.floor(r / 28) : 50 + Math.floor(r / 28); if (free(x, z)) { add(side, x, z); n++; } }
  return [];
}
const SPECIAL = { crowd: [[{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 2 }], crowdSim, 900], mass: [[{ t: 'map', id: 3, vegetation: 1 }], massSim, 900] };
// 壓力局：64 圖、每邊 pop 個單位（七成步兵、三成坦克）兩群貼在一起、擬真規則（跟卡面的收據同一個）
function stressWorld(pop, seed = 3) {
  const w = W.createWorld(seed);
  step(w, [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2 }]);
  for (const u of w.units) { u.alive = false; u.hp = 0; }
  const mid = w.n >> 1;
  const put = (side, kind, cx, cz) => { const id = w.units.length + 1, d = side ? SUB : -SUB; w.units.push({ id, side, kind, x: W.center(cx), z: W.center(cz), hp: UNIT_KINDS[kind].hp, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: d, aimZ: d, ...(UNIT_KINDS[kind].armored ? { hullX: d, hullZ: d } : {}) }); };
  for (const side of [0, 1]) {
    let placed = 0; const off = side ? -4 : 4;
    for (let r = 0; placed < pop && r < 20; r++) for (let dz = -r; dz <= r && placed < pop; dz++) for (let dx = -r; dx <= r && placed < pop; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = mid + off + dx, z = mid + off + dz;
      if (x < 0 || z < 0 || x >= w.n || z >= w.n || W.blocks(w, x, z)) continue;
      put(side, placed < pop * 0.7 ? UK_INFANTRY : UK_TANK, x, z); placed++;
    }
  }
  return w;
}
// 在 8a7351a 凍結：八場對打（64 場裡種子 1 的那八場）、三個壓力局 600 步之後的雜湊
const DUELS = ['0/1/classic 959f04e6 4055', '0/1/real 7a49c497 4148', '1/1/classic f9f09edd 2295', '1/1/real 28eb2e92 6180', '2/1/classic 59bf66e0 12000', '2/1/real 5d24c3dd 12000', '3/1/classic db477692 12000', '3/1/real 4ae7c5b2 7417'];
const STRESS = { 40: 'bb2fb329', 56: '3c7d858f', 64: 'a6a51f76' };

// 畫面：32 格的空地放 count 個班（雙方各半、霧關掉、鏡頭看得到全部）
const OPTS = { fx: true, fog: false, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true };
function crowd(count, zombies = 0, mgs = 0, hpOf = () => 60) {
  const w = W.createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = [];
  for (let i = 0; i < count + zombies + mgs; i++) {
    const kind = i < count ? UK_INFANTRY : i < count + zombies ? UK_ZOMBIE : W.UK_MG;
    w.units.push({ id: i + 1, side: i < count ? i % 2 : 0, kind, x: W.center(i % 32), z: W.center(Math.floor(i / 32)), hp: i < count ? hpOf(i) : UNIT_KINDS[kind].hp, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 });
  }
  const v = new BattleView(w, OPTS); v.target.set(16, 0, 16); v.zoom = 0.05; v.layout(1000, 1000);
  let t = 1; const f = () => { v.snapshot(); v.update(1, t, new Set()); t += 0.05; return v.sec89.dbg; };
  return { w, v, f };
}
// 每一班畫了幾個人（照位置分給最近的班）
const perSection = (w, v, count) => { const a = v.men.instanceMatrix.array, got = new Array(count).fill(0); for (let i = 0; i < v.men.count; i++) { const x = a[i * 16 + 12], z = a[i * 16 + 14], c = Math.floor(z) * 32 + Math.floor(x); if (c < count && Math.abs(a[i * 16 + 1]) < 0.5) got[c]++; } return got; };
const fnv = (h, x) => Math.imul(h ^ x, 0x01000193) >>> 0;
const DEFAULT_96 = (() => { setSection89(true); const A = crowd(128); A.f(); const d = A.f(); A.v.dispose(); return d.live; })();   // 還沒有人碰 setCrowd96：應該照 R089 全部畫
const DIG89 = 'ffa5a777';   // R089（8a7351a）畫 crowd(128) 兩幀的指紋
const digest = v => { const m = v.men, a = new Uint32Array(m.instanceMatrix.array.buffer, 0, m.count * 16); let h = fnv(0x811c9dc5, m.count); for (const x of a) h = fnv(h, x); return h; };

export const groups = {
  // 找目標：七局（萊伊、64、96、丘陵、喪屍、擠滿的萊伊、96 圖大戰）與兩個壓力局的每一步、每一個自己找目標的單位，新舊挑到同一個；八場對打與三個壓力局的雜湊＝動手之前
  aim() {
    let n = 0, picked = 0;
    // 每一局的每一步（電腦對打 2,400 步、擠滿的萊伊與 96 圖大戰 900 步、壓力局 300 步）
    for (const [name, cmds] of Object.entries(SCEN)) {
      const w = W.createWorld(1944);
      while (w.tick < 2400 && w.winner < 0) { step(w, w.tick === 0 ? cmds : []); const [a, b] = sameAim(w, `${name} tick ${w.tick}`); n += a; picked += b; }
    }
    for (const [name, [cmds, add, until]] of Object.entries(SPECIAL)) {
      const w = W.createWorld(1944); let later = [];
      while (w.tick < until && w.winner < 0) { step(w, w.tick === 0 ? cmds : w.tick === 1 ? later : []); if (w.tick === 1) later = add(w); const [a, b] = sameAim(w, `${name} tick ${w.tick}`); n += a; picked += b; }
    }
    for (const pop of [40, 64]) { const w = stressWorld(pop); for (let i = 0; i < 300; i++) { step(w, []); const [a, b] = sameAim(w, `stress ${pop} step ${i}`); n += a; picked += b; } }
    assert(picked > 20000, `aim: the comparison saw plenty of real targets (${picked} of ${n})`);
    for (const row of DUELS) {
      const [key, hash, ticks] = row.split(' '), [map, seed, rules] = key.split('/');
      const r = duel({ map: +map, seed: +seed, ticks: 12000, rules: rules === 'real' ? { ap: 1, morale: 2 } : null, a: { level: 3, v: 3 }, b: { level: 3, v: 3 }, end: true, mg: 2 });
      assert.equal(`${r.hash} ${r.ticks}`, `${hash} ${ticks}`, `aim: duel ${key} ends exactly as before R096`);
    }
    for (const [pop, hash] of Object.entries(STRESS)) { const w = stressWorld(+pop); for (let i = 0; i < 600; i++) step(w, []); assert.equal(W.hashWorld(w), hash, `aim: the ${pop}-a-side stress battle ends exactly as before R096`); }
    // id 超過 2^20 的單位（喪屍模式打一千波以上才會有）：照樣挑對
    const wb = W.createWorld(1); wb.units = []; const shooter = { id: 1, side: 0, kind: UK_INFANTRY, x: W.center(5), z: W.center(5), hp: 60, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
    const dead = { ...shooter, id: 0, side: 1, alive: false, hp: 0 }, far = 2 ** 20 + 1;
    wb.units = new Array(far).fill(dead); wb.units[0] = shooter; wb.units[far - 1] = { ...shooter, id: far, side: 1, x: W.center(7) };
    let big; try { big = pickAim(wb, shooter)?.unit?.id ?? 0; } catch (e) { big = `threw ${e.message}`; }
    assert.equal(big, oldPick(wb, shooter)?.id ?? 0, `aim: a target whose id is above 2^20 is still picked (${big})`);
    console.log(`  aim: ${n} unit-ticks compared (${picked} with a target), 8 duels and 3 stress battles unchanged, id ${far} picked`);
  },
  // T3：這一幀數好再畫——想畫 1,280 個 → 第一幀就每班 6 個（768）、連續 60 幀一樣；800 個以內逐位不變；不到 6 個人的班不會被擠掉；
  // 喪屍與砲手先扣掉；鏡頭一跳也沒有哪一班少一幀；放寬要連續 60 幀；少畫的是號碼大的人；不管怎樣活著的小兵最多 800 個
  t3() {
    setSection89(true); setCrowd96(true);
    const A = crowd(128), d0 = A.f(), counts = new Set();
    for (let i = 0; i < 60; i++) counts.add(A.f().live);
    const per = perSection(A.w, A.v, 128);
    assert(d0.live === 768 && d0.want === 1280 && d0.cap === 6 && d0.tris <= S89.MEN_TRIS89 && counts.size === 1 && counts.has(768) && per.every(c => c === 6), `t3: 1,280 wanted figures draw 6 per section from the first frame (${d0.live}; ${[...counts]}; per section ${[...new Set(per)]})`);
    // 少畫的是號碼大的：每班留的是 0–5 號（照停下的隊形的位置）
    const a = A.v.men.instanceMatrix.array, first = [];
    for (let i = 0; i < A.v.men.count; i++) { const x = a[i * 16 + 12], z = a[i * 16 + 14]; if (Math.floor(x) === 0 && Math.floor(z) === 0) first.push([x, z]); }
    const slots = S89.LAYOUTS89[S89.L_HALT].slice(0, 6).map(([lx, lz]) => [0.5 + lx, 0.5 + lz]);
    assert(first.length === 6 && slots.every(q => first.some(p => Math.abs(p[0] - q[0]) < 1e-4 && Math.abs(p[1] - q[1]) < 1e-4)), `t3: a thinned section keeps its leader, Bren group and the next men (slots 0–5) ${JSON.stringify(first)}`);
    A.v.dispose();
    const dig = on => { setCrowd96(on); const B = crowd(80); B.f(); B.f(); const r = [digest(B.v), B.v.sec89.dbg.live]; B.v.dispose(); return r; };
    const on800 = dig(true), off800 = dig(false);
    assert(on800[1] === 800 && on800[0] === off800[0], `t3: 800 wanted figures draw exactly as R089 (${on800} vs ${off800})`);
    setCrowd96(true);
    // 一半的班只剩 5 個人：不能照比例算（舊的算法會讓最後幾班一個人都不畫）
    for (const [label, hpOf] of [['worn first', i => (i < 64 ? 30 : 60)], ['worn last', i => (i < 64 ? 60 : 30)], ['mixed', i => (i % 4 < 2 ? 30 : 60)]]) {
      const M = crowd(128, 0, 0, hpOf); M.f(); const dm = M.f(), pm = perSection(M.w, M.v, 128);
      assert(dm.live <= S89.LIVE96 && pm.every(c => c >= S89.MIN96), `t3: when some sections are under strength every section still shows at least 3 (${label}: ${dm.live} figures, cap ${dm.cap}, per section ${[...new Set(pm)]})`);
      M.v.dispose();
    }
    // 喪屍與砲手：先扣掉、照畫；加起來最多 800、小兵 ≤ 32,000 個三角形
    const C = crowd(60, 60); const c1 = C.f();
    assert(c1.live === 420 && c1.F === 780 && c1.others === 360, `t3: zombies and crews keep every figure; only sections draw fewer (${c1.live} section figures, ${c1.F} in all, others ${c1.others})`);
    C.v.dispose();
    const G = crowd(80, 40, 20); const g1 = G.f();
    assert(g1.others === 300 && g1.F - g1.live === 300 && g1.F <= S89.LIVE96 && g1.tris <= S89.MEN_TRIS89, `t3: with zombies and MG crews the whole men mesh stays within 800 figures and 32,000 triangles (${g1.F} figures, others ${g1.others}, ${g1.tris} triangles)`);
    G.v.dispose();
    // 鏡頭一跳：從只看得到幾班跳到全部，那一幀就每班 6 個，沒有哪一班少掉
    const J = crowd(128); J.v.target.set(2, 0, 2); J.v.zoom = 3; J.f(); J.v.target.set(16, 0, 16); J.v.zoom = 0.05; const j1 = J.f(), pj = perSection(J.w, J.v, 128);
    assert(j1.live === 768 && pj.every(c => c === 6), `t3: on the frame the camera jumps to the whole crowd no section is missing (${j1.live}; ${[...new Set(pj)]})`);
    // 放寬：20 班離開畫面，每班可以畫 7 個，但要連續 60 幀才放；回來馬上收
    const away = J.w.units.slice(0, 20), home = away.map(u => [u.x, u.z]);
    for (const u of away) { u.x = W.center(900); u.z = W.center(900); }
    let k = 0, capAt59 = 0; for (; k < 60; k++) { const d = J.f(); if (k === 58) capAt59 = d.cap; }
    const capAt60 = J.v.sec89.dbg.cap;
    away.forEach((u, i) => { [u.x, u.z] = home[i]; }); const back = J.f();
    assert(capAt59 === 6 && capAt60 === 7 && back.cap === 6 && back.live <= S89.LIVE96, `t3: the cap rises only after 60 frames and drops at once (frame 59 ${capAt59}, frame 60 ${capAt60}, back ${back.cap})`);
    J.v.dispose();
    const D = crowd(270); const dd = D.f(), perD = perSection(D.w, D.v, 270).filter(c => c > 0);
    assert(dd.live <= S89.LIVE96 && perD.filter(c => c < S89.MIN96).length <= 1, `t3: never more than 800 live figures, and a drawn section shows at least 3 (only the one cut by the 800 limit may show fewer: ${dd.live}; ${[...new Set(perD)]})`);
    D.v.dispose();
    console.log(`  t3: 1,280 wanted → ${d0.live} (6 a section from the first frame, steady); 800 → bit-identical; under-strength mixes all ≥ 3; zombies/crews kept; camera jump OK; cap rises after 60 frames; 2,700 wanted → ${dd.live}`);
  },
  // 閥：?noR096=1（開關關著）→ 想畫 1,280 個的時候照 R089 全部畫，逐位跟 R089 一樣
  valve() {
    setSection89(true); setCrowd96(false);
    const A = crowd(128); A.f(); const d = A.f(), h = digest(A.v).toString(16).padStart(8, '0');
    assert(d.live === 1280 && h === DIG89, `valve: with ?noR096=1 every figure is drawn as in R089 (${d.live} figures, ${h} vs ${DIG89})`);
    A.v.dispose();
    console.log('  valve: off → 1,280 figures, bit-identical to R089');
  },
  // 純：畫面不改世界；新的程式碼沒有亂數與時鐘
  purity() {
    setSection89(true); setCrowd96(true);
    const A = crowd(128), h = W.hashWorld(A.w), r = A.w.rng; for (let i = 0; i < 5; i++) A.f();
    assert.deepEqual([W.hashWorld(A.w), A.w.rng], [h, r], 'purity: update() leaves the world unchanged');
    A.v.dispose();
    const code = src('src/sim/step.ts').split('export function pickAim')[1].split('\nfunction syncRanging')[0].replace(/\/\/[^\n]*/g, '');
    assert(!/Math\.random|Date\b|performance\.now/.test(code), 'purity: pickAim uses no randomness or clock');
    console.log('  purity: OK');
  },
  // 接線：總機開、閥、模組預設關；src/sim 只有 pickAim 那一段（四個檢查都還在）
  wiring() {
    assert.equal(DEFAULT_96, 1280, 'wiring: T3 starts off (a crowd of 1,280 is drawn in full until the hub turns it on)');
    assert.match(src('src/main.ts'), /setSection89\(V\.r089\); setCrowd96\(V\.r096\);/, 'wiring: the hub turns R096 on unless ?noR096=1');
    assert.match(src('src/valves.ts'), /get r096\(\) \{ return on\('096'\); \}/, 'wiring: ?noR096=1 is a valve');
    const body = src('src/sim/step.ts').split('export function pickAim')[1].split('\nfunction syncRanging')[0];
    for (const line of ['if (k.sup && UNIT_KINDS[t.kind].armored && !UNIT_KINDS[t.kind].openTop) continue;', 'if (!k.indirect && ridge(w, u.x, u.z, t.x, t.z)) continue;', 'if (!k.indirect && firstBlock(w, u.x, u.z, t.x, t.z, homeOf(w, u)) >= 0) continue;', 'if (!spotted(w, u.side, t.x, t.z)) continue;'])
      assert(body.includes(line), `wiring: pickAim keeps all four checks (${line.slice(0, 40)}…)`);
    console.log('  wiring: OK');
  },
};
export const ALL = ['aim', 't3', 'valve', 'purity', 'wiring'];
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const only = process.argv[2];
  for (const g of only ? [only] : ALL) { assert(groups[g], `unknown group ${g}`); const t0 = Date.now(); groups[g](); console.log(`OK crowd96/${g} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  console.log('crowd96: all OK');
}
