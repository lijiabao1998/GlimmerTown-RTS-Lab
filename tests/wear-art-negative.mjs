// R088 建築破壞的過程：故意弄壞。每一處在隔離副本裡改一行，跑 tests/wear-art.mjs 的指定群組，確認第一個紅燈落在指定的斷言上（逾時、語法錯不算）。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r088-negative-'));
const A = 'src/render/wearArt.ts', Bd = 'src/render/buildings.ts', S = 'src/render/wear88.ts';
const mutants = [
  ['float_tier', 'tiers', A, '  return lost * 100 < b.maxHp * 5 ? 0 :', '  return lost * 100 < b.maxHp * 5 ? lost / b.maxHp :', 'tiers: the tier table is 5 / 14 / 22 %'],
  ['random_tier', 'tiers', A, '  if (b.hp <= 0) return WEAR_RUBBLE;', '  if (b.hp <= 0) return WEAR_RUBBLE + 0 * Math.random();', 'tiers: wearArt.ts uses no randomness'],
  ['overlays_at_t0', 't0', Bd, '  const wt = wearOn && allowDamage && wearable(b) ? tier ?? wearTier(b) : 0;', '  const wt = wearOn && allowDamage && wearable(b) ? tier ?? Math.max(1, wearTier(b)) : 0;', 't0: a town at full health draws byte for byte the same'],
  ['hole_off_wall', 'geometry', A, '  patch(g, f, uc - hw, uc + hw, yc - hh, yc + hh, HOLE_OFF, CAVITY);', '  patch(g, f, uc - hw, uc + hw, yc - hh, yc + hh, HOLE_OFF + 0.03, CAVITY);', 'geometry: a hole sits on its wall'],
  ['hidden_face', 'geometry', A, "  g.quad(p(u0, y0), p(u1, y0), p(u1, y1), p(u0, y1), f.axis === 0 ? [1, 0, 0] : [0, 0, 1], c);", "  g.quad(p(u0, y0), p(u1, y0), p(u1, y1), p(u0, y1), f.axis === 0 ? [-1, 0, 0] : [0, 0, -1], c);", 'geometry: no hole on a face the camera never sees'],
  ['stale_key', 'cache', Bd, '${wearable(b) ? wearTier(b) : 0},${lod}`;', '${lod}`;', 'cache: the cached town equals the uncached one'],
  ['flags_ignored', 'cache', Bd, '  const flags = moduleSig(), parts', "  const flags = '', parts", 'cache: the cached town equals the uncached one (house art switched off'],
  ['ghost_current_tier', 'ghosts', S, '  const tier = wearShown(w, b), geo = buildingGeo(new Geo(), b, from, tier)', '  const tier = wearTier(b), geo = buildingGeo(new Geo(), b, from, tier)', 'ghosts:'],
  ['geometry_from_history', 'geometry', Bd, '  const wt = wearOn && allowDamage && wearable(b) ? tier ?? wearTier(b) : 0;', '  const wt = wearOn && allowDamage && wearable(b) ? tier ?? (((globalThis as unknown as { s88: Record<number, number> }).s88 ??= {})[b.id] ??= wearTier(b)) : 0;', 'geometry:'],
  ['marks_kept', 'marks', S, '    if (t1 === 3 || t1 === 5) marks.dropAbove(b.id, (x, z) => wearTop(b, t1, x, z, h, rise));\n', '', 'marks: no shell mark stays above the lowered wall top'],
  ['rng_in_sync', 'pure', S, '  let dirty = false;\n', '  let dirty = false; w.rng = (w.rng + 1) >>> 0;\n', 'pure: drawing and syncing leave the world'],
  ['valve_ignored', 'valve', Bd, 'export function setWearArt(on: boolean): void { wearOn = on; }', 'export function setWearArt(on: boolean): void { wearOn = on || true; }', 'valve: with ?noR088=1 every damaged building is drawn as before R088'],
  ['roof_current_tier', 'ghosts', S, '  const tier = wearShown(w, b), h = wallHeight(b), geo = buildingGeo(new Geo(), b, STAGE_INTACT, tier)', '  const tier = wearTier(b), h = wallHeight(b), geo = buildingGeo(new Geo(), b, STAGE_INTACT, tier)', 'ghosts: the falling roof is the roof of the shown tier'],
  ['lean_inward', 'ghosts', S, 'l > 0.05 ? (dx / l) * 0.35 :', 'l > 0.05 ? (-dx / l) * 0.35 :', 'ghosts: each half leans outward'],
  ['town_not_redrawn', 'ghosts', 'src/render/battle.ts', 'visibleAt(x * SUB, z * SUB))) townDirty = true;', 'visibleAt(x * SUB, z * SUB))) void 0;', 'ghosts: the view redraws the town when a tier changes'],
  ['no_split', 'ghosts', A, '    const to = (tier >= 4 ? onFallenHalf(b, cx, cz) : cy > 0.5 * h) ? first : second;', '    const to = (tier >= 4 ? onFallenHalf(b, cx, cz) : false) ? first : second;', 'ghosts: a collapse falls in two parts'],
  ['lower_first', 'ghosts', A, '    const to = (tier >= 4 ? onFallenHalf(b, cx, cz) : cy > 0.5 * h) ? first : second;', '    const to = (tier >= 4 ? onFallenHalf(b, cx, cz) : cy <= 0.5 * h) ? first : second;', 'ghosts: the first part to fall is the upper part'],
  ['no_half_collapse', 'geometry', A, '    move(base, (x, y, z) => (onFallenHalf(b, x, z) ? halfY(y, h) : y));', '    move(base, (x, y, z) => y);', 'geometry: the T5 shell visibly comes down'],
  ['marks_unclamped', 'marks', 'src/render/wallMarks.ts', '      if (H.y[i] + H.h[i] * scale / 2 > top88) {', '      if (false) {', 'marks: no shell mark stays above the lowered wall top'],
  ['roof_fall_flat_cut', 'ghosts', 'src/render/wearArt.ts', '  for (let i = 0; i < ref.pos.length; i += 9) if (Math.max(ref.pos[i + 1], ref.pos[i + 4], ref.pos[i + 7]) > h + 1e-4)', '  for (let i = 0; i < ref.pos.length; i += 9) if (Math.min(geo.pos[i + 1], geo.pos[i + 4], geo.pos[i + 7]) >= h - 1e-4)', 'ghosts: the falling roof is the roof of the shown tier'],
  ['effects_in_fog', 'effects', 'src/render/wear88.ts', '    if (!seen(cx, cz)) continue;\n', '', 'effects: a tier change the player cannot see spawns nothing'],
  ['door_not_blocking', 'geometry', A, ' || (m[2] <= 0.03 && m[3] >= 0.2 && m[1] - m[0] >= 0.1 && m[1] - m[0] < 0.6 && m[0] > lo + 0.06 && m[1] < hi - 0.06))', ')', 'geometry: a hole never covers a door'],
  ['window_not_blocking', 'geometry', A, '  const blocked = mounted.filter(m => glass.some(g => inside(m, g)) ||', '  const blocked = mounted.filter(m => false ||', 'geometry: a hole never covers a window'],
  ['hole_back_on_wall', 'geometry', A, 'export const HOLE_OFF = 0.035;', 'export const HOLE_OFF = 0.02;', 'geometry: a hole sits on its wall'],
  ['everything_blocks', 'coverage', A, '  const blocked = mounted.filter(m => glass.some(g => inside(m, g)) ||', '  const blocked = mounted.filter(m => true ||', 'coverage: at T2 at least 80 %'],
  ['sag_up', 'geometry', A, '      move(base, (x, y, z) => y - sagDrop(b, x, y, z, h, rise),', '      move(base, (x, y, z) => y + sagDrop(b, x, y, z, h, rise),', 'geometry: the T3 sag never moves a vertex up'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/wear-art.mjs'), join(dir, 'tests/wear-art.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/wear-art.mjs'), group], { encoding: 'utf8', timeout: 110000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK wear-art-negative/${name}: ${first.slice(0, 140)}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`wear-art-negative: ${mutants.length} isolated mutants rejected`);
