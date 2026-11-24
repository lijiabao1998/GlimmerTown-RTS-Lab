// R1010 故意弄壞（一）：模擬的規則。在 os.tmpdir() 的隔離副本裡改一處，只跑 tests/bridge1010.mjs 的那一群，第一個紅燈要落在指定的那一句。卡面驗收 18。
// 介面、存檔、畫面那幾處在 tests/bridge1010-negative2.mjs（CI 每支限 120 秒）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1010-negative-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const B = 'src/sim/bridge1010.ts', W = 'src/sim/world.ts', ST = 'src/sim/step.ts', E = 'src/sim/eco.ts';
const cases = [
  // 2.2 車過不了河
  ['ford_off', W, [['  if (w.br && (UNIT_KINDS[kind]?.radius ?? 0) > 0 && waterAt(w, x, z)) return true;', '  if (false) return true;']], 'ford', /^ford: kind 0 never steps on a water cell/],
  ['ford_foot', W, [['(UNIT_KINDS[kind]?.radius ?? 0) > 0 && waterAt(w, x, z)) return true;', 'waterAt(w, x, z)) return true;']], 'ford', /^ford: an infantry section still wades the canal/],
  ['push_in', ST, [['!blocks(w, cellOf(x), cellOf(z)) && (!w.br || dry1010(w, fx, fz, x, z));', '!blocks(w, cellOf(x), cellOf(z));']], 'ford', /^ford: (two tanks meeting on a one-cell bridge stay out of the water|corner)/],
  ['corner_leak', B, [['  return ax === bx || az === bz || (!waterAt(w, bx, az) && !waterAt(w, ax, bz));', '  return true;']], 'ford', /^ford: corner \(/],
  // 2.1 旗標
  ['flag_nosw', B, [["if (w.br || w.zombies || w.sandbox || w.eco?.sw !== 2) return;", "if (w.br || w.zombies || w.sandbox) return;"], [E, 'if (br && w.eco.sw === 2 && !w.zombies) start1010(w);', 'if (br && !w.zombies) start1010(w);']], 'flag', /^flag: br needs sw 2/],   // 兩處都拿掉才會紅（eco.ts、bridge1010.ts 各擋一次）
  ['flag_br2', ST, [['cmd.br === 1 ? 1 : 0); return; }', 'cmd.br ? 1 : 0); return; }']], 'flag', /^flag: only br 1 counts/],
  ['hash_br', W, [['  if (w.br) { const b = w.br; let wet = 0;', '  if (false) { const b = w.br!; let wet = 0;']], 'flag', /^flag: the hash tells a br world from the same world without/],
  // 1 節 哪裡是水
  ['rye_table', B, [['[[7, 9, 8, 31], [9, 7, 31, 8], [27, 9, 28, 20], [29, 19, 31, 20]]', '[[7, 9, 8, 31], [9, 7, 31, 8], [27, 9, 28, 20]]']], 'spans', /^spans: Rye mask is 122 cells/],
  ['ditch_wet', B, [['for (let x = 0; x < n; x++) if (isCanal(x, z)) wet[z * n + x] = 1;', 'for (let x = 0; x < n; x++) if (isCanal(x, z) || (w as World).ter?.[z * n + x] === TER_MUD) wet[z * n + x] = 1;']], 'spans', /^spans: the Hythe mask is isCanal/],
  // 2.3 炸橋
  ['charge_half', B, [['  s.hp = Math.max(0, s.hp - DEMO_BLD);', '  s.hp = Math.max(0, s.hp - (DEMO_BLD >> 1));']], 'blow', /^blow: one engineer beside a Rye bridge/],
  ['blow_far', B, [['return si < 0 ? undefined : near1010(w, u, w.br!.spans[si]);', 'return si < 0 ? undefined : true;'], ['  if (u.pathIdx < u.path.length || !near1010(w, u, s)) { if (u.cooldown < need)', '  if (u.pathIdx < u.path.length) { if (u.cooldown < need)']], 'blow', /^blow: from five cells off the engineer walks up first/],
  ['ter_kept', B, [['  for (const c of s.cells) w.ter[c] = TER_MUD;\n', '']], 'blow', /^blow: every cell of the broken bridge is mud again/],
  ['no_sink', B, [['hurt(t, UNIT_KINDS[t.kind].radius > 0 ? SINK1010 : FALL1010)', 'hurt(t, UNIT_KINDS[t.kind].radius > 0 ? 0 : FALL1010)']], 'blow', /^blow: the tank on the bridge sinks/],
  ['no_repath', B, [['crosses = s.cells.includes(t.path[i]);', 'crosses = false;']], 'blow', /^blow: the tank that meant to cross has a new way at the end of the breaking step/],
  // 2.4 最後一座
  ['last_order', B, [["  if (s.state !== 1) return cuts1010(w, si) ? '這是兩邊之間最後一座車過得去的橋，不能炸' : '';", "  if (s.state !== 1) return '';"]], 'last', /^last: with bridge 2 down, the order on bridge 0 is not taken/],
  ['last_charge', B, [['  if (s.hp <= DEMO_BLD && cuts1010(w, si)) {', '  if (false && cuts1010(w, si)) {']], 'last', /^last: blowing 0 and 2 together/],
  // 2.5 修橋
  ['repair_free', B, [['{ w.eco!.supply[u.side] -= COST1010 * s.cells.length; s.left', '{ s.left']], 'repair', /^repair: map 1: one order with two engineers pays 10 once/],
  ['repair_each', B, [['  if (s.state === 1 && !s.left) { w.eco!', '  if (s.state === 1) { w.eco!']], 'repair', /^repair: map 1: one order with two engineers pays 10 once/],
  ['repair_short', B, [['return !s.left && w.eco.supply[side] < cost ?', 'return false && w.eco.supply[side] < cost ?']], 'repair', /^repair: short of supply the order is not taken/],
  ['no_reset', B, [['  s.state = 2; s.hp = WOOD1010 * s.cells.length; s.left = 0;\n  stop1010(w, si);\n', '  s.state = 2; s.hp = WOOD1010 * s.cells.length; s.left = 0;\n']], 'repair', /^repair: a timber bridge with 10 per cell; the engineer stands down/],
  ['repair_x2', B, [['    s.left--;\n', '    s.left = Math.max(0, s.left - 2);\n']], 'repair', /^repair: the work is set \(and both already did one step of it\)/],   // 兩個工兵第一步就各做了一步：做兩倍，這一句先紅
  ['other_pays', B, [['w.eco!.supply[u.side] -= COST1010', 'w.eco!.supply[1 - u.side] -= COST1010']], 'repair', /^repair: map 1: one order with two engineers pays 10 once/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/bridge1010.mjs'), path.join(temp, 'tests/bridge1010.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const originals = new Map();   // 一處弄壞可以改到兩個檔：edit 是 [從, 改成] 或 [檔, 從, 改成]
    for (const edit of edits) {
      const [f, from, to] = edit.length === 3 ? edit : [file, ...edit], target = path.join(temp, f);
      if (!originals.has(target)) originals.set(target, fs.readFileSync(target, 'utf8'));
      const now = fs.readFileSync(target, 'utf8');
      assert.equal(now.split(from).length - 1, 1, `unique ${name} anchor: ${from}`);
      fs.writeFileSync(target, now.replace(from, to));
    }
    const r = spawnSync(process.execPath, ['tests/bridge1010.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 100000 });
    for (const [target, text] of originals) fs.writeFileSync(target, text);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED bridge1010/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`bridge1010: ${cases.length} negative controls OK`);
