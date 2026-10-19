// R115：只用當級公開投影，不能由隱藏單位的位置／存亡修正歷史砲聲。
import { N, SUB, SIDE_PLAYER, type World } from '../sim/world.ts';
import { counterbatteryAreasInto, hasCounterbattery, type CounterbatteryAreaBuffer } from '../sim/counterbattery.ts';

export const COUNTERBATTERY_SEGMENTS = 40;
const CIRCLE = Array.from({ length: COUNTERBATTERY_SEGMENTS }, (_, i) => {
  const angle = i * Math.PI * 2 / COUNTERBATTERY_SEGMENTS;
  return [Math.cos(angle), Math.sin(angle)];
});
const INFO = '小地圖橙虛線：疑似敵砲，非精確位置';
const DASH = [3, 2], CORNERS = [[0, 0], [N, 0], [N, N], [0, N]];
const AREA_BUFFER: CounterbatteryAreaBuffer = {
  areas: Array.from({ length: 8 }, () => ({ x: 0, z: 0, rx: 0, rz: 0, level: 0 })), count: 0,
};

export function counterbatteryHint(w: World, enabled = true): string {
  return enabled && hasCounterbattery(w, SIDE_PLAYER) ? INFO : '';
}

// 在世界中採樣，再逐點走小地圖的斜交投影；地圖外頂點保留，統一裁在菱形。
export function drawCounterbattery(ctx: CanvasRenderingContext2D, w: World,
  project: (x: number, z: number) => [number, number], enabled = true): void {
  if (!enabled) return;
  counterbatteryAreasInto(w, SIDE_PLAYER, AREA_BUFFER);
  const areas = AREA_BUFFER.areas;
  if (!AREA_BUFFER.count) return;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < CORNERS.length; i++) {
    const corner = CORNERS[i], point = project(corner[0], corner[1]);
    if (i) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
  }
  ctx.closePath(); ctx.clip();
  ctx.strokeStyle = '#ffb54a'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.setLineDash(DASH);
  for (let i = 0; i < AREA_BUFFER.count && i < 8; i++) {
    const area = areas[i];
    ctx.beginPath();
    for (let j = 0; j < COUNTERBATTERY_SEGMENTS; j++) {
      const circle = CIRCLE[j];
      const point = project((area.x + circle[0] * area.rx) / SUB, (area.z + circle[1] * area.rz) / SUB);
      if (j) ctx.lineTo(point[0], point[1]); else ctx.moveTo(point[0], point[1]);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}
