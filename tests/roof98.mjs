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
    u.id = w.units.length + 1; u.x = W.center(b.x + rnd(b.w)); u.z = W.center(b.z + rnd(b.d)); u.path = []; u.pathIdx = 0;
    w.units.push(u); out.push(u);
  }
  return out;
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
    else if (kind < 7) { const occupied = garr.map(u => home(w, u)).filter(b => b && b.hp > 0); const b = occupied.length ? occupied[rnd(occupied.length)] : live[0]; b.hp = Math.max(1, b.hp - Math.ceil(b.maxHp / 9)); ev = [{ e: 'stage', bld: b.id }]; }
    else if (kind === 7) { const b = live[rnd(live.length)]; b.hp = 0; ev = [{ e: 'stage', bld: b.id }]; }
    else if (kind === 8) {   // 新房子（R016 升起）：放在一格空地上，讓一個進駐的人站上去
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
    const w = world(map, seed), garr = garrison(w, 10), v = new BattleView(w, { fog: false, fx: true, r016: true });
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

run('rays', () => {
  allOn(true);
  for (const map of [1, 3, 128]) {
    for (const on of [true, false]) {
      setView98(on);
      const w = world(map, 3), garr = garrison(w, 8), v = new BattleView(w, { fog: false, fx: true, r016: true });
      v.snapshot(); v.update(0, 0.5, new Set()); for (const u of garr) v.unitHeight(u);
      const homes = new Set(garr.map(u => home(w, u)?.id)), empty = w.blds.find(b => b.hp > 0 && b.kind !== W.BK_HQ && !homes.has(b.id));
      empty.hp = Math.max(1, Math.floor(empty.hp * 0.4));
      rays = 0; v.onEvents([{ e: 'stage', bld: empty.id }], 1); v.update(0, 1, new Set()); for (const u of garr) v.unitHeight(u);
      if (on) assert.equal(rays, 0, `rays: map ${map}: a stage change on an empty building re-rays nobody`);
      else assert.equal(rays, garr.length, `rays: map ${map}: with ?noR098=1 a stage change re-rays every garrisoned unit, as before`);
      const occ = home(w, garr[0]), inside = garr.filter(u => home(w, u) === occ).length;
      occ.hp = Math.max(1, Math.floor(occ.hp * 0.4));
      rays = 0; v.onEvents([{ e: 'stage', bld: occ.id }], 2); v.update(0, 2, new Set()); for (const u of garr) v.unitHeight(u);
      if (on) assert.equal(rays, inside, `rays: map ${map}: a stage change re-rays only the units inside that building (${inside})`);
      rays = 0; v.setWorld(w); v.update(0, 3, new Set()); for (const u of garr) v.unitHeight(u);
      assert.equal(rays, garr.filter(u => home(w, u)?.hp > 0).length, `rays: map ${map}: a new world re-rays every garrisoned unit`);
      v.dispose?.();
    }
  }
  setView98(true);
});
proto.intersectObject = orig;
console.log('roof98: all OK');
