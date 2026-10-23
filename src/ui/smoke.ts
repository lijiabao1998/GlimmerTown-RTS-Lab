// R107：輸入路由只讀世界、產生指令。命中的單位由畫面先做可見性篩選。
import { SUB, SIDE_PLAYER, UK_HOWITZER, UNIT_KINDS, bldAt, type World } from '../sim/world.ts';
import type { Command } from '../sim/step.ts';

export type AmmoMode = 'he' | 'smoke';
export interface OrderHit {
  unit: number;
  building: [number, number] | null;
  ground: { x: number; z: number } | null;
}
export interface OrderRoute {
  commands: Command[];
  marker: { x: number; z: number; hostile: boolean };
}
const validCell = (w: World, x: number, z: number) => Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < w.n && z < w.n;

export function routeBattleOrder(w: World, selected: Iterable<number>, fireMode: boolean, ammo: AmmoMode, hit: OrderHit): OrderRoute | null {
  const ids = [...selected].filter(id => w.units[id - 1]?.alive && w.units[id - 1].side === SIDE_PLAYER);
  if (!ids.length) return null;
  const target = hit.unit ? w.units[hit.unit - 1] : null;
  const cell = hit.building ?? (hit.ground ? [Math.floor(hit.ground.x), Math.floor(hit.ground.z)] : null);
  const fire = (chosen: number[], x: number, z: number, smoke = false): OrderRoute => ({
    commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: chosen, x, z, ...(smoke ? { ammo: 'smoke' as const } : {}) }],
    marker: { x: x + 0.5, z: z + 0.5, hostile: true },
  });
  // 煙幕優先於攻擊／進駐：混選的坦克、迫擊砲與步兵都留在原指令。
  if (fireMode && ammo === 'smoke') {
    const guns = ids.filter(id => w.units[id - 1].kind === UK_HOWITZER);
    const aim = target ? [Math.floor(target.x / SUB), Math.floor(target.z / SUB)] : cell;
    return guns.length && aim && validCell(w, aim[0], aim[1]) ? fire(guns, aim[0], aim[1], true) : null;
  }
  if (target && target.side !== SIDE_PLAYER) return {
    commands: [{ t: 'attack', side: SIDE_PLAYER, ids, target: target.id }],
    marker: { x: target.x / SUB, z: target.z / SUB, hostile: true },
  };
  if (hit.building) {
    const [x, z] = hit.building;
    const observers = ids.filter(id => UNIT_KINDS[w.units[id - 1].kind].garrison);
    const armed = ids.filter(id => !UNIT_KINDS[w.units[id - 1].kind].garrison);
    const commands: Command[] = [];
    if (observers.length) commands.push({ t: 'move', side: SIDE_PLAYER, ids: observers, x, z });
    if (armed.length) commands.push({ t: 'fireAt', side: SIDE_PLAYER, ids: armed, x, z });
    return { commands, marker: { x: x + 0.5, z: z + 0.5, hostile: true } };
  }
  if (!cell || !validCell(w, cell[0], cell[1])) return null;
  const [x, z] = cell, b = bldAt(w, x, z);
  const guns = ids.filter(id => UNIT_KINDS[w.units[id - 1].kind].indirect);
  if ((b && b.hp > 0) || (fireMode && guns.length)) return fire(b && b.hp > 0 ? ids : guns, x, z);
  return { commands: [{ t: 'move', side: SIDE_PLAYER, ids, x, z }], marker: { x: x + 0.5, z: z + 0.5, hostile: false } };
}
