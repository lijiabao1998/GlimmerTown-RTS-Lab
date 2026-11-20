// R1002 在獨立副本故意弄壞每一處（第二支：火焰噴射器、存檔、介面；旗標、爆破、鐵絲網在 engineer1002-negative.mjs）。卡面驗收 21。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1002-negative2-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', EN = 'src/sim/engineer1002.ts', S91 = 'src/sim/support91.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  // 2.4 火焰噴射器
  ['flame_pick', EN, [['    if (blk >= 0 && !burns1002(w, blk, t)) continue;', '    if (blk >= 0) continue;']], 'flameaim', /^flameaim: the flamethrower picks the section hiding in the house/],
  ['burns_any_wall', EN, [['  return !!t && id > 0 && bldAt(w, cellOf(t.x), cellOf(t.z))?.id === id;', '  return !!t && id > 0;']], 'flameaim', /^flameaim: with another house in front, neither can pick it/],
  ['flame_wall', ST, [['    if (blockCell >= 0 && !(k.flame && burns1002(w, blockCell, aim.unit))) {', '    if (blockCell >= 0) {']], 'flameaim', /^flameaim: the flame goes in/],
  ['flame_cover', ST, [['damageUnit(w, t, pierced(k, t, k.dmgUnit), false, true);', 'damageUnit(w, t, pierced(k, t, k.dmgUnit));']], 'flamecover', /^flamecover: one burst takes 24 wherever the man is/],
  ['burn_keeps_house', ST, [['  const home = !burn && UNIT_KINDS[u.kind].garrison', '  const home = UNIT_KINDS[u.kind].garrison']], 'flamecover', /^flamecover: one burst takes 24 wherever the man is/],
  ['house_order', ST, [['  if (k.flame && u.order === ORD_FIRE_AT) { const t = burnIn1002(w, u); if (t) return { x: t.x, z: t.z, unit: t, bld: null }; }', '']], 'flamehouse', /^flamehouse: the order burns the lowest id inside and in range/],
  ['burn_range', EN, [['&& dist(u.x, u.z, t.x, t.z) <= k.range) return t;', ') return t;']], 'flamehouse', /^flamehouse: the order burns the lowest id inside and in range/],
  ['flame_tank', EN, [['    if (tk.armored && !tk.openTop) continue;', '']], 'flamearmor', /^flamearmor: idle, it leaves a closed tank alone/],
  ['no_hold', W, [['hold: true, flame: true });', 'flame: true });']], 'discipline', /^discipline: the flamethrower holds fire on order/],
  // 存檔
  ['codec_sw2', S91, [['  if (e?.sw === 2) return true;', '  if (e?.sw === 2) return false;']], 'codec', /^codec: a world with sw 2/],
  ['codec_sw1_47', S91, [[' || k === UK_ENGINEER || k === UK_FLAME;   // R1002', ';   // R1002']], 'codecref', /^codec: sw 1 with kind 47\/48 units is refused/],
  ['codec_sw3', S91, [['e.sw !== 1 && e.sw !== 2) return false;', 'e.sw !== 1 && e.sw !== 2 && e.sw !== 3) return false;'], ['  if (e?.sw === 2) return true;', '  if ((e?.sw as number) >= 2) return true;']], 'codecref', /^codec: sw 3 is refused/],
  // 介面、畫面、閥
  ['route_wire', 'src/ui/smoke.ts', [['  const cut = (wireAt(w, x, z)?.hp ?? 0) > 0 ?', '  const cut = false ?']], 'route', /^route: a tap on wire sends the engineers to cut it/],
  ['valve_ignored', 'src/main.ts', [['(V.r1002 ? { ...c, sw: 2 } as Command : c)', '({ ...c, sw: 2 } as Command)']], 'ui', /^ui: a new battle sends sw 2 only when the R1002 valve is on/],
  ['report_col', 'src/ui/report.ts', [[' || (k === UK_INFANTRY && (kind === UK_ENGINEER || kind === UK_FLAME))', '']], 'ui', /^ui: both kinds count in the infantry column/],
  ['crowd_missing', 'src/render/section89.ts', [['CROWD89[UK_ENGINEER] = { men: 4, lay: ENG1002 }; CROWD89[UK_FLAME] = { men: 2, lay: TEAM91 };\n', '']], 'ui', /^ui: with R089 on the engineer is a four-man crowd/],
  ['cdp_default', 'tools/cdp.mjs', [['const full1002 = /(^|&)noR1002=/.test(full93) ? full93 :', 'const full1002 = full93; const unused1002 = /(^|&)noR1002=/.test(full93) ? full93 :']], 'ui', /^ui: tools\/cdp\.mjs opens pages with noR1002=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/engineer1002.mjs'), path.join(temp, 'tests/engineer1002.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/engineer1002.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED engineer1002/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r1002-negative2-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`engineer1002: ${cases.length} negative controls OK (part 2)`);
