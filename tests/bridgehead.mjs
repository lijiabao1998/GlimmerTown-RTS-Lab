import assert from 'node:assert/strict';
import { BRIDGE_X as x, BRIDGE_Z as z, bridgePresence, stepBridgehead } from '../src/sim/bridgehead.ts';
import { HYTHE_BRIDGES } from '../src/sim/hytheMap.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { applyCommand, step } from '../src/sim/step.ts';
import { center, createWorld, hashWorld, TER_MUD, TER_ROAD, TICK_HZ, UK_OBSERVER } from '../src/sim/world.ts';
import { decodeWorld, encodeWorld } from '../src/sim/worldCodec.ts';

const rule = { t: 'bridgehead' }, map = { t: 'map', id: 5, sym: 1, vegetation: 1 };
const eco = { t: 'eco', inf: 1, end: 1, sw: 2, br: 1 };
function open(cmds = [map, eco, rule]) {
  const w = createWorld(73);
  step(w, cmds);
  return w;
}
const hold = 5 * TICK_HZ, pay = 10 * TICK_HZ;
assert(isCommand(rule));
assert.deepEqual([x, z], [42, 86]);
for (const id of [0, 1, 2, 3, 4]) assert.equal(open([{ ...map, id }, eco, rule]).bridgehead, undefined);
assert.equal(open([map, rule]).bridgehead, undefined);
const legacy = open([map, eco]);
step(legacy, [rule]);
while (legacy.tick < 250) step(legacy, []);
assert.equal(legacy.bridgehead, undefined);
assert.equal(hashWorld(legacy), 'ff09a897', 'map 5 without the opening command matches main 73ef735');

const w = open(), p = w.bridgehead;
const unit = side => w.units.find(u => u.kind === UK_OBSERVER && u.side === side);
const a = unit(0), b = unit(1);
function place(u, gx, gz) { u.x = center(gx); u.z = center(gz); }
const ticks = n => { for (let i = 0; i < n; i++) stepBridgehead(w); };
const startSupply = [...w.eco.supply];
for (const [bx, bz] of HYTHE_BRIDGES) {
  place(a, bx, bz);
  assert.equal(bridgePresence(w), Number(bx === x && bz === z), 'only West Hythe counts');
}
place(a, x + 4, z);
assert.equal(bridgePresence(w), 1);
a.x++;
assert.equal(bridgePresence(w), 0, 'outside the four-cell circle');
place(a, x, z);
for (const [key, value] of [['alive', false], ['ride', 3], ['towBy', 3]]) {
  const prev = a[key]; a[key] = value;
  assert.equal(bridgePresence(w), 0, key + ' excludes the unit');
  if (prev === undefined) delete a[key]; else a[key] = prev;
}
ticks(hold - 1);
assert.equal(p.owner, -1);
place(b, x + 1, z);
ticks(pay);
assert.equal(p.progress, hold - 1, 'contested progress freezes');
assert.deepEqual(w.eco.supply, startSupply);
place(b, x - 9, z);
ticks(1);
assert.equal(p.owner, 0);
assert.deepEqual(w.eco.supply, startSupply, 'no instant capture bonus');
ticks(pay - 1);
assert.deepEqual(w.eco.supply, startSupply);
place(b, x, z);
ticks(pay);
assert.deepEqual(w.eco.supply, startSupply, 'contested income freezes');
place(a, x + 9, z); place(b, x - 9, z);
ticks(pay);
assert.deepEqual(w.eco.supply, startSupply, 'empty point pays nothing');
place(a, x, z);
ticks(1);
assert.deepEqual(w.eco.supply, [startSupply[0] + 1, startSupply[1]]);

place(a, x + 9, z); place(b, x, z);
ticks(hold - 1);
place(b, x - 9, z); ticks(1);
assert.equal(p.progress, 0, 'leaving gives up an unfinished capture');
place(b, x, z); ticks(hold - 1);
const snapshot = JSON.parse(JSON.stringify(encodeWorld(w)));
const loaded = decodeWorld(structuredClone(snapshot));
assert(loaded && hashWorld(loaded) === hashWorld(w), 'in-progress save round trips');
for (let i = 0; i < 2 * pay; i++) { step(w, []); step(loaded, []); }
assert.equal(hashWorld(loaded), hashWorld(w), 'continuation from the save matches each timer and supply');
assert.equal(p.owner, 1, 'guest can take the bridge from host');
assert(w.eco.supply[1] > startSupply[1]);

// R1010 marks each deck cell as mud while broken and road when repaired.
const deck = z * w.n + x;
assert.equal(w.br.wet[deck], 1);
w.ter[deck] = TER_MUD;
place(b, x - 9, z); place(a, x, z);
const beforeBreak = [...w.eco.supply]; ticks(hold + pay);
assert.deepEqual([p.owner, p.progress, p.supplyTicks], [1, 0, 0], 'broken bridge suspends service');
assert.deepEqual(w.eco.supply, beforeBreak);
w.ter[deck] = TER_ROAD; ticks(hold);
assert.equal(p.owner, 0, 'host can win it back after repair');
assert.equal(w.winner, -1, 'bridge control does not end the battle');
const afterTake = structuredClone(p);
applyCommand(w, rule);
assert.deepEqual(p, afterTake, 'a repeated opening command cannot reset ownership');
for (const change of [{ owner: 2 }, { progress: -1 }, { claimant: -1 }, { supplyTicks: pay }]) {
  const bad = structuredClone(snapshot);
  Object.assign(bad.bridgehead, change);
  assert(decodeWorld(bad) === null, 'reject invalid bridgehead state ' + JSON.stringify(change));
}
console.log('OK West Hythe: both recaptures, state and income boundaries, broken/repaired deck, save and legacy replay');
