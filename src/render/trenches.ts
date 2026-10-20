// R118：戰壕只刻進既有地面貼圖；連接快取同時供小地圖使用，不新增網格。
import { N, inMap, idx, type World } from '../sim/world.ts';
import { trenchCells } from '../sim/trenches.ts';

export const TRENCH_E = 1, TRENCH_S = 2, TRENCH_W = 4, TRENCH_N = 8;
export const TRENCH_MINI_COLORS = ['#bba16c', '#c29463', '#84765c', '#dec997'] as const;
const FLOOR = [0x30291f, 0x382c20, 0x514432, 0x28241e];
const WALL = [0x68513a, 0x765539, 0x8b7755, 0x705c41];
const BANK = [0xb69a68, 0xc09560, 0x9a875e, 0xc7ad7a];

// 世界／狀態／清單身分＋長度是 O(1) 快取鍵；事件處理可明確強制更新。
// 每格 kind+1，0 為沒有戰壕；links 是四方向鄰格，兩方通用掩體也可相接。
export class TrenchRaster {
  readonly kinds = new Uint8Array(N * N);
  readonly links = new Uint8Array(N * N);
  builds = 0;
  cells = 0;
  private world: World | undefined;
  private state: World['trenches'];
  private segments: NonNullable<World['trenches']>['segments'] | undefined;
  private count = -1;
  readonly enabled: boolean;
  constructor(enabled = true) { this.enabled = enabled; }
  sync(w: World, changed = false): boolean {
    const state = w.trenches, segments = state?.segments, count = segments?.length ?? 0;
    if (this.world === w && this.state === state && this.segments === segments && this.count === count && !changed) return false;
    this.world = w; this.state = state; this.segments = segments; this.count = count;
    const hadCells = this.cells > 0;
    this.kinds.fill(0); this.links.fill(0); this.cells = 0; this.builds++;
    if (!this.enabled || !state) return hadCells;
    for (const segment of state.segments) for (const [x, z] of trenchCells(segment)) {
      if (!inMap(x, z)) continue;
      const i = idx(x, z);
      if (!this.kinds[i]) this.cells++;
      this.kinds[i] = segment.kind + 1;
    }
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z); if (!this.kinds[i]) continue;
      this.links[i] = (x + 1 < N && this.kinds[i + 1] ? TRENCH_E : 0)
        | (z + 1 < N && this.kinds[i + N] ? TRENCH_S : 0)
        | (x > 0 && this.kinds[i - 1] ? TRENCH_W : 0)
        | (z > 0 && this.kinds[i - N] ? TRENCH_N : 0);
    }
    return hadCells || this.cells > 0;
  }

  // 每格 8×8：深溝、暗壁、亮土沿；交通壕較窄，加固段的橫向木撐可辨識。
  // -1 表示保留既有地面。無配置、無世界寫入，車轍／彈坑重畫也保持壕溝。
  pixel(cell: number, px: number, py: number): number {
    const kind = this.kinds[cell] - 1; if (kind < 0) return -1;
    const links = this.links[cell], dx = Math.abs(px - 3.5), dz = Math.abs(py - 3.5);
    let distance = Math.max(dx, dz);
    if ((links & TRENCH_E && px >= 3) || (links & TRENCH_W && px <= 4)) distance = Math.min(distance, dz);
    if ((links & TRENCH_S && py >= 3) || (links & TRENCH_N && py <= 4)) distance = Math.min(distance, dx);
    if (distance > (kind === 2 ? 1.5 : 2.5)) return -1;
    if (kind === 3 && distance <= 1.5 && (((links & (TRENCH_E | TRENCH_W)) && (px === 2 || px === 5))
      || ((links & (TRENCH_N | TRENCH_S)) && (py === 2 || py === 5)))) return 0xcbb383;
    return distance <= 0.5 ? FLOOR[kind] : distance <= 1.5 ? WALL[kind] : BANK[kind];
  }
}
