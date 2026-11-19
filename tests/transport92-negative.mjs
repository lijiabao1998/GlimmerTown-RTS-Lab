// R092 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑那一支、那一群）。卡面驗收 30。
// 卡面挑錯之後拿掉的：rider_aim_order（step.ts:277 的檢查到不了，沒有改那一行）。R030 加了 21 處（hint_tank 放回來：Node 看 main.ts 那一行）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r092-negative-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', T92 = 'src/sim/transport92.ts', U92 = 'src/ui/transport92.ts';
const RIDER = /^hidden: (aboard it never loses health|no shell ever targets it)/;
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['tp_unhashed', W, [[' if (e.tp) f.int(0x5450).int(e.tp);', '']], 'flag', /^flag: tp is folded into the hash/],
  ['link_unhashed', W, [['    if (u.ride) f.int(0x5244).int(u.ride); if (u.towBy) f.int(0x5457).int(u.towBy);   // R092：只在有時折\n', '']], 'flag', /^flag: a ride link is folded into the hash/],
  ['check_open', 'src/sim/commandCheck.ts', [[' && optInt(c.tp)', '']], 'flag', /^flag: the command check refuses tp "x"/],
  ['gate_removed', E, [['  if ((kind === UK_TRUCK || kind === UK_HALFTRACK) && (!e?.tp || w.zombies)) return;', '']], 'produce', /^noflag: kind 44 cannot be produced without tp/],
  ['zombie_gate', E, [['(!e?.tp || w.zombies)) return;', '!e?.tp) return;']], 'produce', /^produce: zombie defence does not offer kind 44/],
  ['hitch_ungated', ST, [["  if (w.eco?.tp && cmd.t !== 'fireDiscipline') hitch92(", "  if (cmd.t !== 'fireDiscipline') hitch92("]], 'produce', /^noflag: without tp a truck and a section moved together stay apart/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!tpOk(r)) return null;', '']], 'save', /^save: refused — tp 3/],
  ['no_arrival_drop', T92, [['    if (dead || c.order !== ORD_MOVE || pinned(w, c)) {', '    if (dead || pinned(w, c)) {']], 'board', /^board: when the truck stops/],
  ['no_unlimber', T92, [['      u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].reload);   // 下車', '      u.cooldown = 0;   // 下車']], 'board', /^board: when the truck stops/],
  ['reach_wide', T92, [['export const REACH92 = 2 * SUB;', 'export const REACH92 = 3 * SUB;']], 'reach', /^reach: kind \d+ at 513 is not picked up/],
  ['two_loads', T92, [[' && !pinned(w, c) && !busy.has(c.id));', ' && !pinned(w, c));']], 'one', /^one: a loaded truck moved again with another section does not take a second load/],
  ['pinned_boards', T92, [["      if (taken.has(u.id) || !(rides92(u.kind) || tows92(u.kind)) || pinned(w, u)) continue;", "      if (taken.has(u.id) || !(rides92(u.kind) || tows92(u.kind))) continue;"]], 'refuse', /^refuse: a pinned section does not board/],
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
  ['gun_own_order', T92, [['  if (!isMove) { for (const g of us) if (g.towBy && (w.eco?.tp !== 2 || isStop || g.order !== ORD_IDLE)) unhitch(g); return; }', '  if (!isMove) return;']], 'unhitch', /^unhitch: an attack order unhitches it/],
  ['push_tow', ST, [['UNIT_KINDS[u.kind].radius > 0 && !u.towBy);', 'UNIT_KINDS[u.kind].radius > 0);']], 'push', /^push: a truck towing a gun drives exactly like one that does not/],
  ['rider_seen_v1', 'src/sim/ai.ts', [['  const seen = w.units.filter(u => u.alive && !u.ride && u.side !== side', '  const seen = w.units.filter(u => u.alive && u.side !== side']], 'counter', /^counter: the v1 computer attacks the section on foot but never one riding/],
  ['rider_seen_v2', 'src/sim/ai2.ts', [['  const seen = w.units.filter(u => u.alive && !u.ride && u.side !== side', '  const seen = w.units.filter(u => u.alive && u.side !== side']], 'counter', /^counter: the v3 mortar shells a machine gun on foot but gives no order at all against one riding/],
  ['reload_ready', 'src/ui/reloadStatus.ts', [['    if (k.carry) continue;   // R092', '    // R092']], 'ui', /^ui: a selected half-track never shows 裝填完成/],
  ['report_drops', 'src/ui/report.ts', [[' || (k === UK_TANK && (kind === UK_TRUCK || kind === UK_HALFTRACK))', '']], 'ui', /^ui: trucks and half-tracks count in the tank column/],
  ['keep_selected', 'src/ui/transport92.ts', [['if (u?.ride) { s.selected.delete(id); cut = true; }', 'if (u?.ride) { cut = true; }']], 'ui', /^ui: a rider is taken out of the selection/],
  ['valve_ignored', 'src/main.ts', [['...(V.r092 ? { tp: V.r030 ? 2 : 1 } : {}), ', '...{ tp: V.r030 ? 2 : 1 }, ']], 'wiring', /^wiring: a new battle sends tp only when the R092 valve is on/],
  ['rider_drawn', 'src/render/battle.ts', [['return !u.ride && (u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z));', 'return (u.side === SIDE_PLAYER || this.visibleAt(u.x, u.z));']], 'wiring', /^wiring: riders are not drawn/],
  ['minimap_rider', 'src/ui/minimap.ts', [['if (u.alive && !u.ride && (u.side === SIDE_PLAYER', 'if (u.alive && (u.side === SIDE_PLAYER']], 'wiring', /^wiring: riders are not on the minimap/],
  // R030
  ['refused_unhitch', T92, [['g.towBy && (w.eco?.tp !== 2 || isStop || g.order !== ORD_IDLE)', 'g.towBy']], 'unhitch', /^unhitch: with tp 2 an attack the towed gun refuses/],
  ['tp1_changed', T92, [['(w.eco?.tp !== 2 || isStop', '(isStop']], 'unhitch', /^unhitch: with tp 1 \(R092 replays\) the refused attack still unhitches/],
  ['stop_kept', T92, [['w.eco?.tp !== 2 || isStop || g.order', 'w.eco?.tp !== 2 || g.order']], 'unhitch', /^unhitch: with tp 2 stopping the gun unhitches it/],
  ['stop_not_passed', ST, [["hitch92(w, cmd.t === 'move', us, cmd.t === 'stop');", "hitch92(w, cmd.t === 'move', us);"]], 'unhitch', /^unhitch: with tp 2 stopping the gun unhitches it/],
  ['tp2_stored', E, [['w.eco.tp = tp === 2 ? 2 : 1;', 'w.eco.tp = 1;']], 'flag', /^flag: tp 2 \(R030\) is stored as 2/],
  ['tp2_dropped', ST, [['cmd.tp === 2 ? 2 : cmd.tp === 1 ? 1 : 0', 'cmd.tp === 1 ? 1 : 0']], 'flag', /^flag: tp 2 \(R030\) is stored as 2/],
  ['codec_tp2', T92, [[' && e.tp !== 2) return false;', ') return false;']], 'save', /^save: a save with tp 2 \(R030\) reads back/],
  ['valve30_ignored', 'src/main.ts', [['{ tp: V.r030 ? 2 : 1 }', '{ tp: 2 }']], 'wiring', /^wiring: a new battle sends tp 2, and \?noR030=1 sends tp 1/],
  ['hint_tank', 'src/main.ts', [['tanks: sel.filter(u => UNIT_KINDS[u.kind].armored && !UNIT_KINDS[u.kind].carry).length', 'tanks: sel.filter(u => UNIT_KINDS[u.kind].armored).length']], 'wiring', /^wiring: the hint counts a half-track as 半履帶車/],
  ['pair_by_unit', U92, [['  return match92(w, cars, mine).map(([c]) => c.id);', '  const out = []; for (const u of mine) { if (u.ride || u.towBy) continue; let best = 0, bd = 0; for (const c of cars) { if (out.includes(c.id)) continue; const d = Math.hypot(u.x - c.x, u.z - c.z); if (d <= 512 && (!best || d < bd)) { best = c.id; bd = d; } } if (best) out.push(best); } return out;']], 'ui', /^ui: 搭車 pairs the way the move does/],
  ['pair_pinned', U92, [[' && !busy.has(c.id) && !pinned92(w, c));', ' && !busy.has(c.id));']], 'ui', /^ui: 搭車 adds no pinned truck/],
  ['prune_towed', U92, [['if (u?.ride) { s.selected.delete(id); cut = true; }', 'if (u?.ride || u?.towBy) { s.selected.delete(id); cut = true; }']], 'ui', /^ui: a towed gun stays in the selection/],
  ['ride_overlap', 'index.html', [['+ 220px); top: calc(max(8px, env(safe-area-inset-top)) + 58px); }', '+ 204px); top: calc(max(8px, env(safe-area-inset-top)) + 58px); }']], 'ui', /^ui: the 搭車 bar sits at least 64px right of 全排/],
  ['rider_no_reload', T92, [['      u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].reload);   // 下車', '      if (!rider) u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].reload);   // 下車']], 'board', /^board: when the truck stops/],
  ['rehitch', T92, [['match92(w, cars, sorted.filter(u => !u.ride && !u.towBy))', 'match92(w, cars, sorted)']], 'one', /^one: a gun towed by a truck in the same move stays on it/],
  ['pair_skips_towed', U92, [[' && !u.rout && !u.ride);', ' && !u.rout && !u.ride && !u.towBy);']], 'ui', /^ui: a selected gun towed by an unselected truck counts for 搭車/],
  ['pair_moving', U92, [[' && c.order === ORD_IDLE && !c.rout', ' && !c.rout']], 'ui', /^ui: 搭車 does not add a truck that is already driving/],
  ['codec_tp2_links', T92, [['  if (e?.tp !== 1 && e?.tp !== 2) {', '  if (e?.tp !== 1) {']], 'save', /^save: a save with tp 2 \(R030\) reads back/],
  ['tp_value_unhashed', W, [[' if (e.tp) f.int(0x5450).int(e.tp);', ' if (e.tp) f.int(0x5450).int(e.tp ? 1 : 0);']], 'flag', /^flag: tp 2 folds differently from tp 1/],
  ['no_arrival_drop_net', T92, [['    if (dead || c.order !== ORD_MOVE || pinned(w, c)) {', '    if (dead || pinned(w, c)) {']], 'net', /^net: in lockstep sections boarded, guns were towed, loads were dropped on arrival/],
  ['codec_tp2_unchecked', T92, [['  const used = new Set<number>();', '  if (e?.tp === 2) return true;   const used = new Set<number>();']], 'save', /^save: refused — .* \(tp 2\)/],
  ['cdp_default', 'tools/cdp.mjs', [["const full92 = /(^|&)noR092=/.test(full91) ? full91 :", 'const full92 = full91; const unused92 = /(^|&)noR092=/.test(full91) ? full91 :']], 'wiring', /^wiring: tools\/cdp\.mjs opens pages with noR092=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/transport92.mjs'), path.join(temp, 'tests/transport92.mjs'));
  fs.copyFileSync(path.join(root, 'index.html'), path.join(temp, 'index.html'));   // R030：搭車鍵的位置
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
