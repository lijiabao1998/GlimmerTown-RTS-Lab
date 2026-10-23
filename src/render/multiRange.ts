// R122: read-only nominal multi-selection ranges. One fixed quad, analytical annuli per fragment.
import * as THREE from 'three';
import { SUB, SIDE_PLAYER, UNIT_KINDS, type World } from '../sim/world.ts';

export const MULTI_RANGE_CAP = 512; // Same capacity as the existing battle unit renderer.
export class MultiRangePreview {
  readonly data = new Float32Array(MULTI_RANGE_CAP * 4);
  readonly texture = new THREE.DataTexture(this.data, MULTI_RANGE_CAP, 1, THREE.RGBAFormat, THREE.FloatType);
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly solution = { legend: '', reason: 'empty', selectedCount: 0, armedCount: 0, excludedCount: 0 };
  private size = 0;   // 平面目前蓋住幾格見方（R042：跟著世界的 w.n，換大小才重建）

  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    const geometry = new THREE.BufferGeometry();   // 第一次 update 照世界大小換成真的平面
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { ranges: { value: this.texture }, armedCount: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `
        varying vec2 worldXZ;
        void main() {
          worldXZ = (modelMatrix * vec4(position, 1.0)).xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D ranges;
        uniform int armedCount;
        varying vec2 worldXZ;
        void main() {
          bool inAllRanges = true;
          bool outerRing = false;
          bool innerRing = false;
          for (int i = 0; i < ${MULTI_RANGE_CAP}; i++) {
            if (i >= armedCount) break;
            vec4 a = texture2D(ranges, vec2((float(i) + 0.5) / ${MULTI_RANGE_CAP}.0, 0.5));
            float d = length(worldXZ - a.xy);
            inAllRanges = inAllRanges && d >= a.z && d <= a.w;
            outerRing = outerRing || abs(d - a.w) <= 0.055;
            innerRing = innerRing || (a.z > 0.0 && abs(d - a.z) <= 0.055);
          }
          if (armedCount == 0 || (!inAllRanges && !outerRing && !innerRing)) discard;
          // Transparent diagonal hatching distinguishes intersection from overlapping circles.
          float hatch = step(0.63, fract((worldXZ.x + worldXZ.y) * 2.0));
          vec3 tint = vec3(0.15, 0.85, 0.9);
          float opacity = 0.13 + hatch * 0.21;
          if (outerRing) { tint = vec3(1.0, 0.78, 0.25); opacity = 0.94; }
          if (innerRing) { tint = vec3(1.0, 0.22, 0.12); opacity = 0.94; }
          gl_FragColor = vec4(tint, opacity);
          #include <colorspace_fragment>
        }`,
    });
    material.forceSinglePass = true;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'multi-range-r122';
    this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
  }

  // 整張地圖一片平面；只在地圖邊長變了才換幾何（不是每幀）
  private resize(n: number): void {
    if (n === this.size) return;
    this.size = n;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(n, n).rotateX(-Math.PI / 2).translate(n / 2, 0.048, n / 2);
  }

  update(w: World, selected: ReadonlySet<number>, enabled = true): Readonly<typeof this.solution> {
    this.resize(w.n);
    const s = this.solution;
    s.legend = ''; s.reason = 'empty'; s.selectedCount = s.armedCount = s.excludedCount = 0;
    this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0); this.mesh.material.uniforms.armedCount.value = 0;
    this.data.fill(0);
    if (!enabled) { s.reason = 'disabled'; return s; }
    for (const u of w.units) {
      if (!u.alive || u.side !== SIDE_PLAYER || !selected.has(u.id)) continue;
      s.selectedCount++;
      const k = UNIT_KINDS[u.kind];
      if (k.range <= 0) { s.excludedCount++; continue; }
      const at = s.armedCount++ * 4;
      if (at >= this.data.length) continue;
      this.data[at] = u.x / SUB; this.data[at + 1] = u.z / SUB;
      this.data[at + 2] = k.minRange / SUB; this.data[at + 3] = k.range / SUB;
    }
    if (s.selectedCount < 2) { s.reason = s.selectedCount ? 'single' : 'empty'; return s; }
    if (s.armedCount > MULTI_RANGE_CAP) {
      s.reason = 'overflow'; s.legend = '多選超過 512 個武裝顯示容量，未顯示不完整共同區域'; return s;
    }
    if (!s.armedCount) { s.reason = 'unarmed'; s.legend = `多選 ${s.selectedCount} 個無武裝單位：沒有武器射程`; return s; }
    s.reason = 'multiple';
    s.legend = `多選 ${s.armedCount} 武裝：金圈各自射程／紅圈近限；青紋共同名目覆蓋${s.excludedCount ? `（排除 ${s.excludedCount} 無武裝）` : ''}。不保證視線／命中`;
    this.mesh.material.uniforms.armedCount.value = s.armedCount;
    this.texture.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, 6);
    this.mesh.visible = true;
    return s;
  }

  // Diagnostic predicate mirrors the analytical contract; tests use independent expected points.
  contains(x: number, z: number): boolean {
    if (!this.mesh.visible || x < 0 || z < 0 || x > this.size || z > this.size) return false;
    for (let i = 0; i < this.solution.armedCount; i++) {
      const at = i * 4, dx = x - this.data[at], dz = z - this.data[at + 1];
      const d2 = dx * dx + dz * dz, min = this.data[at + 2], max = this.data[at + 3];
      if (d2 < min * min || d2 > max * max) return false;
    }
    return true;
  }

  dispose(): void { this.texture.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
