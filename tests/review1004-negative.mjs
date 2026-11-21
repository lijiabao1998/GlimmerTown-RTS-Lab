// R1004 在獨立副本故意弄壞每一處修補；每一處都要先紅在指定的那一句（只跑 tests/review1004.mjs 的那一群）。卡面驗收 8。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1004-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const T = 'src/sim/tech50.ts', S = 'src/ui/smoke.ts', U = 'src/ui/tech50.ts', A = 'src/ui/air93.ts', B = 'src/render/battle.ts', M = 'src/main.ts';
const cases = [
  ['no_repath', T, [['  repath50(w, b);\n', '']], 'repath', /^repath: kind 3 never stands inside the site/],
  ['repath_vehicles_only', T, [['    if (!u.alive || u.ride || u.pathIdx >= u.path.length) continue;\n    let crosses', '    if (!u.alive || u.ride || u.pathIdx >= u.path.length || !UNIT_KINDS[u.kind].radius) continue;\n    let crosses']], 'repath', /^repath: kind 3 never stands inside the site/],
  ['mud_open', T, [["    if (inner && w.ter[i] === TER_MUD) return '泥地不能蓋';", '']], 'mud', /^mud: a 2×2 with one mud cell is refused/],
  ['route_no_split', S, [['  const sappers = home && home.hp > 0 ? ids.filter(', '  const sappers = false && home && home.hp > 0 ? ids.filter(']], 'route', /^route: a tap on an enemy inside a pillbox sends the engineer/],
  ['route_own_open', S, [['return !!b && b.hp > 0 && b.builtBy === SIDE_PLAYER && TECH50[b.kind] !== undefined;', 'return false;']], 'route', /^route: a tap on our own site sends only the engineer/],
  ['valve_r091', M, [['(V.r1002 && V.r091 ? { ...c, sw: 2 }', '(V.r1002 ? { ...c, sw: 2 }']], 'route', /^route: sw 2 needs both R091 and R1002 on/],
  ['hud_pick', M, [["produce: kind => { if (pick50(kind)) hud?.update(); else issue(", "produce: kind => { if (!pick50(kind)) issue("]], 'route', /^route: a build key refreshes the HUD at once/],
  ['hud_refused', M, [['  if (!route) { hud?.update(); return; }', '  if (!route) return;']], 'route', /^route: a refused placement refreshes the HUD at once/],
  ['modes_build', U, [['  if (armed) air93Arm(0);', '']], 'modes', /^modes: picking a building to build disarms the air key/],
  ['modes_air', A, [['    if (armed) arm50(0);', '']], 'modes', /^modes: arming the air key cancels build mode/],
  ['stage_intact', B, [['this.lastStage[b.id] = stageOf(b);   // R1004', 'this.lastStage[b.id] = STAGE_INTACT;   // R1004']], 'render', /^render: a new site is recorded as roofless/],
  ['smoke_kept', B, [['    for (const em of this.emitters) if (em.id === b.id && (em.kind === E_FIRE || em.kind === E_SMOKE)) em.until = Math.min(em.until, t);   // R1004：蓋好（回到完好）也收火和煙\n    if (to !== STAGE_RUBBLE) return;\n', '    if (to !== STAGE_RUBBLE) return;\n    for (const em of this.emitters) if (em.id === b.id && (em.kind === E_FIRE || em.kind === E_SMOKE)) em.until = Math.min(em.until, t);\n']], 'render', /^render: finished again, the barracks no longer burns or smokes/],
  ['smoke_on_site', B, [['        if (stageOf(b) === STAGE_ROOFLESS && !site50(w, b)) {', '        if (stageOf(b) === STAGE_ROOFLESS) {']], 'render', /^render: a view rebuilt mid-construction adds no smoke to the site/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/review1004.mjs'), path.join(temp, 'tests/review1004.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/review1004.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 100000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED review1004/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`review1004: ${cases.length} negative controls OK`);
