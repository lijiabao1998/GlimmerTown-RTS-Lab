// R1009 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/mines1009.mjs 的那一群）。卡面驗收 25。
// 第三支：介面（路由、三個模式互斥、閥、接線）、地面貼圖（只畫知道的、換世界重建、第一次只建表）。
// 「第一次 sync 就叫 paint」在真的 BattleView 裡是例外（地面貼圖還沒配置），那一處比的是 TypeError 那一行。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1009-negative3-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const UI = 'src/ui/mines1009.ts', T50 = 'src/ui/tech50.ts', RN = 'src/render/mines1009.ts';
const SYNC = '    const r = super.sync(w, changed), n = w.n, me = SIDE_PLAYER;', FIRST = '    if (this.first) { this.first = false; return r; }', WANT = '    const want = this.want, next = this.next, out = this.changed;';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['route_unhooked', 'src/ui/smoke.ts', [['  const m9 = route1009(w, selected, hit, fireMode, ammo); if (m9 !== undefined) return m9;', '  ']], 'route', /^route: armed, an engineer coming from the east taps a cell/],
  ['route_all', UI, [["return { commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: eng, x, z }]", "return { commands: [{ t: 'fireAt', side: SIDE_PLAYER, ids: [...selected], x, z }]"]], 'route', /^route: not armed, a tap on a known enemy mine sends only the engineer/],
  ['route_steals', UI, [['  if (t && t.side !== SIDE_PLAYER) return undefined;', '']], 'route', /^route: a tap on an enemy standing on a known mine is an attack as before/],
  ['pick_unhooked', T50, [["  if (pick1009(kind)) { armed = 0; flash = ''; return true; }", '']], 'ui', /^ui: the 反戰車雷 key is taken/],
  ['hint_unhooked', T50, [['  const m9 = hint1009(w); if (!armed) return m9;', '']], 'ui', /^ui: armed, the hint says how to lay it/],
  ['block_unhooked', T50, [['  const m9 = block1009(w, kind); if (m9 !== undefined) return m9;', '']], 'ui', /^ui: the mine keys say why1009/],
  ['arm50_keeps', T50, [["armed = kind; flash = ''; pick1009(0); }", "armed = kind; flash = ''; }"]], 'ui', /^ui: arming the air key drops the mines/],
  ['pick_keeps_air', UI, [['  if (armed) air93Arm(0);\n', '']], 'ui', /^ui: arming a mine drops the air key/],
  ['on_no091', UI, [['V.r1009 && V.r1002 && V.r091;', 'V.r1009 && V.r1002;']], 'ui', /^ui: the 地雷 group and mine are on only when/],
  ['valve_ignored', 'src/main.ts', [['...(on1009(V) ? { mine: 1 } : {}), ...(V.r021', '...(true ? { mine: 1 } : {}), ...(V.r021']], 'ui', /^ui: a new battle sends mine only through on1009/],
  ['cdp_default', 'tools/cdp.mjs', [["const full1009 = /(^|&)noR1009=/.test(full1011) ? full1011 :", "const full1009 = full1011; const unused1009 = /(^|&)noR1009=/.test(full1011) ? full1011 :"]], 'wiring', /^wiring: tools\/cdp\.mjs opens pages with noR1009=1/],
  ['raster_unknown', RN, [['      if (!known1009(w, me, m) || !inGrid(w, m.x, m.z)) continue;', '      if (!inGrid(w, m.x, m.z)) continue;']], 'raster', /^raster: our mines \(finished and being laid\) and the enemy mine we know of are drawn; the one we do not know of is not/],
  ['raster_stale_world', RN, [[SYNC, SYNC + ' if (changed) return r;']], 'raster', /^raster: a new world of the same size repaints every old cell/],
  ['view_stale_world', RN, [[SYNC, SYNC + ' if (changed) return r;']], 'view', /^raster: setWorld to the same map without mines leaves those cells exactly as without mines/],
  ['view_first_unbuilt', RN, [[WANT, FIRST + '\n' + WANT]], 'view', /^raster: the real BattleView built on a world with mines \(no step\) already shows them/],
  ['raster_first_paints', RN, [[FIRST, '    this.first = false;']], 'raster', /^raster: the first sync only builds the table/],
  ['view_first_paints', RN, [[FIRST, '    this.first = false;']], 'view', /Cannot (read|set) properties of undefined/],
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
    const first = r.stderr.match(/(?:AssertionError|TypeError)[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED mines1009/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`mines1009: ${cases.length} negative controls OK (part 3)`);
