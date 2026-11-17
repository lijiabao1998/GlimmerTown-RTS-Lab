// R087 更多房屋：布陣還有地方（卡面驗收第 7 條）。電腦的布陣在帶 more 時花完 8 點的種子數不比沒帶時少、沒帶時逐位跟 R087 之前一樣；
// 每一種能布的東西在每張地圖上至少 20 個合法的我方位置。群組本身在 tests/more-houses.mjs（電腦的布陣 1000 次，單獨一支才在 120 秒內）。
import { groups } from './more-houses.mjs';
const t0 = performance.now();
groups.planner();
console.log(`OK more-houses-planner (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
