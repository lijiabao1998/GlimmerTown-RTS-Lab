// R024 碉堡守衛：裡面的人只吃四分之一、直射只刮四分之一、榴彈砲全吃、布陣可以蓋（照點數扣）、關掉時敵方布陣跟以前一樣、決定性、模型。
import { createWorld, hashWorld, idx, center, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_INFANTRY, ORD_IDLE, BK_HOUSE, BK_PILLBOX, SHELL_AP, SHELL_HE, STAGE_INTACT, STAGE_ROOFLESS, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { BUILD_KINDS, BUILD_KINDS_24, BUILD_POINTS, enemyPlan, pointsUsed, buildError } from '../src/sim/build.ts';
import { buildingGeo } from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const addBld = (w, kind, x, z, hp = 400) => { const id = w.blds.length + 1; w.blds.push({ id, kind, x, z, w: 1, d: 1, floors: 1, hp, maxHp: hp }); w.occ[idx(x, z)] = id; return w.blds[id - 1]; };
const add = (w, side, kind, cx, cz) => { const id = w.units.length + 1; w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
const shell = (w, shooter, kind, ex, ez, target, hitBld) => { w.shells = [{ id: 1, side: shooter.side, kind, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex, ez, t: 0, T: 1, target, hitBld }]; step(w, []); };

{ // 1. 碉堡裡的步兵只吃四分之一（房子裡一半）
  const inBox = kind => { const w = blank(); addBld(w, kind, 10, 10); const i = add(w, 0, UK_INFANTRY, 10, 10), t = add(w, 1, UK_TANK, 6, 10); shell(w, t, SHELL_AP, i.x, i.z, i.id, 0); return UNIT_KINDS[UK_INFANTRY].hp - i.hp; };
  const pb = inBox(BK_PILLBOX), hs = inBox(BK_HOUSE), D = UNIT_KINDS[UK_TANK].dmgUnit;
  check(pb === Math.floor(D / 4) && hs === Math.floor(D / 2), '碉堡裡的步兵只吃四分之一傷害（房子裡一半）', `碉堡 ${pb}、房子 ${hs}（全額 ${D}）`);
}
{ // 2. 直射打碉堡只刮四分之一；榴彈砲全吃；房子照舊
  const hitBy = (kind, shooterKind, shellKind) => { const w = blank(); const b = addBld(w, kind, 10, 10), s = add(w, 1, shooterKind, 4, 10); shell(w, s, shellKind, center(10), center(10), 0, shellKind === SHELL_AP ? b.id : 0); return 400 - b.hp; };
  const apPb = hitBy(BK_PILLBOX, UK_TANK, SHELL_AP), apHs = hitBy(BK_HOUSE, UK_TANK, SHELL_AP), hePb = hitBy(BK_PILLBOX, UK_HOWITZER, SHELL_HE);
  check(apPb === UNIT_KINDS[UK_TANK].dmgBld >> 2 && apHs === UNIT_KINDS[UK_TANK].dmgBld && hePb === UNIT_KINDS[UK_HOWITZER].dmgBld, '碉堡：坦克直射只刮四分之一、榴彈砲全吃；房子照舊',
    `坦克→碉堡 ${apPb}、坦克→房子 ${apHs}、榴彈砲→碉堡 ${hePb}`);
}
{ // 3. 布陣：碉堡 3 點、可以蓋；敵方布陣用原本三種時永遠不蓋碉堡、跟以前一樣；用新表時有種子會蓋
  const w = createWorld(1944), cmd = { t: 'build', side: 0, kind: BK_PILLBOX, x: 24, z: 22 };
  const err = buildError(w, cmd); step(w, [cmd]);
  const ok = !err && w.blds.some(b => b.kind === BK_PILLBOX && b.builtBy === 0) && pointsUsed(w, 0) === 3;
  let oldHasPb = 0, newHasPb = 0, same = true;
  for (const seed of [1944, 1, 2, 3, 5, 8, 13, 21]) {
    const a = enemyPlan(createWorld(seed)), b = enemyPlan(createWorld(seed), BUILD_KINDS), c = enemyPlan(createWorld(seed), BUILD_KINDS_24);
    if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    if (a.some(x => x.kind === BK_PILLBOX)) oldHasPb++;
    if (c.some(x => x.kind === BK_PILLBOX)) newHasPb++;
  }
  check(ok && same && oldHasPb === 0 && newHasPb > 0 && BUILD_POINTS === 8, '布陣：碉堡 3 點可以蓋；敵方布陣不給碉堡時跟以前一樣、給了會蓋',
    `建造錯誤 ${err || '無'}、點數 ${pointsUsed(w, 0)}；舊表蓋碉堡 ${oldHasPb} 個種子、新表 ${newHasPb} 個；預設參數跟舊表相同 ${same}`);
}
{ // 4. 決定性：含碉堡布陣的紀錄重跑、JSON、深拷貝相同
  const log = [{ tick: 0, cmd: { t: 'build', side: 0, kind: BK_PILLBOX, x: 24, z: 22 } }, ...enemyPlan(createWorld(1944), BUILD_KINDS_24).map(cmd => ({ tick: 0, cmd })), { tick: 0, cmd: { t: 'eco', inf: 1 } }, { tick: 0, cmd: { t: 'ai', side: SIDE_ENEMY, level: 2 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 2500)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 2500));
  const half = runLog(createWorld(1944), log, 1200), copy = structuredClone(half);
  runLog(half, log, 2500); runLog(copy, log, 2500);
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a, '決定性：含碉堡的紀錄重跑、JSON、深拷貝相同', `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}`);
}
{ // 5. 模型：碉堡完好、打壞都有自己的樣子（不是房子的模型），矮（不到一層樓）
  const b = { id: 1, kind: BK_PILLBOX, x: 3, z: 3, w: 1, d: 1, floors: 1, hp: 400, maxHp: 400 }, h = { ...b, kind: BK_HOUSE };
  const gi = buildingGeo(new Geo(), b, STAGE_INTACT), gr = buildingGeo(new Geo(), b, STAGE_ROOFLESS), gh = buildingGeo(new Geo(), h, STAGE_INTACT);
  const top = g => { let m = 0; for (let i = 1; i < g.pos.length; i += 3) m = Math.max(m, g.pos[i]); return m; };
  check(gi.pos.length > 0 && gr.pos.length > 0 && gi.pos.length !== gh.pos.length && top(gi) < 0.4 && top(gr) <= top(gi), '模型：碉堡完好與打壞各有樣子、不是房子、矮於 0.4 格',
    `完好 ${gi.pos.length / 3} 頂點（高 ${top(gi).toFixed(2)}）、打壞 ${gr.pos.length / 3}（高 ${top(gr).toFixed(2)}）、房子 ${gh.pos.length / 3}`);
}
if (fails.length) { console.log(`NG pillbox：${fails.join('、')}`); process.exit(1); }
console.log('pillbox: all OK');
