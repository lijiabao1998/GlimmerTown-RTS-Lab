// R116 每個負控制只跑自己的語意群組，要求首個錯誤是真正預期的 AssertionError。
// 副本在 OS 暫存目錄；不改原始碼、工具、舊守衛或本地工作樹。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r116-negative-'));
const mutants = [
  ['rng_draw', 'generation', 'vegetation.ts', '  w.vegetation = { version:', '  w.rng++;\n  w.vegetation = { version:', 'generation: never draws World.rng'],
  ['road_filter', 'generation', 'vegetation.ts', ' || w.ter[c] === TER_ROAD', '', 'generation: avoids road, mud and all building footprints'],
  ['spawn_filter', 'generation', 'vegetation.ts', ' || units.has(c)', '', 'generation: custom initial unit excludes an otherwise valid candidate'],
  ['loose_activation', 'activation', 'maps.ts', 'if (vegetation === 1 &&', 'if (vegetation &&', 'activation: only numeric one enables'],
  ['coerced_map', 'activation', 'step.ts', 'c.id === 0 || c.id === 1 ? c.vegetation : undefined', 'c.vegetation', 'activation: command cannot coerce invalid id into enabled terrain'],
  ['old_field', 'legacy', 'world.ts', '  return w;\n}', '  w.vegetation = { version: 1, cells: new Uint8Array(N * N) };\n  return w;\n}', 'legacy: createWorld never enables new terrain'],
  ['endpoint_block', 'los', 'vegetation.ts', 'for (let i = 1; i + 1 < cells.length; i++)', 'for (let i = 0; i < cells.length; i++)', 'los: same, adjacent and endpoint vegetation remain visible both ways'],
  ['middle_visible', 'los', 'step.ts', '    if (w.vegetation && vegetationBlocks(w, cells)) continue;', '', 'los: middle vegetation blocks symmetrically'],
  ['projectile_block', 'los', 'step.ts', 'const c = cells[i]; if (w.occ[c]', 'const c = cells[i]; if (w.vegetation?.cells[c]) return c; if (w.occ[c]', 'los: foliage never returns nonexistent building impact'],
  ['duplicate_ray', 'allocations', 'step.ts', '    const cells = lineCells(cellOf(u.x), cellOf(u.z), cellOf(x), cellOf(z), w.n);', '    const cells = lineCells(cellOf(u.x), cellOf(u.z), cellOf(x), cellOf(z), w.n); if (w.vegetation) lineCells(cellOf(u.x), cellOf(u.z), cellOf(x), cellOf(z), w.n);', 'allocations: enabled clear LOS reuses original single ray'],
  ['full_damage', 'cover', 'step.ts', 'vegetationAt(w, x, z) ? 50', 'vegetationAt(w, x, z) ? 100', 'cover: strongest vegetation/crater/garrison protection without stacking'],
  ['stack_cover', 'cover', 'step.ts', 'Math.min(ground, home.kind === BK_PILLBOX ? 25 : 50)', 'ground * (home.kind === BK_PILLBOX ? 25 : 50) / 100', 'cover: strongest vegetation/crater/garrison protection without stacking'],
  ['collapse_cover', 'cover', 'step.ts', '!allowGroundCover ? 100 :', 'false ? 100 :', 'cover: collapse bypasses all terrain protection'],
  ['early_round', 'rounding', 'step.ts', 'Math.floor((dmg * UNIT_KINDS[u.kind].armor * cover) / 10000)', 'Math.floor(Math.floor(dmg * cover / 100) * UNIT_KINDS[u.kind].armor / 100)', 'rounding: blast falloff then piercing then one armor/cover floor'],
  ['build_no_clear', 'construction', 'build.ts', '  clearVegetation(w, f.x, f.z, f.w, f.d);', '', 'construction: successful build clears every footprint cell'],
  ['hq_no_clear', 'construction', 'eco.ts', '    clearVegetation(w, b.x, b.z, b.w, b.d);', '', 'construction: HQ helper clears footprint'],
  ['shallow_preview', 'construction', 'build.ts', '  if (w.vegetation) s.vegetation = { version: w.vegetation.version, cells: w.vegetation.cells.slice() };', '', 'construction: enemyPlan trial copy never clears caller vegetation'],
  ['blind_spread', 'ranging_sound', 'step.ts', 'if (!spotted(w, u.side, aim.x, aim.z)) r *= 2;', 'if (!w.vegetation && !spotted(w, u.side, aim.x, aim.z)) r *= 2;', 'ranging_sound: foliage-hidden target doubles old blind-fire spread'],
  ['missing_hash', 'replay_hash', 'world.ts', 'for (const c of w.vegetation.cells) f.int(c);', '', 'replay_hash: version, cell values, size and presence are persistent hashed state'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name); mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/vegetation.mjs'), join(dir, 'tests/vegetation.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8'); assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`); writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/vegetation.mjs'), group], { encoding: 'utf8', timeout: 120000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`); assert.equal(r.signal, null, `${name}: no timeout/signal`); assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\n]+)/.exec(output)?.[1]; assert.equal(first, wanted, `${name}: first failure must be intended semantic assertion, got ${output.slice(-2000)}`);
    console.log(`OK vegetation-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`vegetation-negative: ${mutants.length} intended assertions rejected isolated mutants`);
