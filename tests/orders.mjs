// R011 指令回饋守衛（Node）：路線虛線落在剩下的路上、攻擊線指向目標（看不到就指最後已知位置）、砲擊準星在目標格、敵方不畫、閥關不畫、畫面只讀世界。
import { createWorld, hashWorld, SUB, UK_TANK, UK_HOWITZER, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const N = 32;
const drawn = v => { const d = v.dashDbg, out = []; for (let i = 0; i < d.n; i++) out.push({ x: d.x[i], z: d.z[i], kind: d.kind[i], unit: d.unit[i] }); return out; };
const mk = (r011 = true) => { const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: r011 }); return { w, v }; };
const frame = (v, w, sel) => { v.snapshot(); v.update(0, w.tick / 20, sel); };

{ // 1. 路線：每段虛線都在剩下路徑經過的格子（含相鄰半格）；終點標記在路徑終點；沒選取 0 段
  const { w, v } = mk(), t = w.units.find(u => u.kind === UK_TANK && u.side === SIDE_PLAYER);
  step(w, [{ t: 'move', side: 0, ids: [t.id], x: 18, z: 19 }]);
  for (let i = 0; i < 20; i++) step(w, []);
  frame(v, w, new Set());
  const none = drawn(v).length;
  frame(v, w, new Set([t.id]));
  const ds = drawn(v), path = ds.filter(d => d.kind === 0), end = ds.filter(d => d.kind === 3);
  const cells = [[t.x / SUB, t.z / SUB], ...t.path.slice(t.pathIdx).map(c => [(c % N) + 0.5, Math.floor(c / N) + 0.5])];
  const near = d => cells.some(([cx, cz], i) => {   // 到折線（車 → 各路點中心）的距離 ≤ 0.5 格
    if (i === 0) return false;
    const [ax, az] = cells[i - 1], dx = cx - ax, dz = cz - az, L = dx * dx + dz * dz || 1, k = Math.max(0, Math.min(1, ((d.x - ax) * dx + (d.z - az) * dz) / L));
    return Math.hypot(d.x - (ax + dx * k), d.z - (az + dz * k)) <= 0.5;
  });
  const last = t.path[t.path.length - 1], lx = (last % N) + 0.5, lz = Math.floor(last / N) + 0.5;
  check(none === 0 && path.length > 5 && path.every(near) && end.length === 1 && Math.hypot(end[0].x - lx, end[0].z - lz) < 1e-6,
    '路線：沒選取 0 段；選取後每段虛線都在剩下的路上，終點標記在路徑終點', `沒選 ${none}；路線 ${path.length} 段，偏離 ${path.filter(d => !near(d)).length}；終點 ${end.map(e => `${e.x},${e.z}`)}（應為 ${lx},${lz}）`);
  v.dispose();
}
{ // 2. 攻擊線：看得到畫到目標身上；看不到畫到最後已知位置（tx,tz）
  const { w, v } = mk(), t = w.units.find(u => u.kind === UK_TANK && u.side === SIDE_PLAYER), foe = w.units.find(u => u.kind === UK_TANK && u.side === SIDE_ENEMY);
  // 把敵人放到看得到的地方，下攻擊指令
  foe.x = t.x - 6 * SUB; foe.z = t.z;
  step(w, [{ t: 'attack', side: 0, ids: [t.id], target: foe.id }]);
  frame(v, w, new Set([t.id]));
  const seen = v.visibleUnit(foe), atk = drawn(v).filter(d => d.kind === 1), tip = atk[atk.length - 1];
  const toTarget = !!tip && Math.hypot(tip.x - foe.x / SUB, tip.z - foe.z / SUB) < 0.3 + 0.3;
  // 敵人瞬間移到看不到的地方：線要停在最後已知位置，不能跟過去
  const lastX = t.tx / SUB, lastZ = t.tz / SUB;
  foe.x = 3 * SUB; foe.z = 3 * SUB;
  frame(v, w, new Set([t.id]));
  const hidden = !v.visibleUnit(foe), atk2 = drawn(v).filter(d => d.kind === 1), tip2 = atk2[atk2.length - 1];
  const toLast = !!tip2 && Math.hypot(tip2.x - lastX, tip2.z - lastZ) < 0.3 + 0.3 && Math.hypot(tip2.x - 3, tip2.z - 3) > 3;
  check(seen && toTarget && hidden && toLast, '攻擊線：看得到指到目標身上；看不到停在最後已知位置（不洩漏）', `看得到 ${seen}，線尾 ${tip?.x.toFixed(2)},${tip?.z.toFixed(2)}（目標 ${(6 * 0 + t.x / SUB - 6).toFixed(2)},${(t.z / SUB).toFixed(2)}）；看不到後線尾 ${tip2?.x.toFixed(2)},${tip2?.z.toFixed(2)}（最後已知 ${lastX.toFixed(2)},${lastZ.toFixed(2)}）`);
  v.dispose();
}
{ // 3. 砲擊準星在目標格中心；敵方在 selected 裡也不畫；閥關 0 段
  const { w, v } = mk(), gun = w.units.find(u => u.kind === UK_HOWITZER && u.side === SIDE_PLAYER), foe = w.units.find(u => u.side === SIDE_ENEMY);
  step(w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 10, z: 10 }, { t: 'move', side: 1, ids: [foe.id], x: 14, z: 12 }]);   // 敵人也有路要走：有路才會被誤畫
  frame(v, w, new Set([gun.id, foe.id]));
  const foeHasPath = foe.pathIdx < foe.path.length;
  const cross = drawn(v).filter(d => d.kind === 4), enemy = drawn(v).filter(d => d.unit === foe.id).length;
  const off = mk(false);
  step(off.w, [{ t: 'fireAt', side: 0, ids: [gun.id], x: 10, z: 10 }]);
  frame(off.v, off.w, new Set([gun.id]));
  check(foeHasPath && cross.length === 2 && cross.every(c => c.x === 10.5 && c.z === 10.5) && enemy === 0 && drawn(off.v).length === 0 && off.v.dashes === 0,
    '砲擊準星在目標格中心；敵方單位不畫；?noR011 時 0 段', `準星 ${cross.map(c => `${c.x},${c.z}`)}；敵方 ${enemy} 段；閥關 ${drawn(off.v).length} 段`);
  v.dispose(); off.v.dispose();
}
{ // 4. 畫面只讀世界：整場腳本、全選我方
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true }), sel = new Set(w.units.filter(u => u.side === 0).map(u => u.id));
  let i = 0, most = 0;
  while (w.tick < 1200) {
    const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, sel);
    most = Math.max(most, v.dashes);
  }
  const plain = runLog(createWorld(1944), SCRIPT, 1200);
  check(hashWorld(w) === hashWorld(plain) && most > 0, '畫面只讀世界（整場、全選我方）', `${hashWorld(w)} / ${hashWorld(plain)}；最多 ${most} 段`);
  v.dispose();
}

if (fails.length) { console.log(`NG orders：${fails.join('、')}`); process.exit(1); }
console.log('orders: all OK');
