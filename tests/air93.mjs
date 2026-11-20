// R093 空中支援與防空：不開瀏覽器的部分（卡面驗收 3、5–24、26、28、29、33、34）。
// 用法：node tests/air93.mjs            全部各群
//       node tests/air93.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/air93-negative.mjs）
// 黃金雜湊與十二局在 tests/air93-pinned.mjs；電腦一行都不多下在 tests/air93-quiet.mjs；真 Chrome 在 tests/air93-browser.mjs、tests/air93-budget-browser.mjs。
// 群名不重複，也不叫 pinned、golden、replay（R030 的教訓：物件裡同名的群會互相蓋掉）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, UK_AA, UK_TANK, UK_HEAVY, UK_INFANTRY, UK_ATGUN, UK_MG, UK_HOWITZER, UK_TRUCK, UK_OBSERVER, BK_HOUSE, SHELL_HE,
  SIDE_PLAYER as ME, SIDE_ENEMY as FOE } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { PRODUCIBLE } from '../src/sim/eco.ts';
import { PEN_MM, ARMOR_MM } from '../src/sim/ballistics.ts';
import { rides92, tows92 } from '../src/sim/transport92.ts';
import { fireDisciplineEligible } from '../src/sim/fireDiscipline.ts';
import { STRIKE93, RECON93, DELAY93, SPEED93, HOLD93, HP93, COST93, COOL93, MIN_T93, RECON_R93, MISS93, SMOKE_MISS93, AA_DMG93, BOMB93, place93 } from '../src/sim/air93.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';
import { newStats, makeReport } from '../src/ui/report.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { air93Arm, air93Armed, alert93, why93 } from '../src/ui/air93.ts';
import { Session } from '../src/net/session.ts';
import { ECO } from '../tools/duel.mjs';

const N = 32, AIR = { t: 'eco', air: 1 };
// 一片空地（32×32）：只送 air，開局在兩角放指揮部（第 0 方 (30,30)、第 1 方 (0,0)），沒有單位。rules 要在 eco 之前套
function field(rules, eco = AIR) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  if (rules) applyRules(w, rules);
  step(w, eco ? [eco] : []);
  if (w.eco) w.eco.supply = [500, 500];
  return w;
}
function put(w, side, kind, cx, cz, extra = {}) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}), ...extra };
  w.units.push(u);
  return u;
}
const call = (w, side, kind, x, z) => step(w, [{ t: 'air', side, kind, x, z }]);
const plane = (w, side, kind) => w.sky?.planes.find(p => p.side === side && p.kind === kind);
const noAir = w => { const a = w.eco?.air; if (a) delete w.eco.air; const h = hashWorld(w); if (a) w.eco.air = a; return h; };
function isqrt(n) { let x = Math.floor(Math.sqrt(n)); while (x * x > n) x--; while ((x + 1) * (x + 1) <= n) x++; return x; }
const until = (w, cond, limit = 3000) => { for (let i = 0; i < limit && !cond(); i++) step(w, []); return w.tick; };
// 卡面「數字」第 46 列（守衛自己抄一份）
const ROW46 = { name: '防空砲', hp: 45, speed: 7, range: 0, minRange: 0, reload: 10, indirect: false, dmgUnit: 0, dmgBld: 0, splash: 0, sight: 7 * SUB, armor: 100, radius: 64, cost: 35, buildTicks: 260, garrison: false, armored: false, pierce: 100, men: 0, soft: 100, setup: true, aa: 8 * SUB };
// 一門防空砲、一架飛機的最小夾具：飛機直接放進 w.sky
const sky = (w, planes) => { w.sky = { version: 1, next: planes.length + 1, ready: [0, 0, 0, 0], planes: planes.map((p, i) => ({ id: i + 1, side: FOE, kind: STRIKE93, sx: 0, sz: 0, tx: 0, tz: 0, t: 0, T: 100, hp: HP93[p.kind ?? STRIKE93], ...p })) }; return w.sky.planes; };

const groups = {
  // 驗收 3、6、9：旗標、雜湊、指令檢查
  flag() {
    const opened = eco => { const w = createWorld(5); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, ...eco }]); return w; };
    const plain = opened({}), on = opened({ air: 1 }), bad = [opened({ air: 2 }), opened({ air: '1' }), opened({ air: 1.5 })];
    assert.deepEqual([plain.eco.air, on.eco.air, ...bad.map(w => w.eco.air)], [undefined, 1, undefined, undefined, undefined], 'flag: air is stored only when the eco command sends 1');
    assert.notEqual(hashWorld(on), hashWorld(plain), 'flag: air is folded into the hash');
    assert.equal(noAir(on), hashWorld(plain), 'flag: a new battle with air opens exactly like one without it (apart from the air fold)');
    { const a = opened({ air: 1 }), b = opened({ air: 1 }); b.eco.air = 2; assert.notEqual(hashWorld(a), hashWorld(b), 'flag: the fold carries the value, not just the presence'); }
    { const w = opened({}); step(w, [{ ...ECO, air: 1 }]); assert.equal(w.eco.air, undefined, 'flag: an eco command after step 1 does not switch air on'); }
    for (const v of ['x', 1.5, '1']) assert.equal(isCommand({ ...ECO, air: v }), false, `flag: the command check refuses air ${JSON.stringify(v)}`);
    assert.equal(isCommand({ ...ECO, air: 1 }), true, 'flag: the command check takes air 1');
    // 驗收 9：w.sky 裡的每一個整數都進雜湊
    const base = field(); put(base, ME, UK_INFANTRY, 16, 16); call(base, ME, RECON93, 16, 16);
    const h0 = hashWorld(base), text = JSON.stringify(encodeWorld(base));
    const tweak = f => { const w = decodeWorld(JSON.parse(text)); f(w.sky); return hashWorld(w); };
    for (const [what, f] of [['version', s => { s.version = 2; }], ['next', s => { s.next++; }], ...[0, 1, 2, 3].map(i => [`ready ${i}`, s => { s.ready[i]++; }]), ...['id', 'side', 'kind', 'x', 'z', 'sx', 'sz', 'tx', 'tz', 't', 'T', 'hp'].map(k => [`plane ${k}`, s => { s.planes[0][k]++; }])])
      assert.notEqual(tweak(f), h0, `flag: changing sky ${what} changes the hash`);
    // 驗收 3：沒有 air
    { const w = field(null, { t: 'eco' }), s0 = w.eco.supply[ME]; step(w, [{ t: 'produce', side: ME, kind: UK_AA }]);
      assert.deepEqual([w.eco.queue[ME].length, w.eco.supply[ME], productionBlockReason(w, UK_AA)], [0, s0, '本局未開放此單位'], 'flag: without air kind 46 cannot be produced');
      put(w, ME, UK_OBSERVER, 16, 12); const c = structuredClone(w); for (const kind of [1, 2]) call(w, ME, kind, 16, 16); step(c, []); step(c, []);
      assert(!w.sky && hashWorld(w) === hashWorld(c), 'flag: without air the air commands do nothing'); }
  },
  // 驗收 7：兵種表
  table() {
    assert.deepEqual(UNIT_KINDS[UK_AA], ROW46, 'table: kind 46 matches the card');
    assert(PRODUCIBLE.includes(UK_AA) && PEN_MM[UK_AA] === undefined && ARMOR_MM[UK_AA] === undefined, 'table: producible, not in the penetration or armour tables');
    assert.deepEqual([tows92(UK_AA), rides92(UK_AA)], [true, false], 'table: a truck or half-track can tow it; it does not ride');
    const w = field(), g = put(w, ME, UK_AA, 10, 10), e = put(w, FOE, UK_TANK, 12, 10);
    assert.equal(fireDisciplineEligible(g, w), false, 'table: no fire discipline (range 0)');
    const keep = () => [g.order, g.target, g.tx, g.tz, g.holdFire];
    const k0 = keep();
    for (const c of [{ t: 'attack', side: ME, ids: [g.id], target: e.id }, { t: 'fireAt', side: ME, ids: [g.id], x: 14, z: 10 }, { t: 'fireDiscipline', side: ME, ids: [g.id], hold: true }]) { step(w, [c]); assert.deepEqual(keep(), k0, `table: a ${c.t} order to an AA gun changes nothing`); }
    const src = readFileSync(new URL('../src/sim/world.ts', import.meta.url), 'utf8'), row = src.split('\n').find(l => l.includes("name: '防空砲'"));
    assert(row && !row.includes('buildTicks: 180, garrison: false,') && !row.includes('soft: 100, setup: true, sup: 30') && !row.includes('soft: 100, setup: true, team91: 1'), 'table: the kind 46 row carries none of the three anchor strings');
  },
  // 驗收 8：指令
  command() {
    assert.equal(isCommand({ t: 'air', side: 0, kind: 1, x: 3, z: 4 }), true, 'command: the command check takes an integer air command');
    for (const c of [{ t: 'air', kind: 1, x: 3, z: 4 }, { t: 'air', side: 2, kind: 1, x: 3, z: 4 }, { t: 'air', side: 0, kind: 1, x: 1.5, z: 4 }, { t: 'air', side: 0, kind: 'a', x: 3, z: 4 }])
      assert.equal(isCommand(c), false, `command: the command check refuses ${JSON.stringify(c)}`);
    { const w = field(); w.sandbox = { version: 1, running: true, frame: 0 }; const h = hashWorld(w); step(w, [{ t: 'air', side: ME, kind: RECON93, x: 5, z: 5 }]); assert(!w.sky, `command: inside the sandbox an air command does nothing (${h})`); }
    { const w = field(); w.zombies = { version: 1, wave: 0, next: 0, pending: 0, spawned: 0, killed: 0, lost: 0 }; step(w, [{ t: 'air', side: FOE, kind: RECON93, x: 5, z: 5 }]); assert(!w.sky, 'command: zombie defence drops the enemy side air command'); }
  },
  // 驗收 12–14：呼叫的門、價錢、冷卻、一次一架、不准偷看
  call() {
    const ready = (w, before) => assert.equal(hashWorld(w), before, 'call: a refused call leaves the world bit for bit');
    const tryRefused = (why, setup, kind = RECON93, x = 16, z = 16) => { const w = field(); put(w, ME, UK_INFANTRY, x, z); setup(w); const c = structuredClone(w); call(w, ME, kind, x, z); step(c, []); assert.equal(hashWorld(w), hashWorld(c), `call: refused — ${why}`); };
    tryRefused('no air', w => { delete w.eco.air; });
    tryRefused('zombie defence', w => { w.zombies = { version: 1, wave: 0, next: 1e9, pending: 0, spawned: 0, killed: 0, lost: 0 }; });
    tryRefused('after the battle is decided', w => { w.winner = FOE; });
    tryRefused('the HQ is down', w => { w.blds[w.eco.hq[ME] - 1].hp = 0; });
    tryRefused('supply one short', w => { w.eco.supply[ME] = COST93[RECON93] - 1; });
    tryRefused('kind 3', () => {}, 3);
    { const w = field(); const c = structuredClone(w); step(w, [{ t: 'air', side: 2, kind: 1, x: 3, z: 3 }]); step(c, []); assert.equal(hashWorld(w), hashWorld(c), 'call: refused — side 2'); }
    tryRefused('a strike on a cell nobody sees', w => { w.units = []; }, STRIKE93);
    // 接了：補給、冷卻、一次一架（看目標的是 4 格外的觀測員：不會被自己的炸彈炸死）
    const w = field(); put(w, ME, UK_OBSERVER, 16, 12); const s0 = w.eco.supply[ME], c0 = w.tick;
    call(w, ME, STRIKE93, 16, 16);
    assert.deepEqual([w.eco.supply[ME], w.sky.ready[0]], [s0 - COST93[STRIKE93], c0 + COOL93[STRIKE93]], 'call: a strike costs 60 and cools down for 1,200 steps');
    call(w, ME, STRIKE93, 16, 16); assert.equal(w.sky.planes.length, 1, 'call: one plane of a kind at a time (same step again)');
    until(w, () => !plane(w, ME, STRIKE93));
    const back = w.tick; assert(back < c0 + COOL93[STRIKE93], `call: on 32 cells the strike is gone long before the cooldown ends (${back - c0})`);
    while (w.tick < c0 + COOL93[STRIKE93] - 1) step(w, []);
    call(w, ME, STRIKE93, 16, 16); assert(!plane(w, ME, STRIKE93), 'call: refused one step before the cooldown ends (c + 1,199)');
    call(w, ME, STRIKE93, 16, 16); assert(plane(w, ME, STRIKE93), 'call: taken exactly at c + 1,200');
    { const v = field(); call(v, ME, RECON93, 5, 5); v.sky.ready[1] = 0; call(v, ME, RECON93, 6, 6); assert.equal(v.sky.planes.length, 1, 'call: one of a kind at a time, even when the cooldown is over (a long recon trip on Hythe)'); }
    { const v = field(); const r0 = v.tick; call(v, ME, RECON93, 5, 5); call(v, FOE, RECON93, 5, 5);
      assert.deepEqual([v.sky.ready[1], v.sky.ready[3], v.sky.planes.length], [r0 + COOL93[RECON93], r0 + 1 + COOL93[RECON93], 2], 'call: the two sides cool down separately'); }
    { const v = field(); call(v, ME, RECON93, 99, -4); const p = v.sky.planes[0]; assert.deepEqual([p.tx, p.tz], [center(N - 1), center(0)], 'call: x, z are clamped into the map'); }
    // 偵察照到的格就能炸
    { const v = field(); call(v, ME, RECON93, 8, 8); until(v, () => { const p = plane(v, ME, RECON93); return p && p.t > p.T; });
      call(v, ME, STRIKE93, 8, 8); assert(plane(v, ME, STRIKE93), 'call: a cell lit by our own recon can be bombed'); }
  },
  // 驗收 15：時間表（卡面的表，照常數推）
  flight() {
    for (const kind of [STRIKE93, RECON93]) {
      const w = field(); put(w, ME, UK_INFANTRY, 16, 16); const c = w.tick; call(w, ME, kind, 16, 16);
      const p = plane(w, ME, kind), D = DELAY93[kind], H = HOLD93[kind], T = p.T, d = isqrt(2 * (center(16) - center(N - 1)) ** 2);
      assert.equal(T, Math.max(MIN_T93, Math.ceil(d / SPEED93[kind])), `flight: kind ${kind} T = ceil(distance / speed) (${T})`);
      assert.equal(T, kind === STRIKE93 ? 34 : 43, `flight: on 32 cells to (16,16) T is ${kind === STRIKE93 ? 34 : 43}`);
      assert.equal(p.t, 1 - D, 'flight: at the end of the call step t = 1 − delay');
      const at = {};
      for (let i = 0; i < D + 2 * T + H + 5; i++) {
        const q = plane(w, ME, kind); if (!q) { at.gone ??= w.tick - 1; break; }
        const copy = { ...q }; place93(copy); assert.deepEqual([q.x, q.z], [copy.x, copy.z], 'flight: every step the position follows the formula');
        if (q.t === 0) at.enter ??= w.tick - 1; if (q.t === T) at.over ??= w.tick - 1; if (q.t === T + H) at.drop ??= w.tick - 1; if (w.events.some(e => e.e === 'impact' && e.kind === SHELL_HE)) at.boom ??= w.tick - 1;
        step(w, []);
      }
      assert.deepEqual([at.enter - c, at.over - c, at.drop - c, at.gone - c, at.boom === undefined ? -1 : at.boom - c], [D - 1, D + T - 1, D + T + H - 1, D + 2 * T + H - 1, kind === STRIKE93 ? D + T + H - 1 : -1], `flight: kind ${kind} enters, arrives, drops (the bomb lands that same step) and leaves on the card's steps`);
    }
    { const w = field(); const v = center(N - 1); call(w, ME, RECON93, N - 1, N - 1); const p = w.sky.planes[0]; assert.deepEqual([p.T, p.sx, p.tx], [MIN_T93, v, v], 'flight: a target in the own corner: T = 20, no division by zero'); }
  },
  // 驗收 15：鏡像
  mirror() {
    const w = field(); w.sym = 1; put(w, ME, UK_INFANTRY, 16, 16); put(w, FOE, UK_INFANTRY, 15, 15);
    step(w, [{ t: 'air', side: ME, kind: STRIKE93, x: 16, z: 16 }, { t: 'air', side: FOE, kind: STRIKE93, x: 15, z: 15 }]);
    for (let i = 0; i < 260 && w.sky.planes.length; i++) {
      const [a, b] = [plane(w, ME, STRIKE93), plane(w, FOE, STRIKE93)];
      if (a && b) assert.deepEqual([a.x + b.x, a.z + b.z, a.t, a.T], [N * SUB, N * SUB, b.t, b.T], `mirror: x + x' = n × 256 every step (${i})`);
      step(w, []);
    }
  },
  // 驗收 16：炸彈走高爆那一支
  bomb() {
    const drop = (w, x = 16, z = 16) => { put(w, ME, UK_OBSERVER, x, z - 4); call(w, ME, STRIKE93, x, z); const p = plane(w, ME, STRIKE93); while (p.t < p.T + HOLD93[1] - 1) step(w, []); w.events = []; step(w, []); return p; };
    const hit = (kind, dx) => { const w = field(), u = put(w, FOE, kind, 16, 16); u.x += dx; drop(w); return [u.alive, u.hp]; };
    assert.deepEqual([hit(UK_INFANTRY, 204), hit(UK_INFANTRY, 205)], [[false, 0], [true, 1]], 'bomb: a section dies within 204 and keeps 1 at 205');
    assert.deepEqual([hit(UK_TANK, 0)[0], hit(UK_TANK, SUB)[1]], [false, UNIT_KINDS[UK_TANK].hp - 50], 'bomb: a medium tank dies only on a direct hit; one cell away it loses 50');
    assert.deepEqual([hit(UK_ATGUN, 256)[0], hit(UK_ATGUN, 257)[0]], [false, true], 'bomb: an AT gun dies within 256');
    assert.equal(UNIT_KINDS[UK_HEAVY].hp - hit(UK_HEAVY, 0)[1], 70, 'bomb: a heavy tank loses 70 on a direct hit');
    { const w = field(), hq = w.blds[w.eco.hq[FOE] - 1], hp0 = hq.hp; put(w, ME, UK_OBSERVER, 2, 6); call(w, ME, STRIKE93, 1, 1); until(w, () => !plane(w, ME, STRIKE93) || hq.hp < hp0);
      assert.equal(hp0 - hq.hp, BOMB93.dmgBld, 'bomb: an HQ loses 160 (1,200 → 1,040)'); }
    { const w = field(), n0 = w.shells.length, ns = w.nextShell, i = cellIdx(w, 16, 16); drop(w);
      const imp = w.events.filter(e => e.e === 'impact');
      assert(imp.length === 1 && imp[0].kind === SHELL_HE && imp[0].r === undefined && !w.events.some(e => e.e === 'fire') && w.shells.length === n0 && w.nextShell === ns && w.crater[i] === 1, 'bomb: one full HE impact, no fire event, shells and nextShell untouched, one crater'); }
  },
  // 驗收 17：打偏
  miss() {
    const run = (guns, smoke = false) => { const w = field(), u = put(w, FOE, UK_INFANTRY, 16, 16); for (let i = 0; i < guns; i++) put(w, FOE, UK_AA, 16, 16 + i);
      put(w, ME, UK_OBSERVER, 16, 12); call(w, ME, STRIKE93, 16, 16); const p = plane(w, ME, STRIKE93);
      if (smoke) w.smoke = { windX: 0, windZ: 0, clouds: [{ id: 1, side: ME, x: center(16), z: center(16), born: 0, expires: 1e9 }] };
      let shots = 0, at = null, hp = p.hp, uhp = u.hp;
      for (let i = 0; i < 400 && plane(w, ME, STRIKE93); i++) { step(w, []); const im = w.events.find(e => e.e === 'impact' && e.kind === SHELL_HE); if (!at) shots += w.events.filter(e => e.e === 'fire' && w.units[e.unit - 1].kind === UK_AA).length; if (im && !at) { at = [im.x, im.z]; hp = p.hp; uhp = u.hp; } }
      if (!at) hp = p.hp;
      return { shots, at, hp, uhp };
    };
    const a = run(0), b = run(1), c = run(2), d = run(0, true), e = run(1, true);
    assert.deepEqual(a.at, [center(16), center(16)], 'miss: with no AA and no smoke the bomb lands dead centre (4224, 4224)');
    assert.deepEqual([b.shots, b.hp, b.at, b.uhp], [5, HP93[1] - 5 * AA_DMG93, [3953, 3953], UNIT_KINDS[UK_INFANTRY].hp - 25], 'miss: one AA gun: 5 hits before the drop, 25 left, lands at (3953, 3953), the section loses 25');
    assert.deepEqual([c.at, c.hp <= 0], [null, true], 'miss: two AA guns shoot it down before the drop: no impact');
    assert.deepEqual([d.at, e.at], [[3953, 3953], [3953, 3953]], 'miss: smoke on the target throws it 384 too; with one AA gun it is the larger of the two, not the sum');
  },
  // 驗收 18：勝負
  win() {
    for (const end of [false, true]) {
      const w = field(null, { t: 'eco', air: 1, ...(end ? { end: 1 } : {}) }), hq = w.blds[w.eco.hq[FOE] - 1]; hq.hp = 100; put(w, ME, UK_OBSERVER, 2, 6);
      call(w, ME, STRIKE93, 1, 1); const p = plane(w, ME, STRIKE93); while (p.t < p.T + HOLD93[1] - 1) step(w, []);
      step(w, []); assert.deepEqual([hq.hp, w.winner], [0, ME], `win: the bomb that flattens the last HQ decides the battle the same step (${end ? 'R077 end' : 'classic'})`);
    }
  },
  // 驗收 19–20：防空
  aa() {
    const one = (dx, dz, extra = {}, p = {}) => { const w = field(), g = put(w, ME, UK_AA, 10, 10, extra); sky(w, [{ x: g.x + dx, z: g.z + dz, ...p }]); step(w, []); return { w, g, fired: w.events.filter(e => e.e === 'fire' && e.unit === g.id).length }; };
    const r = UNIT_KINDS[UK_AA].aa;
    // 飛機在 air93Step 一開頭先走一步（t++、照公式），所以夾具的 t、T 讓它停在原地：t = T + 1 … 盤旋那一段
    const hover = { t: 101, T: 100 };
    { const w = field(), g = put(w, ME, UK_AA, 10, 10); sky(w, [{ ...hover, tx: g.x + r, tz: g.z, sx: g.x + r, sz: g.z }]); step(w, []); assert.equal(w.events.filter(e => e.e === 'fire').length, 1, 'aa: a plane exactly 2,048 away is engaged'); }
    { const w = field(), g = put(w, ME, UK_AA, 10, 10); sky(w, [{ ...hover, tx: g.x + r, tz: g.z + 1, sx: g.x + r, sz: g.z + 1 }]); step(w, []); assert.equal(w.events.filter(e => e.e === 'fire').length, 0, 'aa: (2,048, 1) is out of reach'); }
    { const w = field(), g = put(w, ME, UK_AA, 10, 10); const ps = sky(w, [{ ...hover, tx: g.x + 600, tz: g.z, sx: g.x + 600, sz: g.z }, { ...hover, tx: g.x + 300, tz: g.z, sx: g.x + 300, sz: g.z }, { ...hover, tx: g.x - 300, tz: g.z, sx: g.x - 300, sz: g.z }]); step(w, []);
      assert.deepEqual(ps.map(p => p.hp), [100, 85, 100], 'aa: it shoots the nearest; equally near, the lower id'); }
    for (const [why, p] of [['its own side', { side: ME }], ['a plane not yet in', { t: -5 }]]) { const w = field(), g = put(w, ME, UK_AA, 10, 10); sky(w, [{ ...hover, tx: g.x, tz: g.z, sx: g.x, sz: g.z, ...p }]); step(w, []); assert.equal(w.events.filter(e => e.e === 'fire').length, 0, `aa: never shoots ${why}`); }
    // 射速：一直在範圍內，每 10 步一發、每發 15
    { const w = field(), g = put(w, ME, UK_AA, 10, 10); sky(w, [{ kind: RECON93, t: 101, T: 100, hp: 1000, tx: g.x, tz: g.z, sx: g.x, sz: g.z }]); const fires = [];
      for (let i = 0; i < 25; i++) { step(w, []); if (w.events.some(e => e.e === 'fire' && e.unit === g.id && e.x === g.x)) fires.push(w.tick - 1); }
      assert.deepEqual(fires.slice(1).map((t, i) => t - fires[i]), [10, 10], 'aa: one shot every 10 steps'); }
    { const w = field(), g = put(w, ME, UK_AA, 10, 10, { cooldown: 10 }); for (let i = 0; i < 100; i++) step(w, []); assert.equal(g.cooldown, 10, 'aa: without w.sky an AA gun never reloads (its cooldown stays)'); }
    for (const why of ['moving', 'towed', 'dead']) {
      const w = field(), g = put(w, ME, UK_AA, 10, 10, why === 'dead' ? { alive: false, hp: 0 } : {}); if (why === 'towed') { put(w, ME, UK_TRUCK, 10, 10); g.towBy = 2; w.eco.tp = 2; }
      sky(w, [{ ...hover, tx: g.x, tz: g.z, sx: g.x, sz: g.z }]); step(w, why === 'moving' ? [{ t: 'move', side: ME, ids: [g.id], x: 16, z: 10 }] : []);
      assert(why !== 'moving' || g.pathIdx < g.path.length, 'aa: fixture — the gun is on the move');
      assert.equal(w.events.filter(e => e.e === 'fire').length, 0, `aa: a ${why} AA gun does not fire`); }
    { const w = field({ morale: 2 }), g = put(w, ME, UK_AA, 10, 10, { sup: 70 }); sky(w, [{ kind: RECON93, t: 101, T: 100, hp: 1000, tx: g.x, tz: g.z, sx: g.x, sz: g.z }]); let n = 0; for (let i = 0; i < 80; i++) { step(w, []); n += w.events.filter(e => e.e === 'fire').length; }
      assert(n >= 1 && n <= 3, `aa: a pinned AA gun reloads slowly (${n} shots in 80 steps, not 8)`); }
    { const w = field(), g = put(w, ME, UK_AA, 10, 10); sky(w, [{ kind: RECON93, t: 101, T: 100, hp: 1000, tx: g.x, tz: g.z, sx: g.x, sz: g.z }]); const r0 = w.rng; let ev = [];
      for (let i = 0; i < 1000; i++) { step(w, []); ev.push(...w.events); }
      assert(w.rng === r0 && ev.every(e => e.e === 'fire' && e.unit === g.id), `aa: 1,000 steps of AA fire draw no random number and only push fire events with the gun's id (${w.rng} vs ${r0})`); }
  },
  // 驗收 21：打下來
  down() {
    const w = field(); put(w, FOE, UK_AA, 16, 16); put(w, FOE, UK_AA, 16, 17); put(w, ME, UK_OBSERVER, 16, 12); const c = w.tick; call(w, ME, STRIKE93, 16, 16);
    let impact = false, gone = -1, kills = 0; for (let i = 0; i < 300 && gone < 0; i++) { step(w, []); if (w.events.some(e => e.e === 'impact')) impact = true; kills += w.events.filter(e => e.e === 'kill').length; if (!plane(w, ME, STRIKE93)) gone = w.tick - 1; }
    assert(!impact && gone > 0, 'down: shot down before the drop: no bomb');
    assert.equal(kills, 0, 'down: shooting a plane down pushes no kill event (kill ids are always units)');
    assert.equal(w.sky.ready[0], Math.max(c + COOL93[1], gone + COOL93[1]), `down: the cooldown restarts from the step it was shot down (${w.sky.ready[0] - c})`);
    assert(w.sky.ready[0] > c + COOL93[1], 'down: so the next strike comes later than if it had come home');
    const v = field(); put(v, FOE, UK_AA, 16, 16); const r0 = v.tick; call(v, ME, RECON93, 16, 16); until(v, () => !plane(v, ME, RECON93));
    const end = v.tick - 1; assert.equal(v.sky.ready[1], end + COOL93[2], `down: a recon plane over one AA gun is shot down; cooldown from then (${v.sky.ready[1] - r0})`);
  },
  // 驗收 22：偵察看得到
  recon() {
    const w = field(), hover = () => { call(w, ME, RECON93, 16, 16); until(w, () => { const p = plane(w, ME, RECON93); return p && p.t > p.T; }); };
    const x0 = center(16), z0 = center(16), base = (x, z) => spotted(w, ME, x, z);
    assert(!base(x0 + RECON_R93, z0), 'recon: fixture — nothing sees that far before the recon');
    hover();
    assert.deepEqual([base(x0 + RECON_R93, z0), base(x0 + RECON_R93 + 1, z0)], [true, false], 'recon: hovering it sees exactly 1,536 out');
    assert.equal(spotted(w, FOE, x0, z0), false, 'recon: the other side sees nothing new');
    w.smoke = { windX: 0, windZ: 0, clouds: [{ id: 1, side: FOE, x: x0, z: z0, born: 0, expires: 1e9 }] }; assert.deepEqual([base(x0, z0), base(x0 + RECON_R93, z0)], [false, true], 'recon: not into smoke (open ground away from the cloud still seen)'); w.smoke = undefined;
    // 房子、小樹林那一格不算；同一個距離的空地算
    const v = field(); v.vegetation.cells[cellIdx(v, 22, 16)] = 2; call(v, ME, RECON93, 16, 16); until(v, () => { const p = plane(v, ME, RECON93); return p && p.t > p.T; });
    assert.deepEqual([spotted(v, ME, center(22), center(16)), spotted(v, ME, center(16), center(22))], [false, true], 'recon: not into a small wood at 1,536 (open ground at the same distance is seen)');
    const h = field(); h.blds.push({ ...structuredClone(h.blds[0]), id: 3, kind: BK_HOUSE, x: 18, z: 16, w: 1, d: 1, hp: 90 }); h.occ[cellIdx(h, 18, 16)] = 3;
    call(h, ME, RECON93, 16, 16); until(h, () => { const p = plane(h, ME, RECON93); return p && p.t > p.T; });
    assert.equal(spotted(h, ME, center(18), center(16)), false, 'recon: not into a standing house');
    const t = field(); call(t, ME, RECON93, 16, 16); const p = plane(t, ME, RECON93); while (p.t < p.T) step(t, []);
    assert.equal(spotted(t, ME, x0, z0), false, 'recon: at t = T it does not see yet'); step(t, []); assert(spotted(t, ME, x0, z0), 'recon: at t = T + 1 it does');
    while (p.t < p.T + HOLD93[2]) step(t, []); assert(spotted(t, ME, x0, z0), 'recon: at t = T + H it still does'); step(t, []); assert.equal(spotted(t, ME, x0, z0), false, 'recon: at t = T + H + 1 it does not');
  },
  // 驗收 23：配砲兵（只有偵察機看得到的目標，榴彈砲待命時也會打）
  spot() {
    const scene = recon => { const w = field(), g = put(w, ME, UK_HOWITZER, 4, 16); put(w, FOE, UK_TANK, 18, 16, { hp: 1e6 }); if (recon) call(w, ME, RECON93, 18, 16);
      let shots = 0; for (let i = 0; i < 400; i++) { step(w, []); shots += w.events.filter(ev => ev.e === 'fire' && ev.unit === g.id).length; } return shots; };
    const [a, b] = [scene(false), scene(true)];
    assert(a === 0 && b > 0, `spot: an idle howitzer shoots a target only the recon sees (${a} → ${b})`);
  },
  // 驗收 10：存檔
  save() {
    const w = field(null, { t: 'eco', air: 1, tp: 2 }); put(w, ME, UK_OBSERVER, 16, 12); put(w, FOE, UK_AA, 16, 16); const towed = put(w, FOE, UK_AA, 3, 3), tr = put(w, FOE, UK_TRUCK, 3, 4);
    step(w, [{ t: 'move', side: FOE, ids: [tr.id, towed.id], x: 30, z: 3 }]);
    call(w, ME, STRIKE93, 16, 16); call(w, ME, RECON93, 20, 20); call(w, FOE, RECON93, 10, 10);
    const p = plane(w, ME, STRIKE93); while (p.t < p.T + 5) step(w, []);
    assert(towed.towBy === tr.id && w.sky.planes.length >= 2, 'save: fixture — a strike diving, recon planes up, one AA gun firing and one being towed');
    const text = JSON.stringify(encodeWorld(w)), back = decodeWorld(JSON.parse(text));
    assert(back, 'save: the world reads back');
    for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
    assert.equal(hashWorld(back), hashWorld(w), 'save: 600 steps after loading, the hash equals the uninterrupted run');
    const bad = (why, f) => { const r = JSON.parse(text); f(r); assert.equal(decodeWorld(r), null, `save: refused — ${why}`); };
    const P = r => r.sky.planes[0];
    bad('air 2', r => { r.eco.air = 2; });
    bad('sky without air', r => { delete r.eco.air; r.units = r.units.filter(u => u.kind !== UK_AA).map((u, i) => ({ ...u, id: i + 1 })); });
    bad('kind 46 without air', r => { delete r.eco.air; delete r.sky; });
    bad('46 queued without air', r => { delete r.eco.air; delete r.sky; r.units = r.units.filter(u => u.kind !== UK_AA).map((u, i) => ({ ...u, id: i + 1 })); for (const u of r.units) delete u.towBy; r.eco.queue[0] = [UK_AA]; });
    bad('sky in zombie defence', r => { r.zombies = { version: 1, wave: 0, next: 0, pending: 0, spawned: 0, killed: 0, lost: 0 }; });
    bad('sky version 2', r => { r.sky.version = 2; });
    bad('next 0', r => { r.sky.next = 0; });
    bad('three ready slots', r => { r.sky.ready.pop(); });
    bad('five planes', r => { while (r.sky.planes.length < 5) r.sky.planes.push({ ...P(r) }); });
    bad('a plane missing a field', r => { delete P(r).hp; });
    bad('x 1.5', r => { P(r).x = 1.5; });
    bad('side 2', r => { P(r).side = 2; });
    bad('kind 3', r => { P(r).kind = 3; });
    bad('duplicate id', r => { r.sky.planes[1].id = P(r).id; });
    bad('id ≥ next', r => { P(r).id = r.sky.next; });
    bad('hp 0', r => { P(r).hp = 0; });
    bad('hp over the cap', r => { P(r).hp = HP93[P(r).kind] + 1; });
    bad('T 19', r => { P(r).T = MIN_T93 - 1; });
    bad('t 2T + H', r => { P(r).t = 2 * P(r).T + HOLD93[P(r).kind]; });
    bad('t below −delay', r => { P(r).t = -DELAY93[P(r).kind] - 1; });
    bad('two of one side and kind', r => { const q = r.sky.planes[1]; q.side = P(r).side; q.kind = P(r).kind; });
    bad('sx off the map', r => { P(r).sx = N * SUB; });
    const dead = JSON.parse(text), g = dead.units.find(u => u.kind === UK_AA); g.alive = false; g.hp = 0;
    assert(decodeWorld(dead), 'save: a dead AA gun is accepted');
  },
  // 驗收 11：接著跑
  clone() {
    const w = field(); put(w, ME, UK_OBSERVER, 16, 12); put(w, FOE, UK_AA, 16, 16); call(w, ME, STRIKE93, 16, 16); call(w, ME, RECON93, 20, 20);
    for (const stop of [100, 190, 200]) { while (w.tick < stop) step(w, []); const c = structuredClone(w), a = structuredClone(w); for (let i = 0; i < 600; i++) { step(a, []); step(c, []); } assert.equal(hashWorld(c), hashWorld(a), `clone: a structured clone at step ${stop} runs bit for bit`); }
  },
  // 驗收 25（Node 那一半）：生產
  produce() {
    const w = field(null, { t: 'eco', air: 1, guns: 1 }), s0 = w.eco.supply[ME], n0 = w.units.length, k = UNIT_KINDS[UK_AA];
    step(w, [{ t: 'produce', side: ME, kind: UK_AA }]);
    assert.equal(s0 - w.eco.supply[ME] - (w.tick % 20 === 0 ? 1 : 0), k.cost, 'produce: an AA gun costs 35');
    const at = until(w, () => w.units.length > n0, 400), u = w.units.at(-1);
    assert(u.kind === UK_AA && at - 2 === k.buildTicks, `produce: it appears buildTicks + 1 steps after the order (${at})`);
    const z = field(null, { t: 'eco', air: 1 }); z.zombies = { version: 1, wave: 0, next: 1e9, pending: 0, spawned: 0, killed: 0, lost: 0 };
    const zs = z.eco.supply[ME]; step(z, [{ t: 'produce', side: ME, kind: UK_AA }]);
    assert.deepEqual([z.eco.queue[ME].length, z.eco.supply[ME] <= zs], [0, true], 'produce: zombie defence cannot produce kind 46 (the sim gate)');
    assert.equal(productionBlockReason(z, UK_AA), '本局未開放此單位', 'produce: zombie defence does not offer kind 46');
  },
  // 驗收 24：電腦只會挨打
  counter() {
    const ai = readFileSync(new URL('../src/sim/ai.ts', import.meta.url), 'utf8'), cmdType = ai.slice(ai.indexOf('AiCmd'), ai.indexOf('AiCmd') + 400);
    assert(!/'air'/.test(cmdType), 'counter: the computer command type has no air');
    const open = () => { const w = createWorld(3); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, air: 1 }, { t: 'ai', side: FOE, level: 3, v: 3 }]); w.eco.supply[ME] = 500; return w; };
    const a = open(), b = open(); let target = null;
    for (let i = 0; i < 3000 && !target; i++) { step(a, []); step(b, []); target = a.units.find(u => u.alive && u.side === FOE && spotted(a, ME, u.x, u.z)); }
    assert(target, 'counter: fixture — the player sees a computer unit');
    {
      call(a, ME, STRIKE93, cellOf(target.x), cellOf(target.z)); step(b, []);
      const p = plane(a, ME, STRIKE93), strip = w => { const s = w.sky; delete w.sky; const sup = w.eco.supply[ME]; w.eco.supply[ME] = 0; const h = hashWorld(w); w.eco.supply[ME] = sup; if (s) w.sky = s; return h; };
      while (p && p.t < p.T + HOLD93[1] - 1) { assert.equal(strip(a), strip(b), 'counter: until the bomb lands the computer plays exactly as without the call'); step(a, []); step(b, []); }
    }
    const v = field(); put(v, FOE, UK_INFANTRY, 2, 2); call(v, ME, RECON93, 16, 16); until(v, () => { const p = plane(v, ME, RECON93); return p && p.t > p.T; });
    assert.equal(spotted(v, FOE, center(16), center(16)), false, 'counter: our recon never makes the enemy see');
  },
  // 驗收 26（Node）：空中鍵的路由
  route() {
    const w = field(); const e = put(w, FOE, UK_TANK, 16, 16); put(w, ME, UK_OBSERVER, 16, 12);
    air93Arm(1); const r = routeBattleOrder(w, [], false, 'he', { unit: e.id, building: null, ground: null });
    assert.deepEqual([r?.commands, air93Armed()], [[{ t: 'air', side: ME, kind: 1, x: 16, z: 16 }], 0], 'route: armed strike + tap on a visible enemy tank sends one air command for its cell, then disarms');
    air93Arm(1); const r2 = routeBattleOrder(w, [], false, 'he', { unit: 0, building: null, ground: { x: 2.5, z: 2.5 } });
    assert.deepEqual([r2, air93Armed()], [null, 1], 'route: a strike on an unseen cell sends nothing and stays armed');
    air93Arm(2); const r3 = routeBattleOrder(w, [], false, 'he', { unit: 0, building: null, ground: { x: 2.5, z: 2.5 } });
    assert.deepEqual(r3?.commands, [{ t: 'air', side: ME, kind: 2, x: 2, z: 2 }], 'route: recon goes to any cell');
    air93Arm(0); assert.equal(routeBattleOrder(w, [], false, 'he', { unit: 0, building: null, ground: { x: 2.5, z: 2.5 } }), null, 'route: not armed, an empty selection sends nothing (as before)');
    assert.equal(why93(w, ME, 1), '', 'route: why93 says a strike can be called');
    w.eco.supply[ME] = 10; assert.equal(why93(w, ME, 1), '缺 50', 'route: why93 names the missing supply');
  },
  // 驗收 29：提醒字
  alert() {
    const w = field(); put(w, ME, UK_OBSERVER, 16, 12); put(w, ME, UK_AA, 16, 16); put(w, ME, UK_AA, 16, 17);
    let snap = null; const texts = []; put(w, FOE, UK_OBSERVER, 16, 20);
    call(w, FOE, STRIKE93, 16, 16);
    for (let i = 0; i < 400; i++) { const r = alert93(snap, w, ME); snap = r.snap; if (r.text) texts.push(r.text); step(w, []); }
    assert.deepEqual(texts, ['敵機來襲', '擊落敵機'], 'alert: an enemy plane coming in, then shot down');
    const v = field(); put(v, FOE, UK_AA, 16, 16); put(v, FOE, UK_AA, 16, 17); put(v, ME, UK_OBSERVER, 16, 12); let s2 = null; const t2 = []; call(v, ME, STRIKE93, 16, 16);
    for (let i = 0; i < 400; i++) { const r = alert93(s2, v, ME); s2 = r.snap; if (r.text) t2.push(r.text); step(v, []); }
    assert.deepEqual(t2, ['我機墜落'], 'alert: our plane shot down');
    const q = field(); let s3 = null; const t3 = []; call(q, ME, RECON93, 5, 5); for (let i = 0; i < 600; i++) { const r = alert93(s3, q, ME); s3 = r.snap; if (r.text) t3.push(r.text); step(q, []); }
    assert.deepEqual(t3, [], 'alert: a plane flying home says nothing');
  },
  // 驗收 28、34：接線（文字檢查）
  wiring() {
    const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const main = src('src/main.ts'), battle = src('src/render/battle.ts'), cdp = src('tools/cdp.mjs'), smoke = src('src/ui/smoke.ts'), html = src('index.html');
    assert(main.includes('...(V.r093 ? { air: 1 } : {}), ...(V.r077 ? { end: 1 } : {})'), 'wiring: a new battle sends air only when the R093 valve is on');
    assert(main.includes('...(V.r092 ? transport92Items() : []), ...(V.r093 ? aa93Items() : [])'), 'wiring: the 防空 group follows the valve');
    assert(main.includes('after: () => { platoon95.frame(); transport92.frame(); },'), 'wiring: the production-bar after hook is untouched');
    assert(main.includes('|| u.kind === UK_MORTAR || !!UNIT_KINDS[u.kind].aa).length,'), 'wiring: the hint counts an AA gun with the guns');
    { const r = field(); put(r, ME, UK_AA, 4, 4); const rep = makeReport(r, newStats(r)); assert.equal(rep.start[ME][1], 1, 'wiring: the report counts an AA gun in the gun column'); }
    assert(cdp.includes('const full93 = /(^|&)noR093=/.test(full92) ? full92 :') && cdp.includes('noR093=1`;'), 'wiring: tools/cdp.mjs opens pages with noR093=1 unless a guard asks for R093');
    const b0 = battle.indexOf('this.puff!.begin()'), p0 = battle.indexOf('this.air93.paint('), f0 = battle.indexOf('if (this.r4) this.updateFx(simT);');
    assert(b0 > 0 && b0 < p0 && p0 < f0, 'wiring: the air view paints after the particle pools begin and before updateFx finishes them');
    assert(battle.includes('= { ...AA93_GUN, ...INTERNATIONAL_GUN_ART,'), 'wiring: the AA gun uses the gun mesh');
    assert(smoke.indexOf('air93Route(w, hit)') > 0 && smoke.indexOf('air93Route(w, hit)') < smoke.indexOf('if (!ids.length) return null;'), 'wiring: the air key routes before the empty-selection check');
    const left = id => Number(html.match(new RegExp(`#hud #${id} \\{ left: calc\\(max\\(8px, env\\(safe-area-inset-left\\)\\) \\+ (\\d+)px\\); top: calc\\(max\\(8px, env\\(safe-area-inset-top\\)\\) \\+ 58px\\); \\}`))?.[1]);
    assert(left('air93') - left('transport92') >= 64, `wiring: the 空中 bar sits 64px right of 搭車 (${left('transport92')} / ${left('air93')})`);
  },
  // 驗收 35：紅線（R093 的三個新檔、index.html 的 #air93 那幾行、生產鍵的說明：不寫型號、國籍、空軍、番號）
  redline() {
    const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const html = src('index.html').split('\n').filter(l => l.includes('#air93')).join('\n');
    const text = [src('src/sim/air93.ts'), src('src/ui/air93.ts'), src('src/render/air93.ts'), html].join('\n');
    const bad = ['Stuka', 'Ju 87', 'Ju87', 'Lysander', 'Bofors', 'Luftwaffe', '德軍', '英軍', '納粹'].filter(word => text.includes(word));
    if (/\bRAF\b/.test(text)) bad.push('RAF');
    assert.deepEqual(bad, [], `redline: no type names, air forces or nationalities in the R093 files (${bad})`);
  },
  // 驗收 33：連線（Node 的鎖步雙端合作）
  net() {
    const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const player = (role, send) => { const c = { w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [] };
      c.host = { world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase, begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; }, tick: () => { const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = []; step(c.w, now); c.hashes[c.w.tick] = hashWorld(c.w); }, remake() {}, focus() {} };
      c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); c.pending.push(cmd); };
      c.session = new Session(role, c.host, m => send(c, m), false); return c; };
    const rnd = rngOf(93), wire = []; let now = 0, seq = 0;
    const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + Math.floor(rnd() * 301), seq: seq++, to, m: { ...m, from: from.session.me } }); };
    const a = player('host', send), b = player('join', send);
    a.session.receive({ t: 'welcome', you: 0, room: 'TEST', players: 1 }); b.session.receive({ t: 'welcome', you: 1, room: 'TEST', players: 2 }); a.session.receive({ t: 'joined', who: 1 });
    a.phase = 'battle'; for (const c of [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, air: 1 }, { t: 'ai', side: FOE, level: 3, v: 3 }]) a.issue(c); a.host.tick();
    const TICKS = 3000, next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(7)], [b, rngOf(11)]]);
    let calls = 0;
    while (Math.min(a.w.tick, b.w.tick) < TICKS && now < TICKS * 400) {
      now += 10; wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
      while (wire.length && wire[0].at <= now) { const x = wire.shift(); x.to.session.receive(x.m); }
      for (const c of [a, b]) {
        if (now < next.get(c) || c.w.tick >= TICKS || !c.session.live() || !c.session.ready(c.w.tick)) continue;
        const r = mine.get(c);
        if (r() < 0.02) c.issue({ t: 'produce', side: ME, kind: r() < 0.5 ? UK_AA : UK_INFANTRY });
        if (r() < 0.03) { c.issue({ t: 'air', side: ME, kind: r() < 0.5 ? STRIKE93 : RECON93, x: Math.floor(r() * N), z: Math.floor(r() * N) }); calls++; }
        c.host.tick(); next.set(c, now + 50);
      }
    }
    assert(a.w.tick >= TICKS && b.w.tick >= TICKS && a.session.ls.desync === -1, `net: both players got through ${TICKS} steps with no desync`);
    const differ = []; for (let t = 1; t <= TICKS; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
    assert.deepEqual(differ.slice(0, 3), [], 'net: after every step both worlds hash the same');
    assert(calls > 0 && a.w.sky && JSON.stringify(a.log) === JSON.stringify(b.log) && hashWorld(runLog(createWorld(a.w.seed), a.log, TICKS)) === a.hashes[TICKS], `net: air commands were given (${calls}), planes flew, and the log replays to the same world`);
  },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(groups);
for (const name of names) {
  assert(groups[name], `unknown group ${name}`);
  groups[name]();
  console.log(`OK air93/${name}`);
}
console.log('air93: all OK');
