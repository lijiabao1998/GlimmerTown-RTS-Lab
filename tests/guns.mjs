// R022 反戰車砲、迫擊砲守衛：穿甲與打軟目標、架好才打、迫擊砲越過房子與最小射程、有 guns 才能出、電腦會出、決定性、畫面共用網格。
import { createWorld, hashWorld, idx, center, SUB, UNIT_KINDS, UK_TANK, UK_INFANTRY, UK_OBSERVER, UK_ATGUN, UK_MORTAR, ORD_IDLE, ORD_ATTACK, BK_HOUSE, SHELL_AP, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const A = UNIT_KINDS[UK_ATGUN], M = UNIT_KINDS[UK_MORTAR], T = UNIT_KINDS[UK_TANK];
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const addBld = (w, x, z, bw = 1, bd = 1, hp = 1000) => { const id = w.blds.length + 1; w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors: 1, hp, maxHp: hp }); for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id; return w.blds[id - 1]; };
const add = (w, side, kind, cx, cz, hp) => { const id = w.units.length + 1; w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: hp ?? UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
const hit = (w, shooter, target) => { w.shells = [{ id: 1, side: shooter.side, kind: SHELL_AP, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex: target.x, ez: target.z, t: 0, T: 1, target: target.id, hitBld: 0 }]; shooter.cooldown = 1e9; target.cooldown = 1e9; const h0 = target.hp; step(w, []); return h0 - target.hp; };
const fired = (w, u) => w.events.filter(e => e.e === 'fire' && e.unit === u.id).length;

{ // 1. 反戰車砲：打坦克比坦克打坦克痛；打步兵只剩 soft%
  const w1 = blank(), a = add(w1, 0, UK_ATGUN, 5, 5), t1 = add(w1, 1, UK_TANK, 8, 5);
  const w2 = blank(), t = add(w2, 0, UK_TANK, 5, 5), t2 = add(w2, 1, UK_TANK, 8, 5);
  const w3 = blank(), a3 = add(w3, 0, UK_ATGUN, 5, 5), i3 = add(w3, 1, UK_INFANTRY, 8, 5);
  const at = hit(w1, a, t1), tt = hit(w2, t, t2), ai = hit(w3, a3, i3);
  check(at > tt && ai === Math.floor((A.dmgUnit * A.soft) / 100) && ai < A.dmgUnit, '反戰車砲：打坦克 > 坦克打坦克；打步兵只剩 soft%',
    `反戰車砲→坦克 ${at}、坦克→坦克 ${tt}、反戰車砲→步兵 ${ai}（soft ${A.soft}%）`);
}
{ // 2. 反戰車砲架好才打：移動中有目標在射程內也不開火，停下來才打
  const w = blank(), a = add(w, 0, UK_ATGUN, 5, 5), foe = add(w, 1, UK_TANK, 8, 8, 1e6); foe.cooldown = 1e9;
  step(w, [{ t: 'move', side: 0, ids: [a.id], x: 12, z: 5 }]);
  let moving = 0, stopped = 0;
  for (let i = 0; i < 600; i++) { step(w, []); if (a.pathIdx < a.path.length) moving += fired(w, a); else stopped += fired(w, a); }   // 開火在走完這一步之後判斷：開火當下還在路上才算移動中
  check(moving === 0 && stopped > 0, '反戰車砲移動中不開火、停下來才打', `移動中開火 ${moving}、停下來開火 ${stopped}`);
}
{ // 3. 迫擊砲：隔著房子打得到（反戰車砲打到房子）；最小射程內的攻擊不接；落點有散布
  const make = kind => {
    const w = blank(); for (let z = 8; z <= 12; z++) addBld(w, 8, z);   // 一道 5 格長的牆
    const g = add(w, 0, kind, 5, 10), foe = add(w, 1, UK_INFANTRY, 11, 10, 1e4), eye = add(w, 0, UK_OBSERVER, 11, 13);
    foe.cooldown = 1e9; eye.cooldown = 1e9;
    step(w, [{ t: 'attack', side: 0, ids: [g.id], target: foe.id }]);
    const xs = new Set(); let fires = 0, bldHits = 0;
    for (let i = 0; i < 600; i++) { step(w, []); fires += fired(w, g); for (const e of w.events) if (e.e === 'impact') { xs.add(`${e.x},${e.z}`); if (e.bld) bldHits++; } }
    return { lost: 1e4 - foe.hp, fires, spread: xs.size, bldHits, wallHp: w.blds.reduce((s, b) => s + b.hp, 0) };
  };
  const m = make(UK_MORTAR), a = make(UK_ATGUN);
  const w = blank(), g = add(w, 0, UK_MORTAR, 5, 5), near = add(w, 1, UK_INFANTRY, 6, 5); near.cooldown = 1e9;
  step(w, [{ t: 'attack', side: 0, ids: [g.id], target: near.id }]);
  const refused = g.order !== ORD_ATTACK;
  check(m.fires > 0 && m.lost > 0 && m.spread > 1 && m.bldHits === 0 && a.lost === 0 && a.bldHits > 0 && refused, '迫擊砲越過房子打得到（反戰車砲只打到房子）、落點有散布、最小射程內不接',
    `迫擊砲開火 ${m.fires}、傷害 ${m.lost}、落點 ${m.spread} 種、打到房子 ${m.bldHits}；反戰車砲傷害 ${a.lost}、打到房子 ${a.bldHits}；最小射程內 ${refused ? '不接' : '接了'}`);
}
{ // 4. 有 guns 才能出；照價扣；電腦（普通）10 分鐘內兩種都出過
  const w = createWorld(1944); step(w, [{ t: 'eco', guns: 1 }]);
  w.eco.supply[0] = 200; const s0 = w.eco.supply[0];
  step(w, [{ t: 'produce', side: 0, kind: UK_ATGUN }, { t: 'produce', side: 0, kind: UK_MORTAR }]);
  const paid = s0 - w.eco.supply[0], q = w.eco.queue[0].join(',');
  const w2 = createWorld(1944); step(w2, [{ t: 'eco', inf: 1 }]); w2.eco.supply[0] = 200;
  step(w2, [{ t: 'produce', side: 0, kind: UK_ATGUN }, { t: 'produce', side: 0, kind: UK_MORTAR }]);
  const blocked = w2.eco.queue[0].length === 0;
  const w3 = createWorld(1944); step(w3, [{ t: 'eco', inf: 1, guns: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 2 }]);
  while (w3.tick < 12000 && w3.winner < 0) step(w3, []);
  const aiAt = w3.units.filter(u => u.side === 1 && u.kind === UK_ATGUN).length, aiMo = w3.units.filter(u => u.side === 1 && u.kind === UK_MORTAR).length;
  check(paid === A.cost + M.cost && q === `${UK_ATGUN},${UK_MORTAR}` && blocked && aiAt >= 1 && aiMo >= 1, '有 guns 才能出反戰車砲、迫擊砲（照價扣）；電腦普通 10 分鐘內兩種都出過',
    `扣 ${paid}、佇列 ${q}；沒有 guns 擋下 ${blocked}；電腦出了反戰車砲 ${aiAt}、迫擊砲 ${aiMo}（第 ${w3.tick} 步、勝方 ${w3.winner}）`);
}
{ // 5. 決定性＋畫面：含新砲的紀錄重跑、JSON、深拷貝相同；畫面只讀世界；新砲畫在既有網格裡（場景物件數不變）
  const log = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1 } }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3 } }, { tick: 40, cmd: { t: 'produce', side: 0, kind: UK_ATGUN } }, { tick: 200, cmd: { t: 'produce', side: 0, kind: UK_MORTAR } }, { tick: 300, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 3000)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 3000));
  const half = runLog(createWorld(1944), log, 1500), copy = structuredClone(half);
  runLog(half, log, 3000); runLog(copy, log, 3000);
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true });
  v.update(0, 0, new Set()); const objs0 = v.scene.children.length;
  let i = 0, guns = 0;
  while (w.tick < 3000) { const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; } v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set()); guns = Math.max(guns, w.units.filter(u => u.side === 0 && u.alive && (u.kind === UK_ATGUN || u.kind === UK_MORTAR)).length); }
  const objs1 = v.scene.children.length;
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && hashWorld(w) === a && guns >= 2 && objs1 === objs0, '決定性：含新砲的紀錄重跑、JSON、深拷貝相同；畫面只讀世界；新砲不多場景物件',
    `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}／${hashWorld(w)}；我方新砲 ${guns} 門；場景物件 ${objs0} → ${objs1}`);
  v.dispose();
}
if (fails.length) { console.log(`NG guns：${fails.join('、')}`); process.exit(1); }
console.log('guns: all OK');
