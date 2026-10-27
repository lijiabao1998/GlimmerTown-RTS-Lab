// R008 車輛有重量守衛（Node，不開瀏覽器）：車轍畫進地面貼圖、閥關時逐位元組不變、畫面只讀世界、後座與回位、砲塔轉速上限、受擊閃光。
import * as THREE from 'three';
import { createWorld, hashWorld, SUB, N, UK_TANK } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT } from '../src/sim/script.ts';
import { BattleView, TURRET_RATE } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const sel = new Set();
const PX = 8, W = N * PX;

// 腳本戰鬥 600 步，每一步餵畫面（跟瀏覽器裡 tick() 一樣：snapshot → step → onEvents → update）
function play(r008) {
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: r008 }), crossed = new Uint8Array(N * N);
  let i = 0;
  while (w.tick < 600) {
    const now = []; while (i < SCRIPT.length && SCRIPT[i].tick <= w.tick) { if (SCRIPT[i].tick === w.tick) now.push(SCRIPT[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, sel);
    for (const u of w.units) if (u.alive && u.kind !== 2) {
      const cx = Math.floor(u.x / SUB), cz = Math.floor(u.z / SUB);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cz + dz >= 0 && cx + dx < N && cz + dz < N) crossed[(cz + dz) * N + cx + dx] = 1;
    }
  }
  return { w, v, px: v.groundPx, crossed };
}
{ // 1. 車轍：走過的格子變深，沒走過的格子一位元組都不變；閥關時地面貼圖跟重新畫的一模一樣；畫面只讀世界
  const on = play(true), off = play(false), plain = runLog(createWorld(1944), SCRIPT, 600);
  let darker = 0, stray = 0, lum = 0;
  for (let p = 0; p < W * W; p++) {
    const o = p * 4, a = on.px[o] + on.px[o + 1] + on.px[o + 2], b = off.px[o] + off.px[o + 1] + off.px[o + 2];
    if (a === b) continue;
    const gx = p % W, gz = (p - gx) / W, cell = Math.floor(gz / PX) * N + Math.floor(gx / PX);
    if (!on.crossed[cell]) stray++;
    if (a < b) { darker++; lum += b - a; }
  }
  check(darker > 200 && stray === 0, '車轍：坦克走過的地方地面變深，沒走過的格子一位元組都不變', `變深 ${darker} 像素（平均暗 ${(lum / Math.max(1, darker)).toFixed(1)}），走不到的地方變了 ${stray} 像素`);
  const fresh = new BattleView(off.w, { fx: true, fog: true, observerDetails: true, r004: true, r008: false });
  check(Buffer.compare(Buffer.from(fresh.groundPx), Buffer.from(off.px)) === 0, '?noR008：地面貼圖跟同一個世界重新畫出來的逐位元組相同（沒有車轍）');
  check(hashWorld(on.w) === hashWorld(plain) && hashWorld(off.w) === hashWorld(plain), '畫面只讀世界：有車轍、沒車轍、沒有畫面，世界雜湊相同', `${hashWorld(on.w)} / ${hashWorld(off.w)} / ${hashWorld(plain)}`);
  on.v.dispose(); off.v.dispose(); fresh.dispose();
}
// 一輛我方坦克（第 0 個坦克實例）站著瞄準 +x
function rig(r008 = true) {
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: r008 }), u = w.units.find(x => x.kind === UK_TANK && x.side === 0);
  u.aimX = SUB; u.aimZ = 0;
  v.update(0, 10, sel);
  return { w, v, u };
}
const turretPos = v => { const m = new THREE.Matrix4(), p = new THREE.Vector3(); v.turret.getMatrixAt(0, m); return p.setFromMatrixPosition(m); };
const hullCol = v => { const c = new THREE.Color(); v.hull.getColorAt(0, c); return c; };
{ // 2. 後座：開火後 0.1 秒砲塔沿瞄準反方向往後，0.4 秒回位
  const { v, u } = rig(), rest = turretPos(v).clone();
  v.onEvents([{ e: 'fire', unit: u.id, x: u.x, z: u.z }], 10);
  v.update(0, 10.1, sel); const kick = turretPos(v).clone();
  v.update(0, 10.4, sel); const back = turretPos(v).clone();
  const off = rig(false);
  off.v.onEvents([{ e: 'fire', unit: off.u.id, x: off.u.x, z: off.u.z }], 10); off.v.update(0, 10.1, sel);
  const still = turretPos(off.v).distanceTo(turretPos(rig(false).v));
  check(kick.x < rest.x - 0.02 && Math.abs(kick.z - rest.z) < 1e-6 && back.distanceTo(rest) < 1e-9 && still < 1e-9, '後座：開火後 0.1 秒砲塔往後退、0.4 秒回位；閥關時不動',
    `瞄準 +x；靜止 ${rest.x.toFixed(3)}，0.1 秒 ${kick.x.toFixed(3)}，0.4 秒 ${back.x.toFixed(3)}；閥關位移 ${still}`);
  v.dispose(); off.v.dispose();
}
{ // 3. 砲塔轉速：瞄準方向突然反過來，每一幀轉的角度不超過最大轉速，最後對準
  const { v, u } = rig();
  u.aimX = -SUB; u.aimZ = 0;
  let worst = 0, prev = v.turretYaw[u.id], t = 10;
  for (let f = 0; f < 120; f++) {
    t += 1 / 60; v.update(0, t, sel);
    let d = Math.abs(v.turretYaw[u.id] - prev); d = Math.min(d, 2 * Math.PI - d);
    worst = Math.max(worst, d); prev = v.turretYaw[u.id];
  }
  const target = Math.atan2(0, -SUB), err = Math.abs(Math.atan2(Math.sin(v.turretYaw[u.id] - target), Math.cos(v.turretYaw[u.id] - target)));
  check(worst <= TURRET_RATE / 60 + 1e-9 && err < 1e-9, '砲塔轉向：每幀不超過最大轉速，兩秒內對準', `每幀最多 ${worst.toFixed(4)} 弧度（上限 ${(TURRET_RATE / 60).toFixed(4)}），最後誤差 ${err.toExponential(1)}`);
  v.dispose();
}
{ // 4. 受擊閃光：扣血那一刻變亮，0.2 秒後回原色
  const { v, u } = rig(), base = hullCol(v).clone();
  u.hp -= 10;
  v.onEvents([], 20); v.update(0, 20.02, sel); const hit = hullCol(v).clone();
  v.update(0, 20.22, sel); const after = hullCol(v).clone();
  const bright = c => c.r + c.g + c.b;
  check(bright(hit) > bright(base) + 0.5 && after.equals(base), '受擊閃光：扣血那一刻整台車變亮，0.2 秒後回到原色', `平常 ${bright(base).toFixed(2)}，受擊 ${bright(hit).toFixed(2)}，0.2 秒後 ${bright(after).toFixed(2)}`);
  v.dispose();
}

if (fails.length) { console.log(`NG vehicle：${fails.join('、')}`); process.exit(1); }
console.log('vehicle: all OK');
