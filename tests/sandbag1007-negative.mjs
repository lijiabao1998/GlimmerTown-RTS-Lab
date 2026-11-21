// R1007 在獨立副本故意弄壞每一條規則；每一處都要先紅在指定的那一句（只跑 tests/sandbag1007.mjs 的那一群）。卡面驗收 20。
// 分兩支（每支 CI 限 120 秒）：這一支是掩護、放得下的條件、重用、堆、高爆、爆破、不擋路；雜湊、旗標、存檔、R050、介面在 sandbag1007-negative2.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1007-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const S = 'src/sim/sandbag1007.ts', M = 'src/sim/morale.ts', W = 'src/sim/world.ts', ST = 'src/sim/step.ts', EN = 'src/sim/engineer1002.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['no_cover', S, [['  return s && s.hp > 0 && s.left === 0 ? Math.min(cover, BAG1007.cover) : cover;', '  return cover;']], 'cover', /^cover: kind \d+ .* in a finished sandbag/],
  ['stacked', S, [['Math.min(cover, BAG1007.cover)', 'Math.floor((cover * BAG1007.cover) / 100)']], 'cover', /^cover: kind \d+ .* in a finished sandbag/],
  ['site_covers', S, [['s && s.hp > 0 && s.left === 0 ?', 's && s.hp > 0 ?']], 'cover', /^cover: kind \d+ .* a site or a scattered sandbag gives no cover/],
  ['scattered_covers', S, [['s && s.hp > 0 && s.left === 0 ?', 's && s.hp >= 0 && s.left === 0 ?']], 'cover', /^cover: kind \d+ .* a site or a scattered sandbag gives no cover/],
  ['tank_covered', S, [['  if (k.armored || k.carry) return cover;', '  if (k.carry) return cover;']], 'cover', /^cover: kind \d+ .* armour, trucks and half-tracks get nothing/],
  ['truck_covered', S, [['  if (k.armored || k.carry) return cover;', '  if (k.armored) return cover;']], 'cover', /^cover: kind 44 .* armour, trucks and half-tracks get nothing/],
  ['ignores_ground', S, [['  if (!ground || !w.bags) return cover;', '  if (!w.bags) return cover;']], 'cover', /^cover: the flamethrower burns/],
  ['morale_line', M, [['  return cover1007(w, u, x, z, true, !home ? ground : Math.min(ground, home.kind === BK_PILLBOX ? 25 : 50));', '  return !home ? ground : Math.min(ground, home.kind === BK_PILLBOX ? 25 : 50);']], 'cover', /^cover: kind \d+ .* in a finished sandbag/],
  ['bag_blocks', W, [['  return onFoot(kind) && (wireAt(w, x, z)?.hp ?? 0) > 0;', '  return onFoot(kind) && (wireAt(w, x, z)?.hp ?? 0) > 0 || !!w.bags?.segments.some(s => s.x === x && s.z === z && s.hp > 0);']], 'pass', /^pass: /],
  ['no_land', ST, [['  if (w.bags) blast1007(w, s.ex, s.ez, R, k.dmgBld);', '  if (false) blast1007(w, s.ex, s.ez, R, k.dmgBld);']], 'blast', /^blast: a howitzer shell R \+ HALF from the centre takes 60/],
  ['radius_no_half', S, [['dist(center(s.x), center(s.z), ex, ez) > R + HALF)', 'dist(center(s.x), center(s.z), ex, ez) > R)']], 'blast', /^blast: a howitzer shell R \+ HALF from the centre takes 60/],
  ['free_bag', S, [['  w.eco!.supply[side] -= BAG1007.cost;', '']], 'place', /^place: 10 supply paid/],
  ['limit_plus_one', S, [['>= BAG1007.max) return', '> BAG1007.max) return']], 'place', /^place: eight standing \(sites count\)/],
  ['no_range', S, [["  if (!eng.some(u => Math.max(Math.abs(cellOf(u.x) - x), Math.abs(cellOf(u.z) - z)) <= RANGE1007)) return '離工兵太遠';\n", '']], 'place', /^place: 8 cells from the engineer/],
  ['range_minus_one', S, [["<= RANGE1007)) return '離工兵太遠'", "< RANGE1007)) return '離工兵太遠'"]], 'place', /^place: 7 cells \(diagonally too\) is in reach/],
  ['hedge_ok', S, [["  if (vegetationAt(w, x, z)) return '樹籬、樹林裡已經有掩護';\n", '']], 'place', /^place: a hedge/],
  ['clear_veg', S, [["import { vegetationAt } from './vegetation.ts';", "import { vegetationAt, clearVegetation } from './vegetation.ts';"], ['  w.eco!.supply[side] -= BAG1007.cost;', '  w.eco!.supply[side] -= BAG1007.cost; clearVegetation(w, x - 1, z - 1, 3, 3);']], 'place', /^place: the vegetation table is unchanged/],
  ['mud_ok', S, [["  if (w.ter[i] === TER_MUD) return '不能堆在泥灘上';\n", '']], 'place', /^place: the canal's mud/],
  ['trench_ok', S, [[' || trenchAt(w, x, z)', '']], 'place', /^place: a trench/],
  ['any_side_builders', S, [['  const eng = builders50(w, side, at.ids);', '  const eng = builders50(w, side, at.ids).concat(builders50(w, 1 - side, at.ids));']], 'place', /^place: the enemy's engineer/],
  ['bags_first', S, [["  if (why1007(w, side, kind, { x, z, ids }) !== '') return true;\n  const list = (w.bags ??= { version: 1, segments: [] }).segments;\n", "  const list = (w.bags ??= { version: 1, segments: [] }).segments;\n  if (why1007(w, side, kind, { x, z, ids }) !== '') return true;\n"]], 'place', /^place: no bag \(an R050 game\) — refused, nothing changes/],
  ['always_new', S, [['  let s = bagAt1007(w, x, z) ?? list.find(b => b.hp <= 0) ?? null;', '  let s = null;']], 'reuse', /^reuse: the scattered sandbag on the same cell is reused/],
  ['morale_no_slow', S, [['  if (w.rules?.morale && !reloads(w, u)) return;\n', '']], 'build', /^build: shaken, it builds every other step/],
  ['wire_false', EN, [['return { b: s, wire: true, bag: 1 };', 'return { b: s, wire: false, bag: 1 };']], 'demo', /^demo: an enemy engineer walks up and scatters our sandbag with one charge/],
  ['own_built_blown', EN, [['  if (t.bag && t.b.builtBy === u.side && (t.b as Bag1007).left === 0) return;', '']], 'demo', /^demo: our engineer told to fire at our finished sandbag takes no order/],
  ['enemy_helps', EN, [['  if (t.bag && t.b.builtBy === u.side) { build1007(', '  if (t.bag) { build1007(']], 'demo', /^demo: an enemy engineer walks up and scatters our sandbag/],
  // 審查（第 2 條）：堆的時候不撐住炸藥倒數——換了主人的那一筆一放下就被炸
  ['no_flip_countdown', S, [['  if (u.cooldown < (UNIT_KINDS[u.kind].demo ?? 0)) u.cooldown = UNIT_KINDS[u.kind].demo ?? 0;', '']], 'demo', /^demo: after an owner flip \(charge\) our engineer counts a full charge down/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/sandbag1007.mjs'), path.join(temp, 'tests/sandbag1007.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/sandbag1007.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED sandbag1007/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`sandbag1007: ${cases.length} negative controls OK`);
