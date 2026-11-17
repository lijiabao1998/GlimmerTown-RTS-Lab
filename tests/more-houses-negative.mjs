// R087 更多房屋（模擬）：故意弄壞。每一處在隔離副本裡改一行，跑 tests/more-houses.mjs 的指定群組，確認第一個紅燈落在指定的斷言上。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r087-negative-'));
const mutants = [
  ['world_rng', 'rng', 'src/sim/moreHouses.ts', 'const rng: RngState = { rng: (w.seed ^ MORE_SEED) >>> 0 }', 'const rng: RngState = w', 'rng: the pass draws nothing from World.rng'],
  ['ignores_flag', 'flag', 'src/sim/step.ts', "if (c.more === 1 && w.tick === 0) applyMoreHouses(w); break; }", "applyMoreHouses(w); break; }", 'fixture: without it there is no flag'],
  ['any_tick', 'flag', 'src/sim/moreHouses.ts', '  if (w.more || w.tick !== 0 || w.sandbox) return;', '  if (w.more || w.sandbox) return;', 'flag: the pass itself refuses a world past step 0'],
  ['after_sym', 'page', 'src/sim/step.ts', "  for (const c of cmds) if (c.t === 'map') { if (c.more === 1 && w.tick === 0) applyMoreHouses(w); break; }", "  for (const c of cmds) if (c.t === 'rules') { if (w.tick === 0) for (const m of cmds) if (m.t === 'map' && m.more === 1) applyMoreHouses(w); break; }", 'page: the opening on the page equals the replay'],
  ['not_sent', 'page', 'src/main.ts', "cmd = { ...cmd, more: 1 };", 'cmd = { ...cmd };', 'page: a new battle sends more 1 exactly when R087 is on'],
  ['page_skips', 'page', 'src/ui/skirmish.ts', '      if (!w.sandbox && w.tick === 0 && valves(q).r087) applyMoreHouses(w);', '', 'page: a new battle sends more 1 exactly when R087 is on'],
  ['not_hashed', 'flag', 'src/sim/world.ts', '  if (w.more) f.int(0x4d48).int(w.more);   // R087 只在有時折\n', '', 'flag: the flag itself (not only the houses) is in the hash'],
  ['codec_drops', 'flag', 'src/sim/worldCodec.ts', '  if (r.more !== undefined && r.more !== 1) return null;', '  delete r.more;', 'flag: the world codec round-trips a world with more'],
  ['on_vegetation', 'rules', 'src/sim/moreHouses.ts', ' || w.vegetation?.cells[i] || (x < c', ' || (x < c', 'rules: a new house follows every placement rule'],
  ['in_corner', 'rules', 'src/sim/moreHouses.ts', ' || (x < c && z < c) || (x >= n - c && z >= n - c) ? 1 : 0;', ' ? 1 : 0;', 'rules: a new house follows every placement rule'],
  ['no_twin', 'counts', 'src/sim/moreHouses.ts', '    if (moreKindFits(w, s, px, pz, bw, bd, moreGrids(w, ground))) { put(w, s, px, pz, bw, bd); return true; }', '    return true;', 'counts:'],
  ['oast_far', 'rules', 'src/sim/moreHouses.ts', '  if (s.kind === BK_OAST) return inBox === 0 && on(g.farm);', '  if (s.kind === BK_OAST) return inBox === 0;', 'rules: a new house follows every placement rule'],
  ['mill_near_church', 'rules', 'src/sim/moreHouses.ts', '  if (s.kind === BK_MILL) return ground === any && !on(g.tall);', '  if (s.kind === BK_MILL) return ground === any;', 'rules: a new house follows every placement rule'],
  ['units_ignored', 'rules', 'src/sim/moreHouses.ts', '    const ringBad = w.occ[i] || near[i] ? 1 : 0;', '    const ringBad = w.occ[i] ? 1 : 0;', 'rules: a new house follows every placement rule'],
  ['wood_oast', 'props', 'src/sim/world.ts', '  if (kind === BK_MILL || kind === BK_WAREHOUSE) return BM_WOOD;', '  if (kind === BK_MILL || kind === BK_WAREHOUSE || kind === BK_OAST) return BM_WOOD;', 'props: the oast is brick'],
  ['strand_moved', 'rng', 'src/sim/moreHouses.ts', '      b.kind = BK_WAREHOUSE; b.floors = 3;', '      b.kind = BK_WAREHOUSE; b.floors = 3; b.x += 0;  b.w = 1; b.d = 1;', 'rng: the three Strand barns become 3-storey warehouses in place'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    for (const d of ['src', 'tests', 'tools']) mkdirSync(join(dir, d), { recursive: true });
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
    cpSync(join(root, 'tests/more-houses.mjs'), join(dir, 'tests/more-houses.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/more-houses.mjs'), group], { encoding: 'utf8', timeout: 300000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK more-houses-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`more-houses-negative: ${mutants.length} isolated mutants rejected`);
