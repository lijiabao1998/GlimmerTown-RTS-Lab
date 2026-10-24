// R045 在獨立副本故意破壞機制；每個負控必須先紅在指定語意斷言。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r045-negative-'));
const cases = [
  ['late', 'src/sim/zombies.ts', 'w.tick !== 0 || w.zombies', 'w.zombies', 'activation', 'activation: late first command is inert'],
  ['cap', 'src/sim/zombies.ts', 'ZOMBIE_CAP = 48', 'ZOMBIE_CAP = 47', 'waves', 'waves: simultaneous cap is 48'],
  ['clock', 'src/sim/zombies.ts', 'ZOMBIE_PERIOD = 900', 'ZOMBIE_PERIOD = 899', 'waves', 'waves: no first wave before tick 900'],
  ['garrison', 'src/sim/zombies.ts', 'if (home && home.hp > 0)', 'if (false && home && home.hp > 0)', 'combat', 'combat: cannot bite garrison through intact wall'],
  ['center', 'src/sim/zombies.ts', 'if (!u.path.length && (u.x !==', 'if (false && !u.path.length && (u.x !==', 'combat', 'combat: finishes last cell center to reach headquarters'],
  ['inside', 'src/sim/zombies.ts', '  path.length = k;', '  void k;', 'combat', 'combat: approach path stops outside the building'],
  ['corner', 'src/sim/zombies.ts', 'w.occ[b] !== into) path.push(a);', 'w.occ[b] !== into) void a;', 'combat', 'combat: diagonal corner steps beside the wall and bites'],
  ['construction', 'src/sim/step.ts', "if (w.zombies) cmds = cmds.filter", "if (false && w.zombies) cmds = cmds.filter", 'activation', 'activation: enemy construction is rejected'],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/zombies.mjs'), path.join(temp, 'tests/zombies.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const [name, file, from, to, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    assert.equal(original.split(from).length - 1, 1, `unique ${name} semantic anchor`);
    fs.writeFileSync(target, original.replace(from, to));
    const r = spawnSync(process.execPath, ['tests/zombies.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.equal(first, message, `${name}: first red must be intended assertion; ${r.stderr}`);
    console.log(`RED zombies/${name}: ${first}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r045-negative-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`zombies: ${cases.length} semantic negative controls OK`);
