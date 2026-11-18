// R091 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑那一支、那一群）。卡面驗收 36。
// 電腦造、指揮兩種兵那幾處（v2_commands、build_ungated、easy_builds）隨刪減第 1、2 項一起拿掉；瀏覽器那三處改成 support91.mjs 的 wiring 群（見卡面施工紀錄）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r091-negative-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', S91 = 'src/sim/support91.ts', BA = 'src/sim/ballistics.ts';
// [名字, 檔案, [[原文, 改成], …], 守衛, 群, 第一個紅的斷言]
const cases = [
  ['gate_removed', E, [["  if ((kind === UK_SNIPER || kind === UK_AT91) && (!e?.sw || w.zombies)) return;", '']], 'support91', 'produce', /^noflag: kind 42 cannot be produced without sw/],
  ['zombie_gate', E, [['(!e?.sw || w.zombies)) return;', '!e?.sw) return;']], 'support91', 'produce', /^produce: zombie defence does not offer kind 42/],
  ['sw_unhashed', W, [[' if (e.sw) f.int(0x5357).int(e.sw);', '']], 'support91', 'flag', /^flag: sw is folded into the hash/],
  ['check_open', 'src/sim/commandCheck.ts', [[' && optInt(c.sw)', '']], 'support91', 'flag', /^flag: the command check refuses sw "x"/],
  ['codec_open', S91, [['  if ((r.units as Record<string, unknown>[]).some(u => ours(u.kind))) return false;', '']], 'support91', 'save', /^save: a save with kind 42\/43 units but no sw is refused/],
  ['sniper_moving', W, [['soft: 100, setup: true, team91: 1', 'soft: 100, setup: false, team91: 1']], 'support91', 'srange', /^srange: no shot while moving/],
  ['sniper_range', W, [["name: '狙擊手', hp: 20, speed: 12, range: 11 * SUB", "name: '狙擊手', hp: 20, speed: 12, range: 12 * SUB"]], 'support91', 'flag', /^flag: kind 42 matches the card's table/],
  ['one_man_off', ST, [[': shotDmg91(k, t)));', ': k.dmgUnit));']], 'support91', 'oneman', /^oneman: a machine-gun team loses 14 a shot/],
  ['tiers_off', S91, [['    cand.push(tier * T45 + d * T32 + t.id);', '    cand.push(d * T32 + t.id);']], 'support91', 'tiers', /^tiers: an observer at 10 cells before a section at 8/],
  ['sniper_armour', S91, [['  if (tk.armored) return tk.openTop ? 3 : -1;', '  if (tk.armored) return 3;']], 'support91', 'tiers', /^tiers: a closed tank alone in range draws no shot in 600 steps/],
  ['at_small_round', ST, [['k.men && !k.hollow ? SHELL_SMALL : SHELL_AP', 'k.men ? SHELL_SMALL : SHELL_AP']], 'support91', 'arange', /^arange: a tank at 3 cells is hit, and the impact is an armour-piercing round/],
  ['at_soft_idle', S91, [['  if (!tk.armored) return -1;', '  if (!tk.armored) return 9;']], 'support91', 'arange', /^atarget: with only a section in range it never fires in 600 steps/],
  ['open_top_classic', ST, [['!(tk.openTop && k.men > 0 && !k.hollow)', '!(tk.openTop && k.men > 0)']], 'support91', 'adamage', /^classic: an open-top destroyer side takes 60/],
  ['open_top_ap', BA, [[' && !UNIT_KINDS[shooterKind].hollow)) return -1;', ')) return -1;']], 'support91', 'adamage', /^ap: an open-top destroyer hit from the front takes 60/],
  ['pen_raised', BA, [['  43: [85, 80],', '  43: [141, 140],']], 'ballistics', 'relations', /^relations: no gun defeats the Panther's front/],
  ['hold_dropped', 'src/sim/fireDiscipline.ts', [['(!k.men || !!k.hold)', '!k.men']], 'support91', 'shared', /^hold: kind 42 holds fire with a target in range/],
  ['wire_removed', W, [['  if ((kind === UK_SNIPER || kind === UK_AT91) && (w.eco?.sw ?? 0) >= 1) return (wireAt(w, x, z)?.hp ?? 0) > 0;', '']], 'support91', 'shared', /^wire: an intact wire cell stops kind 42 when sw is on/],
  ['wire_ungated', W, [['(kind === UK_SNIPER || kind === UK_AT91) && (w.eco?.sw ?? 0) >= 1)', '(kind === UK_SNIPER || kind === UK_AT91))']], 'support91', 'shared', /^wire: without sw the foot list is unchanged for kind 42/],
  ['report_drops', 'src/ui/report.ts', [[' || (k === UK_INFANTRY && (kind === UK_SNIPER || kind === UK_AT91))', '']], 'support91', 'shared', /^report: both kinds count in the infantry column/],
  ['counter_peeks', 'src/sim/ai2.ts', [['nearest(g, ok.filter(t => t.kind === UK_SNIPER))', 'nearest(g, w.units.filter(t => t.alive && t.side !== side && t.kind === UK_SNIPER && inReach(t.x, t.z)))']], 'support91', 'counter', /^counter: an unseen sniper is not acted on/],
  ['counter_unflagged', 'src/sim/ai2.ts', [['(st.v === 3 && w.eco?.sw ? nearest(g, ok.filter(t => t.kind === UK_SNIPER))', '(st.v === 3 ? nearest(g, ok.filter(t => t.kind === UK_SNIPER))']], 'support91', 'counter', /^counter: without sw the third version does not single out snipers/],
  ['valve_ignored', 'src/main.ts', [['...(V.r091 ? { sw: 1 } : {}), ', '...{ sw: 1 }, ']], 'support91', 'wiring', /^wiring: a new battle sends sw only when the R091 valve is on/],
  ['invisible', 'src/render/battle.ts', [[' if (!this.sec89.has(u.kind) && (u.kind === UK_SNIPER || u.kind === UK_AT91)) nm = this.squad21(u, x, z, simT, col, nm);', '']], 'support91', 'wiring', /^wiring: with R089 off both kinds are drawn like a section/],
  ['cdp_default', 'tools/cdp.mjs', [["const full91 = /(^|&)noR091=/.test(full) ? full : `${full ? full + '&' : ''}noR091=1`;", 'const full91 = full;']], 'support91', 'wiring', /^wiring: tools\/cdp\.mjs opens pages with noR091=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  for (const f of ['support91', 'ballistics']) fs.copyFileSync(path.join(root, `tests/${f}.mjs`), path.join(temp, `tests/${f}.mjs`));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, test, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, [`tests/${test}.mjs`, group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED support91/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r091-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`support91: ${cases.length} negative controls OK`);
