// R098 屋頂高度只重算改過的那一棟（只改效能）：進駐單位的高度（battle.ts 的 unitHeight）以前一換段就全部清掉、每個人對整鎮重打射線；
// 現在腳下那一棟的樣子（段、磨損等級、還在不在升起）變了才重打。這支守衛看兩件事：
//   same：每一次事件之後，每個進駐單位從快取拿到的高度＝重新對整鎮打射線的，逐位一樣（地圖 1、2、3、鋪滿的 128，種子 1–2；全部畫面模組開著與預設各一次）；
//   rays：換段之後只有那一棟裡的人重打（數射線）；換世界之後全部重打；閥關著時跟以前一樣全部重打。
// node tests/roof98.mjs <群> 只跑一群。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import * as B from '../src/render/buildings.ts';
import { BattleView, setView98 } from '../src/render/battle.ts';
import { tile128 } from '../tools/tile128.mjs';

const only = process.argv[2], run = (name, f) => { if (only && only !== name) return; f(); console.log(`OK roof98/${name}`); };
let rs = 98; const rnd = m => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return (rs >>> 8) % m; };
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1, pla: 1, mg: 2 };
const allOn = on => { for (const f of [B.setWalls, B.setMaterials, B.setBuildingDetails, B.setHouseArt, B.setMoreArt, B.setWearArt, B.setDamageDetails, B.setFacades]) f?.(on); };

function world(map, seed) {
  const w = W.createWorld(seed);
  step(w, [{ t: 'map', id: map === 128 ? 3 : map, vegetation: 1, more: 1, sym: 1 }, ECO]);
  return map === 128 ? tile128(w) : w;
}
// 在 k 棟還站著的房子裡各放一個進駐的單位（步兵或觀測員；複製我方的一個）
function garrison(w, k) {
  const proto = w.units.find(u => u.side === W.SIDE_PLAYER && u.kind === W.UK_INFANTRY), obs = w.units.find(u => u.side === W.SIDE_PLAYER && u.kind === W.UK_OBSERVER);
  const homes = w.blds.filter(b => b.hp > 0 && b.kind !== W.BK_HQ && W.isWallKind(b.kind) === false), out = [];
  for (let i = 0; i < k && homes.length; i++) {
    const b = homes.splice(rnd(homes.length), 1)[0], u = structuredClone(i % 3 === 2 && obs ? obs : proto);
    u.id = w.units.length + 1; u.path = []; u.pathIdx = 0;
    // 一半站在格中央，一半隨便站（含貼著邊：鄰居的幾何會伸過來一點，審查 R098 時找到的）
    if (i % 2) { u.x = W.center(b.x + rnd(b.w)); u.z = W.center(b.z + rnd(b.d)); } else { const e = rnd(3); u.x = b.x * W.SUB + (e === 0 ? rnd(4) : e === 1 ? b.w * W.SUB - 1 - rnd(4) : rnd(b.w * W.SUB)); u.z = b.z * W.SUB + rnd(b.d * W.SUB); }
    w.units.push(u); out.push(u);
  }
  return out;
}
// 每個進駐單位旁邊的空格放一段鐵絲網（R121；擋路的是模擬的事，這裡只看城鎮網格裡的鐵絲網幾何）
function wires(w, garr) {
  const segs = w.wires?.segments ?? [];
  for (const u of garr) {
    const cx = Math.floor(u.x / W.SUB), cz = Math.floor(u.z / W.SUB);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]]) {
      const x = cx + dx, z = cz + dz;
      if (!W.inGrid(w, x, z) || !W.inGrid(w, x + 1, z) || w.occ[W.cellIdx(w, x, z)] || w.occ[W.cellIdx(w, x + 1, z)] || W.wireAt(w, x, z) || W.wireAt(w, x + 1, z)) continue;
      segs.push({ id: segs.length + 1, kind: W.BK_WIRE, x, z, w: 2, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 0 }); break;
    }
  }
  w.wires = { version: 1, segments: segs };
}
const target = v => v['pickTown'] ?? v.town;
const fresh = (v, u) => { const ray = new THREE.Raycaster(new THREE.Vector3(u.x / W.SUB, 20, u.z / W.SUB), new THREE.Vector3(0, -1, 0)); return ray.intersectObject(target(v), false)[0]?.point.y ?? 0; };
const home = (w, u) => { const id = w.occ[W.cellIdx(w, Math.floor(u.x / W.SUB), Math.floor(u.z / W.SUB))]; return id ? w.blds[id - 1] : null; };
// 數對城鎮網格打的射線
let rays = 0;
const proto = THREE.Raycaster.prototype, orig = proto.intersectObject;
proto.intersectObject = function (o, ...a) { if (o && o.isMesh && o.geometry && o.geometry.attributes?.position?.count > 1000) rays++; return orig.call(this, o, ...a); };

// 一串隨機事件：換段（大多是沒人的房子）、打成瓦礫、磨損、新房子升起（有人站上去）、升完
function events(w, v, garr, n, check) {
  let simT = 1;
  for (let r = 0; r < n; r++) {
    const kind = rnd(10), live = w.blds.filter(b => b.hp > 0 && b.kind !== W.BK_HQ);
    let ev = [];
    if (kind < 5) { const b = live[rnd(live.length)]; b.hp = Math.max(1, Math.floor(b.hp * (0.3 + rnd(60) / 100))); ev = [{ e: 'stage', bld: b.id }]; }
    else if (kind < 7) {
      // 有人的那一棟：模擬先扣耐久、網格要等之後的換段事件才重建（CI 的 section89 抓到的空檔）——中間先讓快取記一次，再送事件
      const occupied = garr.map(u => home(w, u)).filter(b => b && b.hp > 0); const b = occupied.length ? occupied[rnd(occupied.length)] : live[0];
      b.hp = Math.max(1, b.hp - Math.ceil(b.maxHp / 9));
      if (r % 2) { v.update(0, simT, new Set()); for (const u of garr) v.unitHeight(u); }
      ev = [{ e: 'stage', bld: b.id }];
    }
    else if (kind === 7) { const b = live[rnd(live.length)]; b.hp = 0; ev = [{ e: 'stage', bld: b.id }]; }
    else if (kind === 9 && r % 2) {   // 鄰居：某個進駐單位四周 3×3 格裡別的房子換段（或塌），或附近的鐵絲網被剪斷／修好
      const u = garr[rnd(garr.length)], cx = Math.floor(u.x / W.SUB), cz = Math.floor(u.z / W.SUB), mine = home(w, u), near = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, z = cz + dz; if (!W.inGrid(w, x, z)) continue; const id = w.occ[W.cellIdx(w, x, z)], b = id ? w.blds[id - 1] : null; if (b && b !== mine && b.hp > 0 && b.kind !== W.BK_HQ) near.push(b); }
      const seg = (w.wires?.segments ?? [])[rnd(Math.max(1, w.wires?.segments.length ?? 0))];
      if (near.length) { const b = near[rnd(near.length)]; b.hp = rnd(3) ? Math.max(1, Math.floor(b.hp * 0.4)) : 0; ev = [{ e: 'stage', bld: b.id }]; }
      else if (seg) { seg.hp = seg.hp > 0 ? 0 : 60; ev = [{ e: 'wire' }]; }
    }
    else if (kind === 8 || kind === 9) {   // 新房子（R016 升起）：放在一格空地上，讓一個進駐的人站上去
      for (let t = 0; t < 200; t++) {
        const x = 1 + rnd(w.n - 3), z = 1 + rnd(w.n - 3), i = W.cellIdx(w, x, z);
        if (w.occ[i] || w.ter[i] === W.TER_ROAD || w.ter[i] === W.TER_MUD) continue;
        const id = w.blds.length + 1, maxHp = W.bldMaxHp(W.BK_COTTAGE, 1, 1, 1);
        w.blds.push({ id, kind: W.BK_COTTAGE, x, z, w: 1, d: 1, floors: 1, hp: maxHp, maxHp, builtBy: 0 }); w.occ[i] = id;
        const u = garr[rnd(garr.length)]; u.x = W.center(x); u.z = W.center(z);
        ev = [{ e: 'build', bld: id }]; break;
      }
    } else simT += 2;   // 讓升起的房子升完（R016 的 RISE_S）
    simT += 0.25;
    v.onEvents(ev, simT); v.update(0, simT, new Set());
    check(r, ev);
  }
}

run('same', () => {
  let checks = 0, garrisoned = 0, changed = 0;
  for (const modules of [true, false]) for (const map of modules ? [1, 2, 3, 128] : [1, 3]) for (const seed of modules && map < 100 ? [1, 2] : [1]) {
    allOn(modules); setView98(true);
    const w = world(map, seed), garr = garrison(w, 10); wires(w, garr); const v = new BattleView(w, { fog: false, fx: true, r016: true });
    v.snapshot(); v.update(0, 0.5, new Set());
    const before = new Map(garr.map(u => [u.id, v.unitHeight(u)]));
    events(w, v, garr, map === 128 ? 30 : 36, (r, ev) => {
      for (const u of garr) {
        const b = home(w, u); if (!b || b.hp <= 0) continue;
        const got = v.unitHeight(u), want = fresh(v, u);
        assert(Object.is(got, want), `same: map ${map} seed ${seed} modules ${modules} event ${r} (${JSON.stringify(ev)}): unit ${u.id} roof height from the cache ${got} equals a fresh ray on the whole town ${want}`);
        checks++; if (got > 0) garrisoned++; if (got !== before.get(u.id)) changed++;
      }
    });
    v.dispose?.();
  }
  allOn(true);
  assert(checks >= 1500 && garrisoned >= 1200 && changed >= 50, `same: coverage (${checks} checks, ${garrisoned} on a roof or floor, ${changed} heights changed during the run)`);
  console.log(`  ${checks} cached heights equal a fresh whole-town ray (${garrisoned} above ground, ${changed} changed by an event)`);
});

run('neighbour', () => {
  // 審查 R098 找到的：萊伊（種子 1）教堂 b4（11,18）的幾何伸進隔壁房子 b26（12,18）0.03 格；單位站在 b26 的那條縫裡、教堂換段時要重打
  allOn(true); setView98(true);
  const w = world(1, 1), church = w.blds.find(b => b.x === 11 && b.z === 18), house = w.blds.find(b => b.x === 12 && b.z === 18);
  assert(church && house, 'neighbour: the Rye church and the house next to it are where the review found them');
  const proto = w.units.find(u => u.side === W.SIDE_PLAYER && u.kind === W.UK_INFANTRY), garr = [];
  for (const dx of [1, 3, 5]) { const u = structuredClone(proto); u.id = w.units.length + 1; u.x = 12 * W.SUB + dx; u.z = Math.floor(18.5 * W.SUB); u.path = []; u.pathIdx = 0; w.units.push(u); garr.push(u); }
  const v = new BattleView(w, { fog: false, fx: true, r016: true }); v.snapshot(); v.update(0, 0.5, new Set());
  for (const u of garr) assert(Object.is(v.unitHeight(u), fresh(v, u)), 'neighbour: before the church changes, the cached height is the fresh one');
  church.hp = Math.floor(church.hp * 0.5); v.onEvents([{ e: 'stage', bld: church.id }], 1); v.update(0, 1, new Set());
  for (const u of garr) { const got = v.unitHeight(u), want = fresh(v, u); assert(Object.is(got, want), `neighbour: after the church next door changes stage, unit at x=${(u.x / W.SUB).toFixed(3)} re-rays (${got} vs fresh ${want})`); }
  v.dispose?.();
  // 審查 R098 找到的另一個：鐵絲網的鐵線剛好伸到隔壁房子的邊上；單位貼著那一邊、鐵絲網被剪斷時要重打
  let wired = 0;
  for (const map of [1, 3]) {
    const w2 = world(map, 5), segs = [];
    for (const b of w2.blds) {
      if (segs.length >= 6 || b.hp <= 0 || b.kind === W.BK_HQ || W.isWallKind(b.kind) || b.x < 3) continue;
      const free = [b.x - 2, b.x - 1].every(x => !w2.occ[W.cellIdx(w2, x, b.z)] && w2.ter[W.cellIdx(w2, x, b.z)] !== W.TER_MUD);
      if (free) segs.push({ id: segs.length + 1, kind: W.BK_WIRE, x: b.x - 2, z: b.z, w: 2, d: 1, floors: 1, hp: 60, maxHp: 60, builtBy: 0, home: b });
    }
    w2.wires = { version: 1, segments: segs.map(({ home, ...seg }) => seg) };
    const units = segs.map((seg, k) => { const u = structuredClone(proto); u.id = w2.units.length + 1; u.x = seg.home.x * W.SUB + (k % 3); u.z = Math.floor((seg.home.z + 0.5) * W.SUB) + (k % 5) - 2; u.path = []; u.pathIdx = 0; w2.units.push(u); return u; });
    const v2 = new BattleView(w2, { fog: false, fx: true, r016: true }); v2.snapshot(); v2.update(0, 0.5, new Set());
    for (const u of units) v2.unitHeight(u);
    for (const seg of w2.wires.segments) seg.hp = 0;
    v2.onEvents([{ e: 'wire' }], 1); v2.update(0, 1, new Set());
    for (const u of units) { const got = v2.unitHeight(u), want = fresh(v2, u); assert(Object.is(got, want), `neighbour: map ${map} after the wire next door is cut, unit at ${(u.x / W.SUB).toFixed(3)},${(u.z / W.SUB).toFixed(3)} re-rays (${got} vs fresh ${want})`); wired++; }
    v2.dispose?.();
  }
  assert(wired >= 8, `neighbour: coverage (${wired} units next to a cut wire)`);
});

run('rays', () => {
  allOn(true);
  for (const map of [1, 3, 128]) {
    for (const on of [true, false]) {
      setView98(on);
      const w = world(map, 3), garr = garrison(w, 8), v = new BattleView(w, { fog: false, fx: true, r016: true });
      v.snapshot(); v.update(0, 0.5, new Set()); for (const u of garr) v.unitHeight(u);
      const near = (b, u) => { const cx = Math.floor(u.x / W.SUB), cz = Math.floor(u.z / W.SUB); return cx >= b.x - 1 && cx <= b.x + b.w && cz >= b.z - 1 && cz <= b.z + b.d; };
      const empty = w.blds.find(b => b.hp > 0 && b.kind !== W.BK_HQ && !garr.some(u => near(b, u)));
      empty.hp = Math.max(1, Math.floor(empty.hp * 0.4));
      rays = 0; v.onEvents([{ e: 'stage', bld: empty.id }], 1); v.update(0, 1, new Set()); for (const u of garr) v.unitHeight(u);
      if (on) assert.equal(rays, 0, `rays: map ${map}: a stage change on a building with nobody in or next to it re-rays nobody`);
      else assert.equal(rays, garr.length, `rays: map ${map}: with ?noR098=1 a stage change re-rays every garrisoned unit, as before`);
      const occ = home(w, garr[0]), inside = garr.filter(u => home(w, u)?.hp > 0 && near(occ, u)).length;
      occ.hp = Math.max(1, Math.floor(occ.hp * 0.4));
      rays = 0; v.onEvents([{ e: 'stage', bld: occ.id }], 2); v.update(0, 2, new Set()); for (const u of garr) v.unitHeight(u);
      if (on) assert.equal(rays, inside, `rays: map ${map}: a stage change re-rays only the units in or next to that building (${inside})`);
      rays = 0; v.setWorld(w); v.update(0, 3, new Set()); for (const u of garr) v.unitHeight(u);
      assert.equal(rays, garr.filter(u => home(w, u)?.hp > 0).length, `rays: map ${map}: a new world re-rays every garrisoned unit`);
      v.dispose?.();
    }
  }
  setView98(true);
});
proto.intersectObject = orig;
console.log('roof98: all OK');
