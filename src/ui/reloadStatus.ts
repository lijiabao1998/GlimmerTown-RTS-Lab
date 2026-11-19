import { INTERNATIONAL_KINDS, SOVIET_KINDS, TICK_HZ, UNIT_KINDS, UK_HOWITZER, UK_ATGUN, UK_MORTAR, moraleState, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）

// R123: presentation only. A loaded weapon may still lack range, LOS or a valid target.
export function reloadStatus(w: World, selected: ReadonlySet<number>, enabled = true): string {
  if (!enabled) return '';
  let ready = 0, loading = 0, low = Infinity, high = 0, pressed = 0;
  for (const u of w.units) {
    if (!selected.has(u.id) || !u.alive || u.side !== SIDE_PLAYER) continue;
    const k = UNIT_KINDS[u.kind];
    if (!INTERNATIONAL_KINDS.includes(u.kind) && !k.armored && !SOVIET_KINDS.includes(u.kind) && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;
    if (k.carry) continue;   // R092 運輸車沒有武裝（上一行是守衛錨點，不動）
    const ms = w.rules?.morale ? moraleState(u) : 0;   // R052：受壓裝填慢一倍、釘住慢四倍、潰退不開火（剩餘時間照釘住估）
    if (ms) pressed++;
    if (u.cooldown <= 0) ready++;
    else {
      loading++;
      // Round upward: a weapon with one tick remaining must not appear loaded.
      const tenths = Math.ceil(u.cooldown * 10 / TICK_HZ) * (ms >= 2 ? 4 : ms ? 2 : 1);
      low = Math.min(low, tenths); high = Math.max(high, tenths);
    }
  }
  if (!ready && !loading) return '';
  const note = pressed ? `；${pressed} 個被壓制（裝填變慢，潰退的不開火）` : '';   // R052
  const remaining = (loading ? `；剩餘 ${(low / 10).toFixed(1)}${low === high ? '' : `–${(high / 10).toFixed(1)}`} 模擬秒` : '') + note;
  return `裝填完成 ${ready}／裝填中 ${loading}${remaining}；裝填完成不代表可射擊`;
}
