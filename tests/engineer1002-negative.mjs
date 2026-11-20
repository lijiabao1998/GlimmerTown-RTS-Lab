// R1002 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑 tests/engineer1002.mjs 的那一群）。卡面驗收 21。
// 分兩支（每支 CI 限 120 秒）：這一支是旗標、爆破、鐵絲網；火焰噴射器、存檔、介面在 engineer1002-negative2.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1002-negative-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', EN = 'src/sim/engineer1002.ts', S91 = 'src/sim/support91.ts';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言]
const cases = [
  // 2.1 旗標與生產
  ['gate_removed', E, [['  if ((kind === UK_ENGINEER || kind === UK_FLAME) && (e?.sw !== 2 || w.zombies)) return;', '']], 'flag', /^flag: kind 47 cannot be produced with sw 1/],
  ['zombie_gate', E, [['(e?.sw !== 2 || w.zombies)) return;   // R1002', 'e?.sw !== 2) return;   // R1002']], 'flag', /^flag: zombie defence does not offer kind 47/],
  ['sw2_dropped', ST, [['cmd.sw === 2 ? 2 : cmd.sw === 1 ? 1 : 0', 'cmd.sw === 1 ? 1 : 0']], 'flag', /^flag: the eco command stores sw 1 or 2/],
  ['eco_store', E, [['w.eco.sw = sw === 2 ? 2 : 1;', 'w.eco.sw = 1;']], 'flag', /^flag: the eco command stores sw 1 or 2/],
  ['block_reason', 'src/ui/productionBlockReason.ts', [['|| closed91 || closed1002 ||', '|| closed91 ||']], 'flag', /^flag: kind 47 says 本局未開放此單位 with sw 1/],
  // 2.2 爆破
  ['walks_by_range', ST, [['(UNIT_KINDS[u.kind].demo ? reach1002(w, u) : inRange(', '(false ? reach1002(w, u) : inRange(']], 'demowalk', /^demowalk: from inside rifle range/],
  ['pillbox_quartered', EN, [['  else hurt(w, t.b, DEMO_BLD);', '  else hurt(w, t.b, t.b.kind === 6 ? DEMO_BLD >> 2 : DEMO_BLD);']], 'demo', /^demo: a charge every 120 steps/],
  ['no_wait_walking', EN, [['{ if (u.cooldown < need) u.cooldown = need; return; }', '{ return; }']], 'demo', /^demo: a charge every 120 steps/],
  ['no_wait_order', EN, [['u.target = 0; u.cooldown = Math.max(u.cooldown, UNIT_KINDS[u.kind].demo ?? 0);', 'u.target = 0;']], 'demoslow', /^demoslow: already beside it, the first charge still takes 120 steps/],
  ['charge_before_morale', ST, [['  if (k.demo && u.order === ORD_FIRE_AT) { demo1002(w, u, damageBld); return; }', ''], ['  if (w.rules?.morale && !canFire(u)) {', '  if (k.demo && u.order === ORD_FIRE_AT) { demo1002(w, u, damageBld); return; }\n  if (w.rules?.morale && !canFire(u)) {']], 'demoslow', /^demoslow: a broken engineer places nothing/],
  ['never_gives_up', ST, [['    else if (u.order === ORD_FIRE_AT && !fireReach(w, u)) u.order = ORD_IDLE;', '    else if (u.order === ORD_FIRE_AT && !fireReach(w, u) && !UNIT_KINDS[u.kind].demo) u.order = ORD_IDLE;']], 'demowalk', /^demowalk: a pillbox walled in by houses cannot be reached/],
  ['ground_taken', EN, [['  const t = demoTarget(w, gx, gz);\n  if (!t) return;', '  const t = demoTarget(w, gx, gz) ?? { b: { x: gx, z: gz, w: 1, d: 1 }, wire: false };']], 'demowalk', /^demowalk: open ground is not a target/],
  // 2.3 鐵絲網
  ['foot_list', W, [['  if ((kind === UK_ENGINEER || kind === UK_FLAME) && (w.eco?.sw ?? 0) >= 2) return (wireAt(w, x, z)?.hp ?? 0) > 0;', '']], 'wire', /^wire: an intact wire cell stops kind 47 with sw 2/],
  ['wire_not_target', EN, [['  return r && r.hp > 0 ? { b: r, wire: true } : null;', '  return null;']], 'wire', /^wire: the engineer walks up to the wire/],
  ['wire_not_cut', EN, [['if (t.wire) { t.b.hp = 0;', 'if (t.wire) { t.b.hp -= 0;']], 'wire', /^wire: 120 steps after it arrives the whole 1×2 section is cut/],
  ['others_cut', ST, [['    if (UNIT_KINDS[u.kind].demo) { fireAt1002(', '    if (UNIT_KINDS[u.kind].range > 0) { fireAt1002(']], 'wire', /^wire: kind 0 does not take a fire order on wire/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/engineer1002.mjs'), path.join(temp, 'tests/engineer1002.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, ['tests/engineer1002.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED engineer1002/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r1002-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`engineer1002: ${cases.length} negative controls OK`);
