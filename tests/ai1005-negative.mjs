// R1005 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/ai1005.mjs 的那一群）。卡面驗收 12。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1005-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const A = 'src/sim/ai.ts', A3 = 'src/sim/ai3.ts', A2 = 'src/sim/ai2.ts', F = 'src/sim/ai1005.ts';
const cases = [
  ['four_not_stored', A, [['...(v === 4 ? { v: 3, four: 1 } : {})', '...(v === 4 ? { v: 3 } : {})']], 'same', /^same: fixture — v 4 is stored as v 3 plus four/],
  ['production_unasked', A3, [['  if (st.four) { const k = first1005(w, st, mine, seen); if (k !== undefined) return k; }', '']], 'build', /^build: in at least 8 of 10 battles the barracks stands/],
  ['tactics_unhooked', A2, [['  if (st.four) act1005(w, st, mine, seen, override);', '']], 'demo', /^demo: the engineer goes to blow the enemy pillbox/],
  ['demo_any_distance', F, [['const pool = [...targets.values(), ...wires].filter(b => nearCore(bcx(b), bcz(b), NEAR_CORE));', 'const pool = [...targets.values(), ...wires];']], 'demo', /^demo: an enemy pillbox more than 9 cells from our tanks is left alone/],
  ['peek', F, [['  for (const t of seen) { const b = bldAt(w, cellOf(t.x), cellOf(t.z)); if (b && b.hp > 0) targets.set(b.id, b); }', '  for (const t of w.units.filter(u => u.alive && u.side === foe)) { const b = bldAt(w, cellOf(t.x), cellOf(t.z)); if (b && b.hp > 0) targets.set(b.id, b); }']], 'demo', /^demo: a house whose garrison we cannot see is left alone/],
  ['flame_peek', F, [['    const cand = seen.filter(t =>', '    const cand = w.units.filter(u => u.alive && u.side === foe && !u.ride).filter(t =>']], 'fog', /^fog: nothing is ordered because of enemies it cannot see/],
  ['spot_front', F, [['      if (d > bd) { best = [x, z]; bd = d; }', '      if (bd < 0 || d < bd) { best = [x, z]; bd = d; }']], 'plan', /^plan: the site goes behind the HQ/],
  ['build_early', F, [['  if (core < BUILD_CORE[st.level]) return -1;\n', '']], 'plan', /^plan: two tanks — too few to start building/],
  ['small_maps_build', F, [['w.n < BUILD_N || ', '']], 'plan', /^plan: on a map under 64 cells it does not build/],
  ['locks_ignored', F, [['  if (!e || w.zombies || locked50(w, side, k)) return false;', '  if (!e || w.zombies) return false;']], 'plan', /^plan: with tech and no barracks it never asks for a kind the barracks locks/],
  ['flame_on_sight', F, [['  if (allowed(w, side, UK_FLAME) && has(UK_FLAME) < 1 && hidden1005(w, mine, seen)) return', '  if (false && allowed(w, side, UK_FLAME) && has(UK_FLAME) < 1 && hidden1005(w, mine, seen)) return']], 'plan', /^plan: an enemy section seen hiding in a house near our tanks — build a flamethrower/],
  ['at_no_reach', F, [['dist(a.x, a.z, e2.x, e2.z) <= AT_REACH * SUB)', 'dist(a.x, a.z, e2.x, e2.z) <= 99 * SUB)']], 'teams', /^teams: 7 cells away it does not chase/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/ai1005.mjs'), path.join(temp, 'tests/ai1005.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/ai1005.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 100000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED ai1005/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`ai1005: ${cases.length} negative controls OK`);
