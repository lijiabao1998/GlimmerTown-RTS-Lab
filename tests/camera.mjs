// R012 鏡頭手感守衛（Node）：縮放對準游標、縮放範圍、慣性衰減與停止、平滑移動、慣性不出地圖。
import { createWorld, N } from '../src/sim/world.ts';
import { BattleView } from '../src/render/battle.ts';
import { Fling, Glide } from '../src/ui/camera.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const W = 1280, H = 800;

{ // 1. 縮放時游標下的地面點不動（放大、縮小；四角與中心）；縮放範圍夾在 0.55–3
  const v = new BattleView(createWorld(1944), { fx: false, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true });
  let worst = 0;
  for (const [cx, cy] of [[640, 400], [60, 60], [1220, 60], [60, 740], [1220, 740], [900, 300]]) {
    for (const f of [1.12, 1 / 1.12, 1.5, 0.7]) {
      v.target.set(16, 0, 16); v.zoom = 1.2;
      const a = v.groundAt(cx, cy, W, H);
      v.zoomAt(f, cx, cy, W, H);
      const b = v.groundAt(cx, cy, W, H);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  v.zoom = 1;
  for (let i = 0; i < 60; i++) v.zoomAt(1.3, 100, 100, W, H);
  const hi = v.zoom;
  for (let i = 0; i < 60; i++) v.zoomAt(0.7, 100, 100, W, H);
  const lo = v.zoom;
  check(worst < 0.01 && hi === 3 && lo === 0.55, '縮放對準游標：游標下的地面點不動；縮放夾在 0.55–3', `最大偏移 ${worst.toExponential(2)} 格；最大 ${hi}、最小 ${lo}`);
  v.dispose();
}
{ // 2. 慣性：每幀位移遞減、0.6 秒內停、總距離介於 0.1v 與 0.3v；按下立刻歸零
  const f = new Fling(), out = { x: 0, z: 0 }, v = 600;
  f.start(v, 0);
  let total = 0, prev = Infinity, mono = true, stopAt = -1;
  for (let i = 1; i <= 120; i++) {
    f.step(1 / 60, out);
    if (out.x > prev + 1e-9) mono = false;
    prev = out.x; total += out.x;
    if (!f.active && stopAt < 0) stopAt = i / 60;
  }
  const g = new Fling(); g.start(300, 300); g.step(1 / 60, out); g.stop(); g.step(1 / 60, out);
  // 幀率不影響總距離：30fps 與 120fps 滑出去的距離差 < 3%
  const dist = fps => { const h = new Fling(), o = { x: 0, z: 0 }; h.start(v, 0); let s = 0; for (let i = 0; i < fps * 2; i++) s += h.step(1 / fps, o).x; return s; };
  const d30 = dist(30), d120 = dist(120);
  check(mono && stopAt > 0 && stopAt <= 0.6 && total >= 0.1 * v && total <= 0.3 * v && out.x === 0 && out.z === 0 && !g.active && Math.abs(d30 - d120) / d120 < 0.03,
    '慣性：每幀遞減、0.6 秒內停、總距離介於 0.1v 與 0.3v、按下歸零、跟幀率無關', `第 ${stopAt.toFixed(2)} 秒停、滑 ${total.toFixed(1)}（v=${v}）；30fps ${d30.toFixed(1)}、120fps ${d120.toFixed(1)}`);
}
{ // 3. 平滑移動：0.4 秒到達目標，中途單調接近
  const gl = new Glide(), out = { x: 0, z: 0 };
  gl.start(5, 5, 20, 12, 10);
  let mono = true, prevD = Infinity;
  for (let i = 0; i <= 20; i++) {   // 0、0.02、…、0.40 秒（用整數算時間，避免浮點累加差一點到不了 0.4）
    const t = 10 + i * 0.02;
    gl.at(t, out); const d = Math.hypot(out.x - 20, out.z - 12);
    if (d > prevD + 1e-9) mono = false; prevD = d;
  }
  const done = Math.hypot(out.x - 20, out.z - 12);
  check(mono && done < 0.01 && !gl.active, '平滑移動：0.4 秒到達目標（誤差 < 0.01 格）、中途單調接近', `最後距離 ${done.toExponential(2)}`);
}
{ // 4. 慣性推鏡頭不會出地圖（照 main.ts：每幀 pan，碰邊就停）
  const v = new BattleView(createWorld(1944), { fx: false, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true }), f = new Fling(), out = { x: 0, z: 0 };
  v.target.set(2, 0, 2);
  f.start(-5000, -5000);
  let outside = false, frames = 0;
  while (f.active && frames < 600) {
    f.step(1 / 60, out);
    const bx = v.target.x, bz = v.target.z;
    v.pan(out.x, out.z, H);
    if (v.target.x < 0 || v.target.z < 0 || v.target.x > N || v.target.z > N) outside = true;
    if ((v.target.x === bx && v.target.z === bz) || v.target.x <= 0 || v.target.z <= 0 || v.target.x >= N || v.target.z >= N) f.stop();
    frames++;
  }
  check(!outside && !f.active, '慣性不把鏡頭推出地圖，碰邊就停', `${frames} 幀後停在 ${v.target.x.toFixed(2)},${v.target.z.toFixed(2)}`);
  v.dispose();
}

if (fails.length) { console.log(`NG camera：${fails.join('、')}`); process.exit(1); }
console.log('camera: all OK');
