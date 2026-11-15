// R075 看得懂：不開瀏覽器的部分。士氣第二版（rules 的 morale＝2：潰退真的會發生）跟第一版差的四件事、旗標與存檔、
// 選中單位那一行字（src/ui/unitSpec.ts）、設定頁的說明、釘住的步兵趴下（畫面，在 Node 裡建 BattleView 讀實例）。
// 用法：node tests/morale2.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/morale2.mjs <群組名>   只跑那一群（隔離副本裡用）
// 對戰的數字用 tools/duel.mjs 量，寫在卡面；真實 Chrome 在 tests/readable-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY, BK_HOUSE, BK_PILLBOX,
  UK_TANK, UK_HOWITZER, UK_INFANTRY, UK_OBSERVER, UK_MORTAR, UK_HEAVY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { applyRules } from '../src/sim/rules.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { suppress, moraleStep, moraleState, SUP_LOSS, SUP_LOSS_RANGE, SUP_LOSS_2, SUP_LOSS_RANGE_2, ROUT_CELLS, ROUT_CELLS_2, WOUNDED_PCT, MORALE_PINNED, MORALE_BROKEN } from '../src/sim/morale.ts';
import { ARMOR_MM, penetration } from '../src/sim/ballistics.ts';
import { VEG_WOOD, VEGETATION_VERSION } from '../src/sim/vegetation.ts';
import { unitSpec } from '../src/ui/unitSpec.ts';

assert.deepEqual([SUP_LOSS, SUP_LOSS_RANGE, SUP_LOSS_2, SUP_LOSS_RANGE_2, ROUT_CELLS, ROUT_CELLS_2, WOUNDED_PCT], [15, 3 * SUB, 30, 4 * SUB, 3, 5, 150], 'fixture: the numbers on the card are the numbers in src/sim/morale.ts');
const C = center(16);
// 一片空地，上面只放守衛自己擺的東西；version＝士氣規則第幾版（0＝沒開）；ap＝開不開穿甲
function field(version, ap = false) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (version || ap) applyRules(w, { ...(version ? { morale: version } : {}), ...(ap ? { ap: 1 } : {}) });
  return w;
}
function put(w, side, kind, cx, cz) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const building = (w, kind, x, z) => { const b = { id: w.blds.length + 1, kind, x, z, w: 1, d: 1, floors: 1, hp: 400, maxHp: 400 }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
const trench = (w, x, z) => { w.trenches ??= { version: 1, segments: [] }; w.trenches.segments.push({ side: SIDE_PLAYER, kind: 0, x, z, rot: 0 }); };
// 把 (16,16) 的我方步兵班一口氣壓到垮掉，回傳它（有沒有轉身跑看 rout、order、tx、tz）
function broken(version, prepare = () => {}) {
  const w = field(version), u = put(w, SIDE_PLAYER, UK_INFANTRY, 16, 16);
  prepare(w);
  suppress(w, u, 400);
  assert.equal(moraleState(u), MORALE_BROKEN, 'fixture: the squad is broken');
  return u;
}

const groups = {
  // 旗標：存得進去、折進雜湊、其他值不算、存檔來回、第一版逐位不變
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const one = createWorld(3), two = createWorld(3);
    applyRules(one, { morale: 1 }); applyRules(two, { morale: 2 });
    assert.deepEqual([one.rules, two.rules], [{ morale: 1 }, { morale: 2 }], 'flag: morale 2 is stored as the second version');
    assert.notEqual(hashWorld(one), hashWorld(two), 'flag: the two versions hash differently');
    for (const v of [0, 3, -1, 2.5]) { const w = createWorld(3); applyRules(w, { morale: v }); assert.equal(w.rules, undefined, `flag: morale ${v} is not a version and leaves no state`); }
    assert.deepEqual([isCommand({ t: 'rules', morale: 2 }), isCommand({ t: 'rules', morale: 'two' })], [true, false], 'flag: the command check takes the number');
    const log = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, end: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 2 }, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 2 }].map(cmd => ({ tick: 0, cmd }));
    const mid = runLog(createWorld(21), log, 1500), direct = hashWorld(runLog(createWorld(21), log, 2500));
    assert(mid.units.some(u => u.sup), 'fixture: somebody is suppressed mid-battle');
    assert.equal(hashWorld(runLog(structuredClone(mid), log, 2500)), direct, 'flag: a deep copy taken mid-battle continues bit for bit');
    assert.deepEqual(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(mid)))), { ...mid, events: [] }, 'flag: a second-version battle survives the save codec field for field');
  },
  // A. 看到旁邊的人倒下：第一版 3 格內 +15，第二版 4 格內 +30
  loss() {
    const witness = (version, gap) => {
      const w = field(version), dead = put(w, SIDE_PLAYER, UK_INFANTRY, 16, 16), near = put(w, SIDE_PLAYER, UK_INFANTRY, 16, 16);
      near.x = C + gap; dead.alive = false; dead.hp = 0;
      w.events = [{ e: 'kill', unit: dead.id }];
      moraleStep(w);
      return near.sup ?? 0;
    };
    assert.deepEqual([witness(1, 2 * SUB), witness(2, 2 * SUB)], [15, 30], 'loss: a friend dying two cells away adds 15 in the first version and 30 in the second');
    assert.deepEqual([witness(1, 3 * SUB + 128), witness(2, 3 * SUB + 128)], [0, 30], 'loss: three and a half cells away it adds nothing in the first version and 30 in the second');
    assert.equal(witness(2, 4 * SUB + 1), 0, 'loss: beyond four cells it adds nothing in the second version either');
  },
  // C. 打殘的班更容易垮：第二版血量不到一半時吃到的壓制 ×1.5
  wounded() {
    const take = (version, hp) => { const w = field(version), u = put(w, SIDE_PLAYER, UK_INFANTRY, 16, 16); u.hp = hp; suppress(w, u, 20); return u.sup; };
    const full = UNIT_KINDS[UK_INFANTRY].hp;
    assert.deepEqual([take(1, full), take(2, full)], [20, 20], 'fixture: a full-strength squad takes the same in both versions');
    assert.deepEqual([take(1, 29), take(2, 29)], [20, 30], 'wounded: below half strength the second version adds half as much again');
    assert.equal(take(2, 30), 20, 'wounded: exactly half strength is not below half');
  },
  // D. 一退退多遠：第一版 3 格，第二版 5 格（我方往右下退）
  distance() {
    const a = broken(1), b = broken(2);
    assert.deepEqual([a.rout, a.order, a.tx, a.tz], [1, ORD_MOVE, 19, 19], 'distance: in the first version a broken squad in the open falls back three cells');
    assert.deepEqual([b.rout, b.order, b.tx, b.tz], [1, ORD_MOVE, 21, 21], 'distance: in the second version it falls back five');
  },
  // E. 垮了守不守得住：第一版有任何掩體就不跑；第二版只有碉堡與戰壕留得住
  holds() {
    const house = w => building(w, BK_HOUSE, 16, 16), pillbox = w => building(w, BK_PILLBOX, 16, 16);
    const wood = w => { w.vegetation = { version: VEGETATION_VERSION, cells: new Uint8Array(w.n * w.n) }; w.vegetation.cells[cellIdx(w, 16, 16)] = VEG_WOOD; };
    const crater = w => { w.crater[cellIdx(w, 16, 16)] = 1; };
    for (const [name, prepare] of [['a house', house], ['a wood', wood], ['a shell crater', crater]]) {
      assert.equal(broken(1, prepare).rout, undefined, `fixture: in the first version a broken squad in ${name} stays put`);
      const u = broken(2, prepare);
      assert(u.rout === 1 && u.order === ORD_MOVE && u.path.length > 0 && (u.tx !== 16 || u.tz !== 16), `holds: in the second version a broken squad leaves ${name} and runs (rout ${u.rout}, to ${u.tx},${u.tz})`);
    }
    assert.equal(broken(2, pillbox).rout, undefined, 'holds: a pillbox still holds a broken squad');
    assert.equal(broken(2, w => trench(w, 16, 16)).rout, undefined, 'holds: a trench still holds a broken squad');
    const gun = (() => { const w = field(2), g = put(w, SIDE_PLAYER, UK_MORTAR, 16, 16); suppress(w, g, 400); return g; })();
    assert.deepEqual([moraleState(gun), gun.rout], [MORALE_BROKEN, undefined], 'holds: gun crews still do not run in either version');
  },
  // 選中單位那一行字
  spec() {
    const sel = (...us) => new Set(us.map(u => u.id));
    {
      const w = field(0, true), t = put(w, SIDE_PLAYER, UK_TANK, 10, 10), t2 = put(w, SIDE_PLAYER, UK_TANK, 11, 10), h = put(w, SIDE_PLAYER, UK_HEAVY, 12, 10), how = put(w, SIDE_PLAYER, UK_HOWITZER, 13, 10), foe = put(w, SIDE_ENEMY, UK_TANK, 20, 10);
      const plate = ARMOR_MM[UK_TANK], near = penetration(UK_TANK, SUB), far = penetration(UK_TANK, UNIT_KINDS[UK_TANK].range);
      assert.deepEqual([plate, near, far], [[30, 20, 15], 44, 33], 'fixture: the medium tank\'s plates and penetration as the card quotes them');
      assert.equal(unitSpec(w, sel(t)), '裝甲 正 30／側 20／後 15 公釐；穿深 近 44／遠 33 公釐', 'spec: one tank shows its plates front, side, rear and its penetration near and far');
      assert.equal(unitSpec(w, sel(t, t2)), unitSpec(w, sel(t)), 'spec: several of the same kind show the same line');
      assert.equal(unitSpec(w, sel(t, h)), '', 'spec: mixed kinds show no plates (there is no room for two on one line)');
      assert.equal(unitSpec(w, sel(how)), '', 'spec: a howitzer has neither armour nor a direct-fire gun to quote');
      assert.equal(unitSpec(w, sel(foe)), '', 'spec: enemy units are not described');
      assert.equal(unitSpec(w, sel(t), false), '', 'spec: disabled means no text');
      assert.equal(unitSpec(w, sel(t), true, '｜').slice(0, 4), '｜裝甲 ', 'spec: the lead is put in front of a non-empty line');
      assert.equal(unitSpec(w, sel(foe), true, '｜'), '', 'spec: and not in front of an empty one');
      assert.equal(unitSpec(field(0), sel(t)), '', 'spec: with neither rule on there is no line');
    }
    {
      const w = field(2), squads = [0, 45, 75, 95].map((sup, i) => { const u = put(w, SIDE_PLAYER, UK_INFANTRY, 10 + i, 10); if (sup) u.sup = sup; return u; }), tank = put(w, SIDE_PLAYER, UK_TANK, 10, 12);
      assert.equal(unitSpec(w, sel(...squads)), '士氣：穩定 1、受壓 1、釘住 1、潰退 1', 'spec: the morale line counts each state');
      assert.equal(unitSpec(w, sel(squads[0])), '士氣穩定', 'spec: steady troops get the short form');
      assert.equal(unitSpec(w, sel(squads[2], tank)), '士氣：釘住 1', 'spec: armoured vehicles are not counted (they cannot be suppressed)');
      assert.equal(unitSpec(w, sel(tank)), '', 'spec: a tank alone has no morale to report');
      squads[2].alive = false;
      assert.equal(unitSpec(w, sel(squads[1], squads[2])), '士氣：受壓 1', 'spec: the dead are not counted');
    }
    {
      const w = field(1, true), t = put(w, SIDE_PLAYER, UK_TANK, 10, 10), s = put(w, SIDE_PLAYER, UK_INFANTRY, 11, 10);
      s.sup = 75;
      assert.equal(unitSpec(w, sel(t, s)), '士氣：釘住 1', 'spec: with both rules on and mixed kinds only the morale line shows');
      assert(unitSpec(w, sel(s)).endsWith('；士氣：釘住 1') && unitSpec(w, sel(s)).startsWith('穿深 近 '), `spec: a squad on its own shows its anti-tank rifle and its morale (${unitSpec(w, sel(s))})`);
    }
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`morale2/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK morale2/${name}`); }

// ---- 畫面、設定頁、接線（不在隔離副本裡跑：要 three 與介面的模組）----
{
  const THREE = await import('three');
  const { BattleView, PRONE_TILT, PRONE_LIFT } = await import('../src/render/battle.ts');
  const FLAGS = { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true };
  const drawn = (version, sup, moving = false, routing = false) => {
    const w = field(version), u = put(w, SIDE_PLAYER, UK_INFANTRY, 16, 16);
    if (sup) u.sup = sup;
    if (moving) { u.order = ORD_MOVE; u.path = [cellIdx(w, 17, 16)]; u.pathIdx = 0; }
    if (routing) u.rout = 1;
    const v = new BattleView(w, FLAGS);
    v.update(0, 1, new Set());
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    v.men.getMatrixAt(0, m); m.decompose(p, q, s); e.setFromQuaternion(q, 'XYZ');
    return { prone: v.menDbg.prone, alive: v.menDbg.alive, y: p.y, tilt: e.z, count: v.men.count };
  };
  const up = drawn(2, 0), down = drawn(2, 75), gone = drawn(2, 95);
  assert.deepEqual([up.prone, down.prone, down.alive, gone.prone], [0, 6, 6, 6], 'prone: a pinned or broken squad that is not running is drawn lying down, a steady one standing');
  assert(Math.abs(down.tilt - PRONE_TILT) < 1e-6 && Math.abs(up.tilt) < 1e-6 && Math.abs(down.y - up.y - PRONE_LIFT) < 1e-6, `prone: the pose is the tilt and lift named in battle.ts (tilt ${down.tilt}, lift ${down.y - up.y})`);
  assert.equal(down.count, up.count, 'prone: lying down uses the same instances (no extra draw work)');
  assert.equal(drawn(2, 45).prone, 0, 'prone: a merely suppressed squad stays on its feet');
  assert.equal(drawn(2, 95, true, true).prone, 0, 'prone: a squad that is running away is not drawn lying down');
  assert.equal(drawn(2, 75, true).prone, 6, 'prone: a pinned squad lies down even with orders still pending (it cannot move anyway)');
  assert.equal(drawn(1, 75).prone, 0, 'prone: battles under the first version look as they did');
  console.log('OK morale2/prone');

  const { menuLayout, rulesNote, AP_NOTE, MORALE_NOTE } = await import('../src/ui/startMenu.ts');
  const { rulesCommand } = await import('../src/ui/skirmish.ts');
  const page = setup => menuLayout({ page: 'setup', mode: 'battle', setup: { force: 2, supply: 2, seed: 1, ...setup } });
  const noteOf = setup => page(setup).rows.find(r => r.id === 'sm-rules')?.note;
  assert.deepEqual([rulesNote(true, true), rulesNote(true, false), rulesNote(false, true)], [`${AP_NOTE}\n${MORALE_NOTE}`, AP_NOTE, MORALE_NOTE], 'help: the note names each rule that has a switch on the page');
  assert(AP_NOTE.includes('彈開') && AP_NOTE.includes('側面') && MORALE_NOTE.includes('釘住') && MORALE_NOTE.includes('往後跑') && MORALE_NOTE.includes('戰壕'), 'help: the notes say what the rule is, what it looks like and what to do');
  assert.deepEqual([noteOf({ ap: false, morale: false, help: true }), noteOf({ ap: true, help: true }), noteOf({ ap: false, morale: false })], [`${AP_NOTE}\n${MORALE_NOTE}`, AP_NOTE, undefined], 'help: the setup page carries the note under the realism switches, and none without the flag');
  assert.deepEqual([rulesCommand(2, 2, false, true, 2), rulesCommand(2, 2, true, true, 2), rulesCommand(2, 2, false, true)], [{ t: 'rules', morale: 2 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'rules', morale: 1 }], 'wiring: the setup page can send either version; the default is the first');
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../src/valves.ts'), /get r075\(\) \{ return on\('075'\); \}/, 'valve: r075 is on the table');
  assert.match(read('../src/ui/skirmish.ts'), /rulesCommand\(s\.force, s\.supply, s\.ap, s\.morale, valves\(q\)\.r075 \? 2 : 1\)/, 'wiring: a new battle sends the second version, behind the valve');
  assert.match(read('../src/main.ts'), /\$\{V\.r075 \? unitSpec\(w, selected, phase === 'battle', '｜'\) : ''\}/, 'wiring: the selection line carries the spec, behind the valve');
  assert.match(read('../README.md'), /\?noR075=1/, 'readme: the valve is documented');
  console.log('OK morale2/help and wiring');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r075-negative-'));
const mutants = [
  ['not_stored', 'flag', 'src/sim/rules.ts', 'cmd.morale === 1 || cmd.morale === 2 ? cmd.morale : 0', 'cmd.morale === 1 ? 1 : 0', 'flag: morale 2 is stored as the second version'],
  ['any_number', 'flag', 'src/sim/rules.ts', 'cmd.morale === 1 || cmd.morale === 2 ? cmd.morale : 0', '(cmd.morale ?? 0) > 0 ? cmd.morale : 0', 'flag: morale 3 is not a version and leaves no state'],
  ['second_is_first', 'loss', 'src/sim/morale.ts', 'const second = (w: World): boolean => w.rules?.morale === 2;', 'const second = (_w: World): boolean => false;', 'loss: a friend dying two cells away adds 15 in the first version and 30 in the second'],
  ['first_is_second', 'loss', 'src/sim/morale.ts', 'const second = (w: World): boolean => w.rules?.morale === 2;', 'const second = (w: World): boolean => !!w.rules?.morale;', 'loss: a friend dying two cells away adds 15 in the first version and 30 in the second'],
  ['short_sighted', 'loss', 'src/sim/morale.ts', '(second(w) ? SUP_LOSS_RANGE_2 : SUP_LOSS_RANGE)', '(SUP_LOSS_RANGE)', 'loss: three and a half cells away it adds nothing in the first version and 30 in the second'],
  ['no_wounded', 'wounded', 'src/sim/morale.ts', '  if (second(w) && u.hp * 2 < UNIT_KINDS[u.kind].hp) a = Math.floor((a * WOUNDED_PCT) / 100);\n', '', 'wounded: below half strength the second version adds half as much again'],
  ['short_rout', 'distance', 'src/sim/morale.ts', 'cells = second(w) ? ROUT_CELLS_2 : ROUT_CELLS;', 'cells = ROUT_CELLS;', 'distance: in the second version it falls back five'],
  ['house_holds', 'holds', 'src/sim/morale.ts', "(second(w) ? bldAt(w, x, z)?.kind === BK_PILLBOX || trenchCover(w, x, z) < 100 : coverPct(w, u) < 100)", '(coverPct(w, u) < 100)', 'holds: in the second version a broken squad leaves a house and runs'],
  ['pillbox_abandoned', 'holds', 'src/sim/morale.ts', 'bldAt(w, x, z)?.kind === BK_PILLBOX || trenchCover(w, x, z) < 100', 'trenchCover(w, x, z) < 100', 'holds: a pillbox still holds a broken squad'],
  ['trench_abandoned', 'holds', 'src/sim/morale.ts', 'bldAt(w, x, z)?.kind === BK_PILLBOX || trenchCover(w, x, z) < 100', 'bldAt(w, x, z)?.kind === BK_PILLBOX', 'holds: a trench still holds a broken squad'],
  ['side_and_rear_swapped', 'spec', 'src/ui/unitSpec.ts', '`裝甲 正 ${plate[0]}／側 ${plate[1]}／後 ${plate[2]} 公釐`', '`裝甲 正 ${plate[0]}／側 ${plate[2]}／後 ${plate[1]} 公釐`', 'spec: one tank shows its plates front, side, rear and its penetration near and far'],
  ['far_is_near', 'spec', 'src/ui/unitSpec.ts', 'penetration(kind, k.range)', 'penetration(kind, SUB)', 'spec: one tank shows its plates front, side, rear and its penetration near and far'],
  ['mixed_plates', 'spec', 'src/ui/unitSpec.ts', 'if (w.rules?.ap && sel.every(u => u.kind === sel[0].kind)) {', 'if (w.rules?.ap) {', 'spec: mixed kinds show no plates'],
  ['enemy_described', 'spec', 'src/ui/unitSpec.ts', ' && u.side === SIDE_PLAYER);', ');', 'spec: enemy units are not described'],
  ['tanks_have_morale', 'spec', 'src/ui/unitSpec.ts', 'if (!UNIT_KINDS[u.kind].armored && u.kind !== UK_ZOMBIE) n[moraleState(u)]++;', 'n[moraleState(u)]++;', 'spec: armoured vehicles are not counted'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'src/ui'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'src/ui/unitSpec.ts'), join(dir, 'src/ui/unitSpec.ts'));
    cpSync(join(root, 'tests/morale2.mjs'), join(dir, 'tests/morale2.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/morale2.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK morale2-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`morale2: all groups OK, ${mutants.length} isolated mutants rejected`);
