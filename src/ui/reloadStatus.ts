import { SIDE_PLAYER, TICK_HZ, UNIT_KINDS, UK_HOWITZER, UK_ATGUN, UK_MORTAR, type World } from '../sim/world.ts';

// R123: presentation only. A loaded weapon may still lack range, LOS or a valid target.
export function reloadStatus(w: World, selected: ReadonlySet<number>, enabled = true): string {
  if (!enabled) return '';
  let ready = 0, loading = 0, low = Infinity, high = 0;
  for (const u of w.units) {
    if (!selected.has(u.id) || !u.alive || u.side !== SIDE_PLAYER) continue;
    const k = UNIT_KINDS[u.kind];
    if (!k.armored && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;
    if (u.cooldown <= 0) ready++;
    else {
      loading++;
      // Round upward: a weapon with one tick remaining must not appear loaded.
      const tenths = Math.ceil(u.cooldown * 10 / TICK_HZ);
      low = Math.min(low, tenths); high = Math.max(high, tenths);
    }
  }
  if (!ready && !loading) return '';
  const remaining = loading ? `；剩餘 ${(low / 10).toFixed(1)}${low === high ? '' : `–${(high / 10).toFixed(1)}`} 模擬秒` : '';
  return `裝填完成 ${ready}／裝填中 ${loading}${remaining}；裝填完成不代表可射擊`;
}
