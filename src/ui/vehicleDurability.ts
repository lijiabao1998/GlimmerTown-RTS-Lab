import { INTERNATIONAL_KINDS, SOVIET_KINDS, SIDE_PLAYER, UNIT_KINDS, UK_HOWITZER, UK_ATGUN, UK_MORTAR, type World } from '../sim/world.ts';

// R135: read existing HP only; durability is not armor or firing eligibility.
export function vehicleDurability(w: World, selected: ReadonlySet<number>, enabled = true): string {
  if (!enabled) return '';
  let count = 0, lowHp = 0, lowMax = 1;
  for (const u of w.units) {
    if (!selected.has(u.id) || !u.alive || u.side !== SIDE_PLAYER) continue;
    const k = UNIT_KINDS[u.kind];
    if (!INTERNATIONAL_KINDS.includes(u.kind) && !k.armored && !SOVIET_KINDS.includes(u.kind) && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;
    // Compare ratios before rounding, not raw HP or an average across kinds.
    if (!count || u.hp * lowMax < lowHp * k.hp) { lowHp = u.hp; lowMax = k.hp; }
    count++;
  }
  if (!count) return '';
  if (count === 1) return `車輛耐久：${lowHp}/${lowMax}`;
  // Round down: even one lost HP must never be displayed as full durability.
  return `車輛耐久：${count} 輛；最低 ${Math.floor(100 * lowHp / lowMax)}%`;
}
