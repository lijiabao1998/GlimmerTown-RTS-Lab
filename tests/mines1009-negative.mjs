// R1009 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/mines1009.mjs 的那一群）。卡面驗收 25。
// 分兩支（每支 CI 限 120 秒）：這一支是旗標、雜湊、指令檢查、放得下的條件、布、布好時曝光、觸雷、掩護；戳到、排雷、存檔、介面、畫面在 mines1009-negative2.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1009-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const S = 'src/sim/mines1009.ts', E = 'src/sim/eco.ts', WD = 'src/sim/world.ts', CC = 'src/sim/commandCheck.ts', ST = 'src/sim/step.ts';
const LAID = "    if (spotted(w, 1 - m.side, center(m.x), center(m.z))) reveal1009(w, m);   // 在敵人眼前布雷，敵人就知道\n";
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['flag_nosw', E, [['if (mine && w.eco.sw === 2 && !w.zombies) w.eco.mine = 1;', 'if (mine && !w.zombies) w.eco.mine = 1;']], 'flag', /^flag: mine is stored only with sw 2/],
  ['flag_zombies', E, [['if (mine && w.eco.sw === 2 && !w.zombies) w.eco.mine = 1;', 'if (mine && w.eco.sw === 2) w.eco.mine = 1;']], 'flag', /^flag: mine is stored only with sw 2, only as 1, never in zombie defence/],
  ['hash_mine', WD, [['  if (w.eco?.mine) f.int(0x4d49).int(w.eco.mine); ', '  ']], 'flag', /^flag: mine is folded into the hash/],
  ['hash_seen', WD, [['.int(m.left).int(m.seen); }', '.int(m.left); }']], 'flag', /^flag: the hash tells a mine the enemy knows of from one it does not/],
  ['cmd_check', CC, [["    case 'mine': return side(c.side) && ids(c.ids) && int(c.kind) && int(c.x) && int(c.z) && optInt(c.rot) && optInt(c.len);   // R1009\n", '']], 'flag', /^flag: the command check takes a mine command/],
  ['cmd_check_versus', CC, [["    case 'mine': return side(c.side) && ids(c.ids) && int(c.kind) && int(c.x) && int(c.z) && optInt(c.rot) && optInt(c.len);   // R1009\n", '']], 'forged', /^forged: in versus, player 0 keeps its own mine order/],
  ['step0', S, [[' || w.tick === 0 || ', ' || ']], 'place', /^place: step 0 \(deployment\) → 本局未開放/],
  ['any_side', S, [["if (!builders50(w, side, Array.isArray(at.ids) ? at.ids : []).length) return '先選工兵';", "if (!(Array.isArray(at.ids) ? at.ids : []).length) return '先選工兵';"]], 'place', /^place: ids \[\d+\] → 先選工兵/],
  ['no_limit', S, [[' + n > MAX1009) return', ' + n > MAX1009 + 100) return']], 'place', /^place: 24 cells/],
  ['hq_gap', S, [[') <= HQ_GAP1009)) return', ') < 0)) return']], 'place', /^place: more than 5 cells from the enemy HQ footprint/],
  ['mud', S, [["  if (cells.some(([x, z]) => w.ter[cellIdx(w, x, z)] === TER_MUD)) return '不能布在水裡';\n", '']], 'place', /^place: one cell of the band is mud/],
  ['bld_cell', S, [['if (w.occ[cellIdx(w, x, z)] || wireAt(w, x, z) ||', 'if (wireAt(w, x, z) ||']], 'place', /^place: a house on the middle cell/],
  ['free', S, [['  w.eco!.supply[c.side] -= spec.cost * len;\n', '']], 'place', /^place: a band of three anti-tank cells costs 45/],
  ['lay_afar', S, [['    if (moving || !near) return true;\n    m.left--;', '    m.left--;']], 'lay', /^lay: nothing is laid while the engineer walks up/],
  ['lay_two', S, [['    m.left--;\n', '    m.left -= 2;\n']], 'lay', /^lay: one engineer beside the cell lays an anti-tank mine in 120 steps/],
  ['no_next', S, [[LAID + '    next1009(w, u, m);', LAID + '    halt(u);']], 'lay', /^lay: one engineer lays a band of three in order/],
  ['second_idles', S, [['  if (m.side === u.side && m.left === 0) { next1009(w, u, m); return true; }', '  if (m.side === u.side && m.left === 0) { halt(u); return true; }']], 'lay', /^lay: with two engineers both work on the last cell/],
  ['no_spotted', S, [[LAID, '']], 'armseen', /^armseen: laid in plain view of the enemy, the enemy knows the cell/],
  ['spotted_no_stop', S, [['center(m.z))) reveal1009(w, m);', 'center(m.z))) m.seen = 1;']], 'armseen', /^armseen: and the enemy truck whose path crosses it stops/],
  ['no_step', ST, [['  if (w.mines) mines1009Step(w, (u, d) => damageUnit(w, u, d, false));', '  ']], 'trigat', /^trigat: an enemy tank sets it off/],
  ['no_halt', S, [['    if (by.alive) halt(by);\n', '']], 'trigat', /^trigat: 60 off the tank, the tank stops/],
  ['foot_at', S, [['(m.kind !== 1 || UNIT_KINDS[u.kind].radius > 0)', 'true']], 'trigat', /^trigat: an enemy section walks over it/],
  ['own_trigger', S, [['u.alive && !u.ride && !u.towBy && u.side !== m.side && cellOf(u.x) === m.x', 'u.alive && !u.ride && !u.towBy && cellOf(u.x) === m.x']], 'trigat', /^trigat: our own tank drives over our own mine/],
  ['unfinished', S, [['const by = m.left === 0 ? w.units.find(', 'const by = m.left >= 0 ? w.units.find(']], 'trigat', /^trigat: a mine still being laid does not go off/],
  ['cover', ST, [['mines1009Step(w, (u, d) => damageUnit(w, u, d, false));', 'mines1009Step(w, (u, d) => damageUnit(w, u, d, true));']], 'cover', /^cover: in the open, a wood or a crater the mine takes 30/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/mines1009.mjs'), path.join(temp, 'tests/mines1009.mjs'));
  fs.copyFileSync(path.join(root, 'README.md'), path.join(temp, 'README.md'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/mines1009.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED mines1009/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`mines1009: ${cases.length} negative controls OK`);
