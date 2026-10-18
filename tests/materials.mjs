// R105：材質／整數耐久、三條建造路徑、實彈倒塌、舊紀錄與舊世界。
// 可給群組名稱單跑，供隔離副本的刻意破壞驗證；沒有參數時全跑。
import assert from 'node:assert/strict';
import {
  createWorld, hashWorld, bldMaterial, bldMaxHp, BLD_MATERIAL_NAMES,
  BM_WOOD, BM_BRICK, BM_STONE, BM_CONCRETE,
  BK_BARN, BK_HOUSE, BK_COTTAGE, BK_SHOP, BK_CHURCH, BK_HQ, BK_PILLBOX,
  N, SUB, center, idx, blocks, speedPct, stageOf,
  STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE,
  UK_TANK, UK_OBSERVER, UNIT_KINDS, ORD_IDLE, SHELL_AP,
} from '../src/sim/world.ts';
import { step, runLog, firstBlock } from '../src/sim/step.ts';
import { applyMap, MAP_RYE } from '../src/sim/maps.ts';
import { BUILD_KINDS_24, buildError } from '../src/sim/build.ts';
import { findPath } from '../src/sim/path.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from '../src/sim/script.ts';

const only = process.argv[2];
let groups = 0;
function group(name, fn) {
  if (only && only !== name) return;
  groups++;
  fn();
  console.log(`OK materials/${name}`);
}
// 獨立驗收標準，不拿 bldMaxHp 或材質函式自己當預期值。
const expectedHp = (kind, w, d, floors) => {
  if (kind === BK_HQ) return 1200;
  if (kind === BK_PILLBOX) return 400;
  if (kind === BK_BARN) return 30 + 30 * w * d * floors;
  if (kind === BK_CHURCH) return 120 + 50 * w * d * floors;
  return 50 + 40 * w * d * floors;
};
const ordinary = [BK_BARN, BK_HOUSE, BK_COTTAGE, BK_SHOP, BK_CHURCH];
const blank = () => {
  const w = createWorld(1944);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0);
  w.blds = []; w.units = []; w.shells = []; w.events = [];
  return w;
};
const addUnit = (w, side, kind, x, z) => {
  const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z),
    hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0,
    path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
  w.units.push(u);
  return u;
};
const addBld = (w, kind, x = 10, z = 10, bw = 2, bd = 2, floors = 1) => {
  const maxHp = bldMaxHp(kind, bw, bd, floors);
  const b = { id: w.blds.length + 1, kind, x, z, w: bw, d: bd, floors, hp: maxHp, maxHp };
  w.blds.push(b);
  for (let dz = 0; dz < bd; dz++) for (let dx = 0; dx < bw; dx++) w.occ[idx(x + dx, z + dz)] = b.id;
  return b;
};
const checkFactory = (w, label) => {
  assert(w.blds.length > 0, `${label}: actually produced buildings`);
  for (const b of w.blds) {
    const hp = expectedHp(b.kind, b.w, b.d, b.floors);
    assert.equal(b.maxHp, hp, `${label}: kind ${b.kind} maxHp`);
    assert.equal(b.hp, hp, `${label}: kind ${b.kind} starts full`);
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      assert.equal(w.occ[idx(x, z)], b.id, `${label}: footprint preserved`);
    }
  }
};

group('rules', () => {
  const classifications = [[BK_BARN, BM_WOOD], [BK_HOUSE, BM_BRICK], [BK_COTTAGE, BM_BRICK],
    [BK_SHOP, BM_BRICK], [BK_CHURCH, BM_STONE], [BK_HQ, BM_BRICK], [BK_PILLBOX, BM_CONCRETE]];
  assert.deepEqual([BLD_MATERIAL_NAMES[BM_WOOD], BLD_MATERIAL_NAMES[BM_BRICK],
    BLD_MATERIAL_NAMES[BM_STONE], BLD_MATERIAL_NAMES[BM_CONCRETE]], ['木造', '磚造', '石造', '混凝土']);
  for (const [kind, material] of classifications) assert.equal(bldMaterial(kind), material, `classification ${kind}`);
  for (let w = 1; w <= 4; w++) for (let d = 1; d <= 4; d++) for (let floors = 1; floors <= 3; floors++) {
    const hp = kind => bldMaxHp(kind, w, d, floors);
    assert(hp(BK_BARN) < hp(BK_HOUSE) && hp(BK_HOUSE) < hp(BK_CHURCH), 'same-volume wood < brick < stone');
    for (const [kind] of classifications) {
      assert(Number.isSafeInteger(hp(kind)), 'HP is a safe integer');
      assert.equal(hp(kind), expectedHp(kind, w, d, floors), `independent HP formula for ${kind}`);
      assert.equal(hp(kind), bldMaxHp(kind, d, w, floors), 'rotation preserves durability');
    }
  }
});

group('generated', () => {
  const seen = new Set();
  let count = 0;
  for (let seed = 0; seed < 200; seed++) {
    const w = createWorld(seed);
    checkFactory(w, `seed ${seed}`);
    for (const b of w.blds) seen.add(b.kind);
    count += w.blds.length;
    assert.equal(hashWorld(w), hashWorld(createWorld(seed)), 'material generation stays deterministic');
  }
  for (const kind of ordinary) assert(seen.has(kind), `generated coverage ${kind}`);
  console.log(`  ${count} buildings across 200 seeds`);
});

group('rye', () => {
  const w = createWorld(1944);
  applyMap(w, MAP_RYE);
  checkFactory(w, 'Rye');
  for (const kind of ordinary) assert(w.blds.some(b => b.kind === kind), `Rye coverage ${kind}`);
  const church = w.blds.find(b => b.kind === BK_CHURCH && b.w === 3 && b.d === 3);
  assert(church, 'Rye church exists');
  assert.equal(church.maxHp, 1020, 'Rye stone church 840 → 1020');
  console.log(`  ${w.blds.length} Rye buildings; church ${church.maxHp} HP`);
});

group('build', () => {
  // 每種、兩個方向、兩方都經過原本的 build 指令；每回從空場開始，避免點數互相干擾。
  for (const k of BUILD_KINDS_24) for (const side of [0, 1]) for (const rot of [0, 1]) {
    const w = blank();
    addUnit(w, 0, UK_OBSERVER, 30, 30); addUnit(w, 1, UK_OBSERVER, 1, 1);
    const c = { t: 'build', side, kind: k.kind, x: side ? 4 : 20, z: side ? 4 : 20, rot };
    assert.equal(buildError(w, c), null, 'material fixture build must be legal');
    step(w, [c]);
    assert.equal(w.blds.length, 1, 'build command accepted');
    checkFactory(w, `build kind ${k.kind} side ${side} rot ${rot}`);
    const b = w.blds[0];
    assert.equal(b.builtBy, side);
    assert.deepEqual([b.w, b.d, b.floors], [rot ? k.d : k.w, rot ? k.w : k.d, k.floors]);
  }
  const w = createWorld(1944);
  step(w, [{ t: 'eco' }]);
  const hqs = w.blds.filter(b => b.kind === BK_HQ);
  assert.equal(hqs.length, 2, 'both HQ factories still work');
  for (const b of hqs) assert.deepEqual([b.hp, b.maxHp], [1200, 1200], 'HQ fixed HP');
});

group('destruction', () => {
  const tank = UNIT_KINDS[UK_TANK], outcomes = [];
  for (const kind of [BK_BARN, BK_HOUSE, BK_CHURCH]) {
    const w = blank(), b = addBld(w, kind);
    const distance = Math.max(1, Math.min(4, Math.floor(tank.range / SUB)));
    const gun = addUnit(w, 0, UK_TANK, b.x - distance, b.z);
    addUnit(w, 1, UK_OBSERVER, N - 1, N - 1);
    const expectedShots = Math.ceil(expectedHp(kind, 2, 2, 1) / tank.dmgBld);
    const cap = (expectedShots + 2) * tank.reload + Math.ceil(tank.range / SUB);
    const stages = [];
    let fires = 0;
    assert(blocks(w, b.x, b.z), 'intact material blocks movement');
    assert(firstBlock(w, center(8), center(10), center(13), center(10)) >= 0, 'intact material blocks sight');
    for (let t = 0; t < cap && b.hp > 0; t++) {
      step(w, t === 0 ? [{ t: 'fireAt', side: 0, ids: [gun.id], x: b.x, z: b.z }] : []);
      fires += w.events.filter(e => e.e === 'fire' && e.unit === gun.id).length;
      stages.push(...w.events.filter(e => e.e === 'stage' && e.bld === b.id).map(e => e.stage));
      assert(Number.isInteger(b.hp) && b.hp >= 0, 'damage stays a nonnegative integer');
    }
    assert.equal(b.hp, 0, 'identical tank fire destroys material');
    assert.equal(fires, expectedShots, 'destruction uses unchanged tank damage');
    assert.deepEqual(stages, [STAGE_ROOFLESS, STAGE_RUBBLE], 'roofless then rubble events');
    assert.equal(stageOf(b), STAGE_RUBBLE);
    assert.equal(blocks(w, b.x, b.z), false, 'rubble no longer blocks');
    assert.equal(firstBlock(w, center(8), center(10), center(13), center(10)), -1, 'rubble clears sight');
    const path = findPath(w, 8, 10, 11, 10);
    assert(path.some(c => w.occ[c] === b.id) && path.at(-1) === idx(11, 10), 'rubble cells become reachable');
    assert.equal(speedPct(w, b.x, b.z), 45, 'rubble slowdown unchanged');
    assert.equal(w.occ[idx(b.x, b.z)], b.id, 'rubble keeps occupied-cell identity');
    outcomes.push({ kind, fires, tick: w.tick });
  }
  assert(outcomes[0].tick < outcomes[1].tick && outcomes[1].tick < outcomes[2].tick, 'same fire: wood falls before brick before stone');
  console.log(`  wood/brick/stone shots ${outcomes.map(o => o.fires).join('/')} ticks ${outcomes.map(o => o.tick).join('/')}`);
});

group('cover', () => {
  const hit = (kind, stage, collapse = false) => {
    const w = blank(), b = addBld(w, kind, 10, 10, 1, 1);
    if (stage === STAGE_ROOFLESS) b.hp = Math.floor(b.maxHp * 7 / 10);
    if (stage === STAGE_RUBBLE) b.hp = 0;
    if (collapse) b.hp = 1;
    const guard = addUnit(w, 0, UK_OBSERVER, 10, 10), gun = addUnit(w, 1, UK_TANK, 6, 10);
    guard.hp = 1000; gun.cooldown = UNIT_KINDS[UK_TANK].reload + 1;
    w.shells.push({ id: w.nextShell++, side: 1, kind: SHELL_AP, shooter: gun.id,
      sx: gun.x, sz: gun.z, ex: guard.x, ez: guard.z, t: 0, T: 1,
      target: collapse ? 0 : guard.id, hitBld: collapse ? b.id : 0 });
    step(w, []);
    return 1000 - guard.hp;
  };
  const damage = UNIT_KINDS[UK_TANK].dmgUnit, armor = UNIT_KINDS[UK_OBSERVER].armor;
  for (const kind of [BK_BARN, BK_HOUSE, BK_CHURCH, BK_PILLBOX]) {
    const pct = kind === BK_PILLBOX ? 25 : 50;
    for (const stage of [STAGE_INTACT, STAGE_ROOFLESS]) {
      assert.equal(hit(kind, stage), Math.floor(damage * armor * pct / 10000), 'material does not change intact/roofless cover');
    }
    assert.equal(hit(kind, STAGE_RUBBLE), Math.floor(damage * armor / 100), 'rubble gives no cover');
    assert.equal(hit(kind, STAGE_INTACT, true), Math.floor(20 * armor / 100), 'collapse injury unchanged, after cover ends');
  }
});

group('replay', () => {
  // 舊 JSON 完全沒有材質欄位，布陣照原本格式接受；也重播既有腳本。
  const oldBuild = JSON.parse('[{"tick":0,"cmd":{"t":"build","side":0,"kind":2,"x":24,"z":22}},{"tick":0,"cmd":{"t":"fireAt","side":1,"ids":[8],"x":24,"z":22}},{"tick":80,"cmd":{"t":"move","side":0,"ids":[9],"x":24,"z":22}}]');
  const first = runLog(createWorld(SCRIPT_SEED), oldBuild, 1).blds.find(b => b.builtBy === 0);
  assert(first && first.kind === BK_BARN && first.maxHp === 150, 'old build JSON accepts material rule without new fields');
  for (const log of [oldBuild, SCRIPT]) {
    const direct = runLog(createWorld(SCRIPT_SEED), log, SCRIPT_TICKS);
    const repeat = runLog(createWorld(SCRIPT_SEED), log, SCRIPT_TICKS);
    const json = runLog(createWorld(SCRIPT_SEED), JSON.parse(JSON.stringify(log)), SCRIPT_TICKS);
    const partial = runLog(createWorld(SCRIPT_SEED), log, SCRIPT_TICKS / 2), clone = structuredClone(partial);
    runLog(partial, log, SCRIPT_TICKS); runLog(clone, log, SCRIPT_TICKS);
    const hashes = [direct, repeat, json, partial, clone].map(hashWorld);
    assert(hashes.every(h => h === hashes[0]), `replay and clone match: ${hashes.join('/')}`);
    console.log(`  replay ${hashes[0]} × ${hashes.length}`);
  }
});

group('legacy', () => {
  // 直接構造 R105 前的純資料，沒有材質新欄位。已存的 190／840 HP 不遷移、不補血。
  const w = { seed: 1944, tick: 200, rng: 1, n: N,
    ter: new Uint8Array(N * N), occ: new Int32Array(N * N), crater: new Uint8Array(N * N),
    blds: [{ id: 1, kind: BK_BARN, x: 10, z: 10, w: 2, d: 2, floors: 1, hp: 133, maxHp: 190 },
      { id: 2, kind: BK_CHURCH, x: 16, z: 16, w: 3, d: 3, floors: 2, hp: 588, maxHp: 840 }],
    units: [], shells: [], nextShell: 1, winner: -1, events: [] };
  for (const b of w.blds) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) w.occ[idx(x, z)] = b.id;
  addUnit(w, 0, UK_OBSERVER, 30, 30); addUnit(w, 1, UK_OBSERVER, 1, 1);
  const before = w.blds.map(b => ({ ...b })), clone = structuredClone(w);
  for (let i = 0; i < 100; i++) { step(w, []); step(clone, []); }
  assert.deepEqual(w.blds, before, 'legacy saved HP and fields stay unchanged');
  assert.equal(hashWorld(w), hashWorld(clone), 'legacy world advances identically after clone');
  assert.deepEqual(w.blds.map(b => bldMaterial(b.kind)), [BM_WOOD, BM_STONE], 'legacy kind supplies material without migration');
  for (const b of w.blds) {
    assert.equal(stageOf(b), STAGE_ROOFLESS, 'legacy roof threshold uses saved maxHp');
    b.hp++;
    assert.equal(stageOf(b), STAGE_INTACT, 'one saved HP above 70% remains intact');
  }
});

assert(groups > 0, `unknown materials test group: ${only}`);
console.log(`materials: ${groups} groups passed`);
