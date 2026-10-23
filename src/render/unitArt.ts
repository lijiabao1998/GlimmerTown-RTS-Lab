// 單位的程序化模型：本地座標朝 +x。頂點色白色的部分吃實例色（陣營色），深色部分（履帶、輪子）保持深色。
import * as THREE from 'three';
import { Geo } from './geo.ts';

const W = new THREE.Color(1, 1, 1), DARK = new THREE.Color(0x2c2a26), MID = new THREE.Color(0xb8b8b0), STEEL = new THREE.Color(0x55575a);

export function tankHull(): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.29, 0.0, -0.17, 0.29, 0.09, -0.1, DARK);       // 左履帶
  g.box(-0.29, 0.0, 0.1, 0.29, 0.09, 0.17, DARK);         // 右履帶
  g.box(-0.27, 0.05, -0.15, 0.27, 0.15, 0.15, W);         // 車體
  g.box(0.2, 0.05, -0.13, 0.31, 0.12, 0.13, W);           // 斜前裝甲
  g.box(-0.29, 0.12, -0.08, -0.22, 0.16, 0.08, MID);      // 引擎蓋
  return g.geometry();
}

export function tankTurret(): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.12, 0.15, -0.1, 0.1, 0.24, 0.1, W);            // 砲塔
  g.box(-0.05, 0.24, -0.04, 0.03, 0.27, 0.04, MID);       // 車長艙蓋
  g.box(0.1, 0.18, -0.022, 0.42, 0.21, 0.022, STEEL);     // 砲管
  return g.geometry();
}

export function howitzer(): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.06, 0.0, -0.17, 0.06, 0.13, -0.11, DARK);      // 輪
  g.box(-0.06, 0.0, 0.11, 0.06, 0.13, 0.17, DARK);
  g.box(-0.05, 0.05, -0.11, 0.05, 0.1, 0.11, W);          // 輪軸
  g.box(-0.02, 0.05, -0.12, 0.03, 0.2, 0.12, W);          // 防盾
  const trail = new Geo();
  trail.box(-0.36, 0.0, -0.02, 0.0, 0.04, 0.02, W);       // 架尾（兩條，張開）
  g.merge(trail, new THREE.Matrix4().makeRotationY(0.28));
  g.merge(trail, new THREE.Matrix4().makeRotationY(-0.28));
  const barrel = new Geo();
  barrel.box(0.0, -0.022, -0.022, 0.42, 0.022, 0.022, STEEL);
  barrel.box(-0.08, -0.035, -0.035, 0.06, 0.035, 0.035, MID);   // 砲閂
  g.merge(barrel, new THREE.Matrix4().makeTranslation(0.0, 0.14, 0).multiply(new THREE.Matrix4().makeRotationZ(0.42)));
  return g.geometry();
}

// A radio operator with pack, helmet and binoculars; no external insignia.
export function observer(detail = true): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.07, 0.02, -0.09, 0.07, 0.18, -0.02, DARK);
  g.box(-0.07, 0.02, 0.02, 0.07, 0.18, 0.09, DARK);
  g.box(-0.08, 0.18, -0.1, 0.08, 0.38, 0.1, W);
  g.box(-0.07, 0.38, -0.07, 0.07, 0.49, 0.07, MID);
  if (detail) {
    g.box(-0.1, 0.47, -0.1, 0.1, 0.52, 0.1, W);
    g.box(-0.14, 0.2, -0.08, -0.08, 0.38, 0.08, DARK);
    g.box(-0.12, 0.38, -0.04, -0.11, 0.68, -0.03, STEEL);
    g.box(0.07, 0.38, -0.07, 0.17, 0.42, 0.07, DARK);
  }
  return g.geometry();
}

// R021 步兵：一個小兵（約觀測員的六成高）——綁腿、軍服（吃陣營色）、背包、頭盔、步槍；本地座標朝 +x。不畫任何徽記。
export function soldier(detail = true): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.03, 0, -0.045, 0.03, 0.1, -0.01, DARK);        // 腿
  g.box(-0.03, 0, 0.01, 0.03, 0.1, 0.045, DARK);
  g.box(-0.04, 0.1, -0.05, 0.04, 0.22, 0.05, W);          // 身體
  if (detail) g.box(-0.07, 0.11, -0.04, -0.04, 0.2, 0.04, DARK);      // 背包
  g.box(-0.03, 0.22, -0.03, 0.03, 0.28, 0.03, MID);       // 臉
  if (detail) {
    g.box(-0.05, 0.27, -0.05, 0.05, 0.3, 0.05, W);          // 頭盔（淺盆形，用陣營色）
    g.box(0.02, 0.15, 0.045, 0.2, 0.17, 0.06, STEEL);       // 步槍
  }
  return g.geometry();
}
