// R093 空中支援的畫面（只讀世界）：飛機（照模擬的公式每幀內插）、防空砲的曳光與高射砲煙、被打的飛機拖煙、墜落、我方的目標圈。
// 飛機雙方同一個網格，只上陣營顏色，沒有任何徽記。卡面：docs/tasks/R093-空中支援與防空.md
import * as THREE from 'three';
import { Geo } from './geo.ts';
import { SUB, UNIT_KINDS, type World, type Unit, type Plane93 } from '../sim/world.ts';
import { HOLD93, STRIKE93 } from '../sim/air93.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { Pool } from './fx.ts';

// 防空砲借榴彈砲的網格（battle.ts 的 GUN_SCALE22）：拉高、砲管翹起
export const AA93_GUN: Record<number, [number, number, number]> = { 46: [0.62, 2.1, 0.8] };

const W = new THREE.Color(1, 1, 1), MID = new THREE.Color(0xb8b8b0);
const SIDE93 = [new THREE.Color(0x5d6b3a), new THREE.Color(0x77756c)];   // 跟 battle.ts 的 SIDE_COL 一樣：我方橄欖綠、敵方野戰灰
const CAP = 8;               // 天上最多 4 架，加上正在掉的
const CRASH_S = 1.5;         // 墜落畫多久（秒，照模擬時間）

// 16 個三角形（手機預算只剩幾百個）：機身一個盒子（不畫底面）、主翼、平尾、垂尾各一片（材質兩面都畫）；機頭朝 +x
function planeGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.box(-0.22, 0.0, -0.04, 0.22, 0.07, 0.04, W, MID);                                         // 機身（頂面淺一點，看得出機背）
  g.quad([-0.04, 0.05, -0.3], [0.06, 0.05, -0.3], [0.06, 0.05, 0.3], [-0.04, 0.05, 0.3], [0, 1, 0], W);      // 主翼
  g.quad([-0.22, 0.05, -0.1], [-0.16, 0.05, -0.1], [-0.16, 0.05, 0.1], [-0.22, 0.05, 0.1], [0, 1, 0], W);    // 平尾
  g.quad([-0.22, 0.05, 0], [-0.16, 0.05, 0], [-0.16, 0.15, 0], [-0.22, 0.15, 0], [0, 0, 1], W);              // 垂尾
  return g.geometry();
}

interface Seen { x: number; y: number; z: number; yaw: number; side: number; t: number; end: number; tick: number }
interface Crash { x: number; y: number; z: number; yaw: number; side: number; t0: number; boomed: boolean; puffed: number }

export class Air93View {
  private mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private seen = new Map<number, Seen>();
  private crashes: Crash[] = [];
  private world: World | null = null;
  private flakAt = new Map<number, number>();   // 每門防空砲上一次放黑煙時的開火時間（只對真的 fire 事件放一次）
  private trail = new Map<number, number>();   // 每架飛機上一次噴煙的步數（暫停時不會每一幀都噴）
  constructor(scene: THREE.Scene, ramp: THREE.Texture) {
    this.mesh = new THREE.InstancedMesh(planeGeo(), new THREE.MeshToonMaterial({ gradientMap: ramp, vertexColors: true, side: THREE.DoubleSide }), CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this.mesh.setColorAt(0, SIDE93[0]);
    this.dummy.rotation.order = 'YZX';
    scene.add(this.mesh);
  }

  // 位置（格）、高度（格）、朝向、俯仰：用 t − 1 + alpha 內插，暫停、加速、重播都一致
  private pose(p: Plane93, tau: number): [number, number, number, number, number] {
    const H = HOLD93[p.kind], strike = p.kind === STRIKE93, sx = p.sx / SUB, sz = p.sz / SUB, tx = p.tx / SUB, tz = p.tz / SUB;
    const cruise = strike ? 2.4 : 1.8, out = Math.atan2(-(tz - sz), tx - sx), back = out + Math.PI;
    if (tau <= p.T) { const f = Math.max(0, tau) / p.T; return [sx + (tx - sx) * f, cruise, sz + (tz - sz) * f, out, 0]; }
    if (tau <= p.T + H) {
      const k = (tau - p.T) / H;
      if (strike) return [tx, cruise - 1.7 * k, tz, out, -0.9];   // 俯衝：降到 0.7 格，機頭朝下
      const a = (tau - p.T) * 0.05;                              // 偵察：繞目標半徑 1.2 格（只是畫面）
      return [tx + Math.cos(a) * 1.2, cruise, tz - Math.sin(a) * 1.2, a + Math.PI / 2, 0];
    }
    const f = Math.min(1, (tau - p.T - H) / p.T), climb = strike ? Math.min(1, (tau - p.T - H) / Math.max(1, p.T * 0.3)) : 1;
    return [tx + (sx - tx) * f, strike ? 0.7 + 1.7 * climb : cruise, tz + (sz - tz) * f, back, strike ? 0.5 * (1 - climb) : 0];
  }

  private put(i: number, x: number, y: number, z: number, yaw: number, pitch: number, side: number): void {
    const d = this.dummy;
    d.position.set(x, y, z); d.rotation.set(0, yaw, pitch); d.scale.set(1, 1, 1); d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix); this.mesh.setColorAt(i, SIDE93[side] ?? SIDE93[0]);
  }

  // fired(id)：那個單位最後一次真的開火（fire 事件）的模擬時間（battle.ts 的 fire44）；曳光和黑煙只看這個，不從冷卻值猜（卸砲、受壓時冷卻也會停在 reload）
  paint(w: World, simT: number, alpha: number, view: { visibleUnit(u: Unit): boolean }, fired: (id: number) => number, glow: Pool | null, puff: Pool | null): void {
    if (this.world !== w) { this.world = w; this.seen.clear(); this.crashes = []; this.flakAt.clear(); this.trail.clear(); }
    const planes = w.sky?.planes ?? [], now = new Set<number>();
    let n = 0;
    for (const p of planes) {
      if (p.t < 0) continue;   // 還沒進地圖：雙方都不畫
      const [x, y, z, yaw, pitch] = this.pose(p, p.t - 1 + alpha);
      if (n < CAP) this.put(n++, x, y, z, yaw, pitch, p.side);
      now.add(p.id);
      this.seen.set(p.id, { x, y, z, yaw, side: p.side, t: p.t, end: 2 * p.T + HOLD93[p.kind], tick: w.tick });
      if (puff && p.hp < (p.kind === STRIKE93 ? 100 : 60) && w.tick % 4 === 0 && this.trail.get(p.id) !== w.tick) this.trail.set(p.id, w.tick), puff.spawn({ x, y, z, t0: simT, life: 1.4, s0: 0.06, s1: 0.22, c0: 0x3a3632, c1: 0x6a6660, g: -0.05 });   // 受傷拖煙
      if (p.side === SIDE_PLAYER && p.t <= p.T + HOLD93[p.kind] && glow) glow.put(p.tx / SUB, 0.04, p.tz / SUB, 0.85, 0.01, 0.85, 0, p.kind === STRIKE93 ? 0xff9a50 : 0x9ad0ff, 0.45);   // 我方的目標圈
    }
    for (const p of planes) if (p.t < 0 && p.side === SIDE_PLAYER && glow) glow.put(p.tx / SUB, 0.04, p.tz / SUB, 0.85, 0.01, 0.85, 0, p.kind === STRIKE93 ? 0xff9a50 : 0x9ad0ff, 0.45);
    // 上一幀還在、還沒飛完就不見了：被打下來，畫墜落（只在畫面上，地面不受傷害）
    for (const [id, s] of this.seen) if (!now.has(id)) {
      if (s.t + (w.tick - s.tick) < s.end) this.crashes.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, side: s.side, t0: simT, boomed: false, puffed: -1 });
      this.seen.delete(id);
    }
    this.crashes = this.crashes.filter(c => simT - c.t0 < CRASH_S + 0.5);
    for (const id of this.trail.keys()) if (!now.has(id)) this.trail.delete(id);
    for (const c of this.crashes) {
      const k = Math.min(1, (simT - c.t0) / CRASH_S), y = c.y * (1 - k * k);
      if (k < 1 && n < CAP) this.put(n++, c.x + Math.cos(c.yaw) * k * 1.2, y, c.z - Math.sin(c.yaw) * k * 1.2, c.yaw, -0.6 * k, c.side);
      const step20 = Math.floor((simT - c.t0) * 20);   // 照模擬時間每 2 步一團；暫停時不會每一幀都噴
      if (k < 1 && puff && step20 % 2 === 0 && c.puffed !== step20) c.puffed = step20, puff.spawn({ x: c.x, y, z: c.z, t0: simT, life: 1.2, s0: 0.08, s1: 0.3, c0: 0x2c2926, c1: 0x5c5852, g: -0.08 });
      if (k >= 1 && !c.boomed) { c.boomed = true; glow?.spawn({ x: c.x + Math.cos(c.yaw) * 1.2, y: 0.1, z: c.z - Math.sin(c.yaw) * 1.2, t0: simT, life: 0.35, s0: 0.2, s1: 0.7, c0: 0xffd28a, c1: 0xff6020 }); }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (!planes.length || (!glow && !puff)) return;
    // 防空砲：真的開火之後 3 步內畫曳光；每一發在被打的飛機旁放一團黑煙。看不到的敵方防空砲不畫
    for (const u of w.units) {
      const k = UNIT_KINDS[u.kind], a = k.aa;
      const f = fired(u.id);
      if (!a || !u.alive || u.towBy || simT - f >= 3 / 20 || !view.visibleUnit(u)) continue;
      let best: Plane93 | null = null, bd = 0;
      for (const p of planes) {
        if (p.side === u.side || p.t < 0) continue;
        const dx = p.x - u.x, dz = p.z - u.z, d2 = dx * dx + dz * dz;
        if (d2 <= a * a && (!best || d2 < bd || (d2 === bd && p.id < best.id))) { best = p; bd = d2; }
      }
      if (!best) continue;
      const [px, py, pz] = this.pose(best, best.t - 1 + alpha), gx = u.x / SUB, gz = u.z / SUB, yaw = Math.atan2(-(pz - gz), px - gx);
      if (glow) for (let i = 1; i <= 3; i++) { const f = (i / 4 + (simT * 3) % 0.25) % 1; glow.put(gx + (px - gx) * f, 0.25 + (py - 0.25) * f, gz + (pz - gz) * f, 0.05, 0.05, 0.05, yaw, 0xffe9a8); }
      if (puff && this.flakAt.get(u.id) !== f) this.flakAt.set(u.id, f), puff.spawn({ x: px + Math.sin(u.id) * 0.3, y: py + 0.1, z: pz + Math.cos(u.id) * 0.3, t0: simT, life: 1.6, s0: 0.1, s1: 0.32, c0: 0x26241f, c1: 0x55524c, g: -0.03 });
    }
  }
}
