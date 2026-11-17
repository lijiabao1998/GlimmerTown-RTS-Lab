// R089 更大規模的步兵：故意弄壞。每一處在隔離副本裡改一行，跑 tests/section89.mjs 的指定群組，確認第一個紅燈落在指定的斷言上（逾時、語法錯不算）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r089-negative-'));
const S = 'src/render/section89.ts', Bt = 'src/render/battle.ts';
const mutants = [
  ['men_six', 'count', S, 'export const SECTION_MEN = 10;', 'export const SECTION_MEN = 6;', 'count: hp 60 shows 10'],
  ['leader_first', 'count', S, '    const A = lay[this.from[id]][i], B = lay[this.lay[id]][i];', '    const A = lay[this.from[id]][9 - i], B = lay[this.lay[id]][9 - i];', 'count: the last three standing are slots 0–2'],
  ['zombie_resized', 'count', S, '{ [UK_INFANTRY]: { men: SECTION_MEN, lay: LAYOUTS89 } };', '{ [UK_INFANTRY]: { men: SECTION_MEN, lay: LAYOUTS89 }, 11: { men: SECTION_MEN, lay: LAYOUTS89 } };', 'count: zombies, MG and mortar crews draw the same number'],
  ['no_cull', 'cull', S, '    if (!this.onScreen(x, y, z)) { this.culled += men; return n; }', '    if (false) { this.culled += men; return n; }', 'cull: an off-screen section writes no instances'],
  ['skip_offscreen_bodies', 'cull', S, '    for (let i = men; i < last; i++) {', '    for (let i = men; i < last && this.onScreen(x, y, z); i++) {', 'cull: men lost off screen are still laid down'],
  ['cull_wrong_axis', 'cull', S, 'const sx = (rx - rz) * Math.SQRT1_2,', 'const sx = (rx + rz) * Math.SQRT1_2,', 'cull: every section whose centre is on screen is drawn'],
  ['cull_no_aspect', 'cull', S, 'return Math.abs(sx) <= hh * aspect + MARGIN89 &&', 'return Math.abs(sx) <= hh + MARGIN89 &&', 'cull: every section whose centre is on screen is drawn'],
  ['grow_skipped', 'cull', Bt, '    this.zombieUnitSlots();   // R089', '    if (this.w.zombies || this.w.n >= 96) this.zombieUnitSlots();   // R089', 'cull: on the 64 map an infantry unit with id 700'],
  ['shadow_always', 'tiers', S, '    H.men.castShadow = this.tier === 0;', '    H.men.castShadow = true;', 'tiers: 229 figures → T1'],
  ['dense_never', 'tiers', S, '    return this.tier >= 2 ? this.dense() : H.menNormal;', '    return H.menNormal;', 'tiers: 458 figures → T2'],
  ['no_hysteresis', 'tiers', S, '      if (t - this.since >= BACK89) { this.tier--; this.since = -1; }', '      if (t - this.since >= 0) { this.tier--; this.since = -1; }', 'tiers: stepping back to a richer tier waits 1 s'],
  ['t2_no_body_cap', 'tiers', S, '    let skip = this.tier >= 2 ? Math.max(0, on - Math.max(0, Math.min(64, this.limit(2) - live))) : 0;', '    let skip = 0;', 'tiers: at T2 bodies shown ≤ min(64'],
  ['rng_in_draw', 'purity', S, '    this.grow(id);\n', '    this.grow(id); w.rng = (w.rng + 1) >>> 0;\n', 'purity: update() leaves hashWorld and w.rng unchanged'],
  ['valve_ignored', 'valve', S, 'export function setSection89(on: boolean): void { on89 = on; }', 'export function setSection89(on: boolean): void { on89 = on || true; }', 'valve: with ?noR089=1 the men instances are bit-identical'],
  ['roof_unscaled', 'layout', S, 'scaled(HALT, 0.75), scaled(PRONE, 0.75)];', 'HALT, PRONE];', 'layout: roof figures stand closer together'],
  ['prone_ignored', 'layout', S, '    const prone = !u.rout && w.rules?.morale === 2 && moraleState(u) >= MORALE_PINNED;', '    const prone = false && !u.rout && w.rules?.morale === 2 && moraleState(u) >= MORALE_PINNED;', 'layout: a pinned section lies prone under morale 2'],
  ['blend_snap', 'layout', S, '    const s = ease((t - this.t0[id]) / BLEND89),', '    const s = 1,', 'layout: 0.2 s after stopping the section is between the two formations'],
  ['turn_never', 'layout', S, '    const goal = moving ? heading : engaged ? aim : this.ori[id],', '    const goal = moving ? heading : this.ori[id],', 'layout: a halted section that is firing turns its line toward the target'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests', 'tools']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/section89.mjs'), join(dir, 'tests/section89.mjs'));
    cpSync(join(root, 'tools/cdp.mjs'), join(dir, 'tools/cdp.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/section89.mjs'), group], { encoding: 'utf8', timeout: 110000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK section89-negative/${name}: ${first.slice(0, 140)}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`section89-negative: ${mutants.length} isolated mutants rejected`);
