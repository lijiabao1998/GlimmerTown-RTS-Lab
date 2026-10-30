// R123: independent text fixtures and isolated, in-memory production-source mutations.
// Run `node tests/reload-status.mjs --mutations` to verify every guard's first failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createWorld, hashWorld, TICK_HZ, SUB, UNIT_KINDS, SIDE_PLAYER, SIDE_ENEMY, ORD_IDLE, ORD_MOVE, ORD_FIRE_AT,
  UK_TANK, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_OBSERVER, UK_INFANTRY,
} from '../src/sim/world.ts';

const url = new URL('../src/ui/reloadStatus.ts', import.meta.url);
const source = fs.readFileSync(url, 'utf8');
const signature = 'export function reloadStatus(w: World, selected: ReadonlySet<number>, enabled = true): string {';
const resultLine = 'return `裝填完成 ${ready}／裝填中 ${loading}${remaining}；裝填完成不代表可射擊`;';
const eligibility = 'if (!k.armored && !SOVIET_KINDS.includes(u.kind) && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;';
const cached = `let lastTick = -1, lastText = '';
${signature}
  if (w.tick === lastTick) return lastText;
  lastTick = w.tick;`;
const mutations = {
  tank_omitted: { group: 'eligible_kinds', from: '!k.armored', to: `(!k.armored || u.kind === ${UK_TANK})`, message: 'tank is an eligible ready weapon' },
  light_omitted: { group: 'eligible_kinds', from: '!k.armored', to: `(!k.armored || u.kind === ${UK_LIGHT})`, message: 'light is an eligible ready weapon' },
  heavy_omitted: { group: 'eligible_kinds', from: '!k.armored', to: `(!k.armored || u.kind === ${UK_HEAVY})`, message: 'heavy is an eligible ready weapon' },
  howitzer_omitted: { group: 'eligible_kinds', from: 'u.kind !== UK_HOWITZER', to: 'true', message: 'howitzer is an eligible ready weapon' },
  atgun_omitted: { group: 'eligible_kinds', from: 'u.kind !== UK_ATGUN', to: 'true', message: 'atgun is an eligible ready weapon' },
  mortar_omitted: { group: 'eligible_kinds', from: 'u.kind !== UK_MORTAR', to: 'true', message: 'mortar is an eligible ready weapon' },
  zero_loading: { group: 'ready', from: 'u.cooldown <= 0', to: 'u.cooldown < 0', message: 'zero cooldown is ready with no remaining time' },
  loading_count: { group: 'single_loading', from: 'loading++;', to: 'ready++;', message: 'single selected loading weapon reports its own remaining time' },
  wrong_timebase: { group: 'single_loading', from: 'u.cooldown * 10 / TICK_HZ', to: 'u.cooldown * 10 / (TICK_HZ * 2)', message: 'single selected loading weapon reports its own remaining time' },
  floor_tick: { group: 'one_tick', from: 'Math.ceil(u.cooldown * 10 / TICK_HZ)', to: 'Math.floor(u.cooldown * 10 / TICK_HZ)', message: 'one remaining tick never displays zero seconds' },
  floor_boundary: { group: 'rounding', from: 'Math.ceil(u.cooldown * 10 / TICK_HZ)', to: 'Math.floor(u.cooldown * 10 / TICK_HZ)', message: 'just beyond a whole simulation second rounds upward' },
  nominal_reload: { group: 'current_cooldown', from: 'u.cooldown * 10 / TICK_HZ', to: 'k.reload * 10 / TICK_HZ', message: 'remaining time comes from current cooldown rather than nominal reload' },
  missing_decimal: { group: 'single_loading', from: '(low / 10).toFixed(1)', to: 'String(low / 10)', message: 'single selected loading weapon reports its own remaining time' },
  unselected_included: { group: 'selected_only', from: '!selected.has(u.id) || ', to: '', message: 'unselected weapons do not affect counts or range' },
  infantry_included: { group: 'exclude_infantry', from: eligibility, to: '', message: 'armed infantry is excluded from reload information' },
  observer_included: { group: 'exclude_observer', from: eligibility, to: '', message: 'unarmed observers are excluded from reload information' },
  dead_included: { group: 'same_tick_death', from: '!u.alive || ', to: '', message: 'same-tick death removes the previous reload status' },
  enemy_included: { group: 'same_tick_side', from: ' || u.side !== SIDE_PLAYER', to: '', message: 'same-tick side change removes the previous reload status' },
  no_empty_guard: { group: 'empty', from: "if (!ready && !loading) return '';", to: '', message: 'empty selection has no reload text' },
  double_ready: { group: 'mixed', from: 'ready++;', to: 'ready += 2;', message: 'mixed selection reports exact ready/loading counts and full nonzero range' },
  collapse_range: { group: 'mixed', from: 'high = Math.max(high, tenths);', to: 'high = low;', message: 'mixed selection reports exact ready/loading counts and full nonzero range' },
  average_range: { group: 'mixed', from: '(low / 10).toFixed(1)', to: '((low + high) / 20).toFixed(1)', message: 'mixed selection reports exact ready/loading counts and full nonzero range' },
  include_ready_zero: { group: 'mixed', from: 'if (u.cooldown <= 0) ready++;', to: 'if (u.cooldown <= 0) { ready++; low = 0; }', message: 'mixed selection reports exact ready/loading counts and full nonzero range' },
  repeated_range: { group: 'equal_remaining', from: "low === high ? ''", to: "false ? ''", message: 'equal rounded remaining times display once rather than a redundant range' },
  absent_warning: { group: 'warning', from: '；裝填完成不代表可射擊`;', to: '`;', message: 'ready text warns that loaded does not mean able to fire' },
  selection_cache: { group: 'same_tick_selection', edits: [[signature, cached], [resultLine, resultLine.replace('return ', 'return lastText = ')]], message: 'same-tick reselection replaces the previous reload status' },
  cleared_cache: { group: 'same_tick_clear', edits: [[signature, cached], [resultLine, resultLine.replace('return ', 'return lastText = ')]], message: 'same-tick empty selection clears the previous reload status' },
  restart_cache: { group: 'restart', edits: [[signature, cached], [resultLine, resultLine.replace('return ', 'return lastText = ')]], message: 'new world with reused tick and ids reconstructs reload information' },
  ignored_valve: { group: 'disabled', from: "if (!enabled) return '';", to: '', message: 'disabling reload information clears an existing status immediately' },
  frame_countdown: { group: 'paused', from: signature, to: `${signature}\n  for (const u of w.units) if (u.cooldown > 0) u.cooldown--;`, message: 'repeated paused frames never consume remaining simulation time' },
  cooldown_cache: { group: 'same_tick_cooldown', edits: [[signature, cached], [resultLine, resultLine.replace('return ', 'return lastText = ')]], message: 'same-tick cooldown changes refresh without waiting for another tick' },
  order_filter: { group: 'not_fire_eligibility', from: eligibility, to: `${eligibility}\n    if (u.order !== ${ORD_FIRE_AT}) continue;`, message: 'reload status is independent of movement and firing eligibility' },
  rng_write: { group: 'readonly_world', from: signature, to: `${signature}\n  w.rng ^= 1;`, message: 'reload status preserves every World field including RNG and events' },
  selection_write: { group: 'readonly_selection', from: signature, to: `${signature}\n  selected.clear();`, message: 'reload status never changes the selected ids' },
};
const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.slice(9);
const selectedGroup = process.env.R123_RELOAD_GROUP;
async function load() {
  if (!mutant) return import(url.href);
  const m = mutations[mutant]; assert.ok(m, 'known reload-status mutant');
  let changed = source;
  for (const [from, to] of m.edits ?? [[m.from, m.to]]) {
    assert.equal(changed.split(from).length - 1, 1, `${mutant}: unique production mutation anchor`);
    changed = changed.replace(from, to);
  }
  const js = stripTypeScriptTypes(changed).replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, url).href}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { reloadStatus } = await load();
let groups = 0;
function group(name, fn) {
  if (selectedGroup && selectedGroup !== name) return;
  try { fn(); groups++; console.log(`OK reload-status: ${name}`); }
  catch (error) {
    // A machine-readable first failure prevents an earlier unrelated assertion
    // or an import/syntax error from masquerading as a successful negative.
    console.error(`NG reload-status: ${name}`);
    console.error(`FIRST_RELOAD_FAILURE=${JSON.stringify({ group: name, name: error.name, message: error.message.split('\n')[0] })}`);
    throw error;
  }
}
function fixture() { const w = createWorld(1944); w.units = []; return { w, selected: new Set() }; }
function add(f, kind = UK_TANK, cooldown = 0, { side = SIDE_PLAYER, alive = true, select = true } = {}) {
  const u = { id: f.w.units.length + 1, kind, side, alive, cooldown, x: SUB, z: SUB, hp: UNIT_KINDS[kind].hp, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, aimX: SUB, aimZ: 0 };
  f.w.units.push(u); if (select) f.selected.add(u.id); return u;
}
const refresh = f => reloadStatus(f.w, f.selected);
const READY = '裝填完成 1／裝填中 0；裝填完成不代表可射擊';
const TWO_SECONDS = '裝填完成 0／裝填中 1；剩餘 2.0 模擬秒；裝填完成不代表可射擊';

group('eligible_kinds', () => {
  for (const [kind, name] of [[UK_TANK, 'tank'], [UK_LIGHT, 'light'], [UK_HEAVY, 'heavy'], [UK_HOWITZER, 'howitzer'], [UK_ATGUN, 'atgun'], [UK_MORTAR, 'mortar']]) {
    const f = fixture(), u = add(f, kind);
    assert.equal(refresh(f), READY, `${name} is an eligible ready weapon`);
    u.cooldown = 2 * TICK_HZ;
    assert.equal(refresh(f), TWO_SECONDS, `${name} is an eligible loading weapon`);
  }
});
group('ready', () => {
  const f = fixture(), u = add(f);
  assert.equal(refresh(f), READY, 'zero cooldown is ready with no remaining time');
  u.cooldown = -1;
  assert.equal(refresh(f), READY, 'nonpositive legacy cooldown is ready with no negative seconds');
});
group('single_loading', () => {
  const f = fixture(); add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS, 'single selected loading weapon reports its own remaining time');
});
group('one_tick', () => {
  const f = fixture(); add(f, UK_TANK, 1);
  assert.equal(refresh(f), '裝填完成 0／裝填中 1；剩餘 0.1 模擬秒；裝填完成不代表可射擊', 'one remaining tick never displays zero seconds');
});
group('rounding', () => {
  const f = fixture(), u = add(f, UK_ATGUN, TICK_HZ + 1);
  assert.equal(refresh(f), '裝填完成 0／裝填中 1；剩餘 1.1 模擬秒；裝填完成不代表可射擊', 'just beyond a whole simulation second rounds upward');
  for (const [ticks, seconds] of [[TICK_HZ, '1.0'], [TICK_HZ - 1, '1.0'], [TICK_HZ + 2, '1.1'], [TICK_HZ + 3, '1.2']]) {
    u.cooldown = ticks;
    assert.equal(refresh(f), `裝填完成 0／裝填中 1；剩餘 ${seconds} 模擬秒；裝填完成不代表可射擊`, `independent rounding boundary at ${ticks} ticks`);
  }
});
group('current_cooldown', () => {
  const f = fixture(); add(f, UK_HOWITZER, 3 * TICK_HZ + 1);
  assert.equal(refresh(f), '裝填完成 0／裝填中 1；剩餘 3.1 模擬秒；裝填完成不代表可射擊', 'remaining time comes from current cooldown rather than nominal reload');
});
group('selected_only', () => {
  const f = fixture(); add(f); add(f, UK_HOWITZER, 20 * TICK_HZ, { select: false }); add(f, UK_HEAVY, 0, { select: false });
  f.selected.add(99999);
  assert.equal(refresh(f), READY, 'unselected weapons do not affect counts or range');
});
group('exclude_infantry', () => {
  const f = fixture(); add(f, UK_INFANTRY, 2 * TICK_HZ);
  assert.equal(refresh(f), '', 'armed infantry is excluded from reload information');
  add(f, UK_TANK);
  assert.equal(refresh(f), READY, 'mixed infantry cannot inflate ready/loading counts');
});
group('exclude_observer', () => {
  const f = fixture(); add(f, UK_OBSERVER, 2 * TICK_HZ);
  assert.equal(refresh(f), '', 'unarmed observers are excluded from reload information');
  add(f, UK_MORTAR);
  assert.equal(refresh(f), READY, 'mixed observers cannot inflate ready/loading counts');
});
group('empty', () => {
  const f = fixture(); add(f, UK_TANK, 0, { select: false });
  assert.equal(refresh(f), '', 'empty selection has no reload text');
  f.selected.add(99999);
  assert.equal(refresh(f), '', 'unknown selected ids do not create reload text');
  f.w.units = [];
  assert.equal(refresh(f), '', 'world with no units has no reload text');
});
group('mixed', () => {
  const f = fixture();
  add(f, UK_TANK); add(f, UK_ATGUN); add(f, UK_LIGHT, 1); add(f, UK_MORTAR, 2 * TICK_HZ); add(f, UK_HOWITZER, 4 * TICK_HZ + 1);
  add(f, UK_HEAVY, 30 * TICK_HZ, { side: SIDE_ENEMY }); add(f, UK_TANK, 40 * TICK_HZ, { alive: false });
  add(f, UK_OBSERVER, 50 * TICK_HZ); add(f, UK_INFANTRY, 60 * TICK_HZ);
  const expected = '裝填完成 2／裝填中 3；剩餘 0.1–4.1 模擬秒；裝填完成不代表可射擊';
  assert.equal(refresh(f), expected, 'mixed selection reports exact ready/loading counts and full nonzero range');
  f.w.units.reverse(); f.selected = new Set([...f.selected].reverse());
  assert.equal(refresh(f), expected, 'world and selection iteration order do not change reload summary');
});
group('equal_remaining', () => {
  const f = fixture(); add(f, UK_TANK, 1); add(f, UK_HOWITZER, 2);
  assert.equal(refresh(f), '裝填完成 0／裝填中 2；剩餘 0.1 模擬秒；裝填完成不代表可射擊', 'equal rounded remaining times display once rather than a redundant range');
  for (const u of f.w.units) u.cooldown = 0;
  assert.equal(refresh(f), '裝填完成 2／裝填中 0；裝填完成不代表可射擊', 'all-ready mixed selection has no bogus infinite or zero range');
});
group('warning', () => {
  const f = fixture(); add(f);
  assert.match(refresh(f), /；裝填完成不代表可射擊$/, 'ready text warns that loaded does not mean able to fire');
});
group('same_tick_selection', () => {
  const f = fixture(), a = add(f), b = add(f, UK_HOWITZER, 2 * TICK_HZ, { select: false });
  assert.equal(refresh(f), READY);
  f.selected.delete(a.id); f.selected.add(b.id);
  assert.equal(refresh(f), TWO_SECONDS, 'same-tick reselection replaces the previous reload status');
  assert.equal(f.w.tick, 0);
});
group('same_tick_cooldown', () => {
  const f = fixture(), u = add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS);
  u.cooldown = 0;
  assert.equal(refresh(f), READY, 'same-tick cooldown changes refresh without waiting for another tick');
  u.cooldown = 1;
  assert.equal(refresh(f), '裝填完成 0／裝填中 1；剩餘 0.1 模擬秒；裝填完成不代表可射擊', 'new loading cycle replaces a ready status at the same tick');
});
group('same_tick_death', () => {
  const f = fixture(), u = add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS); u.alive = false;
  assert.equal(refresh(f), '', 'same-tick death removes the previous reload status');
});
group('same_tick_side', () => {
  const f = fixture(), u = add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS); u.side = SIDE_ENEMY;
  assert.equal(refresh(f), '', 'same-tick side change removes the previous reload status');
});
group('same_tick_clear', () => {
  const f = fixture(); add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS); f.selected.clear();
  assert.equal(refresh(f), '', 'same-tick empty selection clears the previous reload status');
});
group('restart', () => {
  const old = fixture(); add(old, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(old), TWO_SECONDS);
  const fresh = fixture(); add(fresh, UK_TANK);
  assert.equal(reloadStatus(fresh.w, old.selected), READY, 'new world with reused tick and ids reconstructs reload information');
  fresh.w.units = [];
  assert.equal(reloadStatus(fresh.w, old.selected), '', 'restart with no matching units removes stale reload text');
});
group('disabled', () => {
  const f = fixture(); add(f, UK_HOWITZER, 2 * TICK_HZ);
  assert.equal(refresh(f), TWO_SECONDS);
  assert.equal(reloadStatus(f.w, f.selected, false), '', 'disabling reload information clears an existing status immediately');
  assert.equal(reloadStatus(f.w, f.selected, true), TWO_SECONDS, 're-enabling reconstructs current reload status');
});
group('paused', () => {
  const f = fixture(), u = add(f, UK_HOWITZER, 2 * TICK_HZ);
  for (let i = 0; i < TICK_HZ * 5; i++) assert.equal(refresh(f), TWO_SECONDS, 'repeated paused frames never consume remaining simulation time');
  assert.equal(u.cooldown, 2 * TICK_HZ, 'UI calls never advance simulation cooldown');
  f.w.tick += 100 * TICK_HZ;
  assert.equal(refresh(f), TWO_SECONDS, 'elapsed world ticks alone are not substituted for stored cooldown');
});
group('not_fire_eligibility', () => {
  const f = fixture(), u = add(f, UK_ATGUN);
  for (const order of [ORD_IDLE, ORD_MOVE, ORD_FIRE_AT]) {
    u.order = order; u.path = [1, 2]; u.target = 0; u.tx = -100; u.tz = -100;
    assert.equal(refresh(f), READY, 'reload status is independent of movement and firing eligibility');
  }
});
group('readonly_world', () => {
  const f = fixture(); const u = add(f, UK_HOWITZER, 2 * TICK_HZ);
  f.w.events.push({ e: 'fire', unit: u.id, x: u.x, z: u.z });
  const before = structuredClone(f.w), hash = hashWorld(f.w);
  refresh(f);
  assert.deepEqual(f.w, before, 'reload status preserves every World field including RNG and events');
  for (let i = 0; i < 30; i++) reloadStatus(f.w, f.selected, i % 2 === 0);
  assert.deepEqual(f.w, before, 'repeated and disabled calls preserve the complete World');
  assert.equal(hashWorld(f.w), hash, 'reload status preserves the simulation hash');
  // Freeze plain state too: a write-then-restore implementation must not pass.
  for (const unit of f.w.units) { Object.freeze(unit.path); Object.freeze(unit); }
  Object.freeze(f.w.units); Object.freeze(f.w.events); Object.freeze(f.w);
  assert.equal(refresh(f), TWO_SECONDS, 'reload status accepts a read-only frozen World');
});
group('readonly_selection', () => {
  const f = fixture(); add(f, UK_HOWITZER, 2 * TICK_HZ); f.selected.add(99999);
  const before = [...f.selected]; refresh(f);
  assert.deepEqual([...f.selected], before, 'reload status never changes the selected ids');
  // The API promises ReadonlySet, not its mutating methods.
  const readonly = { has: id => f.selected.has(id), get size() { return f.selected.size; }, values: () => f.selected.values(), keys: () => f.selected.keys(), entries: () => f.selected.entries(), [Symbol.iterator]: () => f.selected[Symbol.iterator](), forEach: fn => f.selected.forEach(fn) };
  assert.equal(reloadStatus(f.w, readonly), TWO_SECONDS, 'ReadonlySet input does not require mutation methods');
});

if (process.argv.includes('--mutations')) {
  const covered = new Set(Object.values(mutations).map(m => m.group));
  assert.equal(covered.size, groups, 'each reload-status guard group has an isolated negative control');
  for (const [name, m] of Object.entries(mutations)) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 25000, env: { ...process.env, R123_RELOAD_GROUP: m.group } });
    const output = `${child.stdout}\n${child.stderr}`;
    assert.equal(child.error, undefined, `${name}: negative control must start and finish`);
    assert.notEqual(child.status, 0, `${name}: negative control must fail`);
    const first = output.match(/^FIRST_RELOAD_FAILURE=(.*)$/m);
    assert.ok(first, `${name}: must fail within a semantic guard, not import or syntax\n${output}`);
    assert.deepEqual(JSON.parse(first[1]), { group: m.group, name: 'AssertionError', message: m.message }, `${name}: first red is the exact intended assertion\n${output}`);
    assert.equal((output.match(/^NG reload-status:/gm) ?? []).length, 1, `${name}: only the isolated intended group fails`);
    console.log(`OK reload-status negative: ${name} → ${m.group}: ${m.message}`);
  }
  console.log(`reload-status: ${Object.keys(mutations).length} isolated negatives OK`);
}
assert.ok(groups > 0, 'at least one reload-status guard executes');
console.log(`reload-status: ${groups} groups OK`);
