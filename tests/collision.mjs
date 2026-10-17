// R005 單位碰撞守衛：車不疊車、不推進牆、窄巷不卡死、架好的砲不被推、步兵與殘骸不碰撞、決定性。
// 距離、時間全部從 UNIT_KINDS 推（radius、speed），調數值不會誤紅。
import {
  createWorld, hashWorld, idx, center, cellOf, blocks, N, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, ORD_IDLE, BK_HOUSE,
} from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { randInt } from '../src/sim/rng.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const R = k => UNIT_KINDS[k].radius;
const blank = () => {
  const w = createWorld(7);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = [];
  return w;
};
const addBld = (w, x, z, bw, bd, hp = 1e6) => {
  const id = w.blds.length + 1;
  w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors: 1, hp, maxHp: hp });
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id;
  return w.blds[id - 1];
};
// 單位不開火（冷卻拉滿）：這支守衛只看走位
const addUnit = (w, side, kind, cx, cz) => {
  const k = UNIT_KINDS[kind], id = w.units.length + 1;
  w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 });
  return w.units[id - 1];
};
const run = (w, n, each) => { for (let i = 0; i < n; i++) { step(w, []); each?.(w); } return w; };
const move = (u, x, z) => ({ t: 'move', side: u.side, ids: [u.id], x, z });
const dist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z));
function minGap(us) {   // 任兩輛車：中心距離 − 半徑和，取最小（負的＝還疊著）
  let worst = Infinity, pair = '';
  for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
    const g = dist(us[i], us[j]) - R(us[i].kind) - R(us[j].kind);
    if (g < worst) { worst = g; pair = `${us[i].id}-${us[j].id}`; }
  }
  return { worst, pair };
}
const TANK_SPD = Math.floor(UNIT_KINDS[UK_TANK].speed * 85 / 100);   // 草地上一步走幾個位置單位

{ // 1a. 三輛坦克各自下「同一格」的移動指令（分開下，避開編隊偏移）
  const w = blank(), ts = [addUnit(w, 0, UK_TANK, 4, 4), addUnit(w, 0, UK_TANK, 4, 12), addUnit(w, 0, UK_TANK, 12, 4)];
  step(w, ts.map(t => move(t, 16, 16)));
  const travel = Math.ceil((14 * SUB * 1.5) / TANK_SPD);
  run(w, travel + 200);
  const g = minGap(ts), idle = ts.every(t => t.order === ORD_IDLE);
  check(idle && g.worst >= -2, '同一格的三輛坦克：到達後任兩輛距離 ≥ 半徑和', `最小間隙 ${g.worst}（${g.pair}），都停了 ${idle}`);
}
{ // 1b. 六輛坦克疊在同一點出生
  const w = blank(), ts = [];
  for (let i = 0; i < 6; i++) ts.push(addUnit(w, i % 2, UK_TANK, 16, 16));
  const before = minGap(ts).worst;
  run(w, 200);
  const g = minGap(ts);
  check(before < 0 && g.worst >= -2, '六輛坦克疊在同一點：靜止後任兩輛距離 ≥ 半徑和', `之前 ${before}，之後最小間隙 ${g.worst}（${g.pair}）`);
}
{ // 2. 推擠從不把車推進還站著的建築格、不推出地圖：200 個固定種子的隨機場景，每一步都檢查
  let bad = '', steps = 0, pushes = 0;
  for (let seed = 0; seed < 200 && !bad; seed++) {
    const w = createWorld(seed), r = { rng: seed * 7919 + 13 };
    w.units = [];
    const free = [];
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) if (!w.occ[idx(x, z)]) free.push([x, z]);
    const hub = free[randInt(r, free.length)];
    // 8 輛車擠在同一個路口附近（很多會疊在同一格），各自往隨機的地方開
    for (let k = 0; k < 8; k++) {
      let cell = hub;
      for (let t = 0; t < 20; t++) { const c = free[randInt(r, free.length)]; if (Math.abs(c[0] - hub[0]) + Math.abs(c[1] - hub[1]) <= 3) { cell = c; break; } }
      addUnit(w, k % 2, k % 4 === 3 ? UK_HOWITZER : UK_TANK, cell[0], cell[1]);
    }
    const cmds = w.units.map(u => { const c = free[randInt(r, free.length)]; return move(u, c[0], c[1]); });
    for (let t = 0; t < 300 && !bad; t++) {
      const before = w.units.map(u => [u.x, u.z]);
      step(w, t === 0 ? cmds : t === 150 ? w.units.map(u => move(u, hub[0], hub[1])) : []);
      steps++;
      for (const u of w.units) {
        if (u.x < 0 || u.z < 0 || u.x >= N * SUB || u.z >= N * SUB) { bad = `種子 ${seed} tick ${t}：#${u.id} 出界 ${u.x},${u.z}`; break; }
        if (blocks(w, cellOf(u.x), cellOf(u.z))) { bad = `種子 ${seed} tick ${t}：#${u.id} 在建築格 ${cellOf(u.x)},${cellOf(u.z)}（之前 ${before[u.id - 1]}）`; break; }
      }
      pushes += w.units.filter((u, i) => (u.x - before[i][0]) % TANK_SPD !== 0).length;
    }
  }
  check(!bad, '推擠不推進建築、不推出地圖（200 種子 × 300 步）', bad || `${steps} 步全部乾淨`);
}
{ // 3. 窄巷對向：兩棟長建築夾出一格寬的巷子，兩輛坦克從兩頭對開
  const solo = () => { const w = blank(); addBld(w, 6, 9, 12, 1); addBld(w, 6, 11, 12, 1); const a = addUnit(w, 0, UK_TANK, 3, 10); step(w, [move(a, 20, 10)]); let n = 1; while (a.order !== ORD_IDLE && n < 5000) { step(w, []); n++; } return n; };
  const alone = solo();
  const w = blank(); addBld(w, 6, 9, 12, 1); addBld(w, 6, 11, 12, 1);
  const a = addUnit(w, 0, UK_TANK, 3, 10), b = addUnit(w, 1, UK_TANK, 20, 10);
  step(w, [move(a, 20, 10), move(b, 3, 10)]);
  let n = 1, ta = 0, tb = 0, inWall = false;
  while ((!ta || !tb) && n < alone * 6) {
    step(w, []); n++;
    if (!ta && a.order === ORD_IDLE) ta = n;
    if (!tb && b.order === ORD_IDLE) tb = n;
    if (blocks(w, cellOf(a.x), cellOf(a.z)) || blocks(w, cellOf(b.x), cellOf(b.z))) inWall = true;
  }
  const arrived = cellOf(a.x) === 20 && cellOf(b.x) === 3;
  check(ta && tb && arrived && !inWall && Math.max(ta, tb) <= alone * 3, '窄巷對向：兩輛都在單獨通過時間的 3 倍內到達，不卡死、不進牆', `單獨 ${alone} 步；對開 ${ta}／${tb} 步；到達 ${arrived}`);
}
{ // 4. 架好的榴彈砲（有試射校準）：坦克的路直接穿過它，砲不被推、校準不被重設
  const w = blank(), gun = addUnit(w, 0, UK_HOWITZER, 10, 10), tank = addUnit(w, 0, UK_TANK, 4, 10);
  gun.ranging = { x: gun.x, z: gun.z, ax: center(30), az: center(10), target: 0, epoch: 3, seen: 2 };
  const gx = gun.x, gz = gun.z;
  step(w, [move(tank, 16, 10)]);
  let moved = false, n = 1;
  while (tank.order !== ORD_IDLE && n < 2000) { step(w, []); n++; if (gun.x !== gx || gun.z !== gz) moved = true; }
  const passed = cellOf(tank.x) === 16 && cellOf(tank.z) === 10;
  check(!moved && gun.ranging.seen === 2 && gun.ranging.epoch === 3 && passed, '架好的榴彈砲不被路過的坦克推，試射校準不重設；坦克照樣過得去', `砲動了 ${moved}，seen ${gun.ranging.seen}，坦克到達 ${passed}（${n} 步）`);
}
{ // 5. 步兵（半徑 0）不碰撞；殘骸不碰撞
  const w = blank(), obs = addUnit(w, 0, UK_OBSERVER, 8, 8), tank = addUnit(w, 0, UK_TANK, 8, 8);
  run(w, 40);
  const sameSpot = obs.x === center(8) && obs.z === center(8) && tank.x === center(8) && tank.z === center(8);
  const w2 = blank(), wreck = addUnit(w2, 1, UK_TANK, 12, 12), live = addUnit(w2, 0, UK_TANK, 6, 12);
  wreck.alive = false; wreck.hp = 0;
  step(w2, [move(live, 12, 12)]); run(w2, 300);
  const onWreck = live.x === center(12) && live.z === center(12) && wreck.x === center(12);
  check(UNIT_KINDS[UK_OBSERVER].radius === 0 && sameSpot && onWreck, '步兵與坦克可以站同一點；活坦克可以停在殘骸上', `同點 ${sameSpot}，停在殘骸上 ${onWreck}`);
}
{ // 6. 決定性：碰撞很多的場景（兩方各 5 輛對衝），重跑、JSON 來回重播、中途深拷貝都相同
  const mk = () => {
    const w = blank();
    for (let k = 0; k < 5; k++) { addUnit(w, 0, UK_TANK, 24 + (k % 2), 14 + k); addUnit(w, 1, UK_TANK, 6 + (k % 2), 14 + k); }
    return w;
  };
  const log = [
    { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 3, 5, 7, 9], x: 6, z: 16 } },
    { tick: 0, cmd: { t: 'move', side: 1, ids: [2, 4, 6, 8, 10], x: 24, z: 16 } },
    { tick: 90, cmd: { t: 'move', side: 0, ids: [1, 3], x: 15, z: 15 } },
    { tick: 120, cmd: { t: 'move', side: 1, ids: [2, 4, 6], x: 15, z: 15 } },
  ];
  const a = hashWorld(runLog(mk(), log, 400)), b = hashWorld(runLog(mk(), JSON.parse(JSON.stringify(log)), 400));
  const half = runLog(mk(), log, 200), copy = structuredClone(half);
  runLog(half, log, 400); runLog(copy, log, 400);
  const w = runLog(mk(), log, 400), g = minGap(w.units);
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a, '碰撞場景：重跑、JSON 重播、中途深拷貝雜湊相同', `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}；400 步後最小間隙 ${g.worst}`);
}
{ // 7. 地圖上的每個單位仍然走得到（推擠沒有改 A*）：種子 1944 開局，坦克一起開到路口都會到
  const w = createWorld(1944), tanks = w.units.filter(u => u.side === 0 && u.kind === UK_TANK);
  step(w, [{ t: 'move', side: 0, ids: tanks.map(t => t.id), x: 18, z: 19 }]);
  run(w, 600);
  const stuck = tanks.filter(t => t.order !== ORD_IDLE).map(t => t.id);
  const g = minGap(tanks);
  check(!stuck.length && g.worst >= -2 && findPath(w, cellOf(tanks[0].x), cellOf(tanks[0].z), 5, 5).length > 0, '腳本開局三輛坦克一起開到路口：都到、互不重疊', `沒到 ${stuck.join(',') || '無'}，最小間隙 ${g.worst}`);
}

if (fails.length) { console.log(`NG collision：${fails.join('、')}`); process.exit(1); }
console.log('collision: all OK');
