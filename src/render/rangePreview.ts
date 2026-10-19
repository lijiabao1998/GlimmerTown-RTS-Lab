// R113：只讀目前已套用的單選射擊解。圈線共用自己的固定網格，不占既有選取／路線／效果池。
import * as THREE from 'three';
import {
  N, SUB, SIDE_PLAYER, UNIT_KINDS, ORD_FIRE_AT, SHELL_HE, SHELL_SMOKE,
  bldAt, center, inMap, type Unit, type World,
} from '../sim/world.ts';
import { dist } from '../sim/math.ts';
import { spotted } from '../sim/step.ts';

export const RANGE_SEGMENTS = 96;
export const RANGE_WIDTH = 0.10;
const CIRCLE_CAP = 3, VERTICES = 2 * (RANGE_SEGMENTS + 1);
const COS_HALF = Math.cos(Math.PI / RANGE_SEGMENTS);
// Float32 頂點在最大地圖座標的誤差仍不會讓散布角落跨進圈線內緣。
const EDGE_MARGIN = 0.00002;
const COLORS = [new THREE.Color(0xffe066), new THREE.Color(0xe8402a), new THREE.Color(0xe08a3a)];
const COS = new Float64Array(RANGE_SEGMENTS + 1), SIN = new Float64Array(RANGE_SEGMENTS + 1);
for (let i = 0; i <= RANGE_SEGMENTS; i++) {
  COS[i] = Math.cos(i * Math.PI * 2 / RANGE_SEGMENTS);
  SIN[i] = Math.sin(i * Math.PI * 2 / RANGE_SEGMENTS);
}

export interface RangeSolution {
  readonly legend: string;
  readonly reason: string;
  readonly count: number;
  readonly selectedId: number;
  readonly x: number;
  readonly z: number;
  readonly range: number;
  readonly minRange: number;
  readonly aimX: number;
  readonly aimZ: number;
  readonly scatterRadius: number; // 解析上界（格）；網格另含外接多邊形與線寬餘量。
  readonly offset: number; // 正式模擬的兩軸獨立 ±r（位置單位）。
  readonly blind: boolean;
  readonly ammo: number;
}
type MutableSolution = { -readonly [K in keyof RangeSolution]: RangeSolution[K] };
const cells = (n: number): string => Number(n.toFixed(2)).toString();

export class RangePreview {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private state: MutableSolution = {
    legend: '', reason: 'empty', count: 0, selectedId: 0, x: 0, z: 0,
    range: 0, minRange: 0, aimX: 0, aimZ: 0, scatterRadius: 0,
    offset: 0, blind: false, ammo: SHELL_HE,
  };
  private positions = new Float32Array(CIRCLE_CAP * VERTICES * 3);
  private colors = new Float32Array(CIRCLE_CAP * VERTICES * 3);
  private position: THREE.BufferAttribute;
  private color: THREE.BufferAttribute;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position); geometry.setAttribute('color', this.color);
    const indices = new Uint16Array(CIRCLE_CAP * RANGE_SEGMENTS * 6);
    for (let circle = 0; circle < CIRCLE_CAP; circle++) for (let i = 0; i < RANGE_SEGMENTS; i++) {
      const v = circle * VERTICES + 2 * i, at = (circle * RANGE_SEGMENTS + i) * 6;
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], at);
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.setDrawRange(0, 0);
    // 只裁這個材質的片段。不把圓周頂點夾到邊界，避免在地圖邊緣生成假的直線弦。
    const material = new THREE.ShaderMaterial({
      uniforms: { mapSize: { value: N } }, vertexColors: true, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `
        varying vec2 worldXZ;
        varying vec3 ringColor;
        void main() {
          worldXZ = (modelMatrix * vec4(position, 1.0)).xz;
          ringColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float mapSize;
        varying vec2 worldXZ;
        varying vec3 ringColor;
        void main() {
          if (worldXZ.x < 0.0 || worldXZ.y < 0.0 || worldXZ.x > mapSize || worldXZ.y > mapSize) discard;
          gl_FragColor = vec4(ringColor, 0.92);
          #include <colorspace_fragment>
        }`,
    });
    // DoubleSide 透明材質預設會分前後兩趟；地面薄圈只需一趟。
    material.forceSinglePass = true;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'range-preview-r113'; this.mesh.visible = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
  }

  get solution(): Readonly<RangeSolution> { return this.state; }

  update(w: World, selected: ReadonlySet<number>, enabled = true): Readonly<RangeSolution> {
    const s = this.state;
    s.legend = ''; s.reason = 'empty'; s.count = 0; s.selectedId = 0;
    s.range = s.minRange = s.scatterRadius = s.offset = 0;
    s.x = s.z = s.aimX = s.aimZ = 0; s.blind = false; s.ammo = SHELL_HE;
    this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0);
    if (!enabled) { s.reason = 'disabled'; return s; }
    let unit: Unit | undefined, count = 0;
    for (const u of w.units) {
      if (!u.alive || u.side !== SIDE_PLAYER || !selected.has(u.id)) continue;
      unit = u; count++;
    }
    // 先數所有存活友軍，再查武裝；砲＋無武裝觀測員仍是多選。
    if (count > 1) { s.reason = 'multiple'; s.legend = '射程與散布上界：請單選一個友軍'; return s; }
    if (!unit) return s;
    const k = UNIT_KINDS[unit.kind];
    if (k.range <= 0) { s.reason = 'unarmed'; s.legend = '無武裝：沒有武器射程圈'; return s; }
    s.selectedId = unit.id; s.x = unit.x / SUB; s.z = unit.z / SUB;
    s.range = k.range / SUB; s.minRange = k.minRange / SUB;
    s.legend = `金圈射程 ${cells(s.range)} 格`;
    this.circle(s.x, s.z, s.range, 0);
    if (k.minRange > 0) { this.circle(s.x, s.z, s.minRange, 1); s.legend += `・紅圈近限 ${cells(s.minRange)} 格`; }

    if (!k.indirect) return this.finish('direct', '直射：不預測散布');
    if (unit.pathIdx < unit.path.length) return this.finish('moving', '移動中：不預測散布');
    if (unit.order !== ORD_FIRE_AT) return this.finish('no-task', '未有對地砲擊任務');
    const smoke = unit.fireAmmo === SHELL_SMOKE;
    s.ammo = smoke ? SHELL_SMOKE : SHELL_HE;
    const bld = !smoke && unit.target <= 0 ? bldAt(w, unit.tx, unit.tz) : null;
    if (!inMap(unit.tx, unit.tz) || (unit.target <= 0 && (!bld || bld.hp <= 0))) return this.finish('invalid-target', '砲擊任務已失效');
    const ax = center(unit.tx), az = center(unit.tz), d = dist(unit.x, unit.z, ax, az);
    if (d < k.minRange) return this.finish('too-near', '目標過近：不預測散布');
    if (d > k.range) return this.finish('too-far', '目標過遠：不預測散布');
    let offset = Math.floor(d / 12);
    const r = unit.ranging;
    if (!smoke && r && r.x === unit.x && r.z === unit.z && r.ax === ax && r.az === az && r.target === 0) {
      for (let i = 0; i < r.seen; i++) offset = Math.max(1, Math.floor(offset / 2));
    }
    s.blind = !spotted(w, unit.side, ax, az);
    if (s.blind) offset *= 2;
    s.offset = offset; s.aimX = ax / SUB; s.aimZ = az / SUB;
    s.scatterRadius = Math.SQRT2 * offset / SUB;
    // 方形散布的角落距離是 sqrt(2)r。內緣也需外接96邊形，不能只讓線中心包住角落。
    const radius = (s.scatterRadius + EDGE_MARGIN) / COS_HALF + RANGE_WIDTH / 2;
    this.circle(s.aimX, s.aimZ, radius, 2);
    return this.finish('scatter', `橙圈${smoke ? '煙幕' : '高爆'}散布上界 ${cells(Math.ceil(s.scatterRadius * 100) / 100)} 格${s.blind ? '（盲射）' : ''}`);
  }

  private finish(reason: string, detail: string): Readonly<RangeSolution> {
    this.state.reason = reason; this.state.legend += `；${detail}`;
    this.mesh.geometry.setDrawRange(0, this.state.count * RANGE_SEGMENTS * 6);
    this.position.needsUpdate = this.color.needsUpdate = true;
    this.mesh.visible = this.state.count > 0;
    return this.state;
  }

  private circle(x: number, z: number, radius: number, color: number): void {
    const base = this.state.count * VERTICES * 3, c = COLORS[color];
    for (let i = 0; i <= RANGE_SEGMENTS; i++) for (let edge = 0; edge < 2; edge++) {
      const r = radius + (edge ? 1 : -1) * RANGE_WIDTH / 2, at = base + i * 6 + edge * 3;
      this.positions[at] = x + COS[i] * r; this.positions[at + 1] = 0.045;
      this.positions[at + 2] = z + SIN[i] * r;
      this.colors[at] = c.r; this.colors[at + 1] = c.g; this.colors[at + 2] = c.b;
    }
    this.state.count++;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
