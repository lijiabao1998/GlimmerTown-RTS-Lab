// ======== R011 指令回饋（R063 從 battle.ts 搬出，畫法逐行不變）========
// 只畫被選取的我方單位：剩下的路（綠／紅／橘，越遠越淡）、終點方塊、攻擊線（看得到畫到目標身上，看不到畫到最後已知位置）、砲擊準星
import * as THREE from 'three';
import { SUB, SIDE_PLAYER, ORD_ATTACK, ORD_FIRE_AT, type World } from '../sim/world.ts';
import type { Lerp, MakeInst, Sight } from './painter.ts';

export const DASH_CAP = 900;                 // R011 地上短線最多幾段
const DK_PATH = 0, DK_ATTACK = 1, DK_FIRE = 2, DK_END = 3, DK_CROSS = 4;

export class OrderLines {
  mesh: THREE.InstancedMesh | null = null;   // ?noR011=1 時不建
  private nd11 = 0;
  private tmp: THREE.Object3D;
  private color = new THREE.Color();
  // 守衛用：上一幀畫了哪些短線（預配）
  readonly dbg = { n: 0, x: new Float32Array(DASH_CAP), z: new Float32Array(DASH_CAP), kind: new Uint8Array(DASH_CAP), unit: new Int32Array(DASH_CAP) };

  constructor(tmp: THREE.Object3D) { this.tmp = tmp; }

  build(inst: MakeInst) {
    // 地上的短線片（加色＝在地上發亮，越淡＝顏色越暗），會被房子擋住（測深度、不寫深度）
    this.mesh = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), DASH_CAP, false);
  }

  paint(w: World, selected: Set<number>, at: Lerp, view: Sight) {
    const dbg = this.dbg, alpha = at.alpha, prevX = at.prevX, prevZ = at.prevZ;
    this.nd11 = 0; dbg.n = 0;
    for (const id of selected) {
      const u = id >= 1 && id <= w.units.length ? w.units[id - 1] : null;
      if (!u || !u.alive || u.side !== SIDE_PLAYER) continue;
      const x = (prevX[u.id] + (u.x - prevX[u.id]) * alpha) / SUB, z = (prevZ[u.id] + (u.z - prevZ[u.id]) * alpha) / SUB;
      const col = u.order === ORD_ATTACK ? 0xff5040 : u.order === ORD_FIRE_AT ? 0xffa030 : 0x6cff70;
      // 剩下的路：沿折線每 0.3 格一段
      let px = x, pz = z, walked = 0, ex = x, ez = z;
      for (let i = u.pathIdx; i < u.path.length && this.nd11 < DASH_CAP; i++) {
        const c = u.path[i], cx = (c % w.n) + 0.5, cz = (c - (c % w.n)) / w.n + 0.5;
        walked = this.dashes11(u.id, DK_PATH, px, pz, cx, cz, col, walked);
        px = cx; pz = cz; ex = cx; ez = cz;
      }
      if (u.pathIdx < u.path.length) this.dash11(u.id, DK_END, ex, ez, 0.16, 0.16, 0, col, 1);
      if (u.order === ORD_ATTACK) {
        const t = w.units[u.target - 1];
        const seen = !!t && t.alive && view.visibleUnit(t);
        const tx = seen ? (prevX[t.id] + (t.x - prevX[t.id]) * alpha) / SUB : u.tx / SUB, tz = seen ? (prevZ[t.id] + (t.z - prevZ[t.id]) * alpha) / SUB : u.tz / SUB;
        this.dashes11(u.id, DK_ATTACK, x, z, tx, tz, 0xff4030, 0);
      } else if (u.order === ORD_FIRE_AT) {
        const tx = u.tx + 0.5, tz = u.tz + 0.5;
        this.dashes11(u.id, DK_FIRE, x, z, tx, tz, 0xff9a20, 0);
        this.dash11(u.id, DK_CROSS, tx, tz, 0.6, 0.06, Math.PI / 4, 0xffb040, 1);
        this.dash11(u.id, DK_CROSS, tx, tz, 0.6, 0.06, -Math.PI / 4, 0xffb040, 1);
      }
    }
    const d = this.mesh!;
    d.count = this.nd11; d.instanceMatrix.needsUpdate = true;
    if (d.instanceColor) d.instanceColor.needsUpdate = true;
  }
  // 一條線段上的虛線；walked＝之前已經走了多遠（讓整條路的虛線間距連續、越遠越淡）；回傳走到哪
  private dashes11(id: number, kind: number, ax: number, az: number, bx: number, bz: number, col: number, walked: number): number {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), STEP = 0.3;
    if (len < 1e-6) return walked;
    let s = (STEP - (walked % STEP)) % STEP;
    for (; s < len && this.nd11 < DASH_CAP; s += STEP) {
      const fade = Math.max(0.3, 1 - (walked + s) / 14);
      this.dash11(id, kind, ax + (dx * s) / len, az + (dz * s) / len, 0.13, 0.045, yaw, col, fade);
    }
    return walked + len;
  }
  private dash11(id: number, kind: number, x: number, z: number, sx: number, sz: number, yaw: number, col: number, fade: number) {
    if (this.nd11 >= DASH_CAP) return;
    const m = this.tmp, dbg = this.dbg;
    m.position.set(x, 0.03, z); m.rotation.set(0, yaw, 0); m.scale.set(sx, 1, sz); m.updateMatrix();
    this.mesh!.setMatrixAt(this.nd11, m.matrix);
    this.mesh!.setColorAt(this.nd11, this.color.setHex(col).multiplyScalar(fade));
    dbg.x[dbg.n] = x; dbg.z[dbg.n] = z; dbg.kind[dbg.n] = kind; dbg.unit[dbg.n] = id; dbg.n++;
    this.nd11++;
  }
}
