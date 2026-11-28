import assert from 'node:assert/strict';
import { applyCommand } from '../src/sim/step.ts';
import { cellOf, createWorld, UK_INFANTRY } from '../src/sim/world.ts';
import { setViewSide } from '../src/side.ts';
import { drawMoveDestinations, moveStops, updateMoveDestinations } from '../src/ui/moveDestinations.ts';

const w = createWorld(1944), [tank, second] = w.units;
// A closed wall separates the goal from the vehicles. Let the real path search
// pick the nearest reachable cell, independently of the requested tile.
for (let z = 0; z < w.n; z++) w.occ[z * w.n + 16] = 1;
applyCommand(w, { t: 'move', side: 0, ids: [1, 2], x: 10, z: 20 });
const stops = moveStops(w, [1, 2, 1, 5, 9]);
for (const u of [tank, second]) {
  const end = u.path.at(-1);
  assert(end !== undefined && end % w.n > 16, 'vehicles stop on the reachable side of the wall');
  assert(stops.get(end)?.includes(u.id), 'show the actual reachable endpoint');
}
assert.deepEqual([...stops.values()].flat().sort(), [1, 2]);
second.path = tank.path.slice();
assert.deepEqual([...moveStops(w, [1, 2]).values()], [[1, 2]], 'shared cell retains both vehicles');
tank.order = 0;
tank.path = [];
assert(moveStops(w, [1, 2]).get(cellOf(tank.z) * w.n + cellOf(tank.x)).includes(1), 'stationary vehicle stays in its own cell');
for (const attrs of [{ kind: UK_INFANTRY }, { alive: false }, { rout: 1 }, { towBy: 2 }, { ride: 2 }]) {
  const copy = structuredClone(w);
  Object.assign(copy.units[0], attrs);
  assert.equal(moveStops(copy, [1, 2]).size, 0, 'one eligible vehicle left: ' + JSON.stringify(attrs));
}
setViewSide(1);
assert.equal(moveStops(w, [1, 2]).size, 0);
assert.equal([...moveStops(w, [5, 6]).values()].flat().length, 2, 'joining player sees their own vehicles');
setViewSide();

let layer;
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute() {}, append() {}, remove() { layer = undefined; } }),
  getElementById: () => ({ prepend(el) { layer = el; } }),
};
const groupMove = { t: 'move', side: 0, x: 18, z: 20, ids: [1, 2] };
updateMoveDestinations(w, [{ ...groupMove, side: 1, ids: [5, 6] }]);
assert.equal(layer, undefined, 'enemy orders never show their endpoints');
updateMoveDestinations(w, [groupMove]);
assert(layer, 'friendly group produces an overlay');
drawMoveDestinations(createWorld(1944), {});
assert.equal(layer, undefined, 'new game with the same seed drops the previous overlay');
updateMoveDestinations(w, [groupMove, { ...groupMove, ids: [2] }]);
assert.equal(layer, undefined, 'new single-vehicle order replaces group feedback');
console.log('OK R147 reachable cells, shared stops, ineligible units and both player sides');
