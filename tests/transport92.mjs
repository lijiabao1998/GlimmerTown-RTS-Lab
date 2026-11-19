// R092 運輸：卡車（44）、半履帶車（45）。不開瀏覽器的部分，卡面驗收 2–22。
// 用法：node tests/transport92.mjs            全部各群
//       node tests/transport92.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/transport92-negative.mjs）
// 電腦一行都不多下在 tests/transport92-quiet.mjs；真 Chrome 在 tests/transport92-browser.mjs、tests/transport92-budget-browser.mjs；計時在 tools/r092-time.mjs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, SHELL_AP, SHELL_SMALL, SHELL_HE, UK_AT91, SIDE_PLAYER as ME, SIDE_ENEMY as FOE,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_MG, UK_SNIPER, UK_TRUCK, UK_HALFTRACK, MORALE_PINNED, moraleState } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi, aiThink } from '../src/sim/ai.ts';
import { aiThink2 } from '../src/sim/ai2.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { PRODUCIBLE } from '../src/sim/eco.ts';
import { ARMOR_MM, PEN_MM } from '../src/sim/ballistics.ts';
import { rides92, tows92, REACH92 } from '../src/sim/transport92.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { initTransport92, pair92 } from '../src/ui/transport92.ts';
import { Session } from '../src/net/session.ts';
import { ECO } from '../tools/duel.mjs';

// 一片空地（32×32），z＝16 那一列是路；eco 帶 tp（沒有指揮部）
function field(rules, tp = true) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  for (let x = 0; x < w.n; x++) w.ter[cellIdx(w, x, 16)] = 1;
  if (rules) applyRules(w, rules);   // 規則要在 eco 之前套（applyRules 遇到有 eco 的世界不套）
  w.eco = { supply: [0, 0], hq: [0, 0], queue: [[], []], prog: [0, 0], ...(tp ? { tp: 1 } : {}) };
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

const groups = {
  // 驗收 2、5：舊局逐位不變；旗標、雜湊、指令檢查、兵種表
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const now = {}, v3 = [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }];
    for (const map of [0, 1, 2, 3, 5]) for (const real of [false, true]) now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(game(map, 31 + map, {}, real ? { ap: 1, morale: 2 } : null, v3, map === 5 ? 4000 : 3000));
    now['1/v1'] = hashWorld(game(1, 32, {}, null, [{ t: 'ai', side: 0, level: 3 }, { t: 'ai', side: 1, level: 2 }], 3000));
    now['1/v2'] = hashWorld(game(1, 32, {}, null, [{ t: 'ai', side: 0, level: 3, v: 2 }, { t: 'ai', side: 1, level: 2, v: 2 }], 3000));
    assert.deepEqual(now, PINNED, 'flag: twelve battles without tp are bit for bit what they were at ae950ae');
    const opened = extra => { const w = createWorld(5); step(w, [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, ...extra }]); return w; };
    const plain = opened({}), on = opened({ tp: 1 }), two = opened({ tp: 2 });
    assert.deepEqual([plain.eco.tp, on.eco.tp, two.eco.tp], [undefined, 1, undefined], 'flag: tp is stored only when the eco command sends 1');
    assert.notEqual(hashWorld(on), hashWorld(plain), 'flag: tp is folded into the hash');
    assert.equal(noTp(on), hashWorld(plain), 'flag: a new battle with tp opens exactly like one without it (apart from the tp fold)');
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
    bad('tp 2', r => { r.eco.tp = 2; });
    bad('a truck without tp', r => { delete r.eco.tp; for (const u of r.units) { delete u.ride; delete u.towBy; } });
    bad('a ride link without tp', r => { delete r.eco.tp; r.units = r.units.filter(u => u.kind !== UK_TRUCK && u.kind !== UK_HALFTRACK).map((u, i) => ({ ...u, id: i + 1 })); r.units[0].ride = 1; });
    bad('ride on a kind that cannot ride', r => { const g = r.units.find(u => u.kind === UK_ATGUN); delete g.towBy; g.ride = tr.id; r.units.find(u => u.kind === UK_INFANTRY).ride = undefined; delete r.units.find(u => u.kind === UK_INFANTRY).ride; });
    bad('both ride and towBy', r => { r.units.find(u => u.kind === UK_INFANTRY).towBy = ht.id; });
    bad('a link to a unit that is not a vehicle', r => { r.units.find(u => u.kind === UK_INFANTRY).ride = gun.id; });
    bad('two loads on one vehicle', r => { r.units.find(u => u.kind === UK_ATGUN).towBy = tr.id; });
    bad('a link past the unit list', r => { r.units.find(u => u.kind === UK_INFANTRY).ride = 99; });
    const dead = JSON.parse(text), g = dead.units.find(u => u.kind === UK_ATGUN); g.alive = false; g.hp = 0;
    assert(decodeWorld(dead), 'save: a dead gun still carrying its towBy is accepted');
  },
  // 驗收 8：上車，到了就放下
  board() {
    const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), inf = put(w, ME, UK_INFANTRY, 5, 16);
    step(w, [move(ME, [tr, inf], 24)]);
    assert.deepEqual([inf.ride, inf.order, inf.path.length, inf.x, inf.z], [tr.id, ORD_IDLE, 0, tr.x, tr.z], 'board: in the order step the section is aboard, idle, pathless, on the truck');
    let off = -1;
    for (let i = 0; i < 600 && off < 0; i++) { step(w, []); if (inf.ride) assert(inf.x === tr.x && inf.z === tr.z, 'board: aboard, it rides on the truck every step'); else off = w.tick; }
    assert(off > 0 && tr.order === ORD_IDLE && inf.x === tr.x && inf.z === tr.z && inf.order === ORD_IDLE && inf.cooldown >= UNIT_KINDS[UK_INFANTRY].reload, `board: when the truck stops the section gets off where it is, idle, reloading (${off})`);
    // 半路只對卡車再下一次移動：留在車上，到新的目的地才下
    const v = field(), t2 = put(v, ME, UK_TRUCK, 4, 16), i2 = put(v, ME, UK_INFANTRY, 5, 16, { cooldown: 0 });
    step(v, [move(ME, [t2, i2], 24)]); until(v, () => cellOf(t2.x) >= 12, 400);
    step(v, [move(ME, [t2], 28)]);
    assert.equal(i2.ride, t2.id, 'board: a new move for the truck alone keeps the section aboard');
    until(v, () => !i2.ride, 600);
    assert(cellOf(i2.x) >= 26, `board: it gets off at the new destination (${cellOf(i2.x)})`);
  },
  // 驗收 9：兩格
  reach() {
    assert.equal(REACH92, 512, 'reach: two cells');
    for (const kind of [UK_INFANTRY, UK_ATGUN]) for (const [d, want] of [[512, true], [513, false]]) {   // 寫死：常數改了守衛不跟著改
      const w = field(), tr = put(w, ME, UK_TRUCK, 4, 16), u = put(w, ME, kind, 4, 16); u.x = tr.x - d;
      step(w, [move(ME, [tr, u], 24)]);
      assert.equal(!!(u.ride || u.towBy), want, `reach: kind ${kind} at ${d} ${want ? 'is' : 'is not'} picked up`);
    }
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
    const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const player = (role, send) => { const c = { w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [], given: 0 };
      c.host = { world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase, begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; }, tick: () => { const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = []; step(c.w, now); c.hashes[c.w.tick] = hashWorld(c.w); }, remake() {}, focus() {} };
      c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); else c.given++; c.pending.push(cmd); };
      c.session = new Session(role, c.host, m => send(c, m), false); return c; };
    const rnd = rngOf(92), wire = []; let now = 0, seq = 0;
    const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + Math.floor(rnd() * 301), seq: seq++, to, m: { ...m, from: from.session.me } }); };
    const a = player('host', send), b = player('join', send);
    a.session.receive({ t: 'welcome', you: 0, room: 'TEST', players: 1 }); b.session.receive({ t: 'welcome', you: 1, room: 'TEST', players: 2 }); a.session.receive({ t: 'joined', who: 1 });
    a.phase = 'battle'; for (const c of [{ ...NEW_GAME, id: 1 }, { ...NEW_ECO, tp: 1 }, { t: 'ai', side: FOE, level: 3, v: 3 }]) a.issue(c); a.host.tick();
    const TICKS = 3000, next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(7)], [b, rngOf(11)]]);
    let pairs = 0;
    while (Math.min(a.w.tick, b.w.tick) < TICKS && now < TICKS * 400) {
      now += 10; wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
      while (wire.length && wire[0].at <= now) { const x = wire.shift(); x.to.session.receive(x.m); }
      for (const c of [a, b]) {
        if (now < next.get(c) || c.w.tick >= TICKS || !c.session.live() || !c.session.ready(c.w.tick)) continue;
        const r = mine.get(c), own = c.w.units.filter(u => u.alive && u.side === ME), cars = own.filter(u => UNIT_KINDS[u.kind].carry), feet = own.filter(u => !UNIT_KINDS[u.kind].carry && !u.ride);
        if (r() < 0.02) c.issue({ t: 'produce', side: ME, kind: r() < 0.5 ? UK_TRUCK : UK_INFANTRY });
        if (r() < 0.05 && own.length) { const both = cars.length && feet.length && r() < 0.6, ids = both ? [cars[Math.floor(r() * cars.length)].id, feet[Math.floor(r() * feet.length)].id] : [own[Math.floor(r() * own.length)].id]; if (both) pairs++; c.issue({ t: 'move', side: ME, ids, x: Math.floor(r() * 32), z: Math.floor(r() * 32) }); }
        c.host.tick(); next.set(c, now + 50);
      }
    }
    assert(a.w.tick >= TICKS && b.w.tick >= TICKS && a.session.ls.desync === -1, `net: both players got through ${TICKS} steps with no desync`);
    const differ = []; for (let t = 1; t <= TICKS; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
    assert.deepEqual(differ.slice(0, 3), [], 'net: after every step both worlds hash the same');
    assert(pairs > 0 && JSON.stringify(a.log) === JSON.stringify(b.log) && hashWorld(runLog(createWorld(a.w.seed), a.log, TICKS)) === a.hashes[TICKS], `net: moves with vehicles were given (${pairs}), and the log replays to the same world`);
    const s = field(); s.sym = 1; const inf = put(s, FOE, UK_INFANTRY, 20, 16), tr = put(s, FOE, UK_TRUCK, 20, 16); step(s, [move(FOE, [tr, inf], 4)]);
    assert.equal(inf.ride, tr.id, 'net: side 1 boards with the same move in a sym world');
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
  },
  // 接線（文字檢查；瀏覽器守衛驗真的行為）
  wiring() {
    const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const main = src('src/main.ts'), battle = src('src/render/battle.ts'), cdp = src('tools/cdp.mjs'), mini = src('src/ui/minimap.ts');
    assert(main.includes('...(V.r092 ? { tp: 1 } : {}), ...(V.r091 ? { sw: 1 } : {})'), 'wiring: a new battle sends tp only when the R092 valve is on');
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
