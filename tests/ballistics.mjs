// R051 穿甲與裝甲厚度：不開瀏覽器的部分。厚度與穿深表、穿深隨距離遞減、規則（彈開／穿透／方向／距離）、
// 高爆彈與步兵、卡面那張「誰打得穿誰」的對照表、決定性、舊局不變。
// 用法：node tests/ballistics.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/ballistics.mjs <群組名>   只跑那一群（隔離副本裡用）
// 真實 Chrome 在 tests/ballistics-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY, SHELL_AP, SHELL_SMALL,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_ZOMBIE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyMap } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { applyRules } from '../src/sim/rules.ts';
import { ARMOR_FRONT, ARMOR_SIDE, ARMOR_REAR, FACE_FRONT, FACE_SIDE, FACE_REAR, armorFace, armorPct } from '../src/sim/armor.ts';
import { ARMOR_MM, PEN_MM, METERS_PER_CELL, penetration, apHit } from '../src/sim/ballistics.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';

// 有名字的車（編號照 src/sim/world.ts 的順序）
const BT7 = 12, T70 = 13, T34 = 14, T3485 = 15, KV1 = 16, IS2 = 17, SU76 = 18, SU85 = 19, SU152 = 20, ZIS3 = 21, M30 = 22;
const STUART = 23, SHERMAN = 24, M4A376 = 25, M18 = 26, PRIEST = 27, M157 = 28, PZ2 = 29, PZ4 = 30, PANTHER = 31, TIGER = 32, STUG = 33, PAK40 = 34;
const HAGO = 35, CHIHA = 36, SHINHOTO = 37, CHIHE = 38, HONI = 39, TYPE90 = 40;
assert.deepEqual([BT7, IS2, M30, STUART, PRIEST, PZ2, PANTHER, TIGER, PAK40, HAGO, TYPE90].map(k => UNIT_KINDS[k].name), ['BT-7', 'IS-2', 'M-30', 'M3 Stuart', 'M7 Priest', 'Panzer II', 'Panther', 'Tiger I', 'PaK 40', '九五式 Ha-Go', '九〇式 75mm'], 'fixture: the kind numbers used below are the vehicles they claim to be');

const FACES = [[FACE_FRONT, '正面'], [FACE_SIDE, '側面'], [FACE_REAR, '後面']];
const meters = cells => cells * METERS_PER_CELL, units = cells => cells * SUB;
// 一片空地（沒有房子、路、彈坑、植被），上面只放守衛自己擺的單位
function field(ap) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (ap) applyRules(w, { ap: 1 });
  return w;
}
function put(w, side, kind, x, z, hullX = SUB, hullZ = 0) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x, z, hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX, hullZ } : {}) };
  w.units.push(u);
  return u;
}
// 目標在中間、車頭朝 +x、不還手；射手在它的正面（+x）、側面（+z）或後面（−x）幾格外。走到第一發落地為止
function duel(shooterKind, targetKind, cells, face, ap, limit = 600) {
  const w = field(ap), tx = center(16), tz = center(16), d = units(cells);
  const [dx, dz] = face === FACE_FRONT ? [d, 0] : face === FACE_SIDE ? [0, d] : [-d, 0];
  const target = put(w, SIDE_ENEMY, targetKind, tx, tz); target.cooldown = 1e9;
  const shooter = put(w, SIDE_PLAYER, shooterKind, tx + dx, tz + dz);
  if (UNIT_KINDS[targetKind].armored) assert.equal(armorFace(target, shooter.x, shooter.z), face, 'fixture: the shooter stands on the face it claims');
  const hp0 = target.hp;
  let impact = null, fired = 0;
  for (let i = 0; i < limit && !impact; i++) {
    step(w, []);
    for (const e of w.events) { if (e.e === 'fire' && e.unit === shooter.id) fired++; if (e.e === 'impact' && (e.kind === SHELL_AP || e.kind === SHELL_SMALL)) impact = e; }
  }
  assert(impact && fired >= 1, `fixture: ${UNIT_KINDS[shooterKind].name} fires at ${UNIT_KINDS[targetKind].name} from ${cells} cells and the shot lands`);
  return { lost: hp0 - target.hp, bounce: impact.bounce === 1, side: impact.side, w };
}
const target = (kind, face) => {   // apHit 用的假目標：車頭朝 +x
  const t = { id: 1, side: SIDE_ENEMY, kind, x: 0, z: 0, hp: 1, alive: true, hullX: SUB, hullZ: 0 };
  return [t, face === FACE_FRONT ? 1 : face === FACE_SIDE ? 0 : -1, face === FACE_SIDE ? 1 : 0];
};
// kind 在 m 公尺外打 targetKind 的那一面，穿不穿（直接問表）
const pens = (kind, targetKind, face, m) => { const [t, ux, uz] = target(targetKind, face), d = Math.round((m * SUB) / METERS_PER_CELL); return apHit(kind, ux * d, uz * d, t) === 1; };
const rangeM = kind => meters(UNIT_KINDS[kind].range / SUB);

const groups = {
  // 驗收 1：表
  table() {
    UNIT_KINDS.forEach((k, kind) => {
      const armour = ARMOR_MM[kind], pen = PEN_MM[kind];
      if (k.armored) assert(armour && armour.length === 3 && armour.every(v => Number.isInteger(v) && v > 0), `table: ${k.name} is armoured and has three positive thicknesses`);
      else assert.equal(armour, undefined, `table: ${k.name} has no armour and no thickness`);
      const firesShot = k.range > 0 && !k.indirect && kind !== UK_ZOMBIE;   // 直射的砲與步兵班
      if (firesShot) assert(pen && pen.length === 2 && pen.every(Number.isInteger) && pen[0] >= pen[1] && pen[1] >= 0, `table: ${k.name} fires shot and has a penetration that falls with range`);
      else assert.equal(pen, undefined, `table: ${k.name} is not in the penetration table`);
    });
    for (const kind of [UK_HOWITZER, UK_MORTAR, UK_OBSERVER, UK_ZOMBIE, M30, PRIEST]) assert.equal(penetration(kind, SUB), -1, `table: ${UNIT_KINDS[kind].name} has no penetration`);
    assert.deepEqual([ARMOR_MM[UK_HEAVY], ARMOR_MM[TIGER], ARMOR_MM[PANTHER][0], PEN_MM[PAK40], ARMOR_MM[UK_TANK], PEN_MM[UK_TANK], PEN_MM[UK_INFANTRY]], [[78, 65, 55], [100, 80, 80], 140, [108, 80], [30, 20, 15], [44, 32], [21, 0]], 'table: the numbers are the ones on the card');
  },
  // 驗收 2：穿深隨距離遞減
  pen() {
    for (const [kind, [near, far]] of Object.entries(PEN_MM).map(([k, v]) => [Number(k), v])) {
      const name = UNIT_KINDS[kind].name, at = m => penetration(kind, Math.round((m * SUB) / METERS_PER_CELL));
      assert.equal(at(100), near, `pen: ${name} at 100 m is the table's near value`);
      assert.equal(at(1000), far, `pen: ${name} at 1000 m equals the table's far value`);
      assert.deepEqual([at(0), at(50)], [near, near], `pen: ${name} inside 100 m stays at the near value`);
      assert(at(500) <= near && at(500) >= far && (near === far || at(500) < near), `pen: ${name} at 500 m lies between the two values (${at(500)})`);
      assert(at(1300) <= far && at(1300) >= 0 && at(100000) === 0, `pen: ${name} keeps falling past 1000 m and never goes below 0`);
      for (let m = 0; m <= 1500; m += 37) assert(Number.isInteger(at(m)) && at(m) >= at(m + 37), `pen: ${name} is a whole number that never rises with range (${m} m)`);
    }
    assert.equal(penetration(UK_TANK, units(5)), Math.floor((44 * 900 - 12 * 400) / 900), 'pen: straight-line interpolation at 500 m (medium tank gun)');
  },
  // 驗收 3：沒開規則＝R104 的百分比
  off() {
    const k = UNIT_KINDS[UK_TANK];
    for (const [face, pct] of [[FACE_FRONT, ARMOR_FRONT], [FACE_SIDE, ARMOR_SIDE], [FACE_REAR, ARMOR_REAR]]) {
      const r = duel(UK_TANK, UK_ASSAULT, 5, face, false), expected = Math.floor((Math.floor((Math.floor((k.dmgUnit * pct) / 100) * k.pierce) / 100) * UNIT_KINDS[UK_ASSAULT].armor) / 100);
      assert.deepEqual([r.lost, r.bounce], [expected, false], `off: without the rule a hit on face ${face} still does ${pct}% (R104)`);
    }
    assert.equal(duel(UK_TANK, UK_HEAVY, 5, FACE_FRONT, false).bounce, false, 'off: without the rule nothing ever bounces');
    assert.deepEqual([FACE_FRONT, FACE_SIDE, FACE_REAR].map(f => { const [t, x, z] = target(UK_TANK, f); return armorPct(t, x * SUB, z * SUB); }), [ARMOR_FRONT, ARMOR_SIDE, ARMOR_REAR], 'off: armorPct still maps the faces to 75/100/125');
  },
  // 驗收 4：彈開與穿透
  bounce() {
    const miss = duel(UK_TANK, UK_HEAVY, 5, FACE_FRONT, true);
    assert.equal(miss.lost, 0, 'bounce: a shot that cannot penetrate does no damage');
    assert.deepEqual([miss.bounce, miss.side], [true, SIDE_PLAYER], 'bounce: the impact event carries bounce and the shooter side');
    const hit = duel(UK_TANK, UK_TANK, 5, FACE_FRONT, true);
    assert.deepEqual([hit.lost, hit.bounce], [Math.floor((UNIT_KINDS[UK_TANK].dmgUnit * UNIT_KINDS[UK_TANK].armor) / 100), false], 'bounce: a penetrating shot does the gun\'s full damage, no bounce flag');
    const tough = duel(PAK40, UK_HEAVY, 5, FACE_FRONT, true);
    assert.equal(tough.lost, Math.floor((UNIT_KINDS[PAK40].dmgUnit * UNIT_KINDS[UK_HEAVY].armor) / 100), 'bounce: the target\'s own damage percentage still applies after penetration');
    const rear = duel(UK_TANK, UK_TANK, 5, FACE_REAR, true), front = duel(UK_TANK, UK_TANK, 5, FACE_FRONT, true);
    assert.equal(rear.lost, front.lost, 'bounce: with the rule on, a penetrating hit does the same damage from any side (no 75%/125%)');
  },
  // 驗收 5：方向
  facing() {
    assert.equal(duel(UK_TANK, UK_ASSAULT, 5, FACE_FRONT, true).bounce, true, 'facing: the medium tank bounces off the assault gun from the front');
    assert.equal(duel(UK_TANK, UK_ASSAULT, 5, FACE_SIDE, true).bounce, false, 'facing: the medium tank penetrates the assault gun from the side');
    assert.equal(duel(UK_TANK, UK_ASSAULT, 5, FACE_REAR, true).bounce, false, 'facing: the medium tank penetrates the assault gun from the rear');
    assert(duel(UK_TANK, UK_ASSAULT, 5, FACE_SIDE, true).lost > 0, 'facing: the side hit really hurts');
  },
  // 驗收 6：距離
  range() {
    const rear = ARMOR_MM[UK_TANK][FACE_REAR], cellsMax = UNIT_KINDS[UK_LIGHT].range / SUB;
    let near = 0, far = 0;
    for (let c = 1; c <= cellsMax; c++) { if (penetration(UK_LIGHT, units(c)) >= rear) near = c; else if (!far) far = c; }
    assert(near >= 1 && far > near && far <= cellsMax, `fixture: the light tank gun defeats the medium tank's rear up to ${near} cells and fails from ${far}`);
    assert.equal(duel(UK_LIGHT, UK_TANK, near, FACE_REAR, true).bounce, false, `range: the light tank penetrates the medium tank's rear at ${near} cells`);
    assert.equal(duel(UK_LIGHT, UK_TANK, far, FACE_REAR, true).bounce, true, `range: the same shot bounces at ${far} cells`);
  },
  // 驗收 7：高爆彈不受影響
  he() {
    const shell = ap => {
      const w = field(ap), t = put(w, SIDE_ENEMY, UK_HEAVY, center(16), center(16)); t.cooldown = 1e9;
      put(w, SIDE_PLAYER, UK_HOWITZER, center(16), center(16) + units(10)); put(w, SIDE_PLAYER, UK_OBSERVER, center(16), center(16) + units(6));
      const log = [{ tick: 0, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [2], x: 16, z: 16 } }];
      runLog(w, log, 900);
      return { lost: UNIT_KINDS[UK_HEAVY].hp - t.hp, hash: hashWorld(w), rng: w.rng };
    };
    const off = shell(false), on = shell(true);
    assert(off.lost > 0, `fixture: the howitzer's high explosive hurts the heavy tank (${off.lost})`);
    assert.deepEqual([on.lost, on.rng], [off.lost, off.rng], 'he: high explosive does the same to armour with the rule on or off');
  },
  // 驗收 8：步兵班
  infantry() {
    const car = cells => [duel(UK_INFANTRY, UK_ARMORED_CAR, cells, FACE_FRONT, false).lost, duel(UK_INFANTRY, UK_ARMORED_CAR, cells, FACE_FRONT, true)];
    const [offLost, on] = car(2);
    assert(pens(UK_INFANTRY, UK_ARMORED_CAR, FACE_FRONT, 200), 'fixture: the anti-tank rifle defeats the armoured car at 200 m');
    assert.deepEqual([on.lost, on.bounce], [offLost, false], 'infantry: when the anti-tank rifle penetrates, the damage is what it was without the rule');
    const tank = duel(UK_INFANTRY, UK_TANK, 2, FACE_FRONT, true);
    assert.deepEqual([tank.lost, tank.bounce], [0, false], 'infantry: rifle fire on the medium tank\'s front does nothing and is not reported as a bounce');
    assert(duel(UK_INFANTRY, UK_TANK, 2, FACE_FRONT, false).lost >= 0, 'fixture: without the rule the same shot is resolved the old way');
    assert.equal(duel(UK_INFANTRY, UK_DESTROYER, 2, FACE_FRONT, true).lost, duel(UK_INFANTRY, UK_DESTROYER, 2, FACE_FRONT, false).lost, 'infantry: an open-topped vehicle is hit the old way (R044)');
    assert.equal(apHit(UK_INFANTRY, SUB, 0, target(UK_DESTROYER, FACE_FRONT)[0]), -1, 'infantry: apHit steps aside for open-topped targets');
  },
  // 驗收 9：沒有裝甲的目標、建築
  soft() {
    for (const kind of [UK_ATGUN, UK_HOWITZER, UK_INFANTRY, UK_OBSERVER]) {
      const off = duel(UK_TANK, kind, 5, FACE_FRONT, false), on = duel(UK_TANK, kind, 5, FACE_FRONT, true);
      assert.deepEqual([on.lost, on.bounce], [off.lost, false], `soft: ${UNIT_KINDS[kind].name} has no armour and takes the same hit with the rule on`);
    }
    const wall = ap => {
      const w = createWorld(7); if (ap) applyRules(w, { ap: 1 });
      const b = w.blds[0], log = [{ tick: 0, cmd: { t: 'fireAt', side: SIDE_PLAYER, ids: [1, 2, 3], x: b.x, z: b.z } }];
      runLog(w, log, 600);
      return w.blds.map(x => x.hp).join(',');
    };
    assert.equal(wall(true), wall(false), 'soft: buildings take the same damage with the rule on');
    assert.equal(apHit(UK_TANK, SUB, 0, { id: 1, side: 1, kind: UK_ATGUN, x: 0, z: 0, hp: 1, alive: true }), -1, 'soft: apHit steps aside for unarmoured targets');
    assert.equal(apHit(UK_HOWITZER, SUB, 0, target(UK_TANK, FACE_FRONT)[0]), -1, 'soft: apHit steps aside for shooters without a penetration');
  },
  // 驗收 10：卡面的對照表（逐列由表算）
  relations() {
    const every = (kinds, targetKind, faces, expected, why) => { for (const k of kinds) for (const f of faces) for (let m = 100; m <= rangeM(k); m += 100) assert.equal(pens(k, targetKind, f, m), expected, `relations: ${why} (${UNIT_KINDS[k].name} → ${UNIT_KINDS[targetKind].name} face ${f} at ${m} m)`); };
    const ALL = [FACE_FRONT, FACE_SIDE, FACE_REAR];
    every([UK_TANK, UK_ATGUN, UK_DESTROYER], UK_HEAVY, ALL, false, 'nothing direct-firing in 1940 defeats the heavy tank from any side at any range');
    every([UK_TANK], UK_TANK, [FACE_FRONT], true, 'the medium tank defeats the medium tank\'s front anywhere in range');
    every([UK_TANK], UK_ASSAULT, [FACE_FRONT], false, 'the medium tank bounces off the assault gun\'s front');
    every([UK_TANK], UK_ASSAULT, [FACE_SIDE, FACE_REAR], true, 'the medium tank defeats the assault gun\'s side and rear');
    every([UK_LIGHT, UK_ARMORED_CAR], UK_TANK, [FACE_FRONT], false, 'the 2 cm gun bounces off the medium tank\'s front');
    for (const k of [UK_LIGHT, UK_ARMORED_CAR]) assert(pens(k, UK_TANK, FACE_REAR, 300) && !pens(k, UK_TANK, FACE_REAR, 700), `relations: ${UNIT_KINDS[k].name} defeats the medium tank's rear only at close range`);
    for (const t of [UK_ARMORED_CAR, UK_LIGHT]) assert(pens(UK_INFANTRY, t, FACE_FRONT, 200), `relations: the anti-tank rifle defeats the ${UNIT_KINDS[t].name} at close range`);
    every([UK_INFANTRY], UK_TANK, [FACE_FRONT], false, 'the anti-tank rifle bounces off the medium tank\'s front');
    every([SHERMAN, T34], TIGER, [FACE_FRONT], false, 'the Sherman 75 and the T-34/76 bounce off the Tiger\'s front');
    every([T3485, M4A376], TIGER, [FACE_FRONT], false, 'the T-34/85 and the 76 mm Sherman bounce off the Tiger\'s front');
    every([T3485, M4A376], TIGER, [FACE_SIDE], true, 'the T-34/85 and the 76 mm Sherman defeat the Tiger\'s side');
    for (const k of [PAK40, PZ4, TIGER]) for (const m of [100, 300, 500]) assert(pens(k, T34, FACE_FRONT, m), `relations: ${UNIT_KINDS[k].name} defeats the T-34's front inside 500 m (${m} m)`);
    for (const k of Object.keys(PEN_MM).map(Number)) for (const t of [PANTHER, IS2]) assert.equal(pens(k, t, FACE_FRONT, 100), false, `relations: no gun defeats the ${UNIT_KINDS[t].name}'s front (${UNIT_KINDS[k].name} at 100 m)`);
    assert(pens(PAK40, PANTHER, FACE_SIDE, 500) && pens(TIGER, IS2, FACE_SIDE, 500), 'relations: the Panther and the IS-2 can be taken from the side');
    every([SHINHOTO, CHIHE], SHERMAN, [FACE_FRONT], false, 'the Type 1 47 mm bounces off the Sherman\'s front');
    every([SHINHOTO, CHIHE], SHERMAN, [FACE_SIDE], true, 'the Type 1 47 mm defeats the Sherman\'s side');
  },
  // 驗收 11：規則的值與雜湊
  hash() {
    const open = (...cmds) => { const w = createWorld(41); step(w, cmds); return w; };
    const plain = hashWorld(open());
    for (const v of [0, 2, -1, 1.5, '1', true, null, undefined]) {
      const w = open({ t: 'rules', ap: v });
      assert.equal(hashWorld(w), plain, `hash: ap ${String(v)} (${typeof v}) is the same world as no rules command`);
      assert.equal(w.rules, undefined, `hash: ap ${String(v)} leaves no rules state`);
    }
    const on = open({ t: 'rules', ap: 1 });
    assert.deepEqual(on.rules, { ap: 1 }, 'hash: ap 1 is stored');
    assert.notEqual(hashWorld(on), plain, 'hash: the ap rule is folded into the world hash');
    assert.deepEqual(open({ t: 'rules', ap: 1, force: 3, income: 1 }).rules, { force: 3, income: 1, ap: 1 }, 'hash: ap sits beside force and income');
    assert.equal(new Set([hashWorld(open({ t: 'rules', force: 3 })), hashWorld(open({ t: 'rules', force: 3, ap: 1 }))]).size, 2, 'hash: ap changes the hash of a world that already has rules');
    assert.equal(isCommand({ t: 'rules', ap: 1 }) && isCommand({ t: 'rules', force: 3, income: 1, ap: 1 }) && !isCommand({ t: 'rules', ap: '1' }), true, 'check: isCommand knows the ap field');
  },
  // 驗收 12：決定性（有重坦克的大地圖、雙方交給電腦，打到真的發生過彈開）
  determinism() {
    const rules = { t: 'rules', ap: 1 }, seed = 51;
    const log = [{ t: 'map', id: MAP_LARGE, vegetation: 1 }, rules, { t: 'ai', side: SIDE_ENEMY, level: 3 }, { t: 'ai', side: SIDE_PLAYER, level: 3 }].map(cmd => ({ tick: 0, cmd }));
    const probe = createWorld(seed);
    let first = -1, bounces = 0;
    for (let i = 0; i < 6000 && (first < 0 || probe.tick < first + 300); i++) {
      runLog(probe, log, probe.tick + 1);
      for (const e of probe.events) if (e.e === 'impact' && e.bounce) { bounces++; if (first < 0) first = probe.tick; }
    }
    assert(first > 0 && bounces >= 1, `fixture: shots really bounce in this battle (first at tick ${first}, ${bounces} in all)`);
    const TICKS = probe.tick, a = hashWorld(probe);
    assert.equal(hashWorld(runLog(createWorld(seed), log, TICKS)), a, 'determinism: same seed and log give the same hash twice');
    assert.equal(hashWorld(runLog(createWorld(seed), JSON.parse(JSON.stringify(log)), TICKS)), a, 'determinism: the log survives a JSON round trip');
    const half = runLog(createWorld(seed), log, TICKS >> 1), copy = structuredClone(half);
    assert.equal(hashWorld(runLog(half, log, TICKS)), a, 'determinism: continuing from the middle matches');
    assert.equal(hashWorld(runLog(copy, log, TICKS)), a, 'determinism: a structuredClone taken mid-battle finishes the same');
    const preview = createWorld(seed); applyMap(preview, MAP_LARGE, 1); applyRules(preview, rules);
    assert.equal(hashWorld(runLog(preview, log, TICKS)), a, 'determinism: applying map and rules directly before step() equals replaying the log');
    assert.notEqual(hashWorld(runLog(createWorld(seed), log.filter(c => c.cmd.t !== 'rules'), TICKS)), a, 'determinism: the same battle without the rule ends differently');
  },
  // 驗收 13：舊局
  legacy() {
    const golden = JSON.parse(readFileSync(new URL('../tools/golden.json', import.meta.url), 'utf8'));
    assert.equal(hashWorld(runScript()), golden.hash, 'legacy: the scripted battle still matches tools/golden.json');
    assert.equal(SCRIPT.some(c => c.cmd.t === 'rules'), false, 'legacy: the scripted battle carries no rules command');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`ballistics/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK ballistics/${name}`); }

// ---- 故意弄壞（驗收 14）：隔離副本只跑對應那一群；第一個錯誤必須是指定的 AssertionError ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r051-negative-'));
const mutants = [
  ['bounce_damages', 'bounce', 'step.ts', '      if (ap === 0) bounce = s.kind === SHELL_AP;', '      if (ap === 0) { bounce = s.kind === SHELL_AP; damageUnit(w, t!, k.dmgUnit); }', 'bounce: a shot that cannot penetrate does no damage'],
  ['always_front', 'facing', 'ballistics.ts', 'plate[armorFace(t, sx, sz)]', 'plate[0]', 'facing: the medium tank penetrates the assault gun from the side'],
  ['no_falloff', 'pen', 'ballistics.ts', '(p[0] - p[1]) * (m - 100)', '0 * (m - 100)', "pen: tank at 1000 m equals the table's far value"],
  ['missing_hash', 'hash', 'world.ts', ' if (w.rules.ap) f.int(0x5241).int(w.rules.ap);', '', 'hash: ap changes the hash of a world that already has rules'],   // 只有 ap 的世界還有「有規則」那個標記撐著，要兩個都有規則的世界才分得出來
  ['rule_always_on', 'off', 'step.ts', 'const ap = w.rules?.ap && t && t.alive', 'const ap = t && t.alive', 'off: without the rule a hit on face 0 still does 75% (R104)'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tools/golden.json'), join(dir, 'tools/golden.json'));
    cpSync(join(root, 'tests/ballistics.mjs'), join(dir, 'tests/ballistics.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/ballistics.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1];
    assert.equal(first, wanted, `${name}: intended assertion must fail first, got ${output.slice(-1500)}`);
    console.log(`OK ballistics-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`ballistics: all groups OK, ${mutants.length} isolated mutants rejected`);
