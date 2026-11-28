// Survey the existing solo opponent with the new rule enabled. Never issue a move for the AI.
// --survey runs seeds 1–8 on both difficulties to HQ victory or 24,000 ticks.
import assert from 'node:assert/strict';
import { BRIDGE_X, BRIDGE_Z, bridgePresence } from '../src/sim/bridgehead.ts';
import { BUILD_KINDS_24, enemyPlan } from '../src/sim/build.ts';
import { applyMap, applyMoreHouses, MAP_HYTHE } from '../src/sim/maps.ts';
import { step } from '../src/sim/step.ts';
import { createWorld, UK_LIGHT, UK_OBSERVER } from '../src/sim/world.ts';
import { ECO } from '../tools/duel.mjs';

const survey = process.argv.includes('--survey');
const rounds = survey ? 8 : 1, limit = survey ? 24000 : 4000;
for (const level of [2, 3]) {
  const counts = { arrived: 0, captured: 0, enemyEntered: 0, contested: 0, retaken: 0, firstOwnerLost: 0, finished: 0 };
  for (let seed = 1; seed <= rounds; seed++) {
    const preview = createWorld(seed);
    applyMap(preview, MAP_HYTHE, 1);
    applyMoreHouses(preview);
    const w = createWorld(seed);
    step(w, [
      { t: 'map', id: MAP_HYTHE, sym: 1, vegetation: 1, more: 1 }, ...enemyPlan(preview, BUILD_KINDS_24),
      { ...ECO, mg: 2, sw: 2, tp: 2, pla: 1, air: 1, tech: 1, end: 1, br: 1, bag: 1, mine: 1, hq11: 1 },
      { t: 'bridgehead' }, { t: 'ai', side: 1, level, v: 4 },
    ]);
    assert(w.bridgehead && w.ai?.length === 1 && w.ai[0].side === 1 && w.ai[0].level === level);
    const scouts = w.units.filter(u => u.side === 0 && u.kind === UK_OBSERVER);
    const light = w.units.find(u => u.side === 0 && u.kind === UK_LIGHT);
    // A small detachment stays on the bridge. The rest of the player's starting force defends its HQ.
    step(w, [{ t: 'move', side: 0, ids: [light.id, ...scouts.map(u => u.id)], x: BRIDGE_X, z: BRIDGE_Z }]);
    let firstOwner = -1;
    const facts = {};
    while (w.winner < 0 && w.tick < limit) {
      step(w, []);
      const presence = bridgePresence(w);
      if (presence & 1) facts.arrived = true;
      if (presence & 2) facts.enemyEntered = true;
      if (presence === 3) facts.contested = true;
      if (w.bridgehead.owner === 0) facts.captured = true;
      if (firstOwner === -1) firstOwner = w.bridgehead.owner;
      if (firstOwner === 0 && w.bridgehead.owner === 1) facts.retaken = true;
    }
    facts.finished = w.winner >= 0;
    facts.firstOwnerLost = firstOwner >= 0 && w.winner === 1 - firstOwner;
    for (const name of Object.keys(counts)) if (facts[name]) counts[name]++;
    if (survey) console.log(JSON.stringify({ level, seed, tick: w.tick, winner: w.winner, firstOwner, ...facts }));
  }
  assert(counts.arrived > 0, 'the player must reach the objective for the observation to be meaningful');
  console.log(JSON.stringify({ level, rounds, limit, ...counts }));
}
