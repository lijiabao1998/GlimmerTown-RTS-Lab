// R1007 在獨立副本故意弄壞每一處接線；每一處都要先紅在指定的那一句（只跑 tests/sandbag1007.mjs 的那一群）。卡面驗收 20（第二支）。
// 這一支是旗標、雜湊、存檔、R050 的工地、介面路由與接線；掩護、放得下的條件、堆、高爆、爆破在 sandbag1007-negative.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1007-negative2-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const S = 'src/sim/sandbag1007.ts', W = 'src/sim/world.ts', E = 'src/sim/eco.ts', T = 'src/sim/tech50.ts', U = 'src/ui/tech50.ts', SM = 'src/ui/smoke.ts', M = 'src/main.ts';
const cases = [
  ['hash_left', W, [['.int(g.builtBy ?? -1).int(g.left); }', '.int(g.builtBy ?? -1); }']], 'flag', /^flag: the sandbag's left is folded into the hash/],
  ['hash_bag', W, [[' if (e.bag) f.int(0x4247).int(e.bag);', '']], 'flag', /^flag: bag is folded into the hash/],
  ['bag_without_tech', E, [['if (bag && w.eco.tech && !w.zombies) w.eco.bag = 1;', 'if (bag && !w.zombies) w.eco.bag = 1;']], 'flag', /^flag: bag is stored only as 1, only with tech/],
  ['bag_in_zombies', E, [['if (bag && w.eco.tech && !w.zombies) w.eco.bag = 1;', 'if (bag && w.eco.tech) w.eco.bag = 1;']], 'flag', /^flag: bag is stored only as 1, only with tech/],
  ['cmd_check', 'src/sim/commandCheck.ts', [["case 'eco': return optInt(c.bag) && ", "case 'eco': return "]], 'flag', /^flag: the command check refuses bag 1\.5/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!bag1007Ok(r)) return null;', '']], 'codec', /^codec: refused — bag 2/],
  ['codec_same_cell', S, [['    if (seen.has(c)) return false;\n', '']], 'codec', /^codec: refused — two in one cell/],
  ['codec_blds17', S, [['  if ((r.blds as Record<string, unknown>[]).some(b => b.kind === BK_SANDBAG)) return false;\n', '']], 'codec', /^codec: refused — a kind 17 building \(with bag\)/],
  ['why50_line', T, [["  if (w.bags?.segments.some(s => s.x >= x && s.x <= x + 1 && s.z >= z && s.z <= z + 1)) return '擋到了';", '']], 'r050', /^r050: a finished sandbag inside the 2×2 blocks a barracks/],
  ['main_valve', M, [['...(V.r050 && V.r1002 && V.r1007 ? { bag: 1 } : {})', '...(V.r050 && V.r1002 ? { bag: 1 } : {})']], 'ui', /^ui: a new battle sends bag only with R050, R1002 and R1007 on/],
  ['main_items', M, [['...(V.r050 && V.r1002 && V.r1007 ? bag1007Items() : [])', '...(V.r050 ? bag1007Items() : [])']], 'ui', /^ui: the sandbag item is there only with the three valves/],
  ['cdp_default', 'tools/cdp.mjs', [["noR1007=1`;   // R1007", "noR1007=0`;   // R1007"]], 'ui', /^ui: tools\/cdp\.mjs opens pages with noR1007=1/],
  ['smoke_line', SM, [['  const bag = bag1007Route(w, ids, x, z); if (bag) return bag;', '']], 'route', /^route: a tap on the enemy's sandbag sends the engineer to blow it/],
  ['is_item', U, [[' || kind === ITEM50 + BK_SANDBAG;', ';']], 'route', /^route: the 沙包 key arms the sandbag/],
  ['ui_why50', U, [['why = (armed === BK_SANDBAG ? why1007 : why50)(', 'why = (why50)(']], 'route', /^route: the hint says to pick an engineer/],
  ['ui_block', U, [['(kind === ITEM50 + BK_SANDBAG ? why1007 : why50)(w, SIDE_PLAYER, kind - ITEM50)', 'why50(w, SIDE_PLAYER, kind - ITEM50)']], 'ui', /^ui: the sandbag key is open/],
  ['ui_marker', U, [['x: x + (kind === BK_SANDBAG ? 0.5 : 1)', 'x: x + 1']], 'route', /^route: a tap with an engineer sends construct kind 17/],
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
console.log(`sandbag1007: ${cases.length} negative controls OK (second set)`);
