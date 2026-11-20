// R093 在獨立副本故意弄壞每一處；每一處都要先紅在指定的那一句（只跑那一支、那一群）。卡面驗收 37。
// 副本連 index.html 一起複製（R030 的教訓）。每個錨點在原始碼裡只能出現一次。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r093-negative-'));
const W = 'src/sim/world.ts', E = 'src/sim/eco.ts', ST = 'src/sim/step.ts', A = 'src/sim/air93.ts', CC = 'src/sim/commandCheck.ts', U = 'src/ui/air93.ts', M = 'src/main.ts';
const AIR = 'tests/air93.mjs', QUIET = 'tests/air93-quiet.mjs', T92 = 'tests/transport92.mjs';
// [名字, 檔案, [[原文, 改成], …], [守衛, 群], 第一個紅的斷言（或當掉的訊息）]
const cases = [
  ['air_unhashed', W, [[' if (e.air) f.int(0x4152).int(e.air);', '']], [AIR, 'flag'], /^flag: air is folded into the hash/],
  ['air_value_unhashed', W, [[' if (e.air) f.int(0x4152).int(e.air);', ' if (e.air) f.int(0x4152).int(1);']], [AIR, 'flag'], /^flag: the fold carries the value/],
  ['check_open', CC, [[' && optInt(c.air)', '']], [AIR, 'flag'], /^flag: the command check refuses air "x"/],
  ['flag_dropped', E, [['  if (air) w.eco.air = 1;', '']], [AIR, 'flag'], /^flag: air is stored only when the eco command sends 1/],
  ['cmd_dropped', CC, [["    case 'air': return side(c.side) && int(c.kind) && int(c.x) && int(c.z);   // R093\n", '']], [AIR, 'command'], /^command: the command check takes an integer air command/],
  ['sky_unhashed', W, [['  if (w.sky) { const a = w.sky; f.int(0x4149)', '  if (false) { const a = w.sky; f.int(0x4149)']], [AIR, 'flag'], /^flag: changing sky version changes the hash/],
  ['plane_hp_unhashed', W, [['.int(p.t).int(p.T).int(p.hp); }', '.int(p.t).int(p.T); }']], [AIR, 'flag'], /^flag: changing sky plane hp changes the hash/],
  ['codec_open', 'src/sim/worldCodec.ts', [['  if (!airOk(r)) return null;', '']], [AIR, 'save'], /^save: refused — air 2/],
  ['codec_loose', A, [['!PLANE_KEYS.every(k => Number.isInteger(p[k]))', '!PLANE_KEYS.every(k => p[k] !== undefined)']], [AIR, 'save'], /^save: refused — x 1\.5/],
  ['codec_flagless', A, [['if (sky !== undefined || units.some(u => u.kind === 46)) return false;', 'if (sky !== undefined) return false;']], [AIR, 'save'], /^save: refused — kind 46 without air/],
  ['produce_open', E, [['  if (kind === UK_AA && (!e?.air || w.zombies)) return;', '']], [AIR, 'flag'], /^flag: without air kind 46 cannot be produced/],
  ['zombie_produce', E, [['(!e?.air || w.zombies)) return;   // R093', '!e?.air) return;   // R093']], [AIR, 'produce'], /^produce: zombie defence cannot produce kind 46 \(the sim gate\)/],
  ['closed93_dropped', 'src/ui/productionBlockReason.ts', [['  if (closed93 || closed92', '  if (closed92']], [AIR, 'flag'], /^flag: without air kind 46 cannot be produced/],
  ['zombie_call', A, [['if (!e?.air || w.zombies || w.winner >= 0) return;', 'if (!e?.air || w.winner >= 0) return;']], [AIR, 'call'], /^call: refused — zombie defence/],
  ['dead_hq_call', A, [['(kind !== STRIKE93 && kind !== RECON93) || !hqAlive(w, side)) return;', '(kind !== STRIKE93 && kind !== RECON93)) return;']], [AIR, 'call'], /^call: refused — the HQ is down/],
  ['after_win_call', A, [['if (!e?.air || w.zombies || w.winner >= 0) return;', 'if (!e?.air || w.zombies) return;']], [AIR, 'call'], /^call: refused — after the battle is decided/],
  ['no_cost', A, [['  e.supply[side] -= COST93[kind];\n', '']], [AIR, 'call'], /^call: a strike costs 60/],
  ['no_cooldown', A, [['(w.sky.ready[slot] > w.tick || ', '(false || ']], [AIR, 'call'], /^call: refused one step before the cooldown ends/],
  ['two_planes', A, [[' || w.sky.planes.some(p => p.side === side && p.kind === kind))) return;', ')) return;']], [AIR, 'call'], /^call: one of a kind at a time, even when the cooldown is over/],
  ['bomb_peeks', A, [['  if (kind === STRIKE93 && !see(w, side, tx, tz)) return;', '']], [AIR, 'call'], /^call: refused — a strike on a cell nobody sees/],
  ['drop_early', A, [['p.t !== p.T + HOLD93[STRIKE93]) continue;', 'p.t !== p.T + HOLD93[STRIKE93] - 1) continue;']], [AIR, 'flight'], /^flight: kind 1 enters, arrives, drops/],
  ['corner_entry', A, [['center(side === 0 ? w.n - 1 : 0);', '(side === 0 ? w.n - 1 : 0) * SUB;']], [AIR, 'mirror'], /^mirror: x \+ x' = n × 256 every step/],
  ['land_417', ST, [['const k = s.shooter ? UNIT_KINDS[w.units[s.shooter - 1].kind] : BOMB93;', 'const k = UNIT_KINDS[w.units[s.shooter - 1].kind];']], [AIR, 'bomb'], /Cannot read properties of undefined \(reading 'kind'\)/],
  ['bomb_skips_land', A, [['    land(w, { id: 0, side: p.side,', '    if (false) land(w, { id: 0, side: p.side,']], [AIR, 'bomb'], /^bomb: a section dies within 204/],
  ['no_miss', A, [['let miss = Math.trunc((MISS93 * (HP93[STRIKE93] - p.hp)) / HP93[STRIKE93]);', 'let miss = 0;']], [AIR, 'miss'], /^miss: one AA gun: 5 hits before the drop/],
  ['smoke_ignored', A, [['    if (smokeBlocks(w, p.tx, p.tz, p.tx, p.tz)) miss = Math.max(miss, SMOKE_MISS93);\n', '']], [AIR, 'miss'], /^miss: smoke on the target throws it 384 too/],
  ['aa_own', A, [['if (p.side === u.side || p.t < 0 || p.hp <= 0) continue;', 'if (p.t < 0 || p.hp <= 0) continue;']], [AIR, 'aa'], /^aa: never shoots its own side/],
  ['aa_range', A, [['if (d2 > a * a) continue;', 'if (d2 > (a + 1) * (a + 1)) continue;']], [AIR, 'aa'], /^aa: \(2,048, 1\) is out of reach/],
  ['aa_unborn', A, [['if (p.side === u.side || p.t < 0 || p.hp <= 0) continue;', 'if (p.side === u.side || p.hp <= 0) continue;']], [AIR, 'aa'], /^aa: never shoots a plane not yet in/],
  ['aa_moving', A, [['    if (u.pathIdx < u.path.length) continue;        // 在走不打（要架好）\n', '']], [AIR, 'aa'], /^aa: a moving AA gun does not fire/],
  ['aa_towed', A, [['if (!a || !u.alive || u.towBy) continue;', 'if (!a || !u.alive) continue;']], [AIR, 'aa'], /^aa: a towed AA gun does not fire/],
  ['aa_no_cooldown', A, [['    if (u.cooldown > 0) continue;\n    u.cooldown = k.reload;', '    u.cooldown = k.reload;']], [AIR, 'aa'], /^aa: one shot every 10 steps/],
  ['aa_rng', A, [['u.cooldown = k.reload; best.hp -= AA_DMG93;', 'u.cooldown = k.reload; best.hp -= AA_DMG93; w.rng = (w.rng + 1) | 0;']], [AIR, 'aa'], /^aa: 1,000 steps of AA fire draw no random number/],
  ['aa_kill_event', A, [['if (best.hp <= 0) { const s = slotOf(', "if (best.hp <= 0) { w.events.push({ e: 'kill', unit: best.id }); const s = slotOf("]], [AIR, 'down'], /^down: shooting a plane down pushes no kill event/],
  ['down_no_cooldown', A, [['sky.ready[s] = Math.max(sky.ready[s], w.tick + COOL93[best.kind]);', 'sky.ready[s] = sky.ready[s];']], [AIR, 'down'], /^down: the cooldown restarts from the step it was shot down/],
  ['recon_line', ST, [['  if (w.sky && seen93(w, side, x, z)) return true;', '']], [AIR, 'recon'], /^recon: hovering it sees exactly 1,536 out/],
  ['recon_any_side', A, [['if (p.side !== side || p.kind !== RECON93 ||', 'if (p.kind !== RECON93 ||']], [AIR, 'recon'], /^recon: the other side sees nothing new/],
  ['recon_into_house', A, [['return !blocks(w, cx, cz) && vegetationAt(', 'return vegetationAt(']], [AIR, 'recon'], /^recon: not into a standing house/],
  ['recon_into_wood', A, [[' && vegetationAt(w, cx, cz) !== VEG_WOOD && ', ' && ']], [AIR, 'recon'], /^recon: not into a small wood/],
  ['recon_through_smoke', A, [[' && !smokeBlocks(w, x, z, x, z);', ';']], [AIR, 'recon'], /^recon: not into smoke/],
  ['flagoff_changed', E, [['  if (air) w.eco.air = 1;', '  w.eco.air = 1;']], ['tests/air93-pinned.mjs', ''], /^flagoff: twelve new-game battles without air/],
  ['recon_early', A, [['|| p.t <= p.T ||', '|| p.t < p.T ||']], [AIR, 'recon'], /^recon: at t = T it does not see yet/],
  ['route_unseen', U, [['if (kind === STRIKE93 && !spotted(w, SIDE_PLAYER, center(x), center(z))) { flash', 'if (false) { flash']], [AIR, 'route'], /^route: a strike on an unseen cell sends nothing/],
  ['alert_natural', U, [['if (planes.has(id) || o.t + (w.tick - prev.tick) >= o.end) continue;', 'if (planes.has(id)) continue;']], [AIR, 'alert'], /^alert: a plane flying home says nothing/],
  ['hint_dropped', M, [[' || !!UNIT_KINDS[u.kind].aa).length,', ').length,']], [AIR, 'wiring'], /^wiring: the hint counts an AA gun with the guns/],
  ['report_dropped', 'src/ui/report.ts', [[' || (k === UK_HOWITZER && kind === UK_AA)', '']], [AIR, 'wiring'], /^wiring: the report counts an AA gun in the gun column/],
  ['valve_ignored', M, [['...(V.r093 ? { air: 1 } : {}), ', '...{ air: 1 }, ']], [AIR, 'wiring'], /^wiring: a new battle sends air only when the R093 valve is on/],
  ['cdp_default', 'tools/cdp.mjs', [['const full93 = /(^|&)noR093=/.test(full92) ? full92 :', 'const full93 = full92; const unused93 = /(^|&)noR093=/.test(full92) ? full92 :']], [AIR, 'wiring'], /^wiring: tools\/cdp\.mjs opens pages with noR093=1/],
  ['paint_after_fx', 'src/render/battle.ts', [[' this.air93.paint(w, simT, alpha, this, id => this.fire44[id], this.r4 && this.fxOn ? this.glow! : null, this.r4 && this.fxOn ? this.puff! : null);', ''], ['    if (this.r4) this.updateFx(simT);', '    if (this.r4) this.updateFx(simT); this.air93.paint(w, simT, alpha, this, id => this.fire44[id], null, null);']], [AIR, 'wiring'], /^wiring: the air view paints after the particle pools begin and before updateFx/],
  ['gun_scale_dropped', 'src/render/battle.ts', [['= { ...AA93_GUN, ...INTERNATIONAL_GUN_ART,', '= { ...INTERNATIONAL_GUN_ART,']], [AIR, 'wiring'], /^wiring: the AA gun uses the gun mesh/],
  ['after_hook', M, [['after: () => { platoon95.frame(); transport92.frame(); },', 'after: () => { platoon95.frame(); transport92.frame(); void 0; },']], [T92, 'wiring'], /^wiring: the 運輸 group follows the valve/],
  ['ai_calls', ST, [['  ecoStep(w);   // R019', "  if (w.eco?.air && w.ai && w.tick === 200) { w.eco.supply[1] += 100; call93(w, 1, 2, 5, 5, spotted); }   // 故意弄壞\n  ecoStep(w);   // R019"]], [QUIET, ''], /^quiet: AI-only battles never get w\.sky/],
  ['eco_gives_aa', E, [['  if (air) w.eco.air = 1;', '  if (air) { w.eco.air = 1; for (const side of [SIDE_PLAYER, SIDE_ENEMY]) { const b = hqAlive(w, side); if (b) spawnUnit(w, side, UK_AA, b); } }']], [QUIET, ''], /^quiet: .* never queues or owns kind 46/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  for (const f of [AIR, QUIET, T92, 'tests/air93-pinned.mjs']) fs.copyFileSync(path.join(root, f), path.join(temp, f));
  fs.copyFileSync(path.join(root, 'index.html'), path.join(temp, 'index.html'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, [guard, group], message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length, 2, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, group ? [guard, group] : [guard], { cwd: temp, encoding: 'utf8', timeout: 120000, env: { ...process.env, QUIET_ONE: '1' } });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1] ?? r.stderr.match(/(TypeError[^\r\n]+)/)?.[1] ?? '';
    assert.match(first, message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED air93/${name}: ${first.slice(0, 140)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r093-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`air93: ${cases.length} negative controls OK`);
