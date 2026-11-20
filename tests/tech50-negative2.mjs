// R050 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/tech50.mjs 的那一群）。卡面驗收 17。
// 第二支：瓦礫與自己的建築、科技、補給站、存檔、介面路由、閥（第一支 tech50-negative.mjs 是旗標、放得下的條件、上限、蓋）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r050-negative2-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', T = 'src/sim/tech50.ts', EN = 'src/sim/engineer1002.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['own_bld_blown', EN, [['  if (!t.wire && own50(w, u.side, t.b)) return;   // R050：自己蓋好的兵營、車廠、補給站不炸\n', ''], ['  if (!t.wire && own50(w, u.side, t.b)) { u.order = ORD_IDLE; u.path = []; u.pathIdx = 0; return; }', '']], 'ruin', /^ruin: our engineer does not blow up our own barracks/],
  ['ruin_kept', E, [['  if (w.tech) tech50Step(w);   // R050：打成瓦礫的工地拿掉\n', '']], 'ruin', /^ruin: a site knocked down is forgotten/],
  ['lock_off', E, [['  if (locked50(w, side, kind)) return;   // R050', '  // R050']], 'lock', /^lock: without its building kind 42 is not queued/],
  ['site_unlocks', T, [['&& b.hp > 0 && !site50(w, b)).length;', '&& b.hp > 0).length;']], 'lock', /^lock: a barracks still being built does not unlock/],
  ['any_side_unlocks', T, [['b.kind === kind && b.builtBy === side && b.hp > 0 && !site50(w, b)', 'b.kind === kind && b.hp > 0 && !site50(w, b)']], 'lock', /^lock: the enemy's barracks does not unlock ours/],
  ['lock_reason', 'src/ui/productionBlockReason.ts', [["  if (locked50(w, SIDE_PLAYER, kind)) return LOCK50[kind] === BK_BARRACKS ? '要先蓋兵營' : '要先蓋車廠';", '']], 'lock', /^lock: kind 42 says what to build/],
  ['income_off', E, [['    if (e.tech && w.tick % SUPPLY_TICKS50 === 0) e.supply[side] += income50(w, side);', '']], 'income', /^income: one depot adds 1 every 40 steps/],
  ['income_uncapped', T, [['Math.min(SUPPLY_MAX50, done50(', 'Math.min(3, done50(']], 'income', /^income: one depot adds 1 every 40 steps/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!techOk(r)) return null;', '']], 'codecref', /^codec: refused — tech 2/],
  ['codec_any_site', T, [['return !!spec && (left as number) >= 1 && (left as number) <= spec.work;', 'return (left as number) >= 1;']], 'codecref', /^codec: refused — a site on a house/],
  ['codec_no_tech_sites', T, [['return t === undefined && !blds.some(b => TECH50[b.kind as number] !== undefined);', 'return !blds.some(b => TECH50[b.kind as number] !== undefined);']], 'codecref', /^codec: refused — no tech but a site list/],   // R1004：沒有 tech 卻有工地清單（讀進來第一步就當）
  ['codec_no_tech_blds', T, [['return t === undefined && !blds.some(b => TECH50[b.kind as number] !== undefined);', 'return t === undefined;']], 'codecref', /^codec: refused — no tech but a barracks/],
  ['route_all_ids', 'src/ui/tech50.ts', [['ids: builders50(w, SIDE_PLAYER, ids).map(u => u.id), kind', 'ids: [...selected], kind']], 'route', /^route: armed, a tap with an engineer selected sends construct for the engineers only/],
  ['route_stays_armed', 'src/ui/tech50.ts', [["const kind = armed; armed = 0; flash = '';", "const kind = armed; flash = '';"]], 'route', /^route: sent, disarmed/],
  ['route_unhooked', 'src/ui/smoke.ts', [['  const b50 = tech50Route(w, selected, hit); if (b50 !== undefined) return b50;', '']], 'route', /^route: without an engineer selected nothing is sent/],
  ['pick_any', 'src/ui/tech50.ts', [['  if (!isItem(kind)) return false;\n', '']], 'route', /^route: a unit key is still production/],
  ['valve_ignored', 'src/main.ts', [['    if (eco) issue(V.r050 && V.r1002 ? { ...ecoCmd(), tech: 1 } as Command : ecoCmd());', '    if (eco) issue({ ...ecoCmd(), tech: 1 } as Command);']], 'ui', /^ui: a new battle sends tech only with both valves/],
  ['cdp_default', 'tools/cdp.mjs', [['const full50 = /(^|&)noR050=/.test(full1002) ? full1002 :', 'const full50 = full1002; const unused50 = /(^|&)noR050=/.test(full1002) ? full1002 :']], 'ui', /^ui: tools\/cdp\.mjs opens pages with noR050=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/tech50.mjs'), path.join(temp, 'tests/tech50.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/tech50.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED tech50/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`tech50: ${cases.length} negative controls OK (part 2)`);
