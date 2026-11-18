// R090 在獨立副本故意弄壞海斯（地圖 5）的每一處；每個都要先紅在指定的那一句（只跑那一支、那一群）。卡面驗收 12。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r090-negative-'));
const HM = 'src/sim/hytheMap.ts', PR = 'src/sim/pathRule90.ts', PA = 'src/sim/path.ts', MAIN = 'src/main.ts';
// [名字, 檔案, [[原文, 改成], …], 守衛, 群, 第一個紅的斷言]
const cases = [
  // 尋路
  ['rule_everywhere', PR, [['export const rule90 = (w: World): boolean => w.map === MAP_HYTHE;', 'export const rule90 = (w: World): boolean => !!w;']], 'path-scratch', 'hythe', /^path: query \d+ \(.+\) identical to the 74fa704 A\*/],
  ['weights_everywhere', PA, [['ha = m5 ? HA90 : 10, hd = m5 ? HD90 : -6', 'ha = HA90, hd = HD90']], 'path-scratch', 'hythe', /^path: query \d+ \(.+\) identical to the 74fa704 A\*/],
  ['snap_open_goal', PA, [['if (m5 && blocked(gx, gz)) { const s = snap90(', 'if (m5) { const s = snap90(']], 'hythe-map', 'route', /^route: seed \d+ an open goal is never moved/],
  ['snap_ignores_wire', PA, [['const s = snap90(w, blocked, sx, sz, gx, gz);', 'const s = snap90(w, (x, z) => blocks(w, x, z), sx, sz, gx, gz);']], 'hythe-map', 'mirror', /^mirror: an infantry order onto wire at \d+,\d+ ends on the cell its own blocking rule snaps to$/],
  ['snap_tie_plain', PR, [['const ord = (i: number) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i);', 'const ord = (i: number) => i;']], 'hythe-map', 'mirror', /^mirror: a hand-made snap tie/],
  ['hb_old', PR, [['export const hb90 = (n: number): number => 18 * n + 1;', 'export const hb90 = (n: number): number => 14 * n + 1;']], 'hythe-map', 'white', /^white: HB \d+ exceeds the largest map-5 heuristic/],
  // 地圖
  ['old_step_line', 'src/sim/step.ts', [["  for (const c of cmds) if (c.t === 'map') { if (c.id === MAP_HYTHE) applyMap(w, MAP_HYTHE, c.vegetation); break; }", '  // removed']], 'hythe-map', 'gen', /^gen: seed 0 vegetation grows and stays ≤ 64 \(0\)$/],
  ['later_tick', HM, [['  if (w.tick !== 0 || w.map || w.sandbox', '  if (w.map || w.sandbox']], 'hythe-map', 'first', /^first: a fresh world past tick 0 is refused/],
  ['building_on_road', HM, [['      if (w.occ[at(cx, cz)] || t === TER_ROAD || t === TER_MUD) return false;', '      if (w.occ[at(cx, cz)] || t === TER_MUD) return false;']], 'hythe-map', 'gen', /^gen: seed 0 building \d+ \(kind \d+\) is not on a road/],
  ['bridge_missing', HM, [['[[0, 20], [1, 86], [0, 64], [1, 40], [0, 106]]', '[[0, 20], [1, 86], [0, 64], [1, 40]]']], 'hythe-map', 'gen', /^gen: seed 0 the canal is crossed by exactly 5 bridges \(4\)$/],
  ['pillbox_skipped', HM, [['    if (!isHytheRoad(x, z) && !isCanal(x, z) && !coast(x, z) && x + z > bx + bz) return [x, z] as const;', '    if (!isHytheRoad(x, z) && !isCanal(x, z) && !coast(x, z) && x + z > bx + bz) return [bx, bz] as const;']], 'hythe-map', 'gen', /^gen: seed 0 landmark kind 6 1×1 at \d+,\d+ is placed$/],
  ['vegetation_65', HM, [['      if (!inGrid(w, x, z) || inHytheSpawn(x, z) || count >= VEGETATION_MAX) return;', '      if (!inGrid(w, x, z) || inHytheSpawn(x, z) || count >= 1000) return;'], ['    for (let k = 0; k < 6; k++) {   // 丘陵上的樹林', '    for (let k = 0; k < 90; k++) {   // 丘陵上的樹林']], 'hythe-map', 'gen', /^gen: seed 0 vegetation grows and stays ≤ 64 \(\d+\)$/],
  ['force_offset', HM, [['side === SIDE_PLAYER ? px + n - 64 : 63 - px', 'side === SIDE_PLAYER ? px + 32 : 63 - px']], 'hythe-map', 'start', /^start: force 0 unit \d+ \(side 0\) starts in its own corner/],
  ['zombies_allowed', 'src/sim/zombies.ts', [['  if (w.map === MAP_HYTHE) return;', '']], 'hythe-map', 'start', /^start: map 5 refuses the zombies command/],
  ['registry_160', 'src/sim/mapRegistry.ts', [["{ id: MAP_HYTHE, n: HYTHE_N, label: '地圖：海斯' }", "{ id: MAP_HYTHE, n: 160, label: '地圖：海斯' }"]], 'hythe-map', 'gen', /^gen: the registry lists 地圖：海斯 at 128/],
  ['popcap_missing', 'src/sim/platoon.ts', [['w.map === MAP_TOWN || w.map === MAP_HYTHE ? 64', 'w.map === MAP_TOWN ? 64']], 'platoon95', 'caps', /^caps: 24\/48\/64\/64 with the flag/],
  // 介面
  ['eager_hythe', MAIN, [['skirmish?.village ? 0 : skirmish?.hythe ? MAP_HYTHE :', 'skirmish?.village ? 0 : MAP_HYTHE && skirmish?.hythe ? MAP_HYTHE :']], 'hythe-map', 'page', /sandbox: reset\(\) without 海斯 never reads MAP_HYTHE/],
  ['camera_062', MAIN, [['  if (w.n > 32) view.target.set(w.n - 9, 0, w.n - 9);   // R043', '  if (w.n > 32) view.target.set(w.n * 0.62, 0, w.n * 0.62);   // R043']], 'hythe-map', 'page', /^page: the opening camera looks at our corner \(n − 9\)$/],
  ['valve_ignored', 'src/ui/skirmish.ts', [['const canHythe = valves(q).r090 && canVillage;', 'const canHythe = canVillage;']], 'hythe-map', 'page', /^valve: \?map=hythe chooses 海斯, and \?noR090=1 offers no 海斯$/],
  // 畫面
  ['raster_small', 'src/ui/minimapRaster.ts', [['export const useRaster = (n: number): boolean => n >= RASTER_N;', 'export const useRaster = (n: number): boolean => n >= 32;']], 'minimap90', '', /^minimap: maps 0–4 paint exactly as before R090/],
  // 審查 2026-11-18：點陣有寫沒畫、還沒寫就上傳、植被不疊、髒了不重寫
  ['raster_not_drawn', 'src/ui/minimapRaster.ts', [['    ctx.drawImage(cvs, 0, 0);', '']], 'minimap90', '', /^map5: the raster is drawn once through the diamond transform/],
  ['raster_put_early', 'src/ui/minimapRaster.ts', [["    if (!this.img) this.img = this.cvs.getContext('2d')!.createImageData(n, n);", "    if (!this.img) { this.img = this.cvs.getContext('2d')!.createImageData(n, n); this.cvs.getContext('2d')!.putImageData(this.img, 0, 0); }"], ["    cvs.getContext('2d')!.putImageData(this.img!, 0, 0);\n", '']], 'minimap90', '', /^map5: cell 0 has the old painter's colour/],
  ['foliage_dropped', 'src/ui/minimap.ts', [['    if (w.occ[cellIdx(w, x, z)] || !foliage) return;', '    return;']], 'minimap90', '', /^map5: every free hedge and wood cell is drawn on top of the raster/],
  ['raster_stale', 'src/ui/minimap.ts', [['    const big = useRaster(w.n); if (big) raster.begin(w.n);', '    const big = useRaster(w.n); if (big && raster.begin(w.n) === undefined && raster.done) return; if (big) raster.done = true;']], 'minimap90', '', /^map5: after dirty\(\) the next frame re-puts the raster/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  for (const f of ['hythe-map', 'path-scratch', 'platoon95', 'minimap90']) fs.copyFileSync(path.join(root, `tests/${f}.mjs`), path.join(temp, `tests/${f}.mjs`));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, test, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, [`tests/${test}.mjs`, ...(group ? [group] : [])], { cwd: temp, encoding: 'utf8', timeout: 60000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1] ?? r.stderr.match(/Got unwanted exception: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED hythe/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r090-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`hythe: ${cases.length} negative controls OK`);
