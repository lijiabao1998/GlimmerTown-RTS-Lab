// R050 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/tech50.mjs 的那一群）。卡面驗收 17。
// 分兩支（每支 CI 限 120 秒）：這一支是旗標、放得下的條件、上限、蓋；科技、補給站、存檔、介面在 tech50-negative2.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r050-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', T = 'src/sim/tech50.ts', EN = 'src/sim/engineer1002.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['flag_unstored', E, [['  if (tech && w.eco.sw === 2) w.eco.tech = 1;', '']], 'flag', /^flag: tech is stored only with sw 2 and only as 1/],
  ['flag_nosw', E, [['  if (tech && w.eco.sw === 2) w.eco.tech = 1;', '  if (tech) w.eco.tech = 1;']], 'flag', /^flag: tech is stored only with sw 2 and only as 1/],
  ['hash_tech', W, [[' if (e.tech) f.int(0x5445).int(e.tech);', '']], 'flag', /^flag: tech is folded into the hash/],
  ['cmd_check', 'src/sim/commandCheck.ts', [["    case 'construct': return side(c.side) && ids(c.ids) && int(c.kind) && int(c.x) && int(c.z);   // R050\n", '']], 'flag', /^flag: the command check takes a construct command/],
  ['zombie_open', T, [["if (!w.eco?.tech || w.zombies ||", "if (!w.eco?.tech ||"]], 'flag', /^flag: zombie defence does not offer building/],
  ['dead_hq', T, [['return b && b.hp > 0 ? b : null; };', 'return b ? b : null; };']], 'place', /^place: not without a standing HQ/],
  ['no_supply_check', T, [['if (w.eco.supply[side] < spec.cost)', 'if (w.eco.supply[side] < 0)']], 'place', /^place: supply is checked/],
  ['any_unit_builds', T, [['!u.rout && !!UNIT_KINDS[u.kind].demo)', '!u.rout)']], 'place', /^place: needs one of our own engineers on foot/],
  ['rider_builds', T, [['u.side === side && !u.ride && !u.rout', 'u.side === side && !u.rout']], 'place', /^place: needs one of our own engineers on foot/],
  ['range_plus_one', T, [['if (gap > RANGE50)', 'if (gap > RANGE50 + 1)']], 'place', /^place: 8 cells from the HQ is the limit/],
  ['road_ok', T, [[' || w.ter[i] === TER_ROAD', '']], 'place', /^place: a road on the footprint blocks it/],
  ['unit_ok', T, [[' || w.units.some(u => u.alive && !u.ride && !u.towBy && cellOf(u.x) === cx && cellOf(u.z) === cz)', '']], 'place', /^place: a soldier on the footprint blocks it/],
  ['ring_ok', T, [["    if (!inner && (w.occ[i] || wireAt(w, cx, cz))) return '要跟建築隔一格';", '']], 'place', /^place: a house in the ring around it blocks it/],
  ['free_site', T, [['  w.eco!.supply[side] -= spec.cost;', '']], 'place', /^place: 40 supply paid/],
  ['limit_plus_one', T, [['.length >= spec.max) return', '.length > spec.max) return']], 'limit', /^limit: one barracks \(the site counts\)/],
  ['rubble_counts', T, [['b.builtBy === side && b.hp > 0).length >= spec.max', 'b.builtBy === side).length >= spec.max']], 'limit', /^limit: rubble does not count/],
  ['double_rate', T, [['  s.left--;', '  s.left -= 2;']], 'build', /^build: one engineer beside it builds a barracks in 400 steps/],
  ['hp_overwritten', T, [['b.hp = Math.min(b.maxHp, b.hp + Math.floor(((b.maxHp - 1) * (done + 1)) / need) - Math.floor(((b.maxHp - 1) * done) / need));', 'b.hp = Math.min(b.maxHp, 1 + Math.floor(((b.maxHp - 1) * (done + 1)) / need));']], 'build', /^build: damage taken while building stays taken/],
  ['builds_from_afar', T, [['  if (!s || u.pathIdx < u.path.length || !near1002(u, b)) return;', '  if (!s) return;']], 'build', /^build: an engineer 5 cells off walks over and builds the depot/],
  ['own_site_blown', EN, [['  if (!t.wire && t.b.builtBy === u.side && site50(w, t.b)) { build50(w, u, t.b); return; }', '']], 'build', /^build: one engineer beside it builds a barracks in 400 steps/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/tech50.mjs'), path.join(temp, 'tests/tech50.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/tech50.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED tech50/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`tech50: ${cases.length} negative controls OK`);
