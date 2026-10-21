import { SIDE_PLAYER, ORD_FIRE_AT, SHELL_SMOKE, UNIT_KINDS, UK_HOWITZER, UK_ATGUN, UK_MORTAR, bldAt, bldMaterial, BLD_MATERIAL_NAMES, stageOf, type Building, type World } from '../sim/world.ts';

// R124: the same public building state as R009's bombardment target bars.
// Never inspect enemy orders or occupants; stored maxHp also preserves legacy saves.
export function coverDurability(w: World, selected: ReadonlySet<number>, enabled = true): string {
  if (!enabled) return '';
  const targets = new Map<number, Building>();
  for (const u of w.units) {
    if (!selected.has(u.id) || !u.alive || u.side !== SIDE_PLAYER) continue;
    const k = UNIT_KINDS[u.kind];
    if (!k.armored && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;
    if (u.order !== ORD_FIRE_AT || (u.target !== 0 && !(u.fireAmmo === SHELL_SMOKE && u.target > 0)) || !Number.isInteger(u.tx) || !Number.isInteger(u.tz)) continue;
    const b = bldAt(w, u.tx, u.tz);
    if (b) targets.set(b.id, b);
  }
  if (!targets.size) return '';
  // Cross multiplication avoids rounding away the most fragile target.
  const ordered = [...targets.values()].sort((a, b) => a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id);
  const text = ordered.slice(0, 2).map(b => `#${b.id}(${b.x},${b.z}) ${BLD_MATERIAL_NAMES[bldMaterial(b.kind)]} ${b.hp}/${b.maxHp} ${['完整', '重損', '瓦礫'][stageOf(b)]}`).join('；');
  return `掩體目標 ${targets.size}：${text}${targets.size > 2 ? `；另 ${targets.size - 2} 棟未列（低耐久優先）` : ''}`;
}
