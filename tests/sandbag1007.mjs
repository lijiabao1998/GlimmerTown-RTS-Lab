// R1007 建造與科技（第二段）：工兵在戰場上堆沙包（建築種類 17，只住在 w.bags）。不開瀏覽器的部分，卡面驗收 1–19。
// 用法：node tests/sandbag1007.mjs            全部各群
//       node tests/sandbag1007.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/sandbag1007-negative*.mjs）
// 步數、距離從 BAG1007、UNIT_KINDS 推，不寫死；寫死的只有在基線 c31548b 上算出來的雜湊與摘要（卡面施工紀錄寫了怎麼算的）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, HALF, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, TER_ROAD, TER_MUD, BK_WIRE,
  BK_HOUSE, BK_BARRACKS, BK_SANDBAG, SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE, SUP_SHAKEN, SUP_PINNED, SUP_BROKEN,
  UK_TANK, UK_HOWITZER, UK_INFANTRY, UK_MORTAR, UK_ENGINEER, UK_FLAME, UK_TRUCK, UK_HALFTRACK,
  bldMaxHp, bldMaterial, blocks, wireBlocks, speedPct } from '../src/sim/world.ts';
import { step, runLog, applyCommand, firstBlock, spotted } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { trenchAt } from '../src/sim/trenches.ts';
import { isCommand, checkLog } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { why50 } from '../src/sim/tech50.ts';
import { BAG1007, RANGE1007, why1007, look1007, blast1007 } from '../src/sim/sandbag1007.ts';
import { coverPct, suppress, supPct, SUP_SMALL } from '../src/sim/morale.ts';
import { DEMO_BLAST } from '../src/sim/engineer1002.ts';
import { BOMB93 } from '../src/sim/air93.ts';
import { MAP_HYTHE, HYTHE_BRIDGES } from '../src/sim/hytheMap.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { tech50Items, pick50, arm50, armed50, block50, hint50, ITEM50, bag1007Tap } from '../src/ui/tech50.ts';
import { bag1007Items, BAG_ITEM } from '../src/ui/sandbag1007.ts';
import { ECO } from '../tools/duel.mjs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as B from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';
import { bag1007Geo } from '../src/render/sandbag1007.ts';

// 一片空地（32×32）＋雙方指揮部：我方 (24,24)、敵方 (4,4)；eco 帶 sw＝2、tech＝1、bag＝1，補給 500
let BASE = null;   // createWorld(7) 只做一次，之後複製（掩護群要開兩千多個世界）
function field() {
  const w = structuredClone(BASE ??= createWorld(7));
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
  const w = field(), h0 = bld(w, 5, 24, 24, 2, 2, 1, ME), h1 = bld(w, 5, 4, 4, 2, 2, 1, FOE);
  w.eco = { supply: [500, 500], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, bag: 1, ...extra };
  return w;
}
function put(w, side, kind, cx, cz, ready = true) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
// 直接擺一處沙包（夾具；不經過 why1007）
function bag(w, side, x, z, hp = BAG1007.hp, left = 0) {
  const list = (w.bags ??= { version: 1, segments: [] }).segments, s = { id: list.length + 1, kind: BK_SANDBAG, x, z, w: 1, d: 1, floors: 1, hp, maxHp: BAG1007.hp, builtBy: side, left };
  list.push(s);
  return s;
}
const C = (side, ids, x, z, kind = BK_SANDBAG) => ({ t: 'construct', side, ids, kind, x, z });
const at = (x, z, ids) => ({ x, z, ids });
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
const opened = (extra, pre = []) => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, ...pre, eco(extra)]); return w; };
const near = (u, x, z) => Math.max(Math.abs(cellOf(u.x) - x), Math.abs(cellOf(u.z) - z));
const wires = w => w.events.filter(e => e.e === 'wire').length;
const BLD_0_16 = '4125250f9ee80a6b';   // 建築 0–16 的血與材質摘要（基線 c31548b；17 號沒有加進 bldMaxHp、bldMaterial）
const KINDS_49 = 'd4ee5c3d7aa7fae7';   // UNIT_KINDS 49 列的摘要（基線 c31548b）
// 基線 c31548b 上算的：帶 tech、不帶 bag（以及不帶 tech 的 sw＝2）的四局，每 500 步的雜湊（萊伊／亂數村莊 × 經典／擬真；電腦 3 對 2）
const PINNED_TECH = {
  'tech 0/classic': ['bdfd3b96', 'abbac778', 'dd0306c8', '218b9aa9', 'c1f8a90e', '007c9d22'],
  'tech 0/real': ['d1fbd026', '2dd2e15d', 'fe10c461', '1559fe62', 'c682e451', '986fbc98'],
  'tech 1/classic': ['276921d9', '11e5e74d', '97dc2c93', '298aa06f', '34a4a213', '3868f1f5'],
  'tech 1/real': ['83d39814', 'f23b2abe', '2904b6a3', 'c18eb462', '9145531a', '1f1eeade'],
  'sw2 0/classic': ['a4e20d0e', '7eea0780', '3a0a4a18', '8a36cf51', 'b9615b26', '52184192'],
  'sw2 0/real': ['42696bfe', '9fb087e5', '2163a6c9', '120ab79a', '1d733989', '483b7f70'],
  'sw2 1/classic': ['c38cdc51', '6db4c175', '56b34cbb', '277e0e37', '7415b463', 'd169b4cd'],
  'sw2 1/real': ['fd875244', '08f80cae', 'a0d8341b', 'f57f0cfa', '8842cf32', '703b2496'],
};
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const nonArmored = k => !UNIT_KINDS[k].armored && !UNIT_KINDS[k].carry;
// 一發砲彈下一步落地：shooter＝在遠處、不會開火的那一種（null＝炸彈，沒有射手）
function shell(w, shooterKind, kind, ex, ez, target = 0, side = FOE) {
  const g = shooterKind === null ? null : put(w, side, shooterKind, side === FOE ? 2 : 29, 30, false);
  w.shells.push({ id: w.nextShell++, side, kind, shooter: g ? g.id : 0, sx: g ? g.x : 0, sz: g ? g.z : 0, ex, ez, t: 0, T: 1, target, hitBld: 0 });
}

const groups = {
  // 驗收 1：數字；建築 0–16、兵種不變
  kinds() {
    assert.equal(BK_SANDBAG, 17, 'kinds: the sandbag is building kind 17 (appended)');
    assert.deepEqual(BAG1007, { cost: 10, work: 200, hp: 120, cover: 50, max: 8, range: 7 }, 'kinds: cost 10, work 200, 120 hit points, cover 50, 8 a side, 7 cells from an engineer');
    assert.equal(RANGE1007, UNIT_KINDS[UK_ENGINEER].sight / SUB, 'kinds: the reach is the engineer\'s sight');
    const rows = []; for (let k = 0; k <= 16; k++) for (const [a, b, f] of [[1, 1, 1], [2, 1, 2], [2, 2, 1], [2, 2, 3]]) rows.push([k, bldMaxHp(k, a, b, f), bldMaterial(k)]);
    assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16), BLD_0_16, 'kinds: buildings 0–16 keep their hit points and materials');
    assert.equal(UNIT_KINDS.length, 49, 'kinds: still 49 unit kinds');
    assert.equal(createHash('sha256').update(JSON.stringify(UNIT_KINDS)).digest('hex').slice(0, 16), KINDS_49, 'kinds: every unit kind row is unchanged');
  },
  // 驗收 2：旗標、雜湊、指令檢查
  flag() {
    const on = opened({ sw: 2, tech: 1, bag: 1 }), noTech = opened({ sw: 2, bag: 1 }), two = opened({ sw: 2, tech: 1, bag: 2 }), sw1 = opened({ sw: 1, tech: 1, bag: 1 }), off = opened({ sw: 2, tech: 1 });
    const z = opened({ sw: 2, tech: 1, bag: 1 }, [{ t: 'zombies' }]);
    assert.deepEqual([on.eco.bag, noTech.eco.bag, two.eco.bag, sw1.eco.bag, off.eco.bag, z.zombies ? z.eco?.bag : 'no zombies'], [1, undefined, undefined, undefined, undefined, undefined], 'flag: bag is stored only as 1, only with tech (which needs sw 2), and not in zombie defence');
    assert.notEqual(hashWorld(on), hashWorld(off), 'flag: bag is folded into the hash');
    { const w = camp(); bag(w, ME, 10, 10); const h = hashWorld(w), s = w.bags.segments[0];
      for (const [f, v] of [['left', 1], ['hp', 7], ['builtBy', FOE], ['x', 11]]) { const o = s[f]; s[f] = v; assert.notEqual(hashWorld(w), h, `flag: the sandbag's ${f} is folded into the hash`); s[f] = o; }
      assert.equal(hashWorld(w), h, 'flag: fixture — restored'); }
    assert.equal(isCommand({ ...ECO, bag: 1 }), true, 'flag: the command check takes bag 1');
    for (const v of [1.5, '1', null]) assert.equal(isCommand({ ...ECO, bag: v }), false, `flag: the command check refuses bag ${JSON.stringify(v)}`);
  },
  // 驗收 3：放得下的每一條條件
  place() {
    const SPOT = [18, 16];
    const fresh = () => { const w = camp(); return { w, e: put(w, ME, UK_ENGINEER, 16, 16) }; };
    const refuse = (w, side, ids, x, z, why, what) => {
      assert.equal(why1007(w, side, BK_SANDBAG, at(x, z, ids)), why, `place: ${what} — says ${why}`);
      w.events = [];
      const h = hashWorld(w), had = 'bags' in w, sup = [...w.eco.supply];
      applyCommand(w, C(side, ids, x, z));
      assert.deepEqual([hashWorld(w), 'bags' in w, w.eco.supply, w.events.length], [h, had, sup, 0], `place: ${what} — refused, nothing changes (hash, w.bags, supply, events)`);
    };
    { const { w, e } = fresh(); assert.equal(why1007(w, ME, BK_SANDBAG, at(...SPOT, [e.id])), '', 'place: open ground two cells from the engineer takes a sandbag'); }
    { const { w, e } = fresh(); delete w.eco.bag; refuse(w, ME, [e.id], ...SPOT, '本局未開放', 'no bag (an R050 game)'); }
    { const { w, e } = fresh(); w.zombies = { version: 1, wave: 0, next: 1e9, pending: 0, spawned: 0, killed: 0, lost: 0 }; refuse(w, ME, [e.id], ...SPOT, '本局未開放', 'zombie defence'); }
    { const { w, e } = fresh(); w.sandbox = { version: 1, running: false, frame: 0 }; refuse(w, ME, [e.id], ...SPOT, '本局未開放', 'sandbox'); }
    { const { w, e } = fresh(); w.winner = FOE; refuse(w, ME, [e.id], ...SPOT, '本局未開放', 'the battle is decided'); }
    { const { w, e } = fresh(); refuse(w, 2, [e.id], ...SPOT, '本局未開放', 'side 2'); }
    { const { w, e } = fresh(); for (let i = 0; i < BAG1007.max; i++) bag(w, ME, 2 + i, 30, i % 2 ? BAG1007.hp : 1, i % 2 ? 0 : 50); refuse(w, ME, [e.id], ...SPOT, `沙包已經 ${BAG1007.max} 處`, 'eight standing (sites count)'); }
    { const { w, e } = fresh(); for (let i = 0; i < BAG1007.max - 1; i++) bag(w, ME, 2 + i, 30); bag(w, ME, 12, 30, 0); bag(w, FOE, 13, 30); assert.equal(why1007(w, ME, BK_SANDBAG, at(...SPOT, [e.id])), '', 'place: seven standing, one scattered and the enemy\'s do not fill the eighth'); }
    { const { w, e } = fresh(); w.eco.supply[ME] = BAG1007.cost - 1; refuse(w, ME, [e.id], ...SPOT, '補給不足，還差 1', 'supply 9'); }
    { const { w, e } = fresh(); const inf = put(w, ME, UK_INFANTRY, 16, 17), foe = put(w, FOE, UK_ENGINEER, 16, 18);
      for (const [ids, what] of [[[], 'no one selected'], [[inf.id], 'infantry only'], [[foe.id], 'the enemy\'s engineer'], [[999], 'an id past the last unit']]) refuse(w, ME, ids, ...SPOT, '先選工兵', what);
      void e; }
    { const { w, e } = fresh(); refuse(w, ME, [e.id], 32, 16, '超出地圖', 'off the map (x 32)'); refuse(w, ME, [e.id], -1, 16, '超出地圖', 'off the map (x −1)'); }
    { const { w, e } = fresh();
      refuse(w, ME, [e.id], 16 + RANGE1007 + 1, 16, '離工兵太遠', `${RANGE1007 + 1} cells from the engineer`);
      assert.equal(why1007(w, ME, BK_SANDBAG, at(16 + RANGE1007, 16 + RANGE1007, [e.id])), '', `place: ${RANGE1007} cells (diagonally too) is in reach`);
      const far = put(w, ME, UK_ENGINEER, 2, 2);
      assert.deepEqual([why1007(w, ME, BK_SANDBAG, at(16 + RANGE1007, 16, [far.id, e.id])), why1007(w, ME, BK_SANDBAG, at(16 + RANGE1007, 16, [far.id]))], ['', '離工兵太遠'], 'place: with a far and a near engineer selected, the nearest one counts'); }
    { const { w, e } = fresh(); w.vegetation.cells[cellIdx(w, ...SPOT)] = 1; refuse(w, ME, [e.id], ...SPOT, '樹籬、樹林裡已經有掩護', 'a hedge'); }
    { const { w, e } = fresh(); w.vegetation.cells[cellIdx(w, ...SPOT)] = 2; refuse(w, ME, [e.id], ...SPOT, '樹籬、樹林裡已經有掩護', 'a copse'); }
    for (const [what, set] of [['a house', w => bld(w, BK_HOUSE, ...SPOT)], ['rubble', w => { bld(w, BK_HOUSE, ...SPOT).hp = 0; }], ['a building site', w => { const b = bld(w, BK_BARRACKS, 18, 15, 2, 2, 1, ME); b.hp = 1; w.tech = { version: 1, sites: [{ id: b.id, left: 300 }] }; }],
      ['wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 17, z: 16, w: 2, d: 1, floors: 1, hp: 60, maxHp: 60 }] }; }],
      ['cut wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 17, z: 16, w: 2, d: 1, floors: 1, hp: 0, maxHp: 60 }] }; }],
      ['our standing sandbag', w => bag(w, ME, ...SPOT)], ['the enemy\'s standing sandbag', w => bag(w, FOE, ...SPOT)], ['our sandbag site', w => bag(w, ME, ...SPOT, 1, 120)]]) {
      const { w, e } = fresh(); set(w); refuse(w, ME, [e.id], ...SPOT, '擋到了', what);
    }
    { const { w, e } = fresh(); w.trenches = { version: 1, segments: [{ side: ME, kind: 0, x: 18, z: 16, rot: 0 }] };
      let cell = null; for (let z = 14; z <= 20 && !cell; z++) for (let x = 16; x <= 22 && !cell; x++) if (trenchAt(w, x, z)) cell = [x, z];
      assert(cell, 'place: fixture — the trench has a cell'); refuse(w, ME, [e.id], ...cell, '擋到了', 'a trench'); }
    { const { w, e } = fresh(); w.ter[cellIdx(w, ...SPOT)] = TER_ROAD; assert.equal(why1007(w, ME, BK_SANDBAG, at(...SPOT, [e.id])), '', 'place: a road takes a sandbag'); }
    { const { w, e } = fresh(); put(w, ME, UK_INFANTRY, ...SPOT); put(w, FOE, UK_INFANTRY, ...SPOT); assert.equal(why1007(w, ME, BK_SANDBAG, at(...SPOT, [e.id])), '', 'place: men of either side standing on the cell do not stop it'); }
    // 海斯：運河的泥灘不行、橋（路蓋過泥灘）可以
    { const w = createWorld(5); step(w, [{ t: 'map', id: MAP_HYTHE, vegetation: 1 }, eco({ sw: 2, tech: 1, bag: 1 })]);
      assert.equal(w.eco.bag, 1, 'place: fixture — Hythe with bag');
      const [bx, bz] = HYTHE_BRIDGES[0], free = (x, z) => !w.occ[cellIdx(w, x, z)] && !w.vegetation?.cells[cellIdx(w, x, z)];
      let mud = null; for (let r = 1; r <= 4 && !mud; r++) for (let z = bz - r; z <= bz + r && !mud; z++) for (let x = bx - r; x <= bx + r && !mud; x++) if (w.ter[cellIdx(w, x, z)] === TER_MUD && free(x, z)) mud = [x, z];
      assert(mud && w.ter[cellIdx(w, bx, bz)] === TER_ROAD && free(bx, bz), `place: fixture — a bridge (${bx},${bz}) and canal mud beside it (${mud})`);
      const e = put(w, ME, UK_ENGINEER, bx, bz - 3 > 0 ? bz - 3 : bz + 3);
      refuse(w, ME, [e.id], ...mud, '不能堆在泥灘上', 'the canal\'s mud (Hythe)');
      assert.equal(why1007(w, ME, BK_SANDBAG, at(bx, bz, [e.id])), '', 'place: the bridge (road over the canal) takes a sandbag'); }
    // 放得下
    const { w, e } = fresh(), around = [[17, 15], [19, 15], [17, 17], [19, 17], [18, 15], [18, 17], [17, 16], [19, 16]];
    for (const [x, z] of around) w.vegetation.cells[cellIdx(w, x, z)] = 1;
    const veg = [...w.vegetation.cells], s0 = w.eco.supply[ME]; w.events = [];
    applyCommand(w, C(ME, [e.id], ...SPOT));
    const s = w.bags?.segments[0];
    assert.deepEqual(s && [w.bags.segments.length, s.kind, s.x, s.z, s.w, s.d, s.floors, s.hp, s.maxHp, s.builtBy, s.left], [1, 17, 18, 16, 1, 1, 1, 1, 120, ME, 200], 'place: one entry, a 1×1 site with 1 hit point and 200 work, ours');
    assert.deepEqual([s0 - w.eco.supply[ME], wires(w)], [BAG1007.cost, 1], 'place: 10 supply paid, one wire event');
    assert.deepEqual([...w.vegetation.cells], veg, 'place: the vegetation table is unchanged cell by cell (the hedges around it stay)');
    assert.deepEqual([e.order, e.tx, e.tz, e.target], [ORD_FIRE_AT, 18, 16, 0], 'place: the engineer is sent to that cell');
  },
  // 驗收 4：重用打散的那一筆；亂數試堆、打、炸
  reuse() {
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 16, 16), f = put(w, FOE, UK_ENGINEER, 16, 19);
      applyCommand(w, C(ME, [e.id], 17, 17)); const s = w.bags.segments[0]; s.hp = 0;
      applyCommand(w, C(FOE, [f.id], 17, 17));
      assert.deepEqual([w.bags.segments.length, w.bags.segments[0] === s, s.id, s.builtBy, s.hp, s.left], [1, true, 1, FOE, 1, BAG1007.work], 'reuse: the scattered sandbag on the same cell is reused — same entry, same number, now the enemy\'s');
      applyCommand(w, C(ME, [e.id], 15, 15)); applyCommand(w, C(ME, [e.id], 15, 17));
      w.bags.segments[1].hp = 0; w.bags.segments[2].hp = 0;
      applyCommand(w, C(ME, [e.id], 13, 16));
      const g = w.bags.segments;
      assert.deepEqual(g.map(b => [b.id, b.x, b.z, b.hp, b.builtBy]), [[1, 17, 17, 1, FOE], [2, 13, 16, 1, ME], [3, 15, 17, 0, ME]], 'reuse: a scattered one elsewhere is moved over — the lowest number first'); }
    // 亂數：2,000 次堆、高爆、炸、走時間；清單永遠 ≤ 16、同一格最多一筆、每方還站著的 ≤ 8、編號＝位置＋1
    let seed = 1007; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const w = camp(), es = [[ME, 8, 8], [ME, 20, 12], [ME, 12, 22], [FOE, 22, 20], [FOE, 6, 16], [FOE, 26, 8]].map(([s, x, z]) => put(w, s, UK_ENGINEER, x, z, false));
    let placed = 0, blasted = 0;
    for (let i = 0; i < 2000; i++) {
      w.eco.supply = [100000, 100000];
      const r = rnd(100);
      if (r < 45) { const e = es[rnd(es.length)]; if (!e.alive) continue; applyCommand(w, C(e.side, [e.id], cellOf(e.x) - 7 + rnd(15), cellOf(e.z) - 7 + rnd(15))); if (w.eco.supply[e.side] < 100000) placed++; }
      else if (r < 75) { const k = [UNIT_KINDS[UK_MORTAR], UNIT_KINDS[UK_HOWITZER], BOMB93][rnd(3)], g = w.bags?.segments ?? [], b = g.length && rnd(4) ? g[rnd(g.length)] : null;   // 多半落在某一處附近
        blast1007(w, b ? center(b.x) - SUB + rnd(2 * SUB) : rnd(w.n * SUB), b ? center(b.z) - SUB + rnd(2 * SUB) : rnd(w.n * SUB), k.splash, k.dmgBld); blasted++; }
      else if (r < 90) { const g = w.bags?.segments ?? []; if (g.length) { const b = g[rnd(g.length)]; if (rnd(3)) b.hp = 0; else { b.left = 0; b.hp = BAG1007.hp; } } }   // 工兵炸掉（hp 0）或蓋好
      else step(w, []);
      const g = w.bags?.segments ?? [], cells = new Set(g.map(b => `${b.x},${b.z}`));
      assert(g.length <= 16 && cells.size === g.length && g.every((b, k) => b.id === k + 1), `reuse: after action ${i} the list has ≤ 16 entries, one per cell, numbered by position (${g.length})`);
      for (const side of [ME, FOE]) assert(g.filter(b => b.builtBy === side && b.hp > 0).length <= BAG1007.max, `reuse: after action ${i} side ${side} has ≤ 8 standing`);
    }
    assert(placed > 200 && blasted > 200 && (w.bags?.segments.length ?? 0) >= 12, `reuse: fixture — the random run did place and blast (${placed} placed, ${blasted} blasts, ${w.bags?.segments.length} entries)`);
  },
  // 驗收 5：堆
  build() {
    const run = (n, setup) => {
      const w = camp(), es = Array.from({ length: n }, (_, i) => put(w, ME, UK_ENGINEER, 17, 15 + i * 2));
      setup?.(w, es);
      step(w, [C(ME, es.map(e => e.id), 18, 16)]);
      const s = w.bags.segments[0], hp = [s.hp]; let steps = 1, ev = 0, evAt = -1;
      while (s.left > 0 && steps < 3000) { setup?.(w, es, true); step(w, []); steps++; hp.push(s.hp); if (wires(w)) { ev += wires(w); evAt = steps; } }
      return { w, s, es, steps, hp, ev, evAt };
    };
    const one = run(1);
    assert.deepEqual([one.steps, one.s.hp, one.s.left, one.es[0].order, one.ev, one.evAt], [BAG1007.work, BAG1007.hp, 0, ORD_IDLE, 1, BAG1007.work], 'build: one engineer beside it builds the sandbag in 200 steps (120 hit points, back to idle, one wire event when done)');
    const W = BAG1007.work, H = BAG1007.hp - 1;
    assert.deepEqual([one.hp[0], one.hp[49], one.hp[99]], [1 + Math.floor(H / W), 1 + Math.floor((H * 50) / W), 1 + Math.floor((H * 100) / W)], 'build: hit points grow with the work');
    assert.equal(run(2).steps, W / 2, 'build: two engineers take half as long');
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 18, 16);
      step(w, [C(ME, [e.id], 18, 16)]); let n = 1; while (w.bags.segments[0].left > 0 && n < 1000) { step(w, []); n++; }
      assert.equal(n, W, 'build: standing on the cell counts as beside it'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16);
      step(w, [C(ME, [e.id], 18, 16)]); const s = w.bags.segments[0];
      for (let i = 0; i < 99; i++) step(w, []);
      s.hp -= 30; while (s.left > 0) step(w, []);
      assert.equal(s.hp, BAG1007.hp - 30, 'build: damage taken while building stays taken'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 13, 16), k = UNIT_KINDS[UK_ENGINEER];
      step(w, [C(ME, [e.id], 18, 16)]); const s = w.bags.segments[0];
      let n = 1, first = 0; while (s.left > 0 && n < 2000) { step(w, []); n++; if (!first && s.left < W) first = n; }
      const spd = Math.floor((k.speed * speedPct(w, 14, 16)) / 100), walk = Math.ceil((4 * SUB - HALF) / spd);   // 走到隔壁那一格的邊上就算挨著（near1002 看所在的格）
      assert(first > walk && first <= walk + 3 && n === first + W - 1, `build: from 5 cells off it walks over (${first - 1} steps; 3.5 cells at ${spd} a step is ${walk}) and then takes 200 more (${n})`); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16);
      step(w, [C(ME, [e.id], 18, 16)]); for (let i = 0; i < 50; i++) step(w, []);
      step(w, [{ t: 'move', side: ME, ids: [e.id], x: 10, z: 10 }]); const left = w.bags.segments[0].left;
      for (let i = 0; i < 50; i++) step(w, []);
      assert.equal(w.bags.segments[0].left, left, 'build: an engineer called away stops building'); }
    // 士氣：每一步開始前把工兵的壓制重設成固定值（壓制每 4 步自己退 1）
    const morale = sup => run(1, (w, es, each) => { if (!each) w.rules = { morale: 1 }; es[0].sup = sup; });
    const shaken = morale(SUP_SHAKEN + 5), pinned = morale(SUP_PINNED + 5);
    assert(Math.abs(shaken.steps - 2 * W) <= 4, `build: shaken, it builds every other step (${shaken.steps} ≈ ${2 * W})`);
    assert(Math.abs(pinned.steps - 4 * W) <= 4, `build: pinned, every fourth step (${pinned.steps} ≈ ${4 * W})`);
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16); w.rules = { morale: 1 };
      step(w, [C(ME, [e.id], 18, 16)]); const left = w.bags.segments[0].left;
      for (let i = 0; i < 100; i++) { e.sup = SUP_BROKEN + 5; step(w, []); }
      assert.equal(w.bags.segments[0].left, left, 'build: a broken engineer does not build'); }
    // 停火：工兵收不到停火指令（R081／R091 的資格：有人數、沒有 hold），照樣堆——卡面施工紀錄
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16);
      step(w, [C(ME, [e.id], 18, 16), { t: 'fireDiscipline', side: ME, ids: [e.id], hold: true }]);
      assert.equal(e.holdFire, undefined, 'build: an engineer cannot be told to hold fire');
      for (let i = 0; i < 50; i++) step(w, []);
      assert(w.bags.segments[0].left < W - 40, 'build: so it keeps building'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16);
      step(w, [C(ME, [e.id], 18, 16)]); for (let i = 0; i < 20; i++) step(w, []);
      w.bags.segments[0].hp = 0; step(w, []);
      assert.deepEqual([e.order, e.path.length], [ORD_IDLE, 0], 'build: the site scattered, the engineer goes idle'); }
  },
  // 驗收 6：掩護
  cover() {
    const KIND = { ap: [UK_TANK, SHELL_AP], small: [UK_INFANTRY, SHELL_SMALL], he: [UK_HOWITZER, SHELL_HE], flame: [UK_FLAME, SHELL_SMALL] };
    const hit = (kind, side, how, setup) => {
      const w = camp(), t = put(w, side, kind, 16, 16, false); t.hp = 100000;
      setup?.(w);
      const [sk, sh] = KIND[how], off = how === 'he' ? 64 : 0;
      shell(w, sk, sh, t.x + off, t.z, how === 'he' ? 0 : t.id, 1 - side);
      const cp = coverPct(w, t); step(w, []);
      return { loss: 100000 - t.hp, cp, w };
    };
    const at16 = w => cellIdx(w, 16, 16);
    const SET = {
      plain: null, hedge: w => { w.vegetation.cells[at16(w)] = 1; }, crater: w => { w.crater[at16(w)] = 1; },
      built: w => bag(w, ME, 16, 16), foes: w => bag(w, FOE, 16, 16), site: w => bag(w, ME, 16, 16, 60, 80), scattered: w => bag(w, ME, 16, 16, 0, 0),
      craterBag: w => { w.crater[at16(w)] = 1; bag(w, ME, 16, 16); },
    };
    let n = 0;
    for (let kind = 0; kind < UNIT_KINDS.length; kind++) for (const side of [ME, FOE]) for (const how of ['ap', 'small', 'he']) {
      const r = Object.fromEntries(Object.entries(SET).map(([name, s]) => [name, hit(kind, side, how, s)]));
      if (r.plain.loss <= 0) continue;   // 這一種打不傷它（例如步槍打坦克），比不出來
      n++;
      const tag = `kind ${kind} (${UNIT_KINDS[kind].name}), side ${side}, ${how}`;
      if (nonArmored(kind)) {
        assert.deepEqual([r.built.loss, r.foes.loss, r.craterBag.loss, r.built.cp, r.craterBag.cp], [r.hedge.loss, r.hedge.loss, r.hedge.loss, 50, 50], `cover: ${tag} — in a finished sandbag (either side's, on a crater too) it takes what it takes in a hedge (cover 50, not stacked)`);
        if (UNIT_KINDS[kind].armor === 100) assert.equal(r.built.loss, Math.floor((r.plain.loss * 100 * r.built.cp) / 10000), `cover: ${tag} — coverPct matches the hit points it lost`);
      } else assert.deepEqual([r.built.loss, r.craterBag.loss, r.built.cp, r.craterBag.cp], [r.plain.loss, r.crater.loss, 100, 75], `cover: ${tag} — armour, trucks and half-tracks get nothing from a sandbag`);
      assert.deepEqual([r.site.loss, r.scattered.loss, r.site.cp, r.scattered.cp], [r.plain.loss, r.plain.loss, 100, 100], `cover: ${tag} — a site or a scattered sandbag gives no cover`);
    }
    assert(n >= 150, `cover: fixture — enough cases compared (${n})`); console.log(`cover: ${n} kind × side × shell cases compared`);
    for (const kind of [UK_INFANTRY, UK_ENGINEER, UK_HOWITZER]) {
      const plain = hit(kind, ME, 'flame'), inBag = hit(kind, ME, 'flame', SET.built);
      assert(plain.loss > 0 && inBag.loss === plain.loss, `cover: the flamethrower burns kind ${kind} in a sandbag as in the open (${plain.loss}, ${inBag.loss})`);
    }
    { const run = withBag => { const w = camp(), b = bld(w, BK_HOUSE, 16, 16), u = put(w, ME, UK_INFANTRY, 16, 16, false); if (withBag) bag(w, ME, 16, 16); b.hp = 1; u.hp = 1000;
        shell(w, UK_TANK, SHELL_AP, center(16), center(16)); w.shells[0].hitBld = b.id; step(w, []); return 1000 - u.hp; };
      assert.deepEqual([run(false), run(true)], [20, 20], 'cover: a house falling in still does 20 (a sandbag forced into the same cell does not soften it)'); }
    { const w = camp(), u = put(w, ME, UK_INFANTRY, 16, 16, false), v = put(w, ME, UK_INFANTRY, 18, 16, false); bag(w, ME, 16, 16); w.rules = { morale: 1 };
      suppress(w, u, SUP_SMALL); suppress(w, v, SUP_SMALL);
      assert.deepEqual([supPct(50), u.sup, v.sup], [70, Math.floor((SUP_SMALL * 70) / 100), SUP_SMALL], 'cover: suppression in a sandbag is seven tenths (supPct(50))'); }
    { const r = hit(UK_INFANTRY, ME, 'he', w => bag(w, ME, 16, 16, 1, 0)), h = hit(UK_INFANTRY, ME, 'he', SET.hedge);
      assert.deepEqual([r.w.bags.segments[0].hp, r.loss], [0, h.loss], 'cover: the shell that scatters the sandbag still finds the men behind it'); }
    for (const [m, routs] of [[1, false], [2, true]]) for (const withBag of [false, true]) {
      const w = camp(), u = put(w, ME, UK_INFANTRY, 16, 16, false); w.rules = { morale: m }; if (withBag) bag(w, ME, 16, 16);
      u.sup = SUP_BROKEN - 1; suppress(w, u, SUP_SMALL);
      assert.equal(u.rout === 1, withBag ? routs : true, `cover: morale ${m}, ${withBag ? 'in a sandbag' : 'in the open'} — a broken squad ${withBag && !routs ? 'stays' : 'runs'}`);
    }
  },
  // 驗收 7：高爆打散
  blast() {
    const R = UNIT_KINDS[UK_HOWITZER].splash, dmg = UNIT_KINDS[UK_HOWITZER].dmgBld;
    const one = (shooter, kind, dx, s0 = { hp: BAG1007.hp, left: 0 }, dz = 0) => { const w = camp(), s = bag(w, ME, 16, 16, s0.hp, s0.left); shell(w, shooter, kind, center(16) + dx, center(16) + dz); step(w, []); return { s, ev: wires(w) }; };
    { const { s, ev } = one(UK_HOWITZER, SHELL_HE, R + HALF); assert.deepEqual([s.hp, ev], [BAG1007.hp - dmg, 1], 'blast: a howitzer shell R + HALF from the centre takes 60 (and it now looks damaged: one wire event)'); }
    { const { s, ev } = one(UK_HOWITZER, SHELL_HE, R + HALF + 1); assert.deepEqual([s.hp, ev], [BAG1007.hp, 0], 'blast: one unit further out, nothing'); }
    { const { s, ev } = one(UK_HOWITZER, SHELL_HE, 0, { hp: 60, left: 0 }); assert.deepEqual([s.hp, look1007(s), ev], [0, 0, 1], 'blast: two near shells scatter it'); }
    { const { s, ev } = one(UK_MORTAR, SHELL_HE, 0); assert.deepEqual([s.hp, ev], [BAG1007.hp - UNIT_KINDS[UK_MORTAR].dmgBld, 0], 'blast: a mortar takes 12 — 120 → 108 looks the same, no wire event'); }
    { const { s, ev } = one(null, SHELL_HE, 0); assert.deepEqual([s.hp, ev, BOMB93.dmgBld >= BAG1007.hp], [0, 1, true], 'blast: one bomb scatters it'); }
    { const { s, ev } = one(UK_HOWITZER, SHELL_HE, 0, { hp: 1, left: 100 }); assert.deepEqual([s.hp, ev], [0, 1], 'blast: a site is scattered too'); }
    for (const [what, shooter, kind] of [['AP', UK_TANK, SHELL_AP], ['rifle', UK_INFANTRY, SHELL_SMALL], ['machine gun', 41, SHELL_SMALL], ['flame', UK_FLAME, SHELL_SMALL], ['smoke', UK_HOWITZER, SHELL_SMOKE]]) {
      const { s, ev } = one(shooter, kind, 0);
      assert.deepEqual([s.hp, ev], [BAG1007.hp, 0], `blast: ${what} landing on it does nothing`);
    }
  },
  // 驗收 8：爆破
  demo() {
    const need = UNIT_KINDS[UK_ENGINEER].demo;
    { const w = camp(), s = bag(w, ME, 16, 16), f = put(w, FOE, UK_ENGINEER, 14, 16);
      step(w, [{ t: 'fireAt', side: FOE, ids: [f.id], x: 16, z: 16 }]); let n = 1, arrived = 0;
      while (s.hp > 0 && n < 1000) { step(w, []); n++; if (!arrived && near(f, 16, 16) <= 1 && f.pathIdx >= f.path.length) arrived = n; }
      assert(s.hp === 0 && n >= need && wires(w) === 1 && w.events.some(e => e.e === 'impact' && e.r === DEMO_BLAST), `demo: an enemy engineer walks up and scatters our sandbag with one charge (${n} steps, arrived ${arrived}; a wire and a small blast event)`); }
    { const w = camp(), s = bag(w, ME, 16, 16), f = put(w, FOE, UK_ENGINEER, 17, 16);
      step(w, [{ t: 'fireAt', side: FOE, ids: [f.id], x: 16, z: 16 }]); let n = 1; while (s.hp > 0 && n < 1000) { step(w, []); n++; }
      assert.equal(n, need, 'demo: an enemy engineer already beside it scatters it on step 120 (one charge)'); }
    { const w = camp(), s = bag(w, ME, 16, 16), e = put(w, ME, UK_ENGINEER, 17, 16); e.cooldown = 7;
      const before = JSON.stringify([e.order, e.tx, e.tz, e.target, e.cooldown, e.path, e.pathIdx]);
      applyCommand(w, { t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 });
      assert.equal(JSON.stringify([e.order, e.tx, e.tz, e.target, e.cooldown, e.path, e.pathIdx]), before, 'demo: our engineer told to fire at our finished sandbag takes no order (no charge, no countdown, no path)');
      for (let i = 0; i < need + 20; i++) step(w, []); assert.equal(s.hp, BAG1007.hp, 'demo: and our sandbag stands'); }
    { const w = camp(), s = bag(w, ME, 16, 16, 1, BAG1007.work), e = put(w, ME, UK_ENGINEER, 17, 16);
      step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }]);
      assert.deepEqual([e.order, s.left], [ORD_FIRE_AT, BAG1007.work - 1], 'demo: our engineer told to fire at our own site builds it'); }
    { const w = camp(), s = bag(w, ME, 16, 16, 1, BAG1007.work), f = put(w, FOE, UK_ENGINEER, 17, 16);
      step(w, [{ t: 'fireAt', side: FOE, ids: [f.id], x: 16, z: 16 }]); let n = 1; while (s.hp > 0 && n < 1000) { step(w, []); n++; }
      assert.deepEqual([s.hp, s.left, n], [0, BAG1007.work, need], 'demo: an enemy engineer blows up our site instead of helping'); }
    { const w = camp(), s = bag(w, ME, 16, 16), f = put(w, FOE, UK_ENGINEER, 17, 16); w.rules = { morale: 1 };
      f.sup = SUP_PINNED + 5; step(w, [{ t: 'fireAt', side: FOE, ids: [f.id], x: 16, z: 16 }]); let n = 1;
      while (s.hp > 0 && n < 3000) { f.sup = SUP_PINNED + 5; step(w, []); n++; }
      assert(Math.abs(n - 4 * need) <= 4, `demo: a pinned engineer counts down four times slower (${n} ≈ ${4 * need}; R1002 rule)`); }
    // 審查（R1007 第 2 條）：我方工兵正在堆我方的工地，這一處被敵方工兵炸掉、或被一發迫擊砲打散；下一步敵方在同一格重堆（同一筆換成敵方的）。
    // 我方工兵還拿著打那一格的指令：要從頭倒數 120 步才炸（卡面 3.5），不是在敵方放下的那一步就炸
    for (const how of ['charge', 'shell']) {
      const w = camp(), mine = put(w, ME, UK_ENGINEER, 10, 12), foe = put(w, FOE, UK_ENGINEER, 12, 12, how === 'charge');
      step(w, [C(ME, [mine.id], 11, 12)]); const s = w.bags.segments[0];
      if (how === 'charge') { step(w, [{ t: 'fireAt', side: FOE, ids: [foe.id], x: 11, z: 12 }]); let k = 0; while (s.hp > 0 && k < 1000) { step(w, []); k++; } }
      else { for (let i = 0; i < 9; i++) step(w, []); shell(w, UK_MORTAR, SHELL_HE, center(11), center(12)); step(w, []); }
      assert.deepEqual([s.hp, s.builtBy, mine.alive, mine.order, mine.tx, mine.tz], [0, ME, true, ORD_FIRE_AT, 11, 12], `demo: fixture (${how}) — our site is gone while our engineer still holds the order on that cell`);
      const paid = w.eco.supply[FOE];
      step(w, [C(FOE, [foe.id], 11, 12)]); let n = 1;
      assert.deepEqual([s.builtBy, paid - w.eco.supply[FOE]], [FOE, BAG1007.cost], `demo: fixture (${how}) — the enemy restacks on the same cell (the record flips to the enemy)`);
      while (s.hp > 0 && n < 1000) { step(w, []); n++; }
      assert.equal(n, need, `demo: after an owner flip (${how}) our engineer counts a full charge down (${n} steps, ${need} wanted), not a blast the step the enemy placed it`);
    }
  },
  // 驗收 9：不擋任何東西
  pass() {
    const mk = withBags => {
      const w = createWorld(11); step(w, [{ t: 'map', id: 1, vegetation: 1 }]);
      const freeCells = []; for (let z = 4; z < w.n - 4; z++) for (let x = 4; x < w.n - 4; x++) { const i = cellIdx(w, x, z); if (!w.occ[i] && !w.vegetation?.cells[i] && w.ter[i] !== TER_MUD) freeCells.push([x, z]); }
      return { w, freeCells };
    };
    const a = mk(false), b = mk(true), cells = a.freeCells.filter((_, i) => i % 37 === 5).slice(0, 6);
    assert(cells.length === 6, 'pass: fixture — six free cells');
    const [c1, c2, c3] = cells;
    b.w.bags = { version: 1, segments: [] }; bag(b.w, ME, ...c1); bag(b.w, FOE, ...c2, 1, 150); bag(b.w, ME, ...c3, 0, 0);
    for (const { w } of [a, b]) { put(w, ME, UK_INFANTRY, ...cells[3], false); put(w, FOE, UK_INFANTRY, ...cells[4], false); put(w, ME, UK_ENGINEER, ...cells[5], false); }
    const n = a.w.n;
    for (let kind = 0; kind < UNIT_KINDS.length; kind++) for (const [p, q] of [[cells[3], c1], [c1, c2], [cells[5], c3], [c3, cells[4]]]) {
      assert.deepEqual(findPath(b.w, ...p, ...q, 0, 0, kind), findPath(a.w, ...p, ...q, 0, 0, kind), `pass: kind ${kind}: the path ${p} → ${q} is the same with sandbags`);
    }
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      assert.equal(blocks(b.w, x, z), blocks(a.w, x, z), `pass: blocks(${x},${z})`);
      assert.equal(speedPct(b.w, x, z), speedPct(a.w, x, z), `pass: speedPct(${x},${z})`);
      for (let kind = 0; kind < UNIT_KINDS.length; kind++) assert.equal(wireBlocks(b.w, x, z, kind), wireBlocks(a.w, x, z, kind), `pass: wireBlocks(${x},${z}) for kind ${kind}`);
    }
    for (const p of cells) for (const q of cells) assert.equal(firstBlock(b.w, center(p[0]), center(p[1]), center(q[0]), center(q[1])), firstBlock(a.w, center(p[0]), center(p[1]), center(q[0]), center(q[1])), `pass: firstBlock ${p} → ${q}`);
    for (const side of [ME, FOE]) for (const p of cells) assert.equal(spotted(b.w, side, center(p[0]), center(p[1])), spotted(a.w, side, center(p[0]), center(p[1])), `pass: spotted by side ${side} at ${p}`);
    for (const { w } of [a, b]) { for (let i = 0; i < 5; i++) put(w, ME, [UK_INFANTRY, UK_TANK, UK_ENGINEER, UK_TRUCK, 41][i], ...cells[3], false); step(w, [{ t: 'move', side: ME, ids: w.units.filter(u => u.side === ME).map(u => u.id), x: c1[0], z: c1[1] }]); }
    assert.deepEqual(b.w.units.map(u => [u.tx, u.tz, u.path]), a.w.units.map(u => [u.tx, u.tz, u.path]), 'pass: a multi-select move onto a sandbag forms up the same way');
  },
  // 驗收 10：R050 的工地與沙包互不相疊
  r050() {
    for (const [what, hp] of [['finished', BAG1007.hp], ['scattered', 0]]) {
      const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 20); bag(w, ME, 19, 25, hp);
      assert.equal(why50(w, ME, BK_BARRACKS, at(18, 24, [e.id])), '擋到了', `r050: a ${what} sandbag inside the 2×2 blocks a barracks`);
    }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 20); bag(w, ME, 20, 24); bag(w, FOE, 17, 26);
      assert.equal(why50(w, ME, BK_BARRACKS, at(18, 24, [e.id])), '', 'r050: sandbags in the ring around it are fine'); }
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 20); step(w, [{ t: 'construct', side: ME, ids: [e.id], kind: BK_BARRACKS, x: 18, z: 24 }]);
      assert.equal(w.tech?.sites.length, 1, 'r050: fixture — a barracks site');
      assert.equal(why1007(w, ME, BK_SANDBAG, at(19, 25, [e.id])), '擋到了', 'r050: no sandbag inside a building site');
      w.blds.at(-1).hp = w.blds.at(-1).maxHp; w.tech.sites = [];
      assert.equal(why1007(w, ME, BK_SANDBAG, at(18, 24, [e.id])), '擋到了', 'r050: nor inside a finished barracks'); }
  },
  // 驗收 11：偽造的指令
  forged() {
    const state = (w, side) => JSON.stringify([w.eco.supply[side], w.units.filter(u => u.side === side), (w.bags?.segments ?? []).filter(s => s.builtBy === side)]);
    const fresh = () => { const w = camp(); const e = put(w, ME, UK_ENGINEER, 16, 16), f = put(w, FOE, UK_ENGINEER, 4, 16); bag(w, FOE, 14, 18); bag(w, ME, 14, 16); return { w, e, f }; };   // 兩個工兵互相打不到（不然瞄準的方向會跟著對方走）
    // 跟沒送這一條的同一步比（補給每一步照樣漲）：另一方一個位元都不變；unchanged＝整個世界都跟沒送一樣
    const check = (what, cmd, other, setup, unchanged = false) => {
      const { w, e, f } = fresh(), ref = fresh(); setup?.(w, e, f); setup?.(ref.w, ref.e, ref.f);
      const c = typeof cmd === 'function' ? cmd(e, f) : cmd;
      assert.doesNotThrow(() => step(w, [c]), `forged: ${what} does not throw`);
      step(ref.w, []);
      assert.equal(state(w, other), state(ref.w, other), `forged: ${what} — the other side's supply, units and sandbags are bit for bit the same`);
      if (unchanged) assert.equal(hashWorld(w), hashWorld(ref.w), `forged: ${what} — the world is the same as if it was never sent`);
    };
    // 我方送的、想動到敵方
    for (const [what, cmd, unchanged] of [
      ['side 2', e => C(2, [e.id], 17, 16), true], ['side −1', e => C(-1, [e.id], 17, 16), true],
      ['the enemy\'s engineer', (e, f) => C(ME, [f.id], 17, 17), true], ['ids a number', () => ({ ...C(ME, [], 17, 16), ids: 5 }), true], ['ids a string', () => ({ ...C(ME, [], 17, 16), ids: 'x' }), true],
      ['ids an object', () => ({ ...C(ME, [], 17, 16), ids: { 0: 1 } }), true], ['ids with 0', () => C(ME, [0], 17, 16), true], ['a negative id', () => C(ME, [-1], 17, 16), true], ['id 1e12', () => C(ME, [1e12], 17, 16), true],
      ['a repeated id', e => C(ME, [e.id, e.id, e.id], 17, 16), false], ['x NaN', e => C(ME, [e.id], NaN, 16), true], ['x −5', e => C(ME, [e.id], -5, 16), true], ['x 1e9', e => C(ME, [e.id], 1e9, 16), true],
      ['fireAt our sandbag with the enemy\'s engineer', (e, f) => ({ t: 'fireAt', side: ME, ids: [f.id], x: 14, z: 16 }), true],
    ]) check(`side 0 sends ${what}`, cmd, FOE, null, unchanged);
    for (const [what, setup] of [['a dead engineer', (w, e) => { e.alive = false; }], ['an engineer in a truck', (w, e) => { e.ride = put(w, ME, UK_TRUCK, 3, 30, false).id; }], ['a routed engineer', (w, e) => { e.rout = 1; e.sup = 95; }]]) {
      const { w, e } = fresh(); setup(w, e); const n = w.bags.segments.length, s = w.eco.supply[ME];
      assert.doesNotThrow(() => applyCommand(w, C(ME, [e.id], 17, 16)), `forged: ${what} does not throw`);
      assert.deepEqual([w.bags.segments.length, w.eco.supply[ME]], [n, s], `forged: ${what} cannot build`);
    }
    // 敵方送的、想用我方的工兵與補給
    check('side 1 sends our engineer', (e) => C(FOE, [e.id], 17, 16), ME, null, true);
    check('side 1 sends fireAt on its own sandbag with our engineer', (e) => ({ t: 'fireAt', side: FOE, ids: [e.id], x: 14, z: 18 }), ME, null, true);
    // 這一局沒有 bag／只有 tech（R050 局）：整個世界雜湊跟送之前一樣
    check('kind 17 without bag (an R050 game)', e => C(ME, [e.id], 17, 16), FOE, w => { delete w.eco.bag; }, true);
    check('kind 17 without tech or bag', e => C(ME, [e.id], 17, 16), FOE, w => { delete w.eco.bag; delete w.eco.tech; }, true);
    // 17.5、'17' 不過指令檢查；直接塞給 step() 跟 17 一樣（同 construct50 的 | 0）
    for (const k of [17.5, '17']) assert.equal(isCommand(C(ME, [1], 17, 16, k)), false, `forged: the command check refuses kind ${JSON.stringify(k)}`);
    const via = k => { const { w, e } = fresh(); step(w, [C(ME, [e.id], 17, 16, k)]); return hashWorld(w); };
    assert.deepEqual([via(17.5), via('17')], [via(17), via(17)], 'forged: straight into step(), kind 17.5 and \'17\' do what 17 does');
  },
  // 驗收 12：電腦不受影響
  quiet() {
    for (const [map, seed, levels] of [[1, 32, [3, 2]], [0, 31, [1, 3]]]) {
      const ais = [{ t: 'ai', side: 0, level: levels[0], v: 3 }, { t: 'ai', side: 1, level: levels[1], v: 3 }];
      const a = createWorld(seed), b = createWorld(seed);
      step(a, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, tech: 1 }), ...ais]); step(b, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, tech: 1, bag: 1 }), ...ais]);
      assert.equal(b.eco.bag, 1, 'quiet: the second game has bag');
      while (a.tick < 3000 && a.winner < 0) {
        step(a, []); step(b, []);
        if (a.tick % 100 === 0) { const c = structuredClone(b); delete c.eco.bag; assert.equal(hashWorld(c), hashWorld(a), `quiet: map ${map}, AI ${levels} — at tick ${a.tick} the game with bag is the game without it`); }
      }
      assert.deepEqual([b.bags, b.winner, b.tick], [undefined, a.winner, a.tick], `quiet: map ${map}: no sandbag, same winner, same length (${a.tick} ticks)`);
    }
  },
  // 驗收 13：存檔
  codec() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 16), f = put(w, FOE, UK_ENGINEER, 10, 8);
    step(w, [C(ME, [e.id], 18, 16), C(FOE, [f.id], 10, 10)]); bag(w, ME, 20, 16); bag(w, FOE, 22, 16, 50); bag(w, ME, 24, 16, 0, 0);
    for (let i = 0; i < 60; i++) step(w, []);
    const g = w.bags.segments; assert.deepEqual(g.map(look1007), [1, 1, 3, 2, 0], 'codec: fixture — two sites, one finished, one damaged, one scattered');
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert(back && hashWorld(back) === hashWorld(w), 'codec: the world reads back to the same hash');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); assert.equal(hashWorld(back), hashWorld(w), `codec: step ${i + 1} after loading equals the uninterrupted run`); }
    const raw = JSON.parse(JSON.stringify(encodeWorld(w))), { bag: _bag, ...noBag } = raw.eco, { tech: _tech, ...noTech } = raw.eco; void _bag; void _tech;
    const seg = (i, patch) => { const r = JSON.parse(JSON.stringify(raw)); Object.assign(r.bags.segments[i], patch); return r; };
    const nine = (() => { const r = JSON.parse(JSON.stringify(raw)); r.bags.segments = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, kind: 17, x: i, z: 30, w: 1, d: 1, floors: 1, hp: 120, maxHp: 120, builtBy: 0, left: 0 })); return r; })();
    const many = (() => { const r = JSON.parse(JSON.stringify(raw)); r.bags.segments = Array.from({ length: 17 }, (_, i) => ({ id: i + 1, kind: 17, x: i, z: 30, w: 1, d: 1, floors: 1, hp: 0, maxHp: 120, builtBy: i % 2, left: 0 })); return r; })();
    const blds17 = withBag => { const r = JSON.parse(JSON.stringify(withBag ? raw : { ...raw, eco: noBag, bags: undefined })); if (!withBag) delete r.bags; r.blds.push({ id: r.blds.length + 1, kind: 17, x: 1, z: 1, w: 1, d: 1, floors: 1, hp: 120, maxHp: 120 }); return r; };
    assert(decodeWorld(raw), 'codec: fixture — the raw save reads');
    const bad = [
      ['bag 2', { ...raw, eco: { ...raw.eco, bag: 2 } }], ['bag 1 without tech', { ...raw, eco: noTech }], ['no bag but a sandbag list', { ...raw, eco: noBag }],
      ['bags a number', { ...raw, bags: 5 }], ['bags null', { ...raw, bags: null }], ['version 2', { ...raw, bags: { ...raw.bags, version: 2 } }], ['segments not a list', { ...raw, bags: { version: 1, segments: {} } }],
      ['17 entries', many], ['a non-integer field', seg(0, { hp: 1.5 })], ['a missing field', seg(0, { left: undefined })], ['id not its position', seg(1, { id: 1 })], ['kind 16', seg(0, { kind: 16 })],
      ['w 2', seg(0, { w: 2 })], ['d 2', seg(0, { d: 2 })], ['floors 2', seg(0, { floors: 2 })], ['maxHp 121', seg(0, { maxHp: 121 })], ['hp −1', seg(0, { hp: -1 })], ['hp 121', seg(0, { hp: 121 })],
      ['left −1', seg(0, { left: -1 })], ['left 201', seg(0, { left: 201 })], ['builtBy 2', seg(0, { builtBy: 2 })], ['x −1', seg(0, { x: -1 })], ['x off the map', seg(0, { x: raw.n })], ['z off the map', seg(0, { z: raw.n })],
      ['two in one cell', seg(1, { x: g[0].x, z: g[0].z })], ['nine standing on one side', nine], ['a kind 17 building (with bag)', blds17(true)], ['a kind 17 building (without bag)', blds17(false)],
    ];
    for (const [what, r] of bad) { let out; assert.doesNotThrow(() => { out = decodeWorld(JSON.parse(JSON.stringify(r))); }, `codec: ${what} does not throw`); assert.equal(out, null, `codec: refused — ${what}`); }
  },
  // 驗收 14：重播（從夾具的世界開始的一份指令紀錄：堆 3 處、人站進去被打、敵方工兵炸 1 處、榴彈砲打散 1 處、在被炸的那格重堆）
  replay() {
    const start = () => {
      const w = camp(); w.eco.supply = [200, 200];
      put(w, ME, UK_ENGINEER, 13, 14, false); put(w, ME, UK_ENGINEER, 15, 14, false); put(w, ME, UK_INFANTRY, 14, 18, false);   // 我方不開槍（只看沙包）
      put(w, FOE, UK_INFANTRY, 2, 14); put(w, FOE, UK_ENGINEER, 18, 6); put(w, FOE, UK_HOWITZER, 22, 2).cooldown = 600;   // 敵方的砲第 600 步才裝填好
      return w;
    };
    const log = [
      { tick: 0, cmd: C(ME, [1], 14, 12) }, { tick: 0, cmd: C(ME, [2], 16, 12) },
      { tick: 240, cmd: { t: 'move', side: ME, ids: [3], x: 14, z: 12 } }, { tick: 260, cmd: C(ME, [1, 2], 18, 12) },
      { tick: 300, cmd: { t: 'fireAt', side: FOE, ids: [5], x: 16, z: 12 } }, { tick: 420, cmd: { t: 'move', side: FOE, ids: [4], x: 10, z: 8 } },
      { tick: 560, cmd: { t: 'move', side: ME, ids: [1, 2], x: 12, z: 15 } }, { tick: 600, cmd: { t: 'fireAt', side: FOE, ids: [6], x: 18, z: 12 } },
      { tick: 1300, cmd: C(ME, [1], 16, 12) },
    ];
    const END = 1600;
    assert.equal(checkLog(log), null, 'replay: the log passes checkLog');
    const probe = start(), seen = { built: 0, hurtInBag: false, blown: false, shelled: false, rebuilt: false };
    for (let t = 0; t < END; t++) {
      const before = (probe.bags?.segments ?? []).map(b => b.hp), inf = probe.units[2], hp = inf.hp;
      step(probe, log.filter(l => l.tick === t).map(l => l.cmd));
      const g = probe.bags?.segments ?? [], at14 = g.find(b => b.x === 14 && b.z === 12);
      seen.built = Math.max(seen.built, g.filter(b => b.left === 0 && b.hp > 0).length);
      if (inf.hp < hp && at14 && at14.left === 0 && at14.hp > 0 && cellOf(inf.x) === 14 && cellOf(inf.z) === 12) seen.hurtInBag = true;
      g.forEach((b, k) => { if ((before[k] ?? 0) > 0 && b.hp === 0) { if (b.x === 16 && probe.events.some(e => e.r === DEMO_BLAST)) seen.blown = true; if (b.x === 18) seen.shelled = true; } });
      if (t === 1300) { const b = g.find(b => b.x === 16 && b.z === 12); seen.rebuilt = !!b && b.id === 2 && b.builtBy === ME && b.hp > 0 && b.left > 0; }
    }
    assert(seen.built >= 3 && seen.hurtInBag && seen.blown && seen.shelled && seen.rebuilt, `replay: fixture — three built, men hit inside one, one blown by the enemy engineer, one scattered by the howitzer, rebuilt where it was blown (${JSON.stringify(seen)})`);
    const w = runLog(start(), log, END);
    assert.equal(hashWorld(w), hashWorld(probe), 'replay: runLog replays the log to the same hash as stepping it by hand');
    assert.equal(hashWorld(runLog(start(), log, END)), hashWorld(w), 'replay: the same log replays to the same hash');
    const half = runLog(start(), log, 300), back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(half))));
    assert.equal(hashWorld(runLog(back, log.filter(l => l.tick >= 300), END)), hashWorld(w), 'replay: saved at 300 and replayed on, the hash is the same');
    const clone = structuredClone(runLog(start(), log, 300));
    assert.equal(hashWorld(runLog(clone, log.filter(l => l.tick >= 300), END)), hashWorld(w), 'replay: a structuredClone at 300 run on is the same');
  },
  // 驗收 15：沒有 bag 的局逐位不變
  hash() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'hash: the golden script battle is unchanged');
    const now = {};
    for (const tech of [1, 0]) for (const map of [0, 1]) for (const real of [false, true]) {
      const w = createWorld(31 + map), hs = [];
      step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(tech ? { sw: 2, tech: 1 } : { sw: 2 }), ...(real ? [{ t: 'rules', ap: 1, morale: 2 }] : []), { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }]);
      while (w.tick < 3000 && w.winner < 0) { step(w, []); if (w.tick % 500 === 0) hs.push(hashWorld(w)); }
      now[`${tech ? 'tech' : 'sw2'} ${map}/${real ? 'real' : 'classic'}`] = hs;
    }
    assert.deepEqual(now, PINNED_TECH, 'hash: four battles with tech and no bag, and four with sw 2 and no tech, are bit for bit what they were before this card (every 500 steps)');
  },
  // 驗收 16：介面路由
  route() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 16, 16), inf = put(w, ME, UK_INFANTRY, 16, 17), how = put(w, ME, UK_HOWITZER, 4, 28), foe = put(w, FOE, UK_INFANTRY, 22, 16);
    const tap = (x, z, sel, opt = {}) => routeBattleOrder(w, sel, !!opt.fire, 'he', { unit: opt.unit ?? 0, building: null, ground: { x: x + 0.5, z: z + 0.5 } });
    hint50(w); arm50(0);
    assert.deepEqual(tap(18, 16, [e.id])?.commands, [{ t: 'move', side: ME, ids: [e.id], x: 18, z: 16 }], 'route: not armed, a tap is a move as before');
    assert.deepEqual([pick50(BAG_ITEM), armed50()], [true, BK_SANDBAG], 'route: the 沙包 key arms the sandbag');
    assert.match(hint50(w), /^建造沙包：先選工兵，再點工兵 7 格內要堆的那一格/, 'route: the hint says how to place a sandbag');
    assert.equal(tap(18, 16, [inf.id]), null, 'route: without an engineer nothing is sent');
    assert.match(hint50(w), /放不下：先選工兵/, 'route: the hint says to pick an engineer');
    w.ter[cellIdx(w, 19, 16)] = TER_MUD;
    assert.equal(tap(19, 16, [e.id]), null, 'route: on mud nothing is sent');
    assert.match(hint50(w), /放不下：不能堆在泥灘上/, 'route: the hint says why');
    assert.equal(armed50(), BK_SANDBAG, 'route: still armed after a refusal');
    const sent = tap(18, 16, [e.id, inf.id]);
    assert.deepEqual([sent?.commands, sent?.marker], [[C(ME, [e.id], 18, 16)], { x: 18.5, z: 16.5, hostile: false }], 'route: a tap with an engineer sends construct kind 17 for the engineer only, marker in the cell centre');
    assert.equal(armed50(), 0, 'route: sent, disarmed');
    pick50(BAG_ITEM); pick50(BAG_ITEM); assert.equal(armed50(), 0, 'route: the same key again disarms');
    bag(w, FOE, 20, 16); bag(w, FOE, 20, 18, 1, 100); bag(w, ME, 14, 16); applyCommand(w, C(ME, [e.id], 14, 18));
    const split = (x, z) => [{ t: 'fireAt', side: ME, ids: [e.id], x, z }, { t: 'move', side: ME, ids: [inf.id], x, z }];
    assert.deepEqual(tap(20, 16, [e.id, inf.id])?.commands, split(20, 16), 'route: a tap on the enemy\'s sandbag sends the engineer to blow it, the rest walk over');
    assert.deepEqual(tap(20, 18, [e.id, inf.id])?.commands, split(20, 18), 'route: the enemy\'s site too');
    assert.deepEqual(tap(14, 18, [e.id, inf.id])?.commands, split(14, 18), 'route: a tap on our own site sends the engineer to help build it');
    assert.deepEqual(tap(14, 16, [e.id, inf.id])?.commands, [{ t: 'move', side: ME, ids: [e.id, inf.id], x: 14, z: 16 }], 'route: a tap on our finished sandbag moves everyone in');
    assert.deepEqual(tap(20, 16, [inf.id])?.commands, [{ t: 'move', side: ME, ids: [inf.id], x: 20, z: 16 }], 'route: without an engineer, the enemy\'s sandbag is just a move');
    assert.deepEqual(tap(20, 16, [how.id, e.id], { fire: true })?.commands, [{ t: 'fireAt', side: ME, ids: [how.id], x: 20, z: 16 }], 'route: fire mode with a gun selected shells the sandbag');
    foe.x = center(20); foe.z = center(16);
    assert.deepEqual(tap(20, 16, [e.id, inf.id], { unit: foe.id })?.commands, [{ t: 'attack', side: ME, ids: [e.id, inf.id], target: foe.id }], 'route: a tap on an enemy standing in his sandbag is an attack as before');
  },
  // 審查（R1007 第 1 條）：main.ts 真的 tap()（從原始碼拿出來在 vm 裡跑，pickUnit 點到誰由夾具決定）：沙包選好、選著工兵時，點到自己的人（含工兵自己那一格）
  // 交給 order（在點的那一格堆），選取不變；沒選工兵（先按沙包再點工兵）、Shift 加選、選好的是 R050 那三種、沒選好：照舊選人
  tap() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 16, 16), inf = put(w, ME, UK_INFANTRY, 18, 16), e2 = put(w, ME, UK_ENGINEER, 15, 18);
    const plain = stripTypeScriptTypes(src('src/main.ts')), a = plain.indexOf('function tap('), b = plain.indexOf('\n}\n', a);
    assert(a >= 0 && b > a, 'tap: fixture — main.ts has tap()');
    const run = (sel, hit, additive = false) => {
      const selected = new Set(sel), orders = [];
      const c = vm.createContext({ w, selected, sandboxTool: null, V: {}, SIDE_PLAYER: ME, lastTap: { id: 0, t: 0 }, glide: { start() {} }, view: { target: { x: 0, z: 0 } }, hud: undefined, phase: 'battle',
        performance: { now: () => 0 }, pickUnit: () => hit, order: (x, y) => orders.push([x, y]), planner: { placeAt() {} }, clearBattleHint() {}, sandboxPlaceAt() {}, bag1007Tap });
      vm.runInContext(plain.slice(a, b + 2), c);
      c.tap(100, 200, additive, 5000);
      return { selected: [...selected], orders };
    };
    const order = (unit, x, z) => routeBattleOrder(w, [e.id], false, 'he', { unit, building: null, ground: { x: x + 0.5, z: z + 0.5 } });
    hint50(w); arm50(BK_SANDBAG);
    assert.deepEqual(run([e.id], inf.id), { selected: [e.id], orders: [[100, 200]] }, 'tap: armed with an engineer selected, a tap on our own soldier goes to order (stack there), the engineer stays selected');
    assert.deepEqual(order(inf.id, 18, 16)?.commands, [C(ME, [e.id], 18, 16)], 'tap: and order sends construct kind 17 on the soldier\'s cell');
    arm50(BK_SANDBAG);
    assert.deepEqual(run([e.id], e.id), { selected: [e.id], orders: [[100, 200]] }, 'tap: a tap on the selected engineer itself goes to order too');
    assert.deepEqual(order(e.id, 16, 16)?.commands, [C(ME, [e.id], 16, 16)], 'tap: and stacks on the engineer\'s own cell');
    arm50(BK_SANDBAG);
    assert.deepEqual(run([], e.id), { selected: [e.id], orders: [] }, 'tap: armed first with nobody selected, a tap on the engineer selects it as before');
    assert.deepEqual(run([inf.id], e.id), { selected: [e.id], orders: [] }, 'tap: armed with only a soldier selected, a tap on the engineer selects it as before');
    assert.deepEqual(run([e.id], e2.id, true), { selected: [e.id, e2.id], orders: [] }, 'tap: Shift adds a unit to the selection as before');
    arm50(BK_BARRACKS);
    assert.deepEqual(run([e.id], inf.id), { selected: [inf.id], orders: [] }, 'tap: armed with an R050 building the tap still selects (a 2×2 never fits under a unit)');
    arm50(0);
    assert.deepEqual(run([e.id], inf.id), { selected: [inf.id], orders: [] }, 'tap: not armed, a tap on our own unit selects it as before');
  },
  // 審查（R1007 第 3 條）：城鎮網格畫沙包的兩處——buildTown 自己（?noR088=1、沒有快取）與 R088 快取的 wearTown——都要畫；有沙包、有網時，快取與不快取逐位一樣
  render() {
    const w = opened({ sw: 2, tech: 1, bag: 1 }), free = [];
    for (let i = 7; i < w.n * w.n && free.length < 9; i += 37) if (!w.occ[i] && w.ter[i] !== TER_MUD) free.push([i % w.n, Math.floor(i / w.n)]);
    const wm = bldMaxHp(BK_WIRE, 1, 1, 1), wire = { id: (w.wires?.segments.length ?? 0) + 1, kind: BK_WIRE, x: free[8][0], z: free[8][1], w: 1, d: 1, floors: 1, hp: wm, maxHp: wm, builtBy: ME };
    (w.wires ??= { version: 1, segments: [] }).segments.push(wire);
    const none = structuredClone(w);
    let k = 0; for (const side of [ME, FOE]) for (const [hp, left] of [[BAG1007.hp, 0], [BAG1007.hp / 2, 0], [1, BAG1007.work], [0, 0]]) { const [x, z] = free[k++]; bag(w, side, x, z, hp, left); }
    assert.deepEqual(w.bags.segments.map(look1007), [3, 2, 1, 0, 3, 2, 1, 0], 'render: fixture — intact, damaged, site and scattered on both sides');
    const per = bag1007Geo(new Geo(), w).triangles;
    assert(per > 0 && B.wireGeo(new Geo(), wire).triangles > 0, `render: fixture — the sandbags and the wire draw triangles (${per})`);
    const fp = g => { const h = createHash('sha256'); for (const v of [g.pos, g.nor, g.col]) h.update(Buffer.from(new Float32Array(v).buffer)); return h.digest('hex').slice(0, 16); };
    const prod = (wear, cache) => { B.setWalls(true); B.setWireDetail(true); B.setMaterials(true); B.setBuildingDetails(true); B.setDamageDetails(true); B.setFacades(true); B.setHouseArt(true); B.setMoreArt(true); B.setWearArt(wear); B.setWearCache(cache); };
    for (const [label, wear, cache] of [['cached, R088 on', true, true], ['wear art off, ?noR088=1', false, true], ['R088 on, not cached', true, false]]) for (const lod of [0, 1]) {
      prod(wear, cache);
      const d = B.buildTown(w, undefined, lod).triangles - B.buildTown(none, undefined, lod).triangles;
      assert.equal(d, per, `render: buildTown draws the sandbags (${label}, lod ${lod}): +${d}, ${per} wanted`);
    }
    for (const lod of [0, 1]) { prod(true, true); const c = fp(B.buildTown(w, undefined, lod)); prod(true, false); assert.equal(fp(B.buildTown(w, undefined, lod)), c, `render: with sandbags and wire the cached town equals the uncached one byte for byte (R088, lod ${lod})`); }
    prod(true, true);
  },
  // 驗收 17：介面與接線
  ui() {
    assert.deepEqual(tech50Items().map(i => i.kind), [1014, 1015, 1016], 'ui: the R050 items are still three');
    assert.deepEqual(bag1007Items().map(i => [i.kind, i.label, i.cost, i.group]), [[1017, '沙包', 10, '建造']], 'ui: one sandbag item in 建造');
    assert.equal(BAG_ITEM, ITEM50 + BK_SANDBAG, 'ui: 1017 is 1000 + 17');
    const w = camp(); put(w, ME, UK_ENGINEER, 16, 16);
    assert.equal(block50(w, BAG_ITEM), '', 'ui: the sandbag key is open');
    w.eco.supply[ME] = 0; assert.equal(block50(w, BAG_ITEM), `補給不足，還差 ${BAG1007.cost}`, 'ui: short of supply');
    w.eco.supply[ME] = 500; for (let i = 0; i < BAG1007.max; i++) bag(w, ME, i, 30); assert.equal(block50(w, BAG_ITEM), `沙包已經 ${BAG1007.max} 處`, 'ui: eight already');
    delete w.eco.bag; assert.equal(block50(w, BAG_ITEM), '本局未開放', 'ui: not in this game');
    const main = src('src/main.ts');
    assert(main.includes("import { bag1007Items } from './ui/sandbag1007.ts';"), 'ui: main.ts imports the item');
    assert(main.includes("const ecoCmd = (): Command => sw1002({ t: 'eco', ") && main.includes("...(V.r050 && V.r1002 && V.r1007 ? { bag: 1 } : {}),"), 'ui: a new battle sends bag only with R050, R1002 and R1007 on');
    assert(main.includes('...(V.r050 && V.r1002 && V.r1007 ? bag1007Items() : [])'), 'ui: the sandbag item is there only with the three valves');
    assert.equal(main.split("issue(V.r050 && V.r1002 ? { ...ecoCmd(), tech: 1 } as Command : ecoCmd())").length - 1, 2, 'ui: the R050 tech line is still there twice');
    assert(src('src/valves.ts').includes("get r1007() { return on('1007'); }"), 'ui: valves.ts has r1007');
    const cdp = src('tools/cdp.mjs');
    assert(cdp.includes("const full1007 = /(^|&)noR1007=/.test(full1011) ? full1011 : `${full1011 ? full1011 + '&' : ''}noR1007=1`;") && cdp.includes("const url87 = /(^|&)noR087=/.test(full92) ? full1007 : `${full1007 ? full1007 + '&' : ''}noR087=1`;"), 'ui: tools/cdp.mjs opens pages with noR1007=1 unless a guard asks for R1007');
    const lines = f => src(f).split('\n').length - (src(f).endsWith('\n') ? 1 : 0);
    assert(lines('src/main.ts') <= 672, `ui: main.ts stays within 672 lines (${lines('src/main.ts')})`);
    assert.equal(lines('src/render/battle.ts'), 1194, 'ui: battle.ts gains no line');
  },
  // 驗收 18：純度
  purity() {
    const s = src('src/sim/sandbag1007.ts'), code = s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|Date|rng\.ts|randInt|nextU32/.test(code), 'purity: no floats, no **, no randomness or clock in sandbag1007.ts');
    for (const m of s.matchAll(/from '([^']+)'/g)) assert(/^\.\/[a-zA-Z0-9]+\.ts$/.test(m[1]), `purity: sandbag1007.ts imports only ./x.ts (${m[1]})`);
  },
  // 驗收 19：紅線
  redline() {
    const text = ['src/sim/sandbag1007.ts', 'src/ui/sandbag1007.ts', 'src/render/sandbag1007.ts'].map(src).join('\n').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const bad = ['Wehrmacht', 'Royal', 'British', 'German', '德軍', '英軍', '德國', '英國', '納粹', '皇家', '徽', '師', '團', '營'].filter(word => text.includes(word));
    assert.deepEqual(bad, [], `redline: no armies, nationalities, unit numbers or insignia in the R1007 files (${bad})`);
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK sandbag1007/${name}`);
}
console.log('sandbag1007: all OK');
