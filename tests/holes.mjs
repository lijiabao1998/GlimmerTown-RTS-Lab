// R014 牆上痕跡守衛（Node）：每發看得到的命中留一個彈孔、彈孔在朝射手那面牆上、看不到不留、高爆彈燻黑、換階段清掉、上限、決定性、畫面只讀世界、閥關不畫。
import { createWorld, hashWorld, idx, center, SUB, UNIT_KINDS, UK_TANK, ORD_IDLE, BK_HOUSE, SHELL_AP, SHELL_HE } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { wallHeight } from '../src/render/buildings.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; return w; };
const addBld = (w, x, z, bw, bd, floors = 2) => { const id = w.blds.length + 1, hp = 1e6; w.blds.push({ id, kind: BK_HOUSE, x, z, w: bw, d: bd, floors, hp, maxHp: hp }); for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = id; return w.blds[id - 1]; };
const addUnit = (w, side, cx, cz) => { const id = w.units.length + 1, k = UNIT_KINDS[UK_TANK]; w.units.push({ id, side, kind: UK_TANK, x: center(cx), z: center(cz), hp: 1e6, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
const live = v => { const H = v.holes, out = []; for (let i = 0; i < H.live.length; i++) if (H.live[i]) out.push({ i, bld: H.bld[i], kind: H.kind[i], x: H.x[i], y: H.y[i], z: H.z[i], nx: H.nx[i], nz: H.nz[i], h: H.h[i] }); return out; };
// 跑 n 步，每一步照瀏覽器的順序餵畫面，數我方穿甲彈打在建築上的次數
function run(w, v, n, cmds0 = []) {
  let hits = 0;
  for (let k = 0; k < n; k++) {
    v.snapshot(); step(w, k === 0 ? cmds0 : []); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set());
    hits += w.events.filter(e => e.e === 'impact' && e.kind === SHELL_AP && e.bld).length;
  }
  return hits;
}

{ // 1. 坦克從西邊對房子連打：每發都留彈孔；都在西面牆上（x = 牆面 − 0.006 以內）、朝西、高度在牆內
  const w = blank(), b = addBld(w, 12, 10, 2, 2), me = addUnit(w, 0, 6, 11);
  addUnit(w, 1, 30, 30);
  const v = new BattleView(w, true, true, true, true, true, true, true, true);
  const hits = run(w, v, 400, [{ t: 'fireAt', side: 0, ids: [me.id], x: 12, z: 11 }]);
  const hs = live(v), wallX = b.x + 0.1, top = wallHeight(b);
  const onWall = hs.every(h => h.kind === 0 && h.nx === -1 && h.nz === 0 && Math.abs(h.x - wallX) < 0.02 && h.y > 0 && h.y < top && h.z > b.z && h.z < b.z + b.d);
  check(hits >= 3 && hs.length === hits && onWall, '坦克從西邊連打：每發命中一個彈孔，都在西面牆上、朝西、高度在牆內', `命中 ${hits}、彈孔 ${hs.length}；${hs.slice(0, 3).map(h => `${h.x.toFixed(2)},${h.y.toFixed(2)},${h.z.toFixed(2)} n${h.nx},${h.nz}`).join(' ')}`);
  v.dispose();
}
{ // 2. 看不到的命中不留：射手被設成看不到（敵方打敵方的房子在霧裡）——用敵方坦克在玩家看不到的地方打
  const w = blank(), b = addBld(w, 4, 4, 2, 2), foe = addUnit(w, 1, 1, 5);
  addUnit(w, 0, 30, 30);   // 我方離得很遠，看不到
  const v = new BattleView(w, true, true, true, true, true, true, true, true);
  const hits = run(w, v, 300, [{ t: 'fireAt', side: 1, ids: [foe.id], x: 4, z: 5 }]);
  check(hits >= 2 && live(v).length === 0, '看不到的命中不留痕跡', `命中 ${hits}、痕跡 ${live(v).length}`);
  v.dispose();
}
{ // 3. 高爆彈落在房子東邊：東面牆有一塊燻黑
  const w = blank(), b = addBld(w, 10, 10, 2, 2);
  addUnit(w, 0, 16, 11);   // 看得到
  const v = new BattleView(w, true, true, true, true, true, true, true, true);
  const ex = center(12) + 60, ez = center(11);
  w.units.push({ id: 2, side: 0, kind: 1, x: center(30), z: center(30), hp: 60, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 });
  w.shells = [{ id: 1, side: 0, kind: SHELL_HE, shooter: 2, sx: center(30), sz: center(30), ex, ez, t: 0, T: 1, target: 0, hitBld: 0 }];
  v.snapshot(); step(w, []); v.onEvents(w.events, w.tick / 20);
  const soot = live(v).filter(h => h.kind === 1);
  check(soot.length === 1 && soot[0].nx === 1 && Math.abs(soot[0].x - (b.x + b.w - 0.1)) < 0.02, '高爆彈落在房子東邊：東面牆一塊燻黑', JSON.stringify(soot.map(h => [h.x.toFixed(2), h.nx, h.nz])));
  v.dispose();
}
{ // 4. 換階段：空殼清掉高處的、留下低處的；瓦礫全部清掉
  const w = blank(), b = addBld(w, 12, 10, 2, 2, 3), me = addUnit(w, 0, 6, 11);
  addUnit(w, 1, 30, 30);
  const v = new BattleView(w, true, true, true, true, true, true, true, true);
  run(w, v, 900, [{ t: 'fireAt', side: 0, ids: [me.id], x: 12, z: 11 }]);
  const before = live(v), cut = wallHeight(b) * 0.72 * 0.7;
  v.onEvents([{ e: 'stage', bld: b.id, stage: 1 }], w.tick / 20);
  const after = live(v);
  const okRoofless = before.some(h => h.y + h.h / 2 > cut) && before.some(h => h.y + h.h / 2 <= cut) && after.every(h => h.y + h.h / 2 <= cut) && after.length === before.filter(h => h.y + h.h / 2 <= cut).length;
  v.onEvents([{ e: 'stage', bld: b.id, stage: 2 }], w.tick / 20);
  check(okRoofless && live(v).length === 0 && v.holeInstances === 0, '變空殼：牆高以上的痕跡清掉、以下留著；變瓦礫：全部清掉', `之前 ${before.length}、空殼後 ${after.length}（切在 ${cut.toFixed(2)}）、瓦礫後 ${live(v).length}`);
  v.dispose();
}
{ // 5. 上限、決定性、閥關
  const mk = r014 => { const w = createWorld(1944); return { w, v: new BattleView(w, true, false, true, true, true, true, true, r014) }; };
  const pump = ({ w, v }) => {
    for (let k = 0; k < 2000; k++) {
      const b = w.blds[k % w.blds.length], tx = center(b.x), tz = center(b.z);
      w.shells = [{ id: k, side: 0, kind: SHELL_AP, shooter: 1, sx: tx - 4 * SUB + (k % 7) * 40, sz: tz + ((k * 13) % 9 - 4) * SUB, ex: tx, ez: tz, t: 0, T: 99, target: 0, hitBld: b.id }];
      v.snapshot();
      v.onEvents([{ e: 'impact', kind: SHELL_AP, x: tx, z: tz, bld: b.id }], k / 20);
    }
    return { n: v.holeInstances, d: JSON.stringify(Array.from(v.holes.x)) + JSON.stringify(Array.from(v.holes.y)) };
  };
  const a = pump(mk(true)), b = pump(mk(true)), off = pump(mk(false));
  check(a.n > 0 && a.n <= 320 && a.d === b.d && off.n === 0, '灌 2,000 發：實例數不超過容量；同一串事件痕跡一模一樣；?noR014 時 0 個', `實例 ${a.n}（上限 320）；閥關 ${off.n}`);
}
{ // 6. 畫面只讀世界（整場腳本）
  const w = createWorld(1944), v = new BattleView(w, true, true, true, true, true, true, true, true);
  let i = 0, most = 0;
  while (w.tick < 1200) {
    const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set());
    most = Math.max(most, v.holeCount);
  }
  const plain = runLog(createWorld(1944), SCRIPT, 1200);
  check(hashWorld(w) === hashWorld(plain), '畫面只讀世界（整場腳本）', `${hashWorld(w)} / ${hashWorld(plain)}；痕跡最多 ${most}`);
  v.dispose();
}

if (fails.length) { console.log(`NG holes：${fails.join('、')}`); process.exit(1); }
console.log('holes: all OK');
