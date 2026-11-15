// R080 機槍組：不開瀏覽器的部分。旗標與舊局逐位不變、兵種的數字、要架好才能打、不自己打封閉裝甲、壓制與掃射區、
// 自己被壓、存檔、電腦第三版會用（先壓還沒被釘住的、跟著主力、不追）也會對付（砲兵與直射的車先打它）、舊版電腦不理它。
// 用法：node tests/machine-gun.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/machine-gun.mjs <群組名>   只跑那一群（隔離副本裡用）
// 難度的高下在 tests/machine-gun-duel.mjs；真實 Chrome 在 tests/machine-gun-browser.mjs；對戰的數字用 tools/duel.mjs 量，寫在卡面。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, SIDE_PLAYER, SIDE_ENEMY,
  UK_TANK, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, UK_DESTROYER, UK_MG, moraleState, MORALE_OK, MORALE_SHAKEN, MORALE_PINNED, MORALE_BROKEN } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi } from '../src/sim/ai.ts';
import { machineGuns3, mgTargetFor, MG_FOLLOW, MG_CHASE } from '../src/sim/ai3.ts';
import { suppress } from '../src/sim/morale.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { duel } from '../tools/duel.mjs';

const K = UNIT_KINDS[UK_MG], ME = SIDE_PLAYER, FOE = SIDE_ENEMY;
// 一片空地，上面只放守衛自己擺的東西；version＝士氣規則第幾版（0＝沒開）
function field(version) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (version) applyRules(w, { morale: version });
  return w;
}
// 預設不開火（cooldown 很大）；ready＝一開始就能打
function put(w, side, kind, cx, cz, ready = false) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
// 跑 n 步，回傳這段時間裡 unit 開火的次數
function fires(w, unit, n, cmds = []) {
  let count = 0;
  for (let i = 0; i < n; i++) { step(w, i === 0 ? cmds : []); count += w.events.filter(e => e.e === 'fire' && e.unit === unit.id).length; }
  return count;
}
// 我方一組機槍組在 (6,16)、旁邊一個觀測員替它看；回傳 { w, mg }
function nest(version) {
  const w = field(version), mg = put(w, ME, UK_MG, 6, 16, true);
  put(w, ME, UK_OBSERVER, 8, 16);
  return { w, mg };
}
// 從開打到 target 的士氣第一次到 state：那時是第幾步、shooter 已經開了幾槍
function until(w, shooter, target, state, limit = 400) {
  let shots = 0;
  for (let i = 0; i < limit; i++) {
    step(w, []);
    shots += w.events.filter(e => e.e === 'fire' && e.unit === shooter.id).length;
    if (moraleState(target) >= state) return { tick: w.tick, shots };
  }
  return { tick: -1, shots };
}

const groups = {
  // 旗標：舊局逐位不變、帶了才可以生產、折進雜湊、指令檢查、兵種的數字
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const before = ['e2a8d369', 'b08601ba', 'c69cd5f2', 'b6993d76'], now = [];
    for (const map of [0, 1]) for (const rules of [null, { ap: 1, morale: 2 }]) now.push(duel({ map, seed: 31 + map, ticks: 3000, rules, end: true, a: { level: 3, v: 3 }, b: { level: 2, v: 3 } }).hash);
    assert.deepEqual(now, before, 'flag: third-version battles without the flag are bit for bit what they were before this card');
    assert.deepEqual([UK_MG, UNIT_KINDS.length], [41, 42], 'flag: the machine-gun team is appended as kind 41');
    assert.deepEqual([K.name, K.hp, K.men, K.speed, K.range, K.sight, K.reload, K.dmgUnit, K.dmgBld, K.sup, K.supArea, K.cost, K.buildTicks, K.setup, K.garrison, K.armored, K.pierce],
      ['機槍組', 40, 3, 12, 12 * SUB, 7 * SUB, 12, 6, 1, 30, 384, 30, 180, true, false, false, 10], 'fixture: the numbers on the card are the numbers in src/sim/world.ts');
    const eco = extra => { const w = createWorld(3); step(w, [{ t: 'eco', inf: 1, ...extra }]); return w; };
    const off = eco({}), on = eco({ mg: 1 });
    assert.deepEqual([off.eco.mg, on.eco.mg], [undefined, 1], 'flag: the eco command stores mg only when it carries it');
    { const w = eco({ mg: 1 }); w.units = w.units.filter(u => u.kind !== UK_MG); const v = eco({}); assert.equal(v.units.length, w.units.length, 'fixture: apart from the teams the two worlds hold the same units'); delete w.eco.mg; w.eco.mg = 1; const plain = hashWorld(v); v.eco.mg = 1; assert.notEqual(hashWorld(v), plain, 'flag: the flag is folded into the hash'); }
    const order = w => { w.eco.supply[ME] = 100; step(w, [{ t: 'produce', side: ME, kind: UK_MG }]); return [w.eco.queue[ME].slice(), w.eco.supply[ME]]; };
    assert.deepEqual(order(off)[0], [], 'flag: without the flag a machine-gun team cannot be produced');
    { const [queue, supply] = order(on); assert.deepEqual(queue, [UK_MG], 'flag: with the flag it goes into the queue'); assert(supply <= 100 - K.cost + 1 && supply >= 100 - K.cost, `flag: and it costs ${K.cost} supply (left ${supply})`); }
    assert.deepEqual([isCommand({ t: 'eco', mg: 1 }), isCommand({ t: 'eco', mg: 'yes' })], [true, false], 'flag: the command check takes the number');
  },
  // 開局雙方各一組（跟 R021 的步兵班一樣的給法）
  start() {
    const teams = extra => { const w = createWorld(5); step(w, [{ t: 'map', id: 0, vegetation: 1 }, { t: 'eco', inf: 1, guns: 1, ...extra }]); return [ME, FOE].map(side => w.units.filter(u => u.alive && u.side === side && u.kind === UK_MG).length); };
    assert.deepEqual(teams({}), [0, 0], 'start: without the flag nobody starts with a machine-gun team');
    assert.deepEqual(teams({ mg: 1 }), [1, 1], 'start: each side starts with one machine-gun team');
  },
  // 要停著才能打；射程 12 格
  fire() {
    { const { w, mg } = nest(0); put(w, FOE, UK_INFANTRY, 18, 16); assert(fires(w, mg, 30) >= 2, 'fire: at twelve cells it fires'); }
    { const { w, mg } = nest(0); put(w, FOE, UK_INFANTRY, 19, 16); put(w, ME, UK_OBSERVER, 14, 16); assert.equal(fires(w, mg, 30), 0, 'fire: thirteen cells is out of range'); }
    {
      const { w, mg } = nest(0); put(w, FOE, UK_INFANTRY, 14, 16);
      const moving = fires(w, mg, 20, [{ t: 'move', side: ME, ids: [mg.id], x: 6, z: 22 }]);
      assert(mg.pathIdx < mg.path.length, 'fixture: after twenty steps the team is still on the move');
      assert.equal(moving, 0, 'fire: a team on the move does not fire');
      let n = 0; while (mg.pathIdx < mg.path.length && n++ < 400) step(w, []);
      assert(fires(w, mg, 30) >= 2, 'fire: once it has stopped it fires again');
    }
  },
  // 待命時不自己打封閉車身的裝甲；開頂的照打；玩家硬要它打坦克，照打、零傷害
  armor() {
    { const { w, mg } = nest(0); put(w, FOE, UK_TANK, 14, 16); assert.equal(fires(w, mg, 40), 0, 'armor: left alone it does not fire at a closed armoured vehicle'); }
    {
      const { w, mg } = nest(0), tank = put(w, FOE, UK_TANK, 12, 16), squad = put(w, FOE, UK_INFANTRY, 16, 16);
      step(w, []);
      assert.deepEqual(w.shells.filter(s => s.shooter === mg.id).map(s => s.target), [squad.id], 'armor: with a squad behind the tank it fires at the squad');
      assert.equal(tank.hp, UNIT_KINDS[UK_TANK].hp, 'fixture: the tank is untouched');
    }
    {
      const { w, mg } = nest(0), td = put(w, FOE, UK_DESTROYER, 14, 16);
      assert(UNIT_KINDS[UK_DESTROYER].openTop && UNIT_KINDS[UK_DESTROYER].armored, 'fixture: the tank destroyer is armoured and open-topped');
      assert(fires(w, mg, 40) >= 3, 'armor: an open-topped vehicle is fair game');
      assert(td.hp < UNIT_KINDS[UK_DESTROYER].hp, 'armor: and it is hurt');
    }
    {
      const { w, mg } = nest(0), tank = put(w, FOE, UK_TANK, 14, 16);
      assert(fires(w, mg, 40, [{ t: 'attack', side: ME, ids: [mg.id], target: tank.id }]) >= 3, 'armor: ordered to, it does fire at a tank');
      assert.equal(tank.hp, UNIT_KINDS[UK_TANK].hp, 'armor: and does no damage (a tenth of six, rounded down)');
    }
  },
  // 壓制：空地上的步兵班，10 格外的機槍組——第 1 次點射受壓、第 3 次釘住、第 4 次垮掉並開始往後跑；步槍班到釘住要的時間至少一倍半
  suppress() {
    const run = state => { const { w, mg } = nest(2), squad = put(w, FOE, UK_INFANTRY, 16, 16); return { ...until(w, mg, squad, state), squad }; };
    assert.equal(run(MORALE_SHAKEN).shots, 1, 'suppress: the first burst leaves the squad shaken');
    const pinned = run(MORALE_PINNED), broken = run(MORALE_BROKEN);
    assert.equal(pinned.shots, 3, 'suppress: the third burst pins it');
    assert.equal(broken.shots, 4, 'suppress: the fourth breaks it');
    assert.equal(broken.squad.rout, 1, 'suppress: and under the second morale version the broken squad runs');
    assert.deepEqual([pinned.tick, broken.tick], [27, 39], 'suppress: pinned after 27 steps, broken after 39 (written down from the first run)');
    const w = field(2), rifles = put(w, ME, UK_INFANTRY, 11, 16, true), squad = put(w, FOE, UK_INFANTRY, 16, 16), slow = until(w, rifles, squad, MORALE_PINNED);
    assert(slow.tick > 0 && slow.tick * 2 >= pinned.tick * 3, `suppress: a rifle squad at five cells needs at least half as long again to pin (${slow.tick} against ${pinned.tick} steps)`);
  },
  // 掃射區：目標旁邊一格的敵人各加一半；兩格外的不受影響；開槍那一方自己的人不受影響
  zone() {
    const { w, mg } = nest(2), target = put(w, FOE, UK_INFANTRY, 16, 16), beside = put(w, FOE, UK_INFANTRY, 17, 16), apart = put(w, FOE, UK_INFANTRY, 16, 18), friend = put(w, ME, UK_INFANTRY, 16, 15);
    let landed = false;
    for (let i = 0; i < 12 && !landed; i++) { step(w, i === 0 ? [{ t: 'attack', side: ME, ids: [mg.id], target: target.id }] : []); landed = w.events.some(e => e.e === 'impact'); }
    assert(landed && [29, 30].includes(target.sup), `fixture: the first burst has landed on the target (${target.sup})`);
    assert([14, 15].includes(beside.sup), `zone: a squad one cell from the target takes half (${beside.sup})`);
    assert.equal(apart.sup, undefined, 'zone: two cells away is outside the beaten zone');
    assert.equal(friend.sup, undefined, "zone: the gunners' own side is not suppressed");
  },
  // 士氣規則關著：只扣血，不加壓制
  classic() {
    const { w, mg } = nest(0), target = put(w, FOE, UK_INFANTRY, 16, 16), beside = put(w, FOE, UK_INFANTRY, 17, 16);
    const shots = fires(w, mg, 60);
    assert(shots >= 4 && target.hp < UNIT_KINDS[UK_INFANTRY].hp, 'fixture: the bursts land and hurt');
    assert.deepEqual([target.sup, beside.sup], [undefined, undefined], 'classic: without the morale rule nothing is suppressed');
  },
  // 機槍組自己會被壓：釘住時打得慢；垮了不開火，也不逃跑（不能進駐的單位不潰退）
  self() {
    const rate = sup => { const { w, mg } = nest(2); put(w, FOE, UK_INFANTRY, 16, 16); if (sup) { suppress(w, mg, sup); assert.equal(mg.sup, sup, 'fixture: suppression applied in the open'); } return { n: fires(w, mg, 48), mg }; };
    const calm = rate(0), pinned = rate(89), broken = rate(100);
    assert.equal(calm.n, 4, 'fixture: unsuppressed it fires four bursts in 48 steps');
    assert(pinned.n >= 1 && pinned.n <= 2, `self: pinned, it fires more slowly (${pinned.n} bursts in 48 steps)`);
    { const { w, mg } = nest(2); put(w, FOE, UK_INFANTRY, 16, 16); suppress(w, mg, 100); assert.equal(fires(w, mg, 30), 0, 'self: broken, it does not fire'); assert.deepEqual([mg.rout, mg.order, cellOf(mg.x), cellOf(mg.z)], [undefined, ORD_IDLE, 6, 16], 'self: a broken team stays where it is'); }
    assert(broken.n >= 0, 'fixture');
  },
  // 存檔：eco.mg 與場上的機槍組存得回來，接著跑跟沒中斷一樣
  save() {
    const log = [{ t: 'map', id: 0, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1, mg: 1 }, { t: 'ai', side: FOE, level: 3, v: 3 }, { t: 'ai', side: ME, level: 3, v: 3 }].map(cmd => ({ tick: 0, cmd }));
    const mid = runLog(createWorld(21), log, 700), direct = hashWorld(runLog(createWorld(21), log, 1400));
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(mid))));
    assert.deepEqual([back.eco.mg, back.units.filter(u => u.kind === UK_MG).length], [1, 2], 'save: the flag and both teams come back');
    assert.equal(hashWorld(back), hashWorld(mid), 'save: the restored world hashes the same');
    while (back.tick < 1400) step(back, []);
    assert.equal(hashWorld(back), direct, 'save: and continues like the uninterrupted battle');
  },
  // 電腦會用：先壓還沒被釘住的、只打射程內、不追、跟著主力、在基地跟波次一起等
  use() {
    assert.deepEqual([MG_FOLLOW, MG_CHASE], [3, 0], 'fixture: the numbers on the card are the numbers in src/sim/ai3.ts');
    // 我方（受測）：機槍組在 (10,16)、兩台坦克在 cores；敵方 seen＝直接交給函式（看不看得到由呼叫的人負責）
    const scene = (version, cores = [[9, 15], [9, 17]]) => {
      const w = field(version), mg = put(w, ME, UK_MG, 10, 16);
      for (const [x, z] of cores) put(w, ME, UK_TANK, x, z);
      setAi(w, ME, 3, 3);
      return { w, mg, st: w.ai[0], mine: () => w.units.filter(u => u.alive && u.side === ME), think: (seen, taken = () => false) => machineGuns3(w, w.ai[0], w.units.filter(u => u.alive && u.side === ME), seen, taken) };
    };
    const attack = (mg, t) => [[mg, { t: 'attack', side: ME, ids: [mg.id], target: t.id }]];
    const attacks = out => out.filter(([, c]) => c?.t === 'attack');   // 只看有沒有下攻擊指令（跟不跟主力是另一件事）
    { const s = scene(2), near = put(s.w, FOE, UK_INFANTRY, 14, 16), far = put(s.w, FOE, UK_INFANTRY, 18, 16);
      assert.deepEqual(s.think([near, far]), attack(s.mg, near), 'fixture: with nobody pinned it takes the nearer squad');
      suppress(s.w, near, 70); assert.equal(moraleState(near), MORALE_PINNED, 'fixture: the nearer squad is pinned');
      assert.deepEqual(s.think([near, far]), attack(s.mg, far), 'use: the unpinned squad comes first');
      suppress(s.w, far, 70);
      assert.deepEqual(s.think([near, far]), attack(s.mg, near), 'use: with both pinned it is the nearer again');
      s.mg.order = ORD_ATTACK; s.mg.target = near.id;
      assert.deepEqual(s.think([near, far]), [[s.mg, null]], 'use: already on that target, it gets no new order'); }
    { const s = scene(0), near = put(s.w, FOE, UK_INFANTRY, 14, 16), far = put(s.w, FOE, UK_INFANTRY, 18, 16); near.sup = 70;
      assert.deepEqual(s.think([near, far]), attack(s.mg, near), 'use: without the morale rule suppression is not looked at'); }
    { const s = scene(2), tank = put(s.w, FOE, UK_TANK, 14, 16), td = put(s.w, FOE, UK_DESTROYER, 18, 16);
      assert.deepEqual(attacks(s.think([tank])), [], 'use: a closed armoured vehicle is not a target');
      assert.deepEqual(s.think([tank, td]), attack(s.mg, td), 'use: an open-topped vehicle is'); }
    { const s = scene(2), edge = put(s.w, FOE, UK_INFANTRY, 22, 16), beyond = put(s.w, FOE, UK_INFANTRY, 23, 16);
      assert.deepEqual(attacks(s.think([beyond])), [], 'use: a target beyond range is left alone');
      assert.deepEqual(s.think([edge, beyond]), attack(s.mg, edge), 'fixture: at exactly twelve cells it is taken'); }
    // 沒有目標：跟著主力的重心
    { const s = scene(2, [[20, 15], [20, 17]]);
      assert.deepEqual(s.think([]), [[s.mg, { t: 'move', side: ME, ids: [s.mg.id], x: 20, z: 16 }]], 'use: with nothing to shoot it follows the centre of the armour');
      s.mg.order = ORD_MOVE; s.mg.path = [1, 2, 3]; s.mg.pathIdx = 0;
      assert.deepEqual(s.think([]), [], 'use: already walking, it is not re-ordered');
      assert.deepEqual(s.think([], id => id === s.mg.id), [], 'fixture'); }
    { const s = scene(2, [[12, 16], [13, 17]]);
      assert.deepEqual(s.think([]), [], 'use: within three cells of the armour it stays put'); }
    { const s = scene(2, [[12, 16], [13, 17]]), gone = put(s.w, FOE, UK_INFANTRY, 24, 16);
      s.mg.order = ORD_ATTACK; s.mg.target = gone.id;
      const out = s.think([gone]);
      assert(out.length === 1 && out[0][1]?.t === 'move', 'use: a target that left its range is not chased (it walks back to the armour instead)'); }
    { const s = scene(2), near = put(s.w, FOE, UK_INFANTRY, 14, 16);
      assert.deepEqual(s.think([near], id => id === s.mg.id), [], 'use: a team already spoken for (waiting with the wave) is left alone');
      s.mg.alive = false; assert.deepEqual(s.think([near]), [], 'use: with no team there are no orders'); }
    // 跟波次一起等：有指揮部、第一波還沒出發，湊不滿一波 → 機槍組跟步兵班拿到同一個集結指令（不自己走去找坦克）
    {
      const gather = v => {
        const w = createWorld(7);
        step(w, [{ t: 'map', id: 0, vegetation: 1 }, { t: 'eco', inf: 1, mg: 1 }, { t: 'ai', side: FOE, level: 3, v }]);
        const mine = w.units.filter(u => u.alive && u.side === FOE), mg = mine.find(u => u.kind === UK_MG), tanks = mine.filter(u => u.kind === UK_TANK);
        for (const u of mine) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; u.cooldown = 1e9; }
        for (const u of w.units) if (u.side !== FOE) u.alive = false;   // 沒有敵人：只看集結
        mg.x = center(1); mg.z = center(9); tanks[0].x = center(9); tanks[0].z = center(1);   // 機槍組與坦克分在基地兩頭（離集結點都超過四格）
        w.ai[0].next = w.tick; step(w, []);
        return { mg, tank: tanks[0] };
      };
      const third = gather(3), second = gather(2);
      assert.equal(third.tank.order, ORD_MOVE, 'fixture: a tank far from the rally point is called in');
      assert(third.mg.order === ORD_MOVE && Math.abs(third.mg.tx - third.tank.tx) <= 1 && Math.abs(third.mg.tz - third.tank.tz) <= 1, `use: it gathers with the wave (sent to ${third.mg.tx},${third.mg.tz}; the tank to ${third.tank.tx},${third.tank.tz})`);
      assert.equal(second.mg.order, ORD_IDLE, 'quiet: the second version never commands a machine-gun team');
    }
  },
  // 電腦會對付：直射的車手上不是裝甲目標就改打射程內的機槍組；迫擊砲先打機槍組；看不到的不算
  counter() {
    const w = field(2), tank = put(w, ME, UK_TANK, 10, 16), squad = put(w, FOE, UK_INFANTRY, 14, 16), armor = put(w, FOE, UK_TANK, 15, 16), nearMg = put(w, FOE, UK_MG, 17, 16), farMg = put(w, FOE, UK_MG, 16, 14), outMg = put(w, FOE, UK_MG, 20, 16);
    assert.equal(mgTargetFor(tank, squad, [nearMg, farMg]), farMg, 'counter: a tank shooting at a squad switches to the nearest machine gun in range');
    assert.equal(mgTargetFor(tank, null, [nearMg]), nearMg, 'counter: so does a tank with no target');
    assert.equal(mgTargetFor(tank, armor, [nearMg]), undefined, 'counter: a tank busy with armour keeps its target');
    assert.equal(mgTargetFor(tank, nearMg, [nearMg, farMg]), undefined, 'counter: one already on a machine gun keeps it');
    assert.equal(mgTargetFor(tank, squad, [outMg]), undefined, 'counter: a machine gun beyond its own range is not chased');
    // 整段接起來（沒有指揮部＝不分波次）：我方迫擊砲與坦克、觀測員替它們看；敵方步兵班近、機槍組遠
    const scene = v => {
      const f = field(2), mortar = put(f, ME, UK_MORTAR, 8, 16), tk = put(f, ME, UK_TANK, 10, 18);
      put(f, ME, UK_OBSERVER, 12, 20);
      const sq = put(f, FOE, UK_INFANTRY, 15, 17), gun = put(f, FOE, UK_MG, 18, 18);
      setAi(f, ME, 3, v); step(f, []);
      return { mortar, tk, sq, gun };
    };
    // 迫擊砲自己只看得到 6 格：步兵班在 5 格、機槍組在 11 格（射程 12 格以內）。有觀測員才看得到機槍組
    const lone = spotter => {
      const f = field(2), mortar = put(f, ME, UK_MORTAR, 8, 16), sq = put(f, FOE, UK_INFANTRY, 13, 16), gun = put(f, FOE, UK_MG, 19, 16);
      if (spotter) put(f, ME, UK_OBSERVER, 9, 17);
      setAi(f, ME, 3, 3); step(f, []);
      return { mortar, sq, gun };
    };
    const third = scene(3), second = scene(2), seen = lone(true), blind = lone(false);
    assert.deepEqual([second.mortar.order, second.mortar.target, second.tk.order, second.tk.target], [ORD_ATTACK, second.sq.id, ORD_ATTACK, second.sq.id], 'fixture: the second version has both on the nearer squad');
    assert.deepEqual([third.mortar.order, third.mortar.target], [ORD_ATTACK, third.gun.id], 'counter: the mortar shells the machine gun first');
    assert.deepEqual([third.tk.order, third.tk.target], [ORD_ATTACK, third.gun.id], 'counter: the tank turns its gun on the machine gun');
    assert.deepEqual([seen.mortar.order, seen.mortar.target], [ORD_ATTACK, seen.gun.id], 'fixture: with an observer the far machine gun is seen and shelled');
    assert.deepEqual([blind.mortar.order, blind.mortar.target], [ORD_ATTACK, blind.sq.id], 'counter: an unseen machine gun is not acted on');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`machine-gun/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK machine-gun/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts');
  assert.match(read('../src/valves.ts'), /get r080\(\) \{ return on\('080'\); \}/, 'valve: r080 is on the table');
  assert.match(main, /\.\.\.\(V\.r080 \? \{ mg: 1 \} : \{\}\) \}\);/, 'wiring: a new battle carries mg behind the valve');
  assert.match(main, /\.\.\.\(V\.r080 \? \[\{ kind: UK_MG, label: '機槍組', cost: UNIT_KINDS\[UK_MG\]\.cost \}\] : \[\]\)/, 'wiring: the production bar offers the team behind the valve');
  assert.match(read('../README.md'), /\?noR080=1/, 'readme: the valve is documented');
  console.log('OK machine-gun/files');
}

// ---- 畫面（不在隔離副本裡跑：要 three）：三個組員、少一個人少畫一個；迫擊砲的兩個砲手照舊；一組機槍組用一個砲的實例 ----
{
  const { BattleView } = await import('../src/render/battle.ts');
  const FLAGS = { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true };
  const drawn = (kind, hp) => {
    const w = field(0), u = put(w, ME, kind, 16, 16);
    if (hp !== undefined) u.hp = hp;
    if (hp === 0) u.alive = false;
    const v = new BattleView(w, FLAGS);
    v.update(0, 1, new Set());
    return [v.menDbg.crew, v.men.count, v.gun.count];
  };
  assert.deepEqual([drawn(UK_MG), drawn(UK_MG, 27), drawn(UK_MG, 26), drawn(UK_MG, 13), drawn(UK_MG, 0)], [[3, 3, 1], [3, 3, 1], [2, 2, 1], [1, 1, 1], [0, 0, 1]], 'draw: three gunners at full strength, one fewer for each third lost, and the gun stays where the team died');
  assert.deepEqual([drawn(UK_MORTAR), drawn(UK_MORTAR, 20)], [[2, 2, 1], [1, 1, 1]], 'draw: the mortar crew is drawn as before (two, one below half)');
  console.log('OK machine-gun/draw');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r080-negative-'));
const ZONE = 'if (w.rules?.morale && k.sup && k.supArea && s.kind === SHELL_SMALL) suppressZone(';
const mutants = [
  ['gate_removed', 'flag', 'eco.ts', ' || (kind === UK_MG && !e.mg)) return;', ') return;', 'flag: without the flag a machine-gun team cannot be produced'],
  ['flag_not_hashed', 'flag', 'world.ts', ' if (e.mg) f.int(0x4d47).int(e.mg);', '', 'flag: the flag is folded into the hash'],
  ['no_starting_team', 'start', 'eco.ts', 'if (mg) for (const side of [SIDE_PLAYER, SIDE_ENEMY]) { const b = hqAlive(w, side); if (b) spawnUnit(w, side, UK_MG, b); }', '', 'start: each side starts with one machine-gun team'],
  ['fires_on_the_move', 'fire', 'world.ts', 'soft: 100, setup: true, sup: 30', 'soft: 100, setup: false, sup: 30', 'fire: a team on the move does not fire'],
  ['range_13', 'fire', 'world.ts', "name: '機槍組', hp: 40, speed: 12, range: 12 * SUB", "name: '機槍組', hp: 40, speed: 12, range: 13 * SUB", 'fire: thirteen cells is out of range'],
  ['shoots_closed_armor', 'armor', 'step.ts', 'if (k.sup && UNIT_KINDS[t.kind].armored && !UNIT_KINDS[t.kind].openTop) continue;', '', 'armor: left alone it does not fire at a closed armoured vehicle'],
  ['spares_open_top', 'armor', 'step.ts', 'if (k.sup && UNIT_KINDS[t.kind].armored && !UNIT_KINDS[t.kind].openTop) continue;', 'if (k.sup && UNIT_KINDS[t.kind].armored) continue;', 'armor: an open-topped vehicle is fair game'],
  ['rifle_suppression', 'suppress', 'step.ts', 'suppress(w, t, s.kind === SHELL_SMALL ? k.sup ?? SUP_SMALL : SUP_DIRECT);', 'suppress(w, t, s.kind === SHELL_SMALL ? SUP_SMALL : SUP_DIRECT);', 'suppress: the first burst leaves the squad shaken'],
  ['no_zone', 'zone', 'step.ts', ZONE, 'if (false && k.sup && k.supArea && s.kind === SHELL_SMALL) suppressZone(', 'zone: a squad one cell from the target takes half'],
  ['zone_full_amount', 'zone', 'step.ts', 'k.supArea, k.sup >> 1, t &&', 'k.supArea, k.sup, t &&', 'zone: a squad one cell from the target takes half'],
  ['zone_too_wide', 'zone', 'world.ts', 'supArea: 384 });', 'supArea: 640 });', 'zone: two cells away is outside the beaten zone'],
  ['zone_hits_friends', 'zone', 'morale.ts', 'if (o.alive && o.side !== side && o !== except && dist(o.x, o.z, x, z) <= area) suppress(w, o, amount);', 'if (o.alive && o !== except && dist(o.x, o.z, x, z) <= area) suppress(w, o, amount);', "zone: the gunners' own side is not suppressed"],
  ['zone_without_rule', 'classic', 'step.ts', ZONE, 'if (k.sup && k.supArea && s.kind === SHELL_SMALL) suppressZone(', 'classic: without the morale rule nothing is suppressed'],
  ['broken_team_runs', 'self', 'world.ts', 'buildTicks: 180, garrison: false,', 'buildTicks: 180, garrison: true,', 'self: a broken team stays where it is'],
  ['pinned_ignored', 'use', 'ai3.ts', '.sort((a, b) => pinned(a) - pinned(b) || dist(g.x, g.z, a.x, a.z)', '.sort((a, b) => dist(g.x, g.z, a.x, a.z)', 'use: the unpinned squad comes first'],
  ['reaches_too_far', 'use', 'ai3.ts', 'targets.filter(t => dist(g.x, g.z, t.x, t.z) <= range)', 'targets.filter(t => dist(g.x, g.z, t.x, t.z) <= range + SUB)', 'use: a target beyond range is left alone'],
  ['never_settles', 'use', 'ai3.ts', '    if (!chasing && dist(g.x, g.z, cx, cz) <= MG_FOLLOW * SUB) continue;\n', '', 'use: within three cells of the armour it stays put'],
  ['chases', 'use', 'ai3.ts', 'const chasing = g.order === ORD_ATTACK;', 'const chasing = false;', 'use: a target that left its range is not chased'],
  ['walks_off_alone', 'use', 'ai2.ts', ' || (st.v === 3 && u.kind === UK_MG);', ';', 'use: it gathers with the wave'],
  ['second_version_commands', 'use', 'ai2.ts', '  if (st.v === 3) {\n    for (const [u, c] of machineGuns3(', '  if (st.v) {\n    for (const [u, c] of machineGuns3(', 'quiet: the second version never commands a machine-gun team'],
  ['armor_dropped', 'counter', 'ai3.ts', 'if (target && (UNIT_KINDS[target.kind].armored || target.kind === UK_MG)) return undefined;', 'if (target && target.kind === UK_MG) return undefined;', 'counter: a tank busy with armour keeps its target'],
  ['chases_far_gun', 'counter', 'ai3.ts', 'const reach = k.range + (k.setup ? 0 : MG_CHASE * SUB);', 'const reach = k.range + 3 * SUB;', 'counter: a machine gun beyond its own range is not chased'],
  ['mortar_ignores_gun', 'counter', 'ai2.ts', '      ?? (st.v === 3 ? nearest(g, ok.filter(t => t.kind === UK_MG)) : undefined)\n', '', 'counter: the mortar shells the machine gun first'],
  ['tank_ignores_gun', 'counter', 'ai2.ts', 'const m = mgTargetFor(u, targetOf(u), foeMg);', 'const m = undefined as Unit | undefined;', 'counter: the tank turns its gun on the machine gun'],
  ['mortar_peeks', 'counter', 'ai2.ts', 'nearest(g, ok.filter(t => t.kind === UK_MG))', 'nearest(g, w.units.filter(t => t.alive && t.side !== side && t.kind === UK_MG && inReach(t.x, t.z)))', 'counter: an unseen machine gun is not acted on'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tools/duel.mjs'), join(dir, 'tools/duel.mjs'));
    cpSync(join(root, 'tests/machine-gun.mjs'), join(dir, 'tests/machine-gun.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/machine-gun.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK machine-gun-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`machine-gun: all groups OK, ${mutants.length} isolated mutants rejected`);
