// ======== R009 血條與耐久條（R063 從 battle.ts 搬出，畫法逐行不變）========
// 單位：受過傷或被選取才畫；扣血時白色殘影從舊血量縮到新血量（0.5 秒）。敵方只在看得到時畫（R100）。
// 建築：我方單位正在砲擊的那棟畫耐久條，標出「空殼」門檻（70%）。
// R123：所有底先排、填色後排，但只送一個網格（?noR123=1 回到底、填色兩個網格）。
import * as THREE from 'three';
import { SUB, cellIdx, UK_OBSERVER, stageOf, STAGE_ROOFLESS, SIDE_PLAYER, UNIT_KINDS, ORD_FIRE_AT, type Unit, type World } from '../sim/world.ts';
import { wallHeight, wallShown, roofRise } from './buildings.ts';
import type { Lerp, MakeInst, Sight } from './painter.ts';

const C_BAR_BG = new THREE.Color(0x15130f), C_BAR_HI = new THREE.Color(0x63d65a), C_BAR_MID = new THREE.Color(0xf2c23a), C_BAR_LO = new THREE.Color(0xe8402a);
const C_BLD_HI = new THREE.Color(0xdcc08a), C_BLD_LO = new THREE.Color(0xe08a3a);
const C_WHITE = new THREE.Color(1, 1, 1);

export class HealthBars {
  on = false;                                  // ?noR009=1 時不建、不畫
  bg: THREE.InstancedMesh | null = null;
  fill: THREE.InstancedMesh | null = null;     // 只有 ?noR123=1 才有第二個網格
  nb9 = 0;
  nf9 = 0;
  // 每台上一次看到的血量、扣血前的血量、扣血時間（白色殘影用；波次單位多了由畫面一起加大）
  hp: Int32Array;
  from: Float64Array;
  hitT: Float64Array;
  private right = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private color = new THREE.Color();
  private tmp: THREE.Object3D;
  private cap: number;
  // 守衛用：上一幀畫了哪些血條（預配，不每幀配置）
  readonly dbg: { n: number; id: Int32Array; frac: Float32Array; ghost: Float32Array; r: Float32Array; g: Float32Array };

  constructor(maxUnits: number, tmp: THREE.Object3D) {
    this.cap = maxUnits; this.tmp = tmp;
    this.hp = new Int32Array(maxUnits + 1); this.from = new Float64Array(maxUnits + 1); this.hitT = new Float64Array(maxUnits + 1).fill(-99);
    this.dbg = { n: 0, id: new Int32Array(maxUnits + 64), frac: new Float32Array(maxUnits + 64), ghost: new Float32Array(maxUnits + 64), r: new Float32Array(maxUnits + 64), g: new Float32Array(maxUnits + 64) };
  }

  build(inst: MakeInst, r123: boolean, elev: number) {
    const MAX_UNITS = this.cap;
    // 血條：一片從 x=0 往右長的四邊形；畫在所有東西上面（不測深度、不寫深度＝沒有描邊），朝著鏡頭
    const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    const mat = (c: number) => new THREE.MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, toneMapped: false });
    // R123: preserve all backgrounds before every fill, but submit one mesh.
    // The upper fixed-capacity segment stages fills until the background count is known.
    this.bg = inst(quad, mat(0xffffff), (r123 ? 3 : 1) * (MAX_UNITS + 64), false); this.bg.renderOrder = 10;
    if (!r123) { this.fill = inst(quad.clone(), mat(0xffffff), 2 * (MAX_UNITS + 64), false); this.fill.renderOrder = 11; }
    // 鏡頭角度固定（45°／30°），血條的朝向算一次就好
    const probe = new THREE.Object3D(), dir = new THREE.Vector3(Math.cos(elev) * Math.SQRT1_2, Math.sin(elev), Math.cos(elev) * Math.SQRT1_2);
    probe.position.copy(dir); probe.lookAt(0, 0, 0); probe.rotateY(Math.PI);
    this.q.copy(probe.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.on = true;
  }

  // 新單位：從現在的血量開始（沒有殘影）
  seed(u: Unit) { this.hp[u.id] = u.hp; this.from[u.id] = u.hp; }

  get counts() { return this.on ? { bg: this.nb9, fill: this.nf9 } : { bg: 0, fill: 0 }; }

  paint(w: World, t: number, selected: Set<number>, at: Lerp, view: Sight) {
    const dbg = this.dbg, MAX_UNITS = this.cap, alpha = at.alpha, prevX = at.prevX, prevZ = at.prevZ;
    this.nb9 = 0; this.nf9 = 0; dbg.n = 0;
    for (const u of w.units) {
      const max = UNIT_KINDS[u.kind].hp;
      if (u.hp < this.hp[u.id]) { this.from[u.id] = this.ghost9(u.id, t); this.hitT[u.id] = t; }
      this.hp[u.id] = u.hp;
      if (!u.alive || (u.hp >= max && !selected.has(u.id)) || !view.visibleUnit(u)) continue;
      const frac = Math.max(0, u.hp / max), ghost = this.ghost9(u.id, t) / max;
      // 綠（滿）→ 黃（一半）→ 紅（快死）
      if (frac > 0.5) this.color.copy(C_BAR_MID).lerp(C_BAR_HI, (frac - 0.5) * 2); else this.color.copy(C_BAR_LO).lerp(C_BAR_MID, frac * 2);
      const x = (prevX[u.id] + (u.x - prevX[u.id]) * alpha) / SUB, z = (prevZ[u.id] + (u.z - prevZ[u.id]) * alpha) / SUB;
      this.bar9(u.id, x, view.unitHeight(u) + (u.kind === UK_OBSERVER ? 0.85 : 0.55), z, u.kind === UK_OBSERVER ? 0.34 : 0.5, frac, Math.max(frac, Math.min(1, ghost)), this.color, 0);
    }
    // 我方正在砲擊的建築（同一棟只畫一次）
    for (const u of w.units) {
      if (!u.alive || u.side !== SIDE_PLAYER || u.order !== ORD_FIRE_AT || u.target > 0) continue;
      const id = w.occ[cellIdx(w, u.tx, u.tz)], b = id ? w.blds[id - 1] : null;
      if (!b || b.hp <= 0) continue;
      let dup = false;
      for (let i = 0; i < dbg.n; i++) if (dbg.id[i] === -b.id) dup = true;
      if (dup) continue;
      const frac = b.hp / b.maxHp;
      this.color.copy(frac > 0.7 ? C_BLD_HI : C_BLD_LO);
      const h = wallHeight(b) * (wallShown(b) && stageOf(b) === STAGE_ROOFLESS ? 0.72 : 1);
      this.bar9(-b.id, b.x + b.w / 2, h + roofRise(b.kind) + 0.35, b.z + b.d / 2, Math.min(1.2, 0.5 + 0.25 * Math.max(b.w, b.d)), frac, frac, this.color, 0.7);
    }
    const bg = this.bg!, fill = this.fill;
    if (fill) {
      bg.count = this.nb9; fill.count = this.nf9;
      fill.instanceMatrix.needsUpdate = true;
      if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
    } else {
      const offset = MAX_UNITS + 64;
      // copyWithin handles overlap and allocates nothing; retain original fill ordering.
      bg.instanceMatrix.array.copyWithin(this.nb9 * 16, offset * 16, (offset + this.nf9) * 16);
      if (bg.instanceColor) bg.instanceColor.array.copyWithin(this.nb9 * 3, offset * 3, (offset + this.nf9) * 3);
      bg.count = this.nb9 + this.nf9;
    }
    bg.instanceMatrix.needsUpdate = true;
    if (bg.instanceColor) bg.instanceColor.needsUpdate = true;
  }
  // 一條血條：底（黑框）、白色殘影、填色、門檻刻度；左端對齊、往鏡頭的右邊長
  private bar9(id: number, cx: number, y: number, cz: number, L: number, frac: number, ghost: number, col: THREE.Color, notch: number) {
    const R = this.right, x0 = cx - R.x * L / 2, y0 = y - R.y * L / 2, z0 = cz - R.z * L / 2, capB = this.cap + 64, capF = 2 * capB, dbg = this.dbg, fill = this.fill ?? this.bg!, offset = this.fill ? 0 : capB;
    if (this.nb9 < capB) this.put9(this.bg!, this.nb9++, x0 - R.x * 0.02, y0 - R.y * 0.02, z0 - R.z * 0.02, L + 0.04, 0.085, C_BAR_BG);
    if (ghost > frac && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0, y0, z0, L * ghost, 0.05, C_WHITE);
    if (frac > 0 && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0, y0, z0, L * frac, 0.05, col);
    if (notch > 0 && this.nf9 < capF) this.put9(fill, offset + this.nf9++, x0 + R.x * L * notch, y0 + R.y * L * notch, z0 + R.z * L * notch, 0.025, 0.07, C_BAR_BG);
    if (dbg.n < dbg.id.length) { dbg.id[dbg.n] = id; dbg.frac[dbg.n] = frac; dbg.ghost[dbg.n] = ghost; dbg.r[dbg.n] = col.r; dbg.g[dbg.n] = col.g; dbg.n++; }
  }
  private put9(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, len: number, h: number, col: THREE.Color) {
    const m = this.tmp;
    m.position.set(x, y, z); m.quaternion.copy(this.q); m.scale.set(Math.max(0.0001, len), h, 1); m.updateMatrix();
    mesh.setMatrixAt(i, m.matrix); mesh.setColorAt(i, col);
  }
  // 白色殘影目前停在多少血（0.5 秒內從扣血前縮到現在的血量）
  private ghost9(id: number, t: number): number {
    const k = (t - this.hitT[id]) / 0.5, now = this.hp[id];
    return k >= 1 || k < 0 ? now : now + (this.from[id] - now) * (1 - k);
  }
}
