// R050 建造與科技（第一段）：工兵蓋兵營（14）、車廠（15）、補給站（16）。不開瀏覽器的部分，卡面驗收 1–16。
// 用法：node tests/tech50.mjs            全部各群
//       node tests/tech50.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/tech50-negative.mjs）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, TER_ROAD, BK_WIRE,
  BK_HOUSE, BK_HQ, BK_BARRACKS, BK_DEPOT, BK_SUPPLY, BM_WOOD, BM_BRICK, STAGE_INTACT, UK_INFANTRY, UK_SNIPER, UK_AT91, UK_TRUCK, UK_HALFTRACK, UK_AA, UK_ENGINEER, UK_FLAME,
  bldMaxHp, bldMaterial, stageOf } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { TECH50, LOCK50, RANGE50, why50 } from '../src/sim/tech50.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { tech50Items, pick50, arm50, armed50, block50, hint50, ITEM50 } from '../src/ui/tech50.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32）＋雙方指揮部：我方 (24,24)、敵方 (4,4)；eco 帶 sw＝2、tech＝1，補給 500
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
  w.eco = { supply: [500, 500], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, ...extra };
  return w;
}
function put(w, side, kind, cx, cz, ready = true) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const C = (side, ids, kind, x, z) => ({ t: 'construct', side, ids, kind, x, z });
const at = (x, z, ids) => ({ x, z, ids });
const OK = [18, 24];   // 我方指揮部（24,24）左邊 5 格：放得下
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
const opened = extra => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, eco(extra)]); return w; };
function game(map, seed, extra, ais, ticks) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(extra), ...ais]);
  while (w.tick < ticks && w.winner < 0) step(w, []);
  return w;
}
// 雜湊扣掉 tech 那一項（電腦的局：不帶 tech 跟帶 tech 每一步應該一樣）
const hashNoTech = w => { const t = w.eco?.tech; if (w.eco) delete w.eco.tech; const h = hashWorld(w); if (t !== undefined) w.eco.tech = t; return h; };
const BLD_0_13 = '7aff19d4e69c5dc0';   // 建築 0–13 的血與材質摘要（main b5a0e7c）
const PINNED_SW2 = { '0/classic': '52184192', '0/real': '483b7f70', '1/classic': 'd169b4cd', '1/real': '703b2496' };   // R1002 2432aff，sw＝2、不帶 tech，3000 步
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

const groups = {
  // 驗收 1：三種建築的數字；0–13 號不變
  kinds() {
    assert.deepEqual([BK_BARRACKS, BK_DEPOT, BK_SUPPLY], [14, 15, 16], 'kinds: barracks 14, depot 15, supply 16 are appended');
    assert.deepEqual([14, 15, 16].map(k => [bldMaxHp(k, 2, 2, 1), bldMaterial(k)]), [[500, BM_WOOD], [600, BM_BRICK], [400, BM_WOOD]], 'kinds: 500 wood, 600 brick, 400 wood');
    assert.deepEqual(TECH50, { 14: { cost: 40, work: 400, max: 1 }, 15: { cost: 50, work: 500, max: 1 }, 16: { cost: 40, work: 300, max: 2 } }, 'kinds: cost, work and limit are the card\'s table');
    assert.deepEqual(LOCK50, { [UK_SNIPER]: 14, [UK_AT91]: 14, [UK_FLAME]: 14, [UK_TRUCK]: 15, [UK_HALFTRACK]: 15, [UK_AA]: 15 }, 'kinds: the barracks locks 42, 43, 48 and the depot 44, 45, 46');
    const rows = []; for (let k = 0; k <= 13; k++) for (const [a, b, f] of [[1, 1, 1], [2, 1, 2], [2, 2, 1], [2, 2, 3]]) rows.push([k, bldMaxHp(k, a, b, f), bldMaterial(k)]);
    assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16), BLD_0_13, 'kinds: buildings 0–13 keep their hit points and materials');
  },
  // 驗收 2：旗標與指令
  flag() {
    const on = opened({ sw: 2, tech: 1 }), sw1 = opened({ sw: 1, tech: 1 }), two = opened({ sw: 2, tech: 2 }), off = opened({ sw: 2 });
    assert.deepEqual([on.eco.tech, sw1.eco.tech, two.eco.tech, off.eco.tech], [1, undefined, undefined, undefined], 'flag: tech is stored only with sw 2 and only as 1');
    assert.notEqual(hashWorld(on), hashWorld(off), 'flag: tech is folded into the hash');
    assert.equal(isCommand({ ...ECO, tech: 1 }), true, 'flag: the command check takes tech');
    assert.equal(isCommand(C(0, [1, 2], 14, 3, 4)), true, 'flag: the command check takes a construct command');
    for (const bad of [C(2, [1], 14, 3, 4), { ...C(0, [1], 14, 3, 4), ids: 1 }, C(0, [1], 1.5, 3, 4), { t: 'construct', side: 0, ids: [1], kind: 14, x: 3 }]) assert.equal(isCommand(bad), false, `flag: the command check refuses ${JSON.stringify(bad)}`);
    const z = camp(); z.zombies = { wave: 1, killed: 0 };
    assert.equal(why50(z, ME, BK_BARRACKS), '本局未開放', 'flag: zombie defence does not offer building');
  },
  // 驗收 3：每一條放得下的條件
  place() {
    const fresh = () => { const w = camp(); return { w, e: put(w, ME, UK_ENGINEER, 20, 20) }; };
    { const { w, e } = fresh(); assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '', 'place: open ground 5 cells from the HQ takes a barracks'); }
    { const { w, e } = fresh(); delete w.eco.tech; assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '本局未開放', 'place: no tech, no building'); }
    { const { w, e } = fresh(); w.winner = 0; assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '本局未開放', 'place: not after the battle is decided'); }
    { const { w, e } = fresh(); w.blds[0].hp = 0; assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '指揮部已毀', 'place: not without a standing HQ'); }
    { const { w, e } = fresh(); assert.equal(why50(w, ME, BK_HOUSE, at(...OK, [e.id])), '不能蓋這種', 'place: only the three kinds'); }
    { const { w, e } = fresh(); w.eco.supply[ME] = 10; assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '補給不足，還差 30', 'place: supply is checked'); }
    { const { w, e } = fresh(); const foe = put(w, FOE, UK_ENGINEER, 20, 21), inf = put(w, ME, UK_INFANTRY, 20, 22), rider = put(w, ME, UK_ENGINEER, 20, 23); rider.ride = inf.id;
      for (const ids of [[], [foe.id], [inf.id], [rider.id], [999]]) assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, ids)), '先選工兵', `place: needs one of our own engineers on foot (${ids})`);
      e.alive = false; assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '先選工兵', 'place: a dead engineer does not count'); }
    { const { w, e } = fresh(); assert.equal(why50(w, ME, BK_BARRACKS, at(31, 24, [e.id])), '超出地圖', 'place: the 2×2 has to fit on the map'); }
    { const { w, e } = fresh(); assert.deepEqual([why50(w, ME, BK_BARRACKS, at(24 - 1 - RANGE50, 24, [e.id])), why50(w, ME, BK_BARRACKS, at(24 - 2 - RANGE50, 24, [e.id]))], ['', '離指揮部太遠'], 'place: 8 cells from the HQ is the limit'); }
    for (const [what, set] of [['a house', w => bld(w, BK_HOUSE, 19, 25)], ['a road', w => { w.ter[cellIdx(w, 19, 25)] = TER_ROAD; }], ['wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 19, z: 25, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60 }] }; }],
      ['a trench', w => { w.trenches = { version: 1, segments: [{ side: ME, kind: 0, x: 19, z: 25, rot: 0 }] }; }], ['a soldier', w => put(w, ME, UK_INFANTRY, 19, 25)]]) {
      const { w, e } = fresh(); set(w);
      assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '擋到了', `place: ${what} on the footprint blocks it`);
    }
    for (const [what, set] of [['a house', w => bld(w, BK_HOUSE, 17, 26)], ['wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 20, z: 23, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60 }] }; }]]) {
      const { w, e } = fresh(); set(w);
      assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '要跟建築隔一格', `place: ${what} in the ring around it blocks it`);
    }
    { const { w, e } = fresh(); put(w, ME, UK_INFANTRY, 20, 26); assert.equal(why50(w, ME, BK_BARRACKS, at(...OK, [e.id])), '', 'place: a soldier in the ring is fine (only buildings and wire there)'); }
    const { w, e } = fresh(), n0 = w.blds.length;
    step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]);
    const b = w.blds[n0];
    assert.deepEqual([w.blds.length, b.kind, b.x, b.z, b.w, b.d, b.hp, b.maxHp, b.builtBy], [n0 + 1, 14, 18, 24, 2, 2, 1, 500, ME], 'place: a 2×2 barracks site with 1 hit point, built by us');
    assert.deepEqual([w.eco.supply[ME] <= 461 && w.eco.supply[ME] >= 460, w.tech, e.order, e.tx, e.tz], [true, { version: 1, sites: [{ id: b.id, left: 400 }] }, ORD_FIRE_AT, 18, 24], 'place: 40 supply paid, the site is recorded with 400 work, the engineer is sent');
    assert(w.occ[cellIdx(w, 19, 25)] === b.id && w.events.some(v => v.e === 'build' && v.bld === b.id), 'place: the site occupies its cells and announces itself');
  },
  // 驗收 4：每方最多幾座
  limit() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 20);
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24)]);
    assert.equal(why50(w, ME, BK_BARRACKS, at(18, 20, [e.id])), '已經有了', 'limit: one barracks (the site counts)');
    step(w, [C(ME, [e.id], BK_SUPPLY, 18, 28), C(ME, [e.id], BK_SUPPLY, 22, 29)]);
    assert.deepEqual([w.blds.filter(b => b.kind === BK_SUPPLY).length, why50(w, ME, BK_SUPPLY, at(18, 20, [e.id]))], [2, '已經有了'], 'limit: two supply depots');
    w.blds.find(b => b.kind === BK_BARRACKS).hp = 0;
    assert.equal(why50(w, ME, BK_BARRACKS, at(18, 20, [e.id])), '', 'limit: rubble does not count');
    assert.equal(why50(w, FOE, BK_BARRACKS, at(9, 4, [put(w, FOE, UK_ENGINEER, 8, 8).id])), '', 'limit: each side counts its own');
  },
  // 驗收 5：蓋
  build() {
    const run = n => {
      const w = camp(), es = Array.from({ length: n }, (_, i) => put(w, ME, UK_ENGINEER, 17, 24 + i));
      step(w, [C(ME, es.map(e => e.id), BK_BARRACKS, ...OK)]);
      const b = w.blds.at(-1), hp = [b.hp]; let steps = 1, stage = -1;
      while (w.tech.sites.length && steps < 1000) { step(w, []); steps++; hp.push(b.hp); for (const v of w.events) if (v.e === 'stage' && v.bld === b.id) stage = v.stage; }
      return { w, b, es, steps, hp, stage };
    };
    const one = run(1);
    assert.deepEqual([one.steps, one.b.hp, one.stage, one.es[0].order], [400, 500, STAGE_INTACT, ORD_IDLE], 'build: one engineer beside it builds a barracks in 400 steps (full hit points, intact, back to idle)');
    assert.deepEqual([one.hp[0], one.hp[99], one.hp[199]], [1 + Math.floor(499 / 400), 1 + Math.floor((499 * 100) / 400), 1 + Math.floor((499 * 200) / 400)], 'build: hit points grow with the work');
    assert.equal(run(2).steps, 200, 'build: two engineers take half as long');
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24);
      step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]); const b = w.blds.at(-1);
      for (let i = 0; i < 99; i++) step(w, []);
      b.hp -= 50;
      while (w.tech.sites.length) step(w, []);
      assert.equal(b.hp, 450, 'build: damage taken while building stays taken'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24);
      step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]);
      for (let i = 0; i < 50; i++) step(w, []);
      step(w, [{ t: 'move', side: ME, ids: [e.id], x: 10, z: 10 }]);
      const left = w.tech.sites[0].left;
      for (let i = 0; i < 50; i++) step(w, []);
      assert.equal(w.tech.sites[0].left, left, 'build: an engineer that walks away stops building');
      step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: 19, z: 25 }]);
      assert.equal(e.order, ORD_FIRE_AT, 'build: tapping our own site sends it back');
      const hp = w.blds.at(-1).hp; for (let i = 0; i < 200; i++) step(w, []);
      assert(w.blds.at(-1).hp > hp, 'build: back beside it, it builds again (no charges on our own site)'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 12, 24);
      step(w, [C(ME, [e.id], BK_DEPOT, ...OK)]);
      let n = 1; while (w.tech.sites.length && n < 2000) { step(w, []); n++; }
      assert(n > 500 && n < 700 && w.blds.at(-1).hp === 600, `build: an engineer 5 cells off walks over and builds the depot (${n} steps: the walk plus 500)`); }
  },
  // 驗收 6：瓦礫、自己的、敵人的
  ruin() {
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24);
      step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]); const s = w.eco.supply[ME];
      w.blds.at(-1).hp = 0; step(w, []);
      assert.deepEqual([w.tech.sites.length, w.eco.supply[ME] - s <= 1, e.order], [0, true, ORD_IDLE], 'ruin: a site knocked down is forgotten, nothing refunded, the engineer stops'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24), b = bld(w, BK_BARRACKS, ...OK, 2, 2, 1, ME);
      step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: 18, z: 24 }]);
      for (let i = 0; i < 300; i++) step(w, []);
      assert.deepEqual([b.hp, e.order], [500, ORD_IDLE], 'ruin: our engineer does not blow up our own barracks'); }
    { const w = camp(), e = put(w, FOE, UK_ENGINEER, 17, 24), b = bld(w, BK_BARRACKS, ...OK, 2, 2, 1, ME);
      step(w, [{ t: 'fireAt', side: FOE, ids: [e.id], x: 18, z: 24 }]);
      for (let i = 0; i < 125; i++) step(w, []);
      assert.equal(b.hp, 440, 'ruin: an enemy engineer blows charges on it'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24), f = put(w, FOE, UK_ENGINEER, 20, 26);
      step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]); step(w, [{ t: 'stop', side: ME, ids: [e.id] }, { t: 'fireAt', side: FOE, ids: [f.id], x: 19, z: 25 }]);   // 我方工兵停手（還在蓋的話血一直長，一包炸不倒）
      for (let i = 0; i < 130 && w.tech.sites.length; i++) step(w, []);
      assert.deepEqual([w.tech.sites.length, w.blds.at(-1).hp], [0, 0], 'ruin: an enemy engineer blows up our site'); }
  },
  // 驗收 7：科技
  lock() {
    const w = camp(), q = () => w.eco.queue[ME];
    for (const kind of [UK_SNIPER, UK_AT91, UK_FLAME, UK_TRUCK, UK_HALFTRACK, UK_AA]) {
      step(w, [{ t: 'produce', side: ME, kind }]);
      assert.equal(q().length, 0, `lock: without its building kind ${kind} is not queued`);
      assert.equal(productionBlockReason(w, kind), LOCK50[kind] === BK_BARRACKS ? '要先蓋兵營' : '要先蓋車廠', `lock: kind ${kind} says what to build`);
    }
    for (const kind of [UK_ENGINEER, UK_INFANTRY]) { step(w, [{ t: 'produce', side: ME, kind }]); assert.equal(q().at(-1), kind, `lock: kind ${kind} is never locked`); }
    w.eco.queue[ME] = [];
    const site = put(w, ME, UK_ENGINEER, 17, 20); step(w, [C(ME, [site.id], BK_BARRACKS, 18, 20)]);
    step(w, [{ t: 'produce', side: ME, kind: UK_SNIPER }]);
    assert.equal(q().length, 0, 'lock: a barracks still being built does not unlock');
    const b = bld(w, BK_BARRACKS, 14, 24, 2, 2, 1, ME), d = bld(w, BK_DEPOT, 14, 28, 2, 2, 1, ME);
    for (const kind of [UK_SNIPER, UK_FLAME, UK_TRUCK, UK_AA]) step(w, [{ t: 'produce', side: ME, kind }]);
    assert.deepEqual(q(), [UK_SNIPER, UK_FLAME, UK_TRUCK, UK_AA], 'lock: a standing barracks and depot unlock their kinds');
    b.hp = 0; d.hp = 0;
    step(w, [{ t: 'produce', side: ME, kind: UK_AT91 }]);
    assert.deepEqual([q().length, productionBlockReason(w, UK_AT91)], [4, '要先蓋兵營'], 'lock: knocked down, they lock again');
    const n0 = w.units.length; for (let i = 0; i < 400; i++) step(w, []);
    assert(w.units.slice(n0).some(u => u.kind === UK_SNIPER), 'lock: what was already queued still comes out');
    const v = camp(); bld(v, BK_BARRACKS, 14, 24, 2, 2, 1, FOE);
    step(v, [{ t: 'produce', side: ME, kind: UK_SNIPER }]);
    assert.equal(v.eco.queue[ME].length, 0, 'lock: the enemy\'s barracks does not unlock ours');
  },
  // 驗收 8：補給站
  income() {
    const run = setup => { const w = camp(); w.eco.supply = [0, 0]; setup(w); for (let i = 0; i < 400; i++) step(w, []); return w.eco.supply[ME]; };
    const base = run(() => {});
    assert.equal(base, 20, 'income: 400 steps of HQ income is 20');
    assert.deepEqual([run(w => bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME)), run(w => { bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME); bld(w, BK_SUPPLY, 18, 28, 2, 2, 1, ME); }),
      run(w => { bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME); bld(w, BK_SUPPLY, 18, 28, 2, 2, 1, ME); bld(w, BK_SUPPLY, 14, 24, 2, 2, 1, ME); })], [30, 40, 40], 'income: one depot adds 1 every 40 steps, two add 2, a third counts for nothing');
    assert.equal(run(w => { const b = bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME); b.hp = 1; w.tech = { version: 1, sites: [{ id: b.id, left: 300 }] }; }), 20, 'income: a depot still being built gives nothing');
    assert.equal(run(w => { bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, FOE); }), 20, 'income: the enemy\'s depot gives us nothing');
    assert.equal(run(w => { bld(w, BK_SUPPLY, 18, 24, 2, 2, 1, ME); w.blds[0].hp = 0; }), 0, 'income: no HQ, no supply at all');
  },
  // 驗收 9：電腦一行都不受影響
  quiet() {
    for (const [map, seed, levels] of [[0, 31, [3, 2]], [1, 32, [1, 3]]]) {
      const ais = [{ t: 'ai', side: 0, level: levels[0], v: 3 }, { t: 'ai', side: 1, level: levels[1], v: 3 }];
      const a = createWorld(seed), b = createWorld(seed);
      step(a, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2 }), ...ais]); step(b, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, tech: 1 }), ...ais]);
      assert.equal(b.eco.tech, 1, 'quiet: the second game has tech');
      while (a.tick < 3000 && a.winner < 0) { step(a, []); step(b, []); if (a.tick % 100 === 0) assert.equal(hashNoTech(b), hashWorld(a), `quiet: map ${map}, AI ${levels} — at tick ${a.tick} the world with tech is the world without it`); }
      assert.deepEqual([b.tech, b.winner, b.tick], [undefined, a.winner, a.tick], `quiet: map ${map}: no site, same winner, same length`);
    }
  },
  // 驗收 10：存檔
  codec() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24); bld(w, BK_SUPPLY, 18, 28, 2, 2, 1, ME);
    step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]);
    for (let i = 0; i < 150; i++) step(w, []);
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert(back && back.tech?.sites[0]?.left > 0, 'codec: a world with tech, a site half built and a finished depot reads back');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
    assert.equal(hashWorld(back), hashWorld(w), 'codec: 600 steps after loading, the hash equals the uninterrupted run');
  },
  codecref() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24);
    step(w, [C(ME, [e.id], BK_BARRACKS, ...OK)]);
    const raw = JSON.parse(JSON.stringify(encodeWorld(w))), id = w.tech.sites[0].id, { tech, ...noTech } = raw.eco; void tech;
    assert(decodeWorld(raw), 'codec: the site world reads');
    const bad = [
      ['tech 2', { ...raw, eco: { ...raw.eco, tech: 2 } }],
      ['no tech but a site list', (() => { const r = JSON.parse(JSON.stringify({ ...raw, eco: noTech })); r.blds[id - 1].kind = 0; return r; })()],   // R1004：只留工地清單（那一棟改成普通房子），不讓「有 14–16 號建築」那一條先擋掉
      ['no tech but a barracks', (() => { const r = { ...raw, eco: noTech }; delete r.tech; return r; })()],
      ['a site on a house', { ...raw, tech: { version: 1, sites: [{ id: 1, left: 5 }] } }],
      ['a site with no work left', { ...raw, tech: { version: 1, sites: [{ id, left: 0 }] } }],
      ['a site with more work than the kind', { ...raw, tech: { version: 1, sites: [{ id, left: 401 }] } }],
      ['a site past the last building', { ...raw, tech: { version: 1, sites: [{ id: 999, left: 5 }] } }],
      ['version 2', { ...raw, tech: { version: 2, sites: [] } }],
    ];
    for (const [what, r] of bad) assert.equal(decodeWorld(r), null, `codec: refused — ${what}`);
  },
  // 驗收 11：重播
  replay() {
    const log = [], w = createWorld(1944);
    const go = cmds => { for (const cmd of cmds) log.push({ tick: w.tick, cmd }); step(w, cmds); };
    go([{ t: 'map', id: 1, vegetation: 1 }, eco({ sw: 2, tech: 1 }), { t: 'produce', side: ME, kind: UK_ENGINEER }]);
    while (w.tick < 600) go([]);
    const e = w.units.find(u => u.kind === UK_ENGINEER && u.side === ME), hq = w.blds[w.eco.hq[ME] - 1];
    let spot = null; for (let z = hq.z - 8; z <= hq.z + 8 && !spot; z++) for (let x = hq.x - 8; x <= hq.x + 8 && !spot; x++) if (why50(w, ME, BK_SUPPLY, at(x, z, [e.id])) === '') spot = [x, z];
    assert(e && spot, 'replay: an engineer and a spot');
    go([C(ME, [e.id], BK_SUPPLY, ...spot)]);
    while (w.tick < 2400) go([]);
    assert(w.blds.some(b => b.kind === BK_SUPPLY && b.hp === b.maxHp) && !w.tech.sites.length, 'replay: the depot was finished');
    assert.equal(hashWorld(runLog(createWorld(1944), log, 2400)), hashWorld(w), 'replay: the same log replays to the same hash');
    const half = runLog(createWorld(1944), log, 1200), back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(half))));
    assert.equal(hashWorld(runLog(back, log.filter(l => l.tick >= 1200), 2400)), hashWorld(w), 'replay: saved at 1,200 and replayed on, the hash is the same');
  },
  // 驗收 12：沒有 tech 的局逐位不變
  hash() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'hash: the golden script battle is unchanged');
    const now = {};
    for (const map of [0, 1]) for (const real of [false, true]) {
      const w = createWorld(31 + map);
      step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2 }), ...(real ? [{ t: 'rules', ap: 1, morale: 2 }] : []), { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }]);
      while (w.tick < 3000 && w.winner < 0) step(w, []);
      now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(w);
    }
    assert.deepEqual(now, PINNED_SW2, 'hash: four battles with sw 2 and no tech are bit for bit what they were before this card');
  },
  // 驗收 13：介面路由
  route() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 20), inf = put(w, ME, UK_INFANTRY, 20, 21);
    const tap = (x, z, sel) => routeBattleOrder(w, sel, false, 'he', { unit: 0, building: null, ground: { x: x + 0.5, z: z + 0.5 } });
    hint50(w); arm50(0);
    assert.deepEqual(tap(...OK, [e.id])?.commands, [{ t: 'move', side: ME, ids: [e.id], x: 18, z: 24 }], 'route: not armed, a tap is a move as before');
    assert.equal(pick50(ITEM50 + BK_BARRACKS), true, 'route: the 兵營 key arms the barracks');
    assert.equal(armed50(), BK_BARRACKS, 'route: armed');
    assert.equal(tap(...OK, [inf.id]), null, 'route: without an engineer selected nothing is sent');
    assert.match(hint50(w), /放不下：先選工兵/, 'route: the hint says to pick an engineer');
    assert.equal(tap(5, 24, [e.id, inf.id]), null, 'route: too far is not sent');
    assert.match(hint50(w), /放不下：離指揮部太遠/, 'route: the hint says why');
    assert.deepEqual(tap(...OK, [e.id, inf.id])?.commands, [C(ME, [e.id], BK_BARRACKS, 18, 24)], 'route: armed, a tap with an engineer selected sends construct for the engineers only');
    assert.equal(armed50(), 0, 'route: sent, disarmed');
    pick50(ITEM50 + BK_DEPOT); pick50(ITEM50 + BK_DEPOT);
    assert.equal(armed50(), 0, 'route: the same key again disarms');
    assert.equal(pick50(UK_SNIPER), false, 'route: a unit key is still production');
  },
  // 驗收 14：介面
  ui() {
    assert.deepEqual(tech50Items().map(i => [i.kind, i.label, i.cost, i.group]), [[1014, '兵營', 40, '建造'], [1015, '車廠', 50, '建造'], [1016, '補給站', 40, '建造']], 'ui: three items in the 建造 group');
    const w = camp();
    assert.deepEqual([block50(w, 1014), block50(w, UK_SNIPER)], ['', undefined], 'ui: the build keys ask why50, unit keys keep their own reasons');
    w.eco.supply[ME] = 0; assert.equal(block50(w, 1015), '補給不足，還差 50', 'ui: a build key says what is short');
    const main = src('src/main.ts');
    assert(main.includes('...(V.r093 ? aa93Items() : []), ...(V.r050 && V.r1002 ? tech50Items() : [])'), 'ui: the 建造 group is there only with both valves');
    assert.equal(main.split("issue(V.r050 && V.r1002 ? { ...ecoCmd(), tech: 1 } as Command : ecoCmd())").length - 1, 2, 'ui: a new battle sends tech only with both valves (both places that open a battle)');
    assert(main.includes("produce: kind => { if (pick50(kind)) hud?.update(); else issue({ t: 'produce', side: SIDE_PLAYER, kind }); },"), 'ui: a build key arms instead of producing');
    assert(src('tools/cdp.mjs').includes("const full50 = /(^|&)noR050=/.test(full1002) ? full1002 : `${full1002 ? full1002 + '&' : ''}noR050=1`;"), 'ui: tools/cdp.mjs opens pages with noR050=1 unless a guard asks for R050');
  },
  // 驗收 15：純度
  purity() {
    const s = src('src/sim/tech50.ts'), code = s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|rng\.ts|randInt|nextU32/.test(code), 'purity: no floats, no **, no randomness in tech50.ts');
    for (const m of s.matchAll(/from '([^']+)'/g)) assert(/^\.\/[a-zA-Z0-9]+\.ts$/.test(m[1]), `purity: tech50.ts imports only ./x.ts (${m[1]})`);
  },
  // 驗收 16：紅線
  redline() {
    const text = [src('src/sim/tech50.ts'), src('src/ui/tech50.ts'), src('src/render/tech50.ts')].join('\n');
    const bad = ['Nissen', 'Wehrmacht', 'Royal', '德軍', '英軍', '納粹', '皇家', '徽'].filter(word => text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n').includes(word));
    assert.deepEqual(bad, [], `redline: no type names, armies, nationalities or insignia in the R050 files (${bad})`);
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK tech50/${name}`);
}
console.log('tech50: all OK');
