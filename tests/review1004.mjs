// R1004 獨立審查 R1002、R050、R1003 之後的修補（卡面 docs/tasks/R1004-審查R1002與R050.md）：驗收 1–5。
// RECORD=1 node tests/review1004.mjs notech 印出沒有 tech 的局的雜湊（要在改之前的 main 上跑）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, ORD_FIRE_AT, SIDE_PLAYER as ME, SIDE_ENEMY as FOE,
  BK_HQ, BK_PILLBOX, BK_HOUSE, BK_BARRACKS, BK_SUPPLY, UK_ENGINEER, UK_TANK, UK_INFANTRY, UK_TRUCK, UK_ATGUN, UK_OBSERVER, TER_MUD, STAGE_INTACT, STAGE_ROOFLESS, bldMaxHp, bldAt, stageOf,
} from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { why50 } from '../src/sim/tech50.ts';
import { routeBattleOrder } from '../src/ui/smoke.ts';
import { pick50, arm50, armed50, ITEM50 } from '../src/ui/tech50.ts';
import { air93Arm, air93Armed } from '../src/ui/air93.ts';
import { ECO } from '../tools/duel.mjs';

const RECORD = process.env.RECORD === '1', only = process.argv[2];
let groups = 0;
const group = async (name, fn) => { if (only && only !== name) return; await fn(); groups++; console.log(`ok ${name}`); };
const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// 空地營區（跟 tests/tech50.mjs 一樣）：32×32 全空，雙方指揮部在 (24,24)、(4,4)
function camp(extra = {}) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  const h0 = bld(w, BK_HQ, 24, 24, 2, 2, ME), h1 = bld(w, BK_HQ, 4, 4, 2, 2, FOE);
  w.eco = { supply: [500, 500], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 1, air: 1, tech: 1, ...extra };
  return w;
}
function bld(w, kind, x, z, ww = 1, d = 1, side) {
  const maxHp = bldMaxHp(kind, ww, d, 1), b = { id: w.blds.length + 1, kind, x, z, w: ww, d, floors: 1, hp: maxHp, maxHp, ...(side !== undefined ? { builtBy: side } : {}) };
  w.blds.push(b);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < ww; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = b.id;
  return b;
}
function put(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const C = (side, ids, kind, x, z) => ({ t: 'construct', side, ids, kind, x, z });
const inSite = (w, u, site) => bldAt(w, cellOf(u.x), cellOf(u.z))?.id === site.id;

// 驗收 1：放工地時已經在走、路會穿過工地的單位重新找路
await group('repath', () => {
  for (const kind of [UK_INFANTRY, UK_TANK, UK_ENGINEER]) {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 21), u = put(w, ME, kind, 12, 24), by = put(w, ME, UK_INFANTRY, 12, 28);
    step(w, [{ t: 'move', side: ME, ids: [u.id], x: 22, z: 24 }, { t: 'move', side: ME, ids: [by.id], x: 22, z: 28 }]);
    step(w, []);
    const bypath = by.path.slice();
    assert.equal(why50(w, ME, BK_BARRACKS, { x: 18, z: 24, ids: [e.id] }), '', `repath: fixture — the site at (18,24) can go down while kind ${kind} walks through it`);
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24), { t: 'stop', side: ME, ids: [e.id] }]);
    const site = w.blds.at(-1);
    assert.equal(site.kind, BK_BARRACKS, 'repath: fixture — the site is placed');
    assert.deepEqual(by.path, bypath, 'repath: a unit whose path does not cross the site keeps its path cell for cell');
    let inside = 0, t = 0;
    for (; t < 600 && (u.order === ORD_MOVE || u.pathIdx < u.path.length); t++) { step(w, []); if (inSite(w, u, site)) inside++; }
    assert.equal(inside, 0, `repath: kind ${kind} never stands inside the site (${inside} steps inside)`);
    assert.equal(u.order, ORD_IDLE, `repath: kind ${kind} arrives and goes idle (order ${u.order} after ${t} steps)`);
    assert.deepEqual([cellOf(u.x), cellOf(u.z)], [22, 24], `repath: kind ${kind} reaches its goal round the site`);
  }
  // 載著人的卡車：繞過去、放下人
  {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 21), tr = put(w, ME, UK_TRUCK, 12, 24), inf = put(w, ME, UK_INFANTRY, 12, 25);
    step(w, [{ t: 'move', side: ME, ids: [tr.id, inf.id], x: 22, z: 24 }]); step(w, []);   // R092：卡車和步兵一起下移動指令＝步兵上車
    assert(inf.ride === tr.id, 'repath: fixture — the section rides the truck');
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24), { t: 'stop', side: ME, ids: [e.id] }]);
    for (let i = 0; i < 900 && (tr.order === ORD_MOVE || inf.ride); i++) step(w, []);
    assert.equal(tr.order, ORD_IDLE, 'repath: the loaded truck arrives round the site');
    assert(!inf.ride, 'repath: and drops its section off');
  }
  // 要架起來的反戰車砲：繞過去、架好、打射程內的目標（目標是不會還手的觀測員）
  {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 21), g = put(w, ME, UK_ATGUN, 12, 24), foe = put(w, FOE, UK_OBSERVER, 21, 20);
    step(w, [{ t: 'move', side: ME, ids: [g.id], x: 21, z: 24 }]); step(w, []);
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24), { t: 'stop', side: ME, ids: [e.id] }]);
    for (let i = 0; i < 1500 && foe.hp === UNIT_KINDS[UK_OBSERVER].hp; i++) step(w, []);
    assert(foe.hp < UNIT_KINDS[UK_OBSERVER].hp, `repath: the AT gun gets round the site, sets up and fires (gun at ${cellOf(g.x)},${cellOf(g.z)} order ${g.order}, target hp ${foe.hp})`);
  }
});

// 驗收 1：工地不能放在泥地上
await group('mud', () => {
  const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 21);
  w.ter[cellIdx(w, 19, 21)] = TER_MUD;
  assert.equal(why50(w, ME, BK_SUPPLY, { x: 18, z: 20, ids: [e.id] }), '泥地不能蓋', 'mud: a 2×2 with one mud cell is refused');
  const n = w.blds.length;
  step(w, [C(ME, [e.id], BK_SUPPLY, 18, 20)]);
  assert.equal(w.blds.length, n, 'mud: construct on mud is not taken');
  assert.equal(why50(w, ME, BK_SUPPLY, { x: 19, z: 17, ids: [e.id] }), '', 'mud: three cells up (off the mud) is fine');
});

// 驗收 1：沒有 tech 的局逐位不變（雜湊在 main 407c030 上量，RECORD=1）
const NOTECH = {
  rye: () => { const w = createWorld(21); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { ...ECO, end: 1, sw: 2 }, { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]); return w; },
  large: () => { const w = createWorld(22); step(w, [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2 }, { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }]); return w; },
};
const WANT = { rye: ["283ada0e", "408f899d", "eef4444b", "c55bb561", "end 2000"], large: ["d339d533", "5ee89d0a", "21df39e3", "f428051f", "end 2000"] };
await group('notech', () => {
  const got = {};
  for (const [name, make] of Object.entries(NOTECH)) {
    const w = make(), h = [];
    while (w.tick < 2000 && w.winner < 0) { step(w, []); if (w.tick % 500 === 0) h.push(hashWorld(w)); }
    h.push(`end ${w.tick}`);
    got[name] = h;
    if (!RECORD) assert.deepEqual(h, WANT[name], `notech: ${name} hashes match main 407c030`);
  }
  if (RECORD) console.log(JSON.stringify(got));
});
if (RECORD) process.exit(0);

// 驗收 2：路由
await group('route', () => {
  const hit = (o) => ({ unit: 0, building: null, ground: null, ...o });
  {
    const w = camp(), pb = bld(w, BK_PILLBOX, 16, 16, 1, 1, FOE), inside = put(w, FOE, UK_INFANTRY, 16, 16), open = put(w, FOE, UK_INFANTRY, 10, 10);
    const e = put(w, ME, UK_ENGINEER, 18, 18), i = put(w, ME, UK_INFANTRY, 18, 19), t = put(w, ME, UK_TANK, 19, 19);
    const r = routeBattleOrder(w, [e.id, i.id, t.id], false, 'he', hit({ unit: inside.id }));
    assert.deepEqual(r.commands, [{ t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 16 }, { t: 'attack', side: ME, ids: [i.id, t.id], target: inside.id }], 'route: a tap on an enemy inside a pillbox sends the engineer to blow the pillbox, the rest attack');
    void pb;
    const r2 = routeBattleOrder(w, [e.id, i.id], false, 'he', hit({ unit: open.id }));
    assert.deepEqual(r2.commands, [{ t: 'attack', side: ME, ids: [e.id, i.id], target: open.id }], 'route: an enemy in the open is attacked by everyone, engineer too');
    const r3 = routeBattleOrder(w, [i.id], false, 'he', hit({ unit: inside.id }));
    assert.deepEqual(r3.commands, [{ t: 'attack', side: ME, ids: [i.id], target: inside.id }], 'route: without an engineer the old attack order stands');
  }
  {
    const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 21), t = put(w, ME, UK_TANK, 16, 21), i = put(w, ME, UK_INFANTRY, 16, 22);
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24), { t: 'stop', side: ME, ids: [e.id] }]);
    const site = w.blds.at(-1);
    const r = routeBattleOrder(w, [e.id, t.id], false, 'he', hit({ building: [18, 24] }));
    assert.deepEqual(r.commands, [{ t: 'fireAt', side: ME, ids: [e.id], x: 18, z: 24 }], 'route: a tap on our own site sends only the engineer (the tank does not shell our barracks)');
    const g = routeBattleOrder(w, [e.id, t.id], false, 'he', hit({ ground: { x: 18.5, z: 24.5 } }));
    assert.deepEqual(g.commands, [{ t: 'fireAt', side: ME, ids: [e.id], x: 18, z: 24 }], 'route: a ground tap on our own site does the same');
    assert.equal(routeBattleOrder(w, [t.id], false, 'he', hit({ ground: { x: 18.5, z: 24.5 } })), null, 'route: a tank alone tapping our own site gets no order');
    site.hp = site.maxHp; w.tech.sites = [];
    const r4 = routeBattleOrder(w, [t.id, i.id], false, 'he', hit({ building: [18, 24] }));
    assert.deepEqual(r4.commands, [{ t: 'move', side: ME, ids: [i.id], x: 18, z: 24 }], 'route: our finished barracks — the section may go in, the tank gets nothing');
    const house = bld(w, BK_HOUSE, 10, 10, 2, 2);
    const r5 = routeBattleOrder(w, [t.id], false, 'he', hit({ building: [10, 10] }));
    assert.deepEqual(r5.commands, [{ t: 'fireAt', side: ME, ids: [t.id], x: 10, z: 10 }], 'route: anyone else\'s house is shelled as before');
    void house;
  }
  // 原始碼：R091 的閥關著時不送 sw＝2；建造鍵、放不下時馬上更新介面
  const main = src('src/main.ts');
  assert(main.includes('const sw1002 = (c: Command): Command => (V.r1002 && V.r091 ? { ...c, sw: 2 } as Command : c);'), 'route: sw 2 needs both R091 and R1002 on');
  assert(main.includes("produce: kind => { if (pick50(kind)) hud?.update(); else issue({ t: 'produce', side: SIDE_PLAYER, kind }); },"), 'route: a build key refreshes the HUD at once');
  assert(main.includes('  if (!route) { hud?.update(); return; }'), 'route: a refused placement refreshes the HUD at once');
  assert(main.includes('blockReason: V.r126 ? kind => block50(w, kind) ?? ') && main.includes(" ?? reason95(w, kind, phase === 'battle') : undefined,"), 'route: build keys take their block reason from block50');   // R1011：中間接了 block1011（指揮部那兩顆），所以只錨頭尾
});

// 驗收 3：建造模式與空中鍵互斥
await group('modes', () => {
  arm50(0); air93Arm(1);
  assert.equal(pick50(ITEM50 + BK_BARRACKS), true, 'modes: fixture — the barracks key is taken');
  assert.deepEqual([air93Armed(), armed50()], [0, BK_BARRACKS], 'modes: picking a building to build disarms the air key');
  assert.equal(pick50(ITEM50 + BK_BARRACKS), true, 'modes: pressing again cancels');
  assert.deepEqual([armed50()], [0], 'modes: cancelled');
  air93Arm(0);
  assert(src('src/ui/air93.ts').includes('    if (armed) arm50(0);'), 'modes: arming the air key cancels build mode (the click handler; the browser guard presses it)');
});

// 驗收 5：畫面（Node 的真 BattleView）
await group('render', async () => {
  const { BattleView } = await import('../src/render/battle.ts');
  const { buildingGeo } = await import('../src/render/buildings.ts'), { Geo } = await import('../src/render/geo.ts');
  const mk = () => { const w = camp(), e = put(w, ME, UK_ENGINEER, 17, 24), v = new BattleView(w, { fx: true, fog: false, observerDetails: true, r004: true, r016: true }); return { w, e, v }; };
  const drive = (w, v, cmds = [], extra = []) => { v.snapshot(); step(w, cmds); v.onEvents([...w.events, ...extra], w.tick / 20); v.update(0, w.tick / 20, new Set()); };
  {
    const { w, e, v } = mk(), f = put(w, FOE, UK_TANK, 19, 30);
    const calls = [], o4 = v.stage4.bind(v); v.stage4 = (b, from, to, t) => { calls.push([b.id, from, to]); return o4(b, from, to, t); };
    let shakes = 0; const os = v.shake.bind(v); v.shake = (...a) => { shakes++; return os(...a); };
    const adds = [], og = v.ghosts.add.bind(v.ghosts); v.ghosts.add = (geo, t0, h, cx, cz, seed, rise, ...r) => { adds.push({ verts: geo.pos.length / 3, rise: !!rise }); return og(geo, t0, h, cx, cz, seed, rise, ...r); };
    drive(w, v, [C(ME, [e.id], BK_BARRACKS, 18, 24)]);
    const b = w.blds.at(-1);
    assert.equal(v.lastStage[b.id], STAGE_ROOFLESS, 'render: a new site is recorded as roofless, its real stage');
    drive(w, v, [{ t: 'stop', side: ME, ids: [e.id] }, { t: 'fireAt', side: FOE, ids: [f.id], x: 18, z: 24 }]);
    const s0 = shakes;
    for (let i = 0; i < 400 && b.hp > 0; i++) drive(w, v);
    assert.equal(b.hp, 0, 'render: fixture — the enemy tank knocks the young site down');
    assert.deepEqual(calls.filter(c => c[0] === b.id), [[b.id, STAGE_ROOFLESS, 2]], 'render: it falls from roofless, not from intact');
    assert.equal(shakes - s0, 1, 'render: one collapse shake, no roof-burst shake for a bare frame');
    assert.deepEqual(adds.filter(a => !a.rise).map(a => a.verts), [buildingGeo(new Geo(), { ...b, hp: 1 }, STAGE_ROOFLESS).pos.length / 3], 'render: the collapse ghost is the bare frame, not the roofed barracks');
  }
  {
    const { w, e, v } = mk();
    drive(w, v, [C(ME, [e.id], BK_BARRACKS, 18, 24)]);
    const b = w.blds.at(-1);
    while (stageOf(b) !== STAGE_INTACT && w.tick < 1000) drive(w, v);
    v.snapshot(); step(w, []); b.hp -= 100; v.onEvents([...w.events, { e: 'stage', bld: b.id, stage: stageOf(b) }], w.tick / 20);
    assert(v.emitters.some(m => m.id === b.id && m.until > w.tick / 20), 'render: fixture — knocked under 70% it burns and smokes');
    while (w.tech.sites.length && w.tick < 2000) drive(w, v);
    for (let i = 0; i < 40; i++) drive(w, v);
    const now = w.tick / 20, live = v.emitters.filter(m => m.id === b.id && m.until > now);
    assert.deepEqual(live, [], `render: finished again, the barracks no longer burns or smokes (${JSON.stringify(live.map(m => [m.kind, m.until]))})`);
  }
  {
    const { w, e } = mk();
    step(w, [C(ME, [e.id], BK_BARRACKS, 18, 24)]);
    for (let i = 0; i < 60; i++) step(w, []);
    const b = w.blds.at(-1);
    assert.equal(stageOf(b), STAGE_ROOFLESS, 'render: fixture — a site under 70%');
    const v = new BattleView(w, { fx: true, fog: false, observerDetails: true, r004: true, r016: true });
    assert.deepEqual(v.emitters.filter(m => m.id === b.id), [], 'render: a view rebuilt mid-construction adds no smoke to the site');
  }
});
console.log(`review1004: ${groups} groups ok`);
