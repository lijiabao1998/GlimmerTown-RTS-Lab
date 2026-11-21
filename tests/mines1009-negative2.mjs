// R1009 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/mines1009.mjs 的那一群）。卡面驗收 25。
// 第二支：士氣、戳到、看到就停、工兵不走進知道的雷、炸了帶出旁邊的、排雷、存檔（第一支 mines1009-negative.mjs 是旗標、放得下、布、觸雷）；
// 介面、地面貼圖在 mines1009-negative3.mjs（每支 CI 限 120 秒）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1009-negative2-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const S = 'src/sim/mines1009.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['morale', S, [['    if (w.rules?.morale) suppressBlast(w, x, z, SUB, spec.foot);\n', '']], 'morale', /^morale: with morale on the blast suppresses both sides/],
  ['probe2', S, [['<= PROBE1009) { reveal1009(w, m); break; }', '<= PROBE1009 + 1) { reveal1009(w, m); break; }']], 'reveal', /^reveal: an enemy engineer one cell away finds it/],
  ['probe_any', S, [['    if (UNIT_KINDS[u.kind].demo) ENG.push(u);', '    ENG.push(u);']], 'reveal', /^reveal: an enemy engineer one cell away finds it/],
  ['no_stop', S, [['    for (let i = u.pathIdx; i < u.path.length; i++) if (u.path[i] === c) { halt(u); break; }\n', '']], 'reveal', /^reveal: the enemy tank whose path crosses the cell stops/],
  ['walk_in', S, [['    if (!touches(w, u.side, cellOf(u.x), cellOf(u.z), x, z)) continue;', '    continue;']], 'reveal', /^reveal: sent from the west end to clear the middle of a known band, the engineer never steps on the first cell/],
  ['no_boomreveal', S, [['    for (const o of list) if (o.side === m.side && !o.seen && cheb(o.x, o.z, m.x, m.z) <= 1) reveal1009(w, o);', '']], 'boomreveal', /^boomreveal: the cells of that side one away become known/],
  ['leak_clear', S, [['  if (!foe || !known1009(w, u.side, foe)) return false;', '  if (!foe) return false;']], 'clear', /^clear: an order on an enemy mine we do not know of is exactly an order on open ground/],
  ['clear_afar', S, [['  if (moving || !near) { if (u.cooldown < need) u.cooldown = need; return true; }', '  if (false) { return true; }']], 'clear', /^clear: beside it, an anti-tank cell is gone on the 160th step/],
  ['no_hold', S, [['send(w, u, gx, gz); u.cooldown = Math.max(u.cooldown, MINES1009[foe.kind].clear);', 'send(w, u, gx, gz);']], 'clear', /^clear: already beside it, it still counts all 160/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!mineOk(r)) return null;', '  ']], 'codec', /^codec: refused — eco\.mine 2/],
  ['codec_seen2', S, [['(seen !== 0 && seen !== 1)) return false;', '(seen !== 0 && seen !== 1 && seen !== 2)) return false;']], 'codec', /^codec: refused — seen 2/],
  ['codec_twice', S, [['    if (taken.has(key)) return false;\n', '']], 'codec', /^codec: refused — the same side twice on one cell/],
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
console.log(`mines1009: ${cases.length} negative controls OK (part 2)`);
