// R116：可穿行的鄉間植被。只讀世界，一個不投影的合併網格；穩定畫面不重建。
import * as THREE from 'three';
import { type World } from '../sim/world.ts';
import { VEG_HEDGE, VEG_WOOD, VEGETATION_MAX, vegetationAt } from '../sim/vegetation.ts';
import { Geo } from './geo.ts';

let vegetation116 = true;
export function setVegetation(on: boolean): void { vegetation116 = on; }
export const VEGETATION_HINT = '樹籬／林地：可穿行、遮住穿越視線；林內承傷50%，掩護不疊加';
const HEDGE = new THREE.Color(0x536137), HEDGE_TOP = new THREE.Color(0x74804b);
const WOOD = new THREE.Color(0x425535), WOOD_TOP = new THREE.Color(0x617246), BARK = new THREE.Color(0x69513b);

// 英國落葉樹的低多邊形樹冠，非外部模型；每棵兩個有棱面的葉團。
function crown(g: Geo, x: number, y: number, z: number, r: number, h: number) {
  const north: [number, number, number] = [x, y, z - r], east: [number, number, number] = [x + r, y, z];
  const south: [number, number, number] = [x, y, z + r], west: [number, number, number] = [x - r, y, z];
  const top: [number, number, number] = [x, y + h, z], bottom: [number, number, number] = [x, y - h * 0.55, z];
  g.face3(north, east, top, [1, 1, -1], WOOD_TOP); g.face3(east, south, top, [1, 1, 1], WOOD_TOP);
  g.face3(south, west, top, [-1, 1, 1], WOOD_TOP); g.face3(west, north, top, [-1, 1, -1], WOOD_TOP);
  g.face3(east, north, bottom, [1, -1, -1], WOOD); g.face3(south, east, bottom, [1, -1, 1], WOOD);
  g.face3(west, south, bottom, [-1, -1, 1], WOOD); g.face3(north, west, bottom, [-1, -1, -1], WOOD);
}
export function vegetationGeometry(w: World): { geometry: THREE.BufferGeometry; cells: number } {
  const g = new Geo(); let cells = 0;
  for (let z = 0; z < w.n && cells < VEGETATION_MAX; z++) for (let x = 0; x < w.n && cells < VEGETATION_MAX; x++) {
    const kind = vegetationAt(w, x, z);
    if (kind !== VEG_HEDGE && kind !== VEG_WOOD) continue;
    cells++;
    if (kind === VEG_HEDGE) {
      const alongX = vegetationAt(w, x - 1, z) === VEG_HEDGE || vegetationAt(w, x + 1, z) === VEG_HEDGE;
      // 同一格三個矮葉團，順著樹籬相接；格子仍可走，不混入房屋點選幾何。
      for (let j = 0; j < 3; j++) {
        const cx = x + 0.5 + (alongX ? (j - 1) * 0.29 : 0), cz = z + 0.5 + (alongX ? 0 : (j - 1) * 0.29);
        g.box(cx - 0.19, 0.04, cz - 0.19, cx + 0.19, j === 1 ? 0.61 : 0.52, cz + 0.19, HEDGE, HEDGE_TOP);
      }
    } else {
      g.box(x + 0.45, 0.02, z + 0.45, x + 0.55, 0.73, z + 0.55, BARK);
      crown(g, x + 0.5, 0.81, z + 0.5, 0.46, 0.42);
      crown(g, x + 0.28, 0.64, z + 0.64, 0.25, 0.26);
    }
  }
  return { geometry: g.geometry(), cells };
}

export class VegetationView {
  mesh: THREE.Mesh | null = null;
  cells = 0;
  builds = 0;
  private world: World | undefined;
  private state: World['vegetation'];
  private enabled: boolean;
  private scene: THREE.Scene;
  private ramp: THREE.Texture;
  constructor(scene: THREE.Scene, ramp: THREE.Texture) { this.scene = scene; this.ramp = ramp; this.enabled = vegetation116; }
  sync(w: World, changed = false): void {
    if (this.world === w && this.state === w.vegetation && !changed) return;
    this.world = w; this.state = w.vegetation;
    if (!this.enabled || !w.vegetation) { this.clear(); return; }
    const next = vegetationGeometry(w); this.builds++; this.cells = next.cells;
    if (!next.cells) { next.geometry.dispose(); this.clear(); return; }
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = next.geometry; }
    else {
      this.mesh = new THREE.Mesh(next.geometry, new THREE.MeshToonMaterial({ gradientMap: this.ramp, vertexColors: true }));
      this.mesh.name = 'vegetation-r116';
      this.mesh.castShadow = false; this.mesh.receiveShadow = true;
      this.scene.add(this.mesh);
    }
  }
  private clear(): void {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh = null; }
    this.cells = 0;
  }
  get hint(): string { return this.cells ? VEGETATION_HINT : ''; }
  get triangles(): number { return this.mesh ? this.mesh.geometry.attributes.position.count / 3 : 0; }
}
