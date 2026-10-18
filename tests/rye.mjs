// R026 Rye 1940 手排地圖守衛：地標在、單位不在房子裡、彼此走得到；泥灘慢、不擋視線、不能蓋；只在第 0 步套；有地圖時布陣、補給、電腦照樣跑；決定性。
import { createWorld, hashWorld, idx, center, speedPct, bldAt, SUB, BK_CHURCH, BK_BARN, BK_COTTAGE, BK_HQ, TER_ROAD, TER_GRASS, TER_MUD, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { stillConnected, buildError, enemyPlan, BUILD_KINDS_24 } from '../src/sim/build.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const rye = () => { const w = createWorld(1944); applyMap(w, MAP_RYE); return w; };
const cellOfU = u => idx(Math.floor(u.x / SUB), Math.floor(u.z / SUB));

{ // 1. 地標與通行
  const w = rye(), at = (x, z) => bldAt(w, x, z);
  const church = at(13, 11), ypres = at(10, 10), gate = [at(9, 18), at(11, 18)], quay = [at(26, 10), at(26, 12), at(26, 17)];
  const marks = church?.kind === BK_CHURCH && church.w === 3 && church.d === 3 && ypres?.kind === BK_CHURCH && gate.every(b => b?.kind === BK_CHURCH) && quay.every(b => b?.kind === BK_BARN)
    && w.ter[idx(10, 18)] === TER_ROAD && w.ter[idx(7, 21)] === TER_ROAD && w.ter[idx(7, 20)] === TER_MUD;   // Landgate 中間是路、Rother 橋
  const onBld = w.units.filter(u => w.occ[cellOfU(u)]).length;
  check(marks && onBld === 0 && stillConnected(w, -9, -9, 0, 0) && w.map === MAP_RYE && w.blds.length >= 40, '地標：教堂、Ypres Tower、Landgate 兩塔與中間的路、Strand 倉庫、Rother 橋；沒有單位在房子裡；全部彼此走得到',
    `地標 ${marks}；站在房子裡 ${onBld}；建築 ${w.blds.length}`);
}
{ // 2. 泥灘：慢、不擋視線、不能蓋
  const w = rye(), mud = speedPct(w, 7, 25), road = speedPct(w, 25, 25), grass = speedPct(w, 10, 25);
  const a = w.units.find(u => u.side === SIDE_PLAYER), e = w.units.find(u => u.side === SIDE_ENEMY);
  a.x = center(5); a.z = center(26); e.x = center(11); e.z = center(26);   // 隔著 Rother 河
  const seen = spotted(w, SIDE_PLAYER, e.x, e.z);
  const err = buildError(w, { t: 'build', side: SIDE_PLAYER, kind: BK_COTTAGE, x: 27, z: 19 });   // Tillingham 河道（我方半場）
  check(mud * 100 <= road * 40 && mud < grass && seen && err === 'mud', '泥灘：速度不到路的四成、比草地慢；隔河看得到；不能蓋房子', `泥 ${mud}、路 ${road}、草 ${grass}；隔河 ${seen}；蓋在河道 ${err}`);
}
{ // 3. 只在第 0 步套；沒送 map 的世界沒有泥灘、沒有 map 欄位
  const w = createWorld(1944); step(w, []); step(w, [{ t: 'map', id: MAP_RYE }]);
  const plain = createWorld(1944);
  check(!w.map && !plain.map && !w.ter.includes(TER_MUD) && !plain.ter.includes(TER_MUD), '第 0 步以後送 map 不理；沒送 map 的世界跟以前一樣（沒有泥灘、沒有 map）', `晚送 ${w.map ?? '無'}`);
}
{ // 4. 有地圖時：敵方布陣、補給、電腦都照樣跑；電腦普通 10 分鐘內打贏不動的玩家
  const w = rye(), plan = enemyPlan(structuredClone(w), BUILD_KINDS_24);
  const w2 = createWorld(1944);
  step(w2, [{ t: 'map', id: MAP_RYE }, ...plan, { t: 'eco', inf: 1, guns: 1, tanks: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 2 }]);
  const built = w2.blds.filter(b => b.builtBy === SIDE_ENEMY && b.kind !== BK_HQ).length, hq = !!w2.eco && w2.eco.hq.every(h => h > 0);
  while (w2.tick < 12000 && w2.winner < 0) step(w2, []);
  check(plan.length > 0 && built === plan.length && hq && w2.winner === SIDE_ENEMY, '有地圖時：敵方布陣蓋得下、雙方指揮部放得下、電腦普通 10 分鐘內打贏不動的玩家',
    `敵方布陣 ${plan.length} 條、蓋了 ${built}；指揮部 ${hq}；勝方 ${w2.winner}（第 ${w2.tick} 步）`);
}
{ // 5. 決定性：含 map 的紀錄重跑、JSON、深拷貝相同；畫面只讀世界（先套地圖再開畫面＝瀏覽器的做法，雜湊也一樣）
  const plan = enemyPlan(rye(), BUILD_KINDS_24);
  const log = [{ tick: 0, cmd: { t: 'map', id: MAP_RYE } }, ...plan.map(cmd => ({ tick: 0, cmd })), { tick: 0, cmd: { t: 'eco', inf: 1 } }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3 } }, { tick: 300, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 16, z: 20 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 2500)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 2500));
  const half = runLog(createWorld(1944), log, 1200), copy = structuredClone(half);
  runLog(half, log, 2500); runLog(copy, log, 2500);
  const w = rye(), v = new BattleView(w, true, true, true, true, true, true, true, true, true);
  let i = 0;
  while (w.tick < 2500) { const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; } v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set()); }
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && hashWorld(w) === a, '決定性：含 map 的紀錄重跑、JSON、深拷貝相同；先套地圖再畫（瀏覽器的做法）也相同', `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}／${hashWorld(w)}`);
  v.dispose();
}
if (fails.length) { console.log(`NG rye：${fails.join('、')}`); process.exit(1); }
console.log('rye: all OK');
