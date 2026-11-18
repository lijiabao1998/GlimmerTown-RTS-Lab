import { SIDE_PLAYER, SIDE_ENEMY, UNIT_KINDS, type Unit, type World } from './world.ts';

// Player-issued vehicle/gun discipline only; infantry and enemy AI remain untouched.
// R085：左右對稱的局（R084 的 sym，新開的局才有）第 1 方也算——連線對戰時左上那一方是人在指揮；沒有 sym 的局照舊只有第 0 方
export function fireDisciplineEligible(u: Unit, w?: World): boolean {
  const k = UNIT_KINDS[u.kind];
  return u.alive && (u.side === SIDE_PLAYER || (!!w?.sym && u.side === SIDE_ENEMY)) && !!k && k.range > 0 && (!k.men || !!k.hold);   // R091：狙擊手、反戰車小組有人數也收
}
