// R087 更多房屋：電腦對電腦長跑（卡面驗收第 16 條）。地圖 0–4、種子 1–3、6000 步、新開的局（more＝1、sym＝1）、
// 第二版對第二版與第三版對第三版：不出錯、種子 1 跑兩次雜湊一樣；印出新房子被駐守了幾次（寫在卡面）。群組本身在 tests/more-houses.mjs。
import { groups } from './more-houses.mjs';
const t0 = performance.now();
groups.soak();
console.log(`OK more-houses-soak (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
