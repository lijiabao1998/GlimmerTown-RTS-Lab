// R107：輸入路由只讀世界、產生指令。命中的單位由畫面先做可見性篩選。
import { SUB, UK_HOWITZER, UNIT_KINDS, bldAt, wireAt, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';   // R085「我方」可以換（連線對戰）
import type { Command } from '../sim/step.ts';
import { air93Route } from './air93.ts';   // R093 空中鍵
import { tech50Route } from './tech50.ts';   // R050 建造
import { TECH50 } from '../sim/tech50.ts';   // R1004：自己的工地、兵營、車廠、補給站
import { bag1007Route } from './sandbag1007.ts';   // R1007 沙包

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
  const air = air93Route(w, hit); if (air !== undefined) return air;   // R093 空中鍵：不用先選單位
  const b50 = tech50Route(w, selected, hit); if (b50 !== undefined) return b50;   // R050 建造：選好要蓋的之後，點地圖＝放工地（帶選取裡的工兵）
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
  // R1004：點到躲在還站著的房子、碉堡裡的敵人＝選取裡的工兵對那一棟放炸藥（點碉堡多半點到裡面的人；工兵拿步槍打碉堡牆是 0 傷害），其他照舊攻擊
  const home = target && target.side !== SIDE_PLAYER ? bldAt(w, Math.floor(target.x / SUB), Math.floor(target.z / SUB)) : null;
  const sappers = home && home.hp > 0 ? ids.filter(id => !!UNIT_KINDS[w.units[id - 1].kind].demo) : [];
  if (target && target.side !== SIDE_PLAYER && sappers.length) {
    const rest = ids.filter(id => !sappers.includes(id));
    return { commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: sappers, x: home!.x, z: home!.z }, ...(rest.length ? [{ t: 'attack' as const, side: SIDE_PLAYER, ids: rest, target: target.id }] : [])], marker: { x: target.x / SUB, z: target.z / SUB, hostile: true } };
  }
  if (target && target.side !== SIDE_PLAYER) return {
    commands: [{ t: 'attack', side: SIDE_PLAYER, ids, target: target.id }],
    marker: { x: target.x / SUB, z: target.z / SUB, hostile: true },
  };
  if (hit.building) {
    const [x, z] = hit.building;
    const observers = ids.filter(id => UNIT_KINDS[w.units[id - 1].kind].garrison);
    const mine50 = own50ui(w, x, z), armed = ids.filter(id => !UNIT_KINDS[w.units[id - 1].kind].garrison && (!mine50 || !!UNIT_KINDS[w.units[id - 1].kind].demo));   // R1004：自己的工地、兵營、車廠、補給站只有工兵收（回去蓋；蓋好的工兵本來就不炸），坦克不會把自己的兵營轟掉
    const commands: Command[] = [];
    if (observers.length) commands.push({ t: 'move', side: SIDE_PLAYER, ids: observers, x, z });
    if (armed.length) commands.push({ t: 'fireAt', side: SIDE_PLAYER, ids: armed, x, z });
    return { commands, marker: { x: x + 0.5, z: z + 0.5, hostile: true } };
  }
  if (!cell || !validCell(w, cell[0], cell[1])) return null;
  const [x, z] = cell, b = bldAt(w, x, z);
  const guns = ids.filter(id => UNIT_KINDS[w.units[id - 1].kind].indirect);
  if (b && b.hp > 0 && own50ui(w, x, z)) { const eng = ids.filter(id => !!UNIT_KINDS[w.units[id - 1].kind].demo); return eng.length ? fire(eng, x, z) : null; }   // R1004：同上（點地面點到自己的那幾種建築）
  if ((b && b.hp > 0) || (fireMode && guns.length)) return fire(b && b.hp > 0 ? ids : guns, x, z);
  const bag = bag1007Route(w, ids, x, z); if (bag) return bag;   // R1007：點到有人堆的沙包——對方的＝工兵去炸、自己的工地＝工兵去堆，其他人走過去；自己堆好的照舊全部走進去
  const cut = (wireAt(w, x, z)?.hp ?? 0) > 0 ? ids.filter(id => !!UNIT_KINDS[w.units[id - 1].kind].demo) : [], rest = ids.filter(id => !cut.includes(id));   // R1002：點到還沒壞的鐵絲網＝工兵去剪，其他照舊走過去
  if (cut.length) return { commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: cut, x, z }, ...(rest.length ? [{ t: 'move' as const, side: SIDE_PLAYER, ids: rest, x, z }] : [])], marker: { x: x + 0.5, z: z + 0.5, hostile: true } };
  return { commands: [{ t: 'move', side: SIDE_PLAYER, ids, x, z }], marker: { x: x + 0.5, z: z + 0.5, hostile: false } };
}

// R1004：那一格是不是自己的工地或自己蓋的兵營、車廠、補給站（R050 的三種）
const own50ui = (w: World, x: number, z: number): boolean => { const b = bldAt(w, x, z); return !!b && b.hp > 0 && b.builtBy === SIDE_PLAYER && TECH50[b.kind] !== undefined; };
