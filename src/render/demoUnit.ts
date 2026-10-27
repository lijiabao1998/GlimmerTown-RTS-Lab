// R903 示範單位：程序生成的半履帶車，示範風格指南（docs/風格指南.md）的做法。本地座標朝 +x。
// 白色部分吃實例色（陣營色），深色（履帶、輪）與鋼色（機槍）保持原色；不畫任何徽記。
// 逃生閥：DEMO_UNIT_ENABLED 預設 false，而且這個檔目前沒有被任何總機 import，畫面與模擬都不受影響。
import * as THREE from 'three';
import { Geo } from './geo.ts';

/** 關閉開關：false＝不建模型（預設）。接進畫面時要改成讀 src/valves.ts 的 ?noR903 閥。 */
export const DEMO_UNIT_ENABLED = false;

// 色碼全部沿用 unitArt.ts 已有的值，不新增調色。
const W = new THREE.Color(1, 1, 1), DARK = new THREE.Color(0x2c2a26), MID = new THREE.Color(0xb8b8b0), STEEL = new THREE.Color(0x55575a);

/** 半履帶車：前輪＋後履帶、開頂車廂、車頭引擎蓋、一挺機槍。12 個方塊＝144 個三角形。 */
export function halftrack(enabled = DEMO_UNIT_ENABLED): THREE.BufferGeometry | null {
  if (!enabled) return null;
  const g = new Geo();
  g.box(-0.26, 0.0, -0.16, 0.02, 0.08, -0.1, DARK);       // 左履帶（後半）
  g.box(-0.26, 0.0, 0.1, 0.02, 0.08, 0.16, DARK);         // 右履帶
  g.box(0.14, 0.0, -0.15, 0.22, 0.08, -0.1, DARK);        // 左前輪
  g.box(0.14, 0.0, 0.1, 0.22, 0.08, 0.15, DARK);          // 右前輪
  g.box(-0.27, 0.06, -0.13, 0.08, 0.1, 0.13, W);          // 車廂地板
  g.box(-0.27, 0.1, -0.13, 0.08, 0.2, -0.11, W);          // 左廂板
  g.box(-0.27, 0.1, 0.11, 0.08, 0.2, 0.13, W);            // 右廂板
  g.box(-0.27, 0.1, -0.11, -0.25, 0.2, 0.11, W);          // 後廂板
  g.box(0.08, 0.06, -0.1, 0.3, 0.16, 0.1, W);             // 引擎蓋
  g.box(0.06, 0.16, -0.12, 0.09, 0.24, 0.12, MID);        // 擋風板（亮一階，剪影的頭）
  g.box(0.0, 0.2, -0.01, 0.05, 0.26, 0.01, STEEL);        // 機槍座
  g.box(0.03, 0.24, -0.012, 0.2, 0.26, 0.012, STEEL);     // 機槍管（剪影往前伸）
  return g.geometry();
}
