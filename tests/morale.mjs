// R052 士氣與壓制：不開瀏覽器的部分。沒開旗標逐位不變、壓制值怎麼漲怎麼退、掩體與指揮部、三個狀態的效果、
// 潰退、裝甲與喪屍免疫、決定性、卡面「相對關係」表的數字、畫面標記、設定與接線。
// 用法：node tests/morale.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/morale.mjs <群組名>   只跑那一群（隔離副本裡用）
// 真實 Chrome 在 tests/morale-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY, SHELL_AP, SHELL_SMALL, SHELL_HE, BK_PILLBOX, TER_MUD,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_HEAVY, UK_ZOMBIE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { VEG_WOOD, VEGETATION_VERSION } from '../src/sim/vegetation.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { suppress, suppressBlast, coverPct, supPct, moraleState, blastSup,
  SUP_SMALL, SUP_DIRECT, SUP_LOSS, SUP_SHAKEN, SUP_PINNED, SUP_BROKEN, SUP_MAX, MORALE_OK, MORALE_SHAKEN, MORALE_PINNED, MORALE_BROKEN } from '../src/sim/morale.ts';

assert.deepEqual([SUP_SMALL, SUP_DIRECT, SUP_LOSS, SUP_SHAKEN, SUP_PINNED, SUP_BROKEN, SUP_MAX, blastSup(UNIT_KINDS[UK_HOWITZER].dmgUnit), blastSup(UNIT_KINDS[UK_MORTAR].dmgUnit)], [25, 30, 15, 30, 60, 90, 100, 70, 50], 'fixture: the numbers on the card are the numbers in src/sim/morale.ts');

const at0 = (...cmds) => cmds.map(cmd => ({ tick: 0, cmd }));
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, BOTH = [{ t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 3 }];
const C = center(16), cells = n => n * SUB;
// 一片空地（沒有房子、路、彈坑、植被），上面只放守衛自己擺的單位
function field(morale = true) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (morale) applyRules(w, { morale: 1 });
  return w;
}
// quiet：把裝填時間設成天文數字，這個單位整場不會開火
function put(w, side, kind, x, z, quiet = true) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x, z, hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: quiet ? 1e9 : 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
// 一發下一步就落地的砲彈（落點、目標由守衛指定）
function shell(w, kind, shooter, ex, ez, target = null, hitBld = 0) {
  w.shells.push({ id: w.nextShell++, side: shooter.side, kind, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex, ez, t: 0, T: 1, target: target ? target.id : 0, hitBld });
}
const land = (w, kind, shooter, ex, ez, target = null, hitBld = 0) => { shell(w, kind, shooter, ex, ez, target, hitBld); step(w, []); };
const house = (w, x, z, kind = 0) => { const b = { id: w.blds.length + 1, kind, x, z, w: 1, d: 1, floors: 1, hp: 200, maxHp: 200 }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
const trench = (w, kind, x, z) => { w.trenches ??= { version: 1, segments: [] }; w.trenches.segments.push({ side: SIDE_ENEMY, kind, x, z, rot: 0 }); };
const hasSup = u => 'sup' in u;

// 幾局不帶 morale 的對戰在這張卡之前（main a8fdbe2）的雜湊：[種子, 紀錄, 步數, 雜湊]
const BEFORE = [
  ['rye', 7, at0({ t: 'map', id: 1, vegetation: 1 }, ECO, ...BOTH), 2500, 'a89dc8bd'],
  ['rye + ap', 8, at0({ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', ap: 1 }, ECO, ...BOTH), 2500, 'b97acada'],
  ['large ×3 force, fast supply', 9, at0({ t: 'map', id: 2, vegetation: 1 }, { t: 'rules', force: 3, income: 3 }, ECO, ...BOTH), 1500, '96a82148'],
  ['zombies', 10, at0({ t: 'map', id: 1, vegetation: 1 }, { t: 'zombies' }, ECO), 3000, '9a6e13ea'],   // 3000 步：三波喪屍、兩百多次開火、十一個陣亡
];
const MORALE_LOG = at0({ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', morale: 1 }, ECO, ...BOTH);

const groups = {
  // 驗收 1：沒有旗標逐位不變
  off() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'off: the golden script battle is unchanged');
    for (const [name, seed, log, ticks, hash] of BEFORE) {
      const w = createWorld(seed); let stray = -1, fights = 0;
      for (let t = 0; t < ticks; t++) { runLog(w, log, t + 1); fights += w.events.filter(e => e.e === 'impact' || e.e === 'kill').length; if (stray < 0 && w.units.some(u => hasSup(u) || 'rout' in u)) stray = t; }
      assert(fights > 50, `fixture: ${name} has real fighting in it (${fights} impacts and kills)`);
      assert.equal(stray, -1, `off: ${name} never carries any suppression state, at any step`);
      assert.equal(hashWorld(w), hash, `off: ${name} without the morale flag is bit for bit what it was before this card`);
    }
    const w = field();
    put(w, SIDE_ENEMY, UK_OBSERVER, C, C);
    for (let i = 0; i < 40; i++) step(w, []);
    assert(w.rules?.morale === 1 && !hasSup(w.units[0]), 'off: with the rule on, a unit nobody shoots at carries no suppression field');
  },
  // 驗收 2：漲
  gain() {
    const hit = (kind, shooterKind) => { const w = field(), t = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), s = put(w, SIDE_PLAYER, shooterKind, C + cells(3), C); land(w, kind, s, C, C, t); return t; };
    assert.equal(hit(SHELL_SMALL, UK_INFANTRY).sup, 25, 'gain: a rifle volley on a squad in the open adds 25');
    assert.equal(hit(SHELL_AP, UK_TANK).sup, 30, 'gain: a direct-fire shell on a squad in the open adds 30');
    const blast = (gunKind, d, hp = 0) => { const w = field(), t = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), g = put(w, SIDE_PLAYER, gunKind, C + cells(12), C); if (hp) t.hp = hp; land(w, SHELL_HE, g, C + d, C); return t; };
    const R = UNIT_KINDS[UK_HOWITZER].splash, full = UNIT_KINDS[UK_INFANTRY].hp;
    let t = blast(UK_HOWITZER, 0);
    assert.deepEqual([t.alive, hasSup(t)], [false, false], 'gain: a howitzer shell at the feet of a squad in the open simply kills it (the damage rule is unchanged)');
    t = blast(UK_HOWITZER, 0, 1000);   // 把血量調到死不了，才看得到落點中心的數字
    assert.deepEqual([t.sup, 1000 - t.hp], [70, UNIT_KINDS[UK_HOWITZER].dmgUnit], 'gain: at the centre a howitzer shell adds 70 (seen on a squad given enough hit points to live through it)');
    t = blast(UK_HOWITZER, SUB >> 2);
    assert(t.alive && t.sup === 64 && t.hp === 2, `gain: a quarter of a cell away the squad barely lives and takes 64 (${t.sup}, hp ${t.hp})`);
    t = blast(UK_HOWITZER, R);
    assert.deepEqual([t.sup, t.hp], [35, full], 'gain: a howitzer shell at the edge of its lethal radius adds 35 and does no damage');
    t = blast(UK_HOWITZER, R + (R >> 1));
    assert.deepEqual([t.sup, t.hp], [17, full], 'gain: halfway between the lethal radius and the suppression radius it adds 17');
    t = blast(UK_HOWITZER, 2 * R);
    assert.deepEqual([hasSup(t), t.hp], [false, full], 'gain: at twice the lethal radius nothing happens');
    const loss = gap => { const w = field(), a = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), b = put(w, SIDE_ENEMY, UK_INFANTRY, C + cells(gap), C), s = put(w, SIDE_PLAYER, UK_INFANTRY, C, C + cells(3)); b.hp = 1; land(w, SHELL_SMALL, s, b.x, b.z, b); assert.equal(b.alive, false, 'fixture: the neighbour dies'); return a; };
    assert.equal(loss(3).sup, 15, 'gain: a friend killed 3 cells away adds 15');
    assert.equal(hasSup(loss(4)), false, 'gain: a friend killed 4 cells away adds nothing');
    { const w = field(), a = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), foe = put(w, SIDE_PLAYER, UK_INFANTRY, C + cells(2), C), s = put(w, SIDE_ENEMY, UK_INFANTRY, C, C + cells(3)); foe.hp = 1; land(w, SHELL_SMALL, s, foe.x, foe.z, foe);
      assert.deepEqual([foe.alive, hasSup(a)], [false, false], 'gain: an enemy killed nearby adds nothing'); }
    { const w = field(), t2 = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), s = put(w, SIDE_PLAYER, UK_INFANTRY, C + cells(4), C); land(w, SHELL_SMALL, s, C + cells(2), C, t2);
      assert.deepEqual([hasSup(t2), t2.hp], [false, UNIT_KINDS[UK_INFANTRY].hp], 'gain: a shot that lands two cells from its target neither hurts nor suppresses it'); }
    const w = field(), u = put(w, SIDE_ENEMY, UK_INFANTRY, C, C);
    suppress(w, u, 80); suppress(w, u, 80);
    assert.equal(u.sup, 100, 'gain: suppression never exceeds 100');
  },
  // 驗收 3：掩體（壓制只擋傷害的六成；兩邊用同一個掩體數字）
  cover() {
    assert.deepEqual([100, 90, 75, 50, 25].map(supPct), [100, 94, 85, 70, 55], 'cover: the damage-to-suppression table on the card');
    const mortar = UNIT_KINDS[UK_MORTAR].dmgUnit, full = UNIT_KINDS[UK_INFANTRY].hp;
    for (const [name, cover, sup, prepare] of [
      ['open ground', 100, 50, () => {}],
      ['a shell crater', 75, 42, w => { w.crater[cellIdx(w, 16, 16)] = 1; }],
      ['a wood', 50, 35, w => { w.vegetation = { version: VEGETATION_VERSION, cells: new Uint8Array(w.n * w.n) }; w.vegetation.cells[cellIdx(w, 16, 16)] = VEG_WOOD; }],
      ['a fire trench', 75, 42, w => trench(w, 0, 16, 16)],
      ['a communication trench', 90, 47, w => trench(w, 2, 16, 16)],
      ['a reinforced trench', 50, 35, w => trench(w, 3, 16, 16)],
      ['a house', 50, 35, w => house(w, 16, 16)],
      ['a pillbox', 25, 27, w => house(w, 16, 16, BK_PILLBOX)],
    ]) {
      const w = field(); prepare(w);
      const t = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), g = put(w, SIDE_PLAYER, UK_MORTAR, C + cells(8), C);
      assert.equal(coverPct(w, t), cover, `fixture: a squad in ${name} takes ${cover}% damage`);
      land(w, SHELL_HE, g, C, C);
      assert.equal(full - t.hp, Math.floor(mortar * cover / 100), `cover: in ${name} the damage really taken matches the cover the suppression rule read`);
      assert.equal(t.sup, sup, `cover: in ${name} a mortar shell at the feet adds ${sup}, as the card's table says`);
    }
  },
  // 驗收 4：直射打在房子上
  house() {
    for (const [kind, shooter, expect] of [[SHELL_AP, UK_TANK, 21], [SHELL_SMALL, UK_INFANTRY, 17]]) {
      const w = field(), b = house(w, 16, 16), inside = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), beside = put(w, SIDE_ENEMY, UK_INFANTRY, C + cells(1), C), s = put(w, SIDE_PLAYER, shooter, C, C + cells(4));
      land(w, kind, s, C, C, null, b.id);
      assert.deepEqual([inside.sup, hasSup(beside)], [expect, false], `house: direct fire on a house suppresses the squad inside by ${expect} and nobody outside`);
    }
    {
      const w = field(), b = house(w, 16, 16), other = house(w, 20, 16), here = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), there = put(w, SIDE_ENEMY, UK_INFANTRY, center(20), C), s = put(w, SIDE_PLAYER, UK_TANK, C, C + cells(4));
      land(w, SHELL_AP, s, C, C, null, b.id);
      assert.deepEqual([here.sup, hasSup(there), other.hp], [21, false, 200], 'house: the squad in the next house is not suppressed');
      const r = field(), rubble = house(r, 16, 16), on = put(r, SIDE_ENEMY, UK_INFANTRY, C, C), t = put(r, SIDE_PLAYER, UK_TANK, C, C + cells(4));
      rubble.hp = 0;
      land(r, SHELL_AP, t, C, C, null, rubble.id);
      assert.equal(hasSup(on), false, 'house: a shell that lands on rubble suppresses nobody (there is no inside any more)');
    }
  },
  // 驗收 5：指揮部
  hq() {
    const at = (gap, hp = 500) => {
      const w = field(), hq = house(w, 4, 4), other = house(w, 28, 28); hq.hp = hp;
      w.eco = { supply: [0, 0], hq: [other.id, hq.id], queue: [[], []], prog: [0, 0] };
      const t = put(w, SIDE_ENEMY, UK_INFANTRY, center(4) + cells(gap), center(4)), s = put(w, SIDE_PLAYER, UK_INFANTRY, t.x, t.z + cells(3));
      land(w, SHELL_SMALL, s, t.x, t.z, t);
      return t.sup;
    };
    assert.deepEqual([at(2), at(6), at(7), at(2, 0)], [18, 18, 25, 25], 'hq: within 6 cells of its own standing HQ a unit takes three quarters; farther away, or with the HQ destroyed, the full amount');
  },
  // 驗收 6：退
  decay() {
    const make = sup => { const w = field(), u = put(w, SIDE_ENEMY, UK_OBSERVER, C, C); put(w, SIDE_PLAYER, UK_OBSERVER, C + cells(12), C); if (sup) u.sup = sup; return w; };
    const a = make(25), b = make(0), seen = [];
    for (let i = 1; i <= 100; i++) { step(a, []); step(b, []); if (i % 20 === 0) seen.push(a.units[0].sup ?? 0); }
    assert.deepEqual(seen, [20, 15, 10, 5, 0], 'decay: suppression falls by 1 every 4 steps');
    assert.equal(hasSup(a.units[0]), false, 'decay: at 0 the field is gone');
    assert.equal(hashWorld(a), hashWorld(b), 'decay: a unit whose suppression has worn off hashes like one that was never suppressed');
    const c = make(SUP_PINNED); let n = 0;
    while ((c.units[0].sup ?? 0) >= SUP_SHAKEN) { step(c, []); n++; }
    assert(n >= 120 && n <= 128, `decay: from just pinned to no longer suppressed takes about 6 seconds (${n} steps)`);
  },
  // 驗收 7、8、9 的開火部分：射速
  rate() {
    const shots = hold => {
      const w = field(), a = put(w, SIDE_PLAYER, UK_INFANTRY, C, C, false); put(w, SIDE_ENEMY, UK_HEAVY, C + cells(4), C);
      let n = 0;
      for (let i = 0; i < 480; i++) { if (hold) a.sup = hold; step(w, []); n += w.events.filter(e => e.e === 'fire' && e.unit === a.id).length; }
      return n;
    };
    const free = shots(0), shaken = shots(45), pinned = shots(75), broken = shots(95);
    assert.equal(free, 20, 'fixture: an unsuppressed squad fires 20 volleys in 24 seconds');
    assert(Math.abs(shaken - 10) <= 1, `rate: a suppressed squad fires at half the rate (${shaken} volleys against ${free})`);
    assert(Math.abs(pinned - 5) <= 1, `rate: a pinned squad fires at a quarter of the rate (${pinned} volleys against ${free})`);
    assert.equal(broken, 0, 'rate: a broken squad does not fire at all');
    // 砲本來就要停下來才能打：搬到一半被釘住的砲組趴在路上、砲沒架好，不開火；原地被釘住的照四分之一打
    const mortar = moving => {
      const w = field(), g = put(w, SIDE_PLAYER, UK_MORTAR, C, C, false); put(w, SIDE_ENEMY, UK_HEAVY, C + cells(5), C);
      g.sup = 75;
      if (moving) step(w, [{ t: 'move', side: SIDE_PLAYER, ids: [g.id], x: 16, z: 26 }]);
      let n = 0;
      for (let i = 0; i < 480; i++) { g.sup = 75; step(w, []); n += w.events.filter(e => e.e === 'fire' && e.unit === g.id).length; }
      return { n, at: [g.x, g.z] };
    };
    const still = mortar(false), caught = mortar(true);
    assert(still.n >= 1 && still.n <= 3, `rate: a mortar crew pinned in place still fires at a quarter of the rate (${still.n} rounds in 24 seconds against 8)`);
    assert.deepEqual([caught.n, caught.at], [0, [C, C]], 'rate: a mortar crew pinned while on the move stays where it is with the mortar not set up, and does not fire');
  },
  // 驗收 7、8 的移動部分
  move() {
    const walk = (hold, steps = 100) => {
      const w = field(), a = put(w, SIDE_PLAYER, UK_INFANTRY, center(6), C);
      if (hold) a.sup = hold;
      step(w, [{ t: 'move', side: SIDE_PLAYER, ids: [a.id], x: 26, z: 16 }]);
      for (let i = 0; i < steps; i++) { if (hold) a.sup = hold; step(w, []); }
      return { w, a, d: a.x - center(6) };
    };
    const free = walk(0).d, shaken = walk(45).d, p = walk(75);
    assert(free >= cells(3), `fixture: an unsuppressed squad covers ground (${free})`);
    assert(Math.abs(shaken * 2 - free) <= SUB, `move: a suppressed squad moves at half speed (${shaken} against ${free})`);
    assert.equal(p.d, 0, 'move: a pinned squad does not move');
    assert.equal(p.a.order, ORD_MOVE, 'move: a pinned squad keeps its order');
    delete p.a.sup;
    for (let i = 0; i < 800; i++) step(p.w, []);
    assert.deepEqual([cellOf(p.a.x), cellOf(p.a.z), p.a.order], [p.a.tx, p.a.tz, ORD_IDLE], 'move: once the suppression has worn off it walks on to where it was sent');
  },
  // 驗收 9：潰退
  rout() {
    for (const [side, toward] of [[SIDE_PLAYER, 1], [SIDE_ENEMY, -1]]) {
      const w = field(), a = put(w, side, UK_INFANTRY, C, C);
      suppress(w, a, 95);
      assert.deepEqual([moraleState(a), a.rout, a.order, a.tx, a.tz], [MORALE_BROKEN, 1, ORD_MOVE, 16 + 3 * toward, 16 + 3 * toward], `rout: a broken squad in the open (side ${side}) turns for its own side of the map`);
      step(w, [{ t: 'move', side, ids: [a.id], x: 16 - 8 * toward, z: 16 - 8 * toward }]);
      assert.deepEqual([a.tx, a.tz], [16 + 3 * toward, 16 + 3 * toward], 'rout: a routing squad ignores a move order');
      let n = 0;
      while (a.rout && n < 400) { step(w, []); n++; }
      assert(!a.rout && (a.sup ?? 0) < SUP_PINNED && a.order === ORD_IDLE, `rout: it stops and answers again once suppression falls below ${SUP_PINNED} (${n} steps)`);
      assert((a.x - C) * toward >= cells(2) && (a.z - C) * toward >= cells(2), `rout: by then it has fallen back at least 2 cells (${(a.x - C) / SUB}, ${(a.z - C) / SUB})`);
      step(w, [{ t: 'move', side, ids: [a.id], x: 16, z: 16 }]);
      assert.equal(a.order, ORD_MOVE, 'rout: afterwards a move order is obeyed');
    }
    // 觀測員也會退；退的時候 stop、attack、fireAt 也不收
    {
      const w = field(), o = put(w, SIDE_PLAYER, UK_OBSERVER, C, C), a = put(w, SIDE_PLAYER, UK_INFANTRY, C + cells(6), C), foe = put(w, SIDE_ENEMY, UK_HEAVY, C, C - cells(3));
      suppress(w, o, 95); suppress(w, a, 95);
      assert.deepEqual([o.rout, a.rout], [1, 1], 'rout: an observer routs like a rifle squad');
      for (const cmd of [{ t: 'stop', side: SIDE_PLAYER, ids: [a.id] }, { t: 'attack', side: SIDE_PLAYER, ids: [a.id], target: foe.id }, { t: 'fireAt', side: SIDE_PLAYER, ids: [a.id], x: 16, z: 13 }]) {
        step(w, [cmd]);
        assert.deepEqual([a.order, a.tx, a.tz], [ORD_MOVE, 16 + 6 + 3, 19], `rout: a routing squad ignores a ${cmd.t} order`);
      }
    }
    // 半路上回神：停下來、路徑清掉，不會自己走完
    {
      const w = field(); w.ter.fill(TER_MUD);
      const a = put(w, SIDE_PLAYER, UK_INFANTRY, C, C);
      suppress(w, a, 90);
      let n = 0;
      while (a.rout && n < 400) { step(w, []); n++; }
      assert(!a.rout && a.order === ORD_IDLE && a.path.length === 0 && (cellOf(a.x) !== 19 || cellOf(a.z) !== 19), `rout: a squad that recovers half way stops there (${n} steps, at ${cellOf(a.x)},${cellOf(a.z)})`);
    }
    // 退完一段還是潰退（火力沒停）：再退一段
    {
      const w = field(), a = put(w, SIDE_PLAYER, UK_INFANTRY, C, C);
      suppress(w, a, 95);
      for (let i = 0; i < 320; i++) { a.sup = 95; step(w, []); }
      assert(cellOf(a.x) >= 21 && cellOf(a.z) >= 21 && a.rout === 1, `rout: a squad still broken when it arrives falls back another leg (now at ${cellOf(a.x)},${cellOf(a.z)})`);
    }
    // 在房子裡潰退的不退；房子倒了，人在空地上，就退
    {
      const w = field(), b = house(w, 16, 16), a = put(w, SIDE_PLAYER, UK_INFANTRY, C, C);
      suppress(w, a, 95); suppress(w, a, 95);
      for (let i = 0; i < 30; i++) { a.sup = 100; step(w, []); }
      assert.deepEqual([moraleState(a), a.rout, a.x, a.z], [MORALE_BROKEN, undefined, C, C], 'rout: a broken squad inside a house stays inside');
      b.hp = 0;
      for (let i = 0; i < 25; i++) { a.sup = 100; step(w, []); }
      assert.equal(a.rout, 1, 'rout: once the house is rubble and it is in the open, it falls back');
    }
    // 彈坑、林地也算掩體
    for (const [name, prepare] of [['a shell crater', w => { w.crater[cellIdx(w, 16, 16)] = 1; }], ['a wood', w => { w.vegetation = { version: VEGETATION_VERSION, cells: new Uint8Array(w.n * w.n) }; w.vegetation.cells[cellIdx(w, 16, 16)] = VEG_WOOD; }]]) {
      const w = field(); prepare(w);
      const a = put(w, SIDE_PLAYER, UK_INFANTRY, C, C);
      suppress(w, a, 95); suppress(w, a, 95);
      for (let i = 0; i < 30; i++) { a.sup = 100; step(w, []); }
      assert.deepEqual([moraleState(a), a.rout, a.x, a.z], [MORALE_BROKEN, undefined, C, C], `rout: a broken squad in ${name} stays put`);
    }
    // 在掩體裡的不退；砲組不退
    let w = field(); trench(w, 0, 16, 16);
    let a = put(w, SIDE_ENEMY, UK_INFANTRY, C, C);
    suppress(w, a, 95); suppress(w, a, 95);
    for (let i = 0; i < 20; i++) step(w, []);
    assert.deepEqual([moraleState(a), a.rout, a.x, a.z], [MORALE_BROKEN, undefined, C, C], 'rout: a broken squad in a trench stays where it is');
    w = field(); a = put(w, SIDE_ENEMY, UK_ATGUN, C, C);
    suppress(w, a, 95);
    for (let i = 0; i < 10; i++) step(w, []);
    assert.deepEqual([moraleState(a), a.rout, a.x, a.z], [MORALE_BROKEN, undefined, C, C], 'rout: a gun crew goes to ground by its gun instead of running');
  },
  // 驗收 10：裝甲與喪屍
  immune() {
    const w = field(), tank = put(w, SIDE_ENEMY, UK_TANK, C, C), inf = put(w, SIDE_PLAYER, UK_INFANTRY, C + cells(3), C), gun = put(w, SIDE_PLAYER, UK_HOWITZER, C + cells(12), C);
    land(w, SHELL_SMALL, inf, C, C, tank); land(w, SHELL_AP, put(w, SIDE_PLAYER, UK_TANK, C, C + cells(4)), C, C, tank); land(w, SHELL_HE, gun, C + SUB, C);
    assert(tank.alive && !hasSup(tank), 'immune: an armoured vehicle is not suppressed by rifles, shells or high explosive');
    const z = put(w, SIDE_ENEMY, UK_ZOMBIE, center(4), center(4));
    suppress(w, z, 80); suppressBlast(w, z.x, z.z, 256, 30);
    assert.equal(hasSup(z), false, 'immune: zombies are not suppressed');
  },
  // 驗收 11：決定性、雜湊、存檔編碼
  determinism() {
    const run = ticks => runLog(createWorld(7), MORALE_LOG, ticks);
    const mid = run(900);
    assert(mid.units.some(u => u.sup), 'fixture: by step 900 somebody is suppressed');
    const direct = hashWorld(run(1500));
    assert.equal(hashWorld(runLog(structuredClone(mid), MORALE_LOG, 1500)), direct, 'determinism: a deep copy taken mid-battle continues bit for bit');
    assert.equal(hashWorld(run(1500)), direct, 'determinism: the same log gives the same hash twice');
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(mid))));
    assert.deepEqual(back, { ...mid, events: [] }, 'determinism: a world with suppression survives the R074 save codec field for field');
    {
      const w = field(), r = put(w, SIDE_PLAYER, UK_INFANTRY, C, C); put(w, SIDE_ENEMY, UK_OBSERVER, center(4), center(4));
      suppress(w, r, 95);
      for (let i = 0; i < 30; i++) step(w, []);
      assert(r.rout === 1 && r.pathIdx < r.path.length, 'fixture: a squad half way through its rout');
      const copy = structuredClone(w), saved = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
      for (let i = 0; i < 200; i++) { step(w, []); step(copy, []); step(saved, []); }
      assert.deepEqual([hashWorld(copy), hashWorld(saved)], [hashWorld(w), hashWorld(w)], 'determinism: a deep copy and a saved copy of a routing squad both continue bit for bit');
    }
    const a = field(), b = field();
    for (const w of [a, b]) put(w, SIDE_ENEMY, UK_INFANTRY, C, C);
    const base = hashWorld(a);
    a.units[0].sup = 25; b.units[0].sup = 26;
    assert(hashWorld(a) !== base && hashWorld(a) !== hashWorld(b), 'determinism: suppression is folded into the hash');
    b.units[0].sup = 25; b.units[0].rout = 1;
    assert.notEqual(hashWorld(a), hashWorld(b), 'determinism: the routing flag is folded into the hash');
  },
  // 驗收 12：實戰
  battle() {
    const off = at0({ t: 'map', id: 1, vegetation: 1 }, ECO, ...BOTH), w = createWorld(7), seen = [0, 0, 0, 0];
    for (let t = 0; t < 2500; t++) { runLog(w, MORALE_LOG, t + 1); for (const e of w.events) if (e.e === 'morale') seen[e.state]++; }
    assert(seen[MORALE_SHAKEN] > 0 && seen[MORALE_PINNED] > 0 && seen[MORALE_BROKEN] > 0, `battle: in a real battle units become suppressed, pinned and broken (${seen})`);
    assert.notEqual(hashWorld(w), hashWorld(runLog(createWorld(7), off, 2500)), 'battle: the rule changes how the same battle goes');
  },
  // 驗收 13：卡面「相對關係」表的數字
  timeline() {
    // 一發一發看：每次砲彈落在目標身上（或旁邊）之後，目標的狀態
    const volleys = (prepare, shooters, count) => {
      const w = field(); prepare(w);
      const t = put(w, SIDE_ENEMY, UK_HOWITZER, C, C), states = [];
      for (let i = 0; i < shooters; i++) put(w, SIDE_PLAYER, UK_INFANTRY, C + cells(3), C + cells(i === 0 ? 0 : 1), false);
      for (let n = 0; n < 2000 && states.length < count; n++) { step(w, []); if (w.events.some(e => e.e === 'impact' && e.kind === SHELL_SMALL)) states.push(moraleState(t)); }
      assert(t.alive && states.length === count, `fixture: the target survives ${count} volleys`);
      return states;
    };
    assert.deepEqual(volleys(() => {}, 1, 3), [MORALE_OK, MORALE_SHAKEN, MORALE_PINNED], 'timeline: in the open one squad suppresses with its 2nd volley and pins with its 3rd');
    assert.deepEqual(volleys(w => trench(w, 3, 16, 16), 1, 5), [MORALE_OK, MORALE_OK, MORALE_SHAKEN, MORALE_SHAKEN, MORALE_PINNED], 'timeline: in a reinforced trench one squad needs 5 volleys to pin');
    assert.deepEqual(volleys(w => trench(w, 3, 16, 16), 2, 2), [MORALE_SHAKEN, MORALE_PINNED], 'timeline: two squads firing together pin it with their 2nd volley');
    // 迫擊砲落在 1 格外（殺傷半徑邊緣）：3 秒一發
    const w = field(), t = put(w, SIDE_ENEMY, UK_INFANTRY, C, C), m = put(w, SIDE_PLAYER, UK_MORTAR, C + cells(8), C), states = [];
    assert.equal(UNIT_KINDS[UK_MORTAR].splash, SUB, 'fixture: the mortar lethal radius is one cell');
    for (let i = 0; i < 5; i++) { land(w, SHELL_HE, m, C + SUB, C); states.push(moraleState(t)); for (let k = 1; k < UNIT_KINDS[UK_MORTAR].reload; k++) step(w, []); }
    assert.deepEqual(states, [MORALE_OK, MORALE_SHAKEN, MORALE_SHAKEN, MORALE_SHAKEN, MORALE_PINNED], 'timeline: mortar shells one cell away suppress with the 2nd and pin with the 5th');
    assert.equal(t.hp, UNIT_KINDS[UK_INFANTRY].hp, 'timeline: without costing the squad a single hit point');
    const w2 = field(), t2 = put(w2, SIDE_ENEMY, UK_INFANTRY, C, C), h = put(w2, SIDE_PLAYER, UK_HOWITZER, C + cells(12), C);
    land(w2, SHELL_HE, h, C + (SUB >> 2), C);
    assert(t2.alive && moraleState(t2) === MORALE_PINNED, 'timeline: one howitzer shell a quarter of a cell away pins the squad it does not kill');
    const w3 = field(), t3 = put(w3, SIDE_ENEMY, UK_INFANTRY, C, C), h3 = put(w3, SIDE_PLAYER, UK_HOWITZER, C + cells(12), C);
    land(w3, SHELL_HE, h3, C + UNIT_KINDS[UK_HOWITZER].splash, C);
    assert.deepEqual([moraleState(t3), t3.hp], [MORALE_SHAKEN, UNIT_KINDS[UK_INFANTRY].hp], 'timeline: a howitzer shell at the edge of its lethal radius suppresses without damage');
  },
  // rules 指令與指令檢查
  rules() {
    const w = createWorld(3); applyRules(w, { morale: 1 });
    assert.deepEqual(w.rules, { morale: 1 }, 'rules: morale 1 is stored');
    const x = createWorld(3); applyRules(x, { morale: 3 });   // 2 從 R075 起是士氣第二版（tests/morale2.mjs）
    assert.equal(x.rules, undefined, 'rules: any other value is ignored and leaves no state');
    const a = createWorld(3), b = createWorld(3); applyRules(a, { force: 3 }); applyRules(b, { force: 3, morale: 1 });
    assert.notEqual(hashWorld(a), hashWorld(b), 'rules: the flag is folded into the hash');
    assert.deepEqual([isCommand({ t: 'rules', morale: 1 }), isCommand({ t: 'rules', ap: 1, morale: 1 }), isCommand({ t: 'rules', morale: 'yes' })], [true, true, false], 'rules: the command check knows the new field');
    const viaLog = runLog(createWorld(3), at0({ t: 'rules', morale: 1 }), 1);
    assert.equal(viaLog.rules?.morale, 1, 'rules: the flag arrives through the tick-0 rules command');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`morale/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK morale/${name}`); }

// ---- 畫面標記、設定與接線（不在隔離副本裡跑）----
{
  const { BattleView } = await import('../src/render/battle.ts');
  const w = createWorld(1944); applyRules(w, { morale: 1 });
  const mine = put(w, SIDE_PLAYER, UK_INFANTRY, w.units.find(u => u.side === SIDE_PLAYER).x + SUB, w.units.find(u => u.side === SIDE_PLAYER).z, true);
  const foe = put(w, SIDE_ENEMY, UK_INFANTRY, w.units.find(u => u.side === SIDE_ENEMY).x + SUB, w.units.find(u => u.side === SIDE_ENEMY).z, true);
  const v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true });
  const look = (t) => { v.update(0, t, new Set()); return { bars: v.barDbg.n, pips: v.barDbg.pips, fill: v.bars.fill }; };
  assert.deepEqual(look(1), { bars: 0, pips: 0, fill: 0 }, 'marks: nobody suppressed, nothing drawn');
  mine.sup = 45; assert.deepEqual(look(2), { bars: 1, pips: 1, fill: 2 }, 'marks: a suppressed squad at full health gets its bar and one mark');
  mine.sup = 75; assert.deepEqual(look(3), { bars: 1, pips: 2, fill: 3 }, 'marks: a pinned squad gets two marks');
  mine.sup = 95; assert.deepEqual(look(4), { bars: 1, pips: 3, fill: 4 }, 'marks: a broken squad gets three marks');
  mine.sup = 29; assert.deepEqual(look(5), { bars: 0, pips: 0, fill: 0 }, 'marks: below the first threshold nothing is drawn');
  delete mine.sup; foe.sup = 95;
  assert.equal(v.visibleUnit(foe), false, 'fixture: the enemy squad is out of sight');
  assert.deepEqual(look(6), { bars: 0, pips: 0, fill: 0 }, 'marks: an enemy nobody can see shows no marks');
  v.dispose();
  console.log('OK morale/marks');

  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const { rulesCommand, setupSummary, SETUP_PARAMS, loadSetup, saveSetup, restoreSetup, initSkirmish } = await import('../src/ui/skirmish.ts');
  const { reloadStatus } = await import('../src/ui/reloadStatus.ts');
  const { menuLayout } = await import('../src/ui/startMenu.ts');
  assert.match(read('../src/valves.ts'), /get r052\(\) \{ return on\('052'\); \}/, 'valve: r052 is on the table');
  assert.deepEqual([rulesCommand(2, 2, false, true), rulesCommand(3, 2, true, true), rulesCommand(2, 2, false, false)], [{ t: 'rules', morale: 1 }, { t: 'rules', force: 3, ap: 1, morale: 1 }, undefined], 'setup: the switch becomes the morale field of the rules command');
  assert.deepEqual([setupSummary(2, 2, 5, false, true), setupSummary(2, 2, 5, true, true), setupSummary(2, 2, 5)], ['兵力 標準 · 補給 標準 · 種子 5 · 士氣', '兵力 標準 · 補給 標準 · 種子 5 · 穿甲 · 士氣', '兵力 標準 · 補給 標準 · 種子 5'], 'setup: the summary line names it');
  assert(SETUP_PARAMS.includes('morale'), 'setup: ?morale= counts as an address with setup');
  const m = new Map(), store = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, x) => { m.set(k, String(x)); } };
  saveSetup(store, { v: 1, map: 'rye', mode: 'battle', ai: 2, force: 2, supply: 2, seed: 9, morale: 1 });
  assert.equal(loadSetup(store)?.morale, 1, 'setup: the remembered setup keeps it');
  const view = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye'], modes: ['battle'], aiOn: true, rye: true, tutorial: false, audio: null, resume: false, page: 'setup' };
  const row = s => menuLayout({ ...view, setup: { force: 2, supply: 2, seed: 5, ...s } }).rows.find(r => r.id === 'sm-rules')?.items.map(i => [i.id, i.pressed]) ?? null;
  assert.deepEqual([row({ ap: false, morale: true }), row({ morale: false }), row({ ap: true }), row({})], [[['sm-ap', false], ['sm-morale', true]], [['sm-morale', false]], [['sm-ap', true]], null], 'layout: the setup page shows the switch only when the page has it');
  assert.match(read('../README.md'), /\?noR052=1/, 'readme: the valve is documented');
  // 跟 R051 審查找到的那兩件事同一個做法：閥關著時，網址上的 morale 不算帶了設定，本機記著的 morale 也不被這一頁洗掉；閥開著時關掉就真的忘掉
  {
    const mem = v => { const mm = new Map([['gtrts.v1.setup', JSON.stringify(v)]]); return { getItem: k => (mm.has(k) ? mm.get(k) : null), setItem: (k, x) => { mm.set(k, String(x)); } }; };
    const saved = { v: 1, map: '64', mode: 'battle', ai: 3, force: 2, supply: 2, seed: 5, morale: 1 }, big = createWorld(77);
    const st = mem(saved), q = restoreSetup(new URLSearchParams('noR052=1&morale=1'), st);
    assert.equal(q.get('map'), '64', 'valve: with noR052 a morale in the address does not make the page a linked one (the remembered map is restored)');
    const k = initSkirmish(q, true);
    k.start(big); k.set({ ai: 1 });
    assert.deepEqual([k.morale, k.canMorale, loadSetup(st).ai, loadSetup(st).morale], [false, false, 1, 1], 'valve: with noR052 the rule stays off on this page and the remembered morale survives the visit');
    const st2 = mem(saved), k2 = initSkirmish(restoreSetup(new URLSearchParams(''), st2), true);
    assert.equal(k2.morale, true, 'memory: the remembered rule comes back on');
    k2.start(big); k2.set({ morale: false });
    assert.equal(loadSetup(st2).morale, undefined, 'memory: with the valve on, turning the rule off really forgets it');
    const on = createWorld(78); applyRules(on, { morale: 1 });
    const k3 = initSkirmish(restoreSetup(new URLSearchParams(''), mem({ ...saved, morale: undefined })), true);
    k3.adopt(on);
    assert.equal(k3.morale, true, 'save: resuming a saved battle with the rule on lines the setup page up with it');
  }
  // 選中的砲：被壓制的時候「剩餘」要照變慢的裝填算
  {
    const w2 = field(), g = put(w2, SIDE_PLAYER, UK_HOWITZER, C, C), sel = new Set([g.id]);
    g.cooldown = 140;
    const plain = reloadStatus(w2, sel);
    g.sup = 45; const slow = reloadStatus(w2, sel);
    g.sup = 75; const slower = reloadStatus(w2, sel);
    assert(plain.includes('剩餘 7.0') && !plain.includes('被壓制') && slow.includes('剩餘 14.0') && slow.includes('1 個被壓制') && slower.includes('剩餘 28.0'), `status: the reload line counts the slower reload of suppressed guns (${plain} / ${slow} / ${slower})`);
    const off = field(false), g2 = put(off, SIDE_PLAYER, UK_HOWITZER, C, C); g2.cooldown = 140; g2.sup = 75;
    assert(reloadStatus(off, new Set([g2.id])).includes('剩餘 7.0'), 'status: without the rule the reload line is unchanged');
  }
  console.log('OK morale/wiring');
}

// ---- 故意弄壞（驗收 14）----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r052-negative-'));
const mutants = [
  ['rule_always_on', 'off', 'step.ts', '  if (w.rules?.morale) moraleStep(w);', '  moraleStep(w);', 'off: rye never carries any suppression state, at any step'],
  ['blast_always_on', 'off', 'step.ts', '  if (w.rules?.morale) suppressBlast(w, s.ex, s.ez, R, k.dmgUnit);', '  suppressBlast(w, s.ex, s.ez, R, k.dmgUnit);', 'off: the golden script battle is unchanged'],
  ['no_cover', 'cover', 'morale.ts', '  let a = Math.floor((amount * supPct(coverPct(w, u))) / 100);', '  let a = amount;', "cover: in a shell crater a mortar shell at the feet adds 42, as the card's table says"],
  ['cover_as_damage', 'cover', 'morale.ts', 'export const supPct = (cover: number): number => 100 - Math.floor(((100 - cover) * 3) / 5);', 'export const supPct = (cover: number): number => cover;', "cover: the damage-to-suppression table on the card"],
  ['no_decay', 'decay', 'morale.ts', '  for (const u of w.units) if (u.alive && u.sup && (w.tick + u.id) % SUP_DECAY_TICKS === 0) setSup(w, u, u.sup - 1);\n', '', 'decay: suppression falls by 1 every 4 steps'],
  ['full_rate', 'rate', 'step.ts', '  if (u.cooldown > 0 && (!w.rules?.morale || reloads(w, u))) u.cooldown--;', '  if (u.cooldown > 0) u.cooldown--;', 'rate: a suppressed squad fires at half the rate (20 volleys against 20)'],
  ['broken_fires', 'rate', 'morale.ts', 'export const canFire = (u: Unit): boolean => moraleState(u) !== MORALE_BROKEN;', 'export const canFire = (_u: Unit): boolean => true;', 'rate: a broken squad does not fire at all'],
  ['pinned_moves', 'move', 'morale.ts', '  return s >= MORALE_PINNED ? 0 : s === MORALE_SHAKEN ? 50 : 100;', '  return s === MORALE_SHAKEN ? 50 : 100;', 'move: a pinned squad does not move'],
  ['rout_obeys', 'rout', 'step.ts', ' && !seen.has(u.id) && !u.rout) {', ' && !seen.has(u.id)) {', 'rout: a routing squad ignores a move order'],
  ['armor_suppressed', 'immune', 'morale.ts', 'export const suppressible = (u: Unit): boolean => !UNIT_KINDS[u.kind].armored && u.kind !== UK_ZOMBIE;', 'export const suppressible = (u: Unit): boolean => u.kind !== UK_ZOMBIE;', 'immune: an armoured vehicle is not suppressed by rifles, shells or high explosive'],
  ['hq_ignored', 'hq', 'morale.ts', '  if (nearHq(w, u)) a = Math.floor((a * 3) / 4);\n', '', 'hq: within 6 cells of its own standing HQ a unit takes three quarters; farther away, or with the HQ destroyed, the full amount'],
  ['rubble_house', 'house', 'morale.ts', "  if (!((w.blds[bld - 1]?.hp ?? 0) > 0)) return;   // 已經是瓦礫（砲彈還在飛的時候房子倒了）：沒有人在「裡面」\n", '', 'house: a shell that lands on rubble suppresses nobody (there is no inside any more)'],
  ['rout_once', 'rout', 'morale.ts', '  for (const u of w.units) if (u.alive && (w.tick + u.id) % ROUT_CHECK === 0 && moraleState(u) === MORALE_BROKEN && (!u.rout || u.pathIdx >= u.path.length)) startRout(w, u);\n', '', 'rout: a squad still broken when it arrives falls back another leg (now at 19,19)'],
  ['hash_blind', 'determinism', 'world.ts', '    if (u.sup) f.int(0x5355).int(u.sup);', '    if (u.sup) f.int(0x5355);', 'determinism: suppression is folded into the hash'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/morale.mjs'), join(dir, 'tests/morale.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/morale.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: intended assertion must fail first, got ${output.slice(-1500)}`);
    console.log(`OK morale-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`morale: all groups OK, ${mutants.length} isolated mutants rejected`);
