// R093 驗收 2：沒有 air 的局逐位不變。黃金雜湊，加上十二局「新開一局送的設定」（沒有 air）在 8dd903f（R093 之前）算好的雜湊。
// 單獨一支，免得 tests/air93.mjs 太慢。R093_PRINT=1 node tests/air93-pinned.mjs 在基線的副本上印出新的雜湊（只在基線上用）。
import assert from 'node:assert/strict';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
import { ECO } from '../tools/duel.mjs';

const FLAGOFF = JSON.parse('{"0/classic":"491f445f","0/real":"c896bf87","1/classic":"3c270a31","1/real":"b9f60e99","2/classic":"e954b20c","2/real":"e753dd73","3/classic":"62bac4a8","3/real":"0e2a3588","5/classic":"9a288d9e","5/real":"2361d16f","1/v1":"a9dd5870","1/v2":"21e3229f"}');   // 8dd903f
const NEW_GAME = { t: 'map', vegetation: 1, sym: 1, more: 1 }, NEW_ECO = { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, tp: 2 };
const game = (map, seed, rules, ais, ticks) => { const w = createWorld(seed); step(w, [{ ...NEW_GAME, id: map }, NEW_ECO, ...(rules ? [{ t: 'rules', ...rules }] : []), ...ais]); while (w.tick < ticks) step(w, []); return w; };
assert.equal(hashWorld(runScript()), 'eea1d59b', 'flagoff: the golden script battle is unchanged');
const now = {}, v3 = [{ t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 2, v: 3 }];
for (const map of [0, 1, 2, 3, 5]) for (const real of [false, true]) now[`${map}/${real ? 'real' : 'classic'}`] = hashWorld(game(map, 41 + map, real ? { ap: 1, morale: 2 } : null, v3, map === 5 ? 4000 : 3000));
now['1/v1'] = hashWorld(game(1, 42, null, [{ t: 'ai', side: 0, level: 3 }, { t: 'ai', side: 1, level: 2 }], 3000));
now['1/v2'] = hashWorld(game(1, 42, null, [{ t: 'ai', side: 0, level: 3, v: 2 }, { t: 'ai', side: 1, level: 2, v: 2 }], 3000));
if (process.env.R093_PRINT) { console.log(JSON.stringify(now)); process.exit(0); }
assert.deepEqual(now, FLAGOFF, 'flagoff: twelve new-game battles without air are bit for bit what they were at 8dd903f');
console.log('air93-pinned: golden and twelve battles without air unchanged');
