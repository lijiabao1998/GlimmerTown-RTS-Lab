// 非索引幾何累積器：box／gable／pyramid，面朝向依給定法線自動校正。
// 想法來自 GlimmerTown3D-lab@bece722 src/render/scene.ts 的 Geo（這裡只留頂點色，不記擁有者）。
import * as THREE from 'three';

type V3 = [number, number, number];

export class Geo {
  pos: number[] = []; nor: number[] = []; col: number[] = [];

  tri(a: V3, b: V3, c: V3, n: V3, col: THREE.Color) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(col.r, col.g, col.b); }
  }
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, col: THREE.Color) { this.tri(a, b, c, n, col); this.tri(a, c, d, n, col); }
  // 三角面：法線用實際面算，翻到 away 那一側
  face3(a: V3, b: V3, c: V3, away: V3, col: THREE.Color) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (n[0] * away[0] + n[1] * away[1] + n[2] * away[2] < 0) n = [-n[0], -n[1], -n[2]];
    this.tri(a, b, c, n, col);
  }
  face4(a: V3, b: V3, c: V3, d: V3, away: V3, col: THREE.Color) { this.face3(a, b, c, away, col); this.face3(a, c, d, away, col); }

  // 長方體（不畫底面）；top＝頂面色（null＝不畫頂面）
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: THREE.Color, top: THREE.Color | null = side) {
    if (top) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], top);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], side);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side);
  }

  // 雙坡屋頂：屋脊沿 x（alongX）或 z；h＝簷高、rise＝脊高
  gable(x0: number, z0: number, x1: number, z1: number, h: number, rise: number, alongX: boolean, roof: THREE.Color, wall: THREE.Color) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, t = h + rise;
    if (alongX) {
      this.face4([x0, h, z0], [x1, h, z0], [x1, t, mz], [x0, t, mz], [0, 1, -1], roof);
      this.face4([x0, h, z1], [x1, h, z1], [x1, t, mz], [x0, t, mz], [0, 1, 1], roof);
      this.face3([x0, h, z0], [x0, h, z1], [x0, t, mz], [-1, 0, 0], wall);
      this.face3([x1, h, z0], [x1, h, z1], [x1, t, mz], [1, 0, 0], wall);
    } else {
      this.face4([x0, h, z0], [x0, h, z1], [mx, t, z1], [mx, t, z0], [-1, 1, 0], roof);
      this.face4([x1, h, z0], [x1, h, z1], [mx, t, z1], [mx, t, z0], [1, 1, 0], roof);
      this.face3([x0, h, z0], [x1, h, z0], [mx, t, z0], [0, 0, -1], wall);
      this.face3([x0, h, z1], [x1, h, z1], [mx, t, z1], [0, 0, 1], wall);
    }
  }

  // 四角錐（尖塔）
  pyramid(x0: number, z0: number, x1: number, z1: number, h: number, rise: number, col: THREE.Color) {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, apex: V3 = [mx, h + rise, mz];
    this.face3([x0, h, z0], [x1, h, z0], apex, [0, 0.5, -1], col);
    this.face3([x0, h, z1], [x1, h, z1], apex, [0, 0.5, 1], col);
    this.face3([x0, h, z0], [x0, h, z1], apex, [-1, 0.5, 0], col);
    this.face3([x1, h, z0], [x1, h, z1], apex, [1, 0.5, 0], col);
  }

  // 把另一段幾何套矩陣後併進來
  merge(other: Geo, m: THREE.Matrix4) {
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < other.pos.length; i += 3) {
      v.set(other.pos[i], other.pos[i + 1], other.pos[i + 2]).applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
      v.set(other.nor[i], other.nor[i + 1], other.nor[i + 2]).applyMatrix3(nm).normalize(); this.nor.push(v.x, v.y, v.z);
    }
    this.col.push(...other.col);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
  get triangles() { return this.pos.length / 9; }
}
