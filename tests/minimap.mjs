// R015 小地圖守衛（Node）：地圖格 ↔ 小地圖座標來回、四個角在畫布內、方向跟主畫面一樣、點的清單（我方全部、敵方只有看得到的、死的不畫）。
import { createWorld, N, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { miniGeo, toMini, fromMini, miniDots } from '../src/ui/minimap.ts';
import { BattleView } from '../src/render/battle.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
{ // 1. 來回誤差、四角在畫布內
  const g = miniGeo(200);
  let worst = 0;
  for (let x = 0; x <= N; x += 0.7) for (let z = 0; z <= N; z += 0.9) { const [px, py] = toMini(g, x, z), [bx, bz] = fromMini(g, px, py); worst = Math.max(worst, Math.hypot(bx - x, bz - z)); }
  const corners = [[0, 0], [N, 0], [N, N], [0, N]].map(([x, z]) => toMini(g, x, z));
  const inside = corners.every(([px, py]) => px >= -1e-9 && py >= -1e-9 && px <= g.w + 1e-9 && py <= g.h + 1e-9);
  check(worst < 0.01 && inside && g.h === g.w / 2, '地圖格 ↔ 小地圖座標來回誤差 < 0.01 格；四個角在畫布內（高＝寬的一半）', `最大誤差 ${worst.toExponential(2)}；角 ${corners.map(c => c.map(v => v.toFixed(0)).join(',')).join(' ')}`);
}
{ // 2. 方向跟主畫面一樣：主畫面往右＝世界 (+x,−z)，往上＝世界 (−x,−z)（battle.ts 的 pan）
  const g = miniGeo(200), [cx, cy] = toMini(g, 16, 16), [rx, ry] = toMini(g, 17, 15), [ux, uy] = toMini(g, 15, 15);
  check(rx > cx && Math.abs(ry - cy) < 1e-9 && uy < cy && Math.abs(ux - cx) < 1e-9, '小地圖的右與上跟主畫面一樣', `右 (${(rx - cx).toFixed(2)},${(ry - cy).toFixed(2)})，上 (${(ux - cx).toFixed(2)},${(uy - cy).toFixed(2)})`);
}
{ // 3. 點的清單：我方全部活著的；敵方只有看得到的；死掉的不畫
  const w = createWorld(1944), v = new BattleView(w, false, true, true, true, true, true, true, true);
  const mine = w.units.filter(u => u.side === SIDE_PLAYER);
  mine[0].alive = false;
  const dots = miniDots(w, u => v.visibleUnit(u));
  const seenFoes = w.units.filter(u => u.side === SIDE_ENEMY && u.alive && v.visibleUnit(u)).length;
  const allFoes = miniDots(w, () => true).filter(d => d.side === SIDE_ENEMY).length;
  const okMine = dots.filter(d => d.side === SIDE_PLAYER).length === mine.length - 1;
  const okFoes = dots.filter(d => d.side === SIDE_ENEMY).length === seenFoes && seenFoes < allFoes;
  check(okMine && okFoes, '點：我方活著的全部、死掉的不畫；敵方只有看得到的', `我方 ${dots.filter(d => d.side === 0).length}/${mine.length}（一台死了）；敵方 ${dots.filter(d => d.side === 1).length}（看得到 ${seenFoes}、全部 ${allFoes}）`);
  v.dispose();
}
if (fails.length) { console.log(`NG minimap：${fails.join('、')}`); process.exit(1); }
console.log('minimap: all OK');
