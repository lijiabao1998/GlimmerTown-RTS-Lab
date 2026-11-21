// R1011 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/hq1011.mjs 的那一群）。卡面驗收 18。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1011-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', H = 'src/sim/hq1011.ts', U = 'src/ui/hq1011.ts', M = 'src/main.ts';
const STORE = '  if (hq11 && w.eco.tech) w.eco.hq11 = 1;   // R1011：指揮部升級；要跟 tech 一起（R050 第二段）\n';
const PAUSE = '    if (hq.hqUp !== undefined && tick1011(w, hq)) continue;   // R1011：升級中＝這一方生產暫停（佇列、進度留著）\n';
const INCOME = '    if (w.tick % (incomeTicks(w) || ECO_INCOME_TICKS) === 0) e.supply[side]++;';
const ECO2 = '...(V.r050 && V.r1002 && V.r1011 ? { hq11: 1 } : {}), ';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  ['flag_unstored', E, [[STORE, '']], 'flag', /^flag: hq11 is stored only with sw 2 and tech 1, and only as 1/],
  ['flag_notech', E, [['  if (hq11 && w.eco.tech) w.eco.hq11 = 1;', '  if (hq11) w.eco.hq11 = 1;']], 'flag', /^flag: hq11 is stored only with sw 2 and tech 1, and only as 1/],
  ['hash_eco', W, [[' if (e.hq11) f.int(0x4851).int(e.hq11);', '']], 'flag', /^flag: hq11 is folded into the hash/],
  ['hash_bld', W, [['    if (b.hqLv !== undefined || b.hqUp !== undefined) f.int(0x4855).int(b.hqLv ?? 0).int(b.hqUp ?? 0);   // R1011：只在有時折\n', '']], 'order', /^order: hqLv and hqUp are folded into the hash/],
  ['zombie_open', H, [['if (!w.eco?.hq11 || w.zombies || w.sandbox', 'if (!w.eco?.hq11 || w.sandbox']], 'flag', /^flag: zombie defence does not offer the upgrade/],
  ['cmd_check', 'src/sim/commandCheck.ts', [['optInt(c.hq11) && ', '']], 'flag', /^flag: the command check refuses hq11 "x"/],
  ['winner_open', H, [[' || w.winner >= 0 ||', ' ||']], 'order', /^order: battle decided — 本局未開放/],
  ['side_open', H, [[" || (side !== 0 && side !== 1)) return '本局未開放';", ") return '本局未開放';"]], 'order', /^order: side 2 — 本局未開放/],
  ['dead_hq', H, [['return b && b.hp > 0 ? b : null; };', 'return b ? b : null; };']], 'order', /^order: HQ down — 指揮部已毀/],
  ['busy_open', H, [["  if (hq.hqUp !== undefined) return '正在升級';\n", '']], 'order', /^order: already upgrading — 正在升級/],
  ['phone_first', H, [["  if (kind === HQ_PHONE && hq.hqLv === undefined) return '要先加固指揮部';\n", '']], 'order', /^order: 1202 at level 0 — 要先加固指揮部/],
  ['no_supply_check', H, [['if (w.eco.supply[side] < spec.cost)', 'if (w.eco.supply[side] < 0)']], 'order', /^order: supply 29 — 補給不足，還差 1/],
  ['free_upgrade', H, [['  w.eco!.supply[side] -= spec.cost;\n', '']], 'order', /^order: taken — 30 supply, hqUp 300, nothing else/],
  ['no_pause', E, [[PAUSE, '']], 'pause', /^pause: ordered at 50, the queue's progress stays/],
  ['pause_before_income', E, [[INCOME, '    if (hq.hqUp !== undefined && tick1011(w, hq)) continue;\n' + INCOME], [PAUSE, '']], 'pause', /^pause: supply keeps coming in those 300 steps/],
  ['done_at_298', H, [['  if (up > 0) { hq.hqUp = up; return true; }', '  if (up > 1) { hq.hqUp = up; return true; }']], 'sand', /^sand: ordered at 0, one step short at 298/],
  ['max_only', H, [['hq.maxHp += SAND_HP; hq.hp += SAND_HP;', 'hq.maxHp += SAND_HP;']], 'sand', /^sand: ordered at 0, done at step 299/],
  ['no_event', H, [["  w.events.push({ e: 'hq11', bld: hq.id });\n", '']], 'sand', /^sand: 1200\/1200 becomes 1800\/1800, no stage event, one hq11 event/],
  ['phone_no_roof_check', H, [[' && stageOf(hq) === STAGE_INTACT;', ';']], 'phone', /^phone: kind 3 — levels 0 and 1 take 120 steps/],
  ['phone_level1', H, [['hq.hqLv === 2 && stageOf(hq)', '(hq.hqLv ?? 0) >= 1 && stageOf(hq)']], 'phone', /^phone: kind 3 — levels 0 and 1 take 120 steps/],
  ['phone_half', E, [['e.prog[side] = ticksOf(q[0]) >> 2;', 'e.prog[side] = ticksOf(q[0]) >> 1;']], 'phone', /^phone: kind 3 — levels 0 and 1 take 120 steps/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!hq11Ok(r)) return null;', '']], 'codec', /^codec: refused — eco\.hq11 2/],
  ['codec_no_max', H, [['    if (b.maxHp !== bldMaxHp(BK_HQ, 2, 2, 1) + (lv ? SAND_HP : 0)) return false;\n', '']], 'codec', /^codec: refused — level 1 with 1,200/],
  ['codec_no_range', H, [['(up as number) > HQ11[next].ticks', '(up as number) > 9999']], 'codec', /^codec: refused — hqUp 301 for level 1/],
  ['ecocmd_no_r1011', M, [[ECO2, '...(V.r050 && V.r1002 ? { hq11: 1 } : {}), ']], 'wiring', /^wiring: ② a new battle sends hq11 from ecoCmd/],
  ['ecocmd_no_r050', M, [[ECO2, '...(V.r1002 && V.r1011 ? { hq11: 1 } : {}), ']], 'wiring', /^wiring: ② a new battle sends hq11 from ecoCmd/],
  ['event_ignored', 'src/render/battle.ts', [["if (e.e === 'wire' || e.e === 'hq11') {", "if (e.e === 'wire') {"]], 'wiring', /^wiring: the hq11 event rebuilds the town mesh/],
  ['cache_no_level', 'src/render/buildings.ts', [["${b.builtBy ?? ''},${b.hqLv ?? ''},${stage},", "${b.builtBy ?? ''},${stage},"]], 'wiring', /^wiring: the per-building town cache keys on hqLv/],
  ['block_empty', U, [['? why1011(w, SIDE_PLAYER, kind) : undefined', "? '' : undefined"]], 'ui', /^ui: the two keys ask why1011/],
  ['group_build', U, [["group: '指揮部'", "group: '建造'"]], 'ui', /^ui: two items in their own 指揮部 group/],
  ['line_always_on', U, [["stageOf(b) === STAGE_INTACT ? '通' : '斷線'", "'通'"]], 'ui', /^ui: at seventy percent, the line is cut/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/hq1011.mjs'), path.join(temp, 'tests/hq1011.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/hq1011.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 60000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED hq1011/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`hq1011: ${cases.length} negative controls OK`);
