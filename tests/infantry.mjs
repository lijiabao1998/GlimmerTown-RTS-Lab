// R021 步兵班守衛：剋制、進駐（減傷、倒塌受傷、從自己的房子往外打、打不穿別棟）、有 eco 時的步兵、畫面的人數與倒下的人、決定性。
import { createWorld, hashWorld, idx, center, cellOf, SUB, UNIT_KINDS, UK_TANK, UK_INFANTRY, ORD_IDLE, BK_HOUSE, SHELL_SMALL, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const I = UNIT_KINDS[UK_INFANTRY], T = UNIT_KINDS[UK_TANK];
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const addBld = (w, x, z, bw = 1, bd = 1, hp = 1000) => { const id = w.blds.length + 1; w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors: 1, hp, maxHp: hp }); for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id; return w.blds[id - 1]; };
const add = (w, side, kind, cx, cz, hp) => { const id = w.units.length + 1; w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: hp ?? UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
// 單發打中：讓一發彈直接落在目標上
const hit = (w, shooter, target) => { w.shells = [{ id: 1, side: shooter.side, kind: UNIT_KINDS[shooter.kind].men ? SHELL_SMALL : 0, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex: target.x, ez: target.z, t: 0, T: 1, target: target.id, hitBld: 0 }]; shooter.cooldown = 1e9; target.cooldown = 1e9; const h0 = target.hp; step(w, []); return h0 - target.hp; };

{ // 1. 剋制：步兵打步兵全額、坦克打步兵全額、步兵打坦克只剩穿甲率
  const w1 = blank(), a = add(w1, 0, UK_INFANTRY, 5, 5), b = add(w1, 1, UK_INFANTRY, 8, 5);
  const w2 = blank(), t = add(w2, 0, UK_TANK, 5, 5), c = add(w2, 1, UK_INFANTRY, 8, 5);
  const w3 = blank(), d = add(w3, 0, UK_INFANTRY, 5, 5), e = add(w3, 1, UK_TANK, 8, 5);
  const ii = hit(w1, a, b), ti = hit(w2, t, c), it = hit(w3, d, e);
  check(ii === I.dmgUnit && ti === T.dmgUnit && it === Math.floor((I.dmgUnit * I.pierce) / 100) && it < ii, '剋制：步兵打步兵、坦克打步兵全額；步兵打坦克只剩穿甲率',
    `步兵→步兵 ${ii}、坦克→步兵 ${ti}、步兵→坦克 ${it}（穿甲率 ${I.pierce}%）`);
}
{ // 2. 進駐：走進房子、減傷一半、從自己房子往外打得到、打不穿別棟、房子塌了受傷
  // 2×2 的房子，步兵待在西北那一格：往東南的射線一定會經過自己這棟的另一格（1×1 的房子考不到「不算自己這棟」）
  const w = blank(), house = addBld(w, 10, 10, 2, 2), other = addBld(w, 10, 7), inf = add(w, 0, UK_INFANTRY, 7, 10);
  inf.cooldown = 1e9;
  step(w, [{ t: 'move', side: 0, ids: [inf.id], x: 10, z: 10 }]);
  for (let i = 0; i < 300 && !(cellOf(inf.x) === 10 && cellOf(inf.z) === 10); i++) step(w, []);
  const inside = cellOf(inf.x) === 10 && cellOf(inf.z) === 10;
  const foe = add(w, 1, UK_TANK, 7, 10); foe.cooldown = 1e9;
  const halved = hit(w, foe, inf);
  foe.alive = false;
  const out1 = add(w, 1, UK_INFANTRY, 13, 12, 1e6); out1.cooldown = 1e9;   // 射線經過自己這棟的 (11,11)
  inf.cooldown = 0; let fires = 0;
  for (let i = 0; i < 80; i++) { step(w, []); fires += w.events.filter(e => e.e === 'fire' && e.unit === inf.id).length; }
  out1.alive = false;
  const behind = add(w, 1, UK_INFANTRY, 10, 5, 1e6); behind.cooldown = 1e9;   // 隔著北邊那棟 (10,7)
  let firesBehind = 0;
  for (let i = 0; i < 80; i++) { step(w, []); firesBehind += w.events.filter(e => e.e === 'fire' && e.unit === inf.id).length; }
  const h0 = inf.hp; house.hp = 1; w.shells = [{ id: 9, side: 1, kind: 0, shooter: foe.id, sx: foe.x, sz: foe.z, ex: center(10), ez: center(10), t: 0, T: 1, target: 0, hitBld: house.id }];
  step(w, []);
  check(inside && halved === Math.floor(T.dmgUnit / 2) && fires > 0 && firesBehind === 0 && inf.hp < h0, '進駐：走進房子、受傷減半、從自己的房子往外打得到、打不穿別棟、房子塌了受傷',
    `進去 ${inside}；坦克打它 ${halved}（全額 ${T.dmgUnit}）；往外開火 ${fires}；隔著別棟開火 ${firesBehind}；房子塌了 ${h0} → ${inf.hp}`);
  void other;
}
{ // 3. 有 eco 開步兵：雙方各一班；produce 扣 25；沒開步兵時不能出步兵；電腦 10 分鐘內出過步兵
  const w = createWorld(1944); step(w, [{ t: 'eco', inf: 1 }]);
  const squads = [0, 1].map(s => w.units.filter(u => u.side === s && u.kind === UK_INFANTRY).length);
  const s0 = w.eco.supply[0]; step(w, [{ t: 'produce', side: 0, kind: UK_INFANTRY }]);
  const paid = s0 - w.eco.supply[0];   // 第 1 步不是進帳的步：剛好扣掉步兵的價錢
  const w2 = createWorld(1944); step(w2, [{ t: 'eco' }]); const q0 = w2.eco.queue[0].length; step(w2, [{ t: 'produce', side: 0, kind: UK_INFANTRY }]);
  const noInf = w2.eco.queue[0].length === q0 && !w2.units.some(u => u.kind === UK_INFANTRY);
  const w3 = createWorld(1944); step(w3, [{ t: 'eco', inf: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 2 }]);
  const n0 = w3.units.filter(u => u.side === 1 && u.kind === UK_INFANTRY).length;
  while (w3.tick < 12000 && w3.winner < 0) step(w3, []);
  const aiInf = w3.units.filter(u => u.side === 1 && u.kind === UK_INFANTRY).length - n0;
  check(squads[0] === 1 && squads[1] === 1 && paid === I.cost && w.eco.queue[0].length === 1 && w.eco.queue[0][0] === UK_INFANTRY && noInf && aiInf >= 1, '有 eco 開步兵：雙方各一班；可以出步兵；沒開步兵時不能出；電腦會出步兵',
    `各 ${squads}；扣 ${paid}；佇列 ${w.eco.queue[0]}；沒開時擋下 ${noInf}；電腦出步兵 ${aiInf}`);
}
{ // 4. 畫面：小兵數＝血量÷10 無條件進位；少一個人多一個倒下的；畫面只讀世界
  const w = blank(), inf = add(w, 0, UK_INFANTRY, 10, 10); inf.cooldown = 1e9;
  const v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true });
  v.update(0, 1, new Set()); const a = v.menDbg.alive, b0 = v.bodies.n;
  inf.hp = 41; v.update(0, 1.1, new Set()); const b = v.menDbg.alive, b1 = v.bodies.n;
  inf.hp = 0; inf.alive = false; v.update(0, 1.2, new Set()); const c = v.menDbg.alive, b2 = v.bodies.n;
  check(a === 6 && b === 5 && c === 0 && b0 === 0 && b1 === 1 && b2 === 6, '畫面：小兵數＝血量÷10 無條件進位；少的人留下倒下的人', `滿血 ${a}、41 血 ${b}（倒下 ${b1}）、陣亡 ${c}（倒下 ${b2}）`);
  v.dispose();
}
{ // 5. 決定性：含步兵（eco inf）的紀錄；畫面只讀世界
  const log = [{ tick: 0, cmd: { t: 'eco', inf: 1 } }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3 } }, { tick: 60, cmd: { t: 'produce', side: 0, kind: UK_INFANTRY } }, { tick: 300, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 3000)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 3000));
  const half = runLog(createWorld(1944), log, 1500), copy = structuredClone(half);
  runLog(half, log, 3000); runLog(copy, log, 3000);
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true });
  let i = 0;
  while (w.tick < 3000) { const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; } v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set()); }
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && hashWorld(w) === a, '決定性：含步兵的紀錄重跑、JSON、深拷貝相同；畫面只讀世界', `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}／${hashWorld(w)}`);
  v.dispose();
}
if (fails.length) { console.log(`NG infantry：${fails.join('、')}`); process.exit(1); }
console.log('infantry: all OK');
