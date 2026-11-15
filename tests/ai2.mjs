// R057 電腦對手 v2：不開瀏覽器的部分。版本旗標與第一版逐位不變、分波次（集結、出發、殘兵撤回）、懂穿甲、懂壓制、砲兵（換陣地、反砲兵）、決定性。
// 用法：node tests/ai2.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/ai2.mjs <群組名>   只跑那一群（隔離副本裡用）
// 對戰的勝率在 tests/ai2-duel.mjs；真實 Chrome 在 tests/ai2-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_ATTACK, ORD_FIRE_AT, SIDE_PLAYER, SIDE_ENEMY,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ASSAULT } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { dist } from '../src/sim/math.ts';
import { applyRules } from '../src/sim/rules.ts';
import { setAi } from '../src/sim/ai.ts';
import { apHit } from '../src/sim/ballistics.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { soundCell, WAVE, WAVE_WAIT, BASE_CELLS, GUN_SHOTS } from '../src/sim/ai2.ts';

assert.deepEqual([WAVE, WAVE_WAIT, GUN_SHOTS], [[0, 3, 4, 5], 900, 3], 'fixture: the numbers on the card are the numbers in src/sim/ai2.ts');
const cells = n => n * SUB, ME = SIDE_ENEMY, FOE = SIDE_PLAYER;   // 受測的電腦放在敵方那一側（左上角是它的家）
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1 };
// 一片空地（沒有房子、路、彈坑、植被），上面只放守衛自己擺的東西
function field(rules) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (rules) applyRules(w, rules);
  return w;
}
// quiet：裝填時間設成天文數字，這個單位整場不會開火（照樣收指令、照樣移動）；face＝車頭朝哪（±1, ±1）
function put(w, side, kind, cx, cz, { quiet = true, face = [1, 0] } = {}) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: quiet ? 1e9 : 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: face[0] * SUB, hullZ: face[1] * SUB } : {}) };
  w.units.push(u);
  return u;
}
const house = (w, x, z) => { const b = { id: w.blds.length + 1, kind: 0, x, z, w: 1, d: 1, floors: 1, hp: 400, maxHp: 400 }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
// 雙方各一棟指揮部（受測的在左上 (3,3)、對方在右下 (27,27)），補給凍在 0（不會自己出兵）
function bases(w) { const mine = house(w, 3, 3), theirs = house(w, 27, 27); w.eco = { supply: [0, 0], hq: [theirs.id, mine.id], queue: [[], []], prog: [0, 0] }; }
const tick = w => { if (w.eco) w.eco.supply = [0, 0]; step(w, []); };
const ai = (w, version, level = 3) => { setAi(w, ME, level, version); return w.ai.find(a => a.side === ME); };
const RALLY = [center(6), center(6)];   // 指揮部 (3,3) 往對方那一角 4 格
const fromRally = u => dist(u.x, u.z, RALLY[0], RALLY[1]);

// 八局第一版對第一版在這張卡之前（main 2b815df）的雜湊：[地圖, 規則, 雜湊]，種子 11＋地圖、跑 3000 步
const BEFORE = [[0, null, '8455b27a'], [0, { ap: 1 }, '0708a6f7'], [0, { morale: 1 }, '7ff9b58c'], [0, { ap: 1, morale: 1 }, 'a3c5e11a'],
  [1, null, 'fb3a35be'], [1, { ap: 1 }, '8f8e2022'], [1, { morale: 1 }, '596568a1'], [1, { ap: 1, morale: 1 }, '8a7d7cca']];
const battle = (map, rules, seed, a, b) => [{ t: 'map', id: map, vegetation: 1 }, ...(rules ? [{ t: 'rules', ...rules }] : []), ECO, { t: 'ai', side: SIDE_ENEMY, ...b }, { t: 'ai', side: SIDE_PLAYER, ...a }].map(cmd => ({ tick: 0, cmd }));

const groups = {
  // 驗收 1、2：旗標與第一版不變
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    for (const [map, rules, hash] of BEFORE) {
      const w = runLog(createWorld(11 + map), battle(map, rules, 11 + map, { level: 3 }, { level: 3 }), 3000);
      assert.equal(hashWorld(w), hash, `flag: first version against first version on map ${map} with ${JSON.stringify(rules)} is bit for bit what it was before this card`);
      assert(w.ai.every(a => a.v === undefined && a.gather === undefined && a.go === undefined && a.size === undefined), 'flag: a first-version computer carries none of the new memory');
    }
    const one = createWorld(3), two = createWorld(3);
    setAi(one, ME, 3); setAi(two, ME, 3, 2);
    assert.deepEqual([one.ai[0].v, two.ai[0].v], [undefined, 2], 'flag: v 2 is stored, nothing else is');
    assert.notEqual(hashWorld(one), hashWorld(two), 'flag: the version is folded into the hash');
    for (const v of [0, 1, 3, 2.5, '2']) { const w = createWorld(3); setAi(w, ME, 3, v); assert.equal(w.ai[0].v, undefined, `flag: v ${JSON.stringify(v)} is the first version`); }
    setAi(two, ME, 1);
    assert.deepEqual([two.ai[0].level, two.ai[0].v], [1, 2], 'flag: sending ai again changes the level, not the version');
    assert.deepEqual([isCommand({ t: 'ai', side: 1, level: 2, v: 2 }), isCommand({ t: 'ai', side: 1, level: 2 }), isCommand({ t: 'ai', side: 1, level: 2, v: 'two' })], [true, true, false], 'flag: the command check knows the new field');
    const viaLog = runLog(createWorld(3), battle(0, null, 3, { level: 2 }, { level: 2, v: 2 }), 1);
    assert.deepEqual(viaLog.ai.map(a => [a.side, a.v]), [[SIDE_PLAYER, undefined], [SIDE_ENEMY, 2]], 'flag: the version arrives through the ai command, per side');
  },
  // 驗收 3：決定性與存檔
  determinism() {
    const log = battle(1, { ap: 1, morale: 1 }, 21, { level: 3, v: 2 }, { level: 3, v: 2 }), run = t => runLog(createWorld(21), log, t);
    const mid = run(1500), direct = hashWorld(run(3000));
    assert(mid.ai.every(a => a.v === 2) && mid.ai.some(a => a.go !== undefined && a.size !== undefined), 'fixture: both sides run the second version and a wave has set out');
    assert.equal(hashWorld(runLog(structuredClone(mid), log, 3000)), direct, 'determinism: a deep copy taken mid-battle continues bit for bit');
    assert.equal(hashWorld(run(3000)), direct, 'determinism: the same log gives the same hash twice');
    assert.deepEqual(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(mid)))), { ...mid, events: [] }, 'determinism: the second version\'s memory survives the R074 save codec field for field');
    const a = createWorld(3), b = createWorld(3);
    for (const w of [a, b]) setAi(w, ME, 3, 2);
    for (const key of ['gather', 'go', 'size']) { b.ai[0][key] = 40; assert.notEqual(hashWorld(a), hashWorld(b), `determinism: ${key} is folded into the hash`); delete b.ai[0][key]; }
  },
  // 驗收 4、5、6：分波次
  wave() {
    // 兩台坦克在基地、補給凍住：第二版留在基地；第一版馬上出發
    const camp = (version, tanks, level = 3) => { const w = field(); bases(w); for (let i = 0; i < tanks; i++) put(w, ME, UK_TANK, 5 + (i % 3), 5 + Math.floor(i / 3)); const st = ai(w, version, level); return { w, st, mine: w.units.filter(u => u.side === ME) }; };
    const v1 = camp(undefined, 2);
    for (let i = 0; i < 400; i++) tick(v1.w);
    assert(v1.mine.some(u => fromRally(u) > BASE_CELLS * SUB), 'fixture: the first version marches off at once');
    const v2 = camp(2, 2);
    let far = 0;
    for (let i = 0; i < 800; i++) { tick(v2.w); far = Math.max(far, ...v2.mine.map(fromRally)); }
    assert(far <= BASE_CELLS * SUB && v2.st.go === undefined && v2.st.gather !== undefined, `wave: the second version stays at its base while the wave is short (farthest ${(far / SUB).toFixed(1)} cells, gathering since ${v2.st.gather})`);
    // 等滿 45 秒，沒湊滿也出發
    const since = v2.st.gather;
    for (let i = 0; i < 200 && v2.st.go === undefined; i++) tick(v2.w);
    assert(v2.st.go !== undefined && v2.st.go >= since + WAVE_WAIT && v2.st.go <= since + WAVE_WAIT + 20 && v2.st.size === 2, `wave: after 45 seconds it sets out anyway (go ${v2.st.go}, gathering since ${since})`);
    for (let i = 0; i < 400; i++) tick(v2.w);
    assert(v2.mine.some(u => fromRally(u) > BASE_CELLS * SUB), 'wave: once released the tanks leave the base');
    // 湊滿一波就出發：簡單 3、普通 4、困難 5
    for (const [level, need] of [[1, 3], [2, 4], [3, 5]]) {
      const full = camp(2, need, level), short = camp(2, need - 1, level);
      for (let i = 0; i < 300; i++) { tick(full.w); tick(short.w); }
      assert(full.st.go !== undefined && full.st.go <= 200 && full.st.size === need, `wave: at level ${level} a wave of ${need} sets out at once (go ${full.st.go})`);
      assert.equal(short.st.go, undefined, `wave: at level ${level} a wave of ${need - 1} keeps waiting`);
    }
    // 集結中敵人進到射程附近：還手；遠處看得到的敵人：不追出去
    {
      const { w, mine } = camp(2, 2), near = put(w, FOE, UK_TANK, 12, 6);
      tick(w);
      assert(mine.every(u => u.order === ORD_ATTACK && u.target === near.id), 'wave: while gathering, an enemy within reach is engaged');
      const b = camp(2, 2); put(b.w, ME, UK_OBSERVER, 10, 10); const away = put(b.w, FOE, UK_TANK, 22, 22);
      for (let i = 0; i < 200; i++) tick(b.w);
      assert(b.mine.filter(u => u.kind === UK_TANK).every(u => u.order !== ORD_ATTACK && fromRally(u) <= BASE_CELLS * SUB), 'wave: while gathering, a distant enemy it can see is not chased');
      assert(away.alive, 'fixture: the distant enemy is still there');
    }
    // 殘兵撤回：出發時 6 台、前面只剩 1 台、看得到 2 個敵人 → 回集結點；之後最久 45 秒再出發
    const remnant = (size, foes) => {
      const w = field(); bases(w);
      const lone = put(w, ME, UK_TANK, 16, 16);
      for (let i = 0; i < foes; i++) put(w, FOE, UK_TANK, 20, 15 + 2 * i);
      const st = ai(w, 2); st.go = -500; st.size = size;
      tick(w);
      return { w, st, lone };
    };
    const r = remnant(6, 2);
    assert(r.lone.order === ORD_MOVE && Math.abs(r.lone.tx - 6) <= 2 && Math.abs(r.lone.tz - 6) <= 2, `wave: a remnant facing more enemies than itself falls back to the rally point (order ${r.lone.order}, to ${r.lone.tx},${r.lone.tz})`);
    assert.equal(remnant(3, 2).lone.order, ORD_ATTACK, 'wave: a third of the wave or more fights on');
    assert.equal(remnant(6, 1).lone.order, ORD_ATTACK, 'wave: a remnant that is not outnumbered fights on');
    {
      const joins = ahead => {
        const w = field(); bases(w);
        const fresh = put(w, ME, UK_TANK, 6, 6);
        for (let i = 0; i < ahead; i++) put(w, ME, UK_TANK, 16 + i, 16);
        const st = ai(w, 2); st.go = -500; st.size = 5;
        for (let i = 0; i < 300; i++) tick(w);
        return fromRally(fresh) > BASE_CELLS * SUB;
      };
      assert.equal(joins(2), true, 'wave: with a group still fighting up front a new unit goes to join it');
      assert.equal(joins(0), false, 'wave: with nobody left up front a new unit waits at the base for the next wave');
    }
    for (const u of r.w.units) if (u.side === FOE) u.alive = false;   // 讓它平安回到基地
    let again = false;
    for (let i = 0; i < 2600 && !again; i++) { tick(r.w); again = r.st.go > 0; }
    assert(again, `wave: after falling back it sets out again within the waiting time (go ${r.st.go})`);
  },
  // 驗收 7：懂穿甲
  ap() {
    const duel = (version, rules, foes, own = []) => {
      const w = field(rules), me = put(w, ME, UK_TANK, 16, 16, { face: [-1, 0] });
      const them = foes.map(([kind, x, z, face]) => put(w, FOE, kind, x, z, { face }));
      const extra = own.map(([kind, x, z]) => put(w, ME, kind, x, z));
      ai(w, version); tick(w);
      return { w, me, them, extra };
    };
    const AP = { ap: 1 }, heavy = [UK_HEAVY, 11, 16, [1, 0]], light = [UK_LIGHT, 16, 10, [1, 0]];
    // 打不穿正面的重坦克、旁邊有打得穿的輕坦克
    let s = duel(undefined, AP, [heavy, light]);
    assert.equal(apHit(UK_TANK, s.me.x, s.me.z, s.them[0]), 0, 'fixture: the medium tank cannot pierce the heavy tank from the front');
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.them[0].id], 'fixture: the first version fires at the heavy tank anyway');
    s = duel(2, AP, [heavy, light]);
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.them[1].id], 'ap: with a target it can pierce in range, the second version shoots that one instead');
    s = duel(2, null, [heavy, light]);
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.them[0].id], 'ap: without the rule the second version targets like the first');
    // 只有側面打得穿：繞過去
    s = duel(2, AP, [[UK_ASSAULT, 11, 16, [1, 0]]]);
    assert.deepEqual([s.me.order, s.me.tx, Math.abs(s.me.tz - 16)], [ORD_MOVE, 11, 3], `ap: when only the side can be pierced it drives to the flank (order ${s.me.order}, to ${s.me.tx},${s.me.tz})`);
    let shot = false;
    for (let i = 0; i < 900 && !shot; i++) { tick(s.w); shot = s.me.order === ORD_ATTACK && s.me.target === s.them[0].id; }
    assert(shot && apHit(UK_TANK, s.me.x, s.me.z, s.them[0]) === 1, 'ap: from the flank it opens fire and the shot will pierce');
    // 目標旁邊還有別的敵人：不繞（繞的時候自己的側面是露出來的），退開
    s = duel(2, AP, [[UK_ASSAULT, 11, 16, [1, 0]], [UK_ASSAULT, 11, 13, [1, 0]]]);
    assert(s.me.order === ORD_MOVE && s.me.tx > 16, `ap: a target with company is not flanked; the tank backs away instead (order ${s.me.order}, to ${s.me.tx},${s.me.tz})`);
    // 兩台對一個落單的目標：只派一台去繞
    {
      const w = field(AP), a = put(w, ME, UK_TANK, 16, 16, { face: [-1, 0] }), b = put(w, ME, UK_TANK, 16, 18, { face: [-1, 0] }), t = put(w, FOE, UK_ASSAULT, 11, 16, { face: [1, 0] });
      ai(w, 2); tick(w);
      const flankers = [a, b].filter(u => u.order === ORD_MOVE && u.tx === 11 && Math.abs(u.tz - 16) === 3);
      assert.equal(flankers.length, 1, `ap: two tanks against one lone target send exactly one round the flank (${[a, b].map(u => `${u.order}:${u.tx},${u.tz}`)})`);
      assert(t.alive, 'fixture: the target is still there');
    }
    // 側面也打不穿：不打；人在它射程裡就退開；砲兵優先打它
    s = duel(2, AP, [heavy]);
    const gap = dist(center(16), center(16), s.them[0].x, s.them[0].z);
    assert(s.me.order === ORD_MOVE && dist(center(s.me.tx), center(s.me.tz), s.them[0].x, s.them[0].z) > gap, `ap: a target it cannot pierce from any side is not attacked, and it backs out of its reach (order ${s.me.order}, to ${s.me.tx},${s.me.tz})`);
    const guns = version => duel(version, AP, [heavy, [UK_LIGHT, 26, 8, [1, 0]]], [[UK_HOWITZER, 24, 16], [UK_OBSERVER, 24, 10]]);
    s = guns(undefined);
    assert.deepEqual([s.extra[0].order, s.extra[0].target], [ORD_ATTACK, s.them[1].id], 'fixture: the first version\'s howitzer takes the nearest armour');
    s = guns(2);
    assert.deepEqual([s.extra[0].order, s.extra[0].target], [ORD_ATTACK, s.them[0].id], 'ap: the howitzer takes the tank no direct-fire gun of ours can pierce');
  },
  // 驗收 8：懂壓制
  morale() {
    const M = { morale: 1 };
    // 找掩體
    const squad = (version, { sup = 45, houseAt = null, inside = false } = {}) => {
      const w = field(M), h = houseAt ? house(w, ...houseAt) : null, me = put(w, ME, UK_INFANTRY, inside ? houseAt[0] : 16, inside ? houseAt[1] : 16), foe = put(w, FOE, UK_INFANTRY, 16, 11);
      if (sup) me.sup = sup;
      ai(w, version); tick(w);
      return { me, foe, h };
    };
    let s = squad(undefined, { houseAt: [18, 16] });
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.foe.id], 'fixture: the first version\'s suppressed squad keeps attacking from the open');
    s = squad(2, { houseAt: [18, 16] });
    assert.deepEqual([s.me.order, s.me.tx, s.me.tz], [ORD_MOVE, 18, 16], 'morale: a suppressed squad in the open goes for the nearest house');
    s = squad(2, {});
    assert(s.me.order === ORD_MOVE && s.me.tx < 16 && s.me.tz < 16, `morale: with no house near it falls back toward its own side (to ${s.me.tx},${s.me.tz})`);
    s = squad(2, { houseAt: [18, 16], inside: true });
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.foe.id], 'morale: a suppressed squad already inside a house stays and fights');
    s = squad(2, { sup: 0, houseAt: [18, 16] });
    assert.deepEqual([s.me.order, s.me.target], [ORD_ATTACK, s.foe.id], 'morale: a squad that is not suppressed does not hide');
    // 迫擊砲先壓還沒被釘住的
    const mortar = (version, rules, farSup) => {
      const w = field(rules), me = put(w, ME, UK_MORTAR, 16, 16); put(w, ME, UK_OBSERVER, 16, 14);
      const near = put(w, FOE, UK_INFANTRY, 16, 11), far = put(w, FOE, UK_INFANTRY, 16, 8);
      near.sup = 75; if (farSup) far.sup = farSup;
      ai(w, version); tick(w);
      return { me, near, far };
    };
    let m = mortar(undefined, M, 0);
    assert.equal(m.me.target, m.near.id, 'fixture: the first version\'s mortar takes the nearest squad, pinned or not');
    m = mortar(2, M, 0);
    assert.deepEqual([m.me.order, m.me.target], [ORD_ATTACK, m.far.id], 'morale: the mortar takes the squad that is not pinned yet');
    m = mortar(2, M, 75);
    assert.equal(m.me.target, m.near.id, 'morale: with every squad pinned it takes the nearest');
    // 對方被釘住：步兵多走幾格過去打
    const assault = (version, foeSup) => {
      const w = field(M), me = put(w, ME, UK_INFANTRY, 16, 16); put(w, ME, UK_OBSERVER, 16, 15);
      const foe = put(w, FOE, UK_INFANTRY, 16, 6);
      if (foeSup) foe.sup = foeSup;
      ai(w, version); tick(w);
      return { me, foe };
    };
    let a = assault(2, 75);
    assert.deepEqual([a.me.order, a.me.target], [ORD_ATTACK, a.foe.id], 'morale: a squad goes after a pinned enemy squad 10 cells away');
    a = assault(2, 0);
    assert.notEqual(a.me.order, ORD_ATTACK, 'morale: it does not go after an unsuppressed squad at that distance');
    a = assault(undefined, 75);
    assert.notEqual(a.me.order, ORD_ATTACK, 'fixture: the first version does not assault');
  },
  // 驗收 9：砲兵
  guns() {
    // 聲測的小格：拿真的報告對
    {
      const w = field(), g = put(w, ME, UK_HOWITZER, 21, 19, { quiet: false }); put(w, ME, UK_OBSERVER, 18, 16); put(w, FOE, UK_HEAVY, 10, 12);
      setAi(w, ME, 3);
      for (let i = 0; i < 60 && !w.counterbattery; i++) step(w, []);
      const r = w.counterbattery?.find(x => x.side === FOE);
      assert(r, 'fixture: the howitzer fired and the other side heard it');
      assert.deepEqual([r.zone, r.cell], Object.values(soundCell(w, g.x, g.z)), 'guns: the sound cell the computer works out is the one the sound ranging really records');
    }
    // 打三發換陣地
    const heard = (version, shots) => {
      const w = field(), g = put(w, ME, UK_HOWITZER, 20, 20), here = soundCell(w, g.x, g.z);
      w.counterbattery = [{ side: FOE, zone: here.zone, cell: here.cell, shots, last: 0 }];
      ai(w, version); tick(w);
      return { w, g, here };
    };
    let h = heard(2, GUN_SHOTS);
    const there = soundCell(h.w, center(h.g.tx), center(h.g.tz));
    assert(h.g.order === ORD_MOVE && (there.zone !== h.here.zone || there.cell !== h.here.cell), `guns: after three shots from one sound cell the howitzer moves to another (order ${h.g.order}, to ${h.g.tx},${h.g.tz})`);
    assert.notEqual(heard(2, GUN_SHOTS - 1).g.order, ORD_MOVE, 'guns: after two shots it stays');
    assert.notEqual(heard(undefined, GUN_SHOTS).g.order, ORD_MOVE, 'fixture: the first version never displaces');
    // 反砲兵射擊
    const located = (version, shots) => {
      const w = field(), g = put(w, ME, UK_HOWITZER, 8, 8), spot = soundCell(w, center(24), center(24));
      w.counterbattery = [{ side: ME, zone: spot.zone, cell: spot.cell, shots, last: 0 }];
      ai(w, version); tick(w);
      return g;
    };
    let g = located(2, 2);
    assert(g.order === ORD_FIRE_AT && Math.abs(g.tx - 24) <= 3 && Math.abs(g.tz - 24) <= 3, `guns: with nothing in sight the howitzer fires at the area the sound ranging has narrowed down (order ${g.order}, at ${g.tx},${g.tz})`);
    assert.notEqual(located(2, 1).order, ORD_FIRE_AT, 'guns: a first rough bearing is not fired at');
    assert.notEqual(located(undefined, 2).order, ORD_FIRE_AT, 'fixture: the first version does not use the sound ranging');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`ai2/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK ai2/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../src/main.ts');
  assert.match(read('../src/valves.ts'), /get r057\(\) \{ return on\('057'\); \}/, 'valve: r057 is on the table');
  assert.equal((main.match(/issue\(\{ t: 'ai', side: SIDE_ENEMY, level: aiLevel, \.\.\.\(V\.r057 \? \{ v: 2 \} : \{\}\) \}\);/g) ?? []).length, 2, 'wiring: both places that hand the enemy to the computer send the version, behind the valve');
  assert.equal((main.match(/t: 'ai'/g) ?? []).length, 2, 'wiring: there is no third place that starts a computer opponent');
  assert.match(read('../README.md'), /\?noR057=1/, 'readme: the valve is documented');
  console.log('OK ai2/wiring');
}

// ---- 故意弄壞（驗收 10）----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r057-negative-'));
const mutants = [
  ['version_unhashed', 'flag', 'world.ts', ' if (a.v) f.int(0x4156).int(a.v);', '', 'flag: the version is folded into the hash'],
  ['always_second', 'flag', 'step.ts', 'for (const c of st.v === 2 ? aiThink2(w, st, spotted, thought) : thought) applyCommand(w, c);', 'for (const c of aiThink2(w, st, spotted, thought)) applyCommand(w, c);', 'flag: first version against first version on map 0 with null is bit for bit what it was before this card'],
  ['no_gather', 'wave', 'ai2.ts', '    const going = st.go !== undefined && w.tick - st.go <= WAVE_GO;', '    const going = true;', 'wave: the second version stays at its base while the wave is short (farthest'],
  ['never_launch', 'wave', 'ai2.ts', '(home.length >= WAVE[lv] || w.tick - st.gather >= WAVE_WAIT)', '(home.length >= 99)', 'wave: after 45 seconds it sets out anyway (go undefined'],
  ['no_fall_back', 'wave', 'ai2.ts', 'forward.length * 3 < st.size && seen.length > forward.length;', 'forward.length * 3 < st.size && seen.length > 99;', 'wave: a remnant facing more enemies than itself falls back to the rally point (order 2'],
  ['reserves_idle', 'wave', 'ai2.ts', '    const support = st.go !== undefined && forward.length > 0 && !retreat;', '    const support = false;', 'wave: with a group still fighting up front a new unit goes to join it'],
  ['flanks_into_a_crowd', 'ap', 'ai2.ts', ' && !seen.some(e => e !== t && dist(e.x, e.z, t.x, t.z) <= FLANK_ALONE * SUB)) {', ') {', 'ap: a target with company is not flanked; the tank backs away instead'],
  ['shoots_anyway', 'ap', 'ai2.ts', "      if (!t || !kind(t).armored || apHit(u.kind, u.x, u.z, t) !== 0) continue;", '      if (u) continue;', 'ap: with a target it can pierce in range, the second version shoots that one instead'],
  ['no_cover_seek', 'morale', 'ai2.ts', '|| u.rout || moraleState(u) !== MORALE_SHAKEN || coverPct(w, u) < 100) continue;', '|| u) continue;', 'morale: a suppressed squad in the open goes for the nearest house'],
  ['no_displace', 'guns', 'ai2.ts', 'heardOfMe.some(r => r.zone === here.zone && r.cell === here.cell)', 'heardOfMe.some(r => r.zone === -1)', 'guns: after three shots from one sound cell the howitzer moves to another (order 0'],
  ['no_counterfire', 'guns', 'ai2.ts', 'counterbatteryAreas(w, side).filter(a => a.level >= 2)', 'counterbatteryAreas(w, side).filter(a => a.level >= 9)', 'guns: with nothing in sight the howitzer fires at the area the sound ranging has narrowed down (order 1'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/ai2.mjs'), join(dir, 'tests/ai2.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/ai2.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK ai2-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`ai2: all groups OK, ${mutants.length} isolated mutants rejected`);
