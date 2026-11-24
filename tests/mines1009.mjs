// R1009 地雷與排雷：不開瀏覽器的部分，卡面驗收 1–24（本機整支約 6 秒）。
// 用法：node tests/mines1009.mjs            全部各群
//       node tests/mines1009.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/mines1009-negative.mjs、-negative2.mjs）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as W from '../src/sim/world.ts';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, SHELL_HE, BK_WIRE, BK_HOUSE, BK_HQ, TER_MUD, TER_ROAD,
  UK_TANK, UK_HEAVY, UK_LIGHT, UK_ARMORED_CAR, UK_HOWITZER, UK_ATGUN, UK_INFANTRY, UK_OBSERVER, UK_ENGINEER, UK_FLAME, UK_TRUCK, UK_HALFTRACK, bldMaxHp } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { isCommand, checkLog } from '../src/sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { runScript } from '../src/sim/script.ts';
import { VEG_WOOD } from '../src/sim/vegetation.ts';
import { BAIL92 } from '../src/sim/transport92.ts';
import { randInt } from '../src/sim/rng.ts';
import { near1002 } from '../src/sim/engineer1002.ts';
import { MINES1009, MAX1009, HQ_GAP1009, PROBE1009, NEXT1009, LEN1009, why1009, blast1009 } from '../src/sim/mines1009.ts';
import { Lockstep } from '../src/net/lockstep.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { mine1009Items, on1009, armed1009, ITEM1009 } from '../src/ui/mines1009.ts';
import { pick50, arm50, armed50, block50, hint50, ITEM50 } from '../src/ui/tech50.ts';
import { air93Arm, air93Armed } from '../src/ui/air93.ts';
import { withMines1009 } from '../src/render/mines1009.ts';
import { TrenchRaster } from '../src/render/trenches.ts';
const TrenchMines1009 = withMines1009(TrenchRaster);
import * as side from '../src/side.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32）＋雙方指揮部：我方 (24,24)、敵方 (4,4)；eco 帶 sw＝2、tp＝1、mine＝1，補給 500；已經開打（第 1 步）
function field() {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) }; w.tick = 1;
  return w;
}
function bld(w, kind, x, z, ww = 1, d = 1, floors = 1, owner) {
  const maxHp = bldMaxHp(kind, ww, d, floors), b = { id: w.blds.length + 1, kind, x, z, w: ww, d, floors, hp: maxHp, maxHp, ...(owner !== undefined ? { builtBy: owner } : {}) };
  w.blds.push(b);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < ww; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = b.id;
  return b;
}
function camp(extra = {}) {
  const w = field(), h0 = bld(w, BK_HQ, 24, 24, 2, 2, 1, ME), h1 = bld(w, BK_HQ, 4, 4, 2, 2, 1, FOE);
  w.eco = { supply: [500, 500], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, mine: 1, ...extra };
  return w;
}
// ready＝一開始就能打（工兵排雷要 ready：倒數就是 cooldown）；不 ready 的永遠不開火
function put(w, s, kind, cx, cz, ready = false) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side: s, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const mine = (s, kind, x, z, left = 0, seen = 0) => ({ side: s, kind, x, z, left, seen });
const lay = (w, ...cells) => { w.mines = { version: 1, cells }; return w; };
const M = (s, ids, kind, x, z, extra = {}) => ({ t: 'mine', side: s, ids, kind, x, z, ...extra });
const at = (x, z, ids, extra = {}) => ({ x, z, ids, ...extra });
const move = (s, ids, x, z) => ({ t: 'move', side: s, ids, x, z });
const fire = (s, ids, x, z) => ({ t: 'fireAt', side: s, ids, x, z });
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
const opened = (extra, pre = []) => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, ...pre, eco(extra)]); return w; };
const cell = u => `${cellOf(u.x)},${cellOf(u.z)}`;
const boomOf = w => w.events.find(v => v.e === 'impact' && v.r === 128) ?? null;
// 同一個世界：下了這條指令、跟什麼都沒下，走一步之後雜湊一樣（＝沒被接）
const noop = (w, cmd) => { const a = structuredClone(w), b = structuredClone(w); step(a, [cmd]); step(b, []); return hashWorld(a) === hashWorld(b); };
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const PIN_KINDS = [49, 'd4ee5c3d7aa7fae7'];   // main c31548b（R1004 之後）：UNIT_KINDS 的長度與整張表的摘要
const PIN_BK = 17;                            // R1007 併入 main 後：建築種類最大是 17（BK_SANDBAG；地雷不新增建築種類）
// main c31548b（R1004 之後）的隔離副本（git archive）裡算出來的：R1002（sw＝2）四局、R050（tech）一局、R091（sw＝1）一局，都是 3,000 步
const PINNED = { 'sw2/0/classic': '52184192', 'sw2/0/real': '483b7f70', 'sw2/1/classic': 'd169b4cd', 'sw2/1/real': '703b2496', 'tech/1': '8948ed5a', 'sw1/0': '3be63bd9' };
function game(map, seed, extra, real, levels) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(extra), ...(real ? [{ t: 'rules', ap: 1, morale: 2 }] : []), { t: 'ai', side: 0, level: levels[0], v: 3 }, { t: 'ai', side: 1, level: levels[1], v: 3 }]);
  while (w.tick < 3000 && w.winner < 0) step(w, []);
  return hashWorld(w);
}
// 雜湊扣掉 eco.mine 那一項（電腦的局：帶 mine 跟不帶 mine 每一步應該一樣）
const hashNoMine = w => { const m = w.eco?.mine; if (w.eco) delete w.eco.mine; const h = hashWorld(w); if (m !== undefined) w.eco.mine = m; return h; };

const groups = {
  // 驗收 1：數字
  table() {
    assert.deepEqual(MINES1009, { 1: { cost: 15, lay: 120, clear: 160, armored: 60, soft: 60, foot: 20 }, 2: { cost: 10, lay: 80, clear: 200, armored: 0, soft: 10, foot: 30 } }, 'table: supply, work, clearing time and damage are the card\'s table');
    assert.deepEqual([MAX1009, HQ_GAP1009, PROBE1009, NEXT1009, LEN1009], [24, 5, 1, 2, 3], 'table: 24 cells a side, 5 from the enemy HQ, probe 1, next cell within 2, bands of up to 3');
    assert.deepEqual([UNIT_KINDS.length, createHash('sha256').update(JSON.stringify(UNIT_KINDS)).digest('hex').slice(0, 16)], PIN_KINDS, 'table: no unit kind added or changed (main c31548b)');
    assert.equal(Math.max(...Object.entries(W).filter(([k, v]) => /^BK_/.test(k) && typeof v === 'number').map(([, v]) => v)), PIN_BK, 'table: no building kind added (main c31548b)');
    const left = (kind, mk) => UNIT_KINDS[kind].hp - Math.floor((blast1009(MINES1009[mk], { kind }) * UNIT_KINDS[kind].armor) / 100);
    assert.deepEqual([UK_TANK, UK_HEAVY, UK_LIGHT, UK_ARMORED_CAR, UK_TRUCK, UK_HOWITZER, UK_ATGUN, UK_HALFTRACK].map(k => left(k, 1)), [40, 118, 10, -5, -20, 0, -10, 10], 'table: an anti-tank mine leaves a tank 40, a heavy 118, a light 10 and destroys an armoured car, a truck, a howitzer, an anti-tank gun; a half-track keeps 10');
    assert.deepEqual([UK_INFANTRY, UK_ENGINEER, UK_FLAME, UK_HALFTRACK, UK_TRUCK].map(k => left(k, 2)), [30, 10, -10, 70, 30], 'table: an anti-personnel mine leaves a section 30, engineers 10, kills the flamethrower; a half-track takes nothing, a truck 10');
  },
  // 驗收 2：旗標與指令
  flag() {
    const on = opened({ sw: 2, mine: 1 }), sw1 = opened({ sw: 1, mine: 1 }), none = opened({ mine: 1 }), two = opened({ sw: 2, mine: 2 }), off = opened({ sw: 2 }), z = opened({ sw: 2, mine: 1 }, [{ t: 'zombies' }]);
    assert.deepEqual([on.eco.mine, sw1.eco.mine, none.eco.mine, two.eco.mine, z.zombies ? z.eco.mine : 'no zombies'], [1, undefined, undefined, undefined, undefined], 'flag: mine is stored only with sw 2, only as 1, never in zombie defence');
    assert.notEqual(hashWorld(on), hashWorld(off), 'flag: mine is folded into the hash');
    { const a = lay(camp(), mine(ME, 1, 16, 16)), b = lay(camp(), mine(ME, 1, 16, 16, 0, 1)); assert.notEqual(hashWorld(a), hashWorld(b), 'flag: the hash tells a mine the enemy knows of from one it does not'); }
    assert.equal(isCommand({ ...ECO, mine: 1 }), true, 'flag: the command check takes eco with an integer mine');
    assert.equal(isCommand({ ...ECO, mine: 'x' }), false, 'flag: the command check refuses eco with mine "x"');
    assert.equal(isCommand(M(0, [1, 2], 1, 3, 4, { rot: 1, len: 3 })), true, 'flag: the command check takes a mine command');
    const base = M(0, [1], 1, 3, 4), { ids: _ids, ...noIds } = base; void _ids;
    for (const bad of [noIds, { ...base, ids: 1 }, { ...base, side: 2 }, { ...base, kind: 1.5 }, { ...base, x: '3' }, { ...base, rot: '1' }, { ...base, len: null }]) assert.equal(isCommand(bad), false, `flag: the command check refuses ${JSON.stringify(bad)}`);
  },
  // 驗收 3：放得下的每一條
  place() {
    const fresh = () => { const w = camp(); return { w, e: put(w, ME, UK_ENGINEER, 14, 16) }; };
    const refused = (w, cmd, reason, what) => {
      assert.equal(why1009(w, cmd.side, cmd.kind, { x: cmd.x, z: cmd.z, ids: cmd.ids, rot: cmd.rot, len: cmd.len }), reason, `place: ${what} → ${reason}`);
      assert(noop(w, cmd), `place: ${what} — refused, the world is as if nothing was sent`);
    };
    { const { w, e } = fresh(); assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '', 'place: open ground takes an anti-tank mine'); }
    { const { w, e } = fresh(); delete w.eco.mine; refused(w, M(ME, [e.id], 1, 16, 16), '本局未開放', 'no mine flag'); }
    { const { w, e } = fresh(); w.tick = 0; refused(w, M(ME, [e.id], 1, 16, 16), '本局未開放', 'step 0 (deployment)'); }
    { const { w, e } = fresh(); w.winner = 0; refused(w, M(ME, [e.id], 1, 16, 16), '本局未開放', 'the battle is decided'); }
    { const { w, e } = fresh(); refused(w, M(2, [e.id], 1, 16, 16), '本局未開放', 'side 2'); }
    { const { w, e } = fresh(); w.zombies = { version: 1, wave: 0, next: 9999, pending: 0, spawned: 0, killed: 0, lost: 0 }; assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '本局未開放', 'place: not in zombie defence'); }
    { const { w, e } = fresh(); w.sandbox = { version: 1, running: true, frame: 1 }; assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '本局未開放', 'place: not in the sandbox'); }
    { const { w, e } = fresh(); w.blds[0].hp = 0; refused(w, M(ME, [e.id], 1, 16, 16), '指揮部已毀', 'our HQ is down'); }
    for (const [what, extra] of [['kind 3', { kind: 3 }], ['kind 0', { kind: 0 }], ['len 4', { len: 4 }], ['len 0', { len: 0 }], ['rot 2', { rot: 2 }], ['len "2"', { len: '2' }], ['rot "1"', { rot: '1' }]]) {
      const { w, e } = fresh(); refused(w, { ...M(ME, [e.id], 1, 16, 16), ...extra }, '不能布這種', what);
    }
    { const { w, e } = fresh(); lay(w, ...Array.from({ length: 24 }, (_, i) => mine(ME, 2, 8 + (i % 12), 20 + Math.floor(i / 12), i < 20 ? 0 : 10))); refused(w, M(ME, [e.id], 1, 16, 16), '已經布滿 24 格', '24 cells (still being laid count too)'); }
    { const { w, e } = fresh(); lay(w, ...Array.from({ length: 22 }, (_, i) => mine(ME, 2, 8 + (i % 11), 20 + Math.floor(i / 11)))); refused(w, M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 }), '已經布滿 24 格', '22 cells and a band of 3'); }
    { const { w, e } = fresh(); w.eco.supply[ME] = 40; refused(w, M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 }), '補給不足，還差 5', 'supply for three anti-tank cells'); }
    { const { w } = fresh(); w.eco.supply[ME] = 12; assert.deepEqual([why1009(w, ME, 1), why1009(w, ME, 2)], ['補給不足，還差 3', ''], 'place: without a position the supply is for one cell (and nothing else is asked)'); }
    { const { w, e } = fresh(); const foe = put(w, FOE, UK_ENGINEER, 14, 18), inf = put(w, ME, UK_INFANTRY, 14, 19), car = put(w, ME, UK_TRUCK, 14, 20), rider = put(w, ME, UK_ENGINEER, 14, 20); rider.ride = car.id;
      for (const ids of [[], [foe.id], [inf.id], [rider.id], [999], ['1'], 7]) refused(w, M(ME, ids, 1, 16, 16), '先選工兵', `ids ${JSON.stringify(ids)}`);
      e.alive = false; refused(w, M(ME, [e.id], 1, 16, 16), '先選工兵', 'a dead engineer'); }
    for (const [what, cmd] of [['x 30 and a band of 3 along x', { x: 30, z: 16, rot: 0, len: 3 }], ['x -1', { x: -1, z: 16 }], ['z 31 and a band along z', { x: 16, z: 31, rot: 1, len: 2 }], ['x 1.5', { x: 1.5, z: 16 }]]) {
      const { w, e } = fresh(); refused(w, { ...M(ME, [e.id], 1, 0, 0), ...cmd }, '超出地圖', what);
    }
    { const { w } = fresh(); const e = put(w, ME, UK_ENGINEER, 12, 6);
      assert.deepEqual([why1009(w, ME, 1, at(11, 4, [e.id])), why1009(w, ME, 1, at(10, 4, [e.id]))], ['', '離敵方指揮部太近'], 'place: more than 5 cells from the enemy HQ footprint');
      w.blds[1].hp = 0; refused(w, M(ME, [e.id], 1, 10, 4), '離敵方指揮部太近', 'the enemy HQ is rubble, its footprint still counts');
      w.eco.hq[FOE] = 0; assert.equal(why1009(w, ME, 1, at(10, 4, [e.id])), '', 'place: no enemy HQ on the map, no such rule'); }
    { const { w, e } = fresh(); w.ter[cellIdx(w, 16, 16)] = TER_MUD; refused(w, M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 }), '不能布在水裡', 'one cell of the band is mud'); }
    { const { w, e } = fresh(); w.ter[cellIdx(w, 16, 16)] = TER_ROAD; assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '', 'place: roads take mines'); }
    const blockers = [
      ['a house', w => bld(w, BK_HOUSE, 16, 16)], ['rubble', w => { bld(w, BK_HOUSE, 16, 16).hp = 0; }],
      ['wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 16, z: 16, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60 }] }; }],
      ['cut wire', w => { w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 16, z: 16, w: 1, d: 1, floors: 1, hp: 0, maxHp: 60 }] }; }],
      ['a trench', w => { w.trenches = { version: 1, segments: [{ side: ME, kind: 0, x: 16, z: 16, rot: 0 }] }; }],
      ['our own mine', w => lay(w, mine(ME, 2, 16, 16))], ['an enemy mine we know of', w => lay(w, mine(FOE, 1, 16, 16, 0, 1))],
      ['our soldier', w => put(w, ME, UK_INFANTRY, 16, 16)], ['an enemy soldier', w => put(w, FOE, UK_INFANTRY, 16, 16)],
    ];
    for (const [what, set] of blockers) { const { w, e } = fresh(); set(w); refused(w, M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 }), '擋到了', `${what} on the middle cell`); }
    { const { w, e } = fresh(); const car = put(w, ME, UK_TRUCK, 17, 17), r = put(w, ME, UK_INFANTRY, 16, 16); r.ride = car.id; assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '', 'place: a soldier riding a truck does not block'); }
    { const { w, e } = fresh(); lay(w, mine(FOE, 1, 16, 16));
      assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '', 'place: an enemy mine we do not know of does not block (no leak)');
      step(w, [M(ME, [e.id], 2, 16, 16)]);
      assert.deepEqual(w.mines.cells.map(m => [m.side, m.x, m.z]), [[FOE, 16, 16], [ME, 16, 16]], 'place: both sides can have a cell on the same spot'); }
    const { w, e } = fresh(), ref = structuredClone(w);
    step(w, [M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 })]); step(ref, []);
    assert.equal(ref.eco.supply[ME] - w.eco.supply[ME], 45, 'place: a band of three anti-tank cells costs 45');
    assert.deepEqual(w.mines, { version: 1, cells: [mine(ME, 1, 16, 15, 120), mine(ME, 1, 16, 16, 120), mine(ME, 1, 16, 17, 120)] }, 'place: three cells being laid, in band order, 120 work each, unseen');
    assert(e.order === ORD_FIRE_AT && e.tx === 16 && e.tz === 15 && e.path.length > 0, 'place: the engineer is sent to the first cell');
  },
  // 驗收 4：每方 24 格
  limit() {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 14, 16), fe = put(w, FOE, UK_ENGINEER, 9, 14, true);
    lay(w, ...Array.from({ length: 24 }, (_, i) => mine(ME, 1, 8 + (i % 12), 20 + Math.floor(i / 12), i < 20 ? 0 : 10)));
    assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '已經布滿 24 格', 'limit: 24 cells (four still being laid) and no more');
    assert.equal(why1009(w, FOE, 1, at(10, 14, [fe.id])), '', 'limit: the other side counts its own');
    const tank = put(w, FOE, UK_TANK, 8, 20);
    step(w, []);
    assert(tank.hp === 40 && w.mines.cells.filter(m => m.side === ME).length === 23, 'limit: fixture — an enemy tank set off one of them');
    assert.equal(why1009(w, ME, 1, at(16, 16, [e.id])), '', 'limit: after one blew, one more can be laid');
    step(w, [M(ME, [e.id], 1, 16, 16)]);
    assert.equal(why1009(w, ME, 1, at(16, 18, [e.id])), '已經布滿 24 格', 'limit: and then it is full again');
    const known = w.mines.cells.find(m => m.side === ME && m.x === 9 && m.z === 20);
    assert(known && known.seen === 1, 'limit: fixture — the blast showed the next cell');
    step(w, [fire(FOE, [fe.id], 9, 20)]);
    for (let i = 0; i < 400 && w.mines.cells.includes(known); i++) step(w, []);
    assert.equal(w.mines.cells.includes(known), false, 'limit: fixture — the enemy engineer cleared it');
    assert.equal(why1009(w, ME, 1, at(16, 18, [e.id])), '', 'limit: a cleared cell frees its place too');
  },
  // 驗收 5：布
  lay() {
    const one = (n, kind) => {
      const w = camp(), es = Array.from({ length: n }, (_, i) => put(w, ME, UK_ENGINEER, 15, 15 + i));
      step(w, [M(ME, es.map(e => e.id), kind, 16, 16)]);
      const m = w.mines.cells[0]; let steps = 1, inside = false;
      while (m.left > 0 && steps < 1000) { step(w, []); steps++; if (es.some(e => cell(e) === '16,16')) inside = true; }
      return { steps, inside, es };
    };
    const a = one(1, 1);
    assert.deepEqual([a.steps, a.inside, a.es[0].order], [120, false, ORD_IDLE], 'lay: one engineer beside the cell lays an anti-tank mine in 120 steps without stepping on it, then idles');
    assert.equal(one(2, 1).steps, 60, 'lay: two engineers take 60');
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 12, 16);
      step(w, [M(ME, [e.id], 1, 16, 16)]);
      const m = w.mines.cells[0], walked = [];
      while (!(e.pathIdx >= e.path.length && near1002(e, { x: 16, z: 16, w: 1, d: 1 })) && walked.length < 400) { walked.push(m.left); step(w, []); }
      assert(walked.length > 20 && walked.every(v => v === 120), `lay: nothing is laid while the engineer walks up (${walked.length} steps)`); }
    assert.equal(one(1, 2).steps, 80, 'lay: an anti-personnel mine takes 80');
    const band = n => {
      const w = camp(), es = Array.from({ length: n }, (_, i) => put(w, ME, UK_ENGINEER, 15, 14 + i));
      step(w, [M(ME, es.map(e => e.id), 1, 16, 13, { rot: 0, len: 3 })]);
      const cells = [...w.mines.cells], order = [], last = cells[2], worked = es.map(() => 0); let steps = 1;
      while (cells.some(m => m.left > 0) && steps < 3000) {
        step(w, []); steps++;
        for (const m of cells) if (m.left === 0 && !order.includes(m)) order.push(m);
        es.forEach((e, i) => { if (e.order === ORD_FIRE_AT && e.tx === last.x && e.tz === last.z && e.pathIdx >= e.path.length && near1002(e, { x: last.x, z: last.z, w: 1, d: 1 })) worked[i]++; });
      }
      step(w, []);
      return { steps, order: order.map(m => cells.indexOf(m)), es, worked, inside: false };
    };
    const b1 = band(1);
    assert.deepEqual([b1.order, b1.es[0].order], [[0, 1, 2], ORD_IDLE], `lay: one engineer lays a band of three in order, then idles (${b1.steps} steps)`);
    const b2 = band(2);
    assert(b2.worked.every(k => k > 0), `lay: with two engineers both work on the last cell (the second does not idle when the first cell is done) (${b2.worked})`);
    assert(b2.steps * 10 <= b1.steps * 6 && b2.es.every(e => e.order === ORD_IDLE), `lay: two engineers lay the band in about half the time (${b2.steps} vs ${b1.steps}) and idle after`);
    console.log(`  lay: a band of three, one engineer ${b1.steps} steps, two engineers ${b2.steps} (last cell worked ${b2.worked})`);
    { const w = camp(), e = put(w, ME, UK_ENGINEER, 15, 16);
      step(w, [M(ME, [e.id], 1, 16, 16)]);
      for (let i = 0; i < 49; i++) step(w, []);
      step(w, [move(ME, [e.id], 20, 20)]);
      const m = w.mines.cells[0], left = m.left;
      for (let i = 0; i < 50; i++) step(w, []);
      assert.equal(m.left, left, 'lay: an engineer that walks away stops laying, the work done stays');
      step(w, [fire(ME, [e.id], 16, 16)]);
      assert.equal(e.order, ORD_FIRE_AT, 'lay: tapping our own unfinished cell sends it back');
      for (let i = 0; i < 400 && m.left; i++) step(w, []);
      assert.equal(m.left, 0, 'lay: back beside it, it finishes'); }
    { const w = camp({}), e = put(w, ME, UK_ENGINEER, 15, 16); w.rules = { morale: 2 };
      step(w, [M(ME, [e.id], 1, 16, 16)]);
      const m = w.mines.cells[0], left = m.left;
      for (let i = 0; i < 6; i++) { e.sup = 100; step(w, []); }
      assert.equal(m.left, left, 'lay: a broken engineer does not lay'); }
  },
  // 驗收 6：布好那一步敵方看得到就曝光（走 reveal1009：看到就停）
  armseen() {
    const scene = house => {
      const w = camp(), e = put(w, ME, UK_ENGINEER, 16, 17), tr = put(w, FOE, UK_TRUCK, 2, 16); put(w, FOE, UK_OBSERVER, 16, 6);
      if (house) bld(w, BK_HOUSE, 16, 11);
      step(w, [M(ME, [e.id], 1, 16, 16)]);
      const m = w.mines.cells[0];
      while (m.left > 1) step(w, []);
      step(w, [move(FOE, [tr.id], 30, 16)]);
      return { w, m, tr };
    };
    const seen = scene(false);
    assert.equal(seen.m.left, 0, 'armseen: fixture — the mine is finished in the step the truck starts');
    assert.equal(seen.m.seen, 1, 'armseen: laid in plain view of the enemy, the enemy knows the cell');
    assert(seen.tr.order === ORD_IDLE && seen.tr.path.length === 0, 'armseen: and the enemy truck whose path crosses it stops in that step');
    const hid = scene(true);
    assert.deepEqual([hid.m.left, hid.m.seen], [0, 0], 'armseen: behind a house the enemy does not see it');
    assert(hid.tr.order === ORD_MOVE && hid.tr.pathIdx < hid.tr.path.length, 'armseen: and the truck drives on');
  },
  // 驗收 7：反戰車雷
  trigat() {
    const drive = (kind, s = FOE, left = 0, extra = () => ({})) => {
      const w = lay(camp(), mine(ME, 1, 16, 16, left)), u = put(w, s, kind, 16, 10), more = extra(w, u), cells = new Set();
      let ev = null, t = 0;
      for (; t < 300 && !ev; t++) { step(w, t ? [] : [move(s, [u.id], 16, 22)]); ev = boomOf(w); cells.add(cell(u)); }
      return { w, u, ev, cells, ...more };
    };
    const tank = drive(UK_TANK), i16 = cellIdx(tank.w, 16, 16);
    assert.deepEqual(tank.ev, { e: 'impact', kind: SHELL_HE, x: center(16), z: center(16), bld: 0, r: 128 }, 'trigat: an enemy tank sets it off: a mortar-sized HE impact on the cell');
    assert.deepEqual([tank.u.hp, tank.u.order, tank.u.path.length, tank.w.mines.cells.length, tank.w.crater[i16]], [40, ORD_IDLE, 0, 0, 1], 'trigat: 60 off the tank, the tank stops, the mine is gone, the crater deepens by 1');
    assert.equal(drive(UK_HEAVY).u.hp, 118, 'trigat: a heavy tank takes 42');
    for (const k of [UK_TRUCK, UK_HOWITZER]) assert.equal(drive(k).u.alive, false, `trigat: kind ${k} is destroyed`);
    const truck = drive(UK_TRUCK, FOE, 0, (w, u) => { const r = put(w, FOE, UK_INFANTRY, 16, 10); r.ride = u.id; return { r }; });
    assert(truck.ev && !truck.u.alive, 'trigat: fixture — the loaded truck is destroyed');
    assert.deepEqual([truck.r.alive, truck.r.ride, truck.r.hp], [true, undefined, UNIT_KINDS[UK_INFANTRY].hp - Math.floor((UNIT_KINDS[UK_INFANTRY].hp * BAIL92[0]) / 100)], 'trigat: the section on it bails out the same step and takes the R092 bail damage');
    const ht = drive(UK_HALFTRACK, FOE, 0, (w, u) => { const g = put(w, FOE, UK_ATGUN, 16, 10); g.towBy = u.id; return { g }; });
    assert.deepEqual([ht.u.hp, ht.u.order, ht.g.towBy, ht.g.hp], [10, ORD_IDLE, undefined, UNIT_KINDS[UK_ATGUN].hp], 'trigat: a half-track towing a gun keeps 10 and stops; the gun is unhitched and takes nothing');
    const foot = drive(UK_INFANTRY);
    assert(!foot.ev && foot.cells.has('16,16') && foot.w.mines.cells.length === 1, 'trigat: an enemy section walks over it: nothing, the mine stays');
    const own = drive(UK_TANK, ME);
    assert(!own.ev && own.cells.has('16,16') && own.u.hp === 100, 'trigat: our own tank drives over our own mine: nothing');
    const unfinished = drive(UK_TANK, FOE, 5);
    assert(!unfinished.ev && unfinished.cells.has('16,16') && unfinished.u.hp === 100, 'trigat: a mine still being laid does not go off');
  },
  // 驗收 8：反人員雷
  trigap() {
    const drive = (kinds, s = FOE, extra = () => ({})) => {
      const w = lay(camp(), mine(ME, 2, 16, 16)), us = kinds.map(k => put(w, s, k, 16, 10)), more = extra(w, us), cells = new Set();
      let ev = null;
      for (let t = 0; t < 300 && !ev; t++) { step(w, t ? [] : us.map(u => move(s, [u.id], 16, 22))); ev = boomOf(w); cells.add(cell(us[0])); }
      return { w, us, ev, cells, ...more };
    };
    const two = drive([UK_INFANTRY, UK_INFANTRY]);
    assert(two.ev && two.us[0].hp === 30 && two.us[0].order === ORD_IDLE, 'trigap: an enemy section steps on it: 30 off, it stops');
    assert.equal(two.us[1].hp, 30, 'trigap: another section in the same cell takes 30 too');
    const ht = drive([UK_HALFTRACK], FOE, (w, us) => { const g = put(w, FOE, UK_ATGUN, 16, 10); g.towBy = us[0].id; return { g }; });
    assert(ht.ev && ht.us[0].hp === 70 && ht.w.mines.cells.length === 0, 'trigap: an armoured half-track rolls over it: no damage, the mine is gone');
    assert.equal(ht.g.hp, UNIT_KINDS[UK_ATGUN].hp, 'trigap: the towed gun takes nothing extra');
    const tr = drive([UK_TRUCK], FOE, (w, us) => { const r = put(w, FOE, UK_INFANTRY, 16, 10); r.ride = us[0].id; return { r }; });
    assert(tr.ev && tr.us[0].hp === 30 && tr.r.hp === UNIT_KINDS[UK_INFANTRY].hp, 'trigap: a truck takes 10, the section riding it nothing');
    const own = drive([UK_INFANTRY], ME);
    assert(!own.ev && own.cells.has('16,16') && own.us[0].hp === 60, 'trigap: our own section walks over our own mine: nothing');
  },
  // 驗收 9：雷不吃掩護
  cover() {
    const step1 = (setup) => { const w = lay(camp(), mine(ME, 2, 16, 16)); setup(w); const u = put(w, FOE, UK_INFANTRY, 16, 16); step(w, []); return u.hp; };
    assert.deepEqual([step1(() => {}), step1(w => { w.vegetation.cells[cellIdx(w, 16, 16)] = VEG_WOOD; }), step1(w => { w.crater[cellIdx(w, 16, 16)] = 3; })], [30, 30, 30], 'cover: in the open, a wood or a crater the mine takes 30 all the same');
    const rifle = setup => { const w = camp(); setup(w); const t = put(w, FOE, UK_INFANTRY, 16, 16), s = put(w, ME, UK_INFANTRY, 13, 16, true); step(w, [{ t: 'attack', side: ME, ids: [s.id], target: t.id }]); for (let n = 0; n < 80 && t.hp === 60; n++) step(w, []); return 60 - t.hp; };
    const r = [rifle(() => {}), rifle(w => { w.vegetation.cells[cellIdx(w, 16, 16)] = VEG_WOOD; }), rifle(w => { w.crater[cellIdx(w, 16, 16)] = 3; })];
    assert(r[0] === 12 && r[1] < 12 && r[2] < 12, `cover: a rifle shot at the same man still loses to cover (${r})`);
    console.log(`  cover: a rifle shot takes ${r.join(' / ')} in the open / wood / crater; the mine 30 everywhere`);
  },
  // 驗收 10：士氣
  morale() {
    const run = rules => { const w = lay(camp(), mine(ME, 2, 16, 16)); if (rules) w.rules = { morale: 2 }; const ours = put(w, ME, UK_INFANTRY, 17, 17), theirs = put(w, FOE, UK_INFANTRY, 15, 15), u = put(w, FOE, UK_INFANTRY, 16, 16); step(w, []); return [!!boomOf(w), ours.sup ?? 0, theirs.sup ?? 0, u.sup ?? 0]; };
    const on = run(true), off = run(false);
    assert(on[0] && on[1] > 0 && on[2] > 0 && on[3] > 0, `morale: with morale on the blast suppresses both sides within two cells (${on})`);
    assert.deepEqual(off, [true, 0, 0, 0], 'morale: with morale off nobody is suppressed');
  },
  // 驗收 11：戳到、看到就停、工兵不走進知道的雷
  reveal() {
    const probe = (kind, dx, ride) => { const w = lay(camp(), mine(ME, 1, 16, 16)), u = put(w, FOE, kind, 16 + dx, 16); if (ride) { const c = put(w, FOE, UK_TRUCK, 16 + dx, 16); u.ride = c.id; } step(w, []); return w.mines.cells[0].seen; };
    assert.deepEqual([probe(UK_ENGINEER, 1), probe(UK_ENGINEER, -1), probe(UK_ENGINEER, 2), probe(UK_INFANTRY, 1), probe(UK_ENGINEER, 1, true)], [1, 1, 0, 0, 0], 'reveal: an enemy engineer one cell away finds it in that step; two away, a section, or an engineer riding a truck do not');
    { const w = lay(camp(), mine(ME, 1, 16, 16)), e = put(w, FOE, UK_ENGINEER, 17, 18), t1 = put(w, FOE, UK_TANK, 16, 10), t2 = put(w, FOE, UK_TANK, 20, 10), ro = put(w, FOE, UK_INFANTRY, 16, 12), own = put(w, ME, UK_TANK, 16, 22);
      ro.rout = 1; ro.order = ORD_MOVE; ro.path = Array.from({ length: 8 }, (_, i) => cellIdx(w, 16, 13 + i)); ro.pathIdx = 0;
      step(w, [move(FOE, [t1.id], 16, 21), move(FOE, [t2.id], 20, 21), move(ME, [own.id], 16, 11), move(FOE, [e.id], 17, 17)]);
      assert.equal(w.mines.cells[0].seen, 0, 'reveal: fixture — not found yet');
      for (let i = 0; i < 40 && !w.mines.cells[0].seen; i++) step(w, []);
      assert.equal(w.mines.cells[0].seen, 1, 'reveal: fixture — the engineer walking beside it finds it');
      assert(t1.order === ORD_IDLE && t1.path.length === 0, 'reveal: the enemy tank whose path crosses the cell stops');
      assert(t2.order === ORD_MOVE && t2.pathIdx < t2.path.length, 'reveal: one whose path does not cross it drives on');
      assert(ro.rout && ro.pathIdx < ro.path.length, 'reveal: a routing section does not stop');
      assert(own.order === ORD_MOVE && own.pathIdx < own.path.length, 'reveal: units of the side that laid it are not affected'); }
    { const w = lay(camp(), ...[14, 15, 16].map(x => mine(FOE, 2, x, 16, 0, 1))), e = put(w, ME, UK_ENGINEER, 11, 16, true), inside = new Set();
      step(w, [fire(ME, [e.id], 15, 16)]);
      let t = 0; for (; t < 600 && w.mines.cells.length === 3; t++) { step(w, []); inside.add(cell(e)); if (boomOf(w)) break; }
      assert(!inside.has('14,16') && !inside.has('16,16') && e.hp === UNIT_KINDS[UK_ENGINEER].hp, `reveal: sent from the west end to clear the middle of a known band, the engineer never steps on the first cell (${[...inside].join(' ')})`);
      assert.deepEqual(w.mines.cells.map(m => m.x), [14, 16], `reveal: and, beside the middle cell, clears it (${t} steps)`);
      console.log(`  reveal: from the west end the engineer walks ${[...inside].join(' ')} and clears the middle cell in ${t + 1} steps`); }
    { const w = lay(camp(), mine(FOE, 2, 14, 16, 0, 1)), e = put(w, ME, UK_ENGINEER, 11, 16), inside = new Set();
      step(w, [move(ME, [e.id], 18, 16)]);
      for (let t = 0; t < 200; t++) { step(w, []); inside.add(cell(e)); }
      assert(!inside.has('14,16') && cell(e) === '13,16' && e.order === ORD_IDLE, `reveal: a move order across a known mine stops the engineer the cell before it (${cell(e)})`); }
  },
  // 驗收 12：炸了一顆，帶出旁邊的
  boomreveal() {
    const w = lay(camp(), mine(ME, 2, 16, 16), mine(ME, 1, 17, 16), mine(ME, 2, 16, 17), mine(ME, 2, 18, 16)), u = put(w, FOE, UK_INFANTRY, 16, 10), t = put(w, FOE, UK_TANK, 16, 30);
    let ev = null;
    for (let i = 0; i < 400 && !ev; i++) { step(w, i === 0 ? [move(FOE, [u.id], 16, 16)] : i === 100 ? [move(FOE, [t.id], 16, 2)] : []); ev = boomOf(w); }
    assert(ev && u.hp === 30, 'boomreveal: fixture — the section set off the cell at 16,16');
    assert.deepEqual(w.mines.cells.map(m => [m.x, m.z, m.seen]), [[17, 16, 1], [16, 17, 1], [18, 16, 0]], 'boomreveal: the cells of that side one away become known, two away do not');
    assert(t.order === ORD_IDLE && t.path.length === 0 && cellOf(t.z) > 17, `boomreveal: the enemy tank whose path crosses a newly known cell stops (${cell(t)})`);
  },
  // 驗收 13：排雷
  clear() {
    const run = (kind, from, opts = {}) => {
      const w = lay(camp(), mine(FOE, kind, 16, 16, 0, 1)), e = put(w, ME, UK_ENGINEER, from, 16, true), inside = new Set();
      if (opts.morale) w.rules = { morale: 2 };
      step(w, [fire(ME, [e.id], 16, 16)]);
      let arrive = e.pathIdx >= e.path.length && near1002(e, { x: 16, z: 16, w: 1, d: 1 }) ? w.tick : -1, gone = -1;
      for (let i = 0; i < 2000 && gone < 0; i++) {
        if (opts.sup) e.sup = opts.sup;
        step(w, []); inside.add(cell(e));
        if (arrive < 0 && e.pathIdx >= e.path.length && near1002(e, { x: 16, z: 16, w: 1, d: 1 })) arrive = w.tick;
        if (!w.mines.cells.length) gone = w.tick;
        if (opts.limit && i >= opts.limit) break;
      }
      return { w, e, inside, arrive, gone, took: gone < 0 ? -1 : gone - arrive + 1 };
    };
    const at1 = run(1, 12);
    assert(!at1.inside.has('16,16') && at1.arrive > 0, 'clear: the engineer walks up beside it and never onto it');
    assert.deepEqual([at1.took, at1.e.order], [160, ORD_IDLE], 'clear: beside it, an anti-tank cell is gone on the 160th step and the engineer idles');
    assert.equal(run(2, 12).took, 200, 'clear: an anti-personnel cell takes 200');
    const near = run(1, 15);
    assert.equal(near.gone - 1, 160, 'clear: already beside it, it still counts all 160 (the order step is the first)');
    const pinned = run(1, 15, { morale: true, sup: 70 });
    assert(pinned.gone - 1 > 160, `clear: pinned (R052) it counts slower (${pinned.gone - 1})`);
    console.log(`  clear: beside it 160 / 200 steps; pinned ${pinned.gone - 1} steps`);
    const broken = run(1, 15, { morale: true, sup: 100, limit: 400 });
    assert.equal(broken.w.mines.cells.length, 1, 'clear: a broken engineer does not clear');
    { const w = lay(camp(), mine(FOE, 1, 16, 16, 0, 1)), a = put(w, ME, UK_ENGINEER, 15, 16, true), b = put(w, ME, UK_ENGINEER, 17, 16, true);
      step(w, [fire(ME, [a.id], 16, 16)]); for (let i = 0; i < 19; i++) step(w, []); step(w, [fire(ME, [b.id], 16, 16)]);
      let t = 21; while (w.mines.cells.length && t < 400) { step(w, []); t++; }
      step(w, []);
      assert.deepEqual([t, a.order, b.order], [160, ORD_IDLE, ORD_IDLE], 'clear: two engineers on one cell: the first to finish clears it, the other idles the next step'); }
    { const w = lay(camp(), mine(FOE, 1, 16, 16)), e = put(w, ME, UK_ENGINEER, 14, 16, true);
      assert(noop(w, fire(ME, [e.id], 16, 16)), 'clear: an order on an enemy mine we do not know of is exactly an order on open ground'); }
    for (const k of [UK_INFANTRY, UK_TANK]) { const w = lay(camp(), mine(FOE, 1, 16, 16, 0, 1)), u = put(w, ME, k, 13, 16, true); assert(noop(w, fire(ME, [u.id], 16, 16)), `clear: kind ${k} does not take an order on the mine cell`); }
  },
  // 驗收 14：自己的雷
  own() {
    { const w = lay(camp(), mine(ME, 1, 16, 16, 60)), e = put(w, ME, UK_ENGINEER, 14, 16);
      step(w, [fire(ME, [e.id], 16, 16)]); for (let i = 0; i < 200 && w.mines.cells[0].left; i++) step(w, []);
      assert.equal(w.mines.cells[0].left, 0, 'own: tapping our own unfinished cell finishes it'); }
    { const w = lay(camp(), mine(ME, 1, 16, 16)), e = put(w, ME, UK_ENGINEER, 15, 16, true);
      assert(noop(w, fire(ME, [e.id], 16, 16)), 'own: tapping our own finished cell is a tap on open ground (it cannot be lifted)'); }
    { const w = lay(camp(), mine(ME, 2, 16, 16, 40), mine(FOE, 1, 16, 16, 0, 1)), e = put(w, ME, UK_ENGINEER, 15, 16, true);
      step(w, [fire(ME, [e.id], 16, 16)]); for (let i = 0; i < 10; i++) step(w, []);
      assert.deepEqual([w.mines.cells[0].left, w.mines.cells.length, e.cooldown], [29, 2, 0], 'own: our unfinished cell and a known enemy cell on one spot: ours is laid first'); }
  },
  // 審查 F1（施工紀錄 13）：自己的雷疊在敵方的雷上——布雷指令不碰底下那一格敵方雷（布好了照 2.3 找下一格、沒有就回待命）；要排得再點一次那一格，倒數照 2.6 數滿
  stack() {
    for (const k of [1, 2]) {
      const w = lay(camp(), mine(FOE, k, 16, 16)), a = put(w, ME, UK_ENGINEER, 15, 16, true), b = put(w, ME, UK_ENGINEER, 15, 17, true), c = put(w, ME, UK_ENGINEER, 16, 9, true);
      step(w, [M(ME, [a.id, b.id, c.id], 2, 16, 16)]);
      const own = w.mines.cells.find(m => m.side === ME), foe = w.mines.cells.find(m => m.side === FOE);
      let t = 1; while (own.left > 0 && t < 400) { step(w, []); t++; }
      const seen = foe.seen, walking = c.pathIdx < c.path.length || !near1002(c, { x: 16, z: 16, w: 1, d: 1 });
      for (let i = 0; i < 400; i++) step(w, []);
      assert.deepEqual([seen, walking, own.left, w.mines.cells.includes(foe), [a, b, c].map(e => e.order)], [1, true, 0, true, [ORD_IDLE, ORD_IDLE, ORD_IDLE]],
        `stack: two engineers lay over a hidden enemy kind ${k} cell (found while laying), a third still walking up: ours done at step ${t}, the enemy cell is still there 400 steps on and all three idle`);
      const e = [a, b, c].find(u => near1002(u, { x: 16, z: 16, w: 1, d: 1 }));
      const t0 = w.tick; step(w, [fire(ME, [e.id], 16, 16)]);
      while (w.mines.cells.includes(foe) && w.tick - t0 < 1000) step(w, []);
      assert.equal(w.tick - t0, MINES1009[k].clear, `stack: then a tap on that cell clears the enemy kind ${k} cell under ours, counting all ${MINES1009[k].clear}`);
      assert.deepEqual([w.mines.cells.length, w.mines.cells[0], e.order], [1, own, ORD_IDLE], 'stack: ours stays, the engineer idles');
    }
    { const w = lay(camp(), mine(FOE, 1, 16, 13)), es = [put(w, ME, UK_ENGINEER, 15, 14, true), put(w, ME, UK_ENGINEER, 15, 15, true)];
      step(w, [M(ME, es.map(e => e.id), 1, 16, 13, { rot: 0, len: 3 })]);
      const cells = w.mines.cells.filter(m => m.side === ME), foe = w.mines.cells.find(m => m.side === FOE), last = cells[2], worked = [0, 0]; let steps = 1;
      while (cells.some(m => m.left > 0) && steps < 3000) {
        step(w, []); steps++;
        es.forEach((e, i) => { if (e.order === ORD_FIRE_AT && e.tx === last.x && e.tz === last.z && e.pathIdx >= e.path.length && near1002(e, { x: last.x, z: last.z, w: 1, d: 1 })) worked[i]++; });
      }
      step(w, []);
      assert.deepEqual([foe.seen, w.mines.cells.includes(foe), worked.every(n => n > 0), es.map(e => e.order)], [1, true, true, [ORD_IDLE, ORD_IDLE]],
        `stack: two engineers lay a band of three whose first cell sits on a hidden enemy anti-tank cell: both go on to the last cell (${worked}) and the enemy cell stays`);
      assert(steps <= 260, `stack: the band takes about as long as on clean ground (${steps} steps)`);
      console.log(`  stack: a band of three over a hidden enemy cell, two engineers ${steps} steps (last cell worked ${worked})`); }
    { const w = lay(camp(), mine(ME, 1, 16, 16, 120, 1), mine(FOE, 1, 16, 16, 0, 1)), a = put(w, ME, UK_ENGINEER, 15, 16), b = put(w, FOE, UK_ENGINEER, 17, 16, true);
      step(w, [fire(FOE, [b.id], 16, 16)]);
      for (let i = 0; i < 99; i++) step(w, []);
      a.cooldown = 0; step(w, [fire(ME, [a.id], 16, 16)]);
      const ours = w.mines.cells.find(m => m.side === ME), foe = w.mines.cells.find(m => m.side === FOE);
      for (let i = 0; i < 100 && w.mines.cells.includes(ours); i++) step(w, []);
      const gone = !w.mines.cells.includes(ours), left = ours.left;
      for (let i = 0; i < 300; i++) step(w, []);
      assert.deepEqual([gone, left > 0, w.mines.cells.includes(foe), a.order], [true, true, true, ORD_IDLE], `stack: the enemy clears our cell while it is still being laid (left ${left}): our engineer idles and does not lift the known enemy cell under it`); }
  },
  // 驗收 15：偽造的指令
  forged() {
    const w = camp(), e0 = put(w, ME, UK_ENGINEER, 14, 16), e1 = put(w, FOE, UK_ENGINEER, 12, 12), dead = put(w, FOE, UK_ENGINEER, 12, 13), car = put(w, FOE, UK_TRUCK, 12, 14), rider = put(w, FOE, UK_ENGINEER, 12, 14), inf = put(w, FOE, UK_INFANTRY, 12, 15);
    dead.alive = false; rider.ride = car.id;
    for (const ids of [[e0.id], [dead.id], [rider.id], [inf.id]]) assert(noop(w, M(FOE, ids, 1, 13, 18)), `forged: side 1 with ids ${ids} (ours, dead, riding, not an engineer) is refused`);
    for (const [what, extra] of [['kind 0', { kind: 0 }], ['kind 3', { kind: 3 }], ['len 0', { len: 0 }], ['len 4', { len: 4 }], ['rot 2', { rot: 2 }], ['x -1', { x: -1 }], ['x n', { x: w.n }], ['x 2^31-1', { x: 2147483647 }]]) assert(noop(w, { ...M(FOE, [e1.id], 1, 13, 18), ...extra }), `forged: ${what} is refused`);
    for (const bad of [{ x: 1.5 }, { z: NaN }, { x: Infinity }]) assert.equal(isCommand({ ...M(FOE, [e1.id], 1, 13, 18), ...bad }), false, `forged: the command check refuses ${JSON.stringify(bad)}`);
    { const v = lay(camp(), mine(ME, 1, 16, 16), mine(ME, 2, 17, 16)), a = put(v, ME, UK_ENGINEER, 15, 16, true), b = put(v, FOE, UK_ENGINEER, 18, 18, true);
      assert(noop(v, fire(ME, [a.id], 16, 16)), 'forged: side 0 cannot lift its own finished mine');
      assert(noop(v, fire(FOE, [b.id], 16, 16)), 'forged: side 1 cannot clear a mine it does not know of'); }
    const L = new Lockstep(0, [0, 1], 1, 4, true), mine0 = M(0, [1], 1, 3, 4), mine1 = M(1, [2], 1, 3, 4);
    L.put(5, 0, [mine0, mine1]); L.put(5, 1, []);
    assert.deepEqual(L.take(5, []).cmds, [mine0], 'forged: in versus, player 0 keeps its own mine order and drops one for side 1');
    // 2,000 條形狀隨機的指令（rng.ts），過 checkLog 的才進 step()
    const v = camp({}); v.eco.supply = [100000, 100000];
    for (let i = 0; i < 6; i++) { put(v, ME, UK_ENGINEER, 18 + i, 14 + (i % 3), true); put(v, FOE, UK_ENGINEER, 8 + i, 18 + (i % 3), true); }
    put(v, ME, UK_TANK, 16, 20); put(v, FOE, UK_INFANTRY, 12, 22);
    const r = { rng: 20261121 }, pick = a => a[randInt(r, a.length)], ints = n => Array.from({ length: n }, () => randInt(r, 20) - 3);
    let sent = 0, kept = 0;
    for (let i = 0; i < 2000; i++) {
      const cmd = { t: pick(['mine', 'mine', 'fireAt']), side: pick([0, 1, 1, 0, 2, -1]), ids: pick([ints(randInt(r, 4)), ints(2), 'x', [1.5], [null]]), kind: pick([1, 2, 1, 2, 0, 3, 1.5]), x: randInt(r, 40) - 4, z: pick([randInt(r, 40) - 4, 16, 'z']), ...(randInt(r, 2) ? { rot: pick([0, 1, 2, -1, '0']) } : {}), ...(randInt(r, 2) ? { len: pick([1, 2, 3, 0, 4, null]) } : {}) };
      sent++;
      if (checkLog([{ tick: 0, cmd }]) !== null) { step(v, []); continue; }
      kept++;
      const before = new Set(v.mines?.cells ?? []);
      step(v, [cmd]);
      for (const m of v.mines?.cells ?? []) if (!before.has(m)) assert.equal(m.side, cmd.side, `forged: a cell appeared for side ${m.side} from a command of side ${cmd.side}`);
      for (const s of [0, 1]) assert((v.mines?.cells.filter(m => m.side === s).length ?? 0) <= 24, `forged: side ${s} never has more than 24 cells`);
    }
    console.log(`  forged: ${sent} random commands, ${kept} passed checkLog, ${v.mines?.cells.length ?? 0} cells at the end`);
    assert(kept > 200 && (v.mines?.cells.length ?? 0) > 0, `forged: fixture — enough random commands got through and some mines were laid (${kept}/${sent}, ${v.mines?.cells.length ?? 0} cells)`);
  },
  // 驗收 16：存檔
  codec() {
    const w = lay(camp(), mine(ME, 1, 16, 15, 120), mine(ME, 1, 16, 16), mine(FOE, 2, 20, 16, 0, 1), mine(FOE, 1, 21, 16, 0, 0)), e = put(w, ME, UK_ENGINEER, 18, 16, true), b = put(w, ME, UK_ENGINEER, 15, 15);
    step(w, [fire(ME, [e.id], 20, 16), fire(ME, [b.id], 16, 15)]);
    for (let i = 0; i < 60; i++) step(w, []);
    assert(e.order === ORD_FIRE_AT && e.cooldown > 0 && w.mines.cells[0].left > 0 && w.mines.cells.some(m => m.seen), 'codec: fixture — a cell being laid, a finished one, a known enemy one and an engineer clearing');
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert(back && hashWorld(back) === hashWorld(w), 'codec: the world with mines reads back to the same hash');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); assert.equal(hashWorld(back), hashWorld(w), `codec: step ${i + 1} after loading equals the uninterrupted run`); }
    const raw = JSON.parse(JSON.stringify(encodeWorld(lay(camp(), mine(ME, 1, 16, 16), mine(FOE, 2, 3, 20, 10, 1)))));
    assert(decodeWorld(raw), 'codec: fixture — the reference world reads');
    const cells = c => ({ ...raw, mines: { version: 1, cells: c } }), { mine: _m, ...noMine } = raw.eco; void _m;
    const bad = [
      ['eco.mine 2', { ...raw, eco: { ...raw.eco, mine: 2 } }], ['mines without eco.mine', { ...raw, eco: noMine }], ['eco.mine with sw 1', { ...raw, eco: { ...raw.eco, sw: 1 } }],
      ['eco.mine in zombie defence', { ...raw, zombies: { version: 1, wave: 0, next: 1, pending: 0, spawned: 0, killed: 0, lost: 0 } }],
      ['mines version 2', { ...raw, mines: { version: 2, cells: [] } }], ['cells not an array', { ...raw, mines: { version: 1, cells: {} } }], ['mines null', { ...raw, mines: null }], ['mines an array', { ...raw, mines: [] }],
      ['side 2', cells([mine(2, 1, 16, 16)])], ['kind 3', cells([mine(ME, 3, 16, 16)])], ['x off the map', cells([mine(ME, 1, 32, 16)])], ['z -1', cells([mine(ME, 1, 16, -1)])],
      ['left -1', cells([mine(ME, 1, 16, 16, -1)])], ['left more than the work', cells([mine(ME, 1, 16, 16, 121)])], ['seen 2', cells([mine(ME, 1, 16, 16, 0, 2)])], ['a float', cells([mine(ME, 1, 16.5, 16)])],
      ['the same side twice on one cell', cells([mine(ME, 1, 16, 16), mine(ME, 2, 16, 16)])], ['25 cells for one side', cells(Array.from({ length: 25 }, (_, i) => mine(ME, 2, i, 10)))],
      ['49 cells', cells(Array.from({ length: 49 }, (_, i) => mine(i % 2, 2, i % 24, 10 + (i % 2))))], ['a cell that is not an object', cells([7])],
    ];
    for (const [what, r] of bad) assert.equal(decodeWorld(r), null, `codec: refused — ${what}`);
    assert(decodeWorld(cells([mine(ME, 2, 16, 16), mine(FOE, 2, 16, 16)])), 'codec: one cell each for both sides on one spot reads');
    const text = readFileSync(new URL('../tools/save-v1.txt', import.meta.url), 'utf8'), old = decodeWorld(JSON.parse(text.slice(8)).world);
    assert(old && hashWorld(old) === '6a63b956', 'codec: the R074 save (tools/save-v1.txt) still reads with its hash');
  },
  // 驗收 17：重播（真的開局：萊伊、雙方生產；每一件事先確認真的發生過，再比雜湊）。地點都離兩邊基地的砲、機槍夠遠，免得兵先被打死
  replay() {
    const seed = 1945, log = [], w = createWorld(seed), booms = [];
    const go = cmds => { for (const cmd of cmds) log.push({ tick: w.tick, cmd }); step(w, cmds); for (const v of w.events) if (v.e === 'impact' && v.r === 128) booms.push(w.tick); };
    const until = (f, n) => { for (let i = 0; i < n && !f(); i++) go([]); return f(); };
    const one = (s, k) => w.units.find(u => u.alive && u.kind === k && u.side === s && !u.ride);
    go([{ t: 'map', id: 1, vegetation: 1 }, eco({ sw: 2, tp: 1, mine: 1 }), { t: 'produce', side: ME, kind: UK_ENGINEER }, { t: 'produce', side: FOE, kind: UK_ENGINEER }, { t: 'produce', side: FOE, kind: UK_TRUCK }]);
    assert(until(() => one(ME, UK_ENGINEER) && one(FOE, UK_ENGINEER) && one(FOE, UK_TRUCK), 1500), 'replay: fixture — both sides got engineers and the enemy a truck');
    const me = one(ME, UK_ENGINEER), foe = one(FOE, UK_ENGINEER), truck = one(FOE, UK_TRUCK), ours = one(ME, UK_INFANTRY), theirs = one(FOE, UK_INFANTRY);
    go([move(ME, [me.id], 17, 17), move(FOE, [foe.id], 17, 11)]);
    until(() => me.pathIdx >= me.path.length && foe.pathIdx >= foe.path.length, 600);
    // 放得下的地方：從工兵那一格往外一圈一圈找（照 why1009）
    const spot = (s, e, kind, len, avoid = []) => { for (let r = 1; r <= 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const x = cellOf(e.x) + dx, z = cellOf(e.z) + dz; for (const rot of [0, 1]) if (!avoid.some(([ax, az]) => Math.abs(ax - x) <= 3 && Math.abs(az - z) <= 3) && why1009(w, s, kind, at(x, z, [e.id], { rot, len })) === '') return { x, z, rot }; } return null; };
    const a = spot(ME, me, 1, 3);
    assert(a, 'replay: fixture — room for an anti-tank band');
    const aCells = [0, 1, 2].map(i => [a.rot ? a.x : a.x + i, a.rot ? a.z + i : a.z]);
    go([M(ME, [me.id], 1, a.x, a.z, { rot: a.rot, len: 3 })]);
    assert(until(() => w.mines.cells.every(m => m.left === 0), 900), 'replay: our engineer laid a band of three anti-tank cells');
    const p = spot(ME, me, 2, 2, aCells);
    assert(p, 'replay: fixture — room for an anti-personnel band');
    go([M(ME, [me.id], 2, p.x, p.z, { rot: p.rot, len: 2 })]);
    assert(until(() => w.mines.cells.every(m => m.left === 0) && w.mines.cells.length === 5, 900), 'replay: and a band of two anti-personnel cells');
    go([move(ME, [me.id], 28, 28), move(FOE, [truck.id], aCells[1][0], aCells[1][1])]);
    assert(until(() => !truck.alive, 1500) && booms.length === 1, 'replay: the enemy truck drove onto the anti-tank band and blew up');
    const pc = w.mines.cells.find(m => m.side === ME && m.kind === 2);
    go([move(FOE, [theirs.id], pc.x, pc.z)]);
    assert(until(() => booms.length === 2, 1500) && theirs.hp === 30, 'replay: the enemy section stepped on an anti-personnel cell (60 → 30)');
    go([move(FOE, [theirs.id], 2, 2)]);
    const f = spot(FOE, foe, 1, 1);
    assert(f, 'replay: fixture — room for an enemy cell');
    go([M(FOE, [foe.id], 1, f.x, f.z, { len: 1 })]);
    const fm = w.mines.cells.find(m => m.side === FOE);
    assert(until(() => fm.left === 0, 900) && fm.seen === 0, 'replay: the enemy laid its cell, unseen');
    go([move(FOE, [foe.id], 2, 3)]);
    until(() => foe.pathIdx >= foe.path.length, 600);
    go([move(ME, [me.id], fm.x + 1, fm.z + 1)]);
    assert(until(() => Math.max(Math.abs(cellOf(me.x) - fm.x), Math.abs(cellOf(me.z) - fm.z)) <= 3, 900), 'replay: fixture — our engineer comes near the enemy cell');
    go([move(ME, [ours.id], fm.x, fm.z)]);
    assert(ours.path.includes(cellIdx(w, fm.x, fm.z)), 'replay: fixture — our section is ordered onto the enemy cell');
    assert(until(() => fm.seen === 1, 600) && me.alive, 'replay: our engineer found the enemy cell (seen went from 0 to 1)');
    assert(ours.order === ORD_IDLE && ours.path.length === 0 && cell(ours) !== `${fm.x},${fm.z}`, 'replay: and our section, whose path went into it, stopped');
    go([fire(ME, [me.id], fm.x, fm.z)]);
    assert(until(() => !w.mines.cells.includes(fm), 600) && booms.length === 2, 'replay: our engineer cleared it (no blast)');
    while (w.tick < 3600) go([]);
    const T = w.tick, h = hashWorld(w);
    assert.equal(hashWorld(runLog(createWorld(seed), log, T)), h, 'replay: the same log replays to the same hash');
    assert.equal(hashWorld(runLog(createWorld(seed), log, T)), h, 'replay: and again');
    const half = runLog(createWorld(seed), log, 900), back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(half))));
    assert.equal(hashWorld(runLog(back, log.filter(l => l.tick >= 900), T)), h, 'replay: saved at step 900 and replayed on, the hash is the same');
    const mid = 2200, deep = runLog(createWorld(seed), log, mid);
    assert(deep.mines?.cells.length, 'replay: fixture — mines are in the world at the clone point');
    assert.equal(hashWorld(runLog(structuredClone(deep), log.filter(l => l.tick >= mid), T)), h, 'replay: a structuredClone at step 2,200 carries on to the same hash');
    console.log(`  replay: seed ${seed}, ${log.length} commands, mines went off at ${booms.join('、')}, ${T} steps`);
  },
  // 驗收 18：電腦不布不排；帶 mine 的局每 100 步跟不帶的一樣（扣掉 eco.mine 那一項）
  quiet() {
    for (const [map, seed, levels] of [[0, 31, [3, 2]], [1, 32, [1, 3]]]) {
      const ais = [{ t: 'ai', side: 0, level: levels[0], v: 3 }, { t: 'ai', side: 1, level: levels[1], v: 3 }];
      const a = createWorld(seed), b = createWorld(seed);
      step(a, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2 }), ...ais]); step(b, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco({ sw: 2, mine: 1 }), ...ais]);
      assert.equal(b.eco.mine, 1, 'quiet: the second game has mine');
      while (a.tick < 3000 && a.winner < 0) { step(a, []); step(b, []); if (a.tick % 100 === 0) assert.equal(hashNoMine(b), hashWorld(a), `quiet: map ${map}, AI ${levels} — at tick ${a.tick} the world with mine is the world without it`); }
      assert.deepEqual([b.mines, b.winner, b.tick], [undefined, a.winner, a.tick], `quiet: map ${map}: no mine laid, same winner, same length`);
    }
  },
  // 驗收 19：黃金雜湊；沒有 mine 的局跟 main（R1004 之後）逐位一樣
  hash() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'hash: the golden script battle is unchanged');
    const now = {};
    for (const map of [0, 1]) for (const real of [false, true]) now[`sw2/${map}/${real ? 'real' : 'classic'}`] = game(map, 31 + map, { sw: 2 }, real, [3, 2]);
    now['tech/1'] = game(1, 32, { sw: 2, tech: 1 }, false, [1, 3]);
    now['sw1/0'] = game(0, 31, { sw: 1 }, false, [3, 2]);
    assert.deepEqual(now, PINNED, 'hash: battles with sw 2, tech and sw 1 but no mine are bit for bit what main c31548b computes');
  },
  // 驗收 20：介面路由
  route() {
    const w = lay(camp(), mine(FOE, 2, 10, 10, 0, 1), mine(FOE, 1, 11, 10), mine(ME, 1, 12, 10, 50)), e = put(w, ME, UK_ENGINEER, 20, 16), tank = put(w, ME, UK_TANK, 20, 17), how = put(w, ME, UK_HOWITZER, 20, 18);
    const tap = (x, z, sel, opts = {}) => routeBattleOrder(w, sel, !!opts.fire, opts.ammo ?? 'he', { unit: opts.unit ?? 0, building: null, ground: { x: x + 0.5, z: z + 0.5 } });
    hint50(w); arm50(0); air93Arm(0);
    pick50(ITEM1009 + 1);
    assert.equal(armed1009(), 1, 'route: fixture — armed for anti-tank mines');
    assert.deepEqual(tap(16, 16, [e.id, tank.id])?.commands, [M(ME, [e.id], 1, 16, 15, { rot: 1, len: 3 })], 'route: armed, an engineer coming from the east taps a cell: a band of three along z, centred on it, for the engineer only');
    assert.equal(armed1009(), 0, 'route: sent, disarmed');
    pick50(ITEM1009 + 1); bld(w, BK_HOUSE, 16, 17);
    assert.deepEqual(tap(16, 16, [e.id])?.commands, [M(ME, [e.id], 1, 16, 16, { rot: 1, len: 1 })], 'route: three do not fit, one does: one cell is sent');
    pick50(ITEM1009 + 2);
    assert.equal(tap(16, 17, [e.id]), null, 'route: nothing fits: nothing is sent');
    assert.match(hint50(w) ?? '', /放不下：擋到了。布反人員雷/, 'route: the hint says why');
    assert.equal(armed1009(), 2, 'route: and it stays armed');
    pick50(ITEM1009 + 2);
    assert.equal(armed1009(), 0, 'route: the same key again disarms');
    assert.deepEqual(tap(10, 10, [e.id, tank.id])?.commands, [fire(ME, [e.id], 10, 10)], 'route: not armed, a tap on a known enemy mine sends only the engineer to clear it; the tank gets nothing');
    assert.deepEqual(tap(12, 10, [e.id, tank.id])?.commands, [fire(ME, [e.id], 12, 10)], 'route: a tap on our own unfinished cell sends the engineer back to lay it');
    const foe = put(w, FOE, UK_INFANTRY, 10, 10);
    assert.deepEqual(tap(10, 10, [e.id, tank.id], { unit: foe.id })?.commands, [{ t: 'attack', side: ME, ids: [e.id, tank.id], target: foe.id }], 'route: a tap on an enemy standing on a known mine is an attack as before');
    assert.deepEqual(tap(10, 10, [e.id, how.id], { fire: true, ammo: 'smoke' })?.commands, [{ t: 'fireAt', side: ME, ids: [how.id], x: 10, z: 10, ammo: 'smoke' }], 'route: in smoke fire mode the tap is a smoke mission as before');
    assert.deepEqual(tap(11, 10, [e.id, tank.id])?.commands, tap(13, 12, [e.id, tank.id])?.commands.map(c => ({ ...c, x: 11, z: 10 })), 'route: a tap on an enemy mine we do not know of routes like open ground');
    assert.deepEqual(tap(10, 10, [tank.id])?.commands, [move(ME, [tank.id], 10, 10)], 'route: without an engineer selected the tap routes as before');
  },
  // 驗收 21：介面
  ui() {
    assert.deepEqual(mine1009Items().map(i => [i.kind, i.label, i.cost, i.group]), [[1101, '反戰車雷', 15, '地雷'], [1102, '反人員雷', 10, '地雷']], 'ui: two items in the 地雷 group');
    assert.deepEqual([on1009({ r1009: true, r1002: true, r091: true }), on1009({ r1009: true, r1002: true, r091: false }), on1009({ r1009: true, r1002: false, r091: true }), on1009({ r1009: false, r1002: true, r091: true })], [true, false, false, false], 'ui: the 地雷 group and mine are on only when sw 2 is sent (R091 and R1002) and R1009 is on');
    const main = src('src/main.ts');
    assert(main.includes("const ecoCmd = (): Command => sw1002({ t: 'eco', ") && main.includes("...(on1009(V) ? { mine: 1 } : {}), "), 'ui: a new battle sends mine only through on1009');
    assert(main.includes('...(on1009(V) ? mine1009Items() : [])'), 'ui: the 地雷 group is there only through on1009');
    const w = camp(), e = put(w, ME, UK_ENGINEER, 20, 16);
    hint50(w); arm50(0); air93Arm(0);
    assert.equal(pick50(ITEM1009 + 1), true, 'ui: the 反戰車雷 key is taken (not production)');
    assert.equal(w.eco.queue[ME].length, 0, 'ui: nothing queued');
    assert.match(hint50(w) ?? '', /^布反戰車雷：先選工兵/, 'ui: armed, the hint says how to lay it');
    pick50(ITEM50 + 14);
    assert.deepEqual([armed1009(), armed50()], [0, 14], 'ui: a build key drops the mines');
    pick50(ITEM1009 + 2);
    assert.deepEqual([armed1009(), armed50()], [2, 0], 'ui: a mine key drops the build');
    pick50(UK_INFANTRY);
    assert.equal(armed1009(), 0, 'ui: any other production key drops the mines');
    pick50(ITEM1009 + 1); air93Arm(1); arm50(0);   // 空中鍵武裝：R1004 叫 arm50(0)
    assert.deepEqual([armed1009(), air93Armed()], [0, 1], 'ui: arming the air key drops the mines');
    const tap = () => routeBattleOrder(w, [e.id], false, 'he', { unit: 0, building: null, ground: { x: 16.5, z: 16.5 } });
    assert.equal(tap()?.commands[0].t, 'air', 'ui: mines then air: a tap calls the aircraft only');
    w.eco.supply[ME] = 500; air93Arm(1); pick50(ITEM1009 + 1);
    assert.deepEqual([armed1009(), air93Armed()], [1, 0], 'ui: arming a mine drops the air key');
    assert.equal(tap()?.commands[0].t, 'mine', 'ui: air then mines: a tap lays mines only');
    w.eco.supply[ME] = 0;
    assert.deepEqual([block50(w, ITEM1009 + 1), block50(w, ITEM1009 + 2), why1009(w, ME, 1), block50(w, UK_INFANTRY)], ['補給不足，還差 15', '補給不足，還差 10', '補給不足，還差 15', undefined], 'ui: the mine keys say why1009 without a position; unit keys keep their own reasons');
    pick50(ITEM1009 + 1); hint50(camp());
    assert.equal(armed1009(), 0, 'ui: a new world disarms');
    assert(/addEventListener\('keydown', e => \{ if \(\(e as KeyboardEvent\)\.key === 'Escape'\) \{ armed = 0; flash = ''; \} \}\);/.test(src('src/ui/mines1009.ts')), 'ui: Esc disarms (the browser guard presses it)');
  },
  // 驗收 22：地面貼圖
  async raster() {
    const paints = [], dirty = [];
    const r = new TrenchMines1009(true, (x, z) => paints.push(`${x},${z}`), () => dirty.push(1));
    const w = lay(camp(), mine(ME, 1, 10, 10), mine(ME, 2, 11, 10), mine(ME, 1, 12, 10, 30), mine(FOE, 1, 13, 10), mine(FOE, 1, 14, 10, 0, 1), mine(ME, 2, 15, 10), mine(FOE, 2, 15, 10, 0, 1));
    w.trenches = { version: 1, segments: [{ side: ME, kind: 0, x: 20, z: 20, rot: 0 }] };
    r.sync(w);
    assert.deepEqual([paints.length, dirty.length], [0, 0], 'raster: the first sync only builds the table (the ground texture does not exist yet)');
    const px = (c, x, z) => { const out = []; for (let py = 0; py < 8; py++) for (let p = 0; p < 8; p++) out.push(c.pixel(cellIdx(w, x, z), p, py)); return out; };
    const drawn = (x, z) => px(r, x, z).some(v => v >= 0);
    assert.deepEqual([10, 11, 12, 13, 14, 15].map(x => drawn(x, 10)), [true, true, true, false, true, true], 'raster: our mines (finished and being laid) and the enemy mine we know of are drawn; the one we do not know of is not');
    assert(px(r, 13, 10).every(v => v === -1), 'raster: every pixel of the unknown enemy cell keeps the ground');
    assert.deepEqual([px(r, 14, 10)[6], px(r, 15, 10)[6]], [0xc8231c, 0xc8231c], 'raster: a known enemy cell carries the red-topped stake (also when our cell is on the same spot)');
    assert.notEqual(px(r, 10, 10)[6], 0xc8231c, 'raster: our own cell has no stake');
    assert.notDeepEqual(px(r, 10, 10), px(r, 11, 10), 'raster: anti-tank and anti-personnel look different');
    assert.notDeepEqual(px(r, 12, 10), px(r, 10, 10), 'raster: a cell being laid looks different from a finished one');
    const plain = new TrenchRaster(true); plain.sync(w);
    assert.deepEqual(px(r, 20, 20), px(plain, 20, 20), 'raster: a trench cell is drawn as the trench');
    const off = new TrenchMines1009(false, () => {}, () => {}); off.sync(w);
    assert(px(off, 10, 10).some(v => v >= 0) && px(off, 20, 20).every(v => v === -1), 'raster: with ?noR118=1 (enabled false) the trench is hidden but the mines are drawn');
    w.mines.cells = w.mines.cells.filter(m => !(m.x === 10 && m.z === 10)); w.mines.cells.push(mine(ME, 1, 16, 10));
    r.sync(w);
    assert.deepEqual([paints.sort(), dirty.length], [['10,10', '16,10'], 1], 'raster: a change repaints only the changed cells and marks the rows once');
    const buf = r.mines;
    r.sync(w); r.sync(w);
    assert.deepEqual([paints.length, dirty.length, r.mines === buf], [2, 1, true], 'raster: two steps without a change: no paint, no upload, no allocation');
    const w2 = camp(); r.sync(w2, true);
    assert.deepEqual([[...new Set(paints.slice(2))].sort(), r.mines.every(v => v === 0)], [['11,10', '12,10', '14,10', '15,10', '16,10'], true], 'raster: a new world of the same size repaints every old cell and the table is empty');
    side.setViewSide(1);
    try { r.sync(w); assert.deepEqual([13, 14, 15, 11].map(x => r.mines[cellIdx(w, x, 10)] > 0), [true, true, true, false], 'raster: viewing side 1, its own mines show and our unseen ones do not'); }
    finally { side.setViewSide(); }
  },
  // 驗收 22（續）：真的 BattleView（Node）：建構一個有雷的世界、不走一步，那幾格的地面已經不一樣；setWorld 換成沒有雷的同一張圖，跟沒有雷的一模一樣
  async view() {
    const { BattleView } = await import('../src/render/battle.ts');
    const base = createWorld(5); step(base, [{ t: 'map', id: 1, vegetation: 1 }, eco({ sw: 2, mine: 1 })]); base.tick = 1;
    const spots = []; for (let z = 12; z < 20 && spots.length < 2; z++) for (let x = 12; x < 20 && spots.length < 2; x++) if (!base.occ[cellIdx(base, x, z)] && base.ter[cellIdx(base, x, z)] !== TER_MUD && !base.vegetation?.cells[cellIdx(base, x, z)]) spots.push([x, z]);
    const withMines = lay(structuredClone(base), mine(ME, 1, ...spots[0]), mine(ME, 2, ...spots[1])), noMines = structuredClone(base);
    const vm = new BattleView(withMines, { fog: false }), vp = new BattleView(noMines, { fog: false });
    const block = (v, [x, z]) => { const out = [], Wd = v.groundTex.image.width; for (let py = 0; py < 8; py++) for (let p = 0; p < 8; p++) { const o = ((z * 8 + py) * Wd + x * 8 + p) * 4; out.push(v.groundPx[o], v.groundPx[o + 1], v.groundPx[o + 2]); } return out.join(','); };
    assert(spots.every(s => block(vm, s) !== block(vp, s)), 'raster: the real BattleView built on a world with mines (no step) already shows them on the ground');
    vm.setWorld(structuredClone(base));
    assert(spots.every(s => block(vm, s) === block(vp, s)), 'raster: setWorld to the same map without mines leaves those cells exactly as without mines');
    vm.dispose(); vp.dispose();
  },
  // 驗收 23：接線
  wiring() {
    const lines = f => src(f).split('\n').length - (src(f).endsWith('\n') ? 1 : 0), budget = JSON.parse(src('tools/hub-budget.json'));
    assert.deepEqual([lines('src/main.ts'), lines('src/render/battle.ts')], [670, 1194], 'wiring: neither hub grew (main.ts 670, battle.ts 1194)');
    assert(JSON.stringify(budget).includes('672') && JSON.stringify(budget).includes('1195'), 'wiring: the hub budget is unchanged');
    assert(/get r1009\(\) \{ return on\('1009'\); \}/.test(src('src/valves.ts')) && src('README.md').includes('`?noR1009=1`'), 'wiring: the valve is in src/valves.ts and the README valve table');
    const cdp = src('tools/cdp.mjs');
    assert(cdp.includes("const full1009 = /(^|&)noR1009=/.test(full1007) ? full1007 : `${full1007 ? full1007 + '&' : ''}noR1009=1`;") && cdp.includes('const url87 = /(^|&)noR087=/.test(full92) ? full1009 :'), 'wiring: tools/cdp.mjs opens pages with noR1009=1 unless a guard asks for it (url87 keeps its anchored start)');
    // 這張碰到的既有行上被別的守衛錨著的文字（施工時 grep 過）：每一段照舊只出現一次
    const anchors = [
      ['src/sim/step.ts', '  for (const u of w.units) if (u.alive && !u.ride && !u.towBy) fireUnit(w, u);'], ['src/sim/step.ts', 'cmd.sw === 2 ? 2 : cmd.sw === 1 ? 1 : 0'],
      ['src/sim/eco.ts', '  if (tech && w.eco.sw === 2) w.eco.tech = 1;'], ['src/sim/commandCheck.ts', "    case 'construct': return side(c.side) && ids(c.ids) && int(c.kind) && int(c.x) && int(c.z);   // R050\n"],
      ['src/sim/worldCodec.ts', '  if (!techOk(r)) return null;'], ['src/sim/engineer1002.ts', '  const t = demoTarget(w, gx, gz);\n  if (!t) return;'],
      ['src/ui/tech50.ts', '  if (!isItem(kind)) return false;\n'], ['src/ui/smoke.ts', '  const b50 = tech50Route(w, selected, hit); if (b50 !== undefined) return b50;'],
      ['src/main.ts', "const ecoCmd = (): Command => sw1002({ t: 'eco',"], ['src/main.ts', '...(V.r093 ? aa93Items() : []), ...(V.r050 && V.r1002 ? tech50Items() : [])'],
      ['src/main.ts', "produce: kind => { if (pick50(kind)) hud?.update(); else issue({ t: 'produce', side: SIDE_PLAYER, kind }); },"], ['src/main.ts', 'const sw1002 = (c: Command): Command => (V.r1002 && V.r091 ? { ...c, sw: 2 } as Command : c);'],
      ['src/render/battle.ts', '    this.trench118.sync(w, true);'], ['src/render/battle.ts', 'if (this.trench118.sync(this.w, trenchEvent)) {'],
      ['tools/cdp.mjs', "const full50 = /(^|&)noR050=/.test(full1002) ? full1002 : `${full1002 ? full1002 + '&' : ''}noR050=1`;"], ['tools/cdp.mjs', 'const url87 = /(^|&)noR087=/.test(full92)'],
    ];
    for (const [f, a] of anchors) assert.equal(src(f).split(a).length - 1, 1, `wiring: ${f} still carries the anchored text once: ${JSON.stringify(a).slice(0, 80)}`);
  },
  // 驗收 24：純度、紅線
  purity() {
    const s = src('src/sim/mines1009.ts'), code = s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|rng\.ts|randInt|nextU32|Date\b|performance/.test(code), 'purity: no floats, no **, no randomness, no clock in mines1009.ts');
    for (const m of s.matchAll(/from '([^']+)'/g)) assert(/^\.\/[a-zA-Z0-9]+\.ts$/.test(m[1]), `purity: mines1009.ts imports only ./x.ts (${m[1]})`);
    assert(!/side\.ts/.test(s), 'purity: the simulation does not import side.ts');
  },
  redline() {
    const text = ['src/sim/mines1009.ts', 'src/ui/mines1009.ts', 'src/render/mines1009.ts'].map(src).join('\n').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const bad = ['Teller', 'S-mine', 'Mk', 'G.S.', 'Wehrmacht', 'Royal', '德軍', '英軍', '德國', '英國', '納粹', '皇家', '徽', '骷髏'].filter(word => text.includes(word));
    assert.deepEqual(bad, [], `redline: no mine type names, armies, nationalities, insignia or skulls in the R1009 files (${bad})`);
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  await groups[name]();
  console.log(`OK mines1009/${name}`);
}
console.log('mines1009: all OK');
