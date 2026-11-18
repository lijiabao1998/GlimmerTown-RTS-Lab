// R096 先把大仗撐住：故意弄壞。每一處在隔離副本裡改一行，跑 tests/crowd96.mjs 的指定群組，確認第一個紅燈落在指定的斷言上（逾時、語法錯不算）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r096-negative-'));
const St = 'src/sim/step.ts', S = 'src/render/section89.ts';
const mutants = [
  ['tiebreak_high', 'aim', St, '  cand.sort((a, b) => a - b);', '  cand.sort((a, b) => Math.floor(a / AIM_ID) - Math.floor(b / AIM_ID) || b - a);', 'aim: the nearest-first search picks the same target as before'],
  ['no_sort', 'aim', St, '  cand.sort((a, b) => a - b);\n', '', 'aim: the nearest-first search picks the same target as before'],
  ['skip_spotted', 'aim', St, '    if (!spotted(w, u.side, t.x, t.z)) continue;\n', '', 'aim: the nearest-first search picks the same target as before'],
  ['stale_scratch', 'aim', St, 'const cand = AIM_CAND; cand.length = 0;', 'const cand = AIM_CAND;', 'aim: the nearest-first search picks the same target as before'],
  ['t3_off', 't3', S, '    this.ratio = on96 && this.want > 0 && this.want + others > LIVE96 ? Math.max(0, LIVE96 - others) / this.want : 1;', '    this.ratio = 1;', 't3: 1,280 wanted figures draw 6 per section'],
  ['no_hard_stop', 't3', S, 'stop = on96 ? LIVE96 : Infinity;', 'stop = Infinity;', 't3: 1,280 wanted figures draw 6 per section'],
  ['ratio_from_drawn', 't3', S, 'this.want > 0 && this.want + others > LIVE96 ? Math.max(0, LIVE96 - others) / this.want : 1;', 'this.live > 0 && this.live + others > LIVE96 ? Math.max(0, LIVE96 - others) / this.live : 1;', 't3: 1,280 wanted figures draw 6 per section'],
  ['zombies_thinned', 't3', S, '    const others = this.liveAll - this.live;', '    const others = 0;', 't3: zombies and crews keep every figure'],
  ['min_ignored', 't3', S, 'Math.max(MIN96, Math.floor(crowd.men * this.ratio))', 'Math.floor(crowd.men * this.ratio)', 't3: never more than 800 live figures, and a drawn section shows at least 3'],
  ['valve_ignored', 'valve', S, 'export function setCrowd96(on: boolean): void { on96 = on; }', 'export function setCrowd96(on: boolean): void { on96 = on || true; }', 'valve: with ?noR096=1 every figure is drawn as in R089'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests', 'tools']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/crowd96.mjs'), join(dir, 'tests/crowd96.mjs'));
    cpSync(join(root, 'tools/duel.mjs'), join(dir, 'tools/duel.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/crowd96.mjs'), group], { encoding: 'utf8', timeout: 110000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK crowd96-negative/${name}: ${first.slice(0, 140)}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`crowd96-negative: ${mutants.length} isolated mutants rejected`);
