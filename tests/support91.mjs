// R091 步兵支援兵器（一）：狙擊手（42）、反戰車小組（43）。不開瀏覽器的部分，卡面驗收 2–21。
// 用法：node tests/support91.mjs            全部各群
//       node tests/support91.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/support91-negative.mjs）
// 電腦（驗收 22–24）在 tests/support91-ai.mjs；難度的高下與量測在 tests/support91-duel-*.mjs；真 Chrome 在 tests/support91-browser.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, SHELL_AP, SHELL_SMALL,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_HEAVY, UK_DESTROYER, UK_ZOMBIE, UK_MG, UK_SNIPER, UK_AT91, BK_HOUSE, bldMaxHp, wireBlocks, ORD_ATTACK } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi } from '../src/sim/ai.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { PRODUCIBLE } from '../src/sim/eco.ts';
import { PEN_MM } from '../src/sim/ballistics.ts';
import { VEG_HEDGE } from '../src/sim/vegetation.ts';
import { fireDisciplineEligible } from '../src/sim/fireDiscipline.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { bombardStatus } from '../src/ui/bombardStatus.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32），上面只放守衛自己擺的東西
function field(rules, sym = false) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  if (rules) applyRules(w, rules);
  if (sym) w.sym = 1;
  return w;
}
// 預設不開火（cooldown 很大）；ready＝一開始就能打；hull＝車頭朝哪（有裝甲的才有）
function put(w, side, kind, cx, cz, ready = false, hull = [SUB, 0]) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: hull[0], hullZ: hull[1] } : {}) };
  w.units.push(u);
  return u;
}
function house(w, x, z) {
  const maxHp = bldMaxHp(BK_HOUSE, 1, 1, 1), b = { id: w.blds.length + 1, kind: BK_HOUSE, x, z, w: 1, d: 1, floors: 1, hp: maxHp, maxHp };
  w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id;
  return b;
}
const fires = (w, u, n, cmds = []) => { let c = 0; for (let i = 0; i < n; i++) { step(w, i === 0 ? cmds : []); c += w.events.filter(e => e.e === 'fire' && e.unit === u.id).length; } return c; };
// 跑到 shooter 的下一發落地：回傳 { hp 少了多少, impact 事件 }
function nextHit(w, shooter, target, limit = 400) {
  const hp = target.hp;
  for (let i = 0; i < limit; i++) {
    step(w, []);
    const ev = w.events.find(e => e.e === 'impact' && w.shells.every(s => s.shooter !== shooter.id));
    if (ev) return { dmg: hp - target.hp, ev };
  }
  return { dmg: hp - target.hp, ev: null };
}
// 一場只有 shooter 打 target 的戰鬥：第幾發、每發扣多少，直到 target 倒或 maxShots
function shots(w, shooter, target, maxShots = 40) {
  const out = [];
  for (let i = 0; i < maxShots && target.alive; i++) { const { dmg, ev } = nextHit(w, shooter, target); if (!ev) break; out.push(dmg); }
  return out;
}
const INF_COL = 3;   // report.ts 的 KINDS＝[坦克、榴彈砲、觀測員、步兵]
const IS2 = 17, SU152 = 20, PANTHER = 31, TIGER = 32;   // world.ts 的蘇式、德式編號
const PINNED = { '0/classic': '443e8146', '0/real': '246268d8', '1/classic': '099229c9', '1/real': '4b74da1e' };   // 937fed5（R091 之前）
const ROW = {   // 卡面「做什麼」第 1 節的表（守衛自己抄一份）
  [UK_SNIPER]: { name: '狙擊手', hp: 20, speed: 12, range: 11 * SUB, minRange: 0, reload: 60, indirect: false, dmgUnit: 10, dmgBld: 1, splash: 0, sight: 11 * SUB, armor: 100, radius: 0, cost: 30, buildTicks: 240, garrison: true, armored: false, pierce: 10, men: 2, soft: 100, setup: true, team91: 1, hold: true },
  [UK_AT91]: { name: '反戰車小組', hp: 30, speed: 12, range: 3 * SUB, minRange: 0, reload: 100, indirect: false, dmgUnit: 60, dmgBld: 20, splash: 0, sight: 7 * SUB, armor: 100, radius: 0, cost: 25, buildTicks: 200, garrison: false, armored: false, pierce: 100, men: 2, soft: 25, setup: true, team91: 2, hollow: true, hold: true },
};
const eco = extra => ({ ...ECO, end: 1, mg: 2, pla: 1, ...extra });
function game(map, seed, extra, rules, ais, ticks) {
  const w = createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(extra), ...(rules ? [{ t: 'rules', ...rules }] : []), ...ais]);
  while (w.tick < ticks && w.winner < 0) step(w, []);
  return w;
}

const groups = {
  // 驗收 2、5：舊局逐位不變；旗標、雜湊、指令檢查、兵種表
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const now = {};
    for (const map of [0, 1]) for (const real of [false, true]) now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(game(map, 31 + map, {}, real ? { ap: 1, morale: 2 } : null, [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }], 3000));
    assert.deepEqual(now, PINNED, 'flag: four third-version battles without sw are bit for bit what they were at 937fed5');
    const opened = extra => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, eco(extra)]); return w; };
    const plain = opened({}), on = opened({ sw: 1 }), two = opened({ sw: 2 });
    assert.deepEqual([plain.eco.sw, on.eco.sw, two.eco.sw], [undefined, 1, undefined], 'flag: sw is stored only when the eco command sends 1 (2 is reserved for the next card)');
    assert.notEqual(hashWorld(on), hashWorld(plain), 'flag: sw is folded into the hash');
    assert.equal(hashWorld(two), hashWorld(plain), 'flag: sw 2 leaves no trace yet');
    assert.deepEqual(on.units.map(u => u.kind).sort(), plain.units.map(u => u.kind).sort(), 'flag: no starting units for sw (the opening is the same as without it)');
    for (const bad of ['x', 1.5, '1']) assert.equal(isCommand({ ...ECO, sw: bad }), false, `flag: the command check refuses sw ${JSON.stringify(bad)}`);
    assert.equal(isCommand({ ...ECO, sw: 1 }), true, 'flag: the command check takes sw 1');
    assert.equal(UNIT_KINDS.length, 44, 'flag: two kinds appended (42, 43)');
    for (const kind of [UK_SNIPER, UK_AT91]) assert.deepEqual(UNIT_KINDS[kind], ROW[kind], `flag: kind ${kind} matches the card's table`);
    assert.deepEqual([UNIT_KINDS[UK_SNIPER].range, PEN_MM[UK_SNIPER], PEN_MM[UK_AT91]], [11 * SUB, [10, 3], [85, 80]], 'flag: sniper range 11 cells; penetration 10/3 and 85/80');
    assert(PRODUCIBLE.includes(UK_SNIPER) && PRODUCIBLE.includes(UK_AT91), 'flag: both are producible');
  },
  // 驗收 3、7：沒有 sw 造不出來；帶 sw 照價錢與時間造；喪屍防守不開放
  produce() {
    const opened = (extra, zombies = false) => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, ...(zombies ? [{ t: 'zombies' }] : []), eco(extra)]); return w; };
    for (const kind of [UK_SNIPER, UK_AT91]) {
      const w = opened({}), s = w.eco.supply[ME];
      step(w, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([w.eco.queue[ME].length, w.eco.supply[ME]], [0, s], `noflag: kind ${kind} cannot be produced without sw`);
      assert.equal(productionBlockReason(w, kind), '本局未開放此單位', `noflag: kind ${kind} says 本局未開放此單位`);
      const z = opened({ sw: 1 }, true), sz = z.eco.supply[ME];
      step(z, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([z.eco.queue[ME].length, z.eco.supply[ME], productionBlockReason(z, kind)], [0, sz, '本局未開放此單位'], `produce: zombie defence does not offer kind ${kind}, even with sw`);
      const g = opened({ sw: 1 }), s0 = g.eco.supply[ME], n0 = g.units.length, k = UNIT_KINDS[kind];
      step(g, [{ t: 'produce', side: ME, kind }]);
      assert.equal(s0 - g.eco.supply[ME] - (g.tick % 20 === 0 ? 1 : 0), k.cost, `produce: kind ${kind} costs ${k.cost}`);
      let at = -1;
      for (let i = 0; i < 400 && at < 0; i++) { step(g, []); if (g.units.length > n0) at = g.tick; }
      const u = g.units.at(-1), hq = g.blds[g.eco.hq[ME] - 1];
      assert(at > 0 && u.kind === kind && u.side === ME && Math.abs(cellOf(u.x) - hq.x) <= 3 && Math.abs(cellOf(u.z) - hq.z) <= 3, `produce: kind ${kind} appears next to the HQ (${at})`);
      assert.equal(at - 2, k.buildTicks, `produce: kind ${kind} takes ${k.buildTicks} steps (the queue counts to buildTicks, then spawns the step after, like every kind)`);
    }
  },
  // 驗收 6：存檔（第 1,500 步：一組進駐的狙擊手、一組裝填到一半在停火的反戰車小組）
  save() {
    const w = createWorld(1944);
    step(w, [{ t: 'map', id: 1, vegetation: 1 }, eco({ sw: 1 }), { t: 'produce', side: ME, kind: UK_SNIPER }, { t: 'produce', side: ME, kind: UK_AT91 }, { t: 'ai', side: FOE, level: 2, v: 3 }]);
    while (w.tick < 1000) step(w, []);
    const sn = w.units.find(u => u.kind === UK_SNIPER && u.alive), at = w.units.find(u => u.kind === UK_AT91 && u.alive);
    assert(sn && at, 'save: both teams were built');
    const b = w.blds.filter(b => b.hp > 0 && b.kind === BK_HOUSE).sort((a, c) => (Math.abs(a.x - cellOf(sn.x)) + Math.abs(a.z - cellOf(sn.z))) - (Math.abs(c.x - cellOf(sn.x)) + Math.abs(c.z - cellOf(sn.z))) || a.id - c.id)[0];
    step(w, [{ t: 'move', side: ME, ids: [sn.id], x: b.x, z: b.z }, { t: 'fireDiscipline', side: ME, ids: [at.id], hold: true }]);
    at.cooldown = 37;
    while (w.tick < 1500) step(w, []);
    assert(cellOf(sn.x) === b.x && cellOf(sn.z) === b.z && at.holdFire === 1, 'save: at tick 1,500 the sniper is in the house and the AT team holds fire');
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert(back, 'save: the world with sw and both teams reads back');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
    assert.equal(hashWorld(back), hashWorld(w), 'save: 600 steps after loading, the hash equals the uninterrupted run');
    const raw = JSON.parse(JSON.stringify(encodeWorld(w)));
    assert.equal(decodeWorld({ ...raw, eco: { ...raw.eco, sw: 2 } }), null, 'save: sw 2 is refused');
    const { sw, ...noSw } = raw.eco;
    assert.equal(decodeWorld({ ...raw, eco: noSw }), null, 'save: a save with kind 42/43 units but no sw is refused');
  },
  // 驗收 8：射程（行為照表推；另外寫死 11 格）、要停下來才能打
  srange() {
    const R = UNIT_KINDS[UK_SNIPER].range / SUB;
    assert.equal(R, 11, 'srange: the sniper reaches 11 cells');
    { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true); put(w, FOE, UK_INFANTRY, 4 + R, 16); assert(fires(w, s, 5) >= 1, 'srange: a target at R cells is shot'); }
    { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true); put(w, FOE, UK_INFANTRY, 5 + R, 16); assert.equal(fires(w, s, 300), 0, 'srange: a target at R + 1 cells is never shot in 300 steps'); }
    { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true); put(w, FOE, UK_INFANTRY, 10, 16); assert.equal(fires(w, s, 20, [{ t: 'move', side: ME, ids: [s.id], x: 4, z: 28 }]), 0, 'srange: no shot while moving'); }
  },
  // 驗收 9：一發打倒一個人
  oneman() {
    const series = (kind, opts = {}) => { const w = field(opts.rules), s = put(w, ME, UK_SNIPER, 4, 16, true), t = put(w, FOE, kind, 10, 16); if (opts.hedge) w.vegetation.cells[cellIdx(w, 10, 16)] = VEG_HEDGE; put(w, ME, UK_OBSERVER, 6, 16); return shots(w, s, t, opts.max ?? 40); };
    assert.deepEqual(series(UK_INFANTRY), [10, 10, 10, 10, 10, 10], 'oneman: a rifle section loses one man (10) a shot, gone on the 6th');
    assert.deepEqual(series(UK_MG), [14, 14, 12], 'oneman: a machine-gun team loses 14 a shot, gone on the 3rd');
    assert.deepEqual(series(UK_OBSERVER), [30], 'oneman: an observer falls to one shot');
    assert.deepEqual(series(UK_MORTAR), [10, 10, 10, 10], 'oneman: a mortar crew loses 10 a shot, gone on the 4th');
    assert.deepEqual(series(UK_ZOMBIE, { max: 3 }), [2, 2, 2], 'oneman: a zombie takes 2 a shot (armour 20%)');
    assert.deepEqual(series(UK_DESTROYER, { max: 2 }), [10, 10], 'oneman: an open-top destroyer takes the table 10 a shot');
    assert.deepEqual(series(UK_INFANTRY, { hedge: true, max: 2 }), [5, 5], 'oneman: a section in a hedge takes 5 a shot');
  },
  // 驗收 10：挑目標
  tiers() {
    const first = (setup, n = 80) => { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true), us = setup(w); for (let i = 0; i < n; i++) { step(w, []); const ev = w.events.find(e => e.e === 'impact' && !e.bld); if (ev) { const hit = us.find(u => u.hp < UNIT_KINDS[u.kind].hp); return hit ? hit.kind : -1; } } return -2; };
    assert.equal(first(w => [put(w, FOE, UK_OBSERVER, 14, 16), put(w, FOE, UK_INFANTRY, 12, 16)]), UK_OBSERVER, 'tiers: an observer at 10 cells before a section at 8');
    assert.equal(first(w => [put(w, FOE, UK_MG, 13, 16), put(w, FOE, UK_INFANTRY, 12, 16)]), UK_MG, 'tiers: a machine-gun team at 9 before a section at 8');
    assert.equal(first(w => [put(w, FOE, UK_MORTAR, 13, 16), put(w, FOE, UK_INFANTRY, 12, 16)]), UK_MORTAR, 'tiers: a gun crew at 9 before a section at 8');
    { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true), a = put(w, FOE, UK_INFANTRY, 12, 16), b = put(w, FOE, UK_INFANTRY, 10, 16); shots(w, s, b, 1); assert.deepEqual([a.hp, b.hp], [60, 50], 'tiers: within a tier the nearer one first'); }
    { const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true); put(w, FOE, UK_TANK, 10, 16); assert.equal(fires(w, s, 600), 0, 'tiers: a closed tank alone in range draws no shot in 600 steps'); }
    for (const [rules, want] of [[null, 1], [{ ap: 1 }, 0]]) { const w = field(rules), s = put(w, ME, UK_SNIPER, 4, 16, true), t = put(w, FOE, UK_TANK, 10, 16); step(w, [{ t: 'attack', side: ME, ids: [s.id], target: t.id }]); assert.equal(nextHit(w, s, t).dmg, want, `tiers: an attack order on a medium tank does ${want} a shot (${rules ? 'ap' : 'classic'})`); }
  },
  // 驗收 11：藏得住（站在射程邊上的步兵班看不到它）；有觀測員就看得到
  hide() {
    const w = field(), s = put(w, ME, UK_SNIPER, 4, 16, true), inf = put(w, FOE, UK_INFANTRY, 15, 16);
    for (let i = 0; i < 600 && inf.alive; i++) { step(w, []); assert(!spotted(w, FOE, s.x, s.z), `hide: the section at the edge of range never spots the sniper (step ${w.tick})`); }
    assert(!inf.alive && s.hp === 20, 'hide: the section is gone and the sniper untouched');
    const v = field(); const s2 = put(v, ME, UK_SNIPER, 4, 16, true); put(v, FOE, UK_INFANTRY, 15, 16); put(v, FOE, UK_OBSERVER, 17, 16);
    step(v, []);
    assert(spotted(v, FOE, s2.x, s2.z), 'hide: an observer 13 cells away spots it at once');
  },
  // 驗收 12：進駐
  garrison() {
    const w = field(), b = house(w, 6, 16), s = put(w, ME, UK_SNIPER, 6, 16, true), inf = put(w, FOE, UK_INFANTRY, 14, 16), tank = put(w, FOE, UK_TANK, 9, 16, true);
    assert(fires(w, s, 120) >= 1 && inf.hp < 60, 'garrison: from inside the house it still shoots out');
    let tankShots = 0; for (let i = 0; i < 600; i++) { step(w, []); tankShots += w.events.filter(e => e.e === 'fire' && e.unit === tank.id).length; }
    assert.equal(tankShots, 0, 'garrison: an idle enemy tank 3 cells away never picks the garrisoned sniper in 600 steps');
    b.hp = 1; const t2 = put(w, FOE, UK_TANK, 9, 17, true); step(w, [{ t: 'fireAt', side: FOE, ids: [t2.id], x: 6, z: 16 }]);
    for (let i = 0; i < 200 && b.hp > 0; i++) step(w, []);
    assert(b.hp === 0 && !s.alive, 'garrison: when the house falls the sniper dies with it');
  },
  // 驗收 13、14：反戰車小組的射程、彈種、挑目標
  arange() {
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true); put(w, FOE, UK_TANK, 7, 16); let kind = -1; for (let i = 0; i < 10 && kind < 0; i++) { step(w, []); const ev = w.events.find(e => e.e === 'impact'); if (ev) kind = ev.kind; } assert.equal(kind, SHELL_AP, 'arange: a tank at 3 cells is hit, and the impact is an armour-piercing round'); }
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true); put(w, FOE, UK_TANK, 8, 16); assert.equal(fires(w, a, 300), 0, 'arange: a tank at 4 cells is never shot in 300 steps'); }
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true); put(w, FOE, UK_TANK, 6, 16); assert.equal(fires(w, a, 20, [{ t: 'move', side: ME, ids: [a.id], x: 4, z: 28 }]), 0, 'arange: no shot while moving'); }
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true), inf = put(w, FOE, UK_INFANTRY, 5, 16), t = put(w, FOE, UK_TANK, 7, 16); nextHit(w, a, t); assert(t.hp < 100 && inf.hp === 60, 'atarget: a section at 1 cell and a tank at 3: it shoots the tank'); }
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true); put(w, FOE, UK_INFANTRY, 6, 16); assert.equal(fires(w, a, 600), 0, 'atarget: with only a section in range it never fires in 600 steps'); }
    { const w = field(), a = put(w, ME, UK_AT91, 4, 16, true), inf = put(w, FOE, UK_INFANTRY, 6, 16); step(w, [{ t: 'attack', side: ME, ids: [a.id], target: inf.id }]); assert.equal(nextHit(w, a, inf).dmg, 15, 'atarget: an attack order on a section does 15 a shot'); }
    const pick = (rules, setup) => { const w = field(rules), a = put(w, ME, UK_AT91, 4, 16, true), us = setup(w); nextHit(w, a, us[0]); return us.findIndex(u => u.hp < UNIT_KINDS[u.kind].hp || w.events.some(e => e.e === 'impact' && e.bounce)); };
    assert.equal(pick({ ap: 1 }, w => [put(w, FOE, TIGER, 6, 16, false, [-SUB, 0]), put(w, FOE, UK_TANK, 6, 17, false, [-SUB, 0])]), 1, 'atarget: ap rules, a Tiger front and a medium tank front: the medium tank first (one it can pierce)');
    assert.equal(pick({ ap: 1 }, w => [put(w, FOE, UK_TANK, 6, 16, false, [-SUB, 0]), put(w, FOE, UK_TANK, 6, 17, false, [0, SUB])]), 1, 'atarget: ap rules, two it can pierce: the one showing its side');
    assert.equal(pick(null, w => [put(w, FOE, UK_TANK, 6, 16, false, [-SUB, 0]), put(w, FOE, UK_TANK, 6, 17, false, [SUB, 0])]), 1, 'atarget: classic rules, the one showing its rear first');
  },
  // 驗收 15、16：傷害
  adamage() {
    const one = (rules, kind, hull, cells = 3) => { const w = field(rules), a = put(w, ME, UK_AT91, 4, 16, true), t = put(w, FOE, kind, 4 + cells, 16, false, hull); const { dmg, ev } = nextHit(w, a, t); return { dmg, bounce: !!ev?.bounce }; };
    const F = [-SUB, 0], S = [0, SUB], B = [SUB, 0];   // 車頭朝小組＝正面
    assert.deepEqual([F, S, B].map(h => one(null, UK_TANK, h).dmg), [45, 60, 75], 'classic: a medium tank takes 45 / 60 / 75 (front / side / rear)');
    assert.deepEqual([F, S, B].map(h => one(null, UK_HEAVY, h).dmg), [31, 42, 52], 'classic: a heavy tank takes 31 / 42 / 52');
    assert.equal(one(null, UK_DESTROYER, S).dmg, 60, 'classic: an open-top destroyer side takes 60 (not 15)');
    const AP = { ap: 1 };
    assert.equal(one(AP, UK_TANK, F).dmg, 60, 'ap: a medium tank front takes 60');
    assert.deepEqual(one(AP, TIGER, F, 1), { dmg: 0, bounce: true }, 'ap: a Tiger front at 1 cell bounces (no damage, a bounce event)');
    assert.equal(one(AP, TIGER, S).dmg, 39, 'ap: a Tiger side at 3 cells takes 39');
    assert.deepEqual([one(AP, PANTHER, F), one(AP, PANTHER, S).dmg], [{ dmg: 0, bounce: true }, 48], 'ap: a Panther front bounces, its side takes 48');
    assert.deepEqual([one(AP, IS2, S), one(AP, IS2, B).dmg], [{ dmg: 0, bounce: true }, 42], 'ap: an IS-2 side bounces, its rear takes 42');
    assert.deepEqual([one(AP, SU152, F, 1).dmg, one(AP, SU152, F, 2)], [UNIT_KINDS[SU152].armor * 60 / 100 | 0, { dmg: 0, bounce: true }], 'ap: an SU-152 front is pierced at 1 cell and bounces at 2');
    assert.equal(one(AP, UK_DESTROYER, F).dmg, 60, 'ap: an open-top destroyer hit from the front takes 60');
    { const w = field(AP), a = put(w, ME, UK_AT91, 4, 16, true), inf = put(w, FOE, UK_INFANTRY, 6, 16); step(w, [{ t: 'attack', side: ME, ids: [a.id], target: inf.id }]); assert.equal(nextHit(w, a, inf).dmg, 15, 'ap: a section takes 15'); }
  },
  // 驗收 17：埋伏（經典、擬真各一次）。座標寫死：路 z＝20；兩組在 (15,22)、(17,22)；z＝21 整列樹籬 x＝5–27；觀測員在 (16,8)（離路 12 格）
  ambush() {
    for (const rules of [null, { ap: 1 }]) {
      const scene = (release, hedge = true) => {
        const w = field(rules);
        for (let x = 0; x < w.n; x++) w.ter[cellIdx(w, x, 20)] = 1;
        if (hedge) for (let x = 5; x <= 27; x++) w.vegetation.cells[cellIdx(w, x, 21)] = VEG_HEDGE;
        const a = put(w, ME, UK_AT91, 15, 22, true), b = put(w, ME, UK_AT91, 17, 22, true);
        put(w, ME, UK_OBSERVER, 16, 8);
        const tank = put(w, FOE, UK_TANK, 1, 20, true);
        step(w, [{ t: 'fireDiscipline', side: ME, ids: [a.id, b.id], hold: true }, { t: 'move', side: FOE, ids: [tank.id], x: 30, z: 20 }]);
        let seen = false, teamFires = 0, tankFires = 0, released = -1;
        for (let i = 0; i < 400 && tank.alive && a.alive && b.alive; i++) {
          if (released < 0 && release && cellOf(tank.x) === 16) { released = w.tick; step(w, [{ t: 'fireDiscipline', side: ME, ids: [a.id, b.id], hold: false }]); }
          else step(w, []);
          if (released < 0 && (spotted(w, FOE, a.x, a.z) || spotted(w, FOE, b.x, b.z))) seen = true;
          teamFires += w.events.filter(e => e.e === 'fire' && (e.unit === a.id || e.unit === b.id)).length;
          tankFires += w.events.filter(e => e.e === 'fire' && e.unit === tank.id).length;
        }
        return { w, a, b, tank, seen, teamFires, tankFires, released };
      };
      const tag = rules ? 'ap' : 'classic', r = scene(true);
      assert(!r.seen, `ambush (${tag}): behind the hedge row the tank never spots either team before the release`);
      assert.deepEqual([r.released, r.tank.alive, r.w.tick], [189, false, 191], `ambush (${tag}): released at step 189 when the tank is between the teams, the tank dies at step 191`);
      assert.deepEqual([r.teamFires, r.tankFires, r.a.hp, r.b.hp], [2, 0, 30, 30], `ambush (${tag}): one shot each, the tank never fires, both teams untouched`);
      const never = scene(false);
      assert.deepEqual([never.teamFires, never.tank.alive], [0, true], `ambush (${tag}): never released, the tank drives past and no team fires`);
      // 對照：同一組站在空地上（沒有樹籬、不停火），坦克從遠處沿路開過來：小組一發都還沒打就陣亡
      { const w = field(rules); for (let x = 0; x < w.n; x++) w.ter[cellIdx(w, x, 20)] = 1;
        const a = put(w, ME, UK_AT91, 15, 22, true), tank = put(w, FOE, UK_TANK, 1, 20, true); put(w, ME, UK_OBSERVER, 16, 8);
        step(w, [{ t: 'move', side: FOE, ids: [tank.id], x: 30, z: 20 }]);
        let af = 0; for (let i = 0; i < 400 && a.alive; i++) { step(w, []); af += w.events.filter(e => e.e === 'fire' && e.unit === a.id).length; }
        assert(!a.alive && af === 0, `ambush (${tag}): in the open, a tank driving up kills the team before it fires`); }
    }
  },
  // 驗收 18–20：停火、鐵絲網、戰報
  shared() {
    for (const kind of [UK_SNIPER, UK_AT91]) {
      const target = kind === UK_SNIPER ? UK_INFANTRY : UK_TANK, cells = kind === UK_SNIPER ? 6 : 2;
      { const w = field(), u = put(w, ME, kind, 4, 16, true); put(w, FOE, target, 4 + cells, 16);
        assert.equal(fires(w, u, 100, [{ t: 'fireDiscipline', side: ME, ids: [u.id], hold: true }]), 0, `hold: kind ${kind} holds fire with a target in range`);
        step(w, [{ t: 'fireDiscipline', side: ME, ids: [u.id], hold: false }]);
        assert(w.events.some(e => e.e === 'fire' && e.unit === u.id), `hold: kind ${kind} fires in the step that releases it (cooldown ready)`); }
      for (const sym of [false, true]) { const w = field(null, sym), u = put(w, FOE, kind, 4, 16, true); put(w, ME, target, 4 + cells, 16);
        const n = fires(w, u, 100, [{ t: 'fireDiscipline', side: FOE, ids: [u.id], hold: true }]);
        assert(sym ? n === 0 : n > 0, `hold: side 1 kind ${kind} ${sym ? 'takes' : 'ignores'} a hold order in a ${sym ? 'sym' : 'plain'} world (${n})`); }
      { const w = field(), u = put(w, ME, kind, 4, 16); assert(fireDisciplineEligible(u, w) && bombardStatus(w, new Set([u.id])) === '', `hold: kind ${kind} is under fire discipline, and the bombard status line stays empty`); }
      // 鐵絲網：帶 sw 的世界擋得住；沒有 sw 的空世界照舊（wire.mjs）
      { const w = field(); w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], sw: 1 }; w.wires = { segments: [{ id: 1, kind: 0, x: 10, z: 0, w: 1, d: 32, floors: 1, hp: 60, maxHp: 60 }] };
        assert(wireBlocks(w, 10, 5, kind), `wire: an intact wire cell stops kind ${kind} when sw is on`);
        w.wires.segments[0].hp = 0;
        assert(!wireBlocks(w, 10, 5, kind), `wire: a destroyed wire cell lets kind ${kind} pass`);
        delete w.eco.sw; w.wires.segments[0].hp = 60;
        assert(!wireBlocks(w, 10, 5, kind), `wire: without sw the foot list is unchanged for kind ${kind}`); }
    }
    // 戰報：兩種都算在步兵那一欄（開局、剩下、陣亡）
    { const w = field(), col = INF_COL;
      w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], sw: 1 };
      put(w, ME, UK_SNIPER, 4, 4); put(w, ME, UK_AT91, 5, 4); const foe = put(w, FOE, UK_AT91, 20, 20);
      const st = newStats(w); foe.alive = false; foe.hp = 0; statsStep(st, w, [{ e: 'kill', unit: foe.id }]);
      const r = makeReport(w, st);
      assert.deepEqual([r.start[0][col], r.start[1][col], r.left[0][col], r.left[1][col], r.lost, r.kills], [2, 1, 2, 0, 0, 1], 'report: both kinds count in the infantry column (start, left, dead)'); }
  },
  // 驗收 4、22–24（刪減第 1、2 項之後）：電腦永遠不造、不指揮這兩種兵；帶 sw 的局，第二版、第三版電腦每一步的世界跟不帶 sw 的一樣（雜湊扣掉 sw 那一項）、
  // 勝負與結束的步數一樣；第三版的迫擊砲、榴彈砲：看得到對方的狙擊手就先打它（機槍組更前面），看不到的不拿來做決定
  quiet() {
    const noSw = w => { const s = w.eco?.sw; if (s) delete w.eco.sw; const h = hashWorld(w); if (s) w.eco.sw = s; return h; };
    for (const v of [2, 3]) for (const map of [0, 1]) for (let seed = 1; seed <= 5; seed++) {
      const open = sw => { const w = createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco(sw ? { sw: 1 } : {}), { t: 'ai', side: ME, level: 3, v }, { t: 'ai', side: FOE, level: 3, v }]); return w; };
      const a = open(true), b = open(false);
      while (a.tick < 36000 && (a.winner < 0 || b.winner < 0)) {
        step(a, []); step(b, []);
        if (a.tick % 50 === 0 || a.winner >= 0 || b.winner >= 0) assert.equal(noSw(a), noSw(b), `quiet: v${v} map ${map} seed ${seed}: with sw the world is the same as without it at step ${a.tick}`);
        assert(!a.eco.queue.some(q => q.includes(UK_SNIPER) || q.includes(UK_AT91)), `quiet: v${v} never queues a sniper or an AT team`);
      }
      assert.deepEqual([a.winner, a.tick], [b.winner, b.tick], `quiet: v${v} map ${map} seed ${seed}: same winner, same last step`);
    }
  },
  counter() {
    const scene = ({ sw = true, mg = false, spotter = true } = {}) => {
      const w = field(); w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], ...(sw ? { sw: 1 } : {}) };
      const mortar = put(w, ME, UK_MORTAR, 8, 16); if (spotter) put(w, ME, UK_OBSERVER, 12, 20);
      const sq = put(w, FOE, UK_INFANTRY, 13, 17), sn = put(w, FOE, UK_SNIPER, 18, 18), gun = mg ? put(w, FOE, UK_MG, 17, 14) : null;
      setAi(w, ME, 3, 3); step(w, []);
      return { mortar, sq, sn, gun };
    };
    const s1 = scene(), s2 = scene({ mg: true }), s3 = scene({ spotter: false }), s4 = scene({ sw: false });
    assert.deepEqual([s1.mortar.order, s1.mortar.target], [ORD_ATTACK, s1.sn.id], 'counter: the mortar shells the sniper before the nearer section');
    assert.deepEqual([s2.mortar.order, s2.mortar.target], [ORD_ATTACK, s2.gun.id], 'counter: a machine gun still comes before the sniper');
    assert.notEqual(s3.mortar.target, s3.sn.id, 'counter: an unseen sniper is not acted on');
    assert.notEqual(s4.mortar.target, s4.sn.id, 'counter: without sw the third version does not single out snipers');
  },
  // 接線（文字檢查；瀏覽器守衛驗真的行為）：頁面照閥送 sw、照閥放「步兵支援」那一組；兩種兵照兵種畫（不看閥）；既有的瀏覽器守衛預設不帶 sw
  wiring() {
    const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const main = src('src/main.ts'), battle = src('src/render/battle.ts'), cdp = src('tools/cdp.mjs');
    assert(main.includes('...(V.r091 ? { sw: 1 } : {}), ...(V.r095 ? { pla: 1 } : {})'), 'wiring: a new battle sends sw only when the R091 valve is on');
    assert(main.includes('...(V.r091 ? support91Items() : [])'), 'wiring: the 步兵支援 group is there only when the R091 valve is on');
    assert(battle.includes('if (!this.sec89.has(u.kind) && (u.kind === UK_SNIPER || u.kind === UK_AT91)) nm = this.squad21(u, x, z, simT, col, nm);'), 'wiring: with R089 off both kinds are drawn like a section, whatever the valve');
    assert(/const full91 = \/\(\^\|&\)noR091=\/\.test\(full\) \? full : `\$\{full \? full \+ '&' : ''\}noR091=1`;/.test(cdp), 'wiring: tools/cdp.mjs opens pages with noR091=1 unless a guard asks for R091');
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK support91/${name}`);
}
console.log('support91: all OK');
