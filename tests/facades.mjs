// R028 外牆細節守衛：固定、三種都出現、關掉跟原樣逐頂點相同、不改外框與屋頂高度、整張 Rye 三角形在預算內。
import { createWorld, BK_HOUSE, BK_SHOP, STAGE_INTACT } from '../src/sim/world.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { buildingGeo, buildTown, facadeStyle, setFacades, FAC_TIMBER, FAC_TILE, FAC_BOARD } from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';

const ORIG_FP = ['fc43cc18', '2eb8beb0'];   // R028 之前的模型（亂數村莊、Rye）
const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const w = createWorld(1944); applyMap(w, MAP_RYE);
const geo = b => buildingGeo(new Geo(), b, STAGE_INTACT);
const bounds = g => { const m = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { m[k] = Math.min(m[k], g.pos[i + k]); m[k + 3] = Math.max(m[k + 3], g.pos[i + k]); } return m; };
const tris = g => g.pos.length / 9;

setFacades(true);
const on = w.blds.map(b => JSON.stringify(geo(b).pos)), on2 = w.blds.map(b => JSON.stringify(geo(b).pos)), styles = new Set(w.blds.map(facadeStyle));
const onB = w.blds.map(b => bounds(geo(b))), townOn = tris(buildTown(w));
setFacades(false);
const off = w.blds.map(b => JSON.stringify(geo(b).pos)), offB = w.blds.map(b => bounds(geo(b))), townOff = tris(buildTown(w));
// 關掉時跟 R028 之前的模型逐頂點相同：指紋是用 R028 之前的 buildings.ts 對同一個世界算出來的（亂數村莊、Rye 各一個）
const fp = g => { let h = 2166136261; const s = JSON.stringify([g.pos, g.col, g.nor]); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16); };
const plain = createWorld(1944), fpOff = [fp(buildTown(plain)), fp(buildTown(w))];
setFacades(true);

check(on.every((s, i) => s === on2[i]) && styles.has(FAC_TIMBER) && styles.has(FAC_TILE) && styles.has(FAC_BOARD), '固定：同一棟每次畫一樣；Rye 上木構、掛瓦、護牆板都有',
  `外牆種類 ${[...styles].sort()}`);
const changed = w.blds.filter((b, i) => on[i] !== off[i]).length, houses = w.blds.filter(b => b.kind === BK_HOUSE || b.kind === BK_SHOP).length;
check(changed > 0 && townOff < townOn && w.blds.every(b => facadeStyle(b) === 0 || on[w.blds.indexOf(b)] !== off[w.blds.indexOf(b)]), '開關：有外牆的房子畫得跟原樣不同、關掉後三角形變少', `變了 ${changed}／${w.blds.length} 棟（磚房與店面 ${houses}）；三角形 ${townOff} → ${townOn}`);
let worst = 0, roofSame = true;
w.blds.forEach((b, i) => { for (let k = 0; k < 6; k++) { const d = k < 3 ? offB[i][k] - onB[i][k] : onB[i][k] - offB[i][k]; worst = Math.max(worst, d); } if (Math.abs(onB[i][4] - offB[i][4]) > 1e-9) roofSame = false; });
check(worst <= 0.02 && roofSame, '外框：外牆細節最多外擴 0.02 格、屋頂高度不變', `最多外擴 ${worst.toFixed(4)} 格；屋頂一樣 ${roofSame}`);
check(townOn <= 40000, '預算：整張 Rye 的城鎮網格三角形 ≤ 40,000', `${townOn}`);
check(fpOff[0] === ORIG_FP[0] && fpOff[1] === ORIG_FP[1], '關掉：亂數村莊與 Rye 的城鎮網格跟 R028 之前逐頂點相同', `${fpOff}（原樣 ${ORIG_FP}）`);
if (fails.length) { console.log(`NG facades：${fails.join('、')}`); process.exit(1); }
console.log('facades: all OK');
