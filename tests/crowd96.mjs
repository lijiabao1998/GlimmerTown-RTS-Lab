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

const DEFAULT_96 = (() => { const v = new BattleView(W.createWorld(7), {}); setSection89(true); v.snapshot(); v.update(1, 1, new Set()); const r = v.sec89.dbg.ratio; v.dispose(); return r; })();
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
function crowd(count, zombies = 0) {
  const w = W.createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = [];
  for (let i = 0; i < count + zombies; i++) w.units.push({ id: i + 1, side: i < count ? i % 2 : 0, kind: i < count ? UK_INFANTRY : UK_ZOMBIE, x: W.center(i % 32), z: W.center(Math.floor(i / 32)), hp: 60, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 });
  const v = new BattleView(w, OPTS); v.target.set(16, 0, 16); v.zoom = 0.05; v.layout(1000, 1000);
  let t = 1; const f = () => { v.snapshot(); v.update(1, t, new Set()); t += 0.05; return v.sec89.dbg; };
  return { w, v, f };
}
// 每一班畫了幾個人（照位置分給最近的班）
const perSection = (w, v, count) => { const a = v.men.instanceMatrix.array, got = new Array(count).fill(0); for (let i = 0; i < v.men.count; i++) { const x = a[i * 16 + 12], z = a[i * 16 + 14], c = Math.floor(z) * 32 + Math.floor(x); if (c < count && Math.abs(a[i * 16 + 1]) < 0.5) got[c]++; } return got; };
const fnv = (h, x) => Math.imul(h ^ x, 0x01000193) >>> 0;
const digest = v => { const m = v.men, a = new Uint32Array(m.instanceMatrix.array.buffer, 0, m.count * 16); let h = fnv(0x811c9dc5, m.count); for (const x of a) h = fnv(h, x); return h; };

export const groups = {
  // 找目標：五局（萊伊、64、96、丘陵、喪屍）每一步、壓力局每一步，新舊挑到同一個；八場對打與三個壓力局的雜湊＝動手之前
  aim() {
    let n = 0, picked = 0;
    for (const [name, cmds] of Object.entries(SCEN)) {
      const w = W.createWorld(1944);
      while (w.tick < 2400 && w.winner < 0) { step(w, w.tick === 0 ? cmds : []); if (w.tick < 600 || w.tick % 4 === 0) { const [a, b] = sameAim(w, `${name} tick ${w.tick}`); n += a; picked += b; } }
    }
    for (const pop of [40, 64]) { const w = stressWorld(pop); for (let i = 0; i < 300; i++) { step(w, []); if (i % 2 === 0) { const [a, b] = sameAim(w, `stress ${pop} step ${i}`); n += a; picked += b; } } }
    assert(picked > 5000, `aim: the comparison saw plenty of real targets (${picked} of ${n})`);
    for (const row of DUELS) {
      const [key, hash, ticks] = row.split(' '), [map, seed, rules] = key.split('/');
      const r = duel({ map: +map, seed: +seed, ticks: 12000, rules: rules === 'real' ? { ap: 1, morale: 2 } : null, a: { level: 3, v: 3 }, b: { level: 3, v: 3 }, end: true, mg: 2 });
      assert.equal(`${r.hash} ${r.ticks}`, `${hash} ${ticks}`, `aim: duel ${key} ends exactly as before R096`);
    }
    for (const [pop, hash] of Object.entries(STRESS)) { const w = stressWorld(+pop); for (let i = 0; i < 600; i++) step(w, []); assert.equal(W.hashWorld(w), hash, `aim: the ${pop}-a-side stress battle ends exactly as before R096`); }
    console.log(`  aim: ${n} unit-ticks compared (${picked} with a target), 8 duels and 3 stress battles unchanged`);
  },
  // T3：想畫 1,280 個 → 第一幀寫到 800 停、之後每班 6 個（768）、連續 60 幀一樣；800 個以內逐位不變；喪屍與砲手照畫；最少 3 個；最多 800 個
  t3() {
    setSection89(true); setCrowd96(true);
    const A = crowd(128), d0 = A.f(), d1 = A.f(), counts = new Set();
    for (let i = 0; i < 60; i++) counts.add(A.f().live);
    const per = perSection(A.w, A.v, 128);
    assert(d0.live <= S89.LIVE96 && d1.live === 768 && d1.want === 1280 && d1.tris <= S89.MEN_TRIS89 && counts.size === 1 && counts.has(768) && per.every(c => c === 6), `t3: 1,280 wanted figures draw 6 per section (${d0.live} on the first frame, then ${d1.live}; ${[...counts]}; per section ${[...new Set(per)]})`);
    A.v.dispose();
    const dig = on => { setCrowd96(on); const B = crowd(80); B.f(); B.f(); const r = [digest(B.v), B.v.sec89.dbg.live]; B.v.dispose(); return r; };
    const on800 = dig(true), off800 = dig(false);
    assert(on800[1] === 800 && on800[0] === off800[0], `t3: 800 wanted figures draw exactly as R089 (${on800} vs ${off800})`);
    setCrowd96(true);
    const C = crowd(60, 60); C.f(); const c1 = C.f();
    assert(c1.live === 420 && c1.F === 780, `t3: zombies and crews keep every figure; only sections draw fewer (${c1.live} section figures, ${c1.F} in all)`);
    C.v.dispose();
    const D = crowd(270); D.f(); const dd = D.f(), perD = perSection(D.w, D.v, 270).filter(c => c > 0);
    assert(dd.live <= S89.LIVE96 && perD.filter(c => c < S89.MIN96).length <= 1, `t3: never more than 800 live figures, and a drawn section shows at least 3 (only the one cut by the 800 limit may show fewer: ${dd.live}; ${[...new Set(perD)]})`);
    D.v.dispose();
    console.log(`  t3: 1,280 wanted → ${d1.live} (6 a section, steady 60 frames); 800 → bit-identical; zombies kept; 2,700 wanted → ${dd.live}`);
  },
  // 閥：?noR096=1（開關關著）→ 想畫 1,280 個的時候照 R089 全部畫
  valve() {
    setSection89(true); setCrowd96(false);
    const A = crowd(128); A.f(); const d = A.f();
    assert(d.live === 1280 && d.ratio === 1, `valve: with ?noR096=1 every figure is drawn as in R089 (${d.live})`);
    A.v.dispose();
    console.log('  valve: off → 1,280 figures');
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
    assert.equal(DEFAULT_96, 1, 'wiring: T3 starts off');
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
