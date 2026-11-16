// R084 左右對稱：map 指令的 sym＝1（新開的局）。舊的不動、旗標、編隊、尋路平手、指揮部／出生格／集結點都照鏡像。
// 用法：node tests/symmetry.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/symmetry.mjs <群組名>   只跑那一群（隔離副本裡用）
// 新開的局真的送 sym（真實 Chrome）在 tests/symmetry-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, cellIdx, cellOf, inGrid, blocks, SIDE_PLAYER, SIDE_ENEMY, UK_INFANTRY, UK_MG, UK_TANK } from '../src/sim/world.ts';
import { step, formationAt, applyCommand } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { duel } from '../tools/duel.mjs';

const ME = SIDE_PLAYER, FOE = SIDE_ENEMY, HILLS = 4;
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1, mg: 2 };
const opened = (sym, map = HILLS, extra = []) => { const w = createWorld(1944); step(w, [{ t: 'map', id: map, vegetation: 1, ...(sym ? { sym: 1 } : {}) }, ...extra]); return w; };
const mirror = (w, i) => w.n * w.n - 1 - i;

const groups = {
  // 舊的不動：黃金雜湊、R081 的四局 mg 1（沒帶 sym 的紀錄）
  old() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'old: the golden script battle is unchanged');
    const mg1 = [];
    for (const map of [0, 1]) for (const rules of [null, { ap: 1, morale: 2 }]) mg1.push(duel({ map, seed: 31 + map, ticks: 3000, rules, end: true, mg: 1, a: { level: 3, v: 3 }, b: { level: 3, v: 3 } }).hash);
    assert.deepEqual(mg1, ['6fc5f4f9', '0f1f8288', '97ce2f1b', 'e3ce0be3'], 'old: battles without the flag are bit for bit what they were');
  },
  // 旗標：第 0 步的 map 帶 sym＝1 才有；之後的不理；折進雜湊；指令檢查收 1、不收字
  flag() {
    assert.equal(opened(true).sym, 1, 'flag: a map command with sym 1 at step 0 sets it');
    assert.equal(opened(false).sym, undefined, 'fixture: without it there is no flag');
    const late = opened(false); step(late, [{ t: 'map', id: HILLS, sym: 1 }]);
    assert.equal(late.sym, undefined, 'flag: a later map command does not set it');
    { const two = createWorld(1944); step(two, [{ t: 'map', id: HILLS }, { t: 'map', id: HILLS, sym: 1 }]);
      assert.equal(two.sym, undefined, 'flag: only the first map command at step 0 counts'); }   // 審查 R084-guard-first-map-only
    assert.notEqual(hashWorld(opened(true)), hashWorld(opened(false)), 'flag: the flag is in the hash');
    assert.deepEqual([isCommand({ t: 'map', id: 0, sym: 1 }), isCommand({ t: 'map', id: 0, sym: 'x' })], [true, false], 'flag: the command check takes 1 and refuses text');
  },
  // 編隊：左上那一方的偏移是右下那一方的負號；沒有旗標時兩邊一樣
  formation() {
    const on = opened(true), off = opened(false);
    for (let k = 0; k < 9; k++) {
      const [ax, az] = formationAt(on, ME, k), [bx, bz] = formationAt(on, FOE, k);
      assert.deepEqual([bx, bz], [-ax || 0, -az || 0].map(v => v + 0), `formation: unit ${k} of the top-left side gets the mirrored offset`);
      assert.deepEqual(formationAt(off, FOE, k), formationAt(off, ME, k), 'fixture: without the flag both sides use the same table');
    }
    // 真的下指令（審查 R084-guard-formation-wiring）：雙方全選、往互為鏡像的目標走，第 k 台的目的地與路都是鏡像
    let pairs = 0;
    for (const [gx, gz] of [[10, 12], [16, 16], [20, 9], [12, 22], [5, 26], [26, 5], [15, 18]]) {
      const w = opened(true, HILLS, [ECO]), n = w.n;
      const a = w.units.filter(u => u.alive && u.side === ME), b = w.units.filter(u => u.alive && u.side === FOE);
      applyCommand(w, { t: 'move', side: ME, ids: a.map(u => u.id), x: gx, z: gz });
      applyCommand(w, { t: 'move', side: FOE, ids: b.map(u => u.id), x: n - 1 - gx, z: n - 1 - gz });
      assert.equal(a.length, b.length, 'fixture: both sides have the same units');
      for (let k = 0; k < a.length; k++) {
        const p = a[k], q = b[k];
        assert(p.kind === q.kind && cellOf(q.x) === n - 1 - cellOf(p.x) && cellOf(q.z) === n - 1 - cellOf(p.z), 'fixture: the k-th units of both sides stand on mirrored cells');
        assert(q.tx === n - 1 - p.tx && q.tz === n - 1 - p.tz, `formation: a multi-select move sends the k-th unit of each side to mirrored cells (goal ${gx},${gz}, unit ${k})`);
        assert.equal(JSON.stringify(q.path), JSON.stringify(p.path.map(c => mirror(w, c))), `formation: and along mirrored paths (goal ${gx},${gz}, unit ${k})`);
        pairs++;
      }
    }
    assert(pairs >= 40, `fixture: enough unit pairs (${pairs})`);
  },
  // 尋路：在點對稱的丘陵上，從 A 的鏡像到 B 的鏡像的路＝A 到 B 那條路的鏡像
  path() {
    const pairs = [];
    const free = w => { const out = []; for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) if (!blocks(w, x, z)) out.push([x, z]); return out; };
    const count = sym => {
      const w = opened(sym), cells = free(w), n = w.n;
      let same = 0, differ = 0;
      for (let i = 0; i < 400; i++) {
        const a = cells[(i * 7919) % cells.length], b = cells[(i * 104729 + 13) % cells.length];
        const p = findPath(w, a[0], a[1], b[0], b[1], 0, 0, UK_TANK), q = findPath(w, n - 1 - a[0], n - 1 - a[1], n - 1 - b[0], n - 1 - b[1], 0, 0, UK_TANK);
        if (JSON.stringify(p.map(c => mirror(w, c))) === JSON.stringify(q)) same++; else differ++;
        if (sym && pairs.length < 1 && differ) pairs.push([a, b]);
      }
      return { same, differ };
    };
    const off = count(false), on = count(true);
    assert(off.differ > 0, `fixture: without the flag some paths are not the mirror of their mirror (${off.differ} of 400)`);
    assert.equal(on.differ, 0, `path: with the flag every path from the mirrored start to the mirrored goal is the mirror (${on.same} of 400; first odd pair ${JSON.stringify(pairs[0] ?? null)})`);
    // 中央四格點對稱的障礙：終點附近一對鏡像格 f、h 都一樣（審查 R084-astar-orbit-tie）；終點走不到時停的那一格也要是鏡像
    for (const extra of [[], [[15, 16], [16, 15]]]) {
      const w = opened(true), n = w.n;
      for (const [x, z] of [[14, 16], [17, 15], [15, 17], [16, 14], ...extra]) { const id = w.blds.length + 1; w.blds.push({ id, kind: 1, x, z, w: 1, d: 1, floors: 1, hp: 100, maxHp: 100 }); w.occ[cellIdx(w, x, z)] = id; }
      let asym = 0; for (let i = 0; i < n * n; i++) if (!!w.occ[i] !== !!w.occ[mirror(w, i)] || w.ter[i] !== w.ter[mirror(w, i)]) asym++;
      assert.equal(asym, 0, 'fixture: the centre blocks are point-symmetric');
      let same = 0, odd = null;
      for (let sz = 0; sz < n; sz += 2) for (let sx = 0; sx < n; sx += 2) { if (blocks(w, sx, sz)) continue;
        for (let gz = 13; gz < 19; gz++) for (let gx = 13; gx < 19; gx++) {
          const p = findPath(w, sx, sz, gx, gz, 0, 0, UK_TANK), q = findPath(w, n - 1 - sx, n - 1 - sz, n - 1 - gx, n - 1 - gz, 0, 0, UK_TANK);
          if (JSON.stringify(p.map(c => mirror(w, c))) === JSON.stringify(q)) same++; else odd ??= [sx, sz, gx, gz];
        } }
      assert.equal(odd, null, `path: with point-symmetric blocks at the centre every path is still the mirror (${same} mirrored; first odd ${JSON.stringify(odd)}; extra ${extra.length})`);
    }
  },
  // 指揮部、第一班步兵與機槍組的出生格與集結點：左上那一方是右下那一方的鏡像
  eco() {
    const check = sym => {
      const w = opened(sym, HILLS, [ECO]), n = w.n, [h0, h1] = w.eco.hq.map(id => w.blds[id - 1]);
      const pair = kind => [ME, FOE].map(s => w.units.find(u => u.side === s && u.kind === kind));
      const out = { hq: h1.x === n - 2 - h0.x && h1.z === n - 2 - h0.z, spawn: true, rally: true };
      for (const kind of [UK_INFANTRY, UK_MG]) {
        const [a, b] = pair(kind);
        if (cellOf(b.x) !== n - 1 - cellOf(a.x) || cellOf(b.z) !== n - 1 - cellOf(a.z)) out.spawn = false;
        if (b.tx !== n - 1 - a.tx || b.tz !== n - 1 - a.tz) out.rally = false;
      }
      return out;
    };
    const off = check(false), on = check(true);
    assert(!(off.spawn && off.rally), `fixture: without the flag the spawns or rally points are not mirrored (${JSON.stringify(off)})`);
    assert(on.hq, 'eco: with the flag the top-left headquarters is the mirror of the bottom-right one');
    assert(on.spawn, 'eco: the first infantry squad and machine-gun team spawn on mirrored cells');
    assert(on.rally, 'eco: and walk to mirrored rally points');
    // 指揮部平手：兩個角落各蓋一棟小屋（互為鏡像），最近的位置放不下，一樣遠的候選要照鏡像挑
    { const w = createWorld(1944); step(w, [{ t: 'map', id: HILLS, vegetation: 1, sym: 1 }, { t: 'build', side: ME, kind: 1, x: 31, z: 31 }, { t: 'build', side: FOE, kind: 1, x: 0, z: 0 }, ECO]);
      const [a, b] = w.eco.hq.map(id => w.blds[id - 1]);
      assert.equal(w.blds.filter(q => q.kind === 1 && q.builtBy !== undefined).length, 2, 'fixture: both corner cottages were built');
      assert(b.x === w.n - 2 - a.x && b.z === w.n - 2 - a.z, `eco: with the corners taken the two headquarters still go to mirrored spots (${a.x},${a.z} and ${b.x},${b.z})`); }
  },
  // 接線：新開的局送 sym（閥關掉不送）
  wiring() {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    assert.match(main, /issue\(\{ t: 'map', id: mapId, \.\.\.\(vegetation \? \{ vegetation: 1 \} : \{\}\), \.\.\.\(V\.r084 \? \{ sym: 1 \} : \{\}\) \}\);/, 'wiring: a new battle sends sym 1 unless ?noR084=1');
    assert.match(readFileSync(new URL('../src/valves.ts', import.meta.url), 'utf8'), /get r084\(\) \{ return on\('084'\); \}/, 'wiring: the valve is on the table');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`symmetry/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK symmetry/${name}`); }

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r084-negative-'));
const mutants = [
  ['any_tick', 'flag', 'src/sim/step.ts', "if (c.sym === 1 && w.tick === 0) w.sym = 1;", "if (c.sym === 1) w.sym = 1;", 'flag: a later map command does not set it'],
  ['not_hashed', 'flag', 'src/sim/world.ts', '  if (w.sym) f.int(0x5359).int(w.sym);   // R084 只在有時折\n', '', 'flag: the flag is in the hash'],
  ['unchecked', 'flag', 'src/sim/commandCheck.ts', ' && optInt(c.sym);', ';', 'flag: the command check takes 1 and refuses text'],
  ['same_table', 'formation', 'src/sim/step.ts', '  return w.sym && side === SIDE_ENEMY ? [0 - ox, 0 - oz] : [ox, oz];', '  return [ox, oz];', 'formation: unit'],
  ['later_map', 'flag', 'src/sim/step.ts', 'w.sym = 1; break; }', 'w.sym = 1; }', 'flag: only the first map command'],
  ['call_site', 'formation', 'src/sim/step.ts', 'formationAt(w, u.side, k);', 'FORMATION[k % FORMATION.length];', 'formation: a multi-select move'],
  ['orient', 'path', 'src/sim/path.ts', 'fl = goal > K - 1 - goal ? 1 : 0;', 'fl = 0;', 'path: with point-symmetric blocks'],
  ['index_ties', 'path', 'src/sim/path.ts', 'enc = (i: number) => (w.sym ? 2 * Math.min(i, K - 1 - i) + ((i > K - 1 - i ? 1 : 0) ^ fl) : i)', 'enc = (i: number) => (w.sym ? 2 * i : i)', 'path: with the flag every path'],
  ['hq_ties', 'eco', 'src/sim/eco.ts', '  const m = w.sym && side === SIDE_ENEMY ? -1 : 1;', '  const m = 1;', 'eco: with the corners taken the two headquarters'],
  ['spawn_ties', 'eco', 'src/sim/eco.ts', ' || (w.sym && d === bd && hq.builtBy === SIDE_ENEMY)) { best', ') { best', 'eco: the first infantry squad'],
  ['rally_column', 'eco', 'src/sim/eco.ts', '  const mir = !!w.sym && hq.builtBy === SIDE_ENEMY;', '  const mir = false;', 'eco: and walk to mirrored rally points'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'tools'), { recursive: true });
    for (const d of ['src/sim']) cpSync(join(root, d), join(dir, d), { recursive: true });
    cpSync(join(root, 'tools/duel.mjs'), join(dir, 'tools/duel.mjs'));
    cpSync(join(root, 'tests/symmetry.mjs'), join(dir, 'tests/symmetry.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/symmetry.mjs'), group], { encoding: 'utf8', timeout: 120000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK symmetry-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`symmetry: all groups OK, ${mutants.length} isolated mutants rejected`);
