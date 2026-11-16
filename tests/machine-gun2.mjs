// R081 機槍組第二版（eco 的 mg＝2）：不開瀏覽器的部分。舊的不動（mg＝1 的對戰、帶蘇聯與國際兵種的對戰、黃金雜湊）、
// 旗標、鐵絲網擋得住、打在房子上只壓敵人、電腦只挑打得到的目標（打不到就換位置）、集結時不走開、對付機槍組也要打得到、
// 戰報的開局算進第 0 步送的單位、點選疊著的單位時輪流。
// 用法：node tests/machine-gun2.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/machine-gun2.mjs <群組名>   只跑那一群（隔離副本裡用）
// 難度的高下與打牆的比例在 tests/machine-gun2-duel.mjs；真實 Chrome 在 tests/machine-gun2-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, SIDE_PLAYER, SIDE_ENEMY, BK_WIRE,
  SOVIET_KINDS, INTERNATIONAL_KINDS, UK_TANK, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, UK_MG } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi } from '../src/sim/ai.ts';
import { machineGuns3, mgTargetFor, canHit, mgBusy, MG_SHIFT } from '../src/sim/ai3.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { pickUnitAt, STACK_PX } from '../src/ui/pick.ts';
import { duel } from '../tools/duel.mjs';

const ME = SIDE_PLAYER, FOE = SIDE_ENEMY;
// 一片空地，上面只放守衛自己擺的東西；mg＝機槍組第幾版（放在一份最小的 eco 上），morale＝開不開士氣第二版
function field(mg, morale = false) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (morale) applyRules(w, { morale: 2 });
  w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], ...(mg ? { mg } : {}) };
  return w;
}
function put(w, side, kind, cx, cz, ready = false) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const house = (w, x, z, hp = 4000) => { const b = { id: w.blds.length + 1, kind: 0, x, z, w: 1, d: 1, floors: 1, hp, maxHp: hp }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
const wireLine = (w, x, gap = -1) => { w.wires = { version: 1, segments: [] }; for (let z = 0; z < w.n; z++) if (z !== gap) w.wires.segments.push({ id: z + 1, kind: BK_WIRE, x, z, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 1 }); };
// 跑 n 步；回傳 shooter 打出去的點射（打到房子的另外數）。在發射的當下記（近距離的點射同一步就落地，步後已經不在 w.shells 裡）
function bursts(w, shooter, n, cmds = []) {
  let all = 0, walls = 0;
  for (let i = 0; i < n; i++) {
    w.shells.push = function (...xs) { for (const s of xs) if (s.shooter === shooter.id) { all++; if (s.hitBld) walls++; } return Array.prototype.push.apply(this, xs); };
    step(w, i === 0 ? cmds : []);
  }
  delete w.shells.push;
  return { all, walls };
}
// 蘇聯、國際兵種的對戰：敵方第二版電腦；我方照時間表下令造（補給快）
function arsenalLog(map, realistic, part) {
  const kinds = [...SOVIET_KINDS, ...INTERNATIONAL_KINDS].filter((_, i) => i % 2 === part);
  const log = [{ t: 'map', id: map, vegetation: 1 }, { t: 'rules', income: 3, ...(realistic ? { ap: 1, morale: 2 } : {}) }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1 }, { t: 'ai', side: FOE, level: 2, v: 2 }].map(cmd => ({ tick: 0, cmd }));
  kinds.forEach((kind, i) => log.push({ tick: 200 + i * 450, cmd: { t: 'produce', side: ME, kind } }));
  return log;
}

const groups = {
  // 舊的不動：黃金雜湊、mg＝1 的四局、帶蘇聯與國際兵種的四局（都是這張卡之前在 main fbcdac7 上算的）
  old() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'old: the golden script battle is unchanged');
    const mg1 = [];
    for (const map of [0, 1]) for (const rules of [null, { ap: 1, morale: 2 }]) mg1.push(duel({ map, seed: 31 + map, ticks: 3000, rules, end: true, mg: 1, a: { level: 3, v: 3 }, b: { level: 3, v: 3 } }).hash);
    assert.deepEqual(mg1, ['6fc5f4f9', '0f1f8288', '97ce2f1b', 'e3ce0be3'], 'old: battles with the first machine-gun version are bit for bit what they were before this card');
    const arsenal = [];
    for (const map of [0, 1]) for (const realistic of [false, true]) {
      const w = createWorld(41 + map), log = arsenalLog(map, realistic, realistic ? 1 : 0);
      let i = 0;
      while (w.tick < 9000 && w.winner < 0) { const now = []; while (i < log.length && log[i].tick === w.tick) now.push(log[i++].cmd); step(w, now); }
      assert(w.units.filter(u => SOVIET_KINDS.includes(u.kind) || INTERNATIONAL_KINDS.includes(u.kind)).length >= 8, 'fixture: the Soviet and international units were really built');
      arsenal.push(hashWorld(w));
    }
    assert.deepEqual(arsenal, ['5bc9995c', 'd17855f2', '445c15e0', '4c12446a'], 'old: battles that build Soviet and international units are bit for bit what they were before this card');
  },
  // 旗標：mg＝2 存成 2、雜湊跟 1 不同、指令檢查收 2；不是 2 的值都算第一版
  flag() {
    const eco = mg => { const w = createWorld(3); step(w, [{ t: 'eco', inf: 1, ...(mg !== undefined ? { mg } : {}) }]); return w; };
    assert.deepEqual([eco(2).eco.mg, eco(1).eco.mg, eco(3).eco.mg, eco(undefined).eco.mg], [2, 1, 1, undefined], 'flag: mg 2 is stored as the second version; any other number is the first');
    assert.notEqual(hashWorld(eco(2)), hashWorld(eco(1)), 'flag: the two versions hash differently');
    assert.deepEqual([isCommand({ t: 'eco', mg: 2 }), isCommand({ t: 'eco', mg: 2.5 })], [true, false], 'flag: the command check takes 2');
  },
  // 鐵絲網：第二版的機槍組停在網前；網上有缺口就繞過去；第一版照舊穿過去
  wire() {
    const cross = (mg, gap) => { const w = field(mg); wireLine(w, 10, gap); const g = put(w, ME, UK_MG, 6, 16); step(w, [{ t: 'move', side: ME, ids: [g.id], x: 14, z: 16 }]); for (let i = 0; i < 900; i++) step(w, []); return [cellOf(g.x), cellOf(g.z)]; };
    assert.deepEqual(cross(1), [14, 16], 'fixture: the first version walks through the wire (R080 as merged)');
    assert.deepEqual(cross(2), [9, 16], 'wire: a version-2 team stops at the wire like the infantry');
    assert.deepEqual(cross(2, 12), [14, 16], 'wire: and goes round through a gap');
  },
  // 房子：第二版的點射打在房子上只壓屋裡的敵人；第一版照舊不分敵我
  house() {
    const shoot = (mg, side) => {   // 機槍組隔著一棟房子打 9 格外的敵人；房子裡進駐的是 side 那一方的步兵
      const w = field(mg, true), g = put(w, ME, UK_MG, 6, 16, true); house(w, 10, 16);
      const inside = put(w, side, UK_INFANTRY, 10, 16), foe = put(w, FOE, UK_INFANTRY, 15, 16);
      const n = bursts(w, g, 30, [{ t: 'attack', side: ME, ids: [g.id], target: side === FOE ? inside.id : foe.id }]);
      assert(n.walls >= 2, `fixture: the bursts hit the house (${n.walls})`);
      return inside.sup ?? 0;
    };
    assert.equal(shoot(2, ME), 0, "house: a version-2 burst into a house spares the team's own garrison");
    assert(shoot(2, FOE) > 0, 'house: the enemy garrison of a house is still suppressed');
    assert(shoot(1, ME) > 0, 'fixture: the first version suppresses its own garrison (R052 since)');
  },
  // 電腦挑目標：房子擋在射線上 → 不往房子打，換位置打中目標；空地照舊；目標就在射線上的第一棟房子裡 → 照打
  target() {
    const wall = mg => {
      const w = field(mg, true), g = put(w, ME, UK_MG, 6, 16, true); put(w, ME, UK_OBSERVER, 14, 11);
      const sq = put(w, FOE, UK_INFANTRY, 14, 16); sq.cooldown = 1e9; house(w, 10, 16, 90);
      setAi(w, ME, 3, 3);
      return { ...bursts(w, g, 300), sq };
    };
    const first = wall(1), second = wall(2);
    assert(first.walls >= 5 && (first.sq.sup ?? 0) === 0, `fixture: the first version keeps shooting the wall (${first.walls} of ${first.all} bursts) and never touches the squad`);
    assert.equal(second.walls, 0, 'target: the version-2 computer sends no bursts into a house that only stands in the way');
    assert(second.all > 0 && ((second.sq.sup ?? 0) > 0 || second.sq.hp < 60), `target: it moves and hits the squad instead (${second.all} bursts, squad hp ${second.sq.hp}, suppression ${second.sq.sup ?? 0})`);
    { const w = field(2, true), g = put(w, ME, UK_MG, 6, 16, true); put(w, ME, UK_OBSERVER, 12, 11); const b = house(w, 12, 16), inside = put(w, FOE, UK_INFANTRY, 12, 16);
      setAi(w, ME, 3, 3); const n = bursts(w, g, 60);
      assert(n.walls >= 2 && (inside.sup ?? 0) > 0 && b.hp < b.maxHp, 'target: a squad garrisoned in the first house on the line is still shot at (the house takes the bursts and the squad is suppressed)'); }
    { const w = field(2, true), g = put(w, ME, UK_MG, 6, 16, true); put(w, ME, UK_OBSERVER, 14, 11); const sq = put(w, FOE, UK_INFANTRY, 14, 16); sq.cooldown = 1e9;
      setAi(w, ME, 3, 3); const n = bursts(w, g, 60);
      assert(n.all > 0 && n.walls === 0 && (sq.sup ?? 0) > 0, 'fixture: on open ground it shoots straight away'); }
  },
  // 換位置：目標都被擋住 → 移動指令，目的地在 MG_SHIFT 格內、從那裡打得到；找不到就跟著主力
  shift() {
    assert.equal(MG_SHIFT, 3, 'fixture: the number on the card is the number in src/sim/ai3.ts');
    const scene = (walls) => {
      const w = field(2, true), g = put(w, ME, UK_MG, 6, 16); put(w, ME, UK_TANK, 3, 16); put(w, ME, UK_TANK, 3, 17);
      const t = put(w, FOE, UK_INFANTRY, 14, 16);
      for (const [x, z] of walls) house(w, x, z);
      setAi(w, ME, 3, 3);
      return { w, g, t, out: machineGuns3(w, w.ai[0], w.units.filter(u => u.side === ME), [t], () => false) };
    };
    { const { w, g, t, out } = scene([[10, 16]]);
      assert(out.length === 1 && out[0][1]?.t === 'move', 'shift: with the only target behind a house it is given a move order');
      const c = out[0][1];
      assert(Math.max(Math.abs(c.x - cellOf(g.x)), Math.abs(c.z - cellOf(g.z))) <= MG_SHIFT && canHit(w, center(c.x), center(c.z), t), `shift: to a cell within ${MG_SHIFT} that has a line to it (${c.x},${c.z})`); }
    { const walls = []; for (let z = 8; z <= 24; z++) walls.push([10, z]);   // 一整排房子：3 格內都打不到
      const { out } = scene(walls);
      assert(out.length === 1 && out[0][1]?.t === 'move' && out[0][1].x === 3, 'shift: with no such cell it follows the armour as before'); }
  },
  // 集結：在基地等波次、射程內有打得到的目標的機槍組，不被叫去集結點；沒有的照舊跟波次一起集結
  gather() {
    const camp = withTarget => {
      const w = createWorld(7);
      step(w, [{ t: 'map', id: 0, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 2 }, { t: 'ai', side: FOE, level: 3, v: 3 }]);
      const mine = w.units.filter(u => u.alive && u.side === FOE), mg = mine.find(u => u.kind === UK_MG);
      for (const u of mine) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; u.cooldown = 1e9; }
      for (const u of w.units) if (u.side !== FOE) u.alive = false;
      mg.x = center(1); mg.z = center(9);
      if (withTarget) { const t = put(w, ME, UK_INFANTRY, 5, 9); t.cooldown = 1e9; assert(canHit(w, mg.x, mg.z, t), 'fixture: four cells away in the empty corner, nothing in between'); }
      w.ai[0].next = w.tick; step(w, []);
      return mg;
    };
    const busy = camp(true), idle = camp(false);
    assert.equal(idle.order, ORD_MOVE, 'fixture: with nothing to shoot the team gathers with the wave');
    assert.equal(busy.order, ORD_ATTACK, 'gather: a team with a target it can hit stays and shoots instead of walking to the rally point');
  },
  // 對付機槍組：射線被房子擋住的不改打；射線清楚的改打
  counter() {
    const w = field(2), tank = put(w, ME, UK_TANK, 10, 16), squad = put(w, FOE, UK_INFANTRY, 14, 16), hidden = put(w, FOE, UK_MG, 16, 16), open = put(w, FOE, UK_MG, 15, 20);
    house(w, 13, 16);
    assert.equal(mgTargetFor(tank, squad, [hidden], w), undefined, 'counter: a machine-gun team behind a house is not switched to');
    assert.equal(mgTargetFor(tank, squad, [hidden, open], w), open, 'counter: one with a clear line is');
    const v1 = field(1);
    assert.equal(mgTargetFor(tank, squad, [hidden], v1), hidden, 'fixture: the first version does not look at the line');
  },
  // 戰報：第 0 步補給送的單位算進開局，打一步之後擊毀、損失都是 0
  report() {
    const play = ecoStart => { const w = createWorld(1944); const st = newStats(w); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'eco', inf: 1, guns: 1, mg: 2 }]); statsStep(st, w, w.events, ecoStart); return makeReport(w, st); };
    const fixed = play(true), old = play(false);
    assert(old.lost < 0, `fixture: before this card the first step already shows a negative loss (${old.lost})`);
    assert.deepEqual([fixed.kills, fixed.lost], [0, 0], 'report: with the units the economy hands out at step 0 counted, nothing is killed or lost at the start');
  },
  // 點選：疊著的我方單位照編號輪流；疊著的敵人不會被輪到；沒有選東西時選最近的
  pick() {
    const w = field(2), at = (id) => w.units[id - 1];
    const a = put(w, ME, UK_INFANTRY, 10, 10), b = put(w, ME, UK_MG, 10, 10), foe = put(w, FOE, UK_INFANTRY, 10, 10), c = put(w, ME, UK_MORTAR, 10, 10), far = put(w, ME, UK_TANK, 20, 20);
    const view = { visibleUnit: () => true, unitHeight: () => 0, screenOf: (x, y, z) => [x * 10, z * 10] };   // 一格十像素的平面鏡頭
    const tap = sel => pickUnitAt(w, view, at(a.id).x / SUB * 10, at(a.id).z / SUB * 10, 400, 400, sel);
    assert.equal(tap(undefined), a.id, 'pick: with no selection given it picks the nearest (the lowest id on a tie)');
    assert.equal(tap(new Set()), a.id, 'pick: with nothing selected it picks the nearest');
    assert.deepEqual([tap(new Set([a.id])), tap(new Set([b.id])), tap(new Set([c.id]))], [b.id, c.id, a.id], 'pick: tapping a stack again cycles through the own units there by id');
    assert(![tap(new Set([a.id])), tap(new Set([b.id])), tap(new Set([c.id]))].includes(foe.id), 'pick: an enemy stacked there is never chosen by cycling');
    assert.equal(tap(new Set([far.id])), a.id, 'pick: with another unit selected elsewhere the tap picks the nearest as before');
    assert.equal(tap(new Set([a.id, b.id])), a.id, 'pick: with several selected it does not cycle');
    assert.equal(STACK_PX, 8, 'fixture: the stack tolerance on the card');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`machine-gun2/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK machine-gun2/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts');
  assert.match(read('../src/valves.ts'), /get r081\(\) \{ return on\('081'\); \}/, 'valve: r081 is on the table');
  assert.match(main, /\.\.\.\(V\.r080 \? \{ mg: V\.r081 \? 2 : 1 \} : \{\}\) \}\);/, 'wiring: a new battle sends mg 2 unless ?noR081=1');
  assert.match(main, /pickUnitAt\(w, view, cx, cy, innerWidth, innerHeight, V\.r081 && t - lastTap\.t >= 350 \? selected : undefined\)/, 'wiring: taps cycle only with the valve on and not on a quick double tap');
  assert.match(main, /const hit = pickUnit\(cx, cy, t\)/, 'wiring: tap() hands its own event time to the picker (the same clock as the double tap)');
  assert.match(main, /statsStep\(stats, w, w\.events, V\.r081\);/, 'wiring: the report counts the step-0 units behind the valve');
  assert.match(read('../README.md'), /\?noR081=1/, 'readme: the valve is documented');
  console.log('OK machine-gun2/files');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r081-negative-'));
const mutants = [
  ['first_version_changed', 'old', 'sim/world.ts', 'export const mgSecond = (w: World): boolean => (w.eco?.mg ?? 0) >= 2;', 'export const mgSecond = (w: World): boolean => (w.eco?.mg ?? 0) >= 1;', 'old: battles with the first machine-gun version are bit for bit'],
  ['version_not_stored', 'flag', 'sim/eco.ts', '...(mg ? { mg: mg >= 2 ? 2 : 1 } : {}) };', '...(mg ? { mg: 1 } : {}) };', 'flag: mg 2 is stored as the second version'],
  ['wire_ignores_team', 'wire', 'sim/world.ts', '  if (kind === UK_MG && mgSecond(w)) return (wireAt(w, x, z)?.hp ?? 0) > 0;', '', 'wire: a version-2 team stops at the wire'],
  ['house_spares_nobody', 'house', 'sim/step.ts', 'k.sup && mgSecond(w) ? s.side : -1', '-1', "house: a version-2 burst into a house spares the team's own garrison"],
  ['house_spares_enemy', 'house', 'sim/morale.ts', 'u.alive && u.side !== spare && UNIT_KINDS', 'u.alive && (spare < 0 || u.side === spare) && UNIT_KINDS', "house: a version-2 burst into a house spares the team's own garrison"],
  ['targets_blind', 'target', 'sim/ai3.ts', 'const near = inRange.filter(t => !second || canHit(w, g.x, g.z, t)).sort(', 'const near = inRange.filter(t => true).sort(', 'target: the version-2 computer sends no bursts into a house'],
  ['garrison_skipped', 'target', 'sim/ai3.ts', '  return !!home && home.hp > 0 && w.occ[c] === home.id;', '  return false;', 'target: a squad garrisoned in the first house on the line is still shot at'],
  ['no_shift', 'shift', 'sim/ai3.ts', '      if (spot) { out.push([g, { t: \'move\', side, ids: [g.id], x: spot[0], z: spot[1] }]); continue; }', '', 'shift: to a cell within'],   // 拿掉換位置，它照舊往主力走（也是移動指令），差在目的地打不到
  ['shift_too_far', 'shift', 'sim/ai3.ts', 'for (let dz = -MG_SHIFT; dz <= MG_SHIFT; dz++) for (let dx = -MG_SHIFT; dx <= MG_SHIFT; dx++) {', 'for (let dz = -MG_SHIFT * 3; dz <= MG_SHIFT * 3; dz++) for (let dx = -MG_SHIFT * 3; dx <= MG_SHIFT * 3; dx++) {', 'shift: with no such cell it follows the armour'],
  ['gather_pulls', 'gather', 'sim/ai2.ts', ' && !mgBusy(w, u, seen));', ');', 'gather: a team with a target it can hit stays and shoots'],
  ['counter_blind', 'counter', 'sim/ai3.ts', ' && !(w && mgSecond(w) && !clearShot(w, u, e))', '', 'counter: a machine-gun team behind a house is not switched to'],
  ['report_unfixed', 'report', 'ui/report.ts', '  if (ecoStart && w.tick === 1 && w.eco) st.start = [count(w, SIDE_PLAYER, false), count(w, SIDE_ENEMY, false)];\n', '', 'report: with the units the economy hands out at step 0 counted'],
  ['pick_no_cycle', 'pick', 'ui/pick.ts', '    if (at >= 0 && stack.length > 1) return stack[(at + 1) % stack.length];', '', 'pick: tapping a stack again cycles'],
  ['pick_cycles_enemy', 'pick', 'ui/pick.ts', 'if (selected && u.side === SIDE_PLAYER && d < 26 * 26)', 'if (selected && d < 26 * 26)', 'pick: tapping a stack again cycles'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true }); mkdirSync(join(dir, 'src/ui'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    for (const f of ['report.ts', 'pick.ts']) cpSync(join(root, 'src/ui', f), join(dir, 'src/ui', f));
    cpSync(join(root, 'tools/duel.mjs'), join(dir, 'tools/duel.mjs'));
    cpSync(join(root, 'tests/machine-gun2.mjs'), join(dir, 'tests/machine-gun2.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/machine-gun2.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK machine-gun2-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`machine-gun2: all groups OK, ${mutants.length} isolated mutants rejected`);
