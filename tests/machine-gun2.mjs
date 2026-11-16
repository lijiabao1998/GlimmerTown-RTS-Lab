// R081 機槍組第二版（eco 的 mg＝2）：不開瀏覽器的部分。舊的不動（mg＝1 的對戰、帶蘇聯與國際兵種的對戰、黃金雜湊）、
// 旗標、鐵絲網擋得住、打在房子上只壓敵人（步槍與砲照舊）、電腦只挑打得到的目標（打不到就換位置、經典規則不打進目標的房子）、
// 換位置挑走得到的、集結時不走開、對付機槍組也要打得到、稜線也算擋住、戰報的開局算進第 0 步送的單位、
// 點選疊著的單位時輪流（旁邊的敵人照樣點得到；雙擊照樣跟車）；第一版的這幾條照舊（R081 複查補的）。
// 用法：node tests/machine-gun2.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/machine-gun2.mjs <群組名>   只跑那一群（隔離副本裡用）
// 難度的高下與打牆的比例在 tests/machine-gun2-duel.mjs；真實 Chrome 在 tests/machine-gun2-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createWorld, hashWorld, center, cellOf, cellIdx, blocks, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, SIDE_PLAYER, SIDE_ENEMY, BK_WIRE,
  SOVIET_KINDS, INTERNATIONAL_KINDS, UK_TANK, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, UK_MG } from '../src/sim/world.ts';
import { step, ridge } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi } from '../src/sim/ai.ts';
import { machineGuns3, mgTargetFor, canHit, mgBusy, MG_SHIFT, MG_WALK } from '../src/sim/ai3.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { pickUnitAt, STACK_PX, KEEP_PX } from '../src/ui/pick.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { bombardCommand, bombardTarget } from '../src/ui/commandMenu.ts';
import { duel, ECO } from '../tools/duel.mjs';
import { makeSave, checkSave } from '../src/ui/saveGame.ts';

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
// 真的 main.ts 輸入處理段（跟 tests/input-timing.mjs 同一段、同一套假東西），開著 R081；一格十像素的平面鏡頭；事件時間＝處理時間
function fakeClock() {
  let now = 0, next = 0; const timers = new Map();
  return {
    now: () => now, set: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; }, clear: id => timers.delete(id),
    to(t) { for (;;) { const due = [...timers].filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); } now = t; },
  };
}
async function inputFixture(w) {
  const main = stripTypeScriptTypes(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
  const { Gestures, inSelectionRect } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL('../src/ui/gestures.ts', import.meta.url), 'utf8'))).toString('base64')}`);
  const clock = fakeClock(), canvasEvents = new Map(), glides = [], issued = [];
  const view = { target: { x: 16, z: 16 }, zoom: 1, visibleUnit: () => true, unitHeight: () => 0,
    screenOf: (x, y, z) => [x * 10, z * 10 - y * 10], groundAt: (x, y) => ({ x: x / 10, z: y / 10 }), buildingAt: () => null,
    pan() {}, zoomAt() {}, zoomBy() {}, setMarker() {}, dispose() {}, setWorld() {} };
  let menu = null;
  const c = vm.createContext({
    V: { r109: true, r012: true, r037: true, r081: true }, Gestures: class extends Gestures { constructor(a) { super(a, clock); } }, inSelectionRect,
    commandMenu: undefined, battleHint: undefined,
    document: { createElement: () => ({ id: '', hidden: false, style: {} }), body: { appendChild() {} }, addEventListener() {} },
    addEventListener() {}, canvas: { addEventListener: (t, f) => canvasEvents.set(t, f), setPointerCapture() {} }, performance: { now: clock.now },
    view, w, selected: new Set(), phase: 'battle', fireMode: false, ammo: 'he', paused: false,
    battleAudio: undefined, syncBattleAudio() {}, hud: { update() {} }, prodBar: { update() {} },
    help: { visible: () => false }, reportView: { visible: () => false, hide() {} },
    fling: { stop() {}, start() {} }, glide: { stop() {}, start: (...a) => glides.push(a) },
    dragV: { vx: 0, vy: 0, t: 0 }, lastTap: { id: 0, t: -1e9 },
    innerWidth: 412, innerHeight: 860, SIDE_PLAYER: ME, SIDE_ENEMY: FOE, SUB, routeBattleOrder, bombardCommand, bombardTarget, pickUnitAt,
    issue: cmd => issued.push(cmd), simT: () => 0, planner: { placeAt() {} },
    initCommandMenu: () => ({ open(target) { menu = target; }, close() { menu = null; }, isOpen: () => menu !== null, contains: () => false }),
  });
  vm.runInContext(main.slice(main.indexOf('const pointers ='), main.indexOf('\nreset();')), c);
  const send = (name, at, x, y, extra) => { clock.to(at); const e = { pointerId: 1, pointerType: 'touch', button: 0, shiftKey: false, clientX: x, clientY: y, timeStamp: at, ...extra }; canvasEvents.get(name)?.(e); if (name === 'pointerup') canvasEvents.get('lostpointercapture')?.(e); };
  // 點一下（按下、40 毫秒後放手）；at＝按下的時間；u＝點在哪個單位身上
  const tapOn = (at, u, extra = {}) => { const x = u.x / SUB * 10, y = u.z / SUB * 10 - 1.5; send('pointerdown', at, x, y, extra); send('pointerup', at + 40, x, y, extra); };
  // 長按（按下、700 毫秒後放手）
  const holdOn = (at, u) => { const x = u.x / SUB * 10, y = u.z / SUB * 10 - 1.5; send('pointerdown', at, x, y); send('pointerup', at + 700, x, y); };
  return { selected: () => [...c.selected], glides, issued, tapOn, holdOn, menu: () => menu };
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
    { const w = field(2, true), rifle = put(w, ME, UK_INFANTRY, 6, 16, true); house(w, 9, 16);   // 步槍隔著自己人進駐的房子打敵人
      const inside = put(w, ME, UK_INFANTRY, 9, 16), foe = put(w, FOE, UK_INFANTRY, 11, 16);
      const n = bursts(w, rifle, 60, [{ t: 'attack', side: ME, ids: [rifle.id], target: foe.id }]);
      assert(n.walls >= 1, `fixture: the rifle rounds hit the house (${n.walls})`);
      assert((inside.sup ?? 0) > 0, 'house: rifles and guns still suppress everyone in a house they hit, their own side too (only the machine-gun team spares it; the R052 rule is unchanged)'); }
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
    // 經典規則（沒有士氣）：點射打進房子只扣房子 1 點、屋裡的人不受影響——近的那一班進駐在房子裡、遠一點的在空地上
    const classic = mg => {
      const w = field(mg), g = put(w, ME, UK_MG, 10, 12, true); put(w, ME, UK_TANK, 8, 12); put(w, ME, UK_TANK, 8, 13);
      house(w, 13, 12, 150); put(w, FOE, UK_INFANTRY, 13, 12); const open = put(w, FOE, UK_INFANTRY, 14, 17);
      setAi(w, ME, 3, 3);
      return { ...bursts(w, g, 600), open };
    };
    const c1 = classic(1), c2 = classic(2);
    assert(c1.walls >= 20 && c1.open.hp === UNIT_KINDS[UK_INFANTRY].hp, `fixture: under classic rules the first version keeps firing into the garrisoned house (${c1.walls} of ${c1.all}) and never at the squad in the open`);
    assert(c2.walls === 0 && c2.open.hp < UNIT_KINDS[UK_INFANTRY].hp, `target: under classic rules the version-2 computer does not fire into the house of a garrisoned target (it does nothing there) and shoots the squad in the open instead (${c2.walls} into the house, open squad hp ${c2.open.hp})`);
    // 第二次審查：遠的那一班在另一棟房子後面——經典規則下為它換位置，不因為近的那一班（打不到）就停著
    { const w = field(2), g = put(w, ME, UK_MG, 10, 12, true); put(w, ME, UK_TANK, 8, 12); put(w, ME, UK_TANK, 8, 13);
      house(w, 13, 12, 150); put(w, FOE, UK_INFANTRY, 13, 12); const open = put(w, FOE, UK_INFANTRY, 14, 19); house(w, 12, 16);
      setAi(w, ME, 3, 3);
      const n = bursts(w, g, 600);
      assert(n.walls === 0 && open.hp < UNIT_KINDS[UK_INFANTRY].hp, `target: under classic rules, with the nearer squad garrisoned, it moves for the one in the open behind another house and hits it (${n.all} bursts, ${n.walls} into houses, open squad hp ${open.hp})`); }
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
    // 鐵絲網（R081 複查）：直線最近、打得到的那一格在網的另一邊，要繞一大圈；網這一邊兩步就到的也打得到 → 挑走得到的
    assert.equal(MG_WALK, 2 * MG_SHIFT, 'fixture: the walking limit on the card');
    { const w = field(2, true), g = put(w, ME, UK_MG, 6, 16); put(w, ME, UK_TANK, 3, 16); put(w, ME, UK_TANK, 3, 17);
      const t = put(w, FOE, UK_INFANTRY, 16, 22); put(w, ME, UK_OBSERVER, 16, 14);
      for (const [x, z] of [[12, 16], [8, 20], [12, 20], [10, 12]]) house(w, x, z);
      w.wires = { version: 1, segments: [] };
      for (let z = 8; z <= 23; z++) w.wires.segments.push({ id: z, kind: BK_WIRE, x: 7, z, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 1 });
      setAi(w, ME, 3, 3);
      const walk = (x, z) => findPath(w, cellOf(g.x), cellOf(g.z), x, z, 0, 0, UK_MG).length;
      assert(canHit(w, center(8), center(16), t) && walk(8, 16) > 2 * MG_WALK, `fixture: the nearest cell with a line to the target is across the wire, a long walk round (${walk(8, 16)} steps)`);
      const c = machineGuns3(w, w.ai[0], w.units.filter(u => u.side === ME), [t], () => false)[0]?.[1];
      assert(c?.t === 'move' && walk(c.x, c.z) <= MG_WALK && canHit(w, center(c.x), center(c.z), t), `shift: it picks a cell it can walk to in a few steps, not one across the wire (${c?.x},${c?.z}: ${c ? walk(c.x, c.z) : '-'} steps)`); }
    // 第二次審查：房子圍著它（兩邊與前面）——挑的是 3 格內打得到的格子裡走得最少的，不是房子、不切角、不只看直線距離
    { const w = field(2, true), g = put(w, ME, UK_MG, 6, 16); put(w, ME, UK_TANK, 3, 16); put(w, ME, UK_TANK, 3, 17);
      const t = put(w, FOE, UK_INFANTRY, 14, 16);
      for (const [x, z] of [[7, 15], [7, 16], [7, 17], [6, 15], [6, 17]]) house(w, x, z);
      setAi(w, ME, 3, 3);
      const walk = (x, z) => findPath(w, cellOf(g.x), cellOf(g.z), x, z, 0, 0, UK_MG).length;
      let least = Infinity;
      for (let dz = -MG_SHIFT; dz <= MG_SHIFT; dz++) for (let dx = -MG_SHIFT; dx <= MG_SHIFT; dx++) {
        const x = cellOf(g.x) + dx, z = cellOf(g.z) + dz;
        if ((dx || dz) && !blocks(w, x, z) && Math.hypot(center(x) - t.x, center(z) - t.z) <= UNIT_KINDS[UK_MG].range && canHit(w, center(x), center(z), t)) least = Math.min(least, walk(x, z));
      }
      const c = machineGuns3(w, w.ai[0], w.units.filter(u => u.side === ME), [t], () => false)[0]?.[1];
      assert(c?.t === 'move' && !blocks(w, c.x, c.z) && walk(c.x, c.z) === least, `shift: with houses all round it picks the cell it can reach in the fewest steps (${c?.x},${c?.z}: ${c && !blocks(w, c.x, c.z) ? walk(c.x, c.z) : 'a house'}, least ${least})`); }
  },
  // 集結：在基地等波次、射程內有打得到的目標的機槍組，不被叫去集結點；沒有的照舊跟波次一起集結
  gather() {
    const camp = (withTarget, version = 2) => {
      const w = createWorld(7);
      step(w, [{ t: 'map', id: 0, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: version }, { t: 'ai', side: FOE, level: 3, v: 3 }]);
      const mine = w.units.filter(u => u.alive && u.side === FOE), mg = mine.find(u => u.kind === UK_MG);
      for (const u of mine) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; u.cooldown = 1e9; }
      for (const u of w.units) if (u.side !== FOE) u.alive = false;
      mg.x = center(1); mg.z = center(9);
      if (withTarget) { const t = put(w, ME, UK_INFANTRY, 5, 9); t.cooldown = 1e9; assert(canHit(w, mg.x, mg.z, t), 'fixture: four cells away in the empty corner, nothing in between'); }
      w.ai[0].next = w.tick; step(w, []);
      return mg;
    };
    const busy = camp(true), idle = camp(false), first = camp(true, 1);
    assert.equal(idle.order, ORD_MOVE, 'fixture: with nothing to shoot the team gathers with the wave');
    assert.equal(busy.order, ORD_ATTACK, 'gather: a team with a target it can hit stays and shoots instead of walking to the rally point');
    assert.equal(first.order, ORD_MOVE, 'gather: the first version still walks to the rally point (records since R080 stay the same)');
  },
  // 對付機槍組：射線被房子擋住的不改打；射線清楚的改打
  counter() {
    const w = field(2), tank = put(w, ME, UK_TANK, 10, 16), squad = put(w, FOE, UK_INFANTRY, 14, 16), hidden = put(w, FOE, UK_MG, 16, 16), open = put(w, FOE, UK_MG, 15, 20);
    house(w, 13, 16);
    assert.equal(mgTargetFor(tank, squad, [hidden], w), undefined, 'counter: a machine-gun team behind a house is not switched to');
    assert.equal(mgTargetFor(tank, squad, [hidden, open], w), open, 'counter: one with a clear line is');
    const v1 = field(1); house(v1, 13, 16);   // 同一棟房子，第一版的世界
    assert.equal(mgTargetFor(tank, squad, [hidden], v1), hidden, 'counter: the first version does not look at the line (records since R080 stay the same)');
  },
  // 丘陵（R055 的地圖 4）：稜線也算擋住——機槍組不打稜線後面的、直射的車不改打稜線後面的機槍組
  hills() {
    const w = createWorld(1944);
    step(w, [{ t: 'map', id: 4, vegetation: 1 }, { t: 'rules', morale: 2 }, { t: 'eco', inf: 1, mg: 2 }]);
    w.units = []; w.blds = []; w.occ.fill(0);
    const g = put(w, ME, UK_MG, 27, 11, true), t = put(w, FOE, UK_INFANTRY, 20, 5); put(w, ME, UK_TANK, 27, 13); put(w, ME, UK_TANK, 28, 13);
    assert(ridge(w, g.x, g.z, t.x, t.z) && Math.hypot(g.x - t.x, g.z - t.z) <= UNIT_KINDS[UK_MG].range, 'fixture: a crest between the team and the squad, no house, in range');
    setAi(w, ME, 3, 3);
    assert.equal(canHit(w, g.x, g.z, t), false, 'hills: a target behind a crest does not count as hittable');
    const out = machineGuns3(w, w.ai[0], w.units.filter(u => u.side === ME), [t], () => false);
    assert(!out.some(([, c]) => c?.t === 'attack'), `hills: and the team is not ordered to fire at it (${JSON.stringify(out.map(([, c]) => c))})`);
    const tank = put(w, ME, UK_TANK, 26, 11), sq = put(w, FOE, UK_INFANTRY, 24, 14), hidden = put(w, FOE, UK_MG, 20, 5), open = put(w, FOE, UK_MG, 26, 15);
    assert(ridge(w, tank.x, tank.z, hidden.x, hidden.z) && Math.hypot(tank.x - hidden.x, tank.z - hidden.z) <= UNIT_KINDS[UK_TANK].range, 'fixture: a crest between the tank and that team, in range');
    assert.equal(mgTargetFor(tank, sq, [hidden], w), undefined, 'hills: a tank does not switch to a machine-gun team behind a crest');
    assert.equal(mgTargetFor(tank, sq, [hidden, open], w), open, 'fixture: it does switch to one in plain view');
  },
  // 戰報：第 0 步補給送的單位算進開局，打一步之後擊毀、損失都是 0；整局打完，擊毀與損失＝真的陣亡數（中途造的也算；R081 複查）
  report() {
    const sum = a => a.reduce((p, x) => p + x, 0);
    const play = ecoStart => { const w = createWorld(1944); const st = newStats(w); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'eco', inf: 1, guns: 1, mg: 2 }]); statsStep(st, w, w.events, ecoStart); return makeReport(w, st); };
    const fixed = play(true), old = play(false);
    assert(old.lost < 0, `fixture: before this card the first step already shows a negative loss (${old.lost})`);
    assert(sum(fixed.start[ME]) > sum(old.start[ME]), `report: the opening counts the units the economy hands out at step 0 (${sum(old.start[ME])} -> ${sum(fixed.start[ME])})`);
    assert.deepEqual([fixed.kills, fixed.lost], [0, 0], 'report: with those counted, nothing is killed or lost at the start');
    // 萊伊、經典規則、雙方第三版困難互打到分出勝負；測試自己數 kill 事件
    const whole = (ecoStart, rebuild = false) => {
      const w = createWorld(1), dead = [0, 0];
      let st = newStats(w);
      const cmds = [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, end: 1, mg: 2 }, { t: 'ai', side: FOE, level: 3, v: 3 }, { t: 'ai', side: ME, level: 3, v: 3 }];
      let mid = null, midDead = null;   // 打到第 2,000 步存一次檔（分出勝負的局不能存）
      for (let i = 0; w.winner < 0 && w.tick < 24000; i++) {
        step(w, i ? [] : cmds);
        for (const e of w.events) if (e.e === 'kill') dead[w.units[e.unit - 1].side]++;
        statsStep(st, w, w.events, ecoStart);
        if (rebuild && i === 0) st = newStats(w, ecoStart);   // 重播：第一步之後重建（src/main.ts 的 remake）
        if (w.tick === 2000 && w.winner < 0) { mid = makeSave(w, [], null, 'test', st); midDead = st.dead?.slice(); }
      }
      return { w, st, r: makeReport(w, st), dead, mid, midDead };
    };
    const now = whole(true), before = whole(false);
    assert(before.w.winner >= 0, 'fixture: the battle ends');
    assert.notDeepEqual([before.r.kills, before.r.lost], [before.dead[FOE], before.dead[ME]], `fixture: with units built during the battle the old count (opening minus alive) is wrong (${before.r.kills}/${before.r.lost} against ${before.dead[FOE]}/${before.dead[ME]})`);
    assert.deepEqual([now.r.kills, now.r.lost], [now.dead[FOE], now.dead[ME]], `report: after a whole battle with units built on the way, kills and losses are the units that really died (${now.r.kills}/${now.r.lost})`);
    assert(now.mid && now.midDead && now.midDead[0] + now.midDead[1] > 0, `fixture: a save in the middle of the battle, after some units died (${now.midDead})`);
    const replayed = whole(true, true);
    assert.deepEqual([replayed.r.kills, replayed.r.lost], [replayed.dead[FOE], replayed.dead[ME]], `report: a replay, which rebuilds the stats after the first step, shows the same kills and losses (${replayed.r.kills}/${replayed.r.lost}; R081 second review)`);
    const loaded = checkSave(now.mid);
    assert(loaded.ok && loaded.save.stats?.dead?.join() === now.midDead.join(), `report: a save keeps the death counts (${loaded.ok ? JSON.stringify(loaded.save.stats?.dead) : loaded.why})`);
  },
  // 點選：疊著的我方單位照編號輪流；疊著的敵人不會被輪到；沒有選東西時選最近的
  pick() {
    const w = field(2), at = (id) => w.units[id - 1];
    const a = put(w, ME, UK_INFANTRY, 10, 10), b = put(w, ME, UK_MG, 10, 10), foe = put(w, FOE, UK_INFANTRY, 10, 10), c = put(w, ME, UK_MORTAR, 10, 10), far = put(w, ME, UK_TANK, 20, 20);
    const beside = put(w, FOE, UK_INFANTRY, 12, 10);   // 疊著的那一點旁邊兩格（20 像素，在 26 像素的點選範圍裡）
    const view = { visibleUnit: () => true, unitHeight: () => 0, screenOf: (x, y, z) => [x * 10, z * 10] };   // 一格十像素的平面鏡頭
    const tap = (stack, on = a) => pickUnitAt(w, view, at(on.id).x / SUB * 10, at(on.id).z / SUB * 10, 400, 400, stack);
    const sel = (...ids) => ({ selected: new Set(ids) });
    assert.equal(tap(undefined), a.id, 'pick: with no stack options given it picks the nearest (the lowest id on a tie)');
    assert.equal(tap(sel()), a.id, 'pick: with nothing selected it picks the nearest');
    assert.deepEqual([tap(sel(a.id)), tap(sel(b.id)), tap(sel(c.id))], [b.id, c.id, a.id], 'pick: tapping a stack again cycles through the own units there by id');
    assert(![tap(sel(a.id)), tap(sel(b.id)), tap(sel(c.id))].includes(foe.id), 'pick: an enemy stacked there is never chosen by cycling');
    assert.equal(tap(sel(far.id)), a.id, 'pick: with another unit selected elsewhere the tap picks the nearest as before');
    assert.equal(tap(sel(a.id, b.id)), a.id, 'pick: with several selected it does not cycle');
    assert.equal(tap(sel(a.id), beside), beside.id, 'pick: a tap on an enemy right beside the stack still picks the enemy (R081 review)');
    assert.equal(tap({ keep: c.id }), c.id, 'pick: the quick second tap of a double tap stays on the unit the first tap chose');
    assert.deepEqual([tap({ keep: far.id }), tap({ keep: beside.id })], [a.id, a.id], 'pick: a kept unit that is not in the stack (or not ours) is ignored');
    { const v = field(2), p = put(v, ME, UK_INFANTRY, 10, 10), q = put(v, ME, UK_TANK, 10, 10); q.x += Math.round(0.6 * SUB);   // 旁邊 6 像素的另一個
      const on = u => pickUnitAt(v, view, u.x / SUB * 10, u.z / SUB * 10, 400, 400, { keep: p.id });
      assert.equal(KEEP_PX, 2, 'fixture: the double-tap tie tolerance on the card');
      assert.deepEqual([on(p), on(q)], [p.id, q.id], 'pick: a quick tap on another own unit right beside the first one picks that one, not the first (R081 second review)'); }
    assert.equal(STACK_PX, 8, 'fixture: the stack tolerance on the card');
  },
  // 真的 main.ts 輸入處理：隔一下再點換選；雙擊照樣跟車；點、右鍵、長按旁邊的敵人照樣打它（R081 複查）
  async input() {
    const w = field(2), a = put(w, ME, UK_INFANTRY, 10, 10), b = put(w, ME, UK_MG, 10, 10), foe = put(w, FOE, UK_INFANTRY, 12, 10);
    const f = await inputFixture(w);
    f.tapOn(1000, a); assert.deepEqual(f.selected(), [a.id], 'fixture: the first tap on the stack selects the infantry (the lowest id)');
    f.tapOn(2000, a); assert.deepEqual(f.selected(), [b.id], 'input: a second tap on the stack a while later selects the machine-gun team');
    f.tapOn(3000, a); assert.deepEqual(f.selected(), [a.id], 'fixture: and the next one goes back to the infantry');
    f.tapOn(5000, a); f.tapOn(5150, a);
    assert.deepEqual([f.glides.length, f.selected()], [1, [b.id]], 'input: a double tap on the stack still makes the camera follow (the second tap stays on the unit the first tap chose)');
    f.tapOn(7000, foe);
    assert.deepEqual(f.issued.at(-1), { t: 'attack', side: ME, ids: [b.id], target: foe.id }, `input: a tap on an enemy beside the stack orders the attack (${JSON.stringify(f.issued.at(-1))})`);
    f.tapOn(9000, a); f.tapOn(10000, foe, { pointerType: 'mouse', button: 2 });
    assert.deepEqual(f.issued.at(-1), { t: 'attack', side: ME, ids: [a.id], target: foe.id }, `input: so does a right-click a while after the last tap (${JSON.stringify(f.issued.at(-1))})`);
    { const v = field(2), p = put(v, ME, UK_INFANTRY, 10, 10), q = put(v, ME, UK_TANK, 10, 10); q.x += Math.round(0.6 * SUB);
      const g = await inputFixture(v);
      g.tapOn(1000, p); g.tapOn(1200, q);
      assert.deepEqual([g.glides.length, g.selected()], [0, [q.id]], 'input: a quick tap on another own unit right beside the first one selects that one (no camera follow)'); }
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); await groups[only](); console.log(`machine-gun2/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { await run(); console.log(`OK machine-gun2/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts');
  assert.match(read('../src/valves.ts'), /get r081\(\) \{ return on\('081'\); \}/, 'valve: r081 is on the table');
  assert.match(main, /\.\.\.\(V\.r080 \? \{ mg: V\.r081 \? 2 : 1 \} : \{\}\) \}\);/, 'wiring: a new battle sends mg 2 unless ?noR081=1');
  assert.match(main, /pickUnitAt\(w, view, cx, cy, innerWidth, innerHeight, V\.r081 && t !== undefined \? \(t - lastTap\.t >= 350 \? \{ selected \} : \{ keep: lastTap\.id \}\) : undefined\)/, 'wiring: only taps (with their event time) cycle through a stack or keep the unit of a double tap, and only with the valve on');
  assert.equal(main.split('unit: pickUnit(cx, cy),').length - 1, 2, 'wiring: orders and long presses pick without a time, so they never cycle');
  assert.match(main, /const hit = pickUnit\(cx, cy, t\)/, 'wiring: tap() hands its own event time to the picker (the same clock as the double tap)');
  assert.match(main, /statsStep\(stats, w, w\.events, V\.r081\);/, 'wiring: the report counts the step-0 units behind the valve');
  assert.match(main, /remake: \(\) => \{ view\.dispose\(\); view = view\.recreate\(w\); stats = newStats\(w, V\.r081\); ui\(\); \}/, 'wiring: a replay rebuilds the stats with the death count behind the valve');
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
  ['garrison_skipped', 'target', 'sim/ai3.ts', '  return !!w.rules?.morale && !!home && home.hp > 0 && w.occ[c] === home.id;', '  return false;', 'target: a squad garrisoned in the first house on the line is still shot at'],
  ['classic_garrison', 'target', 'sim/ai3.ts', '  return !!w.rules?.morale && !!home && home.hp > 0 && w.occ[c] === home.id;', '  return !!home && home.hp > 0 && w.occ[c] === home.id;', 'target: under classic rules the version-2 computer does not fire into the house'],
  ['rifles_spare', 'house', 'sim/step.ts', 'k.sup && mgSecond(w) ? s.side : -1', 'mgSecond(w) ? s.side : -1', 'house: rifles and guns still suppress everyone in a house they hit'],
  ['no_shift', 'shift', 'sim/ai3.ts', '      if (spot) { out.push([g, { t: \'move\', side, ids: [g.id], x: spot[0], z: spot[1] }]); continue; }', '', 'shift: to a cell within'],   // 拿掉換位置，它照舊往主力走（也是移動指令），差在目的地打不到
  ['shift_ignores_walk', 'shift', 'sim/ai3.ts', 'const x = gx + dx, z = gz + dz, s = steps[(dz + MG_WALK) * S + dx + MG_WALK];', 'const x = gx + dx, z = gz + dz, s = inGrid(w, x, z) && !blocks(w, x, z) && !wireBlocks(w, x, z, UK_MG) ? 0 : -1;', 'shift: it picks a cell it can walk to in a few steps'],
  ['bfs_ignores_houses', 'shift', 'sim/ai3.ts', 'inGrid(w, x, z) && !blocks(w, x, z) && !wireBlocks(w, x, z, UK_MG);', 'inGrid(w, x, z) && !wireBlocks(w, x, z, UK_MG);', 'shift: with houses all round it picks'],
  ['bfs_cuts_corners', 'shift', 'sim/ai3.ts', ' || (k >= 4 && (!free(nx, z) || !free(x, nz)))) continue;', ') continue;', 'shift: with houses all round it picks'],
  ['rank_by_distance', 'shift', 'sim/ai3.ts', 'if (!best || s < bs || (s === bs && d < bd))', 'if (!best || d < bd)', 'shift: with houses all round it picks'],
  ['classic_shift_stalls', 'target', 'sim/ai3.ts', 'const reachable = inRange.filter(e => !!w.rules?.morale || !(UNIT_KINDS[e.kind].garrison && blocks(w, cellOf(e.x), cellOf(e.z))));', 'const reachable = inRange.slice();', 'target: under classic rules, with the nearer squad garrisoned'],
  ['shift_too_far', 'shift', 'sim/ai3.ts', 'for (let dz = -MG_SHIFT; dz <= MG_SHIFT; dz++) for (let dx = -MG_SHIFT; dx <= MG_SHIFT; dx++) {', 'for (let dz = -MG_SHIFT * 3; dz <= MG_SHIFT * 3; dz++) for (let dx = -MG_SHIFT * 3; dx <= MG_SHIFT * 3; dx++) {', 'shift: to a cell within'],   // R081 複查之後：搜得太遠，第一個場面就挑到 3 格外
  ['gather_pulls', 'gather', 'sim/ai2.ts', ' && !mgBusy(w, u, seen));', ');', 'gather: a team with a target it can hit stays and shoots'],
  ['busy_ungated', 'gather', 'sim/ai3.ts', '  if (!mgSecond(w)) return false;\n', '', 'gather: the first version still walks to the rally point'],
  ['counter_blind', 'counter', 'sim/ai3.ts', ' && !(w && mgSecond(w) && !clearShot(w, u, e))', '', 'counter: a machine-gun team behind a house is not switched to'],
  ['counter_ungated', 'counter', 'sim/ai3.ts', ' && !(w && mgSecond(w) && !clearShot(w, u, e))', ' && !(w && !clearShot(w, u, e))', 'counter: the first version does not look at the line'],
  ['canhit_no_ridge', 'hills', 'sim/ai3.ts', '  if (ridge(w, x, z, t.x, t.z)) return false;\n', '', 'hills: a target behind a crest does not count as hittable'],
  ['clear_no_ridge', 'hills', 'sim/ai3.ts', '!ridge(w, u.x, u.z, t.x, t.z) && firstBlock(', 'firstBlock(', 'hills: a tank does not switch to a machine-gun team behind a crest'],
  ['report_unfixed', 'report', 'ui/report.ts', '  if (ecoStart && w.tick === 1 && w.eco) st.start = [count(w, SIDE_PLAYER, false), count(w, SIDE_ENEMY, false)];\n', '', 'report: the opening counts the units the economy hands out at step 0'],
  ['report_dead_unused', 'report', 'ui/report.ts', 'kills: st.dead ? st.dead[SIDE_ENEMY] : sum(', 'kills: sum(', 'report: after a whole battle with units built on the way'],
  ['report_dead_never', 'report', 'ui/report.ts', '  if (ecoStart && w.tick === 1 && w.eco) st.dead = [0, 0];\n', '', 'report: after a whole battle with units built on the way'],
  ['replay_drops_dead', 'report', 'ui/report.ts', ', ...(ecoStart && w.tick === 1 && w.eco ? { dead: [0, 0] } : {}) };', ' };', 'report: a replay, which rebuilds the stats'],
  ['save_drops_dead', 'report', 'ui/saveGame.ts', ', ...(r.dead ? { dead: [...(r.dead as number[])] } : {})', '', 'report: a save keeps the death counts'],
  ['pick_no_cycle', 'pick', 'ui/pick.ts', '    if (at >= 0 && ids.length > 1) return ids[(at + 1) % ids.length];', '', 'pick: tapping a stack again cycles'],
  ['pick_cycles_enemy', 'pick', 'ui/pick.ts', 'if (stack && u.side === SIDE_PLAYER && d < 26 * 26)', 'if (stack && d < 26 * 26)', 'pick: tapping a stack again cycles'],
  ['pick_over_enemy', 'pick', 'ui/pick.ts', ' && w.units[best - 1]?.side === SIDE_PLAYER) {', ') {', 'pick: a tap on an enemy right beside the stack still picks the enemy'],
  ['pick_no_keep', 'pick', 'ui/pick.ts', '    if (kept && kept[0] <= near + KEEP_PX) return kept[1];\n', '', 'pick: the quick second tap of a double tap stays'],
  ['keep_no_tie', 'pick', 'ui/pick.ts', 'if (kept && kept[0] <= near + KEEP_PX) return', 'if (kept && kept[0] <= near + STACK_PX) return', 'pick: a quick tap on another own unit right beside the first one'],
  ['input_no_keep', 'input', 'main.ts', ': { keep: lastTap.id }) : undefined', ': {}) : undefined', 'input: a double tap on the stack still makes the camera follow'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'src/ui'), join(dir, 'src/ui'), { recursive: true });
    cpSync(join(root, 'src/main.ts'), join(dir, 'src/main.ts'));
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
