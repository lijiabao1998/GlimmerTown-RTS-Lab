// R092 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑那一支、那一群）。卡面驗收 30。
// 卡面挑錯之後拿掉的：rider_aim_order（step.ts:277 的檢查到不了，沒有改那一行）。hint_tank（提示列在 main.ts 的 vm 段裡）改由瀏覽器守衛看提示列。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r092-negative-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', T92 = 'src/sim/transport92.ts';
const RIDER = /^hidden: (aboard it never loses health|no shell ever targets it)/;
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['tp_unhashed', W, [[' if (e.tp) f.int(0x5450).int(e.tp);', '']], 'flag', /^flag: tp is folded into the hash/],
  ['link_unhashed', W, [['    if (u.ride) f.int(0x5244).int(u.ride); if (u.towBy) f.int(0x5457).int(u.towBy);   // R092：只在有時折\n', '']], 'flag', /^flag: a ride link is folded into the hash/],
  ['check_open', 'src/sim/commandCheck.ts', [[' && optInt(c.tp)', '']], 'flag', /^flag: the command check refuses tp "x"/],
  ['gate_removed', E, [['  if ((kind === UK_TRUCK || kind === UK_HALFTRACK) && (!e?.tp || w.zombies)) return;', '']], 'produce', /^noflag: kind 44 cannot be produced without tp/],
  ['zombie_gate', E, [['(!e?.tp || w.zombies)) return;', '!e?.tp) return;']], 'produce', /^produce: zombie defence does not offer kind 44/],
  ['hitch_ungated', ST, [["  if (w.eco?.tp && cmd.t !== 'fireDiscipline') hitch92(", "  if (cmd.t !== 'fireDiscipline') hitch92("]], 'produce', /^noflag: without tp a truck and a section moved together stay apart/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!tpOk(r)) return null;', '']], 'save', /^save: refused — tp 2/],
  ['no_arrival_drop', T92, [['    if (dead || c.order !== ORD_MOVE || pinned(w, c)) {', '    if (dead || pinned(w, c)) {']], 'board', /^board: when the truck stops/],
  ['no_unlimber', T92, [['      u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].reload);   // 下車', '      u.cooldown = 0;   // 下車']], 'board', /^board: when the truck stops/],
  ['reach_wide', T92, [['export const REACH92 = 2 * SUB;', 'export const REACH92 = 3 * SUB;']], 'reach', /^reach: two cells/],
  ['two_loads', T92, [[' || pinned(w, c) || busy.has(c.id)) continue;', ' || pinned(w, c)) continue;']], 'one', /^one: a loaded truck moved again with another section does not take a second load/],
  ['pinned_boards', T92, [["      if (u.ride || u.towBy || !(rides92(u.kind) || tows92(u.kind)) || pinned(w, u)) continue;", "      if (u.ride || u.towBy || !(rides92(u.kind) || tows92(u.kind))) continue;"]], 'refuse', /^refuse: a pinned section does not board/],
  ['rider_cmd', ST, [['u.side === cmd.side && !u.ride && !seen.has(u.id)', 'u.side === cmd.side && !seen.has(u.id)']], 'hidden', /^hidden: a move order to the rider is not taken/],
  ['rider_attack', ST, [['      if (!t || !t.alive || t.ride || t.side === u.side || tooClose(u, t.x, t.z)) return;', '      if (!t || !t.alive || t.side === u.side || tooClose(u, t.x, t.z)) return;']], 'hidden', /^hidden: an enemy attack order on the rider is not taken/],
  ['rider_spot', ST, [['    if (!u.alive || u.ride || u.side !== side', '    if (!u.alive || u.side !== side']], 'hidden', /^hidden: an observer aboard sees nothing/],
  ['rider_chase', ST, [['    if (!t || !t.alive || t.ride || tooClose(u, t.x, t.z)) { u.order = ORD_IDLE;', '    if (!t || !t.alive || tooClose(u, t.x, t.z)) { u.order = ORD_IDLE;']], 'hidden', /^hidden: once it boards, the enemy gives up the attack/],
  ['rider_aim', ST, [['    if (!t.alive || t.ride || t.side === u.side) continue;\n    const d = dist(u.x, u.z, t.x, t.z);\n    if (d > k.range || d < k.minRange) continue;\n    cand.push(d * AIM_ID', '    if (!t.alive || t.side === u.side) continue;\n    const d = dist(u.x, u.z, t.x, t.z);\n    if (d > k.range || d < k.minRange) continue;\n    cand.push(d * AIM_ID']], 'hidden', RIDER],
  ['rider_aim91', 'src/sim/support91.ts', [['    if (!t.alive || t.ride || t.side === u.side) continue;', '    if (!t.alive || t.side === u.side) continue;']], 'hidden', RIDER],
  ['rider_land', ST, [['const t0 = unitById(w, s.target), t = t0 && !t0.ride ? t0 : null;', 'const t0 = unitById(w, s.target), t = t0;']], 'hidden', /^hidden: an AP shell in flight does nothing once the target boards/],
  ['rider_splash', ST, [['    if (!t.alive || t.ride) continue;   // R092：車上的人不吃濺射', '    if (!t.alive) continue;   // R092：車上的人不吃濺射']], 'hidden', /^hidden: a mortar round on the loaded truck hurts the truck/],
  ['rider_fires', ST, [['if (u.alive && !u.ride && !u.towBy) fireUnit(w, u);', 'if (u.alive && !u.towBy) fireUnit(w, u);']], 'hidden', /^hidden: it never fires/],
  ['rider_suppressed', 'src/sim/morale.ts', [['  if (!u.alive || u.ride || amount <= 0', '  if (!u.alive || amount <= 0']], 'hidden', /^hidden: its suppression never rises/],
  ['no_bail', T92, [['      if (dead && rider && c) hurt(u,', '      if (false) hurt(u,']], 'bail', /^bail: when the 卡車 is destroyed the rider jumps out at the wreck and loses 30/],
  ['no_pin_drop', T92, [['    if (dead || c.order !== ORD_MOVE || pinned(w, c)) {', '    if (dead || c.order !== ORD_MOVE) {']], 'pinned', /^pinned: the step the truck is pinned, the section gets off/],
  ['tow_fires', ST, [['if (u.alive && !u.ride && !u.towBy) fireUnit(w, u);', 'if (u.alive && !u.ride) fireUnit(w, u);']], 'tow', /^tow: a towed gun never fires/],
  ['gun_own_order', T92, [['  if (!isMove) { for (const g of us) if (g.towBy) unhitch(g); return; }', '  if (!isMove) return;']], 'unhitch', /^unhitch: an attack order unhitches it/],
  ['push_tow', ST, [['UNIT_KINDS[u.kind].radius > 0 && !u.towBy);', 'UNIT_KINDS[u.kind].radius > 0);']], 'push', /^push: a truck towing a gun drives exactly like one that does not/],
  ['rider_seen_v1', 'src/sim/ai.ts', [['  const seen = w.units.filter(u => u.alive && !u.ride && u.side !== side', '  const seen = w.units.filter(u => u.alive && u.side !== side']], 'counter', /^counter: the v1 computer attacks the section on foot but never one riding/],
  ['rider_seen_v2', 'src/sim/ai2.ts', [['  const seen = w.units.filter(u => u.alive && !u.ride && u.side !== side', '  const seen = w.units.filter(u => u.alive && u.side !== side']], 'counter', /^counter: the v3 mortar shells a machine gun on foot but gives no order at all against one riding/],
  ['reload_ready', 'src/ui/reloadStatus.ts', [['    if (k.carry) continue;   // R092', '    // R092']], 'ui', /^ui: a selected half-track never shows 裝填完成/],
  ['report_drops', 'src/ui/report.ts', [[' || (k === UK_TANK && (kind === UK_TRUCK || kind === UK_HALFTRACK))', '']], 'ui', /^ui: trucks and half-tracks count in the tank column/],
  ['keep_selected', 'src/ui/transport92.ts', [['if (u?.ride) { s.selected.delete(id); cut = true; }', 'if (u?.ride) { cut = true; }']], 'ui', /^ui: a rider is taken out of the selection/],
  ['valve_ignored', 'src/main.ts', [['...(V.r092 ? { tp: 1 } : {}), ', '...{ tp: 1 }, ']], 'wiring', /^wiring: a new battle sends tp only when the R092 valve is on/],
  ['rider_drawn', 'src/render/battle.ts', [['return !u.ride && (u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z));', 'return (u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z));']], 'wiring', /^wiring: riders are not drawn/],
  ['minimap_rider', 'src/ui/minimap.ts', [['if (u.alive && !u.ride && (u.side === SIDE_PLAYER', 'if (u.alive && (u.side === SIDE_PLAYER']], 'wiring', /^wiring: riders are not on the minimap/],
  ['cdp_default', 'tools/cdp.mjs', [["const full92 = /(^|&)noR092=/.test(full91) ? full91 :", 'const full92 = full91; const unused92 = /(^|&)noR092=/.test(full91) ? full91 :']], 'wiring', /^wiring: tools\/cdp\.mjs opens pages with noR092=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/transport92.mjs'), path.join(temp, 'tests/transport92.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/transport92.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED transport92/${name}: ${first.slice(0, 140)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r092-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`transport92: ${cases.length} negative controls OK`);
