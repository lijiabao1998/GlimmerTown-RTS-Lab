// ======== R014 牆上的彈孔與燻黑（R063 從 battle.ts 搬出，畫法逐行不變）========
// 穿甲彈打進牆的那一面留彈孔、高爆彈在附近的牆留燻黑；環狀覆寫最舊的；看不到的命中不留（方向會洩漏射手位置）。
// R139：瓦礫不再長出牆面彈痕（與 R014 的閥獨立，畫面上的 rubbleMarkGuard）。
import * as THREE from 'three';
import { SUB, UK_HOWITZER, SHELL_HE, SHELL_AP, stageOf, STAGE_RUBBLE, STAGE_INTACT, UNIT_KINDS, type Building, type SimEvent, type World } from '../sim/world.ts';
import { hash2 } from '../sim/rng.ts';
import { bldColors, wallHeight, wallShown, wallBounds } from './buildings.ts';
import type { MakeInst, Sight } from './painter.ts';

export const HOLE_CAP = 160;                 // R014 牆上痕跡最多幾個（滿了丟最舊的）
const C_HOLE = 0x1b1713, C_SOOT = 0x2a2521;

export class WallMarks {
  mesh: THREE.InstancedMesh | null = null;   // ?noR014=1 時不建
  // 痕跡：環狀覆寫最舊的；kind 0＝彈孔（深色孔＋淺色碎灰泥兩片）、1＝燻黑
  readonly holes = { next: 0, live: new Uint8Array(HOLE_CAP), bld: new Int32Array(HOLE_CAP), kind: new Uint8Array(HOLE_CAP), x: new Float32Array(HOLE_CAP), y: new Float32Array(HOLE_CAP), z: new Float32Array(HOLE_CAP), nx: new Int8Array(HOLE_CAP), nz: new Int8Array(HOLE_CAP), w: new Float32Array(HOLE_CAP), h: new Float32Array(HOLE_CAP), r: new Float32Array(HOLE_CAP), g: new Float32Array(HOLE_CAP), b: new Float32Array(HOLE_CAP) };
  private holesDirty = false;
  holeSeq = 0;
  rubbleMarkGuard = true; // R139：只管瓦礫彈痕；與既有 R014 開關獨立。
  // 每一步之前記下在飛、會打中建築的穿甲彈（彈著事件沒有射手位置）
  private apSnap: { n: number; sx: Float64Array; sz: Float64Array; ex: Float64Array; ez: Float64Array; bld: Int32Array };
  private tmp: THREE.Object3D;
  private color = new THREE.Color();

  constructor(maxShells: number, tmp: THREE.Object3D) {
    this.tmp = tmp;
    this.apSnap = { n: 0, sx: new Float64Array(maxShells), sz: new Float64Array(maxShells), ex: new Float64Array(maxShells), ez: new Float64Array(maxShells), bld: new Int32Array(maxShells) };
  }

  build(inst: MakeInst, mat: THREE.Material) {
    this.mesh = inst(new THREE.PlaneGeometry(1, 1), mat, HOLE_CAP * 2, false);
    this.mesh.receiveShadow = true;
  }

  get count() { let c = 0; for (let i = 0; i < HOLE_CAP; i++) c += this.holes.live[i]; return c; }

  // 每一步之前：記下會打中建築的穿甲彈從哪裡打來
  snapshot(w: World) {
    const a = this.apSnap, cap = a.bld.length; a.n = 0;
    for (const sh of w.shells) if (sh.kind === SHELL_AP && sh.hitBld && a.n < cap) { a.sx[a.n] = sh.sx; a.sz[a.n] = sh.sz; a.ex[a.n] = sh.ex; a.ez[a.n] = sh.ez; a.bld[a.n] = sh.hitBld; a.n++; }
  }

  onEvents(w: World, events: SimEvent[], view: Sight) {
    const H = this.holes;
    for (const e of events) {
      if (e.e === 'impact' && e.kind === SHELL_AP && e.bld) {
        const b = w.blds[e.bld - 1], a = this.apSnap;
        if (!b || !view.visibleAt(e.x, e.z)) continue;          // 看不到的命中不留痕跡（方向會洩漏射手位置）
        for (let i = 0; i < a.n; i++) {
          if (a.bld[i] !== e.bld || a.ex[i] !== e.x || a.ez[i] !== e.z) continue;
          this.mark14(b, 0, a.sx[i] / SUB, a.sz[i] / SUB, e.x / SUB, e.z / SUB);
          break;
        }
      } else if (e.e === 'impact' && e.kind === SHELL_HE) {
        if (!view.visibleAt(e.x, e.z)) continue;
        const R = (e.r ?? UNIT_KINDS[UK_HOWITZER].splash) / SUB, ix = e.x / SUB, iz = e.z / SUB;
        for (const b of w.blds) {
          if (b.hp <= 0) continue;
          const cx = Math.max(b.x, Math.min(b.x + b.w, ix)), cz = Math.max(b.z, Math.min(b.z + b.d, iz));
          if (Math.hypot(cx - ix, cz - iz) > R + 0.5) continue;
          this.mark14(b, 1, ix, iz, b.x + b.w / 2, b.z + b.d / 2);
        }
      } else if (e.e === 'stage') {
        const b = w.blds[e.bld - 1];
        const keepBelow = e.stage === STAGE_RUBBLE ? -1 : wallHeight(b) * 0.72 * 0.7;   // 空殼的牆頂是鋸齒（七成到十成）
        for (let i = 0; i < HOLE_CAP; i++) if (H.live[i] && H.bld[i] === b.id && H.y[i] + H.h[i] / 2 * (wallShown(b) && H.kind[i] === 0 ? 1.55 : 1) > keepBelow) { H.live[i] = 0; this.holesDirty = true; }
      }
    }
    if (this.holesDirty) this.rebuild14();
  }

  // 從 (sx,sz) 往 (ex,ez) 的直線打進建築的牆（模型的牆內縮 0.1 格；教堂只算中殿），落在進入的那一面
  private mark14(b: Building, kind: number, sx: number, sz: number, ex: number, ez: number) {
    const { x0, x1, z0, z1 } = wallBounds(b);
    if (wallShown(b) && b.hp <= 0) return;
    const dx = ex - sx, dz = ez - sz;
    let tIn = -Infinity, tOut = Infinity, axis = -1;
    for (const [s0, d, lo, hi, ax] of [[sx, dx, x0, x1, 0], [sz, dz, z0, z1, 1]] as const) {
      if (Math.abs(d) < 1e-9) { if (s0 < lo || s0 > hi) return; continue; }
      let t1 = (lo - s0) / d, t2 = (hi - s0) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tIn) { tIn = t1; axis = ax; }
      tOut = Math.min(tOut, t2);
    }
    if (axis < 0 || tIn > tOut || tIn < 0) return;                 // 射手在牆裡面、或打不到這棟
    const seq = this.holeSeq++, hh = (k: number) => hash2(b.id * 977 + seq, k, 141);
    // R139：保留既有有效射線的序號，後續存活建築彈痕不變；瓦礫不再佔用痕跡池。
    if (this.rubbleMarkGuard && b.hp <= 0) return;
    let px = sx + dx * tIn, pz = sz + dz * tIn;
    const nx = axis === 0 ? (dx > 0 ? -1 : 1) : 0, nz = axis === 1 ? (dz > 0 ? -1 : 1) : 0;
    // 沿牆面錯開一點（同一個方向連打不會疊成一個點），夾在牆面內
    if (axis === 0) pz = Math.max(z0 + 0.08, Math.min(z1 - 0.08, pz + (hh(1) - 0.5) * 0.3)); else px = Math.max(x0 + 0.08, Math.min(x1 - 0.08, px + (hh(1) - 0.5) * 0.3));
    const top = stageOf(b) === STAGE_INTACT ? wallHeight(b) : wallHeight(b) * 0.72 * 0.7;
    const H = this.holes, i = H.next;
    H.next = (H.next + 1) % HOLE_CAP;
    H.live[i] = 1; H.bld[i] = b.id; H.kind[i] = kind; H.x[i] = px; H.z[i] = pz; H.nx[i] = nx; H.nz[i] = nz;
    if (kind === 0) { H.w[i] = 0.13 + 0.05 * hh(2); H.h[i] = 0.1 + 0.04 * hh(3); H.y[i] = 0.1 + hh(4) * Math.max(0.02, top - 0.2); }
    else { H.w[i] = 0.28 + 0.12 * hh(2); H.h[i] = Math.min(0.24, top * 0.6); H.y[i] = H.h[i] / 2 + 0.01; }
    if (wallShown(b)) {
      // AP 外圈也必須留在窄牆端面／低矮缺口內，不能只夾住中心點。
      const scale = kind === 0 ? 1.55 : 1, lo = axis === 0 ? z0 : x0, hi = axis === 0 ? z1 : x1;
      H.w[i] = Math.min(H.w[i], (hi - lo - 0.012) / scale); H.h[i] = Math.min(H.h[i], (top - 0.012) / scale);
      const half = H.w[i] * scale / 2 + 0.006;
      if (axis === 0) H.z[i] = Math.max(lo + half, Math.min(hi - half, H.z[i])); else H.x[i] = Math.max(lo + half, Math.min(hi - half, H.x[i]));
      H.y[i] = Math.max(H.h[i] * scale / 2 + 0.006, Math.min(top - H.h[i] * scale / 2 - 0.006, H.y[i]));
    }
    const wall = bldColors(b.kind).wall;
    H.r[i] = wall.r + (1 - wall.r) * 0.35; H.g[i] = wall.g + (1 - wall.g) * 0.35; H.b[i] = wall.b + (1 - wall.b) * 0.35;   // 碎掉的灰泥：牆色偏亮
    this.holesDirty = true;
  }

  // 痕跡有變才重寫實例（不是每幀）：彈孔兩片（外圈淺色碎灰泥、裡面深色孔），燻黑一片
  private rebuild14() {
    const H = this.holes, m = this.tmp, mesh = this.mesh!;
    let n = 0;
    for (let k = 0; k < HOLE_CAP; k++) {
      const i = (H.next + k) % HOLE_CAP;                              // 從最舊的開始畫，新的疊在上面
      if (!H.live[i]) continue;
      const yaw = H.nx[i] ? (H.nx[i] > 0 ? Math.PI / 2 : -Math.PI / 2) : (H.nz[i] > 0 ? 0 : Math.PI);
      const layers = H.kind[i] === 0 ? 2 : 1;
      for (let l = 0; l < layers; l++) {
        const off = 0.006 + 0.003 * l, sc = H.kind[i] === 0 && l === 0 ? 1.55 : 1;
        m.position.set(H.x[i] + H.nx[i] * off, H.y[i], H.z[i] + H.nz[i] * off); m.rotation.set(0, yaw, 0); m.scale.set(H.w[i] * sc, H.h[i] * sc, 1); m.updateMatrix();
        mesh.setMatrixAt(n, m.matrix);
        if (H.kind[i] === 1) this.color.setHex(C_SOOT); else if (l === 0) this.color.setRGB(H.r[i], H.g[i], H.b[i]); else this.color.setHex(C_HOLE);
        mesh.setColorAt(n, this.color);
        n++;
      }
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.holesDirty = false;
  }
}
