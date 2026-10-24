// R115：真實砲聲的量化情報。持續狀態只在 World；不抽亂數、不改射擊或可見性。
import { SUB, TICK_HZ, UNIT_KINDS, type World, type CounterbatteryReport } from './world.ts';

export const COUNTERBATTERY_TTL = 30 * TICK_HZ;
export const COUNTERBATTERY_CAP = 8;
export const COUNTERBATTERY_LEVELS = 3;
const ZONE_CELLS = 8, CELL_CELLS = 2, CELLS = ZONE_CELLS / CELL_CELLS;
// 每邊幾個 8×8 粗區，看世界自己的邊長（32×32＝4，跟以前一樣）
const zonesOf = (w: World) => Math.ceil(w.n / ZONE_CELLS);

// 對畫面只公開當級中心／半軸，單位皆為 SUB；不帶 zone、cell、單位或精確發射座標。
export interface CounterbatteryArea { x: number; z: number; rx: number; rz: number; level: number }
export interface CounterbatteryAreaBuffer { areas: CounterbatteryArea[]; count: number }

function projectArea(r: CounterbatteryReport, area: CounterbatteryArea, zones: number): CounterbatteryArea {
  const level = r.shots, size = ZONE_CELLS >> (level - 1);
  const bx = (r.zone % zones) * ZONE_CELLS, bz = Math.floor(r.zone / zones) * ZONE_CELLS;
  const cx = (r.cell % CELLS) * CELL_CELLS, cz = Math.floor(r.cell / CELLS) * CELL_CELLS;
  area.x = (bx + Math.floor(cx / size) * size) * SUB + (size * SUB >> 1);
  area.z = (bz + Math.floor(cz / size) * size) * SUB + (size * SUB >> 1);
  area.rx = size * SUB; area.rz = size * SUB * 3 / 4; area.level = level;
  return area;
}

export function hasCounterbattery(w: World, side: number): boolean {
  const reports = w.counterbattery;
  if (!reports) return false;
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    if (r.side === side && w.tick - r.last < COUNTERBATTERY_TTL) return true;
  }
  return false;
}

// 呼叫者預先配置8個公開投影slot；只覆寫buffer，不配置／縮放陣列，不改World。
export function counterbatteryAreasInto(w: World, side: number, buffer: CounterbatteryAreaBuffer): void {
  buffer.count = 0;
  const reports = w.counterbattery;
  if (!reports) return;
  // 固定粗區順序（32×32 是16區），不用sort或暫存報告；世界即使來自clone仍是相同結果。
  const zones = zonesOf(w);
  for (let zone = 0; zone < zones * zones; zone++) for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    if (r.zone !== zone || r.side !== side || w.tick - r.last >= COUNTERBATTERY_TTL) continue;
    projectArea(r, buffer.areas[buffer.count], zones);
    buffer.count++;
    if (buffer.count === COUNTERBATTERY_CAP) return;
  }
}

export function counterbatteryAreas(w: World, side: number): CounterbatteryArea[] {
  return (w.counterbattery ?? []).filter(r => r.side === side && w.tick - r.last < COUNTERBATTERY_TTL)
    .sort((a, b) => a.zone - b.zone).map(r => projectArea(r, { x: 0, z: 0, rx: 0, rz: 0, level: 0 }, zonesOf(w)));
}

// step 尾端 tick++ 後呼叫一次。事件的發射座標才是聲源；砲手當步死亡仍保留砲聲。
export function updateCounterbattery(w: World): void {
  const heard = new Map<number, CounterbatteryReport>();
  const zones = zonesOf(w);
  for (const e of w.events) {
    if (e.e !== 'fire') continue;
    const gun = w.units.find(u => u.id === e.unit);
    if (!gun || !UNIT_KINDS[gun.kind].indirect) continue;
    if (e.x < 0 || e.z < 0 || e.x >= w.n * SUB || e.z >= w.n * SUB) continue;
    const gx = Math.floor(e.x / SUB), gz = Math.floor(e.z / SUB), side = 1 - gun.side;
    const zone = Math.floor(gz / ZONE_CELLS) * zones + Math.floor(gx / ZONE_CELLS);
    const cell = Math.floor((gz % ZONE_CELLS) / CELL_CELLS) * CELLS + Math.floor((gx % ZONE_CELLS) / CELL_CELLS);
    const key = side * zones * zones + zone, previous = heard.get(key);
    // 同步多聲源只選固定最小子區；選中的同子區多發可累積，與 id／陣列順序無關。
    if (!previous || cell < previous.cell) heard.set(key, { side, zone, cell, shots: 1, last: w.tick });
    else if (cell === previous.cell) previous.shots = Math.min(COUNTERBATTERY_LEVELS, previous.shots + 1);
  }
  const reports = (w.counterbattery ?? []).filter(r => w.tick - r.last < COUNTERBATTERY_TTL);
  for (const next of heard.values()) {
    const old = reports.find(r => r.side === next.side && r.zone === next.zone);
    if (old) {
      old.shots = old.cell === next.cell ? Math.min(COUNTERBATTERY_LEVELS, old.shots + next.shots) : next.shots;
      old.cell = next.cell; old.last = next.last;
    } else reports.push(next);
  }
  // 最新優先；同 tick 留較小粗區。儲存時再排回 side／zone，跨引擎順序一致。
  reports.sort((a, b) => a.side - b.side || b.last - a.last || a.zone - b.zone);
  const count = [0, 0], keep = reports.filter(r => count[r.side]++ < COUNTERBATTERY_CAP);
  keep.sort((a, b) => a.side - b.side || a.zone - b.zone);
  if (keep.length) w.counterbattery = keep;
  else delete w.counterbattery;
}
