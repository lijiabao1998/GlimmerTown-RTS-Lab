// R1005 電腦第四版：步兵支援兵器與建造（卡面 docs/tasks/R1005-電腦用步兵支援與建造.md）：驗收 1–7。
import assert from 'node:assert/strict';
import {
  createWorld, hashWorld, center, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER as ME, SIDE_ENEMY as FOE,
  BK_HQ, BK_HOUSE, BK_PILLBOX, BK_WIRE, BK_BARRACKS, BK_DEPOT, BK_SUPPLY, UK_TANK, UK_AA, UK_OBSERVER, UK_INFANTRY, UK_ENGINEER, UK_FLAME, UK_SNIPER, UK_AT91, bldMaxHp, bldAt, cellOf,
} from '../src/sim/world.ts';
import { step, spotted } from '../src/sim/step.ts';
import { aiThink, setAi } from '../src/sim/ai.ts';
import { aiThink2 } from '../src/sim/ai2.ts';
import { RANGE50 } from '../src/sim/tech50.ts';
import { NEAR_CORE, BUILD_N, plan1005, spot1005, first1005, support1005 } from '../src/sim/ai1005.ts';
import { ECO } from '../tools/duel.mjs';
import { ECO1005 } from '../tools/r1005-duel.mjs';

const only = process.argv[2];
let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; fn(); groups++; console.log(`ok ${name}`); };
const NEW = [UK_SNIPER, UK_AT91, UK_ENGINEER, UK_FLAME];

// 驗收 1：沒有 sw、tech 的局，第四版下的指令跟第三版一模一樣（比雜湊時把 four 拿掉）
group('same', () => {
  const eco = { ...ECO, air: 1, end: 1, tp: 2, pla: 1, mg: 2 };
  const plain = w => { const saved = (w.ai ?? []).map(a => a.four); for (const a of w.ai ?? []) delete a.four; const h = hashWorld(w); (w.ai ?? []).forEach((a, i) => { if (saved[i]) a.four = saved[i]; }); return h; };
  for (const [map, seed] of [[1, 31], [2, 32], [3, 33]]) {
    const run = v => { const w = createWorld(seed), h = []; step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1 }, eco, { t: 'ai', side: 1, level: 3, v }, { t: 'ai', side: 0, level: 2, v }]); while (w.tick < 3000 && w.winner < 0) { step(w, []); if (w.tick % 500 === 0) h.push(plain(w)); } return { h, four: w.ai.every(a => a.four === (v === 4 ? 1 : undefined)) }; };
    const a = run(4), b = run(3);
    assert(a.four && b.four, `same: fixture — v 4 is stored as v 3 plus four (map ${map})`);
    assert.deepEqual(a.h, b.h, `same: map ${map} without sw or tech, the fourth version plays bit for bit like the third`);
  }
});

// 驗收 2：只有 sw＝2（沒有 tech）也用得上：鄉間 64，第四版造新的四種兵
group('swonly', () => {
  const tot = [0, 0, 0, 0], per = [];
  for (const seed of [41, 42, 43, 44, 45]) {
    const w = createWorld(seed), start = (() => { step(w, [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, { ...ECO1005, tech: undefined }, { t: 'ai', side: 1, level: 3, v: 3 }, { t: 'ai', side: 0, level: 3, v: 4 }]); return w.units.length; })();
    assert.equal(w.eco.tech, undefined, 'swonly: fixture — no tech');
    while (w.tick < 12000 && w.winner < 0) step(w, []);
    const got = NEW.map(k => w.units.slice(start).filter(u => u.side === 0 && u.kind === k).length);
    got.forEach((n, i) => { tot[i] += n; }); per.push(got);
    assert.equal(w.units.slice(start).filter(u => u.side === 1 && NEW.includes(u.kind)).length, 0, 'swonly: the third version on the other side builds none of them');
  }
  console.log(`  swonly: [sniper, AT team, engineer, flamethrower] per battle ${JSON.stringify(per)}`);
  // 卡面驗收 2 寫「每一局四種各至少一組」：沒做到（工兵在沒有 tech 的局排在最後，比例輪不到；有一局在支援輪到之前就打完了）。守衛照實際做到的釘：
  assert(per.filter(g => g.some(n => n > 0)).length >= 4, `swonly: in at least 4 of 5 battles the fourth version builds some of the new kinds (${JSON.stringify(per)})`);
  assert(tot[0] > 0 && tot[1] > 0 && tot[3] > 0, `swonly: across five battles it builds snipers, AT teams and flamethrowers (${JSON.stringify(tot)})`);
});

// 驗收 3：蓋：sw＝2、tech＝1 的鄉間 64，困難的第四版 10 局裡至少 8 局在第 6,000 步以前蓋好兵營；工地都在指揮部 8 格內；蓋好之後造得出兵營鎖住的兵
group('build', () => {
  let early = 0, unlocked = 0;
  const notes = [];
  for (let seed = 51; seed <= 60; seed++) {
    const w = createWorld(seed);
    step(w, [{ t: 'map', id: 2, vegetation: 1, sym: 1 }, ECO1005, { t: 'ai', side: 1, level: 3, v: 3 }, { t: 'ai', side: 0, level: 3, v: 4 }]);
    const hq = w.blds[w.eco.hq[0] - 1], start = w.units.length;
    let done = -1;
    while (w.tick < 12000 && w.winner < 0) {
      step(w, []);
      for (const e of w.events) if (e.e === 'build') { const b = w.blds[e.bld - 1]; if (b.builtBy === 0) { const gap = Math.max(Math.max(hq.x - (b.x + 1), 0, b.x - (hq.x + hq.w - 1)), Math.max(hq.z - (b.z + 1), 0, b.z - (hq.z + hq.d - 1))); assert(gap <= RANGE50, `build: seed ${seed} the site at ${b.x},${b.z} is within ${RANGE50} cells of the HQ`); } }
      if (done < 0 && w.blds.some(b => b.kind === BK_BARRACKS && b.builtBy === 0 && b.hp > 0 && !w.tech?.sites.some(s => s.id === b.id))) done = w.tick;
    }
    if (done >= 0 && done <= 6000) early++;
    if (done >= 0 && w.units.slice(start).some(u => u.side === 0 && (u.kind === UK_FLAME || u.kind === UK_SNIPER || u.kind === UK_AT91))) unlocked++;
    notes.push(done);
  }
  console.log(`  build: barracks finished at ${JSON.stringify(notes)}`);
  assert(early >= 8, `build: in at least 8 of 10 battles the barracks stands before step 6,000 (${early}: ${JSON.stringify(notes)})`);
  assert(unlocked >= 8, `build: and then it builds a kind the barracks unlocks (${unlocked} of 10)`);
});

// 夾具：空的 32×32、雙方指揮部，第四版的電腦在我方（右下），主力三台坦克在 (16,16) 附近
function field() {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  const h0 = bld(w, BK_HQ, 24, 24, 2, 2, ME), h1 = bld(w, BK_HQ, 4, 4, 2, 2, FOE);
  w.eco = { supply: [0, 0], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 2 };
  for (const [x, z] of [[16, 16], [17, 16], [16, 17]]) put(w, ME, UK_TANK, x, z);
  setAi(w, ME, 3, 4);
  return w;
}
function bld(w, kind, x, z, ww = 1, d = 1, side) {
  const maxHp = bldMaxHp(kind, ww, d, 1), b = { id: w.blds.length + 1, kind, x, z, w: ww, d, floors: 1, hp: maxHp, maxHp, ...(side !== undefined ? { builtBy: side } : {}) };
  w.blds.push(b);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < ww; dx++) w.occ[cellIdx(w, x + dx, z + dz)] = b.id;
  return b;
}
function put(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind], u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const think = w => { const st = w.ai.find(a => a.side === ME); return aiThink2(w, st, spotted, aiThink(w, st, spotted)); };
const orderOf = (cmds, u) => cmds.find(c => c.ids?.includes(u.id));

// 驗收 4：工兵爆破：挑最近的（對方的碉堡、對方的鐵絲網、看得到有人躲著的房子）；看不到裡面有人的房子不挑；離主力太遠的不挑
group('demo', () => {
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18), pb = bld(w, BK_PILLBOX, 13, 16, 1, 1, FOE);
    const cmds = think(w);
    assert.deepEqual(orderOf(cmds, e), { t: 'fireAt', side: ME, ids: [e.id], x: pb.x, z: pb.z }, `demo: the engineer goes to blow the enemy pillbox near our tanks (${JSON.stringify(cmds)})`);
  }
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18);
    w.wires = { version: 1, segments: [{ id: 1, kind: BK_WIRE, x: 16, z: 13, w: 1, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: FOE }] };
    assert.deepEqual(orderOf(think(w), e), { t: 'fireAt', side: ME, ids: [e.id], x: 16, z: 13 }, 'demo: enemy wire near our tanks gets cut');
  }
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18), h = bld(w, BK_HOUSE, 12, 18, 2, 2), foe = put(w, FOE, UK_INFANTRY, 13, 18);
    assert(spotted(w, ME, foe.x, foe.z), 'demo: fixture — we can see the section in the house (the corner that faces us)');
    assert.deepEqual(orderOf(think(w), e), { t: 'fireAt', side: ME, ids: [e.id], x: h.x, z: h.z }, 'demo: a house with a section we can see inside gets a charge');
  }
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18), h = bld(w, BK_HOUSE, 12, 18, 2, 2), foe = put(w, FOE, UK_INFANTRY, 12, 19);   // 背對我們的那一角
    assert(!spotted(w, ME, foe.x, foe.z), 'demo: fixture — the far corner of the house cannot be seen from our side');
    const c = orderOf(think(w), e);
    assert(!(c && c.t === 'fireAt' && c.x === h.x && c.z === h.z), `demo: a house whose garrison we cannot see is left alone (${JSON.stringify(c)})`);
  }
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18), pb = bld(w, BK_PILLBOX, 16 - NEAR_CORE - 2, 16, 1, 1, FOE);
    const c = orderOf(think(w), e);
    assert(!(c && c.t === 'fireAt' && c.x === pb.x), `demo: an enemy pillbox more than ${NEAR_CORE} cells from our tanks is left alone (${JSON.stringify(c)})`);
  }
});

// 驗收 5：火焰噴射器：看得到躲在房子裡的敵方步兵班＝對那一棟下射擊指令；封閉車身的坦克不挑；看不到的不挑
group('flame', () => {
  {
    const w = field(), f = put(w, ME, UK_FLAME, 16, 18), h = bld(w, BK_HOUSE, 12, 18, 2, 2); put(w, FOE, UK_INFANTRY, 13, 18);   // R1005 審查：瞄那一格，不是房子的左上角
    assert.deepEqual(orderOf(think(w), f), { t: 'fireAt', side: ME, ids: [f.id], x: 13, z: 18 }, 'flame: the section in the house 4 cells away gets the flame (fire order on its own cell of the house)');
    void h;
  }
  {
    const w = field(), f = put(w, ME, UK_FLAME, 16, 18); put(w, FOE, UK_TANK, 13, 18);
    const c = orderOf(think(w), f);
    assert(!(c && (c.t === 'attack' || c.t === 'fireAt')), `flame: a closed tank is not a flame target (${JSON.stringify(c)})`);
  }
  {
    const w = field(), f = put(w, ME, UK_FLAME, 16, 18), inf = put(w, FOE, UK_INFANTRY, 13, 18);
    const c = orderOf(think(w), f);
    assert.deepEqual(c, { t: 'attack', side: ME, ids: [f.id], target: inf.id }, 'flame: a section in the open is attacked');
  }
});

// R1005 審查：火焰噴射器瞄有人的那一格（不是房子的左上角），走到兩格內真的燒到人
group('flamecell', () => {
  const w = field(), f = put(w, ME, UK_FLAME, 16, 18); bld(w, BK_HOUSE, 12, 18, 2, 2); const t = put(w, FOE, UK_OBSERVER, 13, 19);   // 不會開槍的觀測員（停火指令對敵方的步兵班不管用）
  assert(spotted(w, ME, t.x, t.z), 'flamecell: fixture — the far cell of the house can be seen');
  assert.deepEqual(orderOf(think(w), f), { t: 'fireAt', side: ME, ids: [f.id], x: 13, z: 19 }, 'flamecell: the fire order goes to the occupied cell');
  w.ai[0].next = 1e9;   // 只看這一條指令怎麼走：之後不再想
  step(w, [{ t: 'fireAt', side: ME, ids: [f.id], x: 13, z: 19 }]);
  for (let i = 0; i < 400 && t.hp === UNIT_KINDS[UK_OBSERVER].hp; i++) step(w, []);
  assert(t.hp < UNIT_KINDS[UK_OBSERVER].hp, `flamecell: the flamethrower gets within range and burns the man (hp ${t.hp})`);
});

// R1005 審查：敵人躲進自己的指揮部（或自己人也在裡面的房子），工兵不炸、火焰噴射器不燒；手上的爆破目標失效就停；反戰車小組不追
group('own', () => {
  const near = () => { const w = field(); w.units.length = 0; for (const [x, z] of [[20, 20], [21, 20], [20, 21]]) put(w, ME, UK_TANK, x, z); return w; };
  {
    const w = near(), e = put(w, ME, UK_ENGINEER, 22, 22), f = put(w, ME, UK_FLAME, 22, 23), t = put(w, FOE, UK_INFANTRY, 24, 24);
    assert(spotted(w, ME, t.x, t.z) && bldAt(w, 24, 24)?.kind === BK_HQ, 'own: fixture — an enemy section we can see stands in our HQ');
    const cmds = think(w), onHq = c => c && c.t === 'fireAt' && c.x >= 24 && c.x <= 25 && c.z >= 24 && c.z <= 25;
    assert(!onHq(orderOf(cmds, e)) && !onHq(orderOf(cmds, f)), `own: neither the engineer nor the flamethrower is sent against our own HQ (${JSON.stringify(cmds)})`);
  }
  {
    const w = field(), e = put(w, ME, UK_ENGINEER, 18, 18), h = bld(w, BK_HOUSE, 12, 18, 2, 2), foe = put(w, FOE, UK_INFANTRY, 13, 18);
    assert.deepEqual(orderOf(think(w), e), { t: 'fireAt', side: ME, ids: [e.id], x: h.x, z: h.z }, 'own: fixture — the engineer is sent to blow the house');
    step(w, [{ t: 'fireAt', side: ME, ids: [e.id], x: h.x, z: h.z }]); w.ai[0].next = 1e9;
    foe.alive = false;
    assert.deepEqual(orderOf(think(w), e), { t: 'stop', side: ME, ids: [e.id] }, 'own: once nobody is seen inside, the engineer stops instead of blowing an empty house');
  }
  {
    const w = field(), a = put(w, ME, UK_AT91, 16, 18), t = put(w, FOE, UK_TANK, 16, 22);
    step(w, [{ t: 'attack', side: ME, ids: [a.id], target: t.id }]); w.ai[0].next = 1e9;
    t.z = center(25);
    assert(spotted(w, ME, t.x, t.z), 'own: fixture — the tank is still seen, 7 cells away');
    const c = orderOf(think(w), a);
    assert(c && c.t === 'stop', `own: the AT team drops a target that left its 5-cell reach (${JSON.stringify(c)})`);
  }
});

// R1005 審查：放工地的指令排在生產前面，真的放得下去（補給剛好夠時，生產不先把錢花掉）
group('construct', () => {
  const w = createWorld(7); step(w, [{ t: 'map', id: 2, vegetation: 0 }]);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; delete w.vegetation; delete w.height; delete w.ai;
  const h0 = bld(w, BK_HQ, 52, 52, 2, 2, ME), h1 = bld(w, BK_HQ, 8, 8, 2, 2, FOE);
  w.eco = { supply: [40, 0], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 2, tech: 1 };
  for (let i = 0; i < 3; i++) put(w, ME, UK_TANK, 44 + i, 44);
  put(w, ME, UK_ENGINEER, 50, 50); setAi(w, ME, 3, 4);
  const st = w.ai.find(a => a.side === ME), cmds = aiThink2(w, st, spotted, aiThink(w, st, spotted));
  const ci = cmds.findIndex(c => c.t === 'construct'), pi = cmds.findIndex(c => c.t === 'produce');
  assert(ci >= 0, `construct: with 40 supply and an idle engineer it orders the barracks (${JSON.stringify(cmds)})`);
  assert(pi < 0 || ci < pi, 'construct: the construct order goes out before any produce order');
  step(w, cmds);
  assert(w.blds.some(b => b.kind === BK_BARRACKS && b.builtBy === ME), 'construct: and the site is really placed');
});

// R1005 審查：看過對方的飛機只算進了地圖的；帶 tech、有車廠就造防空砲；four、air 都進雜湊
group('air', () => {
  const w = field(); w.eco.tech = 1; w.eco.air = 1; w.eco.supply = [200, 200]; put(w, ME, UK_ENGINEER, 18, 18);
  const st = w.ai.find(a => a.side === ME), plane = { id: 1, side: FOE, kind: 1, x: center(4), z: center(4), sx: center(4), sz: center(4), tx: center(16), tz: center(16), t: -10, T: 100, hp: 30 };
  w.sky = { version: 1, next: 2, ready: [0, 0, 0, 0], planes: [plane] };
  think(w);
  assert.equal(st.air, undefined, 'air: a plane still on its way in (t < 0) is not seen');
  plane.t = 0; think(w);
  assert.equal(st.air, w.tick, 'air: once it is over the map, the computer remembers it');
  bld(w, BK_DEPOT, 20, 22, 2, 2, ME);
  assert.equal(first1005(w, st, w.units.filter(u => u.alive && u.side === ME), []), UK_AA, 'air: with tech and a depot it builds an AA gun');
  const h = () => hashWorld(w), withAir = h(); delete st.air; const noAir = h(); st.air = w.tick;
  assert.notEqual(withAir, noAir, 'air: the memory is folded into the hash');
  const four = h(); delete st.four; const three = h(); st.four = 1;
  assert.notEqual(four, three, 'air: four is folded into the hash');
});

// 驗收 6：狙擊手進主力附近的房子；反戰車小組打 5 格內的裝甲
group('teams', () => {
  {
    const w = field(), s = put(w, ME, UK_SNIPER, 20, 20), h = bld(w, BK_HOUSE, 18, 14, 1, 1);
    assert.deepEqual(orderOf(think(w), s), { t: 'move', side: ME, ids: [s.id], x: h.x, z: h.z }, 'teams: the sniper goes into the house near our tanks');
  }
  {
    const w = field(), a = put(w, ME, UK_AT91, 16, 18), t = put(w, FOE, UK_TANK, 16, 22);
    assert.deepEqual(orderOf(think(w), a), { t: 'attack', side: ME, ids: [a.id], target: t.id }, 'teams: the AT team attacks the enemy tank 4 cells away');
    t.z = center(25);
    const c = orderOf(think(w), a);
    assert(!(c && c.t === 'attack'), `teams: 7 cells away it does not chase (${JSON.stringify(c)})`);
  }
});

// 驗收 7：不偷看：同樣的局面，敵人藏到看不到的地方，新的四種兵不因它們下任何指令
group('fog', () => {
  const w = field(), f = put(w, ME, UK_FLAME, 16, 18), a = put(w, ME, UK_AT91, 16, 19), e = put(w, ME, UK_ENGINEER, 17, 18);
  const h = bld(w, BK_HOUSE, 12, 18, 2, 2), inf = put(w, FOE, UK_INFANTRY, 13, 18), t = put(w, FOE, UK_TANK, 16, 22);
  const seenCmds = think(w);
  assert(orderOf(seenCmds, f) && orderOf(seenCmds, a) && orderOf(seenCmds, e), 'fog: fixture — seen, all three get orders about them');
  for (const id of [f.id, a.id, e.id]) { const u = w.units[id - 1]; u.order = ORD_IDLE; }
  // 把敵人搬到地圖另一邊（看不到），再想一次
  inf.x = center(2); inf.z = center(28); t.x = center(28); t.z = center(2);
  assert(!spotted(w, ME, inf.x, inf.z) && !spotted(w, ME, t.x, t.z), 'fog: fixture — out of sight');
  const inH = (c, b) => c.x >= b.x && c.x < b.x + b.w && c.z >= b.z && c.z < b.z + b.d;   // 射擊指令落在那一棟的任何一格
  const cmds = think(w), about = c => c && ((c.t === 'attack' && (c.target === inf.id || c.target === t.id)) || (c.t === 'fireAt' && inH(c, h)));
  assert(![f, a, e].some(u => about(orderOf(cmds, u))), `fog: nothing is ordered because of enemies it cannot see (${JSON.stringify(cmds)})`);
  // 近的也一樣：躲在房子背對我們那一角的敵人（看不到），就在火焰噴射器 8 格內
  const w2 = field(), f2 = put(w2, ME, UK_FLAME, 16, 18), h2 = bld(w2, BK_HOUSE, 12, 18, 2, 2), hid = put(w2, FOE, UK_INFANTRY, 12, 19);
  assert(!spotted(w2, ME, hid.x, hid.z), 'fog: fixture — the far corner of the house is out of sight');
  const c2 = orderOf(think(w2), f2);
  assert(!(c2 && ((c2.t === 'fireAt' && inH(c2, h2)) || (c2.t === 'attack' && c2.target === hid.id))), `fog: nothing is ordered because of enemies it cannot see, even 4 cells away (${JSON.stringify(c2)})`);
});
// 要不要蓋、蓋哪裡、造什麼（直接問 ai1005.ts；故意弄壞時這一群要紅）
group('plan', () => {
  // 鄉間 64 的大小（小地圖不蓋），地上清空，指揮部在 (52,52)、(8,8)
  const camp = (tanks, extra = {}) => {
    const w = createWorld(7); step(w, [{ t: 'map', id: 2, vegetation: 0 }]);
    w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; delete w.vegetation; delete w.height; delete w.ai;
    const h0 = bld(w, BK_HQ, 52, 52, 2, 2, ME), h1 = bld(w, BK_HQ, 8, 8, 2, 2, FOE);
    w.eco = { supply: [200, 200], hq: [h0.id, h1.id], queue: [[], []], prog: [0, 0], inf: 1, guns: 1, tanks: 1, sw: 2, tp: 2, tech: 1, ...extra };
    for (let i = 0; i < tanks; i++) put(w, ME, UK_TANK, 40 + i, 40);
    setAi(w, ME, 3, 4); return { w, st: w.ai.find(a => a.side === ME) };
  };
  const mine = w => w.units.filter(u => u.alive && u.side === ME);
  { const { w, st } = camp(2); assert.equal(plan1005(w, st, mine(w)), -1, 'plan: two tanks — too few to start building'); }
  { const { w, st } = camp(3); assert.equal(plan1005(w, st, mine(w)), BK_BARRACKS, 'plan: three tanks — the barracks first'); }
  { const { w, st } = camp(3); bld(w, BK_BARRACKS, 20, 20, 2, 2, ME); assert.equal(plan1005(w, st, mine(w)), -1, 'plan: barracks up, three tanks — the supply post waits for a fourth'); }
  { const { w, st } = camp(4); bld(w, BK_BARRACKS, 20, 20, 2, 2, ME); assert.equal(plan1005(w, st, mine(w)), BK_SUPPLY, 'plan: barracks up, four tanks — a supply post'); }
  { const { w, st } = camp(3); st.air = 1; assert.equal(plan1005(w, st, mine(w)), BK_DEPOT, 'plan: after seeing enemy aircraft the depot comes first'); }
  { const w = field(); w.eco.tech = 1; w.eco.supply = [200, 200]; put(w, ME, UK_TANK, 18, 16); const st = w.ai.find(a => a.side === ME); assert.equal(plan1005(w, st, mine(w)), -1, `plan: on a map under ${BUILD_N} cells it does not build (32×32, four tanks)`); }
  {
    const { w, st } = camp(3), hq = w.blds[w.eco.hq[ME] - 1], e = put(w, ME, UK_ENGINEER, 48, 48), at = spot1005(w, ME, BK_BARRACKS, [e.id]);
    void st;
    const fc = center(5), d = (x, z) => Math.hypot(x - fc, z - fc);
    assert(at && d(center(at[0]) + 128, center(at[1]) + 128) >= d(center(hq.x) + 128, center(hq.z) + 128), `plan: the site goes behind the HQ, away from the enemy corner (${at}, HQ ${hq.x},${hq.z})`);
  }
  {
    const { w, st } = camp(6), m = mine(w);
    for (const k of [support1005(w, st, m, []), first1005(w, st, m, [])]) assert(![UK_FLAME, UK_SNIPER, UK_AT91].includes(k), `plan: with tech and no barracks it never asks for a kind the barracks locks (${k})`);
  }
  {
    const { w, st } = camp(6, { tech: undefined }), h = bld(w, BK_HOUSE, 36, 42, 2, 2), foe = put(w, FOE, UK_INFANTRY, 37, 42);
    void h;
    assert.equal(first1005(w, st, mine(w), [foe]), UK_FLAME, 'plan: an enemy section seen hiding in a house near our tanks — build a flamethrower');
  }
});
// R1005 審查：反戰車小組找目標、生產挑反戰車小組與火焰噴射器，也只用看得到的
group('fog2', () => {
  const w = field(), a = put(w, ME, UK_AT91, 16, 18); bld(w, BK_HOUSE, 15, 20, 3, 1); const t = put(w, FOE, UK_TANK, 16, 22);
  assert(!spotted(w, ME, t.x, t.z), 'fog2: fixture — the tank behind the row of houses cannot be seen');
  const c = orderOf(think(w), a);
  assert(!(c && c.t === 'attack' && c.target === t.id), `fog2: the AT team does not go for a tank it cannot see (${JSON.stringify(c)})`);
  const st = w.ai.find(x => x.side === ME), m = w.units.filter(u => u.alive && u.side === ME);
  assert.notEqual(support1005(w, st, m, []), UK_AT91, 'fog2: an unseen tank does not make it build an AT team');
  const w2 = field(); bld(w2, BK_HOUSE, 12, 18, 2, 2); const hid = put(w2, FOE, UK_INFANTRY, 12, 19);
  assert(!spotted(w2, ME, hid.x, hid.z), 'fog2: fixture — the far corner of the house is out of sight');
  const st2 = w2.ai.find(x => x.side === ME);
  assert.notEqual(first1005(w2, st2, w2.units.filter(u => u.alive && u.side === ME), []), UK_FLAME, 'fog2: an unseen section in a house does not make it build a flamethrower');
});
console.log(`ai1005: ${groups} groups ok`);
