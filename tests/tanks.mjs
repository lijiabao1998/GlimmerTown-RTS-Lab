// R023 輕坦克、重坦克守衛：裝甲與穿甲、速度、輕坦克看得遠、有 tanks 才能出、電腦會出、決定性、畫面共用網格。
import { createWorld, hashWorld, center, cellOf, SUB, UNIT_KINDS, UK_TANK, UK_LIGHT, UK_HEAVY, ORD_IDLE, SHELL_AP, TER_ROAD } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const add = (w, side, kind, cx, cz, hp) => { const id = w.units.length + 1; w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: hp ?? UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
const hit = (w, shooter, target) => { w.shells = [{ id: 1, side: shooter.side, kind: SHELL_AP, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex: target.x, ez: target.z, t: 0, T: 1, target: target.id, hitBld: 0 }]; shooter.cooldown = 1e9; target.cooldown = 1e9; const h0 = target.hp; step(w, []); return h0 - target.hp; };
const duel = (a, b) => { const w = blank(); return hit(w, add(w, 0, a, 5, 5), add(w, 1, b, 8, 5)); };

{ // 1. 裝甲與穿甲：中打重 < 中打中；輕打中 < 中打中
  const mm = duel(UK_TANK, UK_TANK), mh = duel(UK_TANK, UK_HEAVY), lm = duel(UK_LIGHT, UK_TANK);
  check(mh < mm && lm < mm && mh === Math.floor((UNIT_KINDS[UK_TANK].dmgUnit * UNIT_KINDS[UK_HEAVY].armor) / 100), '裝甲：中坦克打重坦克 < 打中坦克；輕坦克打中坦克 < 中打中', `中→中 ${mm}、中→重 ${mh}、輕→中 ${lm}`);
}
{ // 2. 速度：同一條直路走 10 格，輕 < 中 < 重（步數）
  const ticks = kind => { const w = blank(); w.ter.fill(TER_ROAD); const u = add(w, 0, kind, 3, 10); step(w, [{ t: 'move', side: 0, ids: [u.id], x: 13, z: 10 }]); let n = 1; while (cellOf(u.x) !== 13 || u.pathIdx < u.path.length) { step(w, []); if (++n > 2000) break; } return n; };
  const l = ticks(UK_LIGHT), m = ticks(UK_TANK), h = ticks(UK_HEAVY);
  check(l < m && m < h, '速度：直路 10 格，輕坦克 < 中坦克 < 重坦克（步數）', `輕 ${l}、中 ${m}、重 ${h}`);
}
{ // 3. 輕坦克看得到 11 格外的敵人，中坦克看不到
  const see = kind => { const w = blank(); add(w, 0, kind, 5, 5); add(w, 1, UK_TANK, 16, 5); return spotted(w, 0, center(16), center(5)); };
  const l = see(UK_LIGHT), m = see(UK_TANK);
  check(l && !m, '視野：輕坦克看得到 11 格外的敵人、中坦克看不到', `輕 ${l}、中 ${m}`);
}
{ // 4. 有 tanks 才能出（照價扣）；電腦對電腦（普通）10 分鐘內兩種都出過
  const w = createWorld(1944); step(w, [{ t: 'eco', tanks: 1 }]); w.eco.supply[0] = 200; const s0 = w.eco.supply[0];
  step(w, [{ t: 'produce', side: 0, kind: UK_LIGHT }, { t: 'produce', side: 0, kind: UK_HEAVY }]);
  const paid = s0 - w.eco.supply[0], q = w.eco.queue[0].join(',');
  const w2 = createWorld(1944); step(w2, [{ t: 'eco', inf: 1, guns: 1 }]); w2.eco.supply[0] = 200;
  step(w2, [{ t: 'produce', side: 0, kind: UK_LIGHT }, { t: 'produce', side: 0, kind: UK_HEAVY }]);
  const blocked = w2.eco.queue[0].length === 0;
  const w3 = createWorld(1944); step(w3, [{ t: 'eco', inf: 1, guns: 1, tanks: 1 }, { t: 'ai', side: 0, level: 2 }, { t: 'ai', side: 1, level: 2 }]);
  const n0 = [UK_LIGHT, UK_HEAVY].map(k => w3.units.filter(u => u.kind === k).length);
  while (w3.tick < 12000 && w3.winner < 0) step(w3, []);
  const made = [UK_LIGHT, UK_HEAVY].map((k, i) => w3.units.filter(u => u.kind === k).length - n0[i]);
  check(paid === UNIT_KINDS[UK_LIGHT].cost + UNIT_KINDS[UK_HEAVY].cost && q === `${UK_LIGHT},${UK_HEAVY}` && blocked && made[0] >= 1 && made[1] >= 1, '有 tanks 才能出輕／重坦克（照價扣）；電腦對電腦 10 分鐘內兩種都出過',
    `扣 ${paid}、佇列 ${q}；沒有 tanks 擋下 ${blocked}；出了輕 ${made[0]}、重 ${made[1]}（第 ${w3.tick} 步、勝方 ${w3.winner}）`);
}
{ // 5. 決定性＋畫面：含新坦克的紀錄重跑、JSON、深拷貝相同；畫面只讀世界；場景物件數不變
  const log = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }, { tick: 0, cmd: { t: 'ai', side: 1, level: 3 } }, { tick: 20, cmd: { t: 'produce', side: 0, kind: UK_LIGHT } }, { tick: 900, cmd: { t: 'produce', side: 0, kind: UK_HEAVY } }, { tick: 300, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } }].sort((a, b) => a.tick - b.tick);
  const a = hashWorld(runLog(createWorld(1944), log, 3000)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 3000));
  const half = runLog(createWorld(1944), log, 1500), copy = structuredClone(half);
  runLog(half, log, 3000); runLog(copy, log, 3000);
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true });
  v.update(0, 0, new Set()); const objs0 = v.scene.children.length;
  let i = 0, kinds = new Set();
  while (w.tick < 3000) { const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; } v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set()); for (const u of w.units) if (u.side === 0 && (u.kind === UK_LIGHT || u.kind === UK_HEAVY)) kinds.add(u.kind); }
  const objs1 = v.scene.children.length;
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && hashWorld(w) === a && kinds.size === 2 && objs1 === objs0, '決定性：含新坦克的紀錄重跑、JSON、深拷貝相同；畫面只讀世界；新坦克不多場景物件',
    `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}／${hashWorld(w)}；我方新坦克種類 ${[...kinds]}；場景物件 ${objs0} → ${objs1}`);
  v.dispose();
}
if (fails.length) { console.log(`NG tanks：${fails.join('、')}`); process.exit(1); }
console.log('tanks: all OK');
