// R019 補給與生產守衛：指揮部放置、補給、生產與人數上限、出生與集結、有指揮部時的勝負、電腦出兵並打掉指揮部、決定性。
import { createWorld, hashWorld, idx, cellOf, center, SUB, N, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY, BK_HQ } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { ECO_POP } from '../src/sim/eco.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const T = UNIT_KINDS[UK_TANK];
{ // 1. 指揮部：種子 0–199 雙方都放得下、在自己角落附近、不壓單位、兩方互相走得到
  const bad = [];
  for (let seed = 0; seed < 200; seed++) {
    const w = createWorld(seed); step(w, [{ t: 'eco' }]);
    const hqs = w.eco.hq.map(id => w.blds[id - 1]);
    const near = hqs.every((b, side) => { const c = side === SIDE_PLAYER ? N - 1 : 0; return b && b.kind === BK_HQ && b.builtBy === side && Math.abs(b.x + 1 - c) + Math.abs(b.z + 1 - c) <= 12; });
    const onUnit = w.units.some(u => u.alive && w.occ[idx(cellOf(u.x), cellOf(u.z))]);
    const c = u => [cellOf(u.x), cellOf(u.z)];
    let reach = true;
    for (const a of w.units) for (const b of w.units) if (a.side !== b.side) { const p = findPath(w, ...c(a), ...c(b)); if (p[p.length - 1] !== idx(...c(b))) reach = false; }
    if (!near || onUnit || !reach) bad.push(seed);
  }
  // 角落最佳位置上先停一台車：指揮部要避開它
  const w = createWorld(1944), t = w.units[0];
  t.x = center(30); t.z = center(30);
  step(w, [{ t: 'eco' }]);
  const hq = w.blds[w.eco.hq[0] - 1], covers = cellOf(t.x) >= hq.x && cellOf(t.x) < hq.x + 2 && cellOf(t.z) >= hq.z && cellOf(t.z) < hq.z + 2;
  check(!bad.length && !covers, '指揮部：種子 0–199 雙方都放得下、在自己角落附近、不壓單位、兩方互相走得到；角落停著車時避開', `${bad.slice(0, 10).join(',') || '全部合格'}；停車場景指揮部在 ${hq.x},${hq.z}（車在 30,30）`);
}
{ // 2. 補給、生產、出生與集結、人數上限
  const w = createWorld(1944); step(w, [{ t: 'eco' }]);
  for (let i = 1; i < 100; i++) step(w, []);
  const s100 = w.eco.supply[0];                                   // 第 0、20、40、60、80 步各 +1
  const n0 = w.units.length;
  step(w, [{ t: 'produce', side: 0, kind: UK_TANK }]);
  const afterBuy = w.eco.supply[0], q1 = w.eco.queue[0].length;
  step(w, [{ t: 'produce', side: 0, kind: UK_HOWITZER }, { t: 'produce', side: 0, kind: UK_TANK }]);   // 補給不夠：後面的不接
  const qAfterPoor = w.eco.queue[0].length;
  let spawnTick = -1;
  for (let i = 0; i < T.buildTicks + 20 && spawnTick < 0; i++) { step(w, []); if (w.units.length > n0) spawnTick = w.tick; }
  const u = w.units[n0], hq = w.blds[w.eco.hq[0] - 1];
  const adj = u && cellOf(u.x) >= hq.x - 1 && cellOf(u.x) <= hq.x + 2 && cellOf(u.z) >= hq.z - 1 && cellOf(u.z) <= hq.z + 2;
  // 第 100 步本身也是進帳的一步，所以買完是 65 − 40 + 1
  const ok2 = s100 === 65 && afterBuy === 65 - T.cost + 1 && q1 === 1 && qAfterPoor === 1 && u && u.kind === UK_TANK && u.side === 0 && adj && u.order === ORD_MOVE && u.path.length > 0;
  // 人數上限：補給給夠、排滿，活著到 16 台就不再出生
  const w2 = createWorld(1944); step(w2, [{ t: 'eco' }]); w2.eco.supply[0] = 100000;
  for (let i = 0; i < 6000; i++) { const cmds = w2.eco.queue[0].length < 5 ? [{ t: 'produce', side: 0, kind: UK_OBSERVER }] : []; step(w2, cmds); }
  const alive = w2.units.filter(x => x.alive && x.side === 0).length;
  check(ok2 && alive === ECO_POP, '補給每秒 +1；produce 照價扣、補給不夠不接；做好在指揮部旁出生並走向集結點；活著 16 台就不再出生',
    `第 100 步補給 ${s100}；買坦克後 ${afterBuy}、佇列 ${q1}，補給不夠時佇列 ${qAfterPoor}；第 ${spawnTick} 步出生在 ${u ? cellOf(u.x) + ',' + cellOf(u.z) : '-'}（指揮部 ${hq.x},${hq.z}），order ${u?.order}；上限測試活著 ${alive}`);
}
{ // 3. 勝負：只有單位全滅不算輸；指揮部塌了才輸
  const w = createWorld(1944); step(w, [{ t: 'eco' }]);
  for (const u of w.units) if (u.side === SIDE_PLAYER) { u.alive = false; u.hp = 0; }
  for (let i = 0; i < 5; i++) step(w, []);
  const noLoss = w.winner === -1;
  w.blds[w.eco.hq[0] - 1].hp = 0;
  for (let i = 0; i < 3; i++) step(w, []);
  const w3 = createWorld(1944);
  for (const u of w3.units) if (u.side === SIDE_PLAYER) { u.alive = false; u.hp = 0; }
  step(w3, []);
  check(noLoss && w.winner === SIDE_ENEMY && w3.winner === SIDE_ENEMY, '有指揮部：單位全滅不算輸、指揮部塌了才輸；沒有 eco：全滅就輸（照舊）', `全滅後 winner ${noLoss ? -1 : '已判'}；指揮部塌了 ${w.winner}；沒有 eco ${w3.winner}`);
}
{ // 4. 電腦（普通）有補給：10 分鐘內至少出 3 台、20 分鐘內打掉玩家不動的指揮部
  const w = createWorld(1944); step(w, [{ t: 'eco' }, { t: 'ai', side: SIDE_ENEMY, level: 2 }]);
  const n0 = w.units.filter(u => u.side === SIDE_ENEMY).length;
  let at10 = -1;
  while (w.winner < 0 && w.tick < 24000) { step(w, []); if (w.tick === 12000) at10 = w.units.filter(u => u.side === SIDE_ENEMY).length - n0; }
  if (at10 < 0) at10 = w.units.filter(u => u.side === SIDE_ENEMY).length - n0;
  check(at10 >= 3 && w.winner === SIDE_ENEMY && w.blds[w.eco.hq[0] - 1].hp === 0, '電腦（普通）會出兵（10 分鐘內 ≥ 3 台）並打掉玩家不動的指揮部（20 分鐘內）', `出兵 ${at10} 台；第 ${w.tick} 步（${(w.tick / 1200).toFixed(1)} 分鐘）勝方 ${w.winner}`);
}
{ // 5. 決定性：含 eco／produce／ai 的紀錄
  const log = [{ tick: 0, cmd: { t: 'eco' } }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3 } }, { tick: 100, cmd: { t: 'produce', side: 0, kind: UK_TANK } }, { tick: 200, cmd: { t: 'produce', side: 0, kind: UK_OBSERVER } }, { tick: 400, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 3000)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 3000));
  const half = runLog(createWorld(1944), log, 1500), copy = structuredClone(half);
  runLog(half, log, 3000); runLog(copy, log, 3000);
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a, '決定性：含 eco／produce／ai 的紀錄重跑、JSON 重播、中途深拷貝相同', `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}`);
}
if (fails.length) { console.log(`NG eco：${fails.join('、')}`); process.exit(1); }
console.log('eco: all OK');
