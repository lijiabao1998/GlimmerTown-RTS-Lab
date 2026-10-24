import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(root, 'shots', 'r130-negative-'));
const mutants = [
  ['size', 'src/sim/expandedMap.ts', 'TOWN_N = 96;', 'TOWN_N = 95;', 'generation', 'generation: actual 96x96 grid'],
  ['density', 'src/sim/expandedMap.ts', 'randInt(w, 100) < 92', 'randInt(w, 100) < 0', 'generation', 'generation: at least twice'],
  ['road', 'src/sim/expandedMap.ts', 'w.occ[at(cx, cz)] || t === TER_ROAD || t === TER_MUD', 'w.occ[at(cx, cz)] || t === TER_MUD', 'generation', 'generation: roads and river remain clear'],
  ['vegetation', 'src/sim/step.ts', ' || c.id === 3 ? c.vegetation', ' ? c.vegetation', 'lifecycle', 'lifecycle: map command preserves explicit vegetation'],
  ['pop', 'src/sim/eco.ts', 'w.map === MAP_LARGE || w.map === MAP_TOWN', 'w.map === MAP_LARGE', 'lifecycle', 'lifecycle: new town retains population 40'],
  ['late', 'src/sim/expandedMap.ts', 'w.tick !== 0 || w.map', 'false || w.map', 'lifecycle', 'lifecycle: map cannot reset a battle'],
  ['legacy', 'src/sim/eco.ts', 'w.map === MAP_LARGE || w.map === MAP_TOWN', 'true', 'legacy', 'legacy: map0 tick1 unchanged'],
  ['lod', 'src/render/buildings.ts', 'if (lod) distantBuilding', 'if (false) distantBuilding', 'geometry', 'geometry: real level-of-detail reduction'],
  ['read-only', 'src/render/buildings.ts', 'if (lod) distantBuilding', 'if (++w.rng && lod) distantBuilding', 'geometry', 'geometry: renderer does not mutate world or RNG'],
  ['budget', 'src/render/battle.ts', 'this.updateTownRegion(cssW, cssH);', '// region deliberately disabled', 'browser', 'budget: r130-phone-opening'],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(tmp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'tests')); fs.mkdirSync(path.join(tmp, 'tools'));
  for (const f of ['tests/expanded-town.mjs', 'tests/expanded-town-browser.mjs', 'tools/cdp.mjs', 'index.html', 'vite.config.ts', 'package.json']) fs.copyFileSync(path.join(root, f), path.join(tmp, f));
  for (const [name, file, from, to, group, expected] of mutants) {
    const target = path.join(tmp, file), source = fs.readFileSync(target, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique semantic mutation anchor`);
    fs.writeFileSync(target, source.replace(from, to));
    const args = group === 'browser' ? ['tests/expanded-town-browser.mjs', '--port=10031'] : ['tests/expanded-town.mjs', '--group=' + group];
    const r = spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8', timeout: 60000, maxBuffer: 2000000 });
    fs.writeFileSync(target, source);
    assert.notEqual(r.status, 0, `${name}: deliberately broken mechanism must fail`);
    const text = r.stdout + r.stderr;
    assert(text.includes(expected) && /AssertionError/.test(text) && !/SyntaxError|ReferenceError/.test(text), `${name}: first red is intended assertion\n${text.slice(-1800)}`);
    console.log(`OK expanded-town negative ${name}: ${expected}`);
  }
} finally {
  const resolved = path.resolve(tmp), parent = path.resolve(root, 'shots') + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r130-negative-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
