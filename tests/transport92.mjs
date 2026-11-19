// R092 運輸：卡車（44）、半履帶車（45）。不開瀏覽器的部分，卡面驗收 2–22。
// 用法：node tests/transport92.mjs            全部各群
//       node tests/transport92.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/transport92-negative.mjs）
// 電腦一行都不多下在 tests/transport92-quiet.mjs；真 Chrome 在 tests/transport92-browser.mjs、tests/transport92-budget-browser.mjs；計時在 tools/r092-time.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, SHELL_AP, SHELL_SMALL, SHELL_HE, UK_AT91, SIDE_PLAYER as ME, SIDE_ENEMY as FOE,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_MG, UK_SNIPER, UK_LIGHT, UK_ARMORED_CAR, UK_TRUCK, UK_HALFTRACK, ORD_FIRE_AT, BK_WIRE, wireAt, wireBlocks, MORALE_PINNED, moraleState } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi, aiThink } from '../src/sim/ai.ts';
import { aiThink2 } from '../src/sim/ai2.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { PRODUCIBLE } from '../src/sim/eco.ts';
import { ARMOR_MM, PEN_MM, apHit, penetration } from '../src/sim/ballistics.ts';
import { applyBuild } from '../src/sim/build.ts';
import { rides92, tows92, REACH92 } from '../src/sim/transport92.ts';
import { dist } from '../src/sim/math.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { initTransport92, pair92 } from '../src/ui/transport92.ts';
import { Session } from '../src/net/session.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32），z＝16 那一列是路；eco 帶 tp（沒有指揮部）
function field(rules, tp = 1) {   // tp：1（R092）、2（R030）、false（沒有）
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  for (let x = 0; x < w.n; x++) w.ter[cellIdx(w, x, 16)] = 1;
  if (rules) applyRules(w, rules);   // 規則要在 eco 之前套（applyRules 遇到有 eco 的世界不套）
  w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], ...(tp ? { tp } : {}) };
  return w;
}
function put(w, side, kind, cx, cz, extra = {}) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}), ...extra };
  w.units.push(u);
  return u;
}
const move = (side, units, x, z = 16) => ({ t: 'move', side, ids: units.map(u => u.id), x, z });
const noTp = w => { const t = w.eco?.tp; if (t) delete w.eco.tp; const h = hashWorld(w); if (t) w.eco.tp = t; return h; };
const PINNED = JSON.parse('{"0/classic":"7cf36c7b","0/real":"94bb0e29","1/classic":"62558008","1/real":"2b424db7","2/classic":"aabba663","2/real":"c3b3e168","3/classic":"0f4216e4","3/real":"4639233a","5/classic":"7128d3be","5/real":"9c69f726","1/v1":"5aa77bc0","1/v2":"67e78410"}');   // ae950ae（R092 之前）
const PIN30 = JSON.parse('{"busy":["9bf8998d","25558eed","f73d3534","829c7c61","95e9c640","84fafa3e","246046ab","300e8f28","3d2d80f1","7f9edb08","817e6730","a9921dcd","ed244f62","2f9d2e8f","cca093b7","4e68891e","35bb3fd6","a272bff0","c7558b2b","53a32dce","75ba5750","805ad340","5ff9f780","a39b600f","d3b06763","446cebfd","bc557a39","59f5bd5a","c9b6e1c6","b80354bd"],"log92":["634e3ba7","8ec200c7"]}');   // 3645ead（R030 之前）：R030_PRINT=1 node tests/transport92.mjs replay 在基線上印出
const ROW = {   // 卡面「做什麼」第 1 節的表（守衛自己抄一份）
  [UK_TRUCK]: { name: '卡車', hp: 40, speed: 30, range: 0, minRange: 0, reload: 0, indirect: false, dmgUnit: 0, dmgBld: 0, splash: 0, sight: 6 * SUB, armor: 100, radius: 72, cost: 20, buildTicks: 140, garrison: false, armored: false, pierce: 100, men: 0, soft: 100, setup: false, carry: true },
  [UK_HALFTRACK]: { name: '半履帶車', hp: 70, speed: 22, range: 0, minRange: 0, reload: 0, indirect: false, dmgUnit: 0, dmgBld: 0, splash: 0, sight: 7 * SUB, armor: 100, radius: 76, cost: 35, buildTicks: 240, garrison: false, armored: true, pierce: 100, men: 0, soft: 100, setup: false, carry: true },
};
const NEW_GAME = { t: 'map', vegetation: 1, sym: 1, more: 1 }, NEW_ECO = { ...ECO, end: 1, mg: 2, pla: 1, sw: 1 };
function game(map, seed, extra, rules, ais, ticks) {
  const w = createWorld(seed);
  step(w, [{ ...NEW_GAME, id: map }, { ...NEW_ECO, ...extra }, ...(rules ? [{ t: 'rules', ...rules }] : []), ...ais]);
  while (w.tick < ticks) step(w, []);
  return w;
}
// 跑到 cond 成立或 limit 步
const until = (w, cond, limit = 2000) => { for (let i = 0; i < limit && !cond(); i++) step(w, []); return w.tick; };
const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// R030：上車、拖砲、到了放下、跳車各數幾次（每一步之前記連結，之後比）
const links = w => new Map(w.units.filter(u => u.ride || u.towBy).map(u => [u.id, [u.ride, u.towBy]]));
function tally(w, before, k) {
  for (const u of w.units) {
    const p = before.get(u.id);
    if (!p) { if (u.ride) k.board++; else if (u.towBy) k.tow++; continue; }
    if (u.ride || u.towBy) continue;
    const car = w.units[(p[0] || p[1]) - 1];
    if (car?.alive) { if (u.alive) k.drop++; } else if (p[0]) k.bail++;
  }
}
// R030：隨機下一道我方的指令。一半以上是車：載著的有時開去敵人那裡（被打爛才會跳車），不然開近一點（開得到、會放下）；
// 空車兩格內有人或砲就一起開，沒有就開去一門砲或一個人那裡（砲優先）；其餘是攻擊、射擊（拖著的砲連車一起選）、停、單獨移動
function order92(w, r) {
  const own = w.units.filter(u => u.alive && u.side === ME && !u.ride), foes = w.units.filter(u => u.alive && u.side === FOE);
  if (!own.length) return null;
  const pick = a => a[Math.floor(r() * a.length)], cars = own.filter(u => UNIT_KINDS[u.kind].carry), feet = own.filter(u => (rides92(u.kind) || tows92(u.kind)) && !u.towBy);
  const near = (u, k) => [Math.max(1, Math.min(w.n - 2, cellOf(u.x) + Math.floor(r() * (2 * k + 1)) - k)), Math.max(1, Math.min(w.n - 2, cellOf(u.z) + Math.floor(r() * (2 * k + 1)) - k))];
  const x = r();
  if (x < 0.55 && cars.length) {
    const c = pick(cars), tow = own.find(g => g.towBy === c.id), rider = w.units.some(u => u.alive && u.ride === c.id), free = feet.filter(u => dist(c.x, c.z, u.x, u.z) <= REACH92), [tx, tz] = near(c, 6);
    if (tow || rider) { const f = foes.length && r() < 0.3 ? pick(foes) : null; return { t: 'move', side: ME, ids: tow ? [c.id, tow.id] : [c.id], x: f ? cellOf(f.x) : tx, z: f ? cellOf(f.z) : tz }; }
    if (free.length) return { t: 'move', side: ME, ids: [c.id, pick(free).id], x: tx, z: tz };
    const guns = feet.filter(u => tows92(u.kind)), u = guns.length && r() < 0.6 ? pick(guns) : feet.length ? pick(feet) : null;
    if (u) return { t: 'move', side: ME, ids: [c.id], x: cellOf(u.x), z: cellOf(u.z) };
  }
  const g = pick(own), c = g.towBy ? w.units[g.towBy - 1] : null, ids = c ? [c.id, g.id] : [g.id];
  if (x < 0.7 && foes.length) return { t: 'attack', side: ME, ids, target: pick(foes).id };
  if (x < 0.8) { const [tx, tz] = near(g, 8); return { t: 'fireAt', side: ME, ids, x: tx, z: tz }; }
  if (x < 0.85) return { t: 'stop', side: ME, ids: [g.id] };
  const [tx, tz] = near(g, 10); return { t: 'move', side: ME, ids: [g.id], x: tx, z: tz };
}
// R030 驗收 3、5：一局 3,000 步的隨機指令（生產、上車、拖砲、攻擊、射擊、停），回傳每 100 步的雜湊與次數
function busyGame(tp) {
  const w = createWorld(1944), r = rngOf(30), hs = [], k = { board: 0, tow: 0, drop: 0, bail: 0 };
  step(w, [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, tp }, { t: 'ai', side: FOE, level: 3, v: 3 }]);
  while (w.tick < 3000) {
    const cmds = [];
    if (r() < 0.02) cmds.push({ t: 'produce', side: ME, kind: [UK_TRUCK, UK_INFANTRY, UK_ATGUN, UK_HALFTRACK][Math.floor(r() * 4)] });
    if (r() < 0.08) { const c = order92(w, r); if (c) cmds.push(c); }
    const before = links(w); step(w, cmds); tally(w, before, k);
    if (w.tick % 100 === 0) hs.push(hashWorld(w));
  }
  return { hs, k };
}
// R092 瀏覽器守衛那一份紀錄（卡車載一班、半履帶車拖反戰車砲）
const LOG92 = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, tp: 1 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 44 } }, { tick: 0, cmd: { t: 'produce', side: 0, kind: 45 } }, { tick: 640, cmd: { t: 'produce', side: 0, kind: 4 } }];

const groups = {
  // 驗收 2：舊局逐位不變（R030 從 flag 拆出來：flag 的故意弄壞不用每次跑這十二局）
  pinned() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const now = {}, v3 = [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }];
    for (const map of [0, 1, 2, 3, 5]) for (const real of [false, true]) now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(game(map, 31 + map, {}, real ? { ap: 1, morale: 2 } : null, v3, map === 5 ? 4000 : 3000));
    now['1/v1'] = hashWorld(game(1, 32, {}, null, [{ t: 'ai', side: 0, level: 3 }, { t: 'ai', side: 1, level: 2 }], 3000));
    now['1/v2'] = hashWorld(game(1, 32, {}, null, [{ t: 'ai', side: 0, level: 3, v: 2 }, { t: 'ai', side: 1, level: 2, v: 2 }], 3000));
    assert.deepEqual(now, PINNED, 'flag: twelve battles without tp are bit for bit what they were at ae950ae');
  },
  // 驗收 5：旗標、雜湊、指令檢查、兵種表
  flag() {
    const opened = extra => { const w = createWorld(5); step(w, [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, ...extra }]); return w; };
    const plain = opened({}), on = opened({ tp: 1 }), two = opened({ tp: 2 }), three = opened({ tp: 3 });
    assert.deepEqual([plain.eco.tp, on.eco.tp, three.eco.tp], [undefined, 1, undefined], 'flag: tp is stored only when the eco command sends 1 or 2');
    assert.notEqual(hashWorld(on), hashWorld(plain), 'flag: tp is folded into the hash');
    assert.equal(noTp(on), hashWorld(plain), 'flag: a new battle with tp opens exactly like one without it (apart from the tp fold)');
    assert.equal(two.eco.tp, 2, 'flag: tp 2 (R030) is stored as 2');
    assert(hashWorld(two) !== hashWorld(on) && noTp(two) === hashWorld(plain), 'flag: tp 2 folds differently from tp 1 and opens exactly like no tp');
    for (const bad of ['x', 1.5, '1']) assert.equal(isCommand({ ...ECO, tp: bad }), false, `flag: the command check refuses tp ${JSON.stringify(bad)}`);
    assert.equal(isCommand({ ...ECO, tp: 1 }), true, 'flag: the command check takes tp 1');
    { const a = field(), b = field(); for (const w of [a, b]) { put(w, ME, UK_TRUCK, 4, 16); put(w, ME, UK_INFANTRY, 5, 16); } b.units[1].ride = 1;
      assert.notEqual(hashWorld(a), hashWorld(b), 'flag: a ride link is folded into the hash'); b.units[1].ride = undefined; delete b.units[1].ride; b.units[1].towBy = 1; assert.notEqual(hashWorld(a), hashWorld(b), 'flag: a tow link is folded into the hash'); }
    for (const kind of [UK_TRUCK, UK_HALFTRACK]) assert.deepEqual(UNIT_KINDS[kind], ROW[kind], `flag: kind ${kind} matches the card's table`);
    assert.deepEqual([ARMOR_MM[UK_HALFTRACK], ARMOR_MM[UK_TRUCK], PEN_MM[UK_TRUCK], PEN_MM[UK_HALFTRACK]], [[14, 8, 8], undefined, undefined, undefined], 'flag: half-track armour 14/8/8, no gun on either');
    assert(PRODUCIBLE.includes(UK_TRUCK) && PRODUCIBLE.includes(UK_HALFTRACK), 'flag: both are producible');
    const all = UNIT_KINDS.map((_, k) => k);
    assert.deepEqual([all.filter(rides92), all.filter(tows92)], [[2, 3, 5, 41, 42, 43], [1, 4, 21, 22, 28, 34, 40]], 'flag: who rides and who is towed');
  },
  // 驗收 3、7：沒有 tp 造不出來、不上車；帶 tp 照價錢與時間造；喪屍防守不開放
  produce() {
    const opened = (extra, zombies = false) => { const w = createWorld(5); step(w, [{ ...NEW_GAME, id: 1 }, ...(zombies ? [{ t: 'zombies' }] : []), { ...NEW_ECO, ...extra }]); return w; };
    for (const kind of [UK_TRUCK, UK_HALFTRACK]) {
      const w = opened({}), s = w.eco.supply[ME];
      step(w, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([w.eco.queue[ME].length, w.eco.supply[ME], productionBlockReason(w, kind)], [0, s, '本局未開放此單位'], `noflag: kind ${kind} cannot be produced without tp`);
      const z = opened({ tp: 1 }, true), sz = z.eco.supply[ME];
      step(z, [{ t: 'produce', side: ME, kind }]);
      assert.deepEqual([z.eco.queue[ME].length, z.eco.supply[ME], productionBlockReason(z, kind)], [0, sz, '本局未開放此單位'], `produce: zombie defence does not offer kind ${kind}, even with tp`);
      const g = opened({ tp: 1 }), s0 = g.eco.supply[ME], n0 = g.units.length, k = UNIT_KINDS[kind];
      step(g, [{ t: 'produce', side: ME, kind }]);
      assert.equal(s0 - g.eco.supply[ME] - (g.tick % 20 === 0 ? 1 : 0), k.cost, `produce: kind ${kind} costs ${k.cost}`);
      const at = until(g, () => g.units.length > n0, 400), u = g.units.at(-1), hq = g.blds[g.eco.hq[ME] - 1];
      assert(u.kind === kind && Math.abs(cellOf(u.x) - hq.x) <= 3 && Math.abs(cellOf(u.z) - hq.z) <= 3 && at - 2 === k.buildTicks, `produce: kind ${kind} appears next to the HQ buildTicks + 1 steps after the order (${at})`);
    }
    const w = field(null, false), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16);
    step(w, [move(ME, [tr, inf], 25)]); step(w, []);
    assert(!w.units.some(u => u.ride || u.towBy), 'noflag: without tp a truck and a section moved together stay apart');
  },
  // 驗收 6：存檔
  save() {
    const w = field(), tr = put(w, ME, UK_TRUCK, 2, 16), inf = put(w, ME, UK_INFANTRY, 3, 16), ht = put(w, ME, UK_HALFTRACK, 2, 18), gun = put(w, ME, UK_ATGUN, 3, 18);
    step(w, [move(ME, [tr, inf], 28), move(ME, [ht, gun], 28, 18)]);
    step(w, []); step(w, []);
    assert(inf.ride === tr.id && gun.towBy === ht.id, 'save: a loaded truck and a towing half-track are on the road');
    const text = JSON.stringify(encodeWorld(w)), raw = JSON.parse(text), back = decodeWorld(JSON.parse(text));   // decodeWorld 直接用傳進去的物件：每次重新解析
    assert(back, 'save: the world with tp, a rider and a towed gun reads back');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
    assert.equal(hashWorld(back), hashWorld(w), 'save: 600 steps after loading, the hash equals the uninterrupted run');
    const bad = (why, f) => { const r = JSON.parse(text); f(r); assert.equal(decodeWorld(r), null, `save: refused — ${why}`); };
    bad('tp 3', r => { r.eco.tp = 3; });
    { const r = JSON.parse(text); r.eco.tp = 2; r.eco.queue[0] = [UK_TRUCK];   // R030：帶車、有人坐、有砲被拖、佇列有卡車的 tp 2 存檔
      const w2 = decodeWorld(JSON.parse(JSON.stringify(r))), b2 = w2 && decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w2))));
      assert(b2 && b2.eco.tp === 2 && b2.units.some(u => u.ride) && b2.units.some(u => u.towBy), 'save: a save with tp 2 (R030) reads back, with a rider, a towed gun and a truck queued');
      for (let i = 0; i < 600; i++) { step(w2, []); step(b2, []); }
      assert.equal(hashWorld(b2), hashWorld(w2), 'save: 600 steps after loading a tp 2 save, the hash equals the uninterrupted run'); }
    bad('a truck without tp', r => { delete r.eco.tp; for (const u of r.units) { delete u.ride; delete u.towBy; } });
    bad('a ride link without tp', r => { delete r.eco.tp; r.units = r.units.filter(u => u.kind !== UK_TRUCK && u.kind !== UK_HALFTRACK).map((u, i) => ({ ...u, id: i + 1 })); r.units[0].ride = 1; });
    bad('ride on a kind that cannot ride', r => { const g = r.units.find(u => u.kind === UK_ATGUN); delete g.towBy; g.ride = tr.id; r.units.find(u => u.kind === UK_INFANTRY).ride = undefined; delete r.units.find(u => u.kind === UK_INFANTRY).ride; });
    bad('both ride and towBy', r => { r.units.find(u => u.kind === UK_INFANTRY).towBy = ht.id; });
    bad('a link to a unit that is not a vehicle', r => { r.units.find(u => u.kind === UK_INFANTRY).ride = gun.id; });
    bad('two loads on one vehicle', r => { r.units.find(u => u.kind === UK_ATGUN).towBy = tr.id; });
    bad('a link past the unit list', r => { r.units.find(u => u.kind === UK_INFANTRY).ride = 99; });
    // R030：卡面 R092 第 3 節其餘六種
    bad('a queued truck without tp', r => { delete r.eco.tp; r.units = r.units.filter(u => u.kind !== UK_TRUCK && u.kind !== UK_HALFTRACK).map((u, i) => ({ ...u, id: i + 1 })); for (const u of r.units) { delete u.ride; delete u.towBy; } r.eco.queue[0] = [UK_HALFTRACK]; });
    bad('a link to itself', r => { const i = r.units.find(u => u.kind === UK_INFANTRY); i.ride = i.id; });
    for (const v of [0, -1, 1.5, '1', null]) bad(`a link that is not a positive integer (${JSON.stringify(v)})`, r => { r.units.find(u => u.kind === UK_INFANTRY).ride = v; });
    bad('towBy on a kind that cannot be towed', r => { const i = r.units.find(u => u.kind === UK_INFANTRY); delete i.ride; i.towBy = tr.id; });
    bad('a link to a dead vehicle', r => { const t = r.units.find(u => u.id === tr.id); t.alive = false; t.hp = 0; });
    bad('a link to an enemy vehicle', r => { r.units.find(u => u.id === tr.id).side = FOE; });
    const dead = JSON.parse(text), g = dead.units.find(u => u.kind === UK_ATGUN); g.alive = false; g.hp = 0;
    assert(decodeWorld(dead), 'save: a dead gun still carrying its towBy is accepted');
  },
  // 驗收 8：上車，到了就放下
  board() {
    const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16, { cooldown: 0 });   // R030：冷卻從 0 開始，下車之後的裝填才驗得到
    step(w, [move(ME, [tr, inf], 24)]);
    assert.deepEqual([inf.ride, inf.order, inf.path.length, inf.x, inf.z], [tr.id, ORD_IDLE, 0, tr.x, tr.z], 'board: in the order step the section is aboard, idle, pathless, on the truck');
    let off = -1;
    for (let i = 0; i < 600 && off < 0; i++) { step(w, []); if (inf.ride) assert(inf.x === tr.x && inf.z === tr.z, 'board: aboard, it rides on the truck every step'); else off = w.tick; }
    assert(off > 0 && tr.order === ORD_IDLE && inf.x === tr.x && inf.z === tr.z && inf.order === ORD_IDLE && inf.cooldown === UNIT_KINDS[UK_INFANTRY].reload, `board: when the truck stops the section gets off where it is, idle, reloading (${off}, cooldown ${inf.cooldown})`);
    // 半路只對卡車再下一次移動：留在車上，到新的目的地才下
    const v = field(), t2 = put(v, ME, UK_TRUCK, 4, 16), i2 = put(v, ME, UK_INFANTRY, 5, 16, { cooldown: 0 });
    step(v, [move(ME, [t2, i2], 24)]); until(v, () => cellOf(t2.x) >= 12, 400);
    step(v, [move(ME, [t2], 28)]);
    assert.equal(i2.ride, t2.id, 'board: a new move for the truck alone keeps the section aboard');
    until(v, () => !i2.ride, 600);
    assert(cellOf(i2.x) >= 26, `board: it gets off at the new destination (${cellOf(i2.x)})`);
  },
  // R146 補驗 8：完整鐵絲網上的下車點，仍能從擋路的起點走出去。
  boardWire() {
    const w = field();
    assert.equal(applyBuild(w, { t: 'build', side: ME, kind: BK_WIRE, x: 24, z: 20, rot: 0 }), null, 'boardWire: the fixture legally builds intact wire');
    const wire = wireAt(w, 24, 20), wireHp = wire.hp;
    assert(wireHp > 0 && wireBlocks(w, 24, 20, UK_INFANTRY) && !wireBlocks(w, 24, 20, UK_TRUCK), 'boardWire: intact wire blocks feet but admits the truck');
    const tr = put(w, ME, UK_TRUCK, 4, 20), inf = put(w, ME, UK_INFANTRY, 5, 20);
    step(w, [move(ME, [tr, inf], 28, 20)]);
    assert.equal(inf.ride, tr.id, 'boardWire: the section boards through the real joint move');
    // 車單獨改目的地，避免多選隊形把目的地移到鐵絲網旁邊。
    step(w, [move(ME, [tr], 24, 20)]);
    until(w, () => !inf.ride, 2000);
    assert.deepEqual([tr.order, inf.ride, inf.order, tr.x, tr.z, inf.x, inf.z],
      [ORD_IDLE, undefined, ORD_IDLE, center(24), center(20), center(24), center(20)], 'boardWire: natural arrival drops the section on the intact wire cell');
    assert(inf.cooldown >= UNIT_KINDS[UK_INFANTRY].reload && wire.hp === wireHp, 'boardWire: dismount reloads without destroying the wire');
    step(w, [move(ME, [inf], 22, 20)]);
    assert(inf.order === ORD_MOVE && inf.path.length > 0 && !inf.ride, 'boardWire: the dismounted section accepts its own exit move');
    until(w, () => inf.order === ORD_IDLE, 400);
    assert.deepEqual([inf.x, inf.z, inf.ride], [center(22), center(20), undefined], 'boardWire: the section reaches open ground after dismounting on wire');
    // 對照：不是鐵絲網失效。另一個步兵從外面穿過同一段時必須繞路。
    const outside = put(w, ME, UK_INFANTRY, 25, 19);
    step(w, [move(ME, [outside], 25, 21)]);
    for (let i = 0; i < 400 && outside.order !== ORD_IDLE; i++) {
      assert(!wireBlocks(w, cellOf(outside.x), cellOf(outside.z), UK_INFANTRY), 'boardWire: a section starting outside never enters intact wire');
      step(w, []);
    }
    assert.deepEqual([outside.x, outside.z, wire.hp], [center(25), center(21), wireHp], 'boardWire: the outside control arrives around the same undamaged wire');
  },
  // 驗收 9：兩格
  reach() {
    for (const kind of [UK_INFANTRY, UK_ATGUN]) for (const [d, want] of [[512, true], [513, false]]) {   // 寫死：常數改了守衛不跟著改（R030：先驗行為，再驗常數）
      const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), u = put(w, ME, kind, 4, 16); u.x = tr.x - d;
      step(w, [move(ME, [tr, u], 24)]);
      assert.equal(!!(u.ride || u.towBy), want, `reach: kind ${kind} at ${d} ${want ? 'is' : 'is not'} picked up`);
    }
    assert.equal(REACH92, 512, 'reach: two cells');
  },
  // 驗收 10：一台一個、誰能上
  one() {
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), far = put(w, ME, UK_INFANTRY, 4, 17), near = put(w, ME, UK_INFANTRY, 4, 16); far.z = tr.z + 384; near.z = tr.z + 256;
      step(w, [move(ME, [tr, far, near], 24)]); assert.deepEqual([near.ride, far.ride], [tr.id, undefined], 'one: one truck, sections at 1 and 1.5 cells: the nearer boards (even with the higher id)'); }
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), a = put(w, ME, UK_INFANTRY, 4, 15), b = put(w, ME, UK_INFANTRY, 4, 17);
      step(w, [move(ME, [tr, a, b], 24)]); assert.deepEqual([a.ride, b.ride], [tr.id, undefined], 'one: equally far: the lower id boards'); }
    { const w = field(), t1 = put(w, ME, UK_TRUCK, 4, 16), t2 = put(w, ME, UK_TRUCK, 4, 19), a = put(w, ME, UK_INFANTRY, 5, 16), b = put(w, ME, UK_INFANTRY, 5, 19);
      step(w, [move(ME, [t1, t2, a, b], 24)]); assert.deepEqual([a.ride, b.ride], [t1.id, t2.id], 'one: two trucks, two sections: one each'); }
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), g = put(w, ME, UK_ATGUN, 4, 15), s = put(w, ME, UK_INFANTRY, 4, 17);
      step(w, [move(ME, [tr, g, s], 24)]); assert.deepEqual([g.towBy, s.ride], [tr.id, undefined], 'one: a gun and a section equally near: the lower id hitches, the other walks'); }
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), a = put(w, ME, UK_INFANTRY, 5, 16), b = put(w, ME, UK_INFANTRY, 4, 17);
      step(w, [move(ME, [tr, a], 24)]); step(w, [move(ME, [tr, b], 26)]); assert.deepEqual([a.ride, b.ride], [tr.id, undefined], 'one: a loaded truck moved again with another section does not take a second load'); }
    { const w = field(), t1 = put(w, ME, UK_TRUCK, 4, 16), g = put(w, ME, UK_ATGUN, 4, 16), t2 = put(w, ME, UK_TRUCK, 5, 16);   // R030：拖著的砲跟它的車一起再動，旁邊的空車不搶（tp 1 照舊）
      step(w, [move(ME, [t1, g], 24)]); step(w, []); step(w, [move(ME, [t1, g, t2], 26)]);
      assert.deepEqual([g.towBy, w.units.some(u => u.ride === t2.id || u.towBy === t2.id)], [t1.id, false], 'one: a gun towed by a truck in the same move stays on it; an empty truck beside it does not take it'); }
    const got = { ride: [], tow: [], none: [] };
    for (let kind = 0; kind < UNIT_KINDS.length; kind++) {
      const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), u = put(w, ME, kind, 5, 16);
      step(w, [move(ME, [tr, u], 24)]);
      (u.ride ? got.ride : u.towBy ? got.tow : got.none).push(kind);
    }
    assert.deepEqual([got.ride, got.tow], [[2, 3, 5, 41, 42, 43], [1, 4, 21, 22, 28, 34, 40]], 'one: every kind beside a truck: only riders board and only towable guns hitch');
  },
  // 驗收 11：誰不上車
  refuse() {
    const pinnedW = () => { const w = field({ morale: 2 }), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16); return { w, tr, inf }; };
    { const { w, tr, inf } = pinnedW(); inf.sup = 70; step(w, [move(ME, [tr, inf], 24)]); assert(moraleState(inf) >= MORALE_PINNED && !inf.ride, 'refuse: a pinned section does not board'); }
    { const { w, tr, inf } = pinnedW(); inf.sup = 40; step(w, [move(ME, [tr, inf], 24)]); assert.equal(inf.ride, tr.id, 'refuse: a shaken section boards'); const s = inf.sup; for (let i = 0; i < 40; i++) { step(w, []); assert(!inf.ride || inf.sup <= s, 'refuse: aboard its suppression only decays'); } }
    { const { w, tr, inf } = pinnedW(); tr.sup = 70; step(w, [move(ME, [tr, inf], 24)]); assert(!inf.ride, 'refuse: a pinned truck carries nobody'); }
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16); step(w, [move(ME, [tr, inf], 4)]); assert(!inf.ride, 'refuse: a truck with no path to drive carries nobody'); }
    { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16); step(w, [move(ME, [inf], 24)]); assert(!inf.ride && !tr.path.length, 'refuse: a move without a vehicle boards nobody'); }
  },
  // 驗收 12：快多少（20 格都是路）
  speed() {
    // 回傳 [到的步數, 路的格數]（隊形會讓目的地差一格：照實際的路算）
    const steps = (kind, carrier) => { const w = field(), u = put(w, ME, kind, 4, 16), c = carrier ? put(w, ME, carrier, 4, 16) : null; step(w, [move(ME, c ? [c, u] : [u], 24)]); const m = c ?? u, cells = m.path.length, t0 = w.tick; return [until(w, () => (c ? !(u.ride || u.towBy) && c.order === ORD_IDLE : u.order === ORD_IDLE), 2000) - t0, cells]; };
    const per = s => Math.ceil(256 / s), le = ([t, n], s) => t <= n * per(s) + 2, ge = ([t, n], s) => t >= n * per(s) - 2;   // 下指令那一步已經走了一步
    const ride = steps(UK_INFANTRY, UK_TRUCK), walk = steps(UK_INFANTRY), tow = steps(UK_ATGUN, UK_TRUCK), drag = steps(UK_ATGUN), ht = steps(UK_INFANTRY, UK_HALFTRACK);
    assert(ride[1] >= 20 && le(ride, 30), `speed: a section rides ${ride[1]} road cells in ≤ cells × 9 + 2 steps (${ride[0]})`);
    assert(ge(walk, 12), `speed: on foot it takes ≥ cells × 22 steps (${walk})`);
    assert(le(tow, 30) && ge(drag, 8), `speed: a towed AT gun ≤ cells × 9 + 2, on its own ≥ cells × 32 (${tow} / ${drag})`);
    assert(le(ht, 22), `speed: a half-track carries a section ≤ cells × 12 + 2 steps (${ht})`);
    console.log(`  rides ${ride[0]} steps for ${ride[1]} cells, walks ${walk[0]}; tows ${tow[0]}, gun alone ${drag[0]}; half-track ${ht[0]}`);
  },
  // 驗收 13：車上的人看不見、打不到、不開火、不看、不收指令
  hidden() {
    const scene = (rules, car = UK_TRUCK) => {   // 那一班先放（id 比車小），車的血量 1e6（活得過這條路）；擬真士氣那一輪用半履帶車（卡車會被機槍組壓到釘住、照規則放人）
      const w = field(rules), inf = put(w, ME, UK_INFANTRY, 2, 16, { cooldown: 0 }), tr = put(w, ME, car, 2, 16, { hp: 1e6 });
      const foes = [UK_TANK, UK_INFANTRY, UK_MG, UK_SNIPER, UK_AT91].map((kind, i) => put(w, FOE, kind, 8 + 4 * i, 19, { cooldown: 0, hp: 1e6 }));
      step(w, [move(ME, [tr, inf], 30)]);
      return { w, inf, tr, foes };
    };
    for (const [rules, car, least] of [[null, UK_TRUCK, 100], [{ morale: 2 }, UK_HALFTRACK, 100], [{ morale: 2 }, UK_TRUCK, 1]]) {   // 第三輪：卡車會被機槍組掃到、被釘住就放人；放人之前，掃射區不能壓到車上的人
      const { w, inf } = scene(rules, car), hp = inf.hp, sup = inf.sup ?? 0;
      assert.equal(inf.ride, 2, 'hidden: the section is aboard');
      let rode = 0;
      while (inf.ride && rode < 600) {
        step(w, []); if (!inf.ride) break; rode++;
        assert.equal(inf.hp, hp, 'hidden: aboard it never loses health');
        assert(!w.shells.some(sh => sh.target === inf.id), 'hidden: no shell ever targets it');
        assert(!w.events.some(e => e.e === 'fire' && e.unit === inf.id), 'hidden: it never fires');
        assert((inf.sup ?? 0) <= sup, 'hidden: its suppression never rises');
      }
      assert(rode >= least, `hidden: it rode (${rode} steps)`);
    }
    { const { w, inf, foes } = scene(null), e = foes[1], before = [e.target, e.tx, e.tz];
      step(w, [{ t: 'attack', side: FOE, ids: [e.id], target: inf.id }]);
      assert.deepEqual([e.target, e.tx, e.tz], before, 'hidden: an enemy attack order on the rider is not taken'); }
    { const w = field(), inf = put(w, ME, UK_INFANTRY, 4, 16), tr = put(w, ME, UK_TRUCK, 4, 16, { hp: 1e6 }), e = put(w, FOE, UK_INFANTRY, 8, 18);
      step(w, [{ t: 'attack', side: FOE, ids: [e.id], target: inf.id }]); assert.equal(e.order, ORD_ATTACK, 'hidden: fixture — the enemy section attacks ours on foot');
      step(w, [move(ME, [tr, inf], 28)]); step(w, []);
      assert(inf.ride && e.order !== ORD_ATTACK, 'hidden: once it boards, the enemy gives up the attack'); }
    { const { w, inf, foes } = scene(null), keep = () => [inf.order, inf.path.length, inf.target, inf.tx, inf.tz, inf.holdFire, inf.ride];
      const k0 = keep();
      for (const cmd of [{ t: 'move', side: ME, ids: [inf.id], x: 10, z: 10 }, { t: 'attack', side: ME, ids: [inf.id], target: foes[1].id }, { t: 'stop', side: ME, ids: [inf.id] }, { t: 'fireDiscipline', side: ME, ids: [inf.id], hold: true }]) { step(w, [cmd]); assert.deepEqual(keep(), k0, `hidden: a ${cmd.t} order to the rider is not taken`); } }
    for (const kind of [UK_MG, UK_SNIPER]) { const w = field(), inf = put(w, ME, UK_INFANTRY, 2, 16), ht = put(w, ME, UK_HALFTRACK, 2, 16, { hp: 1e6 }), f = put(w, FOE, kind, 14, 18, { cooldown: 0 });
      step(w, [move(ME, [ht, inf], 30)]); let shots = 0; while (inf.ride) { step(w, []); shots += w.events.filter(e => e.e === 'fire' && e.unit === f.id).length; }
      assert.equal(shots, 0, `hidden: an enemy ${UNIT_KINDS[kind].name} (which skips closed armour) never fires at a half-track's rider`); }
    for (const board of [true, false]) { const w = field(), inf = put(w, ME, UK_INFANTRY, 10, 16), tr = put(w, ME, UK_TRUCK, 10, 16, { hp: 1e6 }), tk = put(w, FOE, UK_TANK, 12, 17, { cooldown: 1e9 });
      w.shells.push({ id: w.nextShell++, side: FOE, kind: SHELL_AP, shooter: tk.id, sx: tk.x, sz: tk.z, ex: inf.x, ez: inf.z, t: 0, T: 2, target: inf.id, hitBld: 0 });
      const hp = inf.hp; step(w, board ? [move(ME, [tr, inf], 20)] : []); for (let i = 0; i < 3; i++) step(w, []);
      assert(board ? inf.hp === hp : inf.hp < hp, `hidden: an AP shell in flight ${board ? 'does nothing once the target boards' : 'hits the section on foot (control)'}`); }
    { const w = field(), inf = put(w, ME, UK_INFANTRY, 10, 16), tr = put(w, ME, UK_TRUCK, 10, 16), mo = put(w, FOE, UK_MORTAR, 14, 16);
      step(w, [move(ME, [tr, inf], 20)]); const hp = inf.hp, th = tr.hp;
      w.shells.push({ id: w.nextShell++, side: FOE, kind: SHELL_HE, shooter: mo.id, sx: mo.x, sz: mo.z, ex: tr.x, ez: tr.z, t: 0, T: 1, target: 0, hitBld: 0 }); step(w, []);
      assert(th - tr.hp > 0 && th - tr.hp <= 30 && inf.hp === hp && inf.ride === tr.id, `hidden: a mortar round on the loaded truck hurts the truck (${th - tr.hp}; it moved a step after the round was aimed) and not the rider`); }
    { const w = field(), ob = put(w, ME, UK_OBSERVER, 10, 16), tr = put(w, ME, UK_TRUCK, 10, 16, { hp: 1e6 }), e = put(w, FOE, UK_INFANTRY, 10, 26);
      const ground = spotted(w, ME, e.x, e.z);
      step(w, [move(ME, [tr, ob], 11)]); assert(ground && ob.ride && !spotted(w, ME, e.x, e.z), 'hidden: an observer aboard sees nothing (on the ground it saw the enemy 10 cells away)'); }
  },
  // 驗收 14：車被打爛
  bail() {
    const shoot = (w, tk, c) => { c.hp = 1; w.shells.push({ id: w.nextShell++, side: FOE, kind: SHELL_AP, shooter: tk.id, sx: tk.x, sz: tk.z, ex: c.x, ez: c.z, t: 0, T: 1, target: c.id, hitBld: 0 }); step(w, []); };
    for (const [kind, want] of [[UK_TRUCK, 30], [UK_HALFTRACK, 15]]) {
      const w = field(), inf = put(w, ME, UK_INFANTRY, 4, 16), c = put(w, ME, kind, 4, 16), tk = put(w, FOE, UK_TANK, 4, 13);
      step(w, [move(ME, [c, inf], 28)]); step(w, []); shoot(w, tk, c);
      assert(!c.alive && !inf.ride && inf.x === c.x && inf.z === c.z && 60 - inf.hp === want, `bail: when the ${UNIT_KINDS[kind].name} is destroyed the rider jumps out at the wreck and loses ${want} (${60 - inf.hp})`);
    }
    { const w = field(), inf = put(w, ME, UK_INFANTRY, 4, 16, { hp: 25 }), c = put(w, ME, UK_TRUCK, 4, 16), tk = put(w, FOE, UK_TANK, 4, 13);
      step(w, [move(ME, [c, inf], 28)]); step(w, []); shoot(w, tk, c);
      assert(!inf.alive && w.events.some(e => e.e === 'kill' && e.unit === inf.id), 'bail: a section with 25 left dies jumping out, with a kill event'); }
    { const w = field(), g = put(w, ME, UK_ATGUN, 4, 16, { cooldown: 0 }), c = put(w, ME, UK_TRUCK, 4, 16), tk = put(w, FOE, UK_TANK, 4, 13);
      step(w, [move(ME, [c, g], 28)]); step(w, []); const hp = g.hp; shoot(w, tk, c);
      assert(!g.towBy && g.hp === hp && g.cooldown === UNIT_KINDS[UK_ATGUN].reload, 'bail: a towed gun is unhitched without the bail damage, and must reload'); }
  },
  // 驗收 15：卡車被釘住就放下（擬真士氣）
  pinned() {
    const w = field({ morale: 2 }), inf = put(w, ME, UK_INFANTRY, 2, 16), tr = put(w, ME, UK_TRUCK, 2, 16);
    step(w, [move(ME, [tr, inf], 28)]); until(w, () => cellOf(tr.x) >= 10, 400);
    tr.sup = 70; step(w, []);
    assert(!inf.ride && tr.path.length > 0 && cellOf(tr.x) < 27, 'pinned: the step the truck is pinned, the section gets off; the truck keeps its path');
    until(w, () => tr.order === ORD_IDLE, 2000);
    assert(cellOf(tr.x) >= 27, `pinned: once it recovers the empty truck drives on to the destination (${cellOf(tr.x)})`);
    const v = field({ morale: 2 }), i2 = put(v, ME, UK_INFANTRY, 2, 16), ht = put(v, ME, UK_HALFTRACK, 2, 16, { hp: 1e6 }), mg = put(v, FOE, UK_MG, 12, 18, { cooldown: 0 });
    step(v, [move(ME, [ht, i2], 28)]); step(v, [{ t: 'attack', side: FOE, ids: [mg.id], target: ht.id }]);
    for (let i = 0; i < 100 && ht.order === ORD_MOVE; i++) { step(v, []); assert(!(ht.sup > 0) && (i2.ride === ht.id || ht.order !== ORD_MOVE), 'pinned: a half-track under machine-gun fire is never suppressed and keeps its rider'); }
  },
  // 驗收 16：拖砲
  tow() {
    const w = field(), g = put(w, ME, UK_ATGUN, 4, 16, { cooldown: 0 }), tr = put(w, ME, UK_TRUCK, 4, 16), tk = put(w, FOE, UK_TANK, 22, 20, { hp: 1e6 });   // 坦克在目的地的射程裡、路上大半段在射程外
    step(w, [move(ME, [tr, g], 24)]);
    let fired = 0, off = -1;
    for (let i = 0; i < 400 && off < 0; i++) { step(w, []); if (g.towBy) { assert(g.x === tr.x && g.z === tr.z, 'tow: the gun is on the truck every step'); fired += w.events.filter(e => e.e === 'fire' && e.unit === g.id).length; } else off = w.tick; }
    assert.equal(fired, 0, 'tow: a towed gun never fires, even with a tank in range');
    assert.equal(g.cooldown, UNIT_KINDS[UK_ATGUN].reload, 'tow: on arrival it unhitches with a full reload (70)');
    const first = until(w, () => w.events.some(e => e.e === 'fire' && e.unit === g.id), 200);
    console.log(`  tow: unhitched at ${off}, first shot at ${first}`);
    assert(first - off >= UNIT_KINDS[UK_ATGUN].reload && first - off <= UNIT_KINDS[UK_ATGUN].reload + 1, `tow: with the tank in range the first shot comes one reload after unhitching (${first - off})`);
    { const v = field(), g2 = put(v, ME, UK_ATGUN, 4, 16), t2 = put(v, ME, UK_TRUCK, 4, 16), e = put(v, FOE, UK_TANK, 8, 18, { cooldown: 0 });
      step(v, [move(ME, [t2, g2], 24)]); step(v, [{ t: 'attack', side: FOE, ids: [e.id], target: g2.id }]); const hp = g2.hp; for (let i = 0; i < 150 && g2.hp === hp && g2.towBy; i++) step(v, []);   // 坦克剛打過卡車，要先裝填一輪
      assert(g2.hp < hp, 'tow: an attack order on a towed gun hits it'); }
  },
  // 驗收 17：解掛
  unhitch() {
    const fresh = () => { const w = field(), g = put(w, ME, UK_ATGUN, 4, 16, { cooldown: 0 }), tr = put(w, ME, UK_TRUCK, 4, 16), e = put(w, FOE, UK_TANK, 10, 20, { hp: 1e6 }); step(w, [move(ME, [tr, g], 28)]); step(w, []); return { w, g, tr, e }; };
    { const { w, g } = fresh(); step(w, [move(ME, [g], 6, 22)]); assert(!g.towBy && g.order === ORD_MOVE && g.path.length > 0, 'unhitch: a move for the gun alone unhitches it onto its own path'); }
    { const { w, g, e } = fresh(); step(w, [{ t: 'attack', side: ME, ids: [g.id], target: e.id }]); assert(!g.towBy && g.target === e.id && g.cooldown >= UNIT_KINDS[UK_ATGUN].reload - 1, 'unhitch: an attack order unhitches it with that target, after a reload'); }
    { const { w, g, tr } = fresh(); step(w, [{ t: 'stop', side: ME, ids: [tr.id] }]); assert(!g.towBy, 'unhitch: stopping the truck drops the gun the same step'); }
    { const { w, g, tr } = fresh(); step(w, [move(ME, [tr, g], 26, 20)]); assert.equal(g.towBy, tr.id, 'unhitch: moving the truck and the gun together again keeps it hitched'); }
    // R030：卡車拖著榴彈砲（最小射程 6 格），選著車和砲下命令。tp＝2：砲不接的攻擊、射擊不卸砲；接了照舊卸；停照舊卸。tp＝1：照 R092 每一門都卸（舊紀錄）
    const howitzer = tp => { const w = field(null, tp), g = put(w, ME, UK_HOWITZER, 4, 16, { cooldown: 0 }), tr = put(w, ME, UK_TRUCK, 4, 16), near = put(w, FOE, UK_INFANTRY, 9, 18, { hp: 1e6, cooldown: 1e9 }), far = put(w, FOE, UK_INFANTRY, 16, 22, { hp: 1e6, cooldown: 1e9 });
      step(w, [move(ME, [tr, g], 28)]); step(w, []); return { w, g, tr, near, far }; };
    const minR = UNIT_KINDS[UK_HOWITZER].minRange;
    { const { w, g, tr, near } = howitzer(2);
      assert(g.towBy === tr.id && dist(g.x, g.z, near.x, near.z) < minR, 'unhitch: fixture — the howitzer is towed and the enemy is inside its minimum range');
      step(w, [{ t: 'attack', side: ME, ids: [tr.id, g.id], target: near.id }]);
      assert.deepEqual([g.towBy, g.order, g.target], [tr.id, ORD_IDLE, 0], 'unhitch: with tp 2 an attack the towed gun refuses (inside its minimum range) leaves it hitched and idle');
      until(w, () => !g.towBy, 600);
      assert(tr.order === ORD_IDLE && g.x === tr.x && g.z === tr.z && cellOf(g.x) >= 26, `unhitch: with tp 2 the gun rides on and is dropped at the destination with the truck (${cellOf(g.x)})`); }
    { const { w, g, tr, near } = howitzer(1);
      step(w, [{ t: 'attack', side: ME, ids: [tr.id, g.id], target: near.id }]);
      assert(!g.towBy && g.order === ORD_IDLE, 'unhitch: with tp 1 (R092 replays) the refused attack still unhitches the gun, as before'); }
    { const { w, g, tr } = howitzer(2), gx = cellOf(g.x), gz = cellOf(g.z);
      step(w, [{ t: 'fireAt', side: ME, ids: [tr.id, g.id], x: gx + 2, z: gz }]);
      assert.deepEqual([g.towBy, g.order], [tr.id, ORD_IDLE], 'unhitch: with tp 2 a fire order on ground inside the minimum range leaves it hitched');
      step(w, [{ t: 'fireAt', side: ME, ids: [tr.id, g.id], x: gx + 8, z: gz + 4 }]);
      assert(!g.towBy && g.order === ORD_FIRE_AT, 'unhitch: with tp 2 a fire order it takes unhitches it'); }
    { const { w, g, tr, far } = howitzer(2);
      step(w, [{ t: 'attack', side: ME, ids: [tr.id, g.id], target: far.id }]);
      assert(!g.towBy && g.order === ORD_ATTACK && g.target === far.id, 'unhitch: with tp 2 an attack it takes unhitches it with that target'); }
    { const { w, g } = howitzer(2);
      step(w, [{ t: 'stop', side: ME, ids: [g.id] }]);
      assert(!g.towBy, 'unhitch: with tp 2 stopping the gun unhitches it'); }
  },
  // 驗收 18：不推
  push() {
    const route = tow => { const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), g = tow ? put(w, ME, UK_ATGUN, 4, 16) : null; step(w, [move(ME, g ? [tr, g] : [tr], 24)]); const xs = []; while (tr.order === ORD_MOVE && xs.length < 600) { step(w, []); xs.push(tr.x * 100000 + tr.z); } return { xs, w, tr, g }; };   // 只比還在開的那一段（到了之後砲卸下、卡車被推開）
    const a = route(false), b = route(true);
    assert.deepEqual(b.xs, a.xs, 'push: a truck towing a gun drives exactly like one that does not, and arrives on the same step');
    const { w, tr, g } = b, sum = UNIT_KINDS[UK_TRUCK].radius + UNIT_KINDS[UK_ATGUN].radius, gx = g.x, gz = g.z;
    let ok = -1; for (let i = 0; i < 30; i++) { if (Math.hypot(tr.x - g.x, tr.z - g.z) >= sum - 1) { ok = i; break; } step(w, []); }
    assert(ok >= 0 && g.x === gx && g.z === gz, `push: after unhitching, the gun stays put and the truck is pushed clear within 30 steps (${ok})`);
  },
  // 驗收 19（取樣）：打車打多少
  damage() {
    const hit = (shooter, kind, hull, shell) => { const w = field(), t = put(w, FOE, kind, 10, 16, { hullX: hull[0], hullZ: hull[1] }), s = put(w, ME, shooter, 7, 16); const hp = t.hp;
      w.shells.push({ id: w.nextShell++, side: ME, kind: shell, shooter: s.id, sx: s.x, sz: s.z, ex: t.x, ez: t.z, t: 0, T: 1, target: shell === SHELL_HE ? 0 : t.id, hitBld: 0 }); step(w, []); return hp - t.hp; };
    const F = [-SUB, 0], S = [0, SUB], B = [SUB, 0];
    assert.deepEqual([hit(UK_INFANTRY, UK_TRUCK, S, SHELL_SMALL), hit(UK_MG, UK_TRUCK, S, SHELL_SMALL), hit(UK_TANK, UK_TRUCK, S, SHELL_AP)], [12, 6, 34], 'damage: a truck takes 12 from a section, 6 from a machine gun, 34 from a tank');
    assert.deepEqual([hit(UK_INFANTRY, UK_HALFTRACK, S, SHELL_SMALL), hit(UK_MG, UK_HALFTRACK, S, SHELL_SMALL)], [1, 0], 'damage: rifles barely scratch a half-track (1), a machine gun does nothing');
    assert.deepEqual([F, S, B].map(h => hit(UK_TANK, UK_HALFTRACK, h, SHELL_AP)), [25, 34, 42], 'damage: a tank hits a half-track for 25 / 34 / 42 (front / side / rear)');
    assert.deepEqual([F, S, B].map(h => hit(UK_AT91, UK_HALFTRACK, h, SHELL_AP)), [45, 60, 70], 'damage: an AT team hits it for 45 / 60 / 75 (from behind it is gone in one: 70)');
    assert.equal(hit(UK_MORTAR, UK_HALFTRACK, S, SHELL_HE), 15, 'damage: a mortar round dead centre takes 15 from a half-track');
    assert.equal(hit(UK_HOWITZER, UK_HALFTRACK, S, SHELL_HE), 70, 'damage: a howitzer round dead centre takes 70 (exactly its health)');
  },
  // R146 補驗 19：原卡十列的每一格。這些只是遊戲內的規則，不是現實裝備的量測。
  damageTable() {
    // 經典表的原始傷害（尚未扣目標剩餘 hp），獨立抄自 R092:471–480。
    const rows = [
      [UK_INFANTRY, SHELL_SMALL, 12, [1, 1, 1]],
      [UK_MG, SHELL_SMALL, 6, [0, 0, 0]],
      [UK_SNIPER, SHELL_SMALL, 10, [1, 1, 1]],
      [UK_TANK, SHELL_AP, 34, [25, 34, 42]],
      [UK_LIGHT, SHELL_AP, 24, [12, 16, 21]],
      [UK_ARMORED_CAR, SHELL_AP, 14, [3, 4, 5]],
      [UK_ATGUN, SHELL_AP, 14, [36, 48, 60]],
      [UK_AT91, SHELL_AP, 15, [45, 60, 75]],
      [UK_MORTAR, SHELL_HE, 30, [15, 15, 15]],
      [UK_HOWITZER, SHELL_HE, 70, [70, 70, 70]],
    ];
    const faces = [[-SUB, 0, 75], [0, SUB, 100], [SUB, 0, 125]];
    let checked = 0;
    for (const real of [false, true]) for (const [shooter, shell, truckDamage, halfDamage] of rows) {
      for (const kind of [UK_TRUCK, UK_HALFTRACK]) for (const face of (kind === UK_TRUCK ? [1] : [0, 1, 2])) {
        const w = field(real ? { ap: 1 } : null), hull = faces[face], k = UNIT_KINDS[shooter], tk = UNIT_KINDS[kind];
        const t = put(w, FOE, kind, 10, 16, { hullX: hull[0], hullZ: hull[1] }), s = put(w, ME, shooter, 7, 16);
        const label = `damageTable: ${real ? 'ap' : 'classic'} kind ${shooter} -> ${kind} face ${face}`;
        // 獨立推遊戲規則：正／側／後面明確放置，不呼叫 armorPct 算答案。
        const faceDamage = shell === SHELL_AP && tk.armored ? Math.floor(k.dmgUnit * hull[2] / 100) : k.dmgUnit;
        const classic = Math.floor(faceDamage * (tk.armored ? k.pierce : k.soft) / 100);
        assert.equal(classic, kind === UK_TRUCK ? truckDamage : halfDamage[face], `${label}: independent formula agrees with the original card cell`);
        let expected = classic, hitRule = -1;
        if (real && shell !== SHELL_HE) {
          if (tk.armored) {
            // 三格、軸向的同一個既有命中夾具；只讀資料表，受測 helper 不當 oracle。
            const [near, far] = PEN_MM[shooter];
            const expectedPen = Math.max(0, Math.floor((near * 900 - (near - far) * 200) / 900));
            assert.equal(penetration(shooter, 3 * SUB), expectedPen, `${label}: independent interpolation matches penetration`);
            hitRule = expectedPen >= [14, 8, 8][face] ? 1 : 0;
            expected = hitRule === 0 ? 0 : shell === SHELL_AP ? k.dmgUnit : classic;
          }
          assert.equal(apHit(shooter, s.x, s.z, t), hitRule, `${label}: independent plate comparison matches apHit`);
        }
        // 經由真正的 step/land 命中；每一發都查傷害，HE 第二發起吃既有彈坑掩護。
        let expectedHp = tk.hp, rounds = 0;
        do {
          const before = t.hp, ground = shell === SHELL_HE && rounds > 0 ? 75 : 100;
          const loss = Math.min(expectedHp, Math.floor(expected * tk.armor * ground / 10000));
          expectedHp -= loss;
          w.shells.push({ id: w.nextShell++, side: ME, kind: shell, shooter: s.id, sx: s.x, sz: s.z, ex: t.x, ez: t.z, t: 0, T: 1, target: shell === SHELL_HE ? 0 : t.id, hitBld: 0 });
          step(w, []); rounds++;
          assert.equal(before - t.hp, loss, `${label}: round ${rounds} actual damage matches the independent expected value`);
          assert.equal(t.alive, expectedHp > 0, `${label}: round ${rounds} survival follows remaining health`);
          if (shell === SHELL_HE) assert(w.crater[cellIdx(w, 10, 16)] > 0, `${label}: impact leaves the crater used by the following round`);
        } while (expected > 0 && expectedHp > 0 && rounds < 100);
        assert(expected === 0 || expectedHp === 0, `${label}: positive damage eventually exhausts health`);
        if (!real && shooter === UK_MORTAR && kind === UK_HALFTRACK) assert.equal(rounds, 6, `${label}: crater cover makes the original table's six rounds`);
        checked++;
      }
    }
    assert.equal(checked, 80, 'damageTable: all ten rows cover truck and three half-track faces under both rule modes');
  },
  // 驗收 20：電腦看不到車上的人，不對他們下指令
  counter() {
    // 第一、二版（ai.ts、ai2.ts 的 seen）：沒有 eco 的空地上，電腦的步兵、坦克照（距離、id）挑步兵班與卡車。那一班 id 比卡車小：
    // 站在地上就挑它；坐在車上（同一點）只會挑卡車
    for (const v of [undefined, 2]) {
      const think = ride => { const w = createWorld(7); w.blds = []; w.occ.fill(0); w.units = []; const inf = put(w, ME, UK_INFANTRY, 10, 16), tr = put(w, ME, UK_TRUCK, 10, 16); if (ride) inf.ride = tr.id; put(w, FOE, UK_INFANTRY, 13, 19); put(w, FOE, UK_TANK, 20, 20);
        setAi(w, FOE, 3, v); const st = w.ai.find(a => a.side === FOE), base = aiThink(w, st, spotted), cmds = v === 2 ? aiThink2(w, st, spotted, base) : base; return cmds.filter(c => c.t === 'attack').map(c => c.target === inf.id ? 'rider' : c.target === tr.id ? 'truck' : 'other'); };
      const foot = think(false), ride = think(true);
      assert(foot.includes('rider') && ride.length && !ride.includes('rider'), `counter: the v${v ?? 1} computer attacks the section on foot but never one riding (${foot} / ${ride})`);
    }
    // 第二、三版（ai2.ts 的 seen）：第三版的迫擊砲看得到對方的機槍組就先打它；機槍組在車上就打不到、也不對它下指令
    const v3 = onFoot => { const w = field(), mg = put(w, ME, UK_MG, 10, 16), tr = put(w, ME, UK_TRUCK, onFoot ? 2 : 10, 16); if (!onFoot) mg.ride = tr.id; put(w, FOE, UK_MORTAR, 18, 16); put(w, FOE, UK_OBSERVER, 13, 16);
      setAi(w, FOE, 3, 3); const st = w.ai.find(a => a.side === FOE), cmds = aiThink2(w, st, spotted, aiThink(w, st, spotted)); return cmds.some(c => c.t === 'attack' && c.target === mg.id); };
    assert.deepEqual([v3(true), v3(false)], [true, false], 'counter: the v3 mortar shells a machine gun on foot but gives no order at all against one riding in a truck');
  },
  // 驗收 21：連線（Node 的鎖步雙端合作）與對稱
  net() {
    const player = (role, send) => { const c = { w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [], given: 0, k: { board: 0, tow: 0, drop: 0, bail: 0 } };
      c.host = { world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase, begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; }, tick: () => { const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = []; const before = links(c.w); step(c.w, now); tally(c.w, before, c.k); c.hashes[c.w.tick] = hashWorld(c.w); }, remake() {}, focus() {} };
      c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); else c.given++; c.pending.push(cmd); };
      c.session = new Session(role, c.host, m => send(c, m), false); return c; };
    const rnd = rngOf(92), wire = []; let now = 0, seq = 0;
    const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + Math.floor(rnd() * 301), seq: seq++, to, m: { ...m, from: from.session.me } }); };
    const a = player('host', send), b = player('join', send);
    a.session.receive({ t: 'welcome', you: 0, room: 'TEST', players: 1 }); b.session.receive({ t: 'welcome', you: 1, room: 'TEST', players: 2 }); a.session.receive({ t: 'joined', who: 1 });
    a.phase = 'battle'; for (const c of [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, tp: 2 }, { t: 'ai', side: FOE, level: 3, v: 3 }]) a.issue(c); a.host.tick();
    const TICKS = 3000, next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(7)], [b, rngOf(11)]]);
    while (Math.min(a.w.tick, b.w.tick) < TICKS && now < TICKS * 400) {
      now += 10; wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
      while (wire.length && wire[0].at <= now) { const x = wire.shift(); x.to.session.receive(x.m); }
      for (const c of [a, b]) {
        if (now < next.get(c) || c.w.tick >= TICKS || !c.session.live() || !c.session.ready(c.w.tick)) continue;
        const r = mine.get(c);
        if (r() < 0.02) c.issue({ t: 'produce', side: ME, kind: [UK_TRUCK, UK_INFANTRY, UK_ATGUN, UK_HALFTRACK][Math.floor(r() * 4)] });
        if (r() < 0.08) { const o = order92(c.w, r); if (o) c.issue(o); }
        c.host.tick(); next.set(c, now + 50);
      }
    }
    assert(a.w.tick >= TICKS && b.w.tick >= TICKS && a.session.ls.desync === -1, `net: both players got through ${TICKS} steps with no desync`);
    const differ = []; for (let t = 1; t <= TICKS; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
    assert.deepEqual(differ.slice(0, 3), [], 'net: after every step both worlds hash the same');
    assert(JSON.stringify(a.log) === JSON.stringify(b.log) && hashWorld(runLog(createWorld(a.w.seed), a.log, TICKS)) === a.hashes[TICKS], 'net: both logs are the same and replay to the same world');
    const k = a.k; console.log(`  net: ${JSON.stringify(k)}`);
    assert(k.board > 0 && k.tow > 0 && k.drop > 0 && k.bail > 0, `net: in lockstep sections boarded, guns were towed, loads were dropped on arrival and riders bailed out (${JSON.stringify(k)})`);
    assert.deepEqual(b.k, a.k, 'net: both players saw the same boardings, tows, drops and bail-outs');
    const s = field(); s.sym = 1; const inf = put(s, FOE, UK_INFANTRY, 20, 16), tr = put(s, FOE, UK_TRUCK, 20, 16), g = put(s, FOE, UK_ATGUN, 20, 19), t2 = put(s, FOE, UK_TRUCK, 20, 19); step(s, [move(FOE, [tr, inf], 4), move(FOE, [t2, g], 4, 19)]);
    assert.deepEqual([inf.ride, g.towBy], [tr.id, t2.id], 'net: side 1 boards and hitches with the same moves in a sym world');
  },
  // R030 驗收 3、5：tp＝1 的局逐位照舊（新規則只看 tp＝2；match92 抽出不改配法）。雜湊在 3645ead 上算好
  replay() {
    const busy = busyGame(1), pre = runLog(createWorld(1944), LOG92, 1000), ids = k => pre.units.filter(u => u.side === ME && u.kind === k).map(u => u.id);
    const lg2 = [...LOG92, { tick: 1000, cmd: { t: 'move', side: 0, ids: [ids(UK_TRUCK)[0], ids(UK_INFANTRY)[0]], x: 20, z: 20 } }, { tick: 1000, cmd: { t: 'move', side: 0, ids: [ids(UK_HALFTRACK)[0], ids(UK_ATGUN)[0]], x: 22, z: 18 } }];
    const log92 = [1060, 1600].map(t => hashWorld(runLog(createWorld(1944), lg2, t)));
    if (process.env.R030_PRINT) { console.log(JSON.stringify({ busy: busy.hs, log92 })); return; }   // 只在基線上用：印出 PIN30
    console.log(`  replay: ${JSON.stringify(busy.k)}`);
    assert(busy.k.board > 0 && busy.k.tow > 0 && busy.k.drop > 0 && busy.k.bail > 0, `replay: the busy tp 1 game boards, tows, drops and bails (${JSON.stringify(busy.k)})`);
    const first = busy.hs.findIndex((h, i) => h !== PIN30.busy[i]);
    assert.equal(first, -1, `replay: a busy tp 1 game (boarding, towing, attacks, fire, stops) hashes every 100 steps exactly as at 3645ead (first difference at step ${(first + 1) * 100})`);
    { const open = tp => { const w = createWorld(9); step(w, [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, ...(tp ? { tp } : {}) }, { t: 'ai', side: ME, level: 3, v: 3 }, { t: 'ai', side: FOE, level: 3, v: 3 }]); return w; };
      const a = open(2), b = open(0);
      for (let i = 0; i < 3000 && a.winner < 0; i++) { step(a, []); step(b, []); if (a.tick % 50 === 0) assert.equal(noTp(a), hashWorld(b), `replay: a computer-only battle with tp 2 is the one without tp (apart from the fold) at step ${a.tick}`); } }
    assert.deepEqual(log92, PIN30.log92, 'replay: the R092 browser log (a truck carrying a section, a half-track towing an AT gun) replays exactly as at 3645ead');
  },
  // 驗收 22：介面（Node）
  ui() {
    const w = field(), ht = put(w, ME, UK_HALFTRACK, 4, 16, { cooldown: 0 });
    assert(!reloadStatus(w, new Set([ht.id])).includes('裝填完成'), 'ui: a selected half-track never shows 裝填完成');
    { const r = field(), f = put(r, FOE, UK_TRUCK, 20, 20); put(r, ME, UK_TRUCK, 4, 4); put(r, ME, UK_HALFTRACK, 6, 4); const st = newStats(r); f.alive = false; f.hp = 0; statsStep(st, r, [{ e: 'kill', unit: f.id }]); const rep = makeReport(r, st);
      assert.deepEqual([rep.start[0][0], rep.start[1][0], rep.left[1][0]], [2, 1, 0], 'ui: trucks and half-tracks count in the tank column (start, left, dead)'); }
    { const s = field(), inf = put(s, ME, UK_INFANTRY, 4, 16), tr = put(s, ME, UK_TRUCK, 5, 16); put(s, ME, UK_TRUCK, 9, 16); const sel = new Set([inf.id]);
      assert.deepEqual(pair92(s, sel), [tr.id], 'ui: 搭車 adds the nearest free vehicle within two cells (only the selection changes)');
      step(s, [move(ME, [tr, inf], 24)]); const t92 = initTransport92(() => ({ world: s, selected: sel, active: true }), () => {}, () => {}, { show: false });
      t92.frame(); assert(!sel.has(inf.id), 'ui: a rider is taken out of the selection'); }
    // R030：審查那一幕。A (9,16)、B (12,16)、T1 (11,16)、T2 (13,16)：模擬照車配，T1 載 B、T2 兩格內沒人。搭車鍵只加 T1
    { const s = field(), A = put(s, ME, UK_INFANTRY, 9, 16), B = put(s, ME, UK_INFANTRY, 12, 16), T1 = put(s, ME, UK_TRUCK, 11, 16); put(s, ME, UK_TRUCK, 13, 16); const sel = new Set([A.id, B.id]);
      const add = pair92(s, sel); step(s, [move(ME, [A, B, ...add.map(id => s.units[id - 1])], 26)]);
      assert.deepEqual([add, B.ride, A.ride], [[T1.id], T1.id, undefined], 'ui: 搭車 pairs the way the move does (truck by truck): only T1 is added and it takes B'); }
    // R030：選了拖著的砲（沒選它的車）和一班步兵。點地面那一步砲先解掛，再照車配；搭車鍵要把這門砲算進去（砲、步兵兩種 id 順序）
    for (const gunFirst of [true, false]) {
      const s = field(), t1 = put(s, ME, UK_TRUCK, 10, 16), first = put(s, ME, gunFirst ? UK_ATGUN : UK_INFANTRY, gunFirst ? 10 : 13, 16), second = put(s, ME, gunFirst ? UK_INFANTRY : UK_ATGUN, gunFirst ? 13 : 10, 16);
      const [G, A] = gunFirst ? [first, second] : [second, first], T2 = put(s, ME, UK_TRUCK, 11, 16), T3 = put(s, ME, UK_TRUCK, 14, 16); G.towBy = t1.id;
      const add = pair92(s, new Set([G.id, A.id])); step(s, [move(ME, [G, A, ...add.map(id => s.units[id - 1])], 26)]);
      assert.deepEqual([add, G.towBy, A.ride], [[T2.id, T3.id], T2.id, T3.id], `ui: a selected gun towed by an unselected truck counts for 搭車: T2 takes the gun, T3 the section (${gunFirst ? 'gun' : 'section'} first)`);
    }
    { const s = field(), inf = put(s, ME, UK_INFANTRY, 4, 16), tr = put(s, ME, UK_TRUCK, 5, 16); step(s, [move(ME, [tr], 20)]);
      assert(tr.order === ORD_MOVE && dist(tr.x, tr.z, inf.x, inf.z) <= REACH92 && pair92(s, new Set([inf.id])).length === 0, 'ui: 搭車 does not add a truck that is already driving'); }
    // R030：隨機 300 幕，搭車鍵加進的車＝點地面之後真的載到人或拖到砲的車，一台不多、一台不少
    { const r = rngOf(3030), kinds = [UK_INFANTRY, UK_MG, UK_MORTAR, UK_ATGUN, UK_HOWITZER, UK_TANK];
      for (let n = 0; n < 300; n++) {
        const s = field(), pick = a => a[Math.floor(r() * a.length)], cell = () => [3 + Math.floor(r() * 6), 14 + Math.floor(r() * 5)];
        const feet = Array.from({ length: 1 + Math.floor(r() * 4) }, () => put(s, ME, pick(kinds), ...cell())), cars = Array.from({ length: 1 + Math.floor(r() * 4) }, () => put(s, ME, pick([UK_TRUCK, UK_HALFTRACK]), ...cell()));
        for (const u of [...feet, ...cars]) { u.x += Math.floor(r() * 200) - 100; u.z += Math.floor(r() * 200) - 100; }
        const g = feet.find(u => tows92(u.kind)); if (g && r() < 0.4) { const t = put(s, ME, UK_TRUCK, cellOf(g.x), cellOf(g.z)); t.x = g.x; t.z = g.z; g.towBy = t.id; }   // 選了砲、沒選拖它的車
        const sel = new Set(feet.map(u => u.id)), add = pair92(s, sel);
        step(s, [move(ME, [...feet, ...add.map(id => s.units[id - 1])], 26)]);
        const loaded = cars.filter(c => s.units.some(u => u.ride === c.id || u.towBy === c.id)).map(c => c.id);
        assert.deepEqual(loaded, add, `ui: in random scene ${n} the vehicles 搭車 adds are exactly the ones that load (${add} / ${loaded}; ${cars.length} vehicles, ${feet.length} on foot)`);
      } }
    { const s = field({ morale: 2 }), inf = put(s, ME, UK_INFANTRY, 4, 16, { sup: 70 }); put(s, ME, UK_TRUCK, 5, 16);
      assert.deepEqual(pair92(s, new Set([inf.id])), [], 'ui: 搭車 adds no truck for a pinned section'); }
    { const s = field({ morale: 2 }), inf = put(s, ME, UK_INFANTRY, 4, 16); put(s, ME, UK_TRUCK, 5, 16, { sup: 70 });
      assert.deepEqual(pair92(s, new Set([inf.id])), [], 'ui: 搭車 adds no pinned truck'); }
    { const s = field(), far = put(s, ME, UK_TRUCK, 6, 16), inf = put(s, ME, UK_INFANTRY, 4, 16), near = put(s, ME, UK_TRUCK, 5, 16), sel = new Set([inf.id]), add = pair92(s, sel);
      step(s, [move(ME, [inf, ...[far, near].filter(c => add.includes(c.id))], 24)]);
      assert.deepEqual([add, inf.ride], [[far.id], far.id], 'ui: with two trucks in reach 搭車 adds the one the move loads (truck by truck, lower id first), not a second one'); }
    { const s = field(), g = put(s, ME, UK_ATGUN, 4, 16), tr = put(s, ME, UK_TRUCK, 5, 16), sel = new Set([g.id, tr.id]); step(s, [move(ME, [tr, g], 24)]);
      initTransport92(() => ({ world: s, selected: sel, active: true }), () => {}, () => {}, { show: false }).frame();
      assert(g.towBy === tr.id && sel.has(g.id), 'ui: a towed gun stays in the selection'); }
    { const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'), left = id => Number(html.match(new RegExp(`#hud #${id} \\{ left: calc\\(max\\(8px, env\\(safe-area-inset-left\\)\\) \\+ (\\d+)px\\); top: calc\\(max\\(8px, env\\(safe-area-inset-top\\)\\) \\+ 58px\\); \\}`))?.[1]);
      const fd = left('fire-discipline'), pl = left('platoon95'), tr = left('transport92');
      assert(pl - fd === 64 && tr - pl >= 64, `ui: the 搭車 bar sits at least 64px right of 全排, as 全排 sits 64px right of 開火 (${fd} / ${pl} / ${tr})`); }
  },
  // 接線（文字檢查；瀏覽器守衛驗真的行為）
  wiring() {
    const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const main = src('src/main.ts'), battle = src('src/render/battle.ts'), cdp = src('tools/cdp.mjs'), mini = src('src/ui/minimap.ts');
    assert(main.includes('tanks: sel.filter(u => UNIT_KINDS[u.kind].armored && !UNIT_KINDS[u.kind].carry).length, trucks: sel.filter(u => UNIT_KINDS[u.kind].carry && !UNIT_KINDS[u.kind].armored).length, halftracks: sel.filter(u => UNIT_KINDS[u.kind].carry && UNIT_KINDS[u.kind].armored).length'), 'wiring: the hint counts a half-track as 半履帶車, never as a tank');
    assert(main.includes('...(V.r092 ? { tp: '), 'wiring: a new battle sends tp only when the R092 valve is on');
    assert(main.includes('...(V.r092 ? { tp: V.r030 ? 2 : 1 } : {}), ...(V.r091 ? { sw: 1 } : {})'), 'wiring: a new battle sends tp 2, and ?noR030=1 sends tp 1');
    assert(main.includes('...(V.r092 ? transport92Items() : [])') && main.includes('after: () => { platoon95.frame(); transport92.frame(); },'), 'wiring: the 運輸 group follows the valve and the selection is pruned every production-bar update');
    assert(battle.includes('return !u.ride && (u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z));'), 'wiring: riders are not drawn');
    assert(mini.includes('if (u.alive && !u.ride && (u.side === SIDE_PLAYER || visible(u)))'), 'wiring: riders are not on the minimap');
    assert(cdp.includes('const full92 = /(^|&)noR092=/.test(full91) ? full91 :') && cdp.includes('noR092=1`;') && cdp.includes('const url87 = /(^|&)noR087=/.test(full92)'), 'wiring: tools/cdp.mjs opens pages with noR092=1 unless a guard asks for R092');
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK transport92/${name}`);
}
console.log('transport92: all OK');
