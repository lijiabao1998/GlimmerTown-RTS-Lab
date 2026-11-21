// R1010 炸橋與修橋：不開瀏覽器的部分，卡面驗收 1–17。
// 用法：node tests/bridge1010.mjs            全部各群
//       node tests/bridge1010.mjs <群組名>   只跑那一群（故意弄壞的隔離副本裡用；tests/bridge1010-negative.mjs）
// 距離、時間從 UNIT_KINDS[47].demo、DEMO_BLD 與 bridge1010.ts 的數字表推，不寫死。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, center, cellOf, SUB, UNIT_KINDS, ORD_IDLE, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE, SHELL_HE, TER_MUD, TER_ROAD, TER_GRASS,
  UK_TANK, UK_HEAVY, UK_INFANTRY, UK_HOWITZER, UK_TRUCK, UK_AA, UK_ENGINEER, UK_ATGUN, BK_SUPPLY, waterAt, wireBlocks, blocks } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { why50, RANGE50 } from '../src/sim/tech50.ts';
import { DEMO_BLD } from '../src/sim/engineer1002.ts';
import { BAIL92 } from '../src/sim/transport92.ts';
import { isCanal, HYTHE_BRIDGES, MAP_HYTHE } from '../src/sim/hytheMap.ts';
import { MAP_RYE } from '../src/sim/maps.ts';
import { MAP_LARGE } from '../src/sim/largeMap.ts';
import { MAP_TOWN } from '../src/sim/expandedMap.ts';
import { MAP_HILLS } from '../src/sim/hillMap.ts';
import { HP1010, WOOD1010, COST1010, WORK1010, RYE_RIVERS1010, linked1010 } from '../src/sim/bridge1010.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { hint50 } from '../src/ui/tech50.ts';
import { HOW1010 } from '../src/ui/bridge1010.ts';
import { initMinimap } from '../src/ui/minimap.ts';
import { ECO } from '../tools/duel.mjs';

const NEED = UNIT_KINDS[UK_ENGINEER].demo;   // 一包炸藥要幾步（R1002）
const AIS = [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }];
const ecoBr = (extra = {}) => ({ ...ECO, end: 1, sw: 2, br: 1, ...extra });
const RYE_SPANS = [[7 * 32 + 24, 8 * 32 + 24], [15 * 32 + 27, 15 * 32 + 28], [21 * 32 + 7, 21 * 32 + 8]];   // 卡面 1 節：(24,7)(24,8)／(27,15)(28,15)／(7,21)(8,21)
const RYE_AT = [[24, 6], [26, 15], [6, 21]];   // 每座橋岸上挨著的路格（工兵站這裡）
const HYTHE_AT = [[107, 17], [90, 40], [65, 61], [44, 86], [21, 105]];
const xz = (w, c) => [c % w.n, (c - (c % w.n)) / w.n];
const water = (w, c) => waterAt(w, ...xz(w, c));
function opened(map, seed = 1, eco = ecoBr(), first = {}, more = []) { const w = createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, ...first }, ...more, eco]); return w; }
// 只留守衛自己擺的兵（地圖、指揮部、w.br 照舊）
function bare(map, seed = 1, eco = ecoBr()) { const w = opened(map, seed, eco); w.units = []; w.eco.queue = [[], []]; w.eco.supply = [500, 500]; return w; }
function put(w, side, kind, cx, cz, ready = true) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const fire = (side, ids, x, z) => ({ t: 'fireAt', side, ids, x, z });
const at = (w, si) => xz(w, w.br.spans[si].cells[0]);
// 跑到那一座橋斷了（或 limit 步）：回傳每一次掉血的 [那一步之後的 w.tick, 少了多少]
function charges(w, si, limit, cmds = []) {
  const s = w.br.spans[si], out = [];
  for (let i = 0; i < limit && !(i > 0 && s.state === 1); i++) { const hp = s.hp; step(w, i === 0 ? cmds : []); if (s.hp < hp) out.push([w.tick, hp - s.hp]); }
  return out;
}
// 用真的指令炸斷一座：岸上放一個工兵、點那座橋，跑到斷
function blowNow(w, si, spot) {
  const e = put(w, ME, UK_ENGINEER, ...spot);
  step(w, [fire(ME, [e.id], ...at(w, si))]);
  for (let i = 0; i < 3000 && w.br.spans[si].state !== 1; i++) step(w, []);
  assert.equal(w.br.spans[si].state, 1, `setup: span ${si} was blown`);
  return e;
}
// 連通塊：乾格（遮罩外）的四方向連通，不算橋
function comps(w) {
  const n = w.n, c = new Int32Array(n * n).fill(-1);
  let k = 0;
  for (let i = 0; i < n * n; i++) {
    if (w.br.wet[i] || c[i] >= 0) continue;
    const st = [i]; c[i] = k;
    while (st.length) { const j = st.pop(), [x, z] = xz(w, j); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = z + dz, q = b * n + a; if (a >= 0 && b >= 0 && a < n && b < n && !w.br.wet[q] && c[q] < 0) { c[q] = k; st.push(q); } } }
    k++;
  }
  return c;
}
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const vehicleInWater = w => w.units.find(u => u.alive && !u.ride && UNIT_KINDS[u.kind].radius > 0 && waterAt(w, cellOf(u.x), cellOf(u.z)));

const groups = {
  // 驗收 1：哪裡有橋、哪裡是水
  spans() {
    const rye = opened(MAP_RYE), hy = opened(MAP_HYTHE);
    assert.deepEqual(rye.br.spans.map(s => s.cells), RYE_SPANS, 'spans: Rye has the three two-cell bridges of the card');
    assert.deepEqual(rye.br.spans.map(s => [s.state, s.hp, s.left]), RYE_SPANS.map(c => [0, HP1010 * c.length, 0]), 'spans: Rye bridges start intact with 40 per cell');
    assert.equal(hy.br.spans.length, 5, 'spans: Hythe has five bridges');
    assert(hy.br.spans.every(s => s.cells.length === 6), 'spans: every Hythe bridge has six cells');
    const firsts = hy.br.spans.map(s => s.cells[0]);
    assert.deepEqual(firsts, [...firsts].sort((a, b) => a - b), 'spans: bridges are ordered by their first cell');
    for (const [x, z] of HYTHE_BRIDGES) assert.equal(hy.br.spans.filter(s => s.cells.includes(z * 128 + x)).length, 1, `spans: HYTHE_BRIDGES (${x},${z}) lies in exactly one bridge`);
    let canal = 0;
    for (let z = 0; z < 128; z++) for (let x = 0; x < 128; x++) { const c = isCanal(x, z) ? 1 : 0; canal += c; assert.equal(hy.br.wet[z * 128 + x], c, `spans: the Hythe mask is isCanal at (${x},${z})`); }
    assert.equal(canal, 381, 'spans: Hythe mask is the 381 canal cells');
    assert.equal(rye.br.wet.reduce((a, b) => a + b, 0), 122, 'spans: Rye mask is 122 cells');
    const ryeMud = [...rye.ter.keys()].filter(i => rye.ter[i] === TER_MUD), ryeDeck = [...rye.br.wet.keys()].filter(i => rye.br.wet[i] && rye.ter[i] !== TER_MUD);
    assert(ryeMud.every(i => rye.br.wet[i]), 'spans: every Rye mud cell is inside the mask (the four rivers are copied right)');
    assert.deepEqual(ryeDeck, RYE_SPANS.flat().sort((a, b) => a - b), 'spans: inside the Rye mask only the six bridge cells are not mud');
    for (const seed of [1, 2, 3]) {
      const h = opened(MAP_HYTHE, seed), ditch = [...h.ter.keys()].filter(i => h.ter[i] === TER_MUD && !isCanal(...xz(h, i)));
      assert(ditch.length >= 200 && ditch.every(i => !h.br.wet[i]), `spans: Hythe seed ${seed} has ${ditch.length} ditch mud cells, none in the mask`);
    }
    for (const map of [MAP_RYE, MAP_HYTHE]) for (let seed = 1; seed <= 5; seed++) for (const [label, first, more] of [['plain', {}, []], ['more', { more: 1 }, []], ['sym', { sym: 1 }, []], ['force3', {}, [{ t: 'rules', force: 3 }]]]) {
      const w = opened(map, seed, ecoBr(), first, more);
      for (let i = 0; i < w.n * w.n; i++) if (w.br.wet[i]) assert(!w.occ[i] && !(w.vegetation?.cells[i]), `spans: map ${map} seed ${seed} ${label}: no building or vegetation in the mask (${xz(w, i)})`);
      assert(!vehicleInWater(w), `spans: map ${map} seed ${seed} ${label}: no vehicle starts on a water cell`);
    }
    for (const map of [0, MAP_LARGE, MAP_TOWN, MAP_HILLS]) assert.equal(opened(map, 1).br, undefined, `spans: map ${map} with br has no w.br`);
    console.log('OK bridge1010/spans: Rye 3 bridges × 2 cells, mask 122; Hythe 5 × 6, mask 381; ditches outside; nothing in the mask; other maps none');
  },
  // 驗收 2：旗標
  flag() {
    const ok = opened(MAP_RYE);
    assert(ok.br && ok.eco.br === undefined, 'flag: br builds w.br and is not stored in eco');
    assert.equal(opened(MAP_RYE, 1, { ...ECO, end: 1, sw: 1, br: 1 }).br, undefined, 'flag: br needs sw 2 (sw 1 → none)');
    assert.equal(opened(MAP_RYE, 1, ecoBr({ br: 2 })).br, undefined, 'flag: only br 1 counts');
    assert.equal(opened(MAP_RYE, 1, ecoBr(), {}, [{ t: 'zombies' }]).br, undefined, 'flag: zombie defence has no w.br');
    { const w = createWorld(1); step(w, [{ t: 'map', id: 1, vegetation: 1 }]); step(w, [ecoBr()]); assert.equal(w.br, undefined, 'flag: an eco with br after step 0 builds nothing'); }
    const no = opened(MAP_RYE, 1, { ...ECO, end: 1, sw: 2 });
    assert.notEqual(hashWorld(ok), hashWorld(no), 'flag: the hash tells a br world from the same world without');
    const a = structuredClone(ok), b = structuredClone(ok); b.br.spans[1].hp--;
    assert.notEqual(hashWorld(a), hashWorld(b), 'flag: the hash folds the bridge state');
    assert(isCommand({ t: 'eco', br: 1 }) && !isCommand({ t: 'eco', br: 'x' }) && !isCommand({ t: 'eco', br: 1.5 }), 'flag: isCommand takes an integer br only');
    console.log('OK bridge1010/flag: only br 1 + sw 2 at step 0 outside zombie defence; br not stored in eco; hash folds it; isCommand checks it');
  },
  // 驗收 3：車過不了河、斜角
  ford() {
    const hy = bare(MAP_HYTHE), deck = new Set(hy.br.spans.flatMap(s => s.cells));
    for (const kind of [UK_TANK, UK_TRUCK, UK_HOWITZER, UK_AA]) for (const [sx, sz, gx, gz] of [[115, 115, 12, 12], [90, 60, 60, 30]]) {   // 第二題：不擋水的話車會直接涉過運河（下面「不帶 br」那一題）
      const p = findPath(hy, sx, sz, gx, gz, 0, 0, kind);
      assert.equal(p[p.length - 1], gz * 128 + gx, `ford: kind ${kind} finds a way across the canal`);
      assert(p.every(c => !water(hy, c)), `ford: kind ${kind} never steps on a water cell (${sx},${sz} → ${gx},${gz})`);
      assert(p.some(c => deck.has(c)), `ford: kind ${kind} crosses on a bridge`);
    }
    const foot = findPath(hy, 90, 60, 60, 30, 0, 0, UK_INFANTRY);
    assert(foot.some(c => water(hy, c)), 'ford: an infantry section still wades the canal');
    const old = opened(MAP_HYTHE, 1, { ...ECO, end: 1, sw: 2 }), tank = findPath(old, 90, 60, 60, 30, 0, 0, UK_TANK);
    assert(tank.some(c => isCanal(...xz(old, c)) && old.ter[c] === TER_MUD), 'ford: without br a tank still drives through the canal mud (as main)');
    // 萊伊一格寬的橋上兩台坦克對開
    { const w = bare(MAP_RYE), a = put(w, ME, UK_TANK, 24, 4), b = put(w, ME, UK_TANK, 24, 11, true);
      step(w, [{ t: 'move', side: ME, ids: [a.id], x: 24, z: 11 }, { t: 'move', side: ME, ids: [b.id], x: 24, z: 4 }]);
      for (let i = 0; i < 200; i++) { step(w, []); assert(!vehicleInWater(w), `ford: two tanks meeting on a one-cell bridge stay out of the water (step ${w.tick})`); }
      assert(cellOf(a.z) > 8 && cellOf(b.z) < 7, `ford: the two tanks got past each other (${cellOf(a.z)}, ${cellOf(b.z)})`); }
    // 斜角：乾格只在角上相接的六處
    const found = [];
    for (const w of [bare(MAP_RYE), hy]) {
      const n = w.n, dry = (x, z) => x >= 0 && z >= 0 && x < n && z < n && !w.br.wet[z * n + x];
      for (let z = 0; z + 1 < n; z++) for (let x = 0; x < n; x++) for (const sx of [1, -1]) if (dry(x, z) && dry(x + sx, z + 1) && !dry(x + sx, z) && !dry(x, z + 1)) found.push([w, x, z, x + sx, z + 1]);
    }
    assert.deepEqual(found.map(f => `${f[0].n}:${f[1]},${f[2]}-${f[3]},${f[4]}`).sort(), ['128:119,7-120,8', '128:23,103-24,104', '128:47,79-48,80', '128:71,55-72,56', '128:95,31-96,32', '32:8,8-9,9'].sort(), 'ford: the six corner-only crossings of the card');
    let runs = 0;
    for (const [w0, ax, az, bx, bz] of found) for (const [fx, fz, tx, tz] of [[ax, az, bx, bz], [bx, bz, ax, az]]) for (const order of [0, 1]) for (const kinds of [[UK_TANK, UK_TANK, UK_TANK], [UK_HEAVY, UK_TANK, UK_HEAVY]]) {
      const w = structuredClone(w0), comp = comps(w), n = w.n, deckW = new Set(w.br.spans.flatMap(s => s.cells));
      const px = Math.max(fx, tx) * SUB, pz = Math.max(fz, tz) * SUB, sx = tx > fx ? -1 : 1, sz = tz > fz ? -1 : 1;
      const us = kinds.map((kind, i) => { const u = put(w, ME, kind, 0, 0, false), [ox, oz] = [[1, 1], [9, 4], [3, 16]][i]; u.x = px + sx * ox - (sx < 0 ? 0 : 0); u.z = pz + sz * oz; return u; });
      const home = us.map(u => comp[cellOf(u.z) * n + cellOf(u.x)]);
      assert(home.every(h => h === comp[fz * n + fx] && h >= 0), 'ford: setup puts the three tanks in the corner cell');
      let last = home.slice(), bridge = home.map(() => false);
      for (let t = 0; t < 400; t++) {
        step(w, order && t === 0 ? [{ t: 'move', side: ME, ids: [us[0].id], x: tx, z: tz }] : []);
        us.forEach((u, i) => {
          const c = cellOf(u.z) * n + cellOf(u.x), k = comp[c];
          if (deckW.has(c)) { bridge[i] = true; return; }
          assert(k === last[i] || bridge[i], `ford: corner (${fx},${fz})→(${tx},${tz}) map ${n}: tank ${i} stays on its own bank unless it drove over a bridge (step ${t}, now ${cellOf(u.x)},${cellOf(u.z)})`);
          if (order && i === 0) { last[i] = k; bridge[i] = false; }
        });
      }
      runs++;
    }
    // 拖砲（R092）：卡車在角的對岸不能把砲掛過去（審查：match92 只看兩格內，掛上就把砲搬到車那一格；砲自己要繞橋）。同一岸的照舊掛得上
    const tpw = { 32: bare(MAP_RYE, 1, ecoBr({ tp: 1 })), 128: bare(MAP_HYTHE, 1, ecoBr({ tp: 1 })) };
    let tows = 0;
    for (const [w0, ax, az, bx, bz] of found) for (const [gx, gz, cx, cz] of [[ax, az, bx, bz], [bx, bz, ax, az]]) for (const kind of [UK_ATGUN, UK_HOWITZER]) {
      if (blocks(w0, gx, gz) || blocks(w0, cx, cz)) continue;   // 海斯 (47,79)、(71,55) 那兩格是地圖固定的房子：車、砲都不會在裡面
      const w = structuredClone(tpw[w0.n]), n = w.n, comp = comps(w), gun = put(w, ME, kind, gx, gz), car = put(w, ME, UK_TRUCK, cx, cz);
      const k = [4, 5, 6, 7, 8, 3].find(k => { const p = findPath(w, cx, cz, cx + k * (cx - gx), cz + k * (cz - gz), 0, 0, UK_TRUCK); return p.length && p[p.length - 1] === (cz + k * (cz - gz)) * n + cx + k * (cx - gx); });   // 車那一岸、車開得到的一格
      step(w, [{ t: 'move', side: ME, ids: [car.id, gun.id], x: cx + k * (cx - gx), z: cz + k * (cz - gz) }]);
      assert(car.order !== ORD_IDLE && car.path.length > 0, `ford: setup: the truck at (${cx},${cz}) drives off`);
      assert(!gun.towBy && comp[cellOf(gun.z) * n + cellOf(gun.x)] === comp[gz * n + gx], `ford: a truck across a river corner does not hitch the gun (map ${n}, gun kind ${kind} at ${gx},${gz}, truck at ${cx},${cz}; gun now at ${cellOf(gun.x)},${cellOf(gun.z)} towBy ${gun.towBy})`);
      tows++;
    }
    assert.equal(tows, 16, 'ford: setup: four corners (Rye one, Hythe three without a house on them) × two banks × two guns');
    { const w = structuredClone(tpw[32]), gun = put(w, ME, UK_ATGUN, 8, 8), car = put(w, ME, UK_TRUCK, 7, 8);
      step(w, [{ t: 'move', side: ME, ids: [car.id, gun.id], x: 3, z: 3 }]);
      assert.equal(gun.towBy, car.id, 'ford: a truck on the same bank still hitches the gun at the corner'); }
    console.log(`OK bridge1010/ford: tanks, trucks, howitzers, AA guns cross only on bridges; feet wade; no-br tanks still wade; head-on on a bridge stays dry; ${runs} corner pushes leak nothing; ${tows} hitches across a corner refused`);
  },
  // 驗收 4：炸橋
  blow() {
    { const w = bare(MAP_RYE), e = put(w, ME, UK_ENGINEER, ...RYE_AT[0]), t0 = w.tick;
      const got = charges(w, 0, 600, [fire(ME, [e.id], 24, 7)]);
      assert.deepEqual(got, [[t0 + NEED, DEMO_BLD], [t0 + 2 * NEED, HP1010 * 2 - DEMO_BLD]], 'blow: one engineer beside a Rye bridge: a charge at 120 (80 → 20) and the break at 240'); }
    { const w = bare(MAP_RYE), e = put(w, ME, UK_ENGINEER, 24, 6), f = put(w, ME, UK_ENGINEER, 24, 9), t0 = w.tick;
      const got = charges(w, 0, 600, [fire(ME, [e.id, f.id], 24, 8)]);
      assert.equal(got[got.length - 1][0], t0 + NEED, 'blow: two engineers break a Rye bridge at 120'); }
    { const w = bare(MAP_HYTHE), e = put(w, ME, UK_ENGINEER, ...HYTHE_AT[2]), t0 = w.tick;
      const got = charges(w, 2, 2000, [fire(ME, [e.id], ...at(w, 2))]);
      assert.equal(got[got.length - 1][0], t0 + 4 * NEED, 'blow: one engineer breaks a Hythe bridge at 480 (four charges)'); }
    { const w = bare(MAP_HYTHE), e = put(w, ME, UK_ENGINEER, 65, 61), f = put(w, ME, UK_ENGINEER, 64, 66), t0 = w.tick;
      const got = charges(w, 2, 2000, [fire(ME, [e.id, f.id], ...at(w, 2))]);
      assert.equal(got[got.length - 1][0], t0 + 2 * NEED, 'blow: two engineers break a Hythe bridge at 240'); }
    { const w = bare(MAP_RYE), e = put(w, ME, UK_ENGINEER, 24, 1);
      step(w, [fire(ME, [e.id], 24, 7)]);
      let arrived = -1;
      for (let i = 0; i < 400 && arrived < 0; i++) { step(w, []); if (e.pathIdx >= e.path.length && Math.abs(cellOf(e.z) - 7) <= 1 && Math.abs(cellOf(e.x) - 24) <= 1) arrived = w.tick; }
      assert(arrived > 0 && w.br.spans[0].hp === HP1010 * 2, `blow: from five cells off the engineer walks up first (${arrived})`);
      const got = charges(w, 0, 600);
      assert.equal(got[0][0] - arrived, NEED - 1, 'blow: the first charge comes 120 steps from the step it arrived (as R1002)'); }
    // 斷的那一步
    const w = bare(MAP_RYE), t0 = w.tick;
    const e = put(w, ME, UK_ENGINEER, 24, 6), tank = put(w, FOE, UK_TANK, 24, 7, false), truck = put(w, FOE, UK_TRUCK, 24, 8, false), rider = put(w, FOE, UK_INFANTRY, 24, 8, false);
    rider.ride = truck.id;   // 夾具：eco 先不帶 tp（carry92 不跑，人才不會在停著的卡車上先下車），斷的那一步才打開
    const pass = put(w, FOE, UK_TANK, 24, 2, false);
    step(w, [fire(ME, [e.id], 24, 7)]);
    while (w.tick < t0 + 2 * NEED - 22) step(w, []);
    step(w, [{ t: 'move', side: FOE, ids: [pass.id], x: 24, z: 12 }]);
    assert(pass.path.some(c => RYE_SPANS[0].includes(c)), 'blow: setup: the passing tank plans over bridge 0');
    while (w.tick < t0 + 2 * NEED - 1) step(w, []);
    assert.equal(w.br.spans[0].state, 0, 'blow: setup: still standing one step before');
    w.eco.tp = 1;
    step(w, []);
    assert.equal(w.br.spans[0].state, 1, 'blow: the bridge broke');
    assert(RYE_SPANS[0].every(c => w.ter[c] === TER_MUD), 'blow: every cell of the broken bridge is mud again');
    const ev = w.events.filter(v => v.e === 'impact' && v.kind === SHELL_HE && v.bld === 0);
    assert(RYE_SPANS[0].every(c => ev.some(v => v.x === center(c % 32) && v.z === center((c - (c % 32)) / 32))), 'blow: one HE landing event per cell');
    assert.deepEqual(w.events.filter(v => v.e === 'bridge'), [{ e: 'bridge', span: 0 }], 'blow: one bridge event');
    assert(!tank.alive, 'blow: the tank on the bridge sinks');
    assert(!truck.alive && !rider.ride && rider.alive && rider.hp === UNIT_KINDS[UK_INFANTRY].hp - Math.floor((UNIT_KINDS[UK_INFANTRY].hp * BAIL92[0]) / 100), `blow: the truck sinks and its rider bails out as R092 (${rider.hp})`);
    assert.equal(pass.path[pass.path.length - 1], 12 * 32 + 24, 'blow: the tank that meant to cross keeps its destination');
    assert(!pass.path.some(c => RYE_SPANS[0].includes(c)) && pass.path.length > 0, 'blow: the tank that meant to cross has a new way at the end of the breaking step');
    assert.equal(e.order, ORD_IDLE, 'blow: the engineer stands down');
    assert(!findPath(w, 24, 4, 24, 12, 0, 0, UK_TANK).some(c => RYE_SPANS[0].includes(c)), 'blow: tanks no longer find a way over bridge 0');
    assert(findPath(w, 24, 4, 24, 12, 0, 0, UK_INFANTRY).some(c => RYE_SPANS[0].includes(c)), 'blow: an infantry section still wades through the gap');
    { const v = bare(MAP_RYE), f = put(v, ME, UK_ENGINEER, 24, 6), heavy = put(v, FOE, UK_HEAVY, 24, 7, false), truck2 = put(v, FOE, UK_TRUCK, 24, 8, false), gun = put(v, FOE, UK_HOWITZER, 24, 8, false), sec = put(v, FOE, UK_INFANTRY, 24, 7, false);
      gun.towBy = truck2.id;
      step(v, [fire(ME, [f.id], 24, 8)]);
      while (v.br.spans[0].state === 0 && v.tick < 1000) step(v, []);
      assert(!heavy.alive && !gun.alive, 'blow: a heavy tank and a towed gun on the bridge sink too');
      assert.equal(sec.hp, UNIT_KINDS[UK_INFANTRY].hp - 20, 'blow: an infantry section on the bridge loses 20'); }
    console.log('OK bridge1010/blow: 120/240 Rye, 480/240 Hythe, walks up first; the break: mud, events, sinks vehicles and towed guns, 20 to feet, riders bail, crossing tanks re-plan, engineer stands down');
  },
  // 驗收 5：最後一座車過得去的橋
  last() {
    { const w = bare(MAP_RYE); blowNow(w, 2, RYE_AT[2]);
      const e = put(w, ME, UK_ENGINEER, 24, 6), before = JSON.stringify(e);
      step(w, [fire(ME, [e.id], 24, 7)]);
      assert.equal(JSON.stringify({ ...e }), before, 'last: with bridge 2 down, the order on bridge 0 is not taken (order, path, countdown unchanged)');
      const g = put(w, ME, UK_ENGINEER, 26, 15);
      const got = charges(w, 1, 600, [fire(ME, [g.id], 27, 15)]);
      assert.equal(w.br.spans[1].state, 1, `last: bridge 1 (not between the headquarters) still blows (${got.length} charges)`); }
    { const w = bare(MAP_RYE), a = put(w, ME, UK_ENGINEER, 24, 6), b = put(w, ME, UK_ENGINEER, 6, 21);
      step(w, [fire(ME, [a.id], 24, 7), fire(ME, [b.id], 7, 21)]);
      for (let i = 0; i < 3 * NEED; i++) step(w, []);
      const st = w.br.spans.map(s => s.state);
      assert.deepEqual([st[0], st[2]], [1, 0], `last: blowing 0 and 2 together, the first one (lower id) goes (${st})`);
      assert.equal(w.br.spans[2].hp, HP1010 * 2 - DEMO_BLD, 'last: the other keeps 20: its last charge is never placed');
      assert.equal(b.order, ORD_IDLE, 'last: and its engineer stands down'); }
    { const w = bare(MAP_HYTHE), es = [0, 1, 2, 3].map(si => put(w, ME, UK_ENGINEER, ...HYTHE_AT[si]));
      step(w, es.map((e, si) => fire(ME, [e.id], ...at(w, si))));
      for (let i = 0; i < 5 * NEED && w.br.spans.slice(0, 4).some(s => s.state !== 1); i++) step(w, []);
      assert.deepEqual(w.br.spans.map(s => s.state), [1, 1, 1, 1, 0], 'last: Hythe: four bridges blown');
      const f = put(w, ME, UK_ENGINEER, ...HYTHE_AT[4]), before = JSON.stringify(f);
      step(w, [fire(ME, [f.id], ...at(w, 4))]);
      assert.equal(JSON.stringify({ ...f }), before, 'last: Hythe: the fifth is not taken'); }
    console.log('OK bridge1010/last: the last bridge between the headquarters is refused at the order and at the last charge; Tillingham always blows; Hythe keeps one of five');
  },
  // 驗收 6：修橋
  repair() {
    const broken = map => { const w = bare(map), si = map === MAP_RYE ? 0 : 2; blowNow(w, si, map === MAP_RYE ? RYE_AT[0] : HYTHE_AT[2]); w.units = []; return [w, si]; };
    for (const map of [MAP_RYE, MAP_HYTHE]) {
      const [w0, si] = broken(map), cells = w0.br.spans[si].cells.length, spot = map === MAP_RYE ? [[24, 6], [24, 9]] : [[65, 61], [64, 66]];
      { const w = structuredClone(w0), a = put(w, ME, UK_ENGINEER, ...spot[0]), b = put(w, ME, UK_ENGINEER, ...spot[1]), twin = structuredClone(w);
        step(twin, []); step(w, [fire(ME, [a.id, b.id], ...at(w, si))]);
        assert.equal(twin.eco.supply[ME] - w.eco.supply[ME], COST1010 * cells, `repair: map ${map}: one order with two engineers pays ${COST1010 * cells} once`);
        assert.equal(w.br.spans[si].left, WORK1010 * cells - 2, 'repair: the work is set (and both already did one step of it)');
        let n = 1; while (w.br.spans[si].state === 1 && n < 5000) { step(w, []); n++; }
        assert.equal(n, WORK1010 * cells / 2, `repair: map ${map}: two engineers take ${WORK1010 * cells / 2} steps (${n})`); }
      { const w = structuredClone(w0), a = put(w, ME, UK_ENGINEER, ...spot[0]);
        step(w, [fire(ME, [a.id], ...at(w, si))]);
        let n = 1; while (w.br.spans[si].state === 1 && n < 5000) { step(w, []); n++; }
        assert.equal(n, WORK1010 * cells, `repair: map ${map}: one engineer takes ${WORK1010 * cells} steps (${n})`);
        assert.deepEqual(w.events.filter(v => v.e === 'bridge'), [{ e: 'bridge', span: si }], `repair: map ${map}: the step the repair finishes carries one bridge event (the town mesh rebuilds on it)`);
        assert(w.br.spans[si].cells.every(c => w.ter[c] === TER_ROAD), 'repair: the cells are road again');
        assert.deepEqual([w.br.spans[si].state, w.br.spans[si].hp, a.order], [2, WOOD1010 * cells, ORD_IDLE], 'repair: a timber bridge with 10 per cell; the engineer stands down');
        const hp = w.br.spans[si].hp;
        for (let i = 0; i < 600; i++) step(w, []);
        assert.equal(w.br.spans[si].hp, hp, 'repair: nobody blows the new bridge in the next 600 steps');
        const [ax, az] = map === MAP_RYE ? [24, 4] : [66, 59], [bx, bz] = map === MAP_RYE ? [24, 12] : [62, 68];
        assert(findPath(w, ax, az, bx, bz, 0, 0, UK_TANK).some(c => w.br.spans[si].cells.includes(c)), 'repair: tanks drive over the repaired bridge'); }
    }
    const [w0] = broken(MAP_RYE);
    { const w = structuredClone(w0), a = put(w, ME, UK_ENGINEER, 24, 6); w.eco.supply[ME] = COST1010 * 2 - 1; const before = JSON.stringify(a);
      step(w, [fire(ME, [a.id], 24, 7)]);
      assert.deepEqual([JSON.stringify({ ...a }), w.br.spans[0].left], [before, 0], 'repair: short of supply the order is not taken');
      assert(w.eco.supply[ME] >= COST1010 * 2 - 1, 'repair: and no supply is taken'); }
    { const w = structuredClone(w0), a = put(w, ME, UK_ENGINEER, 24, 6), foe = put(w, FOE, UK_ENGINEER, 24, 9);
      step(w, [fire(ME, [a.id], 24, 7)]);
      for (let i = 0; i < 100; i++) step(w, []);
      step(w, [{ t: 'move', side: ME, ids: [a.id], x: 24, z: 2 }]);
      const left = w.br.spans[0].left;
      for (let i = 0; i < 100; i++) step(w, []);
      assert.equal(w.br.spans[0].left, left, 'repair: the engineer walks off; the work stays');
      const twin = structuredClone(w); step(twin, []); step(w, [fire(FOE, [foe.id], 24, 8)]);
      assert.equal(twin.eco.supply[FOE], w.eco.supply[FOE], 'repair: the other side carries on without paying again');
      for (let i = 0; i < 1000 && w.br.spans[0].state === 1; i++) step(w, []);
      assert.equal(w.br.spans[0].state, 2, 'repair: the other side finishes it'); }
    { const w = structuredClone(w0), a = put(w, ME, UK_ENGINEER, 24, 6);
      step(w, [fire(ME, [a.id], 24, 7)]);
      while (w.br.spans[0].state === 1) step(w, []);
      const t0 = w.tick, got = charges(w, 0, 600, [fire(ME, [a.id], 24, 7)]);
      assert.deepEqual(got, [[t0 + NEED, WOOD1010 * 2]], 'repair: a timber bridge goes with one charge (120 steps)'); }
    console.log('OK bridge1010/repair: pays 10/30 once per bridge; 400/200 Rye, 1200/600 Hythe; timber bridge; work survives walking off; the other side carries on free; one charge breaks it');
  },
  // 驗收 7：偽造
  forged() {
    const w0 = bare(MAP_RYE), e = put(w0, ME, UK_ENGINEER, 24, 6), tank = put(w0, ME, UK_TANK, 24, 4), sec = put(w0, ME, UK_INFANTRY, 24, 5);
    { const a = structuredClone(w0), b = structuredClone(w0); step(a, [fire(FOE, [e.id], 24, 7)]); step(b, []); for (let i = 0; i < 300; i++) { step(a, []); step(b, []); }
      assert.equal(hashWorld(a), hashWorld(b), 'forged: side 1 ordering our engineer changes nothing'); }
    { const a = structuredClone(w0); step(a, [fire(ME, [tank.id + 0, sec.id + 0], 24, 7)]);
      assert.deepEqual([a.units[tank.id - 1].order, a.units[sec.id - 1].order], [ORD_IDLE, ORD_IDLE], 'forged: a tank and a section do not take a fire order on a bridge (as main)');
      for (let i = 0; i < 300; i++) step(a, []);
      assert.equal(a.br.spans[0].hp, HP1010 * 2, 'forged: and the bridge keeps its hp'); }
    { const a = structuredClone(w0), h = put(a, ME, UK_HOWITZER, 24, 20); a.units[e.id - 1].alive = false; a.units[tank.id - 1].alive = false; a.units[sec.id - 1].alive = false;
      step(a, [fire(ME, [h.id], 24, 7)]);
      for (let i = 0; i < 1200; i++) step(a, []);
      const craters = [...a.crater.keys()].filter(i => a.crater[i] > 0);
      assert(craters.length > 0 && a.br.spans[0].hp === HP1010 * 2 && a.br.spans[0].state === 0, `forged: howitzer fire on the bridge digs craters (${craters.length}) but the bridge keeps its hp`); }
    { const a = structuredClone(w0), truck = put(a, ME, UK_TRUCK, 25, 5); a.units[e.id - 1].ride = truck.id; const before = JSON.stringify(a.units[e.id - 1]);
      step(a, [fire(ME, [e.id], 24, 7)]);
      assert.equal(JSON.stringify(a.units[e.id - 1]), before, 'forged: an engineer riding a truck does not take it'); }
    for (const [x, z] of [[-5, -5], [1e9, 1e9], [1.5, 7.5], [24.5, 7.5]]) { const a = structuredClone(w0); step(a, [fire(ME, [e.id], x, z)]); for (let i = 0; i < 20; i++) step(a, []); }
    { const w = createWorld(1); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, end: 1, sw: 2 }, ecoBr()]); assert.equal(w.br, undefined, 'forged: two eco at step 0, the first without br: no w.br'); }
    assert(isCommand({ t: 'eco', br: 1 }) && !isCommand({ t: 'eco', br: 1.5 }), 'forged: isCommand takes br 1 and refuses 1.5');
    // 1,000 條亂下的射擊指令（守衛自己的線性同餘亂數）
    const w = opened(MAP_RYE, 3, ecoBr(), { sym: 1 }, AIS.slice(1));
    for (let i = 0; i < 6; i++) put(w, i & 1, UK_ENGINEER, 20 + i, 10 + i);
    let r = 12345;
    const rnd = m => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r % m; };
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      const cells = w.br.spans.flatMap(s => s.cells), c = cells[rnd(cells.length)], ids = [1 + rnd(w.units.length + 3), 1 + rnd(w.units.length)];
      const cmd = rnd(4) ? fire(rnd(2), ids, c % 32 + rnd(3) - 1, ((c - (c % 32)) / 32) + rnd(3) - 1) : fire(rnd(2), ids, rnd(40) - 4, rnd(40) - 4);
      step(w, [cmd]);
      const wet = vehicleInWater(w);
      assert(!wet, `forged: after ${i + 1} random orders no vehicle stands in water (${wet?.id})`);
    }
    console.log(`OK bridge1010/forged: side and ownership checks, other kinds as main, shells do not hurt bridges, riders refuse, odd coordinates, late or second eco; 1,000 random orders in ${Date.now() - t0} ms (only recorded)`);
  },
  // 驗收 8：R050 的工地不能蓋在水上（R1004 的「泥地不能蓋」）
  tech() {
    const w = bare(MAP_HYTHE, 1, ecoBr({ tech: 1 })), e = put(w, ME, UK_ENGINEER, 108, 15), hq = w.blds[w.eco.hq[ME] - 1];
    hq.x = 110; hq.z = 12;   // 夾具：把指揮部的佔地搬到橋旁（why50 只拿它量距離）；橋旁那幾格的房子從佔地表拿掉（「要跟建築隔一格」不擋在前面）
    for (let z = 15; z < 26; z++) for (let x = 100; x < 110; x++) w.occ[z * 128 + x] = 0;
    const why = (x, z) => why50(w, ME, BK_SUPPLY, { x, z, ids: [e.id] });
    assert.equal(why(106, 19), '擋到了', 'tech: a 2×2 on the intact bridge is road');
    assert.equal(why(104, 21), '泥地不能蓋', 'tech: a 2×2 on the canal is mud');
    blowNow(w, 0, [107, 17]);
    assert.equal(why(106, 19), '泥地不能蓋', 'tech: a 2×2 on the broken bridge is mud');
    const n0 = w.blds.length; step(w, [{ t: 'construct', side: ME, ids: [e.id], kind: BK_SUPPLY, x: 106, z: 19 }]);
    assert.equal(w.blds.length, n0, 'tech: construct on the broken bridge is not taken');
    const g = put(w, ME, UK_ENGINEER, 107, 17); step(w, [fire(ME, [g.id], 107, 18)]); while (w.br.spans[0].state === 1) step(w, []);
    assert.equal(why(106, 19), '擋到了', 'tech: a 2×2 on the timber bridge is road');
    for (const map of [MAP_RYE, MAP_HYTHE]) for (const seed of [1, 2, 3]) {
      const v = opened(map, seed, ecoBr({ tech: 1 }));
      for (const side of [ME, FOE]) { const h = v.blds[v.eco.hq[side] - 1]; for (const c of v.br.spans.flatMap(s => s.cells)) { const [x, z] = xz(v, c); assert(Math.max(Math.max(h.x - x, 0, x - (h.x + h.w - 1)), Math.max(h.z - z, 0, z - (h.z + h.d - 1))) > RANGE50, `tech: map ${map} seed ${seed}: bridge cell (${x},${z}) is more than ${RANGE50} from headquarters ${side}`); } }
    }
    assert.equal(createHash('sha256').update(src('src/sim/tech50.ts')).digest('hex'), '88dcefbcad57bc95674648f356ab098a05539f6f6e1c9e200b4c519e1b89a8b9', 'tech: src/sim/tech50.ts is byte for byte the R1004 version (c31548b)');
    console.log('OK bridge1010/tech: canal and broken bridge are 泥地不能蓋, intact and timber bridge 擋到了; every bridge is out of RANGE50; tech50.ts untouched');
  },
  // 驗收 9：存檔
  codec() {
    const make = kind => {
      const w = bare(MAP_RYE); put(w, ME, UK_TANK, 26, 26);
      if (kind === 'half') { blowNow(w, 0, RYE_AT[0]); const e = put(w, ME, UK_ENGINEER, 24, 9); step(w, [fire(ME, [e.id], 24, 8)]); for (let i = 0; i < 150; i++) step(w, []); assert(w.br.spans[0].left > 0 && w.br.spans[0].state === 1, 'codec: setup: half repaired'); }
      if (kind === 'wood') { blowNow(w, 1, RYE_AT[1]); const e = put(w, ME, UK_ENGINEER, 26, 15); step(w, [fire(ME, [e.id], 27, 15)]); while (w.br.spans[1].state === 1) step(w, []); }
      for (let i = 0; i < 10; i++) step(w, []);
      return w;
    };
    const has = (o, d = 0) => d < 8 && o && typeof o === 'object' && (ArrayBuffer.isView(o) || Object.values(o).some(v => has(v, d + 1)));
    for (const kind of ['intact', 'half', 'wood']) {
      const w = make(kind), enc = encodeWorld(w);
      assert(Array.isArray(enc.br.wet) && enc.br.wet.length < w.br.wet.length && !has(enc), `codec: ${kind}: br.wet is packed and the encoding has no typed arrays`);
      const back = decodeWorld(JSON.parse(JSON.stringify(enc)));
      assert(back && hashWorld(back) === hashWorld(w), `codec: ${kind}: decode gives the same hash`);
      for (let i = 0; i < 600; i++) { step(w, []); step(back, []); }
      assert.equal(hashWorld(back), hashWorld(w), `codec: ${kind}: 600 more steps stay equal`);
    }
    const base = make('half'), bad = (label, f) => { const v = structuredClone(base); f(v); assert.equal(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(v)))), null, `codec: refuses ${label}`); };
    assert(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(base)))), 'codec: the base save loads');
    bad('br with sw 1', v => { v.eco.sw = 1; v.units = v.units.filter(u => u.kind !== UK_ENGINEER).map((u, i) => ({ ...u, id: i + 1 })); });
    bad('br on map 2', v => { v.map = 2; });
    bad('a mask missing a cell', v => { v.br.wet[9 * 32 + 7] = 0; });
    bad('a mask with an extra cell', v => { v.br.wet[0] = 1; });
    bad('a bridge with the wrong cells', v => { v.br.spans[1].cells = [507, 539]; });
    bad('state 3', v => { v.br.spans[1].state = 3; });
    bad('hp out of range', v => { v.br.spans[1].hp = HP1010 * 2 + 1; });
    bad('left out of range', v => { v.br.spans[0].left = WORK1010 * 2 + 1; });
    bad('a broken bridge cell that is road', v => { v.ter[RYE_SPANS[0][0]] = TER_ROAD; });
    bad('an intact bridge cell that is mud', v => { v.ter[RYE_SPANS[1][0]] = TER_MUD; });
    bad('a masked cell (not a bridge) that is grass', v => { v.ter[9 * 32 + 7] = TER_GRASS; });
    console.log('OK bridge1010/codec: intact, half repaired and timber saves round-trip (hash and 600 steps); 11 kinds of bad save refused');
  },
  // 驗收 10：重播（炸、修、炸木橋，電腦開著）
  replay() {
    const log = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: ecoBr() }, { tick: 0, cmd: { t: 'ai', side: FOE, level: 1, v: 3 } }];   // 簡單的電腦：難一點的會在 3,000 步內把兩個工兵都打掉
    const w = createWorld(11), seen = { blew: 0, fixed: 0, wood: 0 };
    runLog(w, log, 1);
    const issue = cmd => { log.push({ tick: w.tick, cmd }); return cmd; };
    let save = null;
    while (w.tick < 3000) {
      const now = [], mine = w.units.filter(u => u.alive && u.side === ME && u.kind === UK_ENGINEER && !u.ride), s = w.br.spans[1];
      if (w.tick === 1 || w.tick === 2 || (w.tick % 400 === 0 && mine.length < 2 && !w.eco.queue[ME].length)) now.push(issue({ t: 'produce', side: ME, kind: UK_ENGINEER }));
      const idle = mine.filter(u => u.order === ORD_IDLE);
      if (idle.length && w.tick % 20 === 0 && (s.state !== 1 || w.eco.supply[ME] >= COST1010 * 2)) now.push(issue(fire(ME, idle.map(u => u.id), 27, 15)));
      if (w.tick === 1000) save = JSON.stringify(encodeWorld(w));
      const before = s.state;
      step(w, now);
      if (before !== s.state) { if (s.state === 1 && before === 0) seen.blew = w.tick; else if (s.state === 2) seen.fixed = w.tick; else if (s.state === 1 && before === 2) seen.wood = w.tick; }
    }
    assert(seen.blew && seen.fixed && seen.wood, `replay: the log blows, repairs and blows the timber bridge (${JSON.stringify(seen)})`);
    const a = runLog(createWorld(11), log, 3000), b = runLog(createWorld(11), JSON.parse(JSON.stringify(log)), 3000);
    assert.equal(hashWorld(a), hashWorld(w), 'replay: replaying the log gives the played hash');
    assert.equal(hashWorld(b), hashWorld(a), 'replay: twice the same');
    const back = decodeWorld(JSON.parse(save));
    assert(back, 'replay: the step-1000 save loads');
    runLog(back, log.filter(e => e.tick >= 1000), 3000);
    assert.equal(hashWorld(back), hashWorld(w), 'replay: save at 1000, load, run on to 3000: same hash');
    console.log(`OK bridge1010/replay: blew at ${seen.blew}, repaired at ${seen.fixed}, timber blown at ${seen.wood}; replays and save/load agree at 3000 (${hashWorld(w)})`);
  },
  // 驗收 11：別的地圖帶 br＝跟不帶一樣
  quiet() {
    for (const map of [0, MAP_LARGE, MAP_TOWN, MAP_HILLS]) {
      const run = br => { const w = createWorld(41 + map); step(w, [{ t: 'map', id: map, vegetation: 1 }, { ...ECO, end: 1, sw: 2, ...(br ? { br: 1 } : {}) }, ...AIS]); const h = []; while (w.tick < 3000 && w.winner < 0) { step(w, []); if (w.tick % 100 === 0) h.push(hashWorld(w)); } h.push(`end ${w.tick}`); return h; };
      assert.deepEqual(run(1), run(0), `quiet: map ${map}: br changes no hash in 3,000 steps of computer against computer`);
    }
    console.log('OK bridge1010/quiet: maps 0, 2, 3, 4 with br hash exactly as without (3,000 steps, every 100)');
  },
  // 驗收 12：閥關＝雜湊不變（動手前在 c31548b＝R1004 合併之後的那一份量好、寫死）
  hash() {
    const PIN = {
      rye: ["ac6eccba","aadd9ca2","c0352c5a","9be8d012","2518e777","5f1951a5","ddcb960d","99fcbd04","61767fe4","0d828734","c79b85ac","52a780c6","25de3ed9","41155d8d","3ec3f3e6","8ad5a3af","dbdb1035","0fca6010","eee13d84","3b18bd34","e3dab45e","fe78ce6f","55095ee4","0dbbacd0","833ff488","9f5431f0","9d5c37d8","87cd292e","f2ae1fcc","f7196f3f","end 3000"],
      hythe: ["63cb2795","42d30e1a","75823451","dbfb46af","b7349819","27743b49","f17a020b","152e1e82","086d1166","d51f332c","acd528eb","0cf5ff78","f2a86d17","4973dac1","1915ac58","256a03ef","cbc4056a","9ed9f1a2","6730b4e2","99a20004","1a21bb95","389820f7","37b52e3c","a5c029b6","911f69ae","f6d618f9","0ce540d7","d37a6b17","abbaa858","61eae7da","end 3000"],
      ryeTech: ["54aee21f","a5b93997","b10b76b7","e2cccd07","b6488f22","98676bb8","f66253b6","a2d11790","9c707d19","38aab276","9bcbc5d2","8d0f21a7","45edf793","3f516f2a","30ec3f68","c7d06535","17d67986","d4ecb061","80afbdf4","8cc230ea","0b7f5b73","43fd31b9","818c82fe","e9bad9cd","f517f4b8","db8384fb","14ce548c","end 2700"],
    };
    const S = {
      rye: () => { const w = createWorld(31); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, end: 1, sw: 2 }, ...AIS]); return w; },
      hythe: () => { const w = createWorld(32); step(w, [{ t: 'map', id: 5, vegetation: 1 }, { ...ECO, end: 1, sw: 2 }, ...AIS]); return w; },
      ryeTech: () => { const w = createWorld(33); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, end: 1, sw: 2, tech: 1 }, ...AIS]); return w; },
    };
    for (const [name, make] of Object.entries(S)) {
      const w = make(), h = [];
      while (w.tick < 3000 && w.winner < 0) { step(w, []); if (w.tick % 100 === 0) h.push(hashWorld(w)); }
      h.push(`end ${w.tick}`);
      assert.deepEqual(h, PIN[name], `hash: ${name} without br hashes exactly as c31548b (every 100 steps)`);
    }
    console.log('OK bridge1010/hash: Rye, Hythe (sw 2) and Rye with tech, computer against computer 3,000 steps without br: every 100th hash equals c31548b');
  },
  // 驗收 13：電腦對電腦（帶 br）
  aivai() {
    const rows = [];
    for (const [map, seed] of [[MAP_RYE, 1], [MAP_RYE, 2], [MAP_RYE, 3], [MAP_RYE, 4], [MAP_HYTHE, 1], [MAP_HYTHE, 2]]) {
      const res = {};
      for (const br of [1, 0]) {
        const w = createWorld(seed);
        step(w, [{ t: 'map', id: map, vegetation: 1 }, { ...ECO, end: 1, sw: 2, ...(br ? { br: 1 } : {}) }, ...AIS]);
        const deck = new Set(w.br?.spans.flatMap(s => s.cells) ?? []), over = new Set(), link = br ? linked1010(w) : null;
        while (w.tick < 4000 && w.winner < 0) {
          step(w, []);
          if (!br) continue;
          const wet = vehicleInWater(w);
          assert(!wet, `aivai: map ${map} seed ${seed}: no vehicle stands in water (step ${w.tick}, unit ${wet?.id})`);
          for (const u of w.units) if (u.alive && !u.ride && UNIT_KINDS[u.kind].radius > 0 && deck.has(cellOf(u.z) * w.n + cellOf(u.x))) over.add(u.id);
        }
        if (br) assert(over.size > 0, `aivai: map ${map} seed ${seed}: at least one vehicle drove over a bridge`);
        res[br] = { winner: w.winner, ticks: w.tick, over: over.size, link };
      }
      rows.push(`map ${map} seed ${seed}: br winner ${res[1].winner} at ${res[1].ticks} (headquarters linked at start: ${res[1].link}; ${res[1].over} vehicles crossed a bridge) | no br winner ${res[0].winner} at ${res[0].ticks}`);
    }
    for (const r of rows) console.log(`  ${r}`);
    console.log('OK bridge1010/aivai: Rye 1–4, Hythe 1–2 with br: no exceptions, no vehicle in water, every game crosses a bridge (results printed, not a threshold)');
  },
  // 驗收 14：介面路由
  route() {
    const w = bare(MAP_RYE), eng = put(w, ME, UK_ENGINEER, 25, 4), how = put(w, ME, UK_HOWITZER, 26, 26), tank = put(w, ME, UK_TANK, 22, 4);
    const tap = (x, z) => ({ unit: 0, building: null, ground: { x: x + 0.5, z: z + 0.5 } });
    const go = (sel, fireMode, x, z) => routeBattleOrder(w, new Set(sel), fireMode, 'he', tap(x, z));
    const plain = (sel, fireMode, x, z) => { const br = w.br; delete w.br; try { return go(sel, fireMode, x, z); } finally { w.br = br; } };
    const cmds = r => r?.commands.map(c => JSON.stringify(c)) ?? null;
    hint50(w);
    const states = [['intact', () => {}], ['timber', () => { w.br.spans[1].state = 2; w.br.spans[1].hp = 20; }]];
    for (const [label, set] of states) {
      set();
      const [x, z] = label === 'intact' ? [24, 7] : [27, 15];
      assert.deepEqual(cmds(go([eng.id, tank.id], true, x, z)), [JSON.stringify(fire(ME, [eng.id], x, z))], `route: ${label}, fire mode, engineer + tank: only the engineer gets the fire order`);
      assert.match(hint50(w) ?? '', /工兵去炸橋：要放 \d 包炸藥/, `route: ${label}: the hint says how many charges`);
      assert.deepEqual(cmds(go([eng.id, how.id], true, x, z)), [JSON.stringify(fire(ME, [eng.id], x, z)), JSON.stringify(fire(ME, [how.id], x, z))], `route: ${label}, fire mode, engineer + howitzer: both fire at the cell`);
      assert.deepEqual(cmds(go([how.id, tank.id], true, x, z)), cmds(plain([how.id, tank.id], true, x, z)), `route: ${label}, fire mode, no engineer: as main`);
      assert.deepEqual(cmds(go([eng.id, tank.id], false, x, z)), cmds(plain([eng.id, tank.id], false, x, z)), `route: ${label}, fire mode off, engineer: moves as main`);
      assert.equal(hint50(w), HOW1010, `route: ${label}, fire mode off with an engineer: the hint says how to blow it`);
      assert.deepEqual(cmds(go([tank.id], false, x, z)), cmds(plain([tank.id], false, x, z)), `route: ${label}, fire mode off, no engineer: as main`);
    }
    w.br.spans[1].state = 0; w.br.spans[1].hp = 80;
    // 斷橋
    blowNow(w, 0, [23, 6]); w.units[w.units.length - 1].alive = false;
    for (const fm of [true, false]) {
      assert.deepEqual(cmds(go([eng.id], fm, 24, 7)), [JSON.stringify(fire(ME, [eng.id], 24, 7))], `route: broken, fire mode ${fm}: the engineer repairs`);
      assert.deepEqual(cmds(go([how.id, tank.id], fm, 24, 7)), cmds(plain([how.id, tank.id], fm, 24, 7)), `route: broken, fire mode ${fm}, no engineer: as main`);
    }
    assert.deepEqual(cmds(go([eng.id, how.id], true, 24, 7)), [JSON.stringify(fire(ME, [eng.id], 24, 7)), JSON.stringify(fire(ME, [how.id], 24, 7))], 'route: broken, fire mode, engineer + howitzer: the engineer repairs, the howitzer fires at the cell');
    assert.deepEqual(cmds(go([eng.id, tank.id], false, 24, 7)), [JSON.stringify(fire(ME, [eng.id], 24, 7)), JSON.stringify({ t: 'move', side: ME, ids: [tank.id], x: 24, z: 7 })], 'route: broken, fire mode off, engineer + tank: repair and the tank moves as before');
    assert.match(hint50(w) ?? '', /工兵去修橋：扣 10 補給/, 'route: the hint says what the repair costs');
    // 被拒
    w.eco.supply[ME] = 3;
    assert.equal(go([eng.id], true, 24, 7), null, 'route: short of supply nothing is sent');
    assert.equal(hint50(w), '補給不足，還差 7', 'route: and the hint says why');
    w.eco.supply[ME] = 500;
    { const v = bare(MAP_RYE), e = put(v, ME, UK_ENGINEER, 25, 4); blowNow(v, 2, RYE_AT[2]);
      assert.equal(routeBattleOrder(v, new Set([e.id]), true, 'he', tap(24, 7)), null, 'route: the last bridge: nothing is sent');
      assert.equal(hint50(v), '這是兩邊之間最後一座車過得去的橋，不能炸', 'route: and the hint says it is the last one'); }
    { const v = opened(MAP_RYE, 1, { ...ECO, end: 1, sw: 2 }); v.units = []; v.eco.supply = [500, 500]; const e = put(v, ME, UK_ENGINEER, 25, 4);
      const r = routeBattleOrder(v, new Set([e.id]), true, 'he', tap(24, 7));
      assert.deepEqual(cmds(r), [JSON.stringify({ t: 'move', side: ME, ids: [e.id], x: 24, z: 7 })], 'route: without w.br an engineer tapping the bridge moves (as main)');
      assert.equal(hint50(v), undefined, 'route: without w.br hint50 stays undefined'); }
    console.log('OK bridge1010/route: every row of the card table, refusals with reasons, how-to hint, no-br worlds as main');
  },
  // 驗收 15：接線、小地圖
  ui() {
    const main = src('src/main.ts'), battle = src('src/render/battle.ts'), cdp = src('tools/cdp.mjs'), hud = src('src/ui/hud.ts'), valves = src('src/valves.ts');
    assert(valves.includes("get r1010() { return on('1010'); }"), 'ui: valves has r1010');
    assert(main.includes("sw1002({ t: 'eco', ...(V.r1010 && V.r1002 && V.r091 ? { br: 1 } : {}), "), 'ui: a new battle sends br 1 only with R1010, R1002 and R091 on');
    assert(main.split('\n').length - 1 <= 672 && battle.split('\n').length - 1 <= 1195, 'ui: hub budgets hold');
    assert(cdp.includes("const full1010 = /(^|&)noR1010=/.test(full50) ? full50 : `${full50 ? full50 + '&' : ''}noR1010=1`;") && cdp.includes('? full1010 : `${full1010 ?'), 'ui: tools/cdp.mjs opens pages with noR1010=1 unless a guard asks for R1010');
    assert(hud.split('\n').filter(l => /^import /.test(l)).every(l => l.startsWith('import type ')), 'ui: src/ui/hud.ts still has only type imports');
    // 小地圖（tests/minimap90.mjs 那一套假畫布）
    const canvases = [];
    class Ctx { constructor() { this.log = []; this.path = []; this.fillStyle = '#000'; } beginPath() { this.path = []; } moveTo(x, y) { this.path.push(x, y); } lineTo(x, y) { this.path.push(x, y); } closePath() {} fill() { this.log.push(`f${this.fillStyle}`); } stroke() {} fillRect() { this.log.push(`r${this.fillStyle}`); } clearRect() { this.log.push('clear'); } setTransform() {} drawImage() {} save() {} restore() {} arc() {} ellipse() {} rect() {} clip() {} setLineDash() {} createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; } putImageData() {} }
    class El { constructor(tag) { this.tag = tag; this.style = {}; this.width = 0; this.height = 0; if (tag === 'canvas') { this.ctx = new Ctx(); canvases.push(this); } } getContext() { return this.ctx; } appendChild() {} addEventListener() {} setAttribute() {} getBoundingClientRect() { return { left: 0, top: 0, width: 150, height: 75 }; } }
    const saved = { document: globalThis.document, innerWidth: globalThis.innerWidth, devicePixelRatio: globalThis.devicePixelRatio };
    Object.assign(globalThis, { document: { createElement: t => new El(t), getElementById: () => null, body: new El('body') }, innerWidth: 412, innerHeight: 860, devicePixelRatio: 2 });
    try {
      const w = bare(MAP_RYE); canvases.length = 0;
      const mini = initMinimap({ world: () => w, visible: () => true, view: () => [], tap: () => {} }), base = canvases[1].ctx;
      const mud = () => base.log.slice(base.log.lastIndexOf('clear')).filter(op => op === 'f#4d6470').length, clears = () => base.log.filter(op => op === 'clear').length;
      mini.frame(1);
      const mud0 = mud(), c0 = clears();
      blowNow(w, 0, RYE_AT[0]);
      mini.frame(200);
      assert.deepEqual([clears(), mud()], [c0 + 1, mud0 + 2], 'ui: after bridge 0 breaks the next frame repaints the minimap base with two more mud cells');
      const e = put(w, ME, UK_ENGINEER, 24, 6); step(w, [fire(ME, [e.id], 24, 7)]); while (w.br.spans[0].state === 1) step(w, []);
      mini.frame(400);
      assert.deepEqual([clears(), mud()], [c0 + 2, mud0], 'ui: after the repair it repaints again with road');
      const v = opened(MAP_RYE, 1, { ...ECO, end: 1, sw: 2 }); canvases.length = 0;
      const m2 = initMinimap({ world: () => v, visible: () => true, view: () => [], tap: () => {} }), b2 = canvases[1].ctx;
      for (let t = 0; t < 600; t++) { step(v, []); m2.frame(1 + t * 120); }
      assert.equal(b2.log.filter(op => op === 'clear').length, 1, 'ui: a world without br paints the minimap base once in 600 steps (as main)');
    } finally { Object.assign(globalThis, saved); }
    console.log('OK bridge1010/ui: valve, eco flag, budgets, cdp default, hud untouched; minimap repaints on break and repair only');
  },
  // 驗收 24、25 的 Node 那一半（瀏覽器那一半在 tests/bridge1010-browser.mjs）：斷橋、木橋畫進城鎮網格的三角形；skip（海斯的區域城鎮）
  async art() {
    const { buildTown } = await import('../src/render/buildings.ts');
    const setState = (w, si, state) => { const s = w.br.spans[si]; s.state = state; s.hp = state === 1 ? 0 : state === 2 ? WOOD1010 * s.cells.length : HP1010 * s.cells.length; s.left = 0; for (const c of s.cells) w.ter[c] = state === 1 ? TER_MUD : TER_ROAD; };   // 夾具：只給畫面用
    const tris = (w, skip) => buildTown(w, skip).triangles;
    const rye = opened(MAP_RYE), plain = opened(MAP_RYE, 1, { ...ECO, end: 1, sw: 2 }), base = tris(rye);
    assert.equal(base, tris(plain), 'art: intact bridges add no triangle (the town of a br world equals the one without)');
    const per = [];
    for (const [si, st] of [[0, 1], [1, 1], [2, 2]]) { const w = structuredClone(rye); setState(w, si, st); per.push(tris(w) - base); }
    assert(per.every(t => t > 0 && t <= 250), `art: each broken or timber Rye bridge adds 1–250 triangles (${per})`);
    const mixed = structuredClone(rye); setState(mixed, 0, 1); setState(mixed, 1, 1); setState(mixed, 2, 2);
    const ryeExtra = tris(mixed) - base;
    assert(ryeExtra > 0 && 2 * ryeExtra <= 1000, `art: Rye broken, broken, timber adds ${ryeExtra} (two passes ${2 * ryeExtra} ≤ 1,000)`);
    const hy = opened(MAP_HYTHE), hyBase = tris(hy), got = {};
    for (const st of [1, 2]) {
      const w = structuredClone(hy); for (let si = 0; si < 5; si++) setState(w, si, st);
      const extra = tris(w) - hyBase; got[st] = extra;
      assert(extra > 0 && 2 * extra <= 2500, `art: Hythe, all five ${st === 1 ? 'broken' : 'timber'}: +${extra} (two passes ${2 * extra} ≤ 2,500)`);
      for (let si = 0; si < 5; si++) { const v = structuredClone(hy); setState(v, si, st); const one = tris(v) - hyBase; assert(one > 0 && one <= 250, `art: Hythe bridge ${si} ${st === 1 ? 'broken' : 'timber'} adds 1–250 (${one})`); }
      assert.equal(tris(w, () => true), tris(hy, () => true), 'art: a skip that leaves every building out leaves the bridges out too (Hythe region town)');
      const far = b => b.x + b.w < 60;   // 只看左半邊的區域：右半邊的橋（0、1、2）不算
      const left = tris(w, far) - tris(hy, far), want = [3, 4].reduce((t, si) => { const v = structuredClone(hy); setState(v, si, st); return t + tris(v) - hyBase; }, 0);
      assert.equal(left, [0, 1, 2].reduce((t, si) => { const v = structuredClone(hy); setState(v, si, st); return t + tris(v) - hyBase; }, 0), `art: a region skip draws only the bridges inside it (${left}, others ${want})`);
    }
    // 木橋面不能蓋住站在橋上的單位：隊色圓盤畫在 unitHeight(u) + 0.012（選取圈、移動標記、射程圈都更高），橋面在格中心那一塊（選取圈外緣半徑 0.37）的頂要比圓盤低
    // （審查：0.06 的橋面把橋上單位的圓盤、選取圈整個蓋掉；欄杆、柱子在格邊上，不在這一塊）
    const { bridge1010Art } = await import('../src/render/bridge1010.ts');
    const discY = Number(src('src/render/battle.ts').match(/m\.position\.set\(x, this\.unitHeight\(u\) \+ (0\.\d+), z\); m\.rotation\.set\(0, 0, 0\)/)?.[1]);
    assert(discY > 0 && discY < 0.05, `art: fixture: battle.ts draws the team disc at unitHeight + ${discY}`);
    let decks = 0;
    for (const [w0, si] of [[rye, 0], [rye, 1], [rye, 2], [hy, 2]]) {
      const w = structuredClone(w0); setState(w, si, 2);
      const boxes = []; bridge1010Art({ box: (...a) => boxes.push(a) }, w);
      for (const c of w.br.spans[si].cells) {
        const [x, z] = xz(w, c), over = boxes.filter(([ax, , az, bx, , bz]) => ax < x + 0.87 && bx > x + 0.13 && az < z + 0.87 && bz > z + 0.13);
        assert(over.length > 0 && over.every(b => b[4] < discY), `art: a timber deck stays below the team disc and selection ring of a unit standing on it (map ${w.n} bridge ${si} cell ${x},${z}: tops ${over.map(b => b[4])}, disc ${discY})`);
        decks++;
      }
    }
    console.log(`OK bridge1010/art: intact adds nothing; Rye per bridge ${per}, mixed +${ryeExtra}; Hythe all broken +${got[1]}, all timber +${got[2]}; skip respected; ${decks} timber deck cells stay below the team disc (${discY})`);
  },
  // 驗收 16：模擬層純度
  purity() {
    const s = src('src/sim/bridge1010.ts'), code = s.replace(/\/\/[^\n]*/g, '');
    assert(!/\d\.\d/.test(code) && !code.includes('**') && !/Math\.random|Date|performance/.test(code), 'purity: no floats, **, random or clocks in src/sim/bridge1010.ts');
    assert([...code.matchAll(/from '([^']+)'/g)].every(m => /^\.\/[\w-]+\.ts$/.test(m[1])), 'purity: src/sim/bridge1010.ts imports only ./x.ts');
    console.log('OK bridge1010/purity: integers only, sim-local imports');
  },
  // 驗收 17：紅線
  redline() {
    const text = ['src/sim/bridge1010.ts', 'src/ui/bridge1010.ts', 'src/render/bridge1010.ts'].map(src).join('\n');
    const bad = ['德軍', '德國', '英軍', '納粹', '皇家工兵', '黨衛', 'Wehrmacht', 'Pionier', 'Royal Engineers', 'German', 'Nazi', '卐', '徽章'].filter(word => text.includes(word));
    if (/\bSS\b/.test(text)) bad.push('SS');
    assert.deepEqual(bad, [], `redline: no nationality, unit or insignia in the R1010 files (${bad})`);
    console.log('OK bridge1010/redline: no nationality, unit designation or insignia in the three new files');
  },
};

const only = process.argv[2];
if (only && !groups[only]) { console.error(`unknown group ${only}`); process.exit(2); }
for (const [name, fn] of Object.entries(groups)) if (!only || only === name) await fn();
console.log(only ? `bridge1010/${only}: OK` : 'bridge1010: all OK');
