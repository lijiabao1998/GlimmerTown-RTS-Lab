// R006 布陣守衛：合法布陣、各種拒絕（世界不變）、敵方布陣（種子 0–199）、決定性。
import {
  createWorld, hashWorld, idx, center, cellOf, N, SUB, UNIT_KINDS, UK_TANK, ORD_IDLE, BK_HOUSE, TER_ROAD, bldMaxHp,
} from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { BUILD_KINDS, BUILD_POINTS, buildError, enemyPlan, pointsUsed, territory, footprint } from '../src/sim/build.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const [COTTAGE, HOUSE, BARN] = BUILD_KINDS;
const B = (side, k, x, z, rot) => ({ t: 'build', side, kind: k.kind, x, z, ...(rot !== undefined ? { rot } : {}) });
const blank = () => {
  const w = createWorld(7);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = [];
  return w;
};
const addBld = (w, x, z, bw, bd) => {
  const id = w.blds.length + 1;
  w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors: 1, hp: 100, maxHp: 100 });
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id;
};
const addUnit = (w, side, cx, cz) => {
  const k = UNIT_KINDS[UK_TANK], id = w.units.length + 1;
  w.units.push({ id, side, kind: UK_TANK, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 });
  return w.units[id - 1];
};
const reachable = w => {
  const live = w.units.filter(u => u.alive), c = u => [cellOf(u.x), cellOf(u.z)];
  for (const a of live) for (const b of live) if (a.side !== b.side) { const p = findPath(w, ...c(a), ...c(b)); if (p[p.length - 1] !== idx(...c(b))) return false; }
  return true;
};
// 拒絕：同一步只送這條指令，結果要跟「什麼都沒送」一模一樣
const rejected = (w, cmd) => {
  const a = structuredClone(w), b = structuredClone(w);
  step(a, [cmd]); step(b, []);
  return hashWorld(a) === hashWorld(b) && a.blds.length === w.blds.length;
};

{ // 合法布陣：大小、層數、血量、建材
  const w = blank(); addUnit(w, 0, 30, 30); addUnit(w, 1, 1, 1);
  const cmds = [B(0, COTTAGE, 20, 20), B(0, HOUSE, 24, 20), B(0, HOUSE, 20, 25, 1), B(1, BARN, 4, 4)];
  const errs = cmds.map(c => buildError(w, c));
  step(w, cmds);
  const got = w.blds.map(b => `${b.kind}:${b.x},${b.z} ${b.w}x${b.d} f${b.floors} hp${b.hp}/${b.maxHp} by${b.builtBy}`);
  const want = [[COTTAGE, 20, 20, 1, 1, 0], [HOUSE, 24, 20, 2, 1, 0], [HOUSE, 20, 25, 1, 2, 0], [BARN, 4, 4, 2, 2, 1]]
    .map(([k, x, z, bw, bd, s]) => { const hp = bldMaxHp(k.kind, bw, bd, k.floors); return `${k.kind}:${x},${z} ${bw}x${bd} f${k.floors} hp${hp}/${hp} by${s}`; });
  const occOk = w.occ[idx(21, 25)] === 0 && w.occ[idx(20, 26)] === 3 && w.occ[idx(25, 20)] === 2;
  check(errs.every(e => e === null) && JSON.stringify(got) === JSON.stringify(want) && occOk && pointsUsed(w, 0) === COTTAGE.cost + 2 * HOUSE.cost && pointsUsed(w, 1) === BARN.cost,
    '合法布陣：大小、層數、血量、哪一方蓋的、建材照扣', `${errs}；${got.join('；')}；建材 ${pointsUsed(w, 0)}／${pointsUsed(w, 1)}`);
}
{ // 拒絕的各種情況：世界不變
  const w = blank(); addUnit(w, 0, 28, 28); addUnit(w, 1, 2, 2);
  for (let i = 0; i < N; i++) w.ter[idx(i, 24)] = TER_ROAD;   // 一條路
  addBld(w, 26, 18, 1, 1);
  const cases = [
    ['對方半場', B(0, COTTAGE, 5, 5), 'foreign'],
    ['無人帶', B(0, COTTAGE, 16, 15), 'neutral'],
    ['敵方蓋在我方半場', B(1, COTTAGE, 25, 25), 'foreign'],
    ['路上', B(0, COTTAGE, 20, 24), 'road'],
    ['地圖外', B(0, BARN, 31, 20), 'map'],
    ['壓在單位上', B(0, COTTAGE, 28, 28), 'unit'],
    ['離別的建築不到一格', B(0, COTTAGE, 27, 19), 'gap'],
    ['疊在建築上', B(0, COTTAGE, 26, 18), 'occupied'],
    ['不存在的種類', { t: 'build', side: 0, kind: 3, x: 20, z: 20 }, 'kind'],
    ['不存在的一方', B(2, COTTAGE, 20, 20), 'side'],
    ['轉向值不對', B(0, HOUSE, 20, 20, 2), 'rot'],
  ];
  const bad = cases.filter(([, c, why]) => buildError(w, c) !== why || !rejected(w, c)).map(([n, c]) => `${n}→${buildError(w, c)}`);
  // 超過建材：先把建材用到只剩 1，再蓋磚房
  const w2 = structuredClone(w), spend = [B(0, BARN, 18, 18), B(0, BARN, 22, 16), B(0, COTTAGE, 18, 28), B(0, COTTAGE, 22, 28)];
  for (const c of spend) step(w2, [c]), w2.tick = 0;
  const left = BUILD_POINTS - pointsUsed(w2, 0), over = B(0, HOUSE, 25, 13);
  const pointsOk = left === 0 && buildError(w2, over) === 'points' && rejected(w2, over);
  // 第 0 步以後
  const w3 = structuredClone(w); step(w3, []);
  const late = B(0, COTTAGE, 20, 20), lateOk = buildError(w3, late) === 'tick' && rejected(w3, late);
  check(!bad.length && pointsOk && lateOk, '拒絕：對方半場、無人帶、路上、地圖外、壓在單位上、太近、疊上去、種類／一方／轉向不對、超過建材、第 0 步以後；世界不變',
    `${bad.join('；') || '各種都擋下'}；剩建材 ${left}，超過 ${buildError(w2, over)}；開戰後 ${buildError(w3, late)}`);
}
{ // 會堵死通路：一道南北向的牆只留兩格寬的缺口，直放的磚房剛好塞死
  const w = blank(); addUnit(w, 0, 30, 30); addUnit(w, 1, 30, 2);   // 兩方都在牆的右邊……
  addUnit(w, 1, 18, 20);                                              // ……另一個敵人在牆的左邊
  addBld(w, 24, 0, 1, 20); addBld(w, 24, 22, 1, 10);                  // x=24 的牆，缺口在 z=20、21
  const cmd = B(0, HOUSE, 24, 20, 1);
  const before = reachable(w), why = buildError(w, cmd), rej = rejected(w, cmd);
  const ok2 = buildError(w, B(0, COTTAGE, 24, 20)) === 'gap';   // 只塞一格：太近（缺口另一格還在，但規矩先擋）
  check(before && why === 'blocked' && rej && ok2, '會堵死通路的位置被拒絕（真的會堵死的場景）', `之前走得到 ${before}；直放磚房 ${why}；農舍 ${buildError(w, B(0, COTTAGE, 24, 20))}`);
}
{ // 同一步裡移動指令排在布陣前面：移動也不會穿過剛蓋的房子（布陣先套）
  const w = blank(), t = addUnit(w, 0, 20, 30); addUnit(w, 1, 2, 2);
  step(w, [{ t: 'move', side: 0, ids: [t.id], x: 20, z: 18 }, B(0, BARN, 19, 23)]);
  let inside = false;
  for (let i = 0; i < 400; i++) { step(w, []); if (w.occ[idx(cellOf(t.x), cellOf(t.z))]) inside = true; }
  check(w.blds.length === 1 && !inside && cellOf(t.z) === 18, '同一步先蓋房子再套移動：路線繞過剛蓋的穀倉', `穀倉 ${w.blds.length}，進過建築 ${inside}，終點 ${cellOf(t.x)},${cellOf(t.z)}`);
}
{ // 敵方布陣：種子 0–199
  const bad = [];
  let minP = 99, maxP = 0, total = 0;
  for (let seed = 0; seed < 200; seed++) {
    const w = createWorld(seed), h0 = hashWorld(w), rng0 = w.rng;
    const plan = enemyPlan(w), again = enemyPlan(w);
    const same = JSON.stringify(plan) === JSON.stringify(again), untouched = hashWorld(w) === h0 && w.rng === rng0;
    const s = structuredClone(w);
    let legal = true;
    for (const c of plan) {
      if (c.side !== 1 || buildError(s, c)) legal = false;
      step(s, [c]); s.tick = 0;
      const f = footprint(c);
      for (let z = f.z; z < f.z + f.d; z++) for (let x = f.x; x < f.x + f.w; x++) if (!territory(1, x, z)) legal = false;
    }
    const pts = pointsUsed(s, 1);
    minP = Math.min(minP, pts); maxP = Math.max(maxP, pts); total += plan.length;
    if (!same || !untouched || !legal || pts < 5 || pts > BUILD_POINTS || !reachable(s)) bad.push(`${seed}${!same ? '不定' : ''}${!untouched ? '改世界' : ''}${!legal ? '不合法' : ''}${pts < 5 || pts > BUILD_POINTS ? `建材${pts}` : ''}`);
  }
  check(!bad.length, '敵方布陣（種子 0–199）：合法、在敵方半場、建材 5–8、兩方走得到、同種子相同、不動世界與 World.rng',
    bad.slice(0, 8).join(' ') || `建材 ${minP}–${maxP}，平均 ${(total / 200).toFixed(1)} 棟`);
}
{ // 決定性：含布陣的紀錄
  const w0 = createWorld(1944), plan = enemyPlan(w0);
  const log = [
    { tick: 0, cmd: B(0, COTTAGE, 20, 19) }, { tick: 0, cmd: B(0, HOUSE, 23, 20) },
    ...plan.map(cmd => ({ tick: 0, cmd })),
    { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } },
    { tick: 0, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } },
    { tick: 300, cmd: B(0, COTTAGE, 26, 21) },                       // 開戰後才送：不理
  ];
  const a = hashWorld(runLog(createWorld(1944), log, 600)), b = hashWorld(runLog(createWorld(1944), log, 600));
  const c = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 600));
  const half = runLog(createWorld(1944), log, 300), copy = structuredClone(half);
  runLog(half, log, 600); runLog(copy, log, 600);
  const built = runLog(createWorld(1944), log, 1).blds.filter(x => x.builtBy !== undefined).length;
  const noBuild = hashWorld(runLog(createWorld(1944), log.filter(l => l.cmd.t !== 'build'), 600));
  check(a === b && a === c && hashWorld(half) === a && hashWorld(copy) === a && built === 2 + plan.length && noBuild !== a,
    '含布陣的紀錄：重跑、JSON 重播、中途深拷貝雜湊相同；第 300 步的布陣不理', `${a}／${b}／${c}／${hashWorld(half)}／${hashWorld(copy)}；蓋了 ${built} 棟（我方 2＋敵方 ${plan.length}）`);
}

if (fails.length) { console.log(`NG build：${fails.join('、')}`); process.exit(1); }
console.log('build: all OK');
