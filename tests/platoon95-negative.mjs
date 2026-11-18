// R095 步兵排：故意弄壞。每一處在隔離副本裡改一行，跑 tests/platoon95.mjs 的指定群組，確認第一個紅燈落在指定的斷言上（逾時、語法錯不算）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r095-negative-'));
const Pl = 'src/sim/platoon.ts', E = 'src/sim/eco.ts', A3 = 'src/sim/ai3.ts', U = 'src/ui/platoon95.ts';
const mutants = [
  ['pla_unhashed', 'flag', 'src/sim/world.ts', ' if (e.pla) f.int(0x5041).int(e.pla);', '', 'flag: the eco pla flag is in the hash'],
  ['pl_unhashed', 'flag', 'src/sim/world.ts', '    if (u.pl) f.int(0x504c).int(u.pl);', '', 'flag: a unit platoon number is in the hash'],
  ['check_open', 'flag', 'src/sim/commandCheck.ts', ' && optInt(c.pla);', ';', 'flag: the command check takes 1 and refuses text'],
  ['codec_open', 'flag', 'src/sim/worldCodec.ts', '  if (!platoonOk(r)) return null;', '  if (false) return null;', 'flag: the save codec refuses'],
  ['gate_removed', 'flag', E, 'if (e?.pla && e.inf &&', 'if (e && e.inf &&', 'flag: without the flag ordering a platoon changes nothing'],
  ['pop_one_slot', 'platoon', Pl, '(k === PLATOON_ITEM ? PLATOON_SECTIONS : 1)', '(k === PLATOON_ITEM ? 1 : 1)', 'platoon: with fewer than 3 free population slots the platoon waits'],
  ['no_discount', 'platoon', Pl, 'export const PLATOON_COST = 66;', 'export const PLATOON_COST = 75;', 'platoon: one queue slot for 66 supply'],
  ['pl_unshared', 'platoon', E, 'w.units[w.units.length - 1].pl = first;', 'w.units[w.units.length - 1].pl = w.units.length;', 'platoon: three sections in one tick share a platoon number'],
  ['rally_stacked', 'platoon', E, 'const [ox, oz] = j ? FORMATION_PLA[j] : [0, 0],', 'const [ox, oz] = [0, 0],', 'platoon: three sections in one tick share a platoon number and rally on three cells'],
  ['rally_unmirrored', 'platoon', E, 'fm = w.sym && side === SIDE_ENEMY ? -1 : 1;', 'fm = 1;', 'platoon: under symmetry the other side rallies on the mirrored cells'],
  ['queue_reader_raw', 'readers', U, '|| q[0] !== PLATOON_ITEM) return productionCountdown(w, enabled);', '|| true) return productionCountdown(w, enabled);', 'readers: countdown, reason and progress read the platoon token'],
  ['ai_without_flag', 'ai', A3, 'plaHard = !!e.pla && lv >= 3 && w.n >= 64;', 'plaHard = lv >= 3 && w.n >= 64;', 'ai: without the flag the computer never orders a platoon'],
  ['ai_normal_changed', 'ai', A3, 'plaHard = !!e.pla && lv >= 3 && w.n >= 64;', 'plaHard = !!e.pla && lv >= 2 && w.n >= 64;', 'ai: the normal computer orders the same'],
  ['ai_small_maps', 'ai', A3, 'plaHard = !!e.pla && lv >= 3 && w.n >= 64;', 'plaHard = !!e.pla && lv >= 3;', 'ai: on the small maps the hard computer orders exactly as without the flag'],
  ['ai_ratio', 'ai', A3, 'has(UK_INFANTRY) * 2 < core && has(UK_INFANTRY) < 6)', 'has(UK_INFANTRY) < 6)', 'ai: sections × 2 must stay below the core'],
  ['ai_cap', 'ai', A3, 'has(UK_INFANTRY) * 2 < core && has(UK_INFANTRY) < 6)', 'has(UK_INFANTRY) * 2 < core)', 'ai: at most six sections'],
  ['ai_queue_raw', 'ai', A3, 'queueUnits(q).filter(ok).length', 'q.filter(ok).length', 'ai: a queued platoon counts as three sections'],
  ['ai_no_core_gate', 'ai', A3, 'core >= CORE_FIRST && has(UK_INFANTRY) * 2 < core', 'has(UK_INFANTRY) * 2 < core', 'ai: below four core vehicles there is no platoon'],
  ['formation_wrap9', 'formation', 'src/sim/step.ts', 'const T = w.eco?.pla ? FORMATION_PLA : FORMATION,', 'const T = FORMATION,', 'formation: 25 distinct cells'],
  ['select_all_infantry', 'select', U, 'u.pl !== undefined && pls.has(u.pl)', 'true', 'select: one section selects the living sections of its platoon'],
  ['ui_reads_valve', 'wiring', 'src/main.ts', 'cost: UNIT_KINDS[UK_INFANTRY].cost }, PLATOON_UI_ITEM] : [])', 'cost: UNIT_KINDS[UK_INFANTRY].cost }, ...(V.r095 ? [PLATOON_UI_ITEM] : [])] : [])', "wiring: the platoon UI follows the world flag, not this page's valve"],
  ['short_dropped', 'wiring', 'src/ui/production.ts', '(it.short ?? it.label[0])', 'it.label[0]', 'wiring: the queue strip shows a platoon as 排'],
  ['countdown_always_pop', 'readers', U, ': popShort ? ', ': true ? ', 'readers: the platoon only blames population when population is the reason'],
  ['rule_pla_value', 'flag', Pl, "if (e && e.pla !== undefined && e.pla !== 1) return false;", '', 'flag: the save codec refuses pla 2'],
  ['rule_token', 'flag', Pl, 'if (!pla && e && Array.isArray(e.queue) && e.queue.some(q => Array.isArray(q) && q.includes(PLATOON_ITEM))) return false;', '', 'flag: the save codec refuses a platoon token without the flag'],
  ['rule_pl_noflag', 'flag', Pl, 'if (!pla || u.kind !== UK_INFANTRY ||', 'if (u.kind !== UK_INFANTRY ||', 'flag: the save codec refuses a platoon number without the flag'],
  ['rule_kind', 'flag', Pl, '|| u.kind !== UK_INFANTRY || !head', '|| !head', 'flag: the save codec refuses a tank with a platoon number'],
  ['rule_order', 'flag', Pl, '|| (u.pl as number) > (u.id as number) ||', '||', 'flag: the save codec refuses a platoon number that points forward'],
  ['rule_head_kind', 'flag', Pl, '|| head.kind !== UK_INFANTRY ||', '||', 'flag: the save codec refuses a platoon headed by a tank'],
  ['rule_side', 'flag', Pl, '|| head.side !== u.side) return false;', ') return false;', 'flag: the save codec refuses a platoon headed by the enemy'],
  ['exact_ticks', 'platoon', Pl, 'export const PLATOON_TICKS = 300;', 'export const PLATOON_TICKS = 299;', 'platoon: it takes exactly 300 ticks'],
  ['cdp_default_dropped', 'wiring', 'tools/cdp.mjs', 'const url = /(^|&)noR095=/.test(url87) ? url87 : `${url87}&noR095=1`;', 'const url = url87;', 'wiring: tools/cdp.mjs adds noR095=1'],
  ['valve_ignored', 'wiring', 'src/main.ts', '...(V.r095 ? { pla: 1 } : {}), ...(V.r080 ?', '...({ pla: 1 }), ...(V.r080 ?', 'wiring: a new battle carries pla behind ?noR095=1'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests', 'tools']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/platoon95.mjs'), join(dir, 'tests/platoon95.mjs'));
    for (const t of ['duel.mjs', 'cdp.mjs']) cpSync(join(root, 'tools', t), join(dir, 'tools', t));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/platoon95.mjs'), group], { encoding: 'utf8', timeout: 110000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK platoon95-negative/${name}: ${first.slice(0, 140)}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`platoon95-negative: ${mutants.length} isolated mutants rejected`);
