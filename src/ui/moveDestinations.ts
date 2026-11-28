import type { BattleView } from '../render/battle.ts';
import type { Command } from '../sim/step.ts';
import { cellOf, ORD_IDLE, ORD_MOVE, UK_OBSERVER, UNIT_KINDS, type World } from '../sim/world.ts';
import { SIDE_PLAYER } from '../side.ts';

// The path can end short of tx/tz when a building or the map edge blocks the requested slot.
export function moveStops(w: World, ids: readonly number[]): Map<number, number[]> {
  const stops = new Map<number, number[]>();
  let vehicles = 0;
  for (const id of new Set(ids)) {
    const u = w.units[id - 1];
    if (!u?.alive || u.side !== SIDE_PLAYER || u.rout || u.ride || u.towBy) continue;
    if (u.kind === UK_OBSERVER || UNIT_KINDS[u.kind].men || (u.order !== ORD_MOVE && u.order !== ORD_IDLE)) continue;
    const end = u.order === ORD_MOVE ? u.path.at(-1) : undefined;
    const cell = end ?? (cellOf(u.z) * w.n + cellOf(u.x));
    const group = stops.get(cell);
    if (group) group.push(id);
    else stops.set(cell, [id]);
    vehicles++;
  }
  if (vehicles < 2) stops.clear();
  return stops;
}

interface Pin { cell: number; el: HTMLSpanElement }
let active: { world: World; layer: HTMLElement; pins: Pin[]; until: number } | undefined;

function clear() {
  active?.layer.remove();
  active = undefined;
}

export function updateMoveDestinations(w: World, commands: readonly Command[]) {
  for (let i = commands.length - 1; i >= 0; i--) {
    const c = commands[i];
    if (c.t === 'sandboxReset') { clear(); return; }
    if (c.t !== 'move' && c.t !== 'stop' && c.t !== 'attack' && c.t !== 'fireAt') continue;
    if (c.side !== SIDE_PLAYER) continue;
    clear();
    if (c.t !== 'move' || c.ids.length < 2 || w.winner >= 0) return;
    const stops = moveStops(w, c.ids);
    if (!stops.size) return;
    const layer = document.createElement('div');
    layer.id = 'move-destinations';
    layer.setAttribute('aria-hidden', 'true');
    const pins: Pin[] = [];
    for (const [cell, ids] of stops) {
      const el = document.createElement('span');
      el.textContent = ids.length === 1 ? '#' + ids[0] : '×' + ids.length;
      layer.append(el);
      pins.push({ cell, el });
    }
    document.getElementById('hud')?.prepend(layer);
    active = { world: w, layer, pins, until: performance.now() + 2000 };
    return;
  }
}

export function drawMoveDestinations(w: World, view: Pick<BattleView, 'screenOf'>) {
  if (!active) return;
  if (w !== active.world || w.winner >= 0 || performance.now() >= active.until) { clear(); return; }
  for (const { cell, el } of active.pins) {
    const [x, y] = view.screenOf(cell % w.n + 0.5, 0, Math.floor(cell / w.n) + 0.5, innerWidth, innerHeight);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
