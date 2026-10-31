import { bldAt, ORD_FIRE_AT, SHELL_SMOKE, type World } from '../sim/world.ts';
import { fireDisciplineEligible } from '../sim/fireDiscipline.ts';

// Presentation only: target is remaining rounds only for an active fireAt order.
// Do not infer success from an idle order: cancellation/death/abandonment also end orders.
export function bombardStatus(w: World, selected: ReadonlySet<number>, enabled = true): string {
  if (!enabled) return '';
  let eligible = 0, finite = 0, rounds = 0, buildings = 0, ending = 0, held = 0, moving = 0;
  for (const u of w.units) {
    if (!selected.has(u.id) || !fireDisciplineEligible(u)) continue;
    eligible++;
    if (u.order !== ORD_FIRE_AT) continue;
    if (u.target > 0) { finite++; rounds += u.target; }
    else if (u.fireAmmo !== SHELL_SMOKE && (bldAt(w, u.tx, u.tz)?.hp ?? 0) > 0) buildings++;
    else ending++;
    if (u.holdFire === 1) held++;
    if (u.pathIdx < u.path.length) moving++;
  }
  if (!eligible) return '';
  if (!finite && !buildings && !ending) return '砲擊任務：無進行中任務（不代表停止自動射擊）';
  const parts: string[] = [];
  if (finite) parts.push(`定量 ${finite} 門／剩餘合計 ${rounds} 發`);
  if (buildings) parts.push(`建築目標 ${buildings} 門（打至瓦礫）`);
  if (ending) parts.push(`收尾 ${ending} 門（在途彈仍有效）`);
  if (held) parts.push(`停火待命 ${held} 門`);
  if (moving) parts.push(`行進中 ${moving} 門`);
  return `砲擊任務：${parts.join('；')}`;
}
