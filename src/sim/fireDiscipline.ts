import { SIDE_PLAYER, UNIT_KINDS, type Unit } from './world.ts';

// Player-issued vehicle/gun discipline only; infantry and enemy AI remain untouched.
export function fireDisciplineEligible(u: Unit): boolean {
  const k = UNIT_KINDS[u.kind];
  return u.alive && u.side === SIDE_PLAYER && !!k && k.range > 0 && !k.men;
}
