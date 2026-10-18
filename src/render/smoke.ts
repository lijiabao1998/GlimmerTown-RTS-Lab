// R107 必要的煙幕標記：只讀世界，復用既有池／舊效果網格，不留下事件驅動的隱藏狀態。
import * as THREE from 'three';
import { SIDE_PLAYER, SUB, UNIT_KINDS, type SmokeCloud, type World } from '../sim/world.ts';
import { SMOKE_CAP, SMOKE_RADIUS } from '../sim/smoke.ts';
import { spotted } from '../sim/step.ts';
import { hash2 } from '../sim/rng.ts';
import type { Pool } from './fx.ts';

export const SMOKE_PUFFS = 5;
const EDGE = [[1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];

// 自己不遮住自己的表面；仍檢查建築、觀測距離及每一團其他煙幕。
// 只有煙團表示能用 ignoreSmokeId，敵軍／曳光等照常走 spotted。
export function smokeSurfaceVisible(w: World, cloud: SmokeCloud): boolean {
  if (spotted(w, SIDE_PLAYER, cloud.x, cloud.z, cloud.id)) return true;
  // 任意角度的最近表面也要取樣，避免剛進入觀測半徑卻落在八方向取樣之間。
  for (const u of w.units) {
    if (!u.alive || u.side !== SIDE_PLAYER) continue;
    const dx = u.x - cloud.x, dz = u.z - cloud.z, d = Math.hypot(dx, dz);
    if (d <= SMOKE_RADIUS || d > UNIT_KINDS[u.kind].sight + SMOKE_RADIUS) continue;
    if (spotted(w, SIDE_PLAYER, cloud.x + Math.round(dx * SMOKE_RADIUS / d), cloud.z + Math.round(dz * SMOKE_RADIUS / d), cloud.id)) return true;
  }
  for (const [dx, dz] of EDGE) {
    if (spotted(w, SIDE_PLAYER, cloud.x + Math.round(dx * SMOKE_RADIUS), cloud.z + Math.round(dz * SMOKE_RADIUS), cloud.id)) return true;
  }
  return false;
}

export class SmokeView {
  clouds = 0;
  puffs = 0;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();

  // 必須在 Pool.update／舊效果寫入之前呼叫，容量吃緊也不會把整團煙幕擠掉。
  update(w: World, on: boolean, fog: boolean, pool: Pool | null, fallback: THREE.InstancedMesh) {
    this.clouds = this.puffs = 0;
    if (!on || !w.smoke) return;
    const radius = SMOKE_RADIUS / SUB;
    for (const cloud of w.smoke.clouds) {
      if (this.clouds >= SMOKE_CAP) break;
      if (w.tick < cloud.born || w.tick >= cloud.expires || (fog && !smokeSurfaceVisible(w, cloud))) continue;
      this.clouds++;
      // 僅用世界 tick，不用畫面 alpha／牆鐘：同 tick、暫停、跳幀與新建畫面完全相同。
      const fade = Math.min(1, (cloud.expires - w.tick) / 20);
      const grow = Math.min(1, 0.6 + (w.tick - cloud.born) / 30), scale = fade * grow;
      for (let i = 0; i < SMOKE_PUFFS; i++) {
        const x = cloud.x / SUB + (i ? EDGE[i - 1][0] * radius * 0.5 : 0);
        const z = cloud.z / SUB + (i ? EDGE[i - 1][1] * radius * 0.5 : 0);
        const r = radius * (i ? 0.5 : 0.68) * scale, sy = (i ? 0.62 : 0.85) * scale;
        const y = sy * 0.85 + hash2(cloud.id, i, 107) * 0.1;
        const grey = i ? 0xc4c4c4 : 0xb8b8b8;
        if (pool) pool.put(x, y, z, r, sy, r, 0, grey);
        else {
          this.tmp.position.set(x, y, z); this.tmp.rotation.set(0, 0, 0); this.tmp.scale.set(r, sy, r); this.tmp.updateMatrix();
          fallback.setMatrixAt(this.puffs, this.tmp.matrix); fallback.setColorAt(this.puffs, this.color.setHex(grey));
        }
        this.puffs++;
      }
    }
  }
}
