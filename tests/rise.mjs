// R016 開戰儀式守衛（Node）：布陣的房子開戰後先在升起網格、從地面下往上冒，升完併回城鎮網格；地圖原本的房子不受影響；閥關時直接出現；畫面只讀世界。
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { enemyPlan } from '../src/sim/build.ts';
import { buildTown, wallHeight, ROOF_RISE } from '../src/render/buildings.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
// 第 0 步：我方一棟磚房＋敵方布陣
const cmds = [{ t: 'build', side: 0, kind: 0, x: 23, z: 20 }, ...enemyPlan(createWorld(1944))];
const ghostTop = v => { const g = v.ghosts?.mesh.geometry, n = g ? g.drawRange.count : 0, p = g?.attributes.position.array; let top = -Infinity; for (let i = 0; i < n; i++) top = Math.max(top, p[i * 3 + 1]); return { n, top }; };
function play(r016) {
  const w = createWorld(1944), v = new BattleView(w, { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: r016 });
  v.snapshot(); step(w, cmds); v.onEvents(w.events, w.tick / 20);
  return { w, v };
}
{ // 1. 0.1 秒：布陣的房子不在城鎮網格、在升起網格，而且在地面下；0.35 秒比 0.1 秒高；0.8 秒後併回去
  const { w, v } = play(true), t0 = w.tick / 20, built = w.blds.filter(b => b.builtBy !== undefined);
  const fullTris = buildTown(w).triangles, noneTris = buildTown(w, b => b.builtBy !== undefined).triangles;
  const H = Math.max(...built.map(b => wallHeight(b) + (ROOF_RISE[b.kind] ?? 0.32)));
  v.update(0, t0 + 0.1, new Set()); const a = ghostTop(v), townA = v.townTriangles, risingA = v.risingCount;
  v.update(0, t0 + 0.35, new Set()); const b = ghostTop(v);
  v.update(0, t0 + 0.8, new Set()); const c = ghostTop(v), townC = v.townTriangles;
  check(built.length >= 2 && risingA === built.length && townA === noneTris && a.n > 0 && a.top < H && b.top > a.top && c.n === 0 && townC === fullTris && v.risingCount === 0,
    '開戰後：布陣的房子先在升起網格（地面下往上冒），0.8 秒後併回城鎮網格', `布陣 ${built.length} 棟；0.1 秒 城鎮 ${townA}（不含布陣 ${noneTris}）、升起頂點 ${a.n}、最高 ${a.top.toFixed(2)}（完整 ${H.toFixed(2)}）；0.35 秒最高 ${b.top.toFixed(2)}；0.8 秒 城鎮 ${townC}（全部 ${fullTris}）`);
  v.dispose();
}
{ // 2. 地圖原本的房子不受影響：開戰當下城鎮網格就含全部原本的房子
  const { w, v } = play(true), orig = w.blds.filter(b => b.builtBy === undefined).length;
  v.update(0, w.tick / 20 + 0.05, new Set());
  const expect = buildTown(w, b => b.builtBy !== undefined).triangles;
  check(orig > 10 && v.townTriangles === expect, '地圖原本的房子不受影響（開戰當下都在城鎮網格）', `原本 ${orig} 棟；城鎮 ${v.townTriangles}／應為 ${expect}`);
  v.dispose();
}
{ // 3. ?noR016：開戰當下城鎮網格就含全部、沒有升起；畫面只讀世界
  const { w, v } = play(false);
  v.update(0, w.tick / 20 + 0.05, new Set());
  const ok = v.townTriangles === buildTown(w).triangles && v.risingCount === 0 && ghostTop(v).n === 0;
  const on = play(true);
  for (let k = 0; k < 40; k++) { on.v.snapshot(); step(on.w, []); on.v.onEvents(on.w.events, on.w.tick / 20); on.v.update(0, on.w.tick / 20, new Set()); }
  const plain = runLog(createWorld(1944), cmds.map(cmd => ({ tick: 0, cmd })), 41);
  check(ok && hashWorld(on.w) === hashWorld(plain), '?noR016：房子直接出現；畫面只讀世界', `閥關城鎮 ${v.townTriangles}；雜湊 ${hashWorld(on.w)} / ${hashWorld(plain)}`);
  v.dispose(); on.v.dispose();
}
if (fails.length) { console.log(`NG rise：${fails.join('、')}`); process.exit(1); }
console.log('rise: all OK');
