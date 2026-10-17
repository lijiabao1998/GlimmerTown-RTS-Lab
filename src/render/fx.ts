// 效果系統（R004）：固定容量的池（struct-of-arrays），每幀零配置；一個池＝一個 InstancedMesh＝有實例時 1 次繪製呼叫，池滿丟最舊的。
// 時間軸只用模擬時間（暫停就凍結），亂數只由呼叫端用 hash2 算好再傳進來：同一場戰鬥同一刻畫出來的效果一模一樣（docs/DECISIONS.md R003）。
// 只畫、不碰世界。
import * as THREE from 'three';

export const M_PUFF = 0;     // 煙、塵：toon 球，越長越大、隨風飄，最後縮掉
export const M_GLOW = 1;     // 光：加色混合，越亮越快熄（顏色淡到黑＝看不見）
export const M_DEBRIS = 2;   // 碎片：toon 方塊，彈道、落地彈一下、停住，最後縮掉
export const M_RING = 3;     // 地面震波環：加色，擴散後熄
export const M_FLAT = 4;     // 貼地光暈：加色，壓扁的光球

export interface Spawn {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  t0: number; life: number;
  s0: number; s1: number;      // 尺寸（碎片：s0＝長寬、s1＝厚）
  c0: number; c1?: number;     // 顏色（hex）；c1 省略＝不變色
  g?: number;                  // 重力（格/秒²）；負的＝往上飄
  drag?: number;               // 水平阻力（1/秒）
  spin?: number;               // 碎片轉速（弧度/秒）
  seed?: number;               // 碎片轉軸（0–1）
  fog?: boolean;               // 射擊線索：看不到的地方不畫（R100）
  flat?: boolean;              // 光：壓扁貼地（地面光暈）
}

export const WIND_X = 0.22, WIND_Z = -0.1;   // 固定的風（格/秒），只影響畫面
const F = 20;                                 // 每個粒子幾個數
// 0 x,1 y,2 z,3 vx,4 vy,5 vz,6 t0,7 life,8 s0,9 s1,10–12 色0,13–15 色1,16 重力,17 阻力,18 轉速,19 轉軸
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _c = new THREE.Color();
const _e = new THREE.Euler();

export class Pool {
  readonly mesh: THREE.InstancedMesh;
  readonly mode: number;
  readonly cap: number;
  private st: Float64Array;
  private fog: Uint8Array;
  private next = 0;
  private n = 0;

  constructor(mode: number, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, scene: THREE.Scene) {
    this.mode = mode; this.cap = cap;
    this.st = new Float64Array(cap * F);
    this.fog = new Uint8Array(cap);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.castShadow = false; this.mesh.receiveShadow = mode === M_DEBRIS || mode === M_PUFF;
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    scene.add(this.mesh);
  }

  spawn(p: Spawn) {
    const i = this.next, o = i * F, s = this.st;
    this.next = (this.next + 1) % this.cap;
    s[o] = p.x; s[o + 1] = p.y; s[o + 2] = p.z; s[o + 3] = p.vx ?? 0; s[o + 4] = p.vy ?? 0; s[o + 5] = p.vz ?? 0;
    s[o + 6] = p.t0; s[o + 7] = p.life; s[o + 8] = p.s0; s[o + 9] = p.s1;
    _c.setHex(p.c0); s[o + 10] = _c.r; s[o + 11] = _c.g; s[o + 12] = _c.b;
    _c.setHex(p.c1 ?? p.c0); s[o + 13] = _c.r; s[o + 14] = _c.g; s[o + 15] = _c.b;
    s[o + 16] = p.g ?? 0; s[o + 17] = p.drag ?? 0; s[o + 18] = p.spin ?? 0; s[o + 19] = p.seed ?? 0;
    this.fog[i] = (p.fog ? 1 : 0) | (p.flat ? 2 : 0);
  }

  // 每幀：先 begin，再 update（存著的粒子），再 put（不存狀態、每幀重算的實例，例如曳光），最後 finish
  begin() { this.n = 0; }

  update(t: number, visible: (x: number, z: number) => boolean) {
    const s = this.st;
    for (let i = 0; i < this.cap && this.n < this.cap; i++) {
      const o = i * F, life = s[o + 7], dt = t - s[o + 6];
      if (life <= 0 || dt < 0 || dt >= life) continue;
      const k = dt / life, drag = s[o + 17];
      const D = drag > 0 ? (1 - Math.exp(-drag * dt)) / drag : dt;
      let x = s[o] + s[o + 3] * D, y = s[o + 1], z = s[o + 2] + s[o + 5] * D;
      let sx: number, sy: number, sz: number, fade = 1, mix = k;
      _q.identity();
      if (this.mode === M_PUFF) {
        const drift = dt * Math.min(1, dt / 1.5);
        x += WIND_X * drift; z += WIND_Z * drift;
        y += s[o + 4] * dt * (1 - 0.3 * k);
        let r = s[o + 8] + (s[o + 9] - s[o + 8]) * Math.sqrt(k);
        if (k > 0.75) r *= 1 - (k - 0.75) * 4;
        sx = sy = sz = Math.max(0.001, r);
      } else if (this.mode === M_DEBRIS) {
        const g = s[o + 16] || 9, vy = s[o + 4], y0 = s[o + 1];
        const tHit = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, y0))) / g;
        const vx = s[o + 3], vz = s[o + 5];
        let tRest: number;
        if (dt < tHit) { x = s[o] + vx * dt; z = s[o + 2] + vz * dt; y = y0 + vy * dt - 0.5 * g * dt * dt; tRest = Infinity; }
        else {
          const v2 = -(vy - g * tHit) * 0.3, tHit2 = (2 * v2) / g, t2 = dt - tHit;
          const hx = s[o] + vx * tHit, hz = s[o + 2] + vz * tHit;
          if (t2 < tHit2) { x = hx + vx * 0.45 * t2; z = hz + vz * 0.45 * t2; y = v2 * t2 - 0.5 * g * t2 * t2; }
          else { const sl = Math.min(t2 - tHit2, 0.25); x = hx + vx * 0.45 * (tHit2 + 0.4 * sl); z = hz + vz * 0.45 * (tHit2 + 0.4 * sl); y = 0; }
          tRest = tHit + tHit2 + 0.25;
        }
        const seed = s[o + 19];
        _a.set(Math.sin(seed * 12.9898) + 0.1, Math.cos(seed * 7.233), Math.sin(seed * 3.71 + 1)).normalize();
        _q.setFromAxisAngle(_a, s[o + 18] * Math.min(dt, tRest));
        const shrink = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
        sx = s[o + 8] * shrink; sz = s[o + 8] * 0.8 * shrink; sy = s[o + 9] * shrink;
        y += sy * 0.5;
        mix = 0;
      } else if (this.mode === M_RING) {
        const r = s[o + 8] + (s[o + 9] - s[o + 8]) * (1 - (1 - k) * (1 - k));
        sx = sz = r; sy = 1; fade = (1 - k) * (1 - k);
      } else {
        const flat = this.mode === M_FLAT || (this.fog[i] & 2) !== 0;
        if (!flat) y = Math.max(0.02, y + s[o + 4] * D - 0.5 * s[o + 16] * dt * dt);
        const r = s[o + 8] + (s[o + 9] - s[o + 8]) * (1 - (1 - k) * (1 - k));
        sx = sz = r; sy = flat ? 0.02 : r; fade = Math.pow(1 - k, 1.5);
      }
      if ((this.fog[i] & 1) && !visible(x, z)) continue;
      _c.setRGB(s[o + 10] + (s[o + 13] - s[o + 10]) * mix, s[o + 11] + (s[o + 14] - s[o + 11]) * mix, s[o + 12] + (s[o + 15] - s[o + 12]) * mix);
      this.write(x, y, z, sx, sy, sz, fade);
    }
  }

  // 每幀直接畫一個（yaw＝繞 y 軸，給拉長的曳光用）
  put(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, hex: number, fade = 1) {
    if (this.n >= this.cap) return;
    _q.setFromEuler(_e.set(0, yaw, 0));
    _c.setHex(hex);
    this.write(x, y, z, sx, sy, sz, fade);
  }

  private write(x: number, y: number, z: number, sx: number, sy: number, sz: number, fade: number) {
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, _m);
    this.mesh.setColorAt(this.n, fade === 1 ? _c : _c.multiplyScalar(fade));
    this.n++;
  }

  finish() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get count() { return this.mesh.count; }

  // 守衛用：實例數＋矩陣＋顏色的雜湊（決定性比對）
  digest(h: number): number {
    const m = this.mesh.instanceMatrix.array, c = this.mesh.instanceColor?.array, n = this.mesh.count;
    const mix = (v: number) => { h = Math.imul(h ^ (Math.round(v * 1000) | 0), 0x01000193) >>> 0; };
    mix(n);
    for (let i = 0; i < n * 16; i++) mix(m[i]);
    if (c) for (let i = 0; i < n * 3; i++) mix(c[i]);
    return h;
  }
}

// 倒塌殘影：房子倒成瓦礫時，舊模型約 1 秒內抖動、傾斜、沉進地面（地面把沉下去的部分擋掉）。
// 所有正在倒的房子併成一個網格，預先配好緩衝，每幀重寫 → 最多 1 次繪製呼叫。
export const COLLAPSE_S = 1.1;
interface Ghost { pos: number[]; nor: number[]; col: number[]; t0: number; h: number; cx: number; cz: number; lx: number; lz: number; seed: number }

export class Ghosts {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array; private nor: Float32Array; private col: Float32Array;
  private list: Ghost[] = [];

  constructor(mat: THREE.Material, capVerts: number, scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capVerts * 3); this.nor = new Float32Array(capVerts * 3); this.col = new Float32Array(capVerts * 3);
    for (const [name, a] of [['position', this.pos], ['normal', this.nor], ['color', this.col]] as const) {
      const at = new THREE.BufferAttribute(a, 3); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, at);
    }
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
  }

  add(geo: { pos: number[]; nor: number[]; col: number[] }, t0: number, h: number, cx: number, cz: number, seed: number) {
    const a = seed * 6.2832;
    this.list.push({ pos: geo.pos, nor: geo.nor, col: geo.col, t0, h, cx, cz, lx: Math.cos(a) * 0.35, lz: Math.sin(a) * 0.35, seed });
  }

  get count() { return this.list.length; }

  update(t: number) {
    let j = 0;
    for (const g of this.list) if (t < g.t0 + COLLAPSE_S) this.list[j++] = g;   // 原地丟掉倒完的（不配置新陣列）
    this.list.length = j;
    let v = 0;
    for (const g of this.list) {
      const k = Math.max(0, (t - g.t0) / COLLAPSE_S);
      if (v * 3 + g.pos.length > this.pos.length) break;
      const sink = k * k * (g.h + 0.15);                             // 越倒越快
      const lean = k * 0.9;                                          // 往一邊歪
      const shake = (1 - k) * 0.03 * Math.sin((t - g.t0) * 95 + g.seed * 40);
      for (let i = 0; i < g.pos.length; i += 3) {
        const y = g.pos[i + 1];
        this.pos[v * 3] = g.pos[i] + y * g.lx * lean + shake;
        this.pos[v * 3 + 1] = y * (1 - 0.25 * k) - sink;
        this.pos[v * 3 + 2] = g.pos[i + 2] + y * g.lz * lean - shake * 0.6;
        this.nor[v * 3] = g.nor[i]; this.nor[v * 3 + 1] = g.nor[i + 1]; this.nor[v * 3 + 2] = g.nor[i + 2];
        const dim = 1 - 0.35 * k;                                    // 揚塵裡越來越暗
        this.col[v * 3] = g.col[i] * dim; this.col[v * 3 + 1] = g.col[i + 1] * dim; this.col[v * 3 + 2] = g.col[i + 2] * dim;
        v++;
      }
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, v);
    this.mesh.visible = v > 0;
    if (v > 0) { geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.color.needsUpdate = true; }
  }

  digest(h: number): number {
    const n = this.mesh.geometry.drawRange.count;
    h = Math.imul(h ^ n, 0x01000193) >>> 0;
    for (let i = 0; i < Math.min(n * 3, this.pos.length); i += 7) h = Math.imul(h ^ (Math.round(this.pos[i] * 1000) | 0), 0x01000193) >>> 0;
    return h;
  }
}
