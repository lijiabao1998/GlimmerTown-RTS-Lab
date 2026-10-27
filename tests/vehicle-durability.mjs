// R135: independent HP fixtures, actual HUD/main wiring, and isolated exact-first-red negatives.
import { valves } from '../src/valves.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as world from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from '../src/sim/script.ts';
import { reloadStatus } from '../src/ui/reloadStatus.ts';
import { coverDurability } from '../src/ui/coverDurability.ts';
const { createWorld, hashWorld, UNIT_KINDS, SIDE_PLAYER, SIDE_ENEMY, SUB, ORD_IDLE, ORD_MOVE,
  UK_TANK, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT, UK_INFANTRY, UK_OBSERVER, UK_ZOMBIE } = world;
const paths = { ui: '../src/ui/vehicleDurability.ts', hud: '../src/ui/hud.ts', main: '../src/main.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(new URL(path, import.meta.url), 'utf8')]));
const signature = 'export function vehicleDurability(w: World, selected: ReadonlySet<number>, enabled = true): string {';
const eligibility = 'if (!k.armored && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR) continue;';
const single = (hp, max) => `車輛耐久：${hp}/${max}`;
const multiple = (count, percent) => `車輛耐久：${count} 輛；最低 ${percent}%`;
const cases = {}, mutations = {};
function test(name, message, file, from, to, run) { cases[name] = run; mutations[name] = { message, file, from, to }; }
function fixture() { const w = createWorld(1944); w.units = []; return { w, selected: new Set() }; }
function add(f, kind = UK_TANK, hp = UNIT_KINDS[kind].hp, { side = SIDE_PLAYER, alive = true, selected = true } = {}) {
  const u = { id: f.w.units.length + 1, kind, side, alive, hp, x: SUB, z: SUB, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
  f.w.units.push(u); if (selected) f.selected.add(u.id); return u;
}
const eq = (a, b, message) => assert.equal(a, b, message);
for (const [kind, label] of [[UK_TANK, 'tank'], [UK_LIGHT, 'light'], [UK_HEAVY, 'heavy'], [UK_ARMORED_CAR, 'armored_car'], [UK_DESTROYER, 'destroyer'], [UK_ASSAULT, 'assault'], [UK_HOWITZER, 'howitzer'], [UK_ATGUN, 'atgun'], [UK_MORTAR, 'mortar']]) {
  test(label, `${label} uses exact current and kind maximum HP`, 'ui', eligibility, `${eligibility}\n    if (u.kind === ${kind}) continue;`, (read, message) => {
    const f = fixture(), max = UNIT_KINDS[kind].hp, u = add(f, kind, max - 1);
    eq(read(f.w, f.selected), single(max - 1, max), message);
    u.hp = max; eq(read(f.w, f.selected), single(max, max), 'full HP remains exact');
    u.hp = 1; eq(read(f.w, f.selected), single(1, max), 'one HP remains exact');
  });
}
test('selected', 'unselected vehicles cannot affect durability', 'ui', '!selected.has(u.id) || ', '', (read, message) => {
  const f = fixture(), max = UNIT_KINDS[UK_TANK].hp; add(f); add(f, UK_HEAVY, 1, { selected: false }); f.selected.add(99999);
  eq(read(f.w, f.selected), single(max, max), message);
});
for (const [name, kind] of [['infantry', UK_INFANTRY], ['observer', UK_OBSERVER], ['zombie', UK_ZOMBIE]]) {
  test(`exclude_${name}`, `${name} never enters vehicle durability`, 'ui', eligibility, '', (read, message) => {
    const f = fixture(); add(f, kind, 1); eq(read(f.w, f.selected), '', message);
    const max = UNIT_KINDS[UK_TANK].hp; add(f); eq(read(f.w, f.selected), single(max, max), 'excluded kind cannot inflate count or reduce minimum');
  });
}
test('enemy', 'enemy vehicles never reveal durability', 'ui', ' || u.side !== SIDE_PLAYER', '', (read, message) => {
  const f = fixture(); add(f, UK_HEAVY, 1, { side: SIDE_ENEMY }); eq(read(f.w, f.selected), '', message);
  const max = UNIT_KINDS[UK_TANK].hp; add(f); eq(read(f.w, f.selected), single(max, max), 'enemy cannot affect mixed own selection');
});
test('dead', 'dead vehicles never enter durability', 'ui', '!u.alive || ', '', (read, message) => {
  const f = fixture(); add(f, UK_TANK, 0, { alive: false }); eq(read(f.w, f.selected), '', message);
});
test('empty', 'empty or stale selection clears durability', 'ui', "if (!count) return '';", '', (read, message) => {
  const f = fixture(); add(f, UK_TANK, 1, { selected: false });
  eq(read(f.w, f.selected), '', message); f.selected.add(99999); eq(read(f.w, f.selected), '', message); f.w.units = []; eq(read(f.w, f.selected), '', message);
});
test('current_hp', 'single durability is not rounded or replaced with nominal HP', 'ui', 'lowHp = u.hp;', 'lowHp = k.hp;', (read, message) => {
  const f = fixture(), max = UNIT_KINDS[UK_TANK].hp; add(f, UK_TANK, max - 3); eq(read(f.w, f.selected), single(max - 3, max), message);
});
test('kind_maximum', 'single maximum follows the selected kind', 'ui', 'lowMax = k.hp;', 'lowMax = 1;', (read, message) => {
  const f = fixture(), max = UNIT_KINDS[UK_HEAVY].hp; add(f, UK_HEAVY, max - 3); eq(read(f.w, f.selected), single(max - 3, max), message);
});
test('minimum_ratio', 'mixed kinds use lowest ratio rather than lowest raw HP', 'ui', 'u.hp * lowMax < lowHp * k.hp', 'u.hp < lowHp', (read, message) => {
  const f = fixture(); add(f, UK_HOWITZER, UNIT_KINDS[UK_HOWITZER].hp / 2); add(f, UK_HEAVY, UNIT_KINDS[UK_HEAVY].hp / 4);
  eq(read(f.w, f.selected), multiple(2, 25), message);
  f.w.units.reverse(); f.selected = new Set([...f.selected].reverse()); eq(read(f.w, f.selected), multiple(2, 25), 'minimum is independent of world and selection order');
});
test('not_average', 'a full vehicle cannot hide the weakest vehicle', 'ui', 'u.hp * lowMax < lowHp * k.hp', 'u.hp * lowMax > lowHp * k.hp', (read, message) => {
  const f = fixture(); add(f); add(f, UK_HOWITZER, UNIT_KINDS[UK_HOWITZER].hp / 2); eq(read(f.w, f.selected), multiple(2, 50), message);
});
test('average_ratio', 'mixed durability reports the minimum rather than the arithmetic mean', 'ui', 'Math.floor(100 * lowHp / lowMax)', 'Math.floor(100 * w.units.reduce((sum, u) => sum + u.hp / UNIT_KINDS[u.kind].hp, 0) / count)', (read, message) => {
  const f = fixture(); add(f); add(f, UK_HEAVY, UNIT_KINDS[UK_HEAVY].hp / 4); eq(read(f.w, f.selected), multiple(2, 25), message);
});
test('count', 'mixed count includes each eligible vehicle once', 'ui', 'count++;', 'count += 2;', (read, message) => {
  const f = fixture(); add(f); add(f, UK_HOWITZER); add(f, UK_MORTAR); add(f, UK_INFANTRY, 1); add(f, UK_OBSERVER, 1); add(f, UK_TANK, 0, { alive: false }); add(f, UK_HEAVY, 1, { side: SIDE_ENEMY });
  eq(read(f.w, f.selected), multiple(3, 100), message);
});
test('floor', 'one lost HP never rounds up to full durability', 'ui', 'Math.floor(100 * lowHp / lowMax)', 'Math.ceil(100 * lowHp / lowMax)', (read, message) => {
  const f = fixture(), max = UNIT_KINDS[UK_HEAVY].hp; add(f, UK_HEAVY, max - 1); add(f, UK_HEAVY);
  const expected = 100 - Math.ceil(100 / max); eq(read(f.w, f.selected), multiple(2, expected), message);
  f.w.units[0].hp = 1; eq(read(f.w, f.selected), multiple(2, Math.trunc(100 / max)), 'near-zero percent remains conservative');
});
test('valve', 'disabled durability clears previous information', 'ui', "if (!enabled) return '';", '', (read, message) => {
  const f = fixture(); add(f); assert(read(f.w, f.selected)); eq(read(f.w, f.selected, false), '', message); assert(read(f.w, f.selected, true));
});
test('same_tick_hp', 'same-tick damage refreshes current HP', 'ui', signature, `let cached = '';\n${signature}\n  if (cached) return cached;`, (read, message) => {
  // This mutant is finished below by caching the genuine production return.
  const f = fixture(), max = UNIT_KINDS[UK_TANK].hp, u = add(f); read(f.w, f.selected); u.hp--;
  eq(read(f.w, f.selected), single(max - 1, max), message); eq(f.w.tick, 0, 'same simulation tick');
});
mutations.same_tick_hp.extra = ['if (count === 1) return `車輛耐久：${lowHp}/${lowMax}`;', 'if (count === 1) return cached = `車輛耐久：${lowHp}/${lowMax}`;'];
test('same_tick_selection', 'same-tick selection reads the new vehicle', 'ui', '!selected.has(u.id)', 'u.id !== 1', (read, message) => {
  const f = fixture(), a = add(f), b = add(f, UK_HEAVY, 1, { selected: false }); read(f.w, f.selected); f.selected.clear(); f.selected.add(b.id);
  eq(read(f.w, f.selected), single(1, UNIT_KINDS[UK_HEAVY].hp), message); assert.notEqual(a.id, b.id);
});
test('same_tick_clear', 'clearing selection removes previous durability', 'ui', signature, `${signature}\n  if (!selected.size) return 'stale';`, (read, message) => {
  const f = fixture(); add(f); read(f.w, f.selected); f.selected.clear(); eq(read(f.w, f.selected), '', message);
});
test('replacement', 'same-tick replacement world does not reuse old durability', 'ui', signature, `${signature}\n  if (w.units[0]?.hp === 1) return 'stale';`, (read, message) => {
  const f = fixture(); add(f); read(f.w, f.selected); const fresh = fixture(); add(fresh, UK_HEAVY, 1); eq(read(fresh.w, f.selected), single(1, UNIT_KINDS[UK_HEAVY].hp), message);
});
test('readonly_world', 'durability preserves the entire World', 'ui', signature, `${signature}\n  w.rng ^= 1;`, (read, message) => {
  const f = fixture(), u = add(f); f.w.events.push({ e: 'fire', unit: u.id, x: u.x, z: u.z }); const before = structuredClone(f.w), hash = hashWorld(f.w);
  for (let i = 0; i < 20; i++) { read(f.w, f.selected, i % 2 === 0); assert.deepEqual(f.w, before, message); }
  assert.deepEqual(f.w, before, message); eq(hashWorld(f.w), hash, 'simulation hash preserved');
  const freeze = value => { if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return; for (const child of Object.values(value)) freeze(child); Object.freeze(value); };
  freeze(f.w); eq(read(f.w, f.selected), single(u.hp, UNIT_KINDS[u.kind].hp), 'deep-frozen plain world state remains readable');
});
test('readonly_selection', 'durability preserves selected ids and iteration order', 'ui', signature, `${signature}\n  selected.clear();`, (read, message) => {
  const f = fixture(); add(f); f.selected.add(99999); const before = [...f.selected]; read(f.w, f.selected); assert.deepEqual([...f.selected], before, message);
  const readonly = { has: id => f.selected.has(id), get size() { return f.selected.size; }, [Symbol.iterator]: () => f.selected[Symbol.iterator]() };
  eq(read(f.w, readonly), read(f.w, f.selected), 'read-only selection does not need mutation methods');
});
test('paused', 'repeated paused reads never consume durability', 'ui', signature, `${signature}\n  for (const u of w.units) u.hp--;`, (read, message) => {
  const f = fixture(), max = UNIT_KINDS[UK_TANK].hp; add(f); for (let i = 0; i < 40; i++) eq(read(f.w, f.selected), single(max, max), message);
});
test('order_independent', 'durability does not imply shooting or depend on orders', 'ui', eligibility, `${eligibility}\n    if (u.order !== ${ORD_IDLE}) continue;`, (read, message) => {
  const f = fixture(), u = add(f); u.order = ORD_MOVE; u.path = [1, 2]; u.cooldown = 100; u.tx = -100; u.tz = -100;
  eq(read(f.w, f.selected), single(u.hp, UNIT_KINDS[u.kind].hp), message);
});
test('replay', 'enabled and disabled durability preserve historical replay hash', 'ui', signature, `${signature}\n  if (enabled) w.rng++;`, (read, message) => {
  const a = createWorld(SCRIPT_SEED), b = structuredClone(a), selected = new Set(a.units.filter(u => u.side === SIDE_PLAYER).map(u => u.id)); let cursor = 0;
  for (let tick = 0; tick < SCRIPT_TICKS; tick++) {
    const commands = []; while (cursor < SCRIPT.length && SCRIPT[cursor].tick === tick) commands.push(SCRIPT[cursor++].cmd);
    step(a, commands); step(b, commands); read(a, selected); read(b, selected, false);
  }
  eq(hashWorld(a), hashWorld(b), message);
  const replay = runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(SCRIPT)), SCRIPT_TICKS);
  eq(hashWorld(a), hashWorld(replay), 'historical JSON command log still replays identically');
});

// Actual HUD and main callback, with only DOM API and unrelated controllers stubbed.
class Element {
  constructor() { this.children = new Map(); this.events = new Map(); this.style = {}; this.text = ''; this.writes = 0; this.classList = { toggle() {} }; }
  set innerHTML(html) { for (const match of html.matchAll(/id="([^"]+)"/g)) this.children.set(match[1], new Element()); }
  set textContent(value) { this.text = value; this.writes++; }
  get textContent() { return this.text; }
  querySelector(selector) { return this.children.get(selector.slice(1)); }
  appendChild(element) { this.children.set(element.id, element); }
  addEventListener(event, callback) { this.events.set(event, callback); }
  setAttribute() {}
}
function section(source, start, end, after = 0) { const a = source.indexOf(start, after), b = source.indexOf(end, a + start.length); assert(a >= 0 && b > a, `source boundaries: ${start}`); return source.slice(a, b); }
// R060：閥從閥表來；fixture 蓋掉個別閥（可再改）
const fixtureValves = (q, over = {}) => Object.defineProperties(valves(q), Object.fromEntries(Object.entries(over).map(([k, value]) => [k, { value, writable: true }])));
function uiFixture(read, query = '') {
  const f = fixture(); add(f); let stateCalls = 0, vehicleCalls = 0; const document = { body: new Element(), createElement: () => new Element() }; globalThis.document = document;
  const q = new URLSearchParams(query);
  const c = vm.createContext({ ...world, ...f, vehicleDurability: read, reloadStatus, coverDurability, document, hud: undefined, paused: true, phase: 'battle', speed: 1, fireMode: false, ammo: 'he', battleHint: undefined,
    battleAudio: undefined, V: fixtureValves(q, { r009: true, r010: false, r018: false, r015: false, r115: false }), buildHint: '', BUILD_TIP: '布陣說明', q,
    view: { rangeInfo: '原射程', visibleUnit: () => true }, counterbatteryHint: () => '', lastVehicleInfo: '',
    initHud: actions => { const hud = initHud({ ...actions, state: () => { stateCalls++; return actions.state(); } }); return { ...hud, vehicleFrame: info => { vehicleCalls++; hud.vehicleFrame(info); } }; } });
  vm.runInContext(section(mainPlain, 'const ORD_NAME = ', '\nreportView = initReportView'), c);
  const frame = section(mainPlain, '  const vehicleInfo = ', '\n  const vegetationInfo = ', mainPlain.indexOf('  view.update(alpha'));
  const hint = document.body.children.get('hud').querySelector('#hint');
  return { ...f, c, hint: () => hint.textContent, writes: () => hint.writes, stateCalls: () => stateCalls, vehicleCalls: () => vehicleCalls, refresh: () => vm.runInContext(`{${frame}}`, c) };
}
test('hud_prefix', 'vehicle durability is visible before existing operation hints', 'hud', '!priorityHint && info ? `${info}。${legacyHint}` : legacyHint', 'legacyHint', (read, message) => {
  const f = uiFixture(read); assert(f.hint().startsWith(single(UNIT_KINDS[UK_TANK].hp, UNIT_KINDS[UK_TANK].hp)), message);
  assert(f.hint().includes('待命 1。已選：坦克 1。點地面＝移動'), 'order state and controls preserved'); assert(f.hint().includes('裝填完成 1'), 'reload status preserved'); assert(f.hint().includes('原射程'), 'range status preserved');
});
test('no_average', 'exact vehicle durability replaces misleading average HP', 'main', 'selInfo(sel, !vehicleInfo)', 'selInfo(sel)', (read, message) => {
  const f = uiFixture(read); add(f, UK_HEAVY, UNIT_KINDS[UK_HEAVY].hp / 4); f.c.hud.update();
  assert(!f.hint().includes('血量 '), message); assert(f.hint().startsWith(multiple(2, 25)), 'mixed selection exposes weakest ratio');
});
test('main_valve', 'noR135 restores the previous HUD without vehicle durability', 'main', "    const vehicleInfo = vehicleDurability(w, selected, phase === 'battle' && V.r135);", "    const vehicleInfo = vehicleDurability(w, selected, phase === 'battle');", (read, message) => {
  const f = uiFixture(read, 'noR135=1'); assert(!f.hint().includes('車輛耐久'), message); assert(f.hint().startsWith('血量 100%｜待命 1。'), 'old average restored'); assert(f.hint().includes('裝填完成 1'), 'old reload retained');
});
test('independent_valve', 'noR009 does not disable the independent vehicle durability summary', 'main', "    const vehicleInfo = vehicleDurability(w, selected, phase === 'battle' && V.r135);", "    const vehicleInfo = vehicleDurability(w, selected, V.r009 && phase === 'battle' && V.r135);", (read, message) => {
  const f = uiFixture(read); f.c.V.r009 = false; f.c.hud.update(); assert(f.hint().includes('車輛耐久'), message); assert(!f.hint().includes('待命 1'), 'R009 command summary remains independently disabled');
});
test('priority', 'defined priority hints suppress durability without losing it afterward', 'hud', '!priorityHint && info', 'info', (read, message) => {
  const f = uiFixture(read); for (const hint of ['選擇這一格', '']) { f.c.battleHint = hint; f.c.hud.update(); eq(f.hint(), hint, message); }
  f.c.battleHint = undefined; f.c.hud.update(); assert(f.hint().includes('車輛耐久'), 'cancel restores current durability');
});
test('smoke_mode', 'smoke operation hints retain durability without overwriting controls', 'hud', '!priorityHint && info', '!priorityHint && !a.state().fireMode && info', (read, message) => {
  const f = uiFixture(read); f.c.fireMode = true; f.c.ammo = 'smoke'; f.c.hud.update(); assert(f.hint().includes('車輛耐久'), message); assert(f.hint().includes('煙幕只供榴彈砲'), 'smoke-specific controls preserved');
});
test('frame_hp', 'same-tick frame damage updates the paused HUD immediately', 'main', 'lastVehicleInfo = vehicleInfo; hud?.vehicleFrame(vehicleInfo);', 'lastVehicleInfo = vehicleInfo;', (read, message) => {
  const f = uiFixture(read); f.refresh(); f.w.units[0].hp--; f.refresh(); assert(f.hint().startsWith(single(f.w.units[0].hp, UNIT_KINDS[UK_TANK].hp)), message);
  const writes = f.writes(); f.refresh(); eq(f.writes(), writes, 'unchanged frames add no DOM writes');
  f.selected.clear(); f.refresh(); assert(!f.hint().includes('車輛耐久'), 'same-tick clear removes old durability');
});
test('frame_replacement', 'replacement world reconstructs current vehicle durability', 'main', "  const vehicleInfo = vehicleDurability(w, selected, phase === 'battle' && V.r135);\n  // 只更新R135", "  const vehicleInfo = vehicleDurability({ ...w, units: [] }, selected, phase === 'battle' && V.r135);\n  // 只更新R135", (read, message) => {
  const f = uiFixture(read); f.refresh(); const fresh = structuredClone(f.w); fresh.units[0].hp = 1; f.c.w = fresh; f.refresh();
  assert(f.hint().startsWith(single(1, UNIT_KINDS[UK_TANK].hp)), message);
});
test('frame_disabled', 'disabled vehicle durability adds no frame calls on first or replacement world', 'main', 'if (vehicleInfo !== lastVehicleInfo)', 'if (true)', (read, message) => {
  const f = uiFixture(read, 'noR135=1'), calls = f.vehicleCalls(), writes = f.writes(); f.refresh(); eq(f.vehicleCalls(), calls, message);
  f.c.w = structuredClone(f.w); f.refresh(); eq(f.vehicleCalls(), calls, message); eq(f.writes(), writes, 'disabled frames leave original HUD untouched');
});
test('frame_empty', 'absent vehicle durability adds no unrelated frame calls', 'main', 'if (vehicleInfo !== lastVehicleInfo)', 'if (true)', (read, message) => {
  const f = uiFixture(read); f.selected.clear(); f.c.hud.update(); const calls = f.vehicleCalls(), writes = f.writes();
  f.refresh(); eq(f.vehicleCalls(), calls, message); f.c.w = structuredClone(f.w); f.refresh(); eq(f.vehicleCalls(), calls, message); eq(f.writes(), writes, 'empty frames leave existing HUD untouched');
});
test('frame_disable_clear', 'disabling an existing vehicle summary still clears stale HUD text', 'main', 'if (vehicleInfo !== lastVehicleInfo)', 'if (vehicleInfo && vehicleInfo !== lastVehicleInfo)', (read, message) => {
  const f = uiFixture(read); f.refresh(); assert(f.hint().includes('車輛耐久'), 'fixture begins with visible durability');
  f.c.q.set('noR135', '1'); f.refresh(); assert(!f.hint().includes('車輛耐久'), message);
  f.c.hud.update(); assert(f.hint().startsWith('血量 100%'), 'normal update with the disabled flag restores the original HUD');
});
test('frame_no_state', 'vehicle frames never call the full HUD state callback', 'main', 'hud?.vehicleFrame(vehicleInfo);', 'hud?.update();', (read, message) => {
  const f = uiFixture(read); f.refresh(); const calls = f.stateCalls(); f.w.units[0].hp--; f.refresh(); eq(f.stateCalls(), calls, message);
  const directCalls = f.stateCalls(); f.c.hud.vehicleFrame('測試耐久'); eq(f.stateCalls(), directCalls, 'direct vehicle presentation never reads simulation state');
});
test('frame_cached_legacy', 'vehicle frames cannot rescue another feature with a stale hint', 'main', 'hud?.vehicleFrame(vehicleInfo);', 'hud?.update();', (read, message) => {
  const f = uiFixture(read); f.refresh(); f.c.view.rangeInfo = '尚未由射程功能刷新'; f.w.units[0].hp--; f.refresh();
  assert(f.hint().includes('原射程') && !f.hint().includes('尚未由射程功能刷新'), message); assert(f.hint().startsWith(single(f.w.units[0].hp, UNIT_KINDS[UK_TANK].hp)), 'durability itself still refreshes');
  f.c.hud.update(); assert(f.hint().includes('尚未由射程功能刷新'), 'the existing normal HUD update still refreshes its own information');
});
test('frame_priority', 'vehicle-only frames preserve defined priority hints', 'hud', '!priorityHint && info', 'info', (read, message) => {
  const f = uiFixture(read); f.c.battleHint = '選擇這一格'; f.c.hud.update(); f.w.units[0].hp--; f.refresh(); eq(f.hint(), '選擇這一格', message);
  f.c.battleHint = undefined; f.c.hud.update(); assert(f.hint().startsWith(single(f.w.units[0].hp, UNIT_KINDS[UK_TANK].hp)), 'cancel restores the current summary');
});
test('build_scope', 'build phase does not show battle durability', 'main', "    const vehicleInfo = vehicleDurability(w, selected, phase === 'battle' && V.r135);", "    const vehicleInfo = vehicleDurability(w, selected, V.r135);", (read, message) => {
  const f = uiFixture(read); f.c.phase = 'build';
  // Read the real callback through a second initHud without adding test-only production exports.
  let state; f.c.initHud = actions => { state = actions.state(); return { update() {}, frame() {} }; };
  vm.runInContext(section(mainPlain, 'hud = initHud({', '\nreportView = initReportView'), f.c); eq(state.vehicleInfo, '', message);
});

const mutant = process.argv.find(arg => arg.startsWith('--mutant='))?.slice(9), selectedGroup = process.env.R135_GROUP;
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutant');
  for (const [from, to] of [[m.from, m.to], ...(m.extra ? [m.extra] : [])]) {
    eq(sources[m.file].split(from).length - 1, 1, `${mutant}: unique production anchor`); sources[m.file] = sources[m.file].replace(from, to);
  }
}
async function load(key) { const url = new URL(paths[key], import.meta.url), js = stripTypeScriptTypes(sources[key]).replace(/from '([^']+)'/g, (_, spec) => `from '${new URL(spec, url).href}'`); return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`); }
const { vehicleDurability: read } = await load('ui'), { initHud } = await load('hud'), mainPlain = stripTypeScriptTypes(sources.main);
let count = 0;
for (const [name, run] of Object.entries(cases)) {
  if (selectedGroup && name !== selectedGroup) continue;
  try { run(read, mutations[name].message); count++; }
  catch (error) { console.error('FIRST_VEHICLE_FAILURE=' + JSON.stringify({ group: name, name: error.name, message: error.message.split('\n')[0] })); throw error; }
}
if (!mutant) {
  for (const [name, m] of Object.entries(mutations)) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 25000, env: { ...process.env, R135_GROUP: name } });
    const output = `${child.stdout}\n${child.stderr}`, first = output.match(/^FIRST_VEHICLE_FAILURE=(.*)$/m);
    eq(child.error, undefined, `${name}: negative completes`); assert.notEqual(child.status, 0, `${name}: mutant fails`); assert(first, `${name}: must reach semantic assertion, not syntax/import error\n${output}`);
    assert.deepEqual(JSON.parse(first[1]), { group: name, name: 'AssertionError', message: m.message }, `${name}: exact intended first red\n${output}`);
  }
  console.log(`vehicle-durability: ${count} positive groups and ${Object.keys(mutations).length} isolated semantic negatives OK`);
}
assert(count > 0, 'at least one vehicle durability group executes');
