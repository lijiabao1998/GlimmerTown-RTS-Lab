// R1011 指揮部升級（沙包加固 1201、電話交換台 1202）：不開瀏覽器的部分，卡面驗收 1–17。
// 用法：node tests/hq1011.mjs            全部各群
//       node tests/hq1011.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/hq1011-negative.mjs）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, center, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, TICK_HZ,
  BK_HOUSE, BK_HQ, BK_BARRACKS, BK_SUPPLY, UK_TANK, UK_HEAVY, UK_INFANTRY, UK_SNIPER, UK_ENGINEER, bldMaxHp, bldMaterial, stageOf } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { isCommand, checkLog } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { produce } from '../src/sim/eco.ts';
import { PLATOON_ITEM, PLATOON_TICKS } from '../src/sim/platoon.ts';
import { TECH50, RANGE50, why50 } from '../src/sim/tech50.ts';
import { HQ_SAND, HQ_PHONE, HQ11, SAND_HP, why1011 } from '../src/sim/hq1011.ts';
import { Lockstep, NET_DELAY } from '../src/net/lockstep.ts';
import { hq1011Items, block1011, tag1011 } from '../src/ui/hq1011.ts';
import { tech50Items } from '../src/ui/tech50.ts';
import { hqDurability } from '../src/ui/hqDurability.ts';
import { countdown95 } from '../src/ui/platoon95.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32）＋雙方指揮部：我方 (24,24)、敵方 (4,4)；eco 帶 sw＝2、tech＝1、hq11＝1，補給 500（照 tests/tech50.mjs 的 camp）
function field() {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  return w;
}
function bld(w, kind, x, z, ww = 1, d = 1, floors = 1, side) {
  const maxHp = bldMaxHp(kind, ww, d, floors), b = { id: w.blds.length + 1, kind, x, z, w: ww, d, floors, hp: maxHp, maxHp, ...(side !== undefined ? { builtBy: side } : {}) };
  w.blds.push(b);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < ww; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = b.id;
  return b;
}
function camp(extra = {}) {
  const w = field(), h0 = bld(w, BK_HQ, 24, 24, 2, 2, 1, ME), h1 = bld(w, BK_HQ, 4, 4, 2, 2, 1, FOE);
  w.eco = { supply: [500, 500], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, hq11: 1, ...extra };
  return w;
}
function put(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
// 指揮部直接擺到第幾級（夾具；真的升級在 sand、replay、codec 群）：第 1、2 級上限 1,800
const lvl = (w, lv, hp) => { const hq = w.blds[0]; if (lv) { hq.hqLv = lv; hq.maxHp = 1200 + SAND_HP; } hq.hp = hp ?? hq.maxHp; return hq; };
const P = (side, kind) => ({ t: 'produce', side, kind });
const T = k => (k === PLATOON_ITEM ? PLATOON_TICKS : UNIT_KINDS[k].buildTicks);   // 守衛自己算，不呼叫 ticksOf、phone1011
const fast = k => T(k) - Math.floor(T(k) / 4);
// 下單到出生幾步：第 t 步下單，第 t＋n 步那一步出生（出生那一步走完 units 才多一個）
function spawnAfter(w, kind) {
  const n0 = w.units.length, t = w.tick;
  step(w, [P(ME, kind)]);
  while (w.units.length === n0 && w.tick < t + 3000) step(w, []);
  return w.tick - 1 - t;
}
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
const opened = extra => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, eco(extra)]); return w; };
const hashNoHq11 = w => { const f = w.eco?.hq11; if (w.eco) delete w.eco.hq11; const h = hashWorld(w); if (f !== undefined) w.eco.hq11 = f; return h; };
const raw = w => JSON.parse(JSON.stringify(encodeWorld(w)));
const BLD_0_16 = '4125250f9ee80a6b';   // 建築 0–16 的血與材質摘要（施工時的 main c31548b）
const PINNED_SW2 = { '0/classic': '52184192', '0/real': '483b7f70', '1/classic': 'd169b4cd', '1/real': '703b2496' };   // tests/tech50.mjs 的 PINNED_SW2（sw＝2、不帶 tech）
const PINNED_TECH = { '0/classic': '007c9d22', '0/real': '986fbc98', '1/classic': '3868f1f5', '1/real': '1f1eeade' };   // 施工時的 main c31548b（含 R1004），sw＝2、tech＝1、不帶 hq11，3000 步
const ISSUE_SHA = 'da6781486453ab06', PLAYLOG_SHA = '73aa16083d0fd602';   // main.ts 的 issue() 與 __rts.playLog（c31548b）
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const groups = {
  // 驗收 1：數字
  numbers() {
    assert.deepEqual([HQ_SAND, HQ_PHONE, HQ11, SAND_HP], [1201, 1202, { 1201: { lv: 1, cost: 30, ticks: 300 }, 1202: { lv: 2, cost: 40, ticks: 400 } }, 600], 'numbers: 1201 is level 1 for 30 supply in 300 steps, 1202 level 2 for 40 in 400, sandbags add 600');
    assert.equal(bldMaxHp(BK_HQ, 2, 2, 1), 1200, 'numbers: the HQ itself still has 1,200');
    const rows = []; for (let k = 0; k <= 16; k++) for (const [a, b, f] of [[1, 1, 1], [2, 1, 2], [2, 2, 1], [2, 2, 3]]) rows.push([k, bldMaxHp(k, a, b, f), bldMaterial(k)]);
    assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16), BLD_0_16, 'numbers: buildings 0–16 keep their hit points and materials');
    for (const k of [HQ_SAND, HQ_PHONE]) assert(k >= UNIT_KINDS.length && k !== PLATOON_ITEM && TECH50[k - 1000] === undefined, `numbers: ${k} is no unit kind, not the platoon, not an R050 build key`);
  },
  // 驗收 2：旗標
  flag() {
    const on = opened({ sw: 2, tech: 1, hq11: 1 }), notech = opened({ sw: 2, hq11: 1 }), sw1 = opened({ sw: 1, tech: 1, hq11: 1 }), two = opened({ sw: 2, tech: 1, hq11: 2 }), off = opened({ sw: 2, tech: 1 });
    assert.deepEqual([on.eco.hq11, notech.eco.hq11, sw1.eco.hq11, two.eco.hq11, off.eco.hq11], [1, undefined, undefined, undefined, undefined], 'flag: hq11 is stored only with sw 2 and tech 1, and only as 1');
    for (const [what, w] of [['no tech', notech], ['tech without sw 2', sw1], ['hq11 2', two]]) {
      const hq = w.blds[w.eco.hq[ME] - 1], s = w.eco.supply[ME];
      step(w, [P(ME, HQ_SAND)]);
      assert.deepEqual([hq.hqUp, hq.hqLv, w.eco.supply[ME] - s <= 1], [undefined, undefined, true], `flag: ${what} — produce 1201 is refused`);
    }
    { const z = camp(); z.zombies = { wave: 1, killed: 0 }; const s = z.eco.supply[ME]; produce(z, ME, HQ_SAND);
      assert.deepEqual([why1011(z, ME, HQ_SAND), z.blds[0].hqUp, z.eco.supply[ME]], ['本局未開放', undefined, s], 'flag: zombie defence does not offer the upgrade'); }
    assert.notEqual(hashWorld(on), hashWorld(off), 'flag: hq11 is folded into the hash');
    assert.equal(isCommand({ ...ECO, sw: 2, tech: 1, hq11: 1 }), true, 'flag: the command check takes hq11');
    for (const v of ['x', 1.5]) assert.equal(isCommand({ t: 'eco', hq11: v }), false, `flag: the command check refuses hq11 ${JSON.stringify(v)}`);
  },
  // 驗收 3：每一條不接的理由；接了扣補給、開始倒數
  order() {
    const no = [
      ['no hq11', '本局未開放', w => { delete w.eco.hq11; }, ME, HQ_SAND],
      ['zombie defence', '本局未開放', w => { w.zombies = { wave: 1, killed: 0 }; }, ME, HQ_SAND],
      ['battle decided', '本局未開放', w => { w.winner = 1; }, ME, HQ_SAND],
      ['side 2', '本局未開放', () => {}, 2, HQ_SAND],
      ['side -1', '本局未開放', () => {}, -1, HQ_SAND],
      ['HQ down', '指揮部已毀', w => { w.blds[0].hp = 0; }, ME, HQ_SAND],
      ['kind 1200', '不能這樣升級', () => {}, ME, 1200],
      ['kind 1203', '不能這樣升級', () => {}, ME, 1203],
      ['already upgrading', '正在升級', w => { w.blds[0].hqUp = 100; }, ME, HQ_PHONE],
      ['1202 at level 0', '要先加固指揮部', () => {}, ME, HQ_PHONE],
      ['1201 at level 1', '已經加固', w => lvl(w, 1), ME, HQ_SAND],
      ['1202 at level 2', '已經有交換台', w => lvl(w, 2), ME, HQ_PHONE],
      ['supply 29', '補給不足，還差 1', w => { w.eco.supply[ME] = 29; }, ME, HQ_SAND],
    ];
    for (const [what, why, set, side, kind] of no) {
      const w = camp(); set(w);
      assert.equal(why1011(w, side, kind), why, `order: ${what} — ${why}`);
      const before = structuredClone(w), h = hashWorld(w);
      produce(w, side, kind);
      assert.deepEqual([hashWorld(w), w.eco.supply, w.blds[0]], [h, before.eco.supply, before.blds[0]], `order: ${what} refused — supply, HQ and hash untouched`);
    }
    { const w = camp(), before = structuredClone(w);
      assert.equal(why1011(w, ME, HQ_SAND), '', 'order: open ground, standing HQ, enough supply — 1201 is taken');
      produce(w, ME, HQ_SAND);
      assert.deepEqual([w.eco.supply, w.blds[0], w.blds[1], w.eco.queue, w.eco.prog], [[470, 500], { ...before.blds[0], hqUp: 300 }, before.blds[1], before.eco.queue, before.eco.prog], 'order: taken — 30 supply, hqUp 300, nothing else'); }
    { const w = camp(); lvl(w, 1); produce(w, ME, HQ_PHONE);
      assert.deepEqual([w.eco.supply[ME], w.blds[0].hqUp, w.blds[0].hqLv], [460, 400, 1], 'order: at level 1 the 1202 is taken — 40 supply, hqUp 400'); }
    { const a = camp(), b = camp(), c = camp(); b.blds[0].hqUp = 300; c.blds[0].hqLv = 1;
      assert(hashWorld(a) !== hashWorld(b) && hashWorld(a) !== hashWorld(c) && hashWorld(b) !== hashWorld(c), 'order: hqLv and hqUp are folded into the hash'); }
  },
  // 驗收 4：做的那幾步這一方生產暫停（佇列、進度留著，補給照收）
  pause() {
    const AT = 50, run = up => {
      const w = camp(); w.eco.supply = [100, 100]; bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME);
      let born = -1;
      const go = cmds => { step(w, cmds); if (born < 0 && w.units.some(u => u.kind === UK_INFANTRY)) born = w.tick - 1; };
      go([P(ME, UK_INFANTRY)]);
      while (w.tick < AT) go([]);
      const s0 = w.eco.supply[ME], p0 = w.eco.prog[ME], progs = [];
      go(up ? [P(ME, HQ_SAND)] : []);
      for (let i = 0; i < 300; i++) { progs.push(w.eco.prog[ME]); if (i < 299) go([]); }
      const ds = w.eco.supply[ME] - s0;
      go([]);
      const p1 = w.eco.prog[ME];
      while (born < 0 && w.tick < 2000) go([]);
      return { p0, progs, ds, p1, born };
    };
    const a = run(true), b = run(false), window = Array.from({ length: 300 }, (_, i) => AT + i), hq = window.filter(t => t % 20 === 0).length, depot = window.filter(t => t % 40 === 0).length;
    assert(a.progs.every(p => p === a.p0) && a.p1 === a.p0 + 1, `pause: ordered at ${AT}, the queue's progress stays at ${a.p0} for exactly 300 steps, then moves on (${a.progs[0]}…${a.progs[299]} → ${a.p1})`);
    assert.deepEqual([a.ds, b.ds, hq, depot], [hq + depot - 30, hq + depot, 15, 7], 'pause: supply keeps coming in those 300 steps (HQ +15, the depot +7), minus the 30 paid');
    assert.equal(a.born - b.born, 300, `pause: the infantry comes out exactly 300 steps later than in the same game without the upgrade (${b.born} → ${a.born})`);
    // 做好的兵（進度滿了、下一步要出來）在暫停中也不出來
    const w = camp(); step(w, [P(ME, UK_INFANTRY)]);
    while (w.tick < T(UK_INFANTRY)) step(w, []);
    assert.equal(w.eco.prog[ME], T(UK_INFANTRY), 'pause: fixture — the infantry is finished and due');
    step(w, [P(ME, HQ_SAND)]);
    for (let i = 0; i < 299; i++) step(w, []);
    const none = w.units.length; step(w, []);
    assert.deepEqual([none, w.units.length], [0, 1], 'pause: a finished unit waits out the pause and comes out the step after');
  },
  // 驗收 5：沙包加固
  sand() {
    for (const t0 of [0, 37]) {
      const w = camp(); while (w.tick < t0) step(w, []);
      step(w, [P(ME, HQ_SAND)]);
      const hq = w.blds[0];
      while (w.tick < t0 + 299) step(w, []);
      assert.deepEqual([hq.hqLv, hq.hqUp, hq.maxHp], [undefined, 1, 1200], `sand: ordered at ${t0}, one step short at ${t0 + 298}`);
      step(w, []);
      assert.deepEqual([hq.hqLv, hq.hqUp, hq.maxHp, hq.hp], [1, undefined, 1800, 1800], `sand: ordered at ${t0}, done at step ${t0 + 299} (level 1, 1,800 of 1,800)`);
    }
    for (const [hp, after, stage] of [[1200, 1800, null], [900, 1500, null], [800, 1400, 0]]) {
      const w = camp(), hq = lvl(w, 0, hp);
      step(w, [P(ME, HQ_SAND)]);
      for (let i = 0; i < 298; i++) step(w, []);
      step(w, []);
      const st = w.events.filter(e => e.e === 'stage' && e.bld === hq.id).map(e => e.stage), up = w.events.filter(e => e.e === 'hq11' && e.bld === hq.id).length;
      assert.deepEqual([hq.hp, hq.maxHp, st, up], [after, 1800, stage === null ? [] : [stage], 1], `sand: ${hp}/1200 becomes ${after}/1800, ${stage === null ? 'no stage event' : 'a stage event back to intact'}, one hq11 event`);
    }
    const charges = up => {
      const w = camp(), hq = w.blds[0];
      if (up) { step(w, [P(ME, HQ_SAND)]); for (let i = 0; i < 299; i++) step(w, []); assert.equal(hq.maxHp, 1800, 'sand: fixture — upgraded'); }
      const e = put(w, FOE, UK_ENGINEER, 23, 24);
      step(w, [{ t: 'fireAt', side: FOE, ids: [e.id], x: 24, z: 24 }]);
      let n = 0, last = hq.hp;
      while (hq.hp > 0 && w.tick < 6000) { step(w, []); if (hq.hp < last) { assert.equal(last - hq.hp, 60, 'sand: an engineer charge is still 60'); n++; } last = hq.hp; }
      return n;
    };
    assert.deepEqual([charges(false), charges(true)], [20, 30], 'sand: one engineer brings the HQ down with 20 charges at level 0 and 30 at level 1');
    { const w = camp(), hq = lvl(w, 1), t = put(w, FOE, UK_TANK, 24, 18), drops = [];
      step(w, [{ t: 'fireAt', side: FOE, ids: [t.id], x: 24, z: 24 }]);
      let last = hq.hp; while (drops.length < 3 && w.tick < 600) { step(w, []); if (hq.hp < last) drops.push(last - hq.hp); last = hq.hp; }
      assert.deepEqual(drops, [25, 25, 25], 'sand: a tank still takes 25 a round off the reinforced HQ'); }
  },
  // 驗收 6：交換台
  phone() {
    for (const kind of [UK_INFANTRY, UK_TANK, UK_HEAVY, PLATOON_ITEM]) {
      const at = (lv, hp) => { const w = camp({ pla: 1 }); lvl(w, lv, hp); return spawnAfter(w, kind); };
      assert.deepEqual([at(0), at(1), at(2), at(2, 1500), at(2, 1261), at(2, 1260)], [T(kind), T(kind), fast(kind), fast(kind), fast(kind), T(kind)],
        `phone: kind ${kind} — levels 0 and 1 take ${T(kind)} steps; level 2 with a roof (1,800, 1,500, 1,261 of 1,800) ${fast(kind)}; at 1,260 (no roof) ${T(kind)}`);
    }
    assert.deepEqual([UK_INFANTRY, UK_TANK, UK_HEAVY, PLATOON_ITEM].map(fast), [90, 225, 360, 225], 'phone: infantry 90, tank 225, heavy tank 360, platoon 225');
    const two = (lv, cut) => {
      const w = camp(), hq = lvl(w, lv), t = w.tick, born = [];
      step(w, [P(ME, UK_INFANTRY), P(ME, UK_INFANTRY)]);
      while (born.length < 2 && w.tick < 1000) { const n = w.units.length; step(w, []); if (w.tick - 1 === t + 10 && cut) hq.hp = 1000; if (w.units.length > n) born.push(w.tick - 1 - t); }
      return born;
    };
    const base = two(0, false), cut = two(2, true);
    assert.deepEqual([cut[0], cut[1] - cut[0]], [fast(UK_INFANTRY), base[1] - base[0]], `phone: cut halfway (1,000 of 1,800) — this one still comes out fast, the next one at the normal pace (${cut} vs ${base})`);
  },
  // 驗收 7：跟 R050 的關係
  tech() {
    { const w = camp(); lvl(w, 2); step(w, [P(ME, UK_SNIPER)]);
      assert.equal(w.eco.queue[ME].length, 0, 'tech: at level 2 without a barracks the sniper is still locked'); }
    { const w = camp(); lvl(w, 2); bld(w, BK_BARRACKS, 14, 24, 2, 2, 1, ME);
      assert.equal(spawnAfter(w, UK_SNIPER), fast(UK_SNIPER), 'tech: with a barracks the sniper also comes out a quarter sooner'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24);
      step(w, [P(ME, HQ_SAND)]);
      step(w, [{ t: 'construct', side: ME, ids: [e.id], kind: BK_BARRACKS, x: 18, z: 24 }]);
      assert(w.blds[0].hqUp !== undefined && w.tech?.sites.length === 1, 'tech: while the HQ is upgrading, construct is still taken');
      for (let i = 0; i < 100; i++) step(w, []);
      assert(w.blds[0].hqUp !== undefined && w.tech.sites[0].left < TECH50[BK_BARRACKS].work, 'tech: and the engineer keeps building through the pause');
      while (w.blds[0].hqUp !== undefined) step(w, []);
      const ids = [put(w, ME, UK_ENGINEER, 20, 20).id];
      assert.deepEqual([why50(w, ME, BK_SUPPLY, { x: 24 - 1 - RANGE50, z: 28, ids }), why50(w, ME, BK_SUPPLY, { x: 24 - 2 - RANGE50, z: 28, ids })], ['', '離指揮部太遠'], 'tech: at level 1 the 8 cells are still measured from the same 2×2'); }
    { const run = up => { const w = camp(); w.eco.supply = [100, 100]; bld(w, BK_SUPPLY, 18, 28, 2, 2, 1, ME); if (up) step(w, [P(ME, HQ_SAND)]); else step(w, []); for (let i = 0; i < 199; i++) step(w, []); return w.eco.supply[ME]; };
      assert.equal(run(true), run(false) - 30, 'tech: the supply depot pays through the pause'); }
  },
  // 驗收 8：指揮部倒了就結束
  end() {
    for (const rule of [1, 0]) {
      const got = [0, 1, 2].map(lv => {
        const w = camp(rule ? { end: 1 } : {}), hq = lvl(w, lv, 60), e = put(w, FOE, UK_ENGINEER, 23, 24), tk = put(w, ME, UK_TANK, 6, 10);
        step(w, [{ t: 'fireAt', side: FOE, ids: [e.id], x: 24, z: 24 }, { t: 'fireAt', side: ME, ids: [tk.id], x: 4, z: 4 }]);
        while (w.winner < 0 && w.tick < 3000) step(w, []);
        return [w.winner, w.tick, hq.hp <= 0];
      });
      assert(got[0][0] === FOE && got[0][2], `end: fixture — the engineer brings our HQ down and the enemy wins (${JSON.stringify(got[0])})`);
      assert.deepEqual(got.slice(1), [got[0], got[0]], `end: ${rule ? 'end rule' : 'old rule'} — levels 1 and 2 fall and are decided exactly like level 0 (${JSON.stringify(got)})`);
      const fall = up => {
        const w = camp(rule ? { end: 1 } : {}), hq = w.blds[0];
        step(w, [P(ME, UK_INFANTRY), ...(up ? [P(ME, HQ_SAND)] : [])]);
        while (w.tick < 100) step(w, []);
        hq.hp = 0; step(w, []);
        while (w.winner < 0 && w.tick < 400) step(w, []);
        return [w.eco.queue[ME].length, w.eco.prog[ME], hq.hqUp, w.winner, w.tick];
      };
      const a = fall(true), b = fall(false);
      assert.deepEqual([a[0], a[1], a[2] > 0, a[3], a[4]], [0, 0, true, b[3], b[4]], `end: ${rule ? 'end rule' : 'old rule'} — falling halfway through the upgrade clears the queue, leaves hqUp on the rubble and decides like before (${a} vs ${b})`);
    }
  },
  // 驗收 9：假指令（每一筆寫明哪一層擋）
  forged() {
    const pr = (side, kind) => ({ t: 'produce', side, kind });
    for (const c of [pr(2, HQ_SAND), pr(-1, HQ_SAND), pr('1', HQ_SAND), pr(0, 1201.5), pr(0, 2147483648), { t: 'eco', hq11: '1' }, { t: 'eco', hq11: 1.5 }])
      assert.equal(isCommand(c), false, `forged: isCommand refuses ${JSON.stringify(c)}`);
    for (const side of [2, -1]) {
      const a = camp(), b = structuredClone(a);
      step(a, [pr(side, HQ_SAND)]); step(b, []);
      assert.equal(hashWorld(a), hashWorld(b), `forged: fed straight to step(), side ${side} changes nothing and throws nothing (why1011 rule 1)`);
    }
    { const w = camp(); step(w, [pr(0, 1201.5)]);
      assert.equal(w.blds[0].hqUp, 299, 'forged: fact — step() truncates kind 1201.5 to 1201 and takes it (shape checks are isCommand\'s job, as for every command)'); }
    { const w = camp(); step(w, Array.from({ length: 1000 }, () => pr(ME, HQ_SAND)));
      assert.deepEqual([w.eco.supply[ME] - 500 <= -29, w.eco.supply[ME] - 500 >= -30, w.blds[0].hqUp], [true, true, 299], 'forged: 1,000 orders in one step — one taken, paid once'); }
    { const w = camp(); step(w, [pr(ME, HQ_SAND), pr(ME, HQ_PHONE)]);
      assert.deepEqual([w.eco.supply[ME] - 500 >= -30, w.blds[0].hqUp, w.blds[0].hqLv], [true, 299, undefined], 'forged: 1201 and 1202 in one step — only 1201 is taken'); }
    { const a = camp(), b = structuredClone(a); a.eco.hq[FOE] = 0; b.eco.hq[FOE] = 0;
      step(a, [pr(FOE, HQ_SAND)]); step(b, []);
      assert.equal(hashWorld(a), hashWorld(b), 'forged: an order for a side whose HQ id is 0 changes nothing and throws nothing'); }
    // 連線對戰：真的 Lockstep（versus），兩邊一步一步交換包；第 0 方偽造第 1 方的 1201，第 1 方自己送 1201
    const opening = [{ t: 'map', id: 1, vegetation: 1, sym: 1 }, { ...ECO, sw: 2, tech: 1, hq11: 1 }];
    const peers = [0, 1].map(me => ({ me, w: createWorld(1944), ls: new Lockstep(me, [0, 1], 1, NET_DELAY, true) }));
    for (const p of peers) step(p.w, opening);
    const enemyHq = p => p.w.blds[p.w.eco.hq[FOE] - 1], seen = {};
    for (let t = 1; t <= 400; t++) {
      const mine = [t === 20 ? [pr(FOE, HQ_SAND)] : [], t === 40 ? [pr(FOE, HQ_SAND)] : []];
      const outs = peers.map((p, i) => p.ls.take(t, mine[i], () => hashWorld(p.w)));
      outs.forEach((r, i) => { for (const pkt of r.out) peers[1 - i].ls.receive(i, pkt); });
      peers.forEach((p, i) => step(p.w, outs[i].cmds));
      assert.equal(hashWorld(peers[0].w), hashWorld(peers[1].w), `forged: versus — both worlds hash the same after step ${t}`);
      if (t === 35 || t === 50) seen[t] = peers.map(p => enemyHq(p).hqUp);
    }
    assert.deepEqual([seen[35], seen[50] && seen[50].every(v => v > 0), peers.map(p => p.ls.desync), peers.map(p => enemyHq(p).hqLv), peers.map(p => p.w.blds[p.w.eco.hq[ME] - 1].hqUp)], [[undefined, undefined], true, [-1, -1], [1, 1], [undefined, undefined]],
      'forged: versus — player 0\'s forged 1201 for side 1 is dropped by the lockstep; player 1\'s own 1201 is taken on both machines');
  },
  // 驗收 10：電腦對電腦帶 hq11（沒人升級）每 100 步跟不帶的一樣
  quiet() {
    for (const [map, seed, levels] of [[0, 31, [3, 2]], [1, 32, [1, 3]]]) {
      const ais = [{ t: 'ai', side: 0, level: levels[0], v: 3 }, { t: 'ai', side: 1, level: levels[1], v: 3 }];
      const a = createWorld(seed), b = createWorld(seed);
      step(a, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, tech: 1 }), ...ais]); step(b, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, tech: 1, hq11: 1 }), ...ais]);
      assert.equal(b.eco.hq11, 1, 'quiet: fixture — the second game has hq11');
      while (a.tick < 3000 && a.winner < 0) { step(a, []); step(b, []); if (a.tick % 100 === 0) assert.equal(hashNoHq11(b), hashWorld(a), `quiet: map ${map}, AI ${levels} — at tick ${a.tick} the world with hq11 is the world without it`); }
      assert.deepEqual([b.winner, b.tick, b.blds.some(x => x.hqLv !== undefined || x.hqUp !== undefined)], [a.winner, a.tick, false], `quiet: map ${map}: same winner, same length, no building ever upgraded`);
    }
  },
  // 驗收 11：存檔
  codec() {
    const make = stop => { const w = camp(); bld(w, BK_HOUSE, 10, 10, 1, 1, 1); step(w, [P(ME, HQ_SAND), P(ME, UK_INFANTRY)]); while (!stop(w)) step(w, []); return w; };
    const half = make(w => w.blds[0].hqUp === 137), one = make(w => w.blds[0].hqLv === 1);
    const two = make(w => { if (w.blds[0].hqLv === 1 && w.blds[0].hqUp === undefined) step(w, [P(ME, HQ_PHONE)]); return w.blds[0].hqLv === 2; });
    for (const [what, w] of [['half built (hqUp 137)', half], ['level 1', one], ['level 2', two]]) {
      const back = decodeWorld(raw(w));
      assert(back && hashWorld(back) === hashWorld(w), `codec: ${what} reads back with the same hash`);
      for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
      assert.equal(hashWorld(back), hashWorld(w), `codec: ${what} — 600 steps after loading, the same hash`);
    }
    const r0 = raw(make(w => w.blds[0].hqUp === 137)), r1 = raw(make(w => w.blds[0].hqLv === 1 && w.blds[0].hqUp === undefined)), r2 = raw(two);
    const edit = (r, f) => { const c = structuredClone(r); f(c); return c; };
    const bad = [
      ['eco.hq11 2', edit(r0, c => { c.eco.hq11 = 2; })],
      ['hq11 without tech', edit(r0, c => { delete c.eco.tech; })],
      ['hqUp without hq11', edit(r0, c => { delete c.eco.hq11; })],
      ['hqLv without hq11', edit(r1, c => { delete c.eco.hq11; })],
      ['hqLv on a house', edit(r1, c => { c.blds[2].hqLv = 1; })],
      ['hqLv 3', edit(r2, c => { c.blds[0].hqLv = 3; })],
      ['hqLv 0', edit(r1, c => { c.blds[0].hqLv = 0; c.blds[0].maxHp = 1200; c.blds[0].hp = 1200; })],
      ['hqLv a string', edit(r1, c => { c.blds[0].hqLv = '1'; })],
      ['hqUp 0', edit(r0, c => { c.blds[0].hqUp = 0; })],
      ['hqUp 301 for level 1', edit(r0, c => { c.blds[0].hqUp = 301; })],
      ['hqUp 401 for level 2', edit(r1, c => { c.blds[0].hqUp = 401; })],
      ['level 2 still upgrading', edit(r2, c => { c.blds[0].hqUp = 5; })],
      ['level 1 with 1,200', edit(r1, c => { c.blds[0].maxHp = 1200; c.blds[0].hp = 1200; })],
      ['level 0 with 1,800', edit(r0, c => { c.blds[0].maxHp = 1800; })],
    ];
    for (const [what, r] of bad) assert.equal(decodeWorld(r), null, `codec: refused — ${what}`);
    { const r = edit(r0, c => { c.blds[0].hp = 0; }), w = decodeWorld(r);
      assert(w && w.blds[0].hqUp === 137, 'codec: a HQ that fell halfway through the upgrade (hp 0, hqUp kept) reads');
      for (let i = 0; i < 50; i++) step(w, []); }
    { const w = camp(); delete w.eco.hq11; w.blds[0].maxHp = 100; w.blds[0].hp = 71;
      assert(decodeWorld(raw(w)), 'codec: an old save without hq11 (even with a changed HQ maximum) reads, maximum not checked'); }
  },
  // 驗收 12：重播（加固、交換台、出兵、坦克與榴彈砲打指揮部、交換台斷線）
  replay() {
    const log = [], w = createWorld(1944), born = [];
    const go = cmds => { for (const cmd of cmds) log.push({ tick: w.tick, cmd }); const n = w.units.length; step(w, cmds); for (const u of w.units.slice(n)) born.push([u.kind, w.tick - 1]); };
    go([{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, sw: 2, tech: 1, hq11: 1 }, P(ME, HQ_SAND), P(FOE, UK_TANK)]);
    const hq = w.blds[w.eco.hq[ME] - 1];
    let cut = -1;
    while (w.tick < 2400) {
      const c = [];
      if (w.tick === 300) c.push(P(ME, HQ_PHONE));
      if (w.tick === 320) c.push({ t: 'fireAt', side: FOE, ids: w.units.filter(u => u.side === FOE && u.alive && (u.kind === UK_TANK || u.kind === 1)).map(u => u.id), x: hq.x, z: hq.z });
      if (w.tick === 750 || w.tick === 2100) c.push(P(ME, UK_INFANTRY));
      go(c);
      if (cut < 0 && hq.hqLv === 2 && stageOf(hq) !== 0) cut = w.tick;
    }
    const inf = born.filter(([k, t]) => k === UK_INFANTRY && t >= 750).map(([, t]) => t);
    assert(hq.hqLv === 2 && cut > 0 && cut < 2100 && inf[0] - 750 === fast(UK_INFANTRY) && inf[1] - 2100 === T(UK_INFANTRY), `replay: fixture — both levels, the shelled HQ cut the line at ${cut}, infantry ${inf} (fast before, normal after)`);
    assert.equal(hashWorld(runLog(createWorld(1944), log, 2400)), hashWorld(w), 'replay: the log replays to the same hash');
    const half = runLog(createWorld(1944), log, 450), back = decodeWorld(raw(half));
    assert(back.blds[back.eco.hq[ME] - 1].hqUp > 0, 'replay: fixture — saved halfway through the switchboard');
    assert.equal(hashWorld(runLog(back, log.filter(l => l.tick >= 450), 2400)), hashWorld(w), 'replay: saved at 450 and replayed on, the same hash');
    const json = JSON.parse(JSON.stringify(log));
    assert.equal(checkLog(json), null, 'replay: the log passes checkLog');
    assert.equal(hashWorld(runLog(createWorld(1944), json, 2400)), hashWorld(w), 'replay: through JSON and back, the same hash');
  },
  // 驗收 13：沒有 hq11 的局逐位不變
  hash() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'hash: the golden script battle is unchanged');
    for (const [extra, pinned, what] of [[{ sw: 2 }, PINNED_SW2, 'sw 2 without tech'], [{ sw: 2, tech: 1 }, PINNED_TECH, 'tech without hq11']]) {
      const now = {};
      for (const map of [0, 1]) for (const real of [false, true]) {
        const w = createWorld(31 + map);
        step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(extra), ...(real ? [{ t: 'rules', ap: 1, morale: 2 }] : []), { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }]);
        while (w.tick < 3000 && w.winner < 0) step(w, []);
        now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(w);
      }
      assert.deepEqual(now, pinned, `hash: four battles with ${what} are bit for bit what they were before this card`);
    }
    const a = createWorld(1944), b = createWorld(1944), orders = { 0: [P(ME, UK_INFANTRY), P(FOE, UK_TANK)], 400: [P(ME, UK_TANK), P(FOE, UK_INFANTRY)], 900: [P(ME, UK_INFANTRY), P(ME, UK_INFANTRY)] };
    step(a, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, sw: 2, tech: 1 }, ...orders[0]]); step(b, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, sw: 2, tech: 1, hq11: 1 }, ...orders[0]]);
    assert.equal(b.eco.hq11, 1, 'hash: fixture — the second game has hq11');
    while (a.tick < 2000) { const c = orders[a.tick] ?? []; step(a, c); step(b, c); if (a.tick % 100 === 0) assert.equal(hashNoHq11(b), hashWorld(a), `hash: hq11 on but nobody upgrades — at tick ${a.tick} the hash without the flag is the hash of the game without it`); }
  },
  // 驗收 14：介面
  ui() {
    assert.deepEqual(hq1011Items().map(i => [i.kind, i.label, i.cost, i.group]), [[1201, '加固指揮部', 30, '指揮部'], [1202, '電話交換台', 40, '指揮部']], 'ui: two items in their own 指揮部 group');
    assert.deepEqual(tech50Items().map(i => [i.kind, i.group]), [[1014, '建造'], [1015, '建造'], [1016, '建造']], 'ui: the 建造 group still has exactly its three items');
    const w = camp(), hq = w.blds[0];
    assert.deepEqual([block1011(w, HQ_SAND), block1011(w, HQ_PHONE), block1011(w, UK_TANK), block1011(w, 1014)], ['', '要先加固指揮部', undefined, undefined], 'ui: the two keys ask why1011, other keys keep their own reasons');
    w.eco.supply[ME] = 10; assert.equal(block1011(w, HQ_SAND), '補給不足，還差 20', 'ui: short of supply says how much');
    w.eco.supply[ME] = 500;
    const line = () => hqDurability(w, true);
    assert.equal(line(), '我方指揮部：1200/1200 · 完好', 'ui: not upgraded, the R127 line is unchanged');
    step(w, [P(ME, HQ_SAND)]);
    assert.deepEqual([line(), block1011(w, HQ_SAND), block1011(w, HQ_PHONE)], ['我方指揮部：1200/1200 · 完好 · 加固中，還要 15 遊戲秒（生產暫停）', '正在升級', '正在升級'], 'ui: sandbagging — the R127 line says so, and both keys say 正在升級');
    for (let i = 0; i < 299; i++) step(w, []);
    assert.deepEqual([line(), block1011(w, HQ_SAND), block1011(w, HQ_PHONE)], ['我方指揮部：1800/1800 · 完好 · 已加固', '已經加固', ''], 'ui: level 1');
    step(w, [P(ME, HQ_PHONE)]);
    assert.equal(line(), '我方指揮部：1800/1800 · 完好 · 已加固 · 架交換台中，還要 20 遊戲秒（生產暫停）', 'ui: putting the switchboard in');
    for (let i = 0; i < 399; i++) step(w, []);
    assert.deepEqual([line(), block1011(w, HQ_PHONE)], ['我方指揮部：1800/1800 · 完好 · 已加固 · 交換台通', '已經有交換台'], 'ui: level 2, line through');
    hq.hp = 1500; assert.equal(line(), '我方指揮部：1500/1800 · 受損 · 已加固 · 交換台通', 'ui: 受損 above seventy percent, the line is still through');
    hq.hp = 1260; assert.equal(line(), '我方指揮部：1260/1800 · 重損 · 已加固 · 交換台斷線', 'ui: at seventy percent, the line is cut');
    assert.equal(tag1011(w, hq), ' · 已加固 · 交換台斷線', 'ui: tag1011 is the tail of that line');
    { const v = camp(); delete v.eco.hq11; v.blds[0].hqLv = 2; assert.equal(tag1011(v, v.blds[0]), '', 'ui: without hq11 the tail is empty'); }
    { const v = camp(); lvl(v, 2); step(v, [P(ME, UK_TANK)]);
      const shown = +countdown95(v, true).match(/製造剩餘 (\d+) 遊戲秒/)[1]; let k = 0;
      while (v.eco.prog[ME] < T(UK_TANK)) { step(v, []); k++; }
      assert.equal(shown, Math.ceil(k / TICK_HZ), `ui: with the switchboard the R125 countdown is the real steps left ÷ 20, rounded up (${shown} s, ${k} steps)`); }
  },
  // 驗收 15：接線
  wiring() {
    const main = src('src/main.ts'), lines = main.split('\n').length - 1, budget = JSON.parse(src('tools/hub-budget.json'));
    assert(main.includes("import { hq1011Items, block1011 } from './ui/hq1011.ts';"), 'wiring: ① main.ts imports the R1011 items and reasons');
    assert(main.includes("sw1002({ t: 'eco', ...(V.r050 && V.r1002 && V.r1011 ? { hq11: 1 } : {}), "), 'wiring: ② a new battle sends hq11 from ecoCmd, only with R050, R1002 and R1011 on');
    assert(main.includes('...(V.r050 && V.r1002 ? tech50Items() : []), ...(V.r050 && V.r1002 && V.r1011 ? hq1011Items() : [])], {'), 'wiring: ③ the 指揮部 group is there only with the same three valves');
    assert(main.includes('kind => block50(w, kind) ?? block1011(w, kind) ?? reason95('), 'wiring: ④ the two keys take their reasons from block1011');
    const seg = (a, b) => { const i = main.indexOf(a), j = main.indexOf(b, i); return i < 0 || j < 0 ? '' : main.slice(i, j + b.length); };
    const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
    assert.deepEqual([sha(seg('function issue(cmd: Command) {', '\n}\n')), sha(seg('  playLog: (s: number', '    return hashWorld(w);\n  },'))], [ISSUE_SHA, PLAYLOG_SHA], 'wiring: issue() and __rts.playLog are word for word what they were (playLog replays never gain hq11)');
    assert.equal(main.split("issue(V.r050 && V.r1002 ? { ...ecoCmd(), tech: 1 } as Command : ecoCmd())").length - 1, 2, 'wiring: the two places that open a battle are unchanged');
    assert(lines <= budget['src/main.ts'] && lines === 670, `wiring: main.ts stays at 670 lines (budget ${budget['src/main.ts']}; now ${lines})`);
    const battle = src('src/render/battle.ts').split('\n').length - 1;
    assert(battle <= budget['src/render/battle.ts'] && battle === 1194, `wiring: battle.ts stays at 1194 lines (now ${battle})`);
    assert(src('src/render/battle.ts').includes("if (e.e === 'wire' || e.e === 'hq11') { townDirty = true; vegetationDirty = true; }"), 'wiring: the hq11 event rebuilds the town mesh');
    assert(src('src/render/buildings.ts').includes("${b.builtBy ?? ''},${b.hqLv ?? ''},${stage},"), 'wiring: the per-building town cache keys on hqLv');
    assert(src('src/valves.ts').includes("get r1011() { return on('1011'); },"), 'wiring: ?noR1011=1 is in the valve table');
    assert(src('tools/cdp.mjs').includes("const full1011 = /(^|&)noR1011=/.test(full50) ? full50 : `${full50 ? full50 + '&' : ''}noR1011=1`;"), 'wiring: tools/cdp.mjs opens pages with noR1011=1 unless a guard asks for R1011');
  },
  // 驗收 16：純度
  purity() {
    const s = src('src/sim/hq1011.ts'), code = s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|Date|rng\.ts|randInt|nextU32/.test(code), 'purity: no floats, no **, no randomness, no clock in hq1011.ts');
    for (const m of s.matchAll(/from '([^']+)'/g)) assert(/^\.\/[a-zA-Z0-9]+\.ts$/.test(m[1]), `purity: hq1011.ts imports only ./x.ts (${m[1]})`);
    assert(!/\benum\b|\bnamespace\b/.test(code), 'purity: no enum or namespace (Node strips the types)');
  },
  // 驗收 17：紅線
  redline() {
    const text = [src('src/sim/hq1011.ts'), src('src/ui/hq1011.ts'), src('src/render/hq1011.ts')].join('\n').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const bad = ['Wehrmacht', 'Royal', 'Signals', 'Fullerphone', '德軍', '英軍', '德國', '納粹', '皇家', '徽', '卐'].filter(word => text.includes(word));
    assert.deepEqual(bad, [], `redline: no armies, nationalities, units or insignia in the R1011 files (${bad})`);
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK hq1011/${name}`);
}
console.log('hq1011: all OK');
