// R1002 步兵支援兵器（二）：工兵（47）、火焰噴射器（48）。不開瀏覽器的部分，卡面驗收 1–20。
// 用法：node tests/engineer1002.mjs            全部各群
//       node tests/engineer1002.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/engineer1002-negative.mjs）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, SHELL_HE, BK_WIRE,
  UK_TANK, UK_INFANTRY, UK_ATGUN, UK_DESTROYER, UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME, BK_HOUSE, BK_PILLBOX, bldMaxHp, wireBlocks, bldAt } from '../src/sim/world.ts';
import { step, runLog, pickAim } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { PRODUCIBLE } from '../src/sim/eco.ts';
import { findPath } from '../src/sim/path.ts';
import { VEG_HEDGE } from '../src/sim/vegetation.ts';
import { rides92 } from '../src/sim/transport92.ts';
import { DEMO_BLD, DEMO_BLAST, near1002 } from '../src/sim/engineer1002.ts';
import { fireDisciplineEligible } from '../src/sim/fireDiscipline.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { eng1002Items } from '../src/ui/engineer1002.ts';
import { CROWD89 } from '../src/render/section89.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32），上面只放守衛自己擺的東西
function field(rules) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  if (rules) applyRules(w, rules);
  return w;
}
const swEco = (w, sw = 2) => { w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], ...(sw ? { sw } : {}) }; return w; };
// ready＝一開始就能打；不 ready 的永遠不開火（cooldown 很大）
function put(w, side, kind, cx, cz, ready = false) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
function bld(w, kind, x, z, ww = 1, d = 1, floors = 1) {
  const maxHp = bldMaxHp(kind, ww, d, floors), b = { id: w.blds.length + 1, kind, x, z, w: ww, d, floors, hp: maxHp, maxHp };
  w.blds.push(b);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < ww; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = b.id;
  return b;
}
const wire = (w, x, z, ww = 1, d = 1) => { const s = { id: (w.wires?.segments.length ?? 0) + 1, kind: BK_WIRE, x, z, w: ww, d, floors: 1, hp: 60, maxHp: 60, builtBy: ME }; w.wires ??= { version: 1, segments: [] }; w.wires.segments.push(s); return s; };
// 跑到 b 的血少了：回傳（第幾步、少了多少）的清單
function hits(w, b, limit, cmds = []) {
  const out = [];
  for (let i = 0; i < limit && b.hp > 0; i++) { const hp = b.hp; step(w, i === 0 ? cmds : []); if (b.hp < hp) out.push([w.tick, hp - b.hp]); }
  return out;
}
// 跑到 u 走完、挨著 b：回傳那一步之後的 w.tick（-1＝沒挨著）
function arrive(w, u, b, limit = 600, cmds = []) {
  for (let i = 0; i < limit; i++) { step(w, i === 0 ? cmds : []); if (u.pathIdx >= u.path.length && near1002(u, b)) return w.tick; }
  return -1;
}
const cheb = (u, b) => { const ux = cellOf(u.x), uz = cellOf(u.z); return Math.max(Math.max(b.x - ux, 0, ux - (b.x + b.w - 1)), Math.max(b.z - uz, 0, uz - (b.z + b.d - 1))); };
const INF_COL = 3;   // report.ts 的 KINDS＝[坦克、榴彈砲、觀測員、步兵]
const KINDS_0_46 = 'fefb6d771c8d45c5';   // UNIT_KINDS 0–46 的 JSON 摘要（main b5a0e7c）
const PINNED_SW1 = { '0/classic': '3be63bd9', '0/real': '05f65343', '1/classic': '186f7382', '1/real': '1e28801d' };   // main b5a0e7c，sw＝1，3000 步
const ROW = {   // 卡面「做什麼」第 1 節的表（守衛自己抄一份）
  [UK_ENGINEER]: { name: '工兵', hp: 40, speed: 12, range: 5 * SUB, minRange: 0, reload: 30, indirect: false, dmgUnit: 8, dmgBld: 2, splash: 0, sight: 7 * SUB, armor: 100, radius: 0, cost: 30, buildTicks: 220, garrison: false, armored: false, pierce: 10, men: 4, soft: 100, setup: false, demo: 120 },
  [UK_FLAME]: { name: '火焰噴射器', hp: 20, speed: 12, range: 2 * SUB, minRange: 0, reload: 40, indirect: false, dmgUnit: 24, dmgBld: 3, splash: 0, sight: 7 * SUB, armor: 100, radius: 0, cost: 30, buildTicks: 220, garrison: false, armored: false, pierce: 15, men: 2, soft: 100, setup: false, hold: true, flame: true },
};
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
const opened = (extra, zombies = false) => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, ...(zombies ? [{ t: 'zombies' }] : []), eco(extra)]); return w; };
function game(map, seed, extra, rules, ais, ticks) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(extra), ...(rules ? [{ t: 'rules', ...rules }] : []), ...ais]);
  while (w.tick < ticks && w.winner < 0) step(w, []);
  return w;
}
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const groups = {
  // 驗收 1：兵種表只往後加
  kinds() {
    assert.deepEqual([UK_ENGINEER, UK_FLAME, UNIT_KINDS.length], [47, 48, 49], 'kinds: engineer 47 and flamethrower 48 are appended (49 kinds)');
    for (const kind of [UK_ENGINEER, UK_FLAME]) assert.deepEqual(UNIT_KINDS[kind], ROW[kind], `kinds: kind ${kind} matches the card's table`);
    assert.equal(createHash('sha256').update(JSON.stringify(UNIT_KINDS.slice(0, 47))).digest('hex').slice(0, 16), KINDS_0_46, 'kinds: rows 0–46 are exactly what they were on main');
    assert(PRODUCIBLE.includes(UK_ENGINEER) && PRODUCIBLE.includes(UK_FLAME), 'kinds: both are producible');
  },
  // 驗收 2：旗標
  flag() {
    const one = opened({ sw: 1 }), two = opened({ sw: 2 }), three = opened({ sw: 3 });
    assert.deepEqual([one.eco.sw, two.eco.sw, three.eco.sw], [1, 2, undefined], 'flag: the eco command stores sw 1 or 2; 3 counts as not sent');
    assert.notEqual(hashWorld(two), hashWorld(one), 'flag: sw 2 hashes apart from sw 1');
    assert.equal(isCommand({ ...ECO, sw: 2 }), true, 'flag: the command check takes sw 2');
    for (const kind of [UK_ENGINEER, UK_FLAME]) {
      const w = opened({ sw: 1 }), s = w.eco.supply[ME];
      step(w, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([w.eco.queue[ME].length, w.eco.supply[ME] >= s], [0, true], `flag: kind ${kind} cannot be produced with sw 1 (nothing queued, nothing charged)`);
      assert.equal(productionBlockReason(w, kind), '本局未開放此單位', `flag: kind ${kind} says 本局未開放此單位 with sw 1`);
      const z = opened({ sw: 2 }, true);
      step(z, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([z.eco.queue[ME].length, productionBlockReason(z, kind)], [0, '本局未開放此單位'], `flag: zombie defence does not offer kind ${kind}, even with sw 2`);
    }
    const g = opened({ sw: 2 }); g.eco.supply[ME] = 500;
    step(g, [UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME].map(kind => ({ t: 'produce', side: ME, kind })));
    assert.deepEqual(g.eco.queue[ME], [UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME], 'flag: sw 2 takes all four support kinds');
  },
  // 驗收 3：照價錢與時間造、在指揮部旁邊出生
  produce() {
    for (const kind of [UK_ENGINEER, UK_FLAME]) {
      const g = opened({ sw: 2 }), s0 = g.eco.supply[ME], n0 = g.units.length, k = UNIT_KINDS[kind];
      step(g, [{ t: 'produce', side: ME, kind }]);
      assert.equal(s0 - g.eco.supply[ME] - (g.tick % 20 === 0 ? 1 : 0), k.cost, `produce: kind ${kind} costs ${k.cost}`);
      let at = -1;
      for (let i = 0; i < 400 && at < 0; i++) { step(g, []); if (g.units.length > n0) at = g.tick; }
      const u = g.units.at(-1), hq = g.blds[g.eco.hq[ME] - 1];
      assert(at > 0 && u.kind === kind && u.side === ME && Math.abs(cellOf(u.x) - hq.x) <= 3 && Math.abs(cellOf(u.z) - hq.z) <= 3, `produce: kind ${kind} appears next to the HQ (${at})`);
      assert.equal(at - 2, k.buildTicks, `produce: kind ${kind} takes ${k.buildTicks} steps, like every kind`);
    }
  },
  // 驗收 4：工兵炸碉堡：挨著第 120 步扣 60（不打折），7 包變瓦礫、回待命；反戰車砲照舊只刮 15＞＞2
  demo() {
    const w = field(), p = bld(w, BK_PILLBOX, 16, 16), e = put(w, ME, UK_ENGINEER, 12, 16, true);
    assert.equal(p.hp, 400, 'demo: a pillbox has 400');
    const adj = arrive(w, e, p, 300, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
    assert(adj > 0 && p.hp === 400 && e.order === ORD_FIRE_AT, `demo: the engineer walks up to the pillbox without touching it (${adj}, ${p.hp})`);
    const got = [];
    for (let i = 0; i < 1200 && p.hp > 0; i++) { const hp = p.hp; step(w, []); if (p.hp < hp) { got.push([w.tick - adj, hp - p.hp]); const ev = w.events.find(v => v.e === 'impact'); assert.deepEqual(ev, { e: 'impact', kind: SHELL_HE, x: center(16), z: center(16), bld: 0, r: DEMO_BLAST }, 'demo: each charge leaves a small blast event at the target cell'); } }
    assert.deepEqual(got, [[119, 60], [239, 60], [359, 60], [479, 60], [599, 60], [719, 60], [839, 40]], 'demo: a charge every 120 steps from the step it arrived, 60 each (a pillbox is not quartered); 7 charges');
    assert.equal(DEMO_BLD, 60, 'demo: one charge is 60');
    step(w, []);
    assert.equal(e.order, ORD_IDLE, 'demo: rubble ends the order');
    const v = field(), q = bld(v, BK_PILLBOX, 16, 16), g = put(v, ME, UK_ATGUN, 12, 16, true);
    const h = hits(v, q, 200, [{ t: 'fireAt', side: ME, ids: [g.id], x: 16, z: 16 }]);
    assert.equal(h[0]?.[1], 15 >> 2, 'demo: an AT gun still scrapes a quarter of 15 off a pillbox');
  },
  // 驗收 5：不管在步槍射程內外，都走到挨著才停；走不到放棄；停止指令取消
  demowalk() {
    for (const [from, label] of [[13, 'inside'], [5, 'outside']]) {
      const w = field(), p = bld(w, BK_PILLBOX, 16, 16), e = put(w, ME, UK_ENGINEER, from, 16, true);
      const adj = arrive(w, e, p, 400, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
      assert(adj > 0 && cheb(e, p) === 1, `demowalk: from ${label} rifle range (${from}) the engineer walks until it touches (cheb ${cheb(e, p)})`);
    }
    { const w = field(), h = bld(w, BK_HOUSE, 16, 16, 2, 2, 1), e = put(w, ME, UK_ENGINEER, 10, 10, true);
      const adj = arrive(w, e, h, 400, [{ t: 'fireAt', side: ME, ids: [e.id], x: 17, z: 17 }]);
      assert(adj > 0 && cheb(e, h) === 1, 'demowalk: next to any cell of a 2×2 house counts'); }
    { const w = field(), p = bld(w, BK_PILLBOX, 16, 16), e = put(w, ME, UK_ENGINEER, 10, 16, true);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) bld(w, BK_HOUSE, 16 + dx, 16 + dz);
      const h = hits(w, p, 400, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
      assert.deepEqual([h.length, e.order, cheb(e, p) > 1], [0, ORD_IDLE, true], 'demowalk: a pillbox walled in by houses cannot be reached: the engineer gives up'); }
    { const w = field(), p = bld(w, BK_PILLBOX, 16, 16), e = put(w, ME, UK_ENGINEER, 15, 16, true);
      step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
      for (let i = 0; i < 60; i++) step(w, []);
      step(w, [{ t: 'stop', side: ME, ids: [e.id] }]);
      assert.equal(e.order, ORD_IDLE, 'demowalk: stop cancels the charge');
      const h = hits(w, p, 300);
      assert.equal(h.length, 0, 'demowalk: after stop nothing goes off'); }
    { const w = field(), e = put(w, ME, UK_ENGINEER, 10, 16, true);
      step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
      for (let i = 0; i < 30; i++) step(w, []);
      assert.deepEqual([e.order, e.x, e.z, e.path.length, e.cooldown], [ORD_IDLE, center(10), center(16), 0, 0], 'demowalk: open ground is not a target (the order is not taken: no walk, no countdown)'); }
  },
  // 驗收 6：壓制
  demoslow() {
    const run = sup => {
      const w = field({ morale: 1 }), p = bld(w, BK_PILLBOX, 16, 16), e = put(w, ME, UK_ENGINEER, 15, 16, true);
      for (let i = 0; i < 700 && p.hp === 400; i++) { if (sup) e.sup = sup; step(w, i === 0 ? [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }] : []); }
      return p.hp === 400 ? -1 : w.tick;
    };
    const ok = run(0), pinned = run(65), broken = run(95);
    assert.equal(ok, 120, 'demoslow: already beside it, the first charge still takes 120 steps from the order (placing takes time)');
    assert(pinned >= 4 * 119 && pinned <= 4 * 121, `demoslow: pinned, the countdown runs a quarter as fast (${pinned})`);
    assert.equal(broken, -1, 'demoslow: a broken engineer places nothing');
  },
  // 驗收 7：鐵絲網
  wire() {
    { const w = swEco(field()); const s = wire(w, 10, 0, 1, 32);
      for (const kind of [UK_ENGINEER, UK_FLAME]) assert(wireBlocks(w, 10, 5, kind), `wire: an intact wire cell stops kind ${kind} with sw 2`);
      s.hp = 0;
      for (const kind of [UK_ENGINEER, UK_FLAME]) assert(!wireBlocks(w, 10, 5, kind), `wire: a cut wire cell lets kind ${kind} pass`);
      s.hp = 60; w.eco.sw = 1;
      for (const kind of [UK_ENGINEER, UK_FLAME]) assert(!wireBlocks(w, 10, 5, kind), `wire: without sw 2 the foot list is unchanged for kind ${kind}`); }
    { const w = swEco(field()); const a = wire(w, 10, 4, 1, 2); wire(w, 10, 0, 1, 4); wire(w, 10, 6, 1, 26);
      const e = put(w, ME, UK_ENGINEER, 8, 4, true), inf = put(w, ME, UK_INFANTRY, 7, 6);
      const crosses = () => findPath(w, cellOf(inf.x), cellOf(inf.z), 13, 6, 0, 0, UK_INFANTRY).some(c => c % w.n === 10);
      assert.equal(crosses(), false, 'wire: before the cut the section cannot get through');
      const adj = arrive(w, e, a, 300, [{ t: 'fireAt', side: ME, ids: [e.id], x: 10, z: 5 }]);
      assert(adj > 0 && a.hp === 60, `wire: the engineer walks up to the wire (${adj})`);
      let cut = -1, ev = false;
      for (let i = 0; i < 200 && cut < 0; i++) { step(w, []); if (a.hp === 0) { cut = w.tick - adj; ev = w.events.some(v => v.e === 'wire'); } }
      assert.deepEqual([cut, ev, a.hp], [119, true, 0], 'wire: 120 steps after it arrives the whole 1×2 section is cut (a wire event)');
      assert.equal(crosses(), true, 'wire: after the cut the section walks through');
      step(w, []);
      assert.equal(e.order, ORD_IDLE, 'wire: a cut section ends the order'); }
    for (const kind of [UK_TANK, UK_INFANTRY]) {
      const w = swEco(field()); wire(w, 24, 5); const u = put(w, ME, kind, 8, 5, true);   // 網在射程外（16 格）：接了指令的話會走過去
      step(w, [{ t: 'fireAt', side: ME, ids: [u.id], x: 24, z: 5 }]);
      for (let i = 0; i < 30; i++) step(w, []);
      assert.deepEqual([u.order, u.x, u.z, u.path.length], [ORD_IDLE, center(8), center(5), 0], `wire: kind ${kind} does not take a fire order on wire (no walk)`);
    }
  },
  // 驗收 8：火焰噴射器挑得到躲在房子裡的人
  flameaim() {
    const w = field(), h = bld(w, BK_HOUSE, 16, 16), f = put(w, ME, UK_FLAME, 14, 16, true), inf = put(w, ME, UK_INFANTRY, 14, 17, true), foe = put(w, FOE, UK_INFANTRY, 16, 16);
    assert.equal(pickAim(w, f)?.unit?.id, foe.id, 'flameaim: the flamethrower picks the section hiding in the house');
    assert.equal(pickAim(w, inf), null, 'flameaim: a rifle section cannot pick it (unchanged)');
    const n = put(w, FOE, UK_INFANTRY, 16, 18);
    assert.equal(pickAim(w, f)?.unit?.id, foe.id, 'flameaim: out of range (2 cells) is not picked');
    void h; void n;
    const solo = field(), f2 = put(solo, ME, UK_FLAME, 14, 16, true); put(solo, FOE, UK_INFANTRY, 16, 18);   // R1004：射程外的那個是唯一的候選，拿掉射程判斷就會挑它
    assert.equal(pickAim(solo, f2), null, 'flameaim: alone and 2.8 cells away, out of range, it is not picked');
    const v = field(); bld(v, BK_HOUSE, 16, 16); bld(v, BK_HOUSE, 15, 16); const g = put(v, ME, UK_FLAME, 14, 16, true), i2 = put(v, ME, UK_INFANTRY, 14, 17, true); put(v, FOE, UK_INFANTRY, 16, 16);
    assert.deepEqual([pickAim(v, g), pickAim(v, i2)], [null, null], 'flameaim: with another house in front, neither can pick it');
    const fired = (() => { let c = 0; for (let i = 0; i < 60; i++) { step(w, []); c += w.events.filter(e => e.e === 'fire' && e.unit === f.id).length; } return c; })();
    assert(fired > 0 && foe.hp < UNIT_KINDS[UK_INFANTRY].hp && h.hp === h.maxHp, `flameaim: the flame goes in: the man is burnt, the house is untouched (${foe.hp}, ${h.hp})`);
  },
  // 驗收 9：不吃掩護
  flamecover() {
    const burn = (cover, shooter = UK_FLAME) => {
      const w = field(), x = 16, z = 16, i = cellIdx(w, x, z);
      if (cover === 'house') bld(w, BK_HOUSE, x, z); else if (cover === 'pillbox') bld(w, BK_PILLBOX, x, z);
      else if (cover === 'trench') w.trenches = { version: 1, segments: [{ side: FOE, kind: 0, x, z, rot: 0 }] };
      else if (cover === 'wood') w.vegetation.cells[i] = VEG_HEDGE; else if (cover === 'crater') w.crater[i] = 3;
      const t = put(w, FOE, UK_INFANTRY, x, z), s = put(w, ME, shooter, 14, 16, true);
      if (shooter !== UK_FLAME) step(w, [{ t: 'attack', side: ME, ids: [s.id], target: t.id }]);
      for (let n = 0; n < 80 && t.hp === UNIT_KINDS[UK_INFANTRY].hp; n++) step(w, []);
      return UNIT_KINDS[UK_INFANTRY].hp - t.hp;
    };
    const covers = ['open', 'house', 'pillbox', 'trench', 'wood', 'crater'];
    assert.deepEqual(covers.map(c => burn(c)), covers.map(() => 24), 'flamecover: one burst takes 24 wherever the man is (open, house, pillbox, trench, wood, crater)');
    const rifle = ['open', 'trench', 'wood', 'crater'].map(c => burn(c, UK_INFANTRY));
    assert(rifle[0] === 12 && rifle.slice(1).every(d => d < 12), `flamecover: a rifle shot still loses to cover (${rifle})`);
  },
  // 驗收 10：點房子＝燒裡面射程內 id 最小的；房子空的照舊打房子
  flamehouse() {
    const w = field(), h = bld(w, BK_HOUSE, 16, 16, 2, 1), f = put(w, ME, UK_FLAME, 14, 16, true);
    const far = put(w, FOE, UK_INFANTRY, 17, 16), a = put(w, FOE, UK_INFANTRY, 16, 16), b = put(w, FOE, UK_INFANTRY, 16, 16);
    step(w, [{ t: 'fireAt', side: ME, ids: [f.id], x: 17, z: 16 }]);
    for (let i = 0; i < 40 && a.hp === 60; i++) step(w, []);
    assert.deepEqual([a.hp, b.hp, far.hp, h.hp === h.maxHp], [36, 60, 60, true], 'flamehouse: the order burns the lowest id inside and in range (not the one 3 cells off, not the house)');
    const v = field(), e = bld(v, BK_HOUSE, 16, 16), g = put(v, ME, UK_FLAME, 14, 16, true);
    const hh = hits(v, e, 120, [{ t: 'fireAt', side: ME, ids: [g.id], x: 16, z: 16 }]);
    assert.deepEqual(hh.slice(0, 2).map(x => x[1]), [3, 3], 'flamehouse: an empty house is fired at like before (3 a burst)');
  },
  // 驗收 11：裝甲
  flamearmor() {
    const w = field(), f = put(w, ME, UK_FLAME, 14, 16, true), tank = put(w, FOE, UK_TANK, 15, 16);
    assert.equal(pickAim(w, f), null, 'flamearmor: idle, it leaves a closed tank alone');
    const td = put(w, FOE, UK_DESTROYER, 14, 18);
    assert.equal(pickAim(w, f)?.unit?.id, td.id, 'flamearmor: it picks an open-topped tank destroyer');
    td.alive = false;
    step(w, [{ t: 'attack', side: ME, ids: [f.id], target: tank.id }]);
    for (let i = 0; i < 20 && tank.hp === 100; i++) step(w, []);
    assert.equal(100 - tank.hp, 3, 'flamearmor: ordered onto a tank it does 3 a burst');
  },
  // 驗收 12：停火紀律
  discipline() {
    const w = field(), f = put(w, ME, UK_FLAME, 14, 16, true), e = put(w, ME, UK_ENGINEER, 2, 2, true);   // 工兵放遠：不搶著把目標打死
    assert.deepEqual([fireDisciplineEligible(f, w), fireDisciplineEligible(e, w)], [true, false], 'discipline: the flamethrower holds fire on order, the engineer does not');
    put(w, FOE, UK_INFANTRY, 16, 16);
    step(w, [{ t: 'fireDiscipline', side: ME, ids: [f.id], hold: true }]);
    let c = 0; for (let i = 0; i < 100; i++) { step(w, []); c += w.events.filter(v => v.e === 'fire' && v.unit === f.id).length; }
    assert.equal(c, 0, 'discipline: holding, it does not burn');
    for (let i = 0; i < 60; i++) { step(w, i === 0 ? [{ t: 'fireDiscipline', side: ME, ids: [f.id], hold: false }] : []); c += w.events.filter(v => v.e === 'fire' && v.unit === f.id).length; }
    assert(c > 0, 'discipline: released, it burns');
  },
  // 驗收 13：搭車
  ride() {
    assert.deepEqual([rides92(UK_ENGINEER), rides92(UK_FLAME)], [true, true], 'ride: both ride trucks and half-tracks (tests/transport92.mjs walks every kind beside a truck)');
  },
  // 驗收 14：存檔
  codec() {
    const w = createWorld(1944);
    step(w, [{ t: 'map', id: 1, vegetation: 1 }, eco({ sw: 2 }), { t: 'produce', side: ME, kind: UK_ENGINEER }, { t: 'produce', side: ME, kind: UK_FLAME }]);
    while (w.tick < 900) step(w, []);
    const e = w.units.find(u => u.kind === UK_ENGINEER && u.alive), f = w.units.find(u => u.kind === UK_FLAME && u.alive);
    assert(e && f, 'codec: both were built');
    const b = w.blds.filter(b => b.hp > 0 && b.kind === BK_HOUSE).sort((a, c) => (Math.abs(a.x - cellOf(e.x)) + Math.abs(a.z - cellOf(e.z))) - (Math.abs(c.x - cellOf(e.x)) + Math.abs(c.z - cellOf(e.z))) || a.id - c.id)[0];
    step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: b.x, z: b.z }, { t: 'fireDiscipline', side: ME, ids: [f.id], hold: true }]);
    while (w.tick < 1500 && !(e.order === ORD_FIRE_AT && near1002(e, b) && e.cooldown > 0 && e.cooldown < 100)) step(w, []);
    assert(e.order === ORD_FIRE_AT && near1002(e, b) && e.cooldown > 0, `codec: the engineer is mid-countdown beside the house when saved (${w.tick}, ${e.cooldown})`);
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert(back, 'codec: a world with sw 2, an engineer mid-charge and a holding flamethrower reads back');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
    assert.equal(hashWorld(back), hashWorld(w), 'codec: 600 steps after loading, the hash equals the uninterrupted run');
  },
  // 驗收 14（拒收的那一半，小世界、跑得快）：sw＝1 或沒有 sw 卻有 47、48；sw＝3；佇列裡的
  codecref() {
    const w = opened({ sw: 2 }), hq = w.blds[w.eco.hq[ME] - 1];
    put(w, ME, UK_ENGINEER, hq.x - 1, hq.z - 1); put(w, ME, UK_FLAME, hq.x - 1, hq.z);
    const raw = JSON.parse(JSON.stringify(encodeWorld(w)));
    assert(decodeWorld(raw), 'codec: sw 2 with an engineer and a flamethrower reads');
    assert.equal(decodeWorld({ ...raw, eco: { ...raw.eco, sw: 1 } }), null, 'codec: sw 1 with kind 47/48 units is refused');
    assert.equal(decodeWorld({ ...raw, eco: { ...raw.eco, sw: 3 } }), null, 'codec: sw 3 is refused');
    const { sw, ...noSw } = raw.eco; void sw;
    assert.equal(decodeWorld({ ...raw, eco: noSw }), null, 'codec: no sw with kind 47/48 units is refused');
    const q = JSON.parse(JSON.stringify(encodeWorld(opened({ sw: 1 }))));
    q.eco.queue[ME] = [UK_FLAME];
    assert.equal(decodeWorld(q), null, 'codec: sw 1 with a flamethrower in the queue is refused');
    q.eco.queue[ME] = [UK_SNIPER];
    assert(decodeWorld(q), 'codec: sw 1 with a sniper in the queue still reads');
  },
  // 驗收 15：重播（生產、爆破、剪網、噴火）
  replay() {
    const log = [], w = createWorld(1944);
    const go = cmds => { for (const cmd of cmds) log.push({ tick: w.tick, cmd }); step(w, cmds); };
    go([{ t: 'map', id: 1, vegetation: 1 }, { t: 'build', side: ME, kind: BK_WIRE, x: 22, z: 26 }, eco({ sw: 2 }), { t: 'produce', side: ME, kind: UK_ENGINEER }, { t: 'produce', side: ME, kind: UK_FLAME }]);
    while (w.tick < 700) go([]);
    go([{ t: 'produce', side: ME, kind: UK_ENGINEER }]);   // 開局 60 補給只夠前兩組
    while (w.tick < 1000) go([]);
    assert.equal(w.wires?.segments.length, 1, 'replay: a wire section was laid at step 0');
    const es = w.units.filter(u => u.kind === UK_ENGINEER && u.side === ME), f = w.units.find(u => u.kind === UK_FLAME && u.side === ME);
    const hb = w.blds.filter(b => b.hp > 0 && b.kind === BK_HOUSE).sort((a, c) => (Math.abs(a.x - cellOf(es[0].x)) + Math.abs(a.z - cellOf(es[0].z))) - (Math.abs(c.x - cellOf(es[0].x)) + Math.abs(c.z - cellOf(es[0].z))) || a.id - c.id)[0];
    assert(es.length === 2 && f && hb, 'replay: two engineers and a flamethrower were built');
    // R1004：噴火也要真的在紀錄裡——敵方一個步兵班（不還手）進離它最近的房子，火焰噴射器對那一棟下射擊指令（燒裡面的人）；燒在第 1,200 步之後，存檔接著跑的那一段也有
    const sec = w.units.find(u => u.alive && u.side === FOE && u.kind === UK_INFANTRY), dd = b => Math.abs(b.x - cellOf(sec.x)) + Math.abs(b.z - cellOf(sec.z));
    const hf = w.blds.filter(b => b.hp > 0 && b.kind === BK_HOUSE && b !== hb).sort((a, c) => dd(a) - dd(c) || a.id - c.id)[0];
    go([{ t: 'fireAt', side: ME, ids: [es[0].id], x: hb.x, z: hb.z }, { t: 'fireAt', side: ME, ids: [f.id], x: hf.x, z: hf.z }, { t: 'fireAt', side: ME, ids: [es[1].id], x: w.wires.segments[0].x, z: w.wires.segments[0].z },
      { t: 'move', side: FOE, ids: [sec.id], x: hf.x, z: hf.z }, { t: 'fireDiscipline', side: FOE, ids: [sec.id], hold: true }]);
    let burns = 0, firstBurn = -1;
    while (w.tick < 2400) { go([]); for (const e of w.events) if (e.e === 'fire' && e.unit === f.id && bldAt(w, cellOf(sec.x), cellOf(sec.z))?.id === hf.id) { burns++; if (firstBurn < 0) firstBurn = w.tick; } }
    assert(hb.hp < hb.maxHp && w.wires.segments[0].hp === 0, `replay: the house took charges and the wire was cut (${hb.hp}/${hb.maxHp}, ${w.wires.segments[0].hp})`);
    assert(burns > 0 && firstBurn > 1200 && sec.hp < UNIT_KINDS[UK_INFANTRY].hp, `replay: the flamethrower burns the section in the house after step 1,200 (${burns} bursts from ${firstBurn}, section hp ${sec.hp})`);
    const again = runLog(createWorld(1944), log, 2400);
    assert.equal(hashWorld(again), hashWorld(w), 'replay: the same log replays to the same hash');
    const half = runLog(createWorld(1944), log, 1200), back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(half))));
    const rest = runLog(back, log.filter(l => l.tick >= 1200), 2400);
    assert.equal(hashWorld(rest), hashWorld(w), 'replay: saved at 1,200 and replayed on, the hash is the same');
  },
  // 驗收 16：沒有 sw＝2 的局逐位不變
  hash() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'hash: the golden script battle is unchanged');
    const now = {};
    for (const map of [0, 1]) for (const real of [false, true]) now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(game(map, 31 + map, { sw: 1 }, real ? { ap: 1, morale: 2 } : null, [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }], 3000));
    assert.deepEqual(now, PINNED_SW1, 'hash: four third-version battles with sw 1 are bit for bit what they were on main');
  },
  // 驗收 17：介面路由
  route() {
    const w = swEco(field()); wire(w, 10, 5); bld(w, BK_HOUSE, 20, 20);
    const e = put(w, ME, UK_ENGINEER, 8, 5), inf = put(w, ME, UK_INFANTRY, 8, 6), f = put(w, ME, UK_FLAME, 8, 7);
    const at = (x, z, building = null) => routeBattleOrder(w, [e.id, inf.id, f.id], false, 'he', { unit: 0, building, ground: { x: x + 0.5, z: z + 0.5 } })?.commands;
    assert.deepEqual(at(10, 5), [{ t: 'fireAt', side: ME, ids: [e.id], x: 10, z: 5 }, { t: 'move', side: ME, ids: [inf.id, f.id], x: 10, z: 5 }], 'route: a tap on wire sends the engineers to cut it and moves the rest');
    assert.deepEqual(at(20, 20, [20, 20]), [{ t: 'move', side: ME, ids: [inf.id], x: 20, z: 20 }, { t: 'fireAt', side: ME, ids: [e.id, f.id], x: 20, z: 20 }], 'route: a tap on a house: the section goes in, the engineer and the flamethrower fire at it');
    assert.deepEqual(at(12, 12), [{ t: 'move', side: ME, ids: [e.id, inf.id, f.id], x: 12, z: 12 }], 'route: open ground is a move for everyone');
    w.wires.segments[0].hp = 0;
    assert.deepEqual(at(10, 5), [{ t: 'move', side: ME, ids: [e.id, inf.id, f.id], x: 10, z: 5 }], 'route: cut wire is plain ground');
  },
  // 驗收 18：介面
  ui() {
    assert.deepEqual(eng1002Items().map(i => [i.kind, i.label, i.cost, i.group]), [[UK_ENGINEER, '工兵', 30, '步兵支援'], [UK_FLAME, '火焰噴射', 30, '步兵支援']], 'ui: two items in the 步兵支援 group');
    const main = src('src/main.ts');
    assert(main.includes('...(V.r1002 ? eng1002Items() : [])'), 'ui: the items are there only when the R1002 valve is on');
    assert(main.includes('const sw1002 = (c: Command): Command => (V.r1002 && V.r091 ? { ...c, sw: 2 } as Command : c);') && main.includes("const ecoCmd = (): Command => sw1002({ t: 'eco',"), 'ui: a new battle sends sw 2 only when the R1002 valve is on');
    const g = opened({ sw: 2 }); g.eco.supply[ME] = 0;
    assert.equal(productionBlockReason(g, UK_ENGINEER), '補給不足，還差 30', 'ui: with sw 2 the only reason is supply');
    const w = swEco(field());
    put(w, ME, UK_ENGINEER, 4, 4); put(w, ME, UK_FLAME, 5, 4); const foe = put(w, FOE, UK_ENGINEER, 20, 20);
    const st = newStats(w); foe.alive = false; foe.hp = 0; statsStep(st, w, [{ e: 'kill', unit: foe.id }]);
    const r = makeReport(w, st);
    assert.deepEqual([r.start[0][INF_COL], r.start[1][INF_COL], r.left[0][INF_COL], r.left[1][INF_COL], r.kills], [2, 1, 2, 0, 1], 'ui: both kinds count in the infantry column of the report');
    assert(CROWD89[UK_ENGINEER]?.men === 4 && CROWD89[UK_FLAME]?.men === 2 && CROWD89[UK_ENGINEER].lay.length === 5 && CROWD89[UK_ENGINEER].lay.every(l => l.length === 4), 'ui: with R089 on the engineer is a four-man crowd and the flamethrower a two-man crowd');
    const battle = src('src/render/battle.ts');
    assert(battle.includes('if (!this.sec89.has(u.kind) && (u.kind === UK_ENGINEER || u.kind === UK_FLAME)) nm = this.squad21(u, x, z, simT, col, nm);'), 'ui: with R089 off both are drawn like a section');
    assert(src('tools/cdp.mjs').includes("const full1002 = /(^|&)noR1002=/.test(full93) ? full93 : `${full93 ? full93 + '&' : ''}noR1002=1`;"), 'ui: tools/cdp.mjs opens pages with noR1002=1 unless a guard asks for R1002');
  },
  // 驗收 19：純度
  purity() {
    const s = src('src/sim/engineer1002.ts'), code = s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|rng\.ts|randInt|nextU32/.test(code), 'purity: no floats, no **, no randomness in engineer1002.ts');
    for (const m of s.matchAll(/from '([^']+)'/g)) assert(/^\.\/[a-zA-Z0-9]+\.ts$/.test(m[1]), `purity: engineer1002.ts imports only ./x.ts (${m[1]})`);
  },
  // 驗收 20：紅線
  redline() {
    const text = [src('src/sim/engineer1002.ts'), src('src/ui/engineer1002.ts')].join('\n') + main1002();
    const bad = ['Flammenwerfer', 'Bangalore', 'Wehrmacht', 'Pionier', '德軍', '英軍', '納粹', '皇家'].filter(word => text.includes(word));
    assert.deepEqual(bad, [], `redline: no type names, armies or nationalities in the R1002 files (${bad})`);
  },
};
function main1002() { return src('src/main.ts').split('\n').filter(l => l.includes('1002')).join('\n') + src('src/ui/hud.ts').split('\n').filter(l => l.includes('工兵')).join('\n'); }

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK engineer1002/${name}`);
}
console.log('engineer1002: all OK');
