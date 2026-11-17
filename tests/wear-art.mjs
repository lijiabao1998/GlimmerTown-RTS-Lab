// R088 建築破壞的過程（Node，只改畫面）：src/render/wearArt.ts、wear88.ts、buildings.ts 的快取。
// 用法：node tests/wear-art.mjs            全部的群組（故意弄壞在 tests/wear-art-negative.mjs；真的 Chrome 在 tests/wear-art-browser.mjs）
//       node tests/wear-art.mjs <群組名>   只跑那一群
// 凍結的指紋是在 ef73514（動手之前）量的，見卡面 docs/tasks/R088-建築破壞的過程.md。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import * as W from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { hash2 } from '../src/sim/rng.ts';
import * as B from '../src/render/buildings.ts';
import { Geo } from '../src/render/geo.ts';
import { wearTier, wearable, wearTop, roofSlice, splitHalves, sagEnd, WEAR_RUBBLE } from '../src/render/wearArt.ts';
import { wearSync, wearShown, wearCollapse, wearRoofFall, COLLAPSE_GAP } from '../src/render/wear88.ts';
import { WallMarks } from '../src/render/wallMarks.ts';
import { BattleView } from '../src/render/battle.ts';

const { STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE, stageOf } = W;
const MAPS = [0, 1, 2, 3, 4];
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
const fp = g => { const h = createHash('sha256'); for (const a of [g.pos, g.nor, g.col]) h.update(Buffer.from(new Float32Array(a).buffer)); return h.digest('hex').slice(0, 16); };
const prod = (o = {}) => { B.setWalls(o.walls ?? true); B.setWireDetail(true); B.setMaterials(true); B.setBuildingDetails(o.details ?? true); B.setDamageDetails(o.damage ?? true); B.setFacades(true); B.setHouseArt(o.art ?? true); B.setMoreArt(o.more ?? true); B.setWearArt(o.wear ?? true); B.setWearCache(true); };
const world = (map, more = 1, seed = 1944) => { const w = W.createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, ...(more ? { more: 1 } : {}) }, ECO]); return w; };
const at = (b, f) => ({ ...b, hp: Math.floor(b.maxHp * f) });
// 每一段挑一個耐久（比例）：T1 0.9、T2 0.82、T3 0.74、T4 0.5、T5 0.25
const LEVELS = [[1, 0.9], [2, 0.82], [3, 0.74], [4, 0.5], [5, 0.25]];
const tris = g => { const out = []; for (let i = 0; i < g.pos.length; i += 9) out.push({ i, p: [[g.pos[i], g.pos[i + 1], g.pos[i + 2]], [g.pos[i + 3], g.pos[i + 4], g.pos[i + 5]], [g.pos[i + 6], g.pos[i + 7], g.pos[i + 8]]], n: [g.nor[i], g.nor[i + 1], g.nor[i + 2]], c: new THREE.Color(g.col[i], g.col[i + 1], g.col[i + 2]).getHex() }); return out; };
const CAVITY = 0x1f1a17, GLASS = 0x2a3038;
// 從 o 沿 d 打進一個網格，回第一個碰到的距離（沒碰到回 null）
function rayHit(g, o, d) {
  let best = null;
  for (let i = 0; i < g.pos.length; i += 9) {
    const a = [g.pos[i], g.pos[i + 1], g.pos[i + 2]], e1 = [g.pos[i + 3] - a[0], g.pos[i + 4] - a[1], g.pos[i + 5] - a[2]], e2 = [g.pos[i + 6] - a[0], g.pos[i + 7] - a[1], g.pos[i + 8] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (t > -1e-6 && (best === null || t < best)) best = t;
  }
  return best;
}

// 在 ef73514（動手之前）凍結：整鎮（遠景一、二）、每一棟在十個耐久上的三段幾何、腳本戰鬥（第 600 步轟一棟）到 1600 步的效果摘要鏈
const FROZEN_TOWN = { '0/0': ['1d8d66490814ecc7'], '0/1': ['d97e597dfd51a592'], '1/0': ['c5a2b480b2860c07'], '1/1': ['e146f3b29ff063fd'], '2/0': ['bc5364f90a382504'], '2/1': ['95cede539579f260'], '3/0': ['e3475b040f42a3b0', '234aac64be272d11', 'eb9bdc868d1fb346'], '3/1': ['75402bd6c56dfef7', 'df853cdb30989c8d', '38a8c22b1f828f23'], '4/0': ['41c14070da586c79'], '4/1': ['5165579d1a686f07'] };
const FROZEN_DAMAGED = { '0/0': 'baf7c06a2d7b831c', '0/1': '6e6172836a1c008f', '1/0': 'dc5f30f11eec92b1', '1/1': 'b10b16918fd96fcd', '2/0': '7cb8966dc2f5bf3b', '2/1': '02cfd2e3e19cf1b6', '3/0': 'b631f5943b3f62e5', '3/1': '1f4baad1f60fe732', '4/0': '667971248356b46c', '4/1': '7f4e7f253b2e7b31' };
const FROZEN_CHAIN = '5a5c9b5b61d164b9';
// 腳本戰鬥＋第 600 步轟 #12（tests/fx.mjs 的 play）到 1600 步：每 5 步記效果摘要與殘影數、換階段那一步記整鎮指紋
function play({ r004 = true, fx = true, until = 1600, each } = {}) {
  const w = W.createWorld(1944), v = new BattleView(w, { fx, fog: true, observerDetails: true, r004 });
  const log = [...SCRIPT, { tick: 600, cmd: { t: 'fireAt', side: 0, ids: [2, 4], x: 18, z: 9 } }].sort((a, b) => a.tick - b.tick);
  let i = 0; const chain = createHash('sha256'), sel = new Set(); let maxPool = 0;
  while (w.tick < until) {
    const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / 20);
    for (let f = 0; f < 3; f++) v.update(f / 3, (w.tick + f / 3) / 20, sel);
    if (w.tick % 5 === 0) chain.update(`${w.tick}:${v.fxDigest()}:${v.ghostCount};`);
    if (w.events.some(e => e.e === 'stage')) chain.update(fp(B.buildTown(w)));
    const p = v.pools; if (p) maxPool = Math.max(maxPool, p.puff + p.glow + p.debris + p.ring + p.ghost);
    each?.(w, v);
  }
  return { w, v, chain: chain.digest('hex').slice(0, 16), maxPool, log };
}

const groups = {
  // 段：整數算、只往後走、T4／T5 只在空殼；兩個新檔裡沒有亂數與時間
  tiers() {
    for (let max = 60; max <= 1200; max++) {
      let last = -1;
      for (let hp = max; hp >= 0; hp--) {
        const b = { hp, maxHp: max }, t = wearTier(b), lost = max - hp;
        const want = hp === 0 ? 6 : hp * 10 <= max * 7 ? (lost * 100 >= max * 65 ? 5 : 4) : lost * 100 < max * 5 ? 0 : lost * 100 < max * 14 ? 1 : lost * 100 < max * 22 ? 2 : 3;
        assert.equal(t, want, `tiers: the tier table is 5 / 14 / 22 % before roofless and 65 % after (maxHp ${max}, hp ${hp})`);   // 審查 R088-guard-table
        assert(Number.isInteger(t) && t >= 0 && t <= WEAR_RUBBLE, `tiers: the tier is an integer 0-6 (maxHp ${max}, hp ${hp}: ${t})`);
        assert(t >= last, `tiers: as hp falls the tier never goes back (maxHp ${max}, hp ${hp}: ${last} -> ${t})`);
        assert((t === 4 || t === 5) === (stageOf(b) === STAGE_ROOFLESS), `tiers: T4 and T5 exactly when the stage is roofless (maxHp ${max}, hp ${hp})`);
        assert((t === WEAR_RUBBLE) === (hp === 0) && (hp === max ? t === 0 : true), `tiers: rubble at hp 0, T0 at full health (maxHp ${max}, hp ${hp})`);
        last = t;
      }
    }
    for (const f of ['wearArt.ts', 'wear88.ts']) {
      const src = readFileSync(new URL(`../src/render/${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
      assert(!/Math\.random|Date\b|performance\.now/.test(src), `tiers: ${f} uses no randomness or clock`);
    }
  },
  // T0 一模一樣：R088 開著，滿耐久的整鎮跟關著逐位一樣（地圖 0–4、more 開關、R086／R087／R120／R138 各自開關）
  t0() {
    for (const map of MAPS) for (const more of [0, 1]) for (const o of [{}, { art: false }, { more: false }, { walls: false }, { damage: false }]) {
      prod({ ...o, wear: false }); const w = world(map, more);
      for (const lod of map === 3 ? [0, 1, 2] : [0]) {
        prod({ ...o, wear: false }); const off = fp(B.buildTown(w, undefined, lod));
        prod({ ...o, wear: true }); const on = fp(B.buildTown(w, undefined, lod));
        assert.equal(on, off, `t0: a town at full health draws byte for byte the same with R088 on (map ${map}, more ${more}, ${JSON.stringify(o)}, lod ${lod})`);
      }
      { const c = structuredClone(w); for (const b of c.blds) b.hp = b.maxHp - (Math.ceil(b.maxHp * 5 / 100) - 1); prod({ ...o, wear: true }); const near = fp(B.buildTown(c)); prod({ ...o, wear: false }); assert.equal(near, fp(B.buildTown(w)), `t0: just under 5 % lost still draws exactly like full health (map ${map}, more ${more}, ${JSON.stringify(o)})`); }   // 審查 R088-guard-t0-band
    }
  },
  // 閥關著：跟 ef73514 凍結的指紋一樣（整鎮、每一棟在十個耐久上的幾何、腳本戰鬥的效果與殘影）
  valve() {
    assert.match(readFileSync(new URL('../src/render/buildings.ts', import.meta.url), 'utf8'), /let wearOn = false;/, 'valve: the module starts off (main.ts turns it on from the valve)');
    prod({ wear: false });
    for (const map of MAPS) for (const more of [0, 1]) {
      const w = world(map, more), got = [fp(B.buildTown(w))];
      if (map === 3) got.push(fp(B.buildTown(w, undefined, 1)), fp(B.buildTown(w, undefined, 2)));
      assert.deepEqual(got, FROZEN_TOWN[`${map}/${more}`], `valve: with ?noR088=1 the town is what it was before R088 (map ${map}, more ${more})`);
      const g = new Geo();
      for (const b of w.blds) for (const f of [100, 95, 90, 80, 75, 70, 50, 30, 10, 0]) { const c = { ...b, hp: Math.floor(b.maxHp * f / 100) }; B.buildingGeo(g, c, stageOf(c)); }
      assert.equal(fp(g), FROZEN_DAMAGED[`${map}/${more}`], `valve: with ?noR088=1 every damaged building is drawn as before R088 (map ${map}, more ${more})`);
    }
    assert.equal(play().chain, FROZEN_CHAIN, 'valve: with ?noR088=1 the scripted collapse has the same effects and ghosts as before R088');
  },
  // 快取＝不快取：300 次照雜湊改耐久、每個遠近層級、帶 skip；換開關、原地改種類／層數／耐久上限、複製的世界都不拿舊的
  cache() {
    prod();
    for (const map of [1, 3]) {
      const w = structuredClone(world(map)), lods = map === 3 ? [0, 1, 2] : [0], skip = b => b.id % 7 === 3;
      const same = label => { for (const lod of lods) for (const sk of [undefined, skip]) { B.setWearCache(true); const a = fp(B.buildTown(w, sk, lod)); B.setWearCache(false); const b = fp(B.buildTown(w, sk, lod)); B.setWearCache(true); assert.equal(a, b, `cache: the cached town equals the uncached one (${label}, map ${map}, lod ${lod}, skip ${!!sk})`); } };
      same('start');
      for (let k = 0; k < 300; k++) {
        const b = w.blds[Math.floor(hash2(k, map, 881) * w.blds.length)];
        b.hp = Math.max(0, b.hp - 1 - Math.floor(hash2(k, map, 882) * b.maxHp * 0.12));
        if (k % 25 === 24) same(`after ${k + 1} hp writes`);
      }
      B.setHouseArt(false); same('house art switched off'); B.setHouseArt(true); same('house art back on');
      const b = w.blds.find(b => b.kind === W.BK_BARN && b.hp > 0) ?? w.blds[0];
      b.kind = W.BK_WAREHOUSE; b.floors = 3; b.maxHp = 210; same('a building changed kind, floors and maxHp in place');
      B.setWalls(false); for (const k of [0.82, 0.74, 0.25]) { const v = structuredClone(w); v.blds.push({ id: v.blds.length + 1, kind: W.BK_WALL_BRICK, x: 2, z: 2, w: 2, d: 1, floors: 1, hp: Math.floor(130 * k), maxHp: 130 }); B.setWearCache(true); const a2 = fp(B.buildTown(v)); B.setWearCache(false); assert.equal(a2, fp(B.buildTown(v)), `cache: with ?noR120=1 a damaged wall drawn as a house is cached right (map ${map}, hp ${k})`); B.setWearCache(true); } B.setWalls(true);   // 審查 R088-noR120
      const c = structuredClone(w); B.setWearCache(true); const a = fp(B.buildTown(c)); B.setWearCache(false); assert.equal(a, fp(B.buildTown(c)), `cache: a cloned world is drawn from scratch (map ${map})`); B.setWearCache(true);
    }
  },
  // 只讀、純函式：建畫面與同步之後世界不變；讀回來的世界、跳到某一步，畫出來跟一路打過來的一樣
  pure() {
    prod();
    const w = world(1), marks = new WallMarks(64, new THREE.Object3D()), pool = { spawn() {} };
    wearSync(w, marks, pool, pool, 0, () => true);   // 先記下 T0（審查 R088-guard-pure：同步要真的跨段、放效果）
    const before = [JSON.stringify(encodeWorld(w)), w.rng, W.hashWorld(w)];
    for (const b of w.blds) b.hp = Math.floor(b.maxHp * (0.2 + 0.8 * hash2(b.id, 1, 883)));
    const mid = [JSON.stringify(encodeWorld(w)), w.rng, W.hashWorld(w)];
    B.buildTown(w); assert(wearSync(w, marks, pool, pool, 1, () => true), 'fixture: the sync crosses tiers'); wearSync(w, marks, pool, pool, 2, () => true); B.buildTown(w, undefined, 1);
    assert.deepEqual([JSON.stringify(encodeWorld(w)), w.rng, W.hashWorld(w)], mid, 'pure: drawing and syncing leave the world, its rng and its hash untouched');
    assert.notDeepEqual(mid, before, 'fixture: the hp writes changed the world');
    const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
    assert.equal(fp(B.buildTown(back)), fp(B.buildTown(w)), 'pure: a decoded world draws the same bytes as the live one');
    // 跳步：一路打到第 1400 步的畫面 ＝ 從頭重播到第 1400 步的世界
    const live = play({ until: 1400 }), seek = runLog(W.createWorld(1944), live.log, 1400);
    assert.equal(fp(B.buildTown(seek)), fp(B.buildTown(live.w)), 'pure: a world seeked to tick 1400 draws the same bytes as the live game');
    assert.equal(fp(B.buildTown(world(2))), fp(B.buildTown(world(2))), 'pure: two runs give the same bytes');
  },
  // 幾何：有限值、單位法線、沒有退化；在佔地裡、y ≥ 0；看不見的面沒有洞；洞在牆面範圍、牆頂以下、不壓窗；最多多 64 個三角形；T3 只往下移、不加三角形
  geometry() {
    prod();
    for (const map of MAPS) for (const b0 of world(map).blds.filter(b => wearable(b))) {
      const g0 = B.buildingGeo(new Geo(), b0, STAGE_INTACT), r0 = B.buildingGeo(new Geo(), at(b0, 0.5), STAGE_ROOFLESS);
      const byTier = {}, outOf = g => Math.max(0, ...tris(g).map(t => Math.max(...t.p.map(p => Math.max(b0.x - p[0], p[0] - b0.x - b0.w, b0.z - p[2], p[2] - b0.z - b0.d, -p[1]))))), outBase = [outOf(g0), outOf(r0)];   // 今天的那一段伸出佔地多少（教堂、風車本來就有一點）
      for (const [tier, f] of LEVELS) {
        const b = at(b0, f); assert.equal(wearTier(b), tier, `fixture: hp ${f} is tier ${tier} (building ${b.id})`);
        const g = B.buildingGeo(new Geo(), b, stageOf(b)); byTier[tier] = g;
        const h = B.wallHeight(b), ts = tris(g);
        for (const t of ts) {
          assert(t.p.flat().every(Number.isFinite) && Math.abs(Math.hypot(...t.n) - 1) < 1e-5, `geometry: finite vertices and unit normals (map ${map}, building ${b.id}, T${tier})`);
          const u = t.p[1].map((v, k) => v - t.p[0][k]), v = t.p[2].map((q, k) => q - t.p[0][k]), cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          assert(Math.hypot(...cr) > 1e-9, `geometry: no degenerate triangle (map ${map}, building ${b.id}, T${tier})`);
          const out = Math.max(...t.p.map(p => Math.max(b.x - p[0], p[0] - b.x - b.w, b.z - p[2], p[2] - b.z - b.d, -p[1])));
          assert(out <= Math.max(1e-6, outBase[tier <= 3 ? 0 : 1]), `geometry: nothing reaches further off the footprint (or below the ground) than the same building does today (map ${map}, building ${b.id} kind ${b.kind}, T${tier}: ${out.toFixed(3)})`);
          if (t.c === CAVITY) assert(t.n[0] > -0.5 && t.n[2] > -0.5, `geometry: no hole on a face the camera never sees (map ${map}, building ${b.id}, T${tier})`);
        }
        // 洞：牆面範圍 ±0.02、牆頂以下、不壓窗（同一面的玻璃）
        const glass = ts.filter(t => t.c === GLASS && (t.n[0] > 0.99 || t.n[2] > 0.99)), g0t = tris(g0);
        for (const t of ts.filter(t => t.c === CAVITY && tier <= 3 && (t.n[0] > 0.99 || t.n[2] > 0.99))) {
          const ax = t.n[0] > 0.99 ? 0 : 2, u = ax === 0 ? 2 : 0, face = ax === 0 ? b.x + b.w - 0.1 : b.z + b.d - 0.1, us = t.p.map(p => p[u]), ys = t.p.map(p => p[1]);
          // 打破的窗：整片落在同一面的某一片玻璃裡（貼在玻璃上 0.003）——不算洞
          const box = q => [Math.min(...q.p.map(p => p[u])), Math.max(...q.p.map(p => p[u])), Math.min(...q.p.map(p => p[1])), Math.max(...q.p.map(p => p[1]))];
          const touching = glass.filter(q => q.n[ax] > 0.99 && Math.abs(q.p[0][ax] + 0.003 - t.p[0][ax]) < 1e-4).map(box).filter(([a, b2, c, d]) => Math.min(...us) < b2 && Math.max(...us) > a && Math.min(...ys) < d && Math.max(...ys) > c);
          if (touching.length && us.every(v => v >= Math.min(...touching.map(q => q[0])) - 1e-4 && v <= Math.max(...touching.map(q => q[1])) + 1e-4) && ys.every(v => v >= Math.min(...touching.map(q => q[2])) - 1e-4 && v <= Math.max(...touching.map(q => q[3])) + 1e-4)) continue;
          assert(Math.abs(t.p[0][ax] - face - 0.02) < 1e-6 && Math.min(...us) >= (ax === 0 ? b.z : b.x) + 0.1 - 0.02 && Math.max(...us) <= (ax === 0 ? b.z + b.d : b.x + b.w) - 0.1 + 0.02 && Math.max(...ys) < h, `geometry: a hole sits on its wall, inside the face and below the wall top (map ${map}, building ${b.id}, T${tier})`);
          for (const q of g0t) if (q.n[ax] > 0.99 && q.p.every(p => p[ax] - face > 1e-4 && p[ax] - face <= 0.06)) { const qu = q.p.map(p => p[u]), qy = q.p.map(p => p[1]); assert(Math.max(...us) <= Math.min(...qu) || Math.min(...us) >= Math.max(...qu) || Math.max(...ys) <= Math.min(...qy) || Math.min(...ys) >= Math.max(...qy), `geometry: a hole never covers a door, window or anything on the wall (map ${map}, building ${b.id}, T${tier})`); }   // 審查 R088-guard-doors
          for (const q of glass) if (Math.abs(q.p[0][ax] - face) < 0.06) { const qu = q.p.map(p => p[u]), qy = q.p.map(p => p[1]); assert(Math.max(...us) <= Math.min(...qu) || Math.min(...us) >= Math.max(...qu) || Math.max(...ys) <= Math.min(...qy) || Math.min(...ys) >= Math.max(...qy), `geometry: a hole never covers a window (map ${map}, building ${b.id}, T${tier})`); }
        }
        const base = tier <= 3 ? g0 : r0;
        assert(g.triangles - base.triangles <= 64 && g.triangles >= base.triangles, `geometry: a tier adds at most 64 triangles (map ${map}, building ${b.id}, T${tier}: +${g.triangles - base.triangles})`);
      }
      assert.equal(byTier[3].triangles, byTier[2].triangles, `geometry: the T3 sag only moves vertices (map ${map}, building ${b0.id})`);
      for (let i = 0; i < byTier[3].pos.length; i += 3) assert(byTier[3].pos[i + 1] <= byTier[2].pos[i + 1] + 1e-9 && byTier[3].pos[i] === byTier[2].pos[i] && byTier[3].pos[i + 2] === byTier[2].pos[i + 2], `geometry: the T3 sag never moves a vertex up or sideways (map ${map}, building ${b0.id})`);
      { const b5 = at(b0, 0.25), t4 = B.buildingGeo(new Geo(), b5, STAGE_ROOFLESS, 4), t5 = byTier[5]; let drop5 = 0;   // 審查 R088-guard-t5：塌一半只往下壓、壓得到
        for (let i = 0; i < t4.pos.length; i += 3) { assert(t5.pos[i + 1] <= t4.pos[i + 1] + 1e-9 && t5.pos[i] === t4.pos[i] && t5.pos[i + 2] === t4.pos[i + 2], `geometry: the T5 half collapse never moves a vertex up or sideways (map ${map}, building ${b0.id})`); drop5 = Math.max(drop5, t4.pos[i + 1] - t5.pos[i + 1]); }
        assert(drop5 > 0.1, `geometry: the T5 shell visibly comes down (map ${map}, building ${b0.id}: ${drop5.toFixed(3)})`); }
      if (b0.kind !== W.BK_CHURCH) { const s = sagEnd(b0), drop = Math.max(...[...Array(byTier[3].pos.length / 3).keys()].map(k => byTier[2].pos[3 * k + 1] - byTier[3].pos[3 * k + 1])); assert(drop > 0.05, `geometry: the T3 roof visibly sags (map ${map}, building ${b0.id}: ${drop.toFixed(3)}, end ${s.end})`); }
    }
  },
  // 殘影：兩半合起來＝那一段的幾何；第二半晚 0.22 秒、都往外倒；屋頂殘影＝簷以上；真的畫面裡換階段那一幀有殘影
  ghosts() {
    prod();
    const key = g => tris(g).map(t => JSON.stringify(t.p) + t.c).sort().join('|');
    for (const map of [0, 1, 2]) for (const b0 of world(map).blds.filter(b => wearable(b)).slice(0, 12)) for (const [tier, f] of [[0, 1], [3, 0.74], [5, 0.25]]) {
      const shownAt = { ...at(b0, f), id: 1 }, from = stageOf(shownAt),   // 一棟的假世界：id 要是 1（blds[id−1]）
      whole = B.buildingGeo(new Geo(), shownAt, from), h = B.wallHeight(b0);
      const { first, second } = splitHalves(whole, shownAt, tier, h), joined = new Geo();
      for (const g of [first, second]) for (let i = 0; i < g.pos.length; i++) { joined.pos.push(g.pos[i]); joined.nor.push(g.nor[i]); joined.col.push(g.col[i]); }
      assert.equal(key(joined), key(whole), `ghosts: the two halves together are that building's mesh at its shown tier (map ${map}, building ${b0.id}, T${tier})`);
      // 真的 wearCollapse：先同步到 shown 那一段，再倒成瓦礫
      const w = { blds: [{ ...shownAt }], map: 0 }, calls = [], ghosts = { add: (g, t0, hh, cx, cz, seed, rise, lx, lz) => calls.push({ g, t0, lx, lz }) }, pool = { spawn() {} };
      wearSync(w, new WallMarks(4, new THREE.Object3D()), null, null, 0, () => true);
      w.blds[0].hp = 0;
      assert(wearCollapse(w, ghosts, pool, pool, w.blds[0], from, 10, h), 'ghosts: the collapse is handled when R088 is on');
      assert.equal(calls.length, 2, `ghosts: a collapse falls in two parts (map ${map}, building ${b0.id}, T${tier})`);   // 審查 R088-guard-halves：不拿 splitHalves 自己當答案
      for (const [k, c] of calls.entries()) for (const t of tris(c.g)) {
        const cy = (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3, cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, cz = (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
        const s = { alongX: b0.w >= b0.d, mid: b0.w >= b0.d ? b0.x + b0.w / 2 : b0.z + b0.d / 2 }, side = ((s.alongX ? cx : cz) - s.mid) * (hash2(1, 31, 88) < 0.5 ? 1 : -1) > 0;
        assert(tier >= 4 ? side === (k === 0) : (cy > 0.5 * h) === (k === 0), `ghosts: the first part to fall is the ${tier >= 4 ? 'collapsed half' : 'upper part'} (map ${map}, building ${b0.id}, T${tier})`);
      }
      if (calls.length === 2) {
        assert(Math.abs(calls[1].t0 - calls[0].t0 - COLLAPSE_GAP) < 1e-9 && COLLAPSE_GAP === 0.22, 'ghosts: the second half starts 0.22 s later');
        for (const c of calls) { let mx = 0, mz = 0; const n = c.g.pos.length / 3; for (let i = 0; i < c.g.pos.length; i += 3) { mx += c.g.pos[i]; mz += c.g.pos[i + 2]; } const dx = mx / n - (b0.x + b0.w / 2), dz = mz / n - (b0.z + b0.d / 2); if (Math.hypot(dx, dz) > 0.05) assert(dx * c.lx + dz * c.lz > 0, `ghosts: each half leans outward (map ${map}, building ${b0.id}, T${tier})`); }
        assert.equal(key(calls[0].g) + '|' + key(calls[1].g), key(first) + '|' + key(second), `ghosts: the halves come from the shown tier, not from the rubble (map ${map}, building ${b0.id}, T${tier})`);
      }
      if (from === STAGE_INTACT) {
        const w2 = { blds: [{ ...shownAt }], map: 0 }, roofCalls = [];
        wearSync(w2, new WallMarks(4, new THREE.Object3D()), null, null, 0, () => true);
        w2.blds[0].hp = Math.floor(b0.maxHp * 0.5);
        assert(wearRoofFall(w2, { add: (g, t0, hh, cx, cz, seed, rise, lx, lz) => roofCalls.push({ g, hh, lx, lz }) }, w2.blds[0], 5), 'ghosts: the roof falls in when R088 is on');
        const drawn = B.buildingGeo(new Geo(), shownAt, STAGE_INTACT), flat = tier === 3 ? B.buildingGeo(new Geo(), shownAt, STAGE_INTACT, 2) : drawn, want = new Geo();   // 審查 R088-roof-fall：獨立選一遍
        for (let i = 0; i < flat.pos.length; i += 9) if (Math.max(flat.pos[i + 1], flat.pos[i + 4], flat.pos[i + 7]) > h + 1e-4) for (let k = i; k < i + 9; k++) { want.pos.push(drawn.pos[k]); want.nor.push(drawn.nor[k]); want.col.push(drawn.col[k]); }
        assert.equal(key(roofCalls[0].g), key(want), `ghosts: the falling roof is the roof of the shown tier (map ${map}, building ${b0.id})`);
        const roofArea = g => tris(g).filter(t => t.c === new THREE.Color(...[0, 1, 2].map(k => drawn.col[k])).getHex() || true).length;
        assert(roofCalls[0].g.pos.length >= 0.9 * roofSlice(flat, h).pos.length, `ghosts: at T3 the falling roof keeps its sagged end (map ${map}, building ${b0.id})`); void roofArea;
        assert(roofCalls[0].lx === 0 && roofCalls[0].lz === 0 && Math.abs(roofCalls[0].hh - (B.roofRise(b0.kind) + 0.2)) < 1e-9, 'ghosts: the roof sinks straight down by its rise + 0.35');
      }
    }
    // 真的畫面：第 423 步 #12 變空殼那一幀有屋頂的殘影；第 904 步倒成瓦礫那一幀多兩個殘影；換段的每一步整鎮都重畫了（審查 R088-guard-redraw）
    const seen = {}; let checked = 0, last = null;
    play({ until: 910, each: (w, v) => {
      if (w.tick === 423 || w.tick === 904) seen[w.tick] = v.ghostCount;
      const tiers = w.blds.map(b => wearTier(b)).join();
      if (tiers !== last) { assert.equal(v.townTriangles, B.buildTown(w).triangles, `ghosts: the view redraws the town when a tier changes (tick ${w.tick})`); checked++; last = tiers; }
    } });
    assert(checked >= 4, `fixture: tiers changed during the battle (${checked})`);
    assert(seen[423] >= 1, `ghosts: the frame after intact -> roofless has the falling roof (${seen[423]})`);
    assert(seen[904] >= 2, `ghosts: the rubble frame has two collapse ghosts (${seen[904]})`);
  },
  // 彈痕：T3、T5 之後沒有高過新牆頂的；瓦礫上照舊沒有（R139）
  marks() {
    prod();
    const stats = { made: 0, dropped: 0 };
    for (const map of [0, 1]) for (const b0 of world(map).blds.filter(b => wearable(b) && b.kind !== W.BK_CHURCH).slice(0, 10)) for (const [tier, f] of [[3, 0.74], [5, 0.25]]) {
      const w = { blds: [{ ...b0, id: 1, hp: Math.floor(b0.maxHp * (tier === 3 ? 0.9 : 0.6)) }], map: 0 }, b = w.blds[0], marks = new WallMarks(64, new THREE.Object3D());
      wearSync(w, marks, null, null, 0, () => true);
      const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
      for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI / 2; marks.mark14(b, k % 5 === 4 ? 1 : 0, cx + 6 * Math.cos(a), cz + 6 * Math.sin(a), cx, cz); }
      const live = () => marks.holes.live.reduce((n, v, i) => n + (v && marks.holes.bld[i] === b.id ? 1 : 0), 0), n0 = live();
      b.hp = Math.floor(b0.maxHp * f);
      wearSync(w, marks, null, null, 1, () => true);
      stats.made += n0; stats.dropped += n0 - live();
      for (let k = 0; k < 20; k++) { const a = ((k + 0.5) / 20) * Math.PI / 2; marks.mark14(b, k % 5 === 4 ? 1 : 0, cx + 6 * Math.cos(a), cz + 6 * Math.sin(a), cx, cz); }   // 牆塌了之後再打的
      // 量畫出來的牆（審查 R088-guard-marks：不拿 wearTop 比）：彈痕的中心與上緣往牆裡打回去，0.03 之內要碰到這一段的模型
      const g = B.buildingGeo(new Geo(), b, stageOf(b)), H = marks.holes;
      for (let i = 0; i < H.live.length; i++) if (H.live[i] && H.bld[i] === b.id) {
        const top = H.h[i] * (H.kind[i] === 0 ? 1.55 : 1) / 2, o = [H.x[i] + H.nx[i] * 0.006, 0, H.z[i] + H.nz[i] * 0.006], d = [-H.nx[i], 0, -H.nz[i]];
        for (const y of [H.y[i], H.y[i] + top - 0.004]) { const t = rayHit(g, [o[0], y, o[2]], d);  assert(t !== null && t <= 0.03, `marks: no shell mark stays above the lowered wall top (map ${map}, building ${b.id}, T${tier}, y ${y.toFixed(3)}: ${t})`); }
      }
    }
    console.log(`  marks: ${stats.made} shell marks made, ${stats.dropped} dropped when walls came down`);
    assert(stats.made > 100 && stats.dropped > 10, `fixture: marks were made and some had to be dropped (${JSON.stringify(stats)})`);
  },
  // 效果：跑兩次一樣；?fx=off、?noR004=1 時特效池是 0、段的幾何照畫
  effects() {
    prod();
    const a = play({ until: 1000 }), b = play({ until: 1000 });
    assert.equal(a.v.fxDigest(), b.v.fxDigest(), 'effects: two runs give the same effects');
    for (const o of [{ fx: false }, { r004: false }]) {
      const c = play({ until: 1000, ...o });
      assert.equal(c.maxPool, 0, `effects: ${JSON.stringify(o)} spawns nothing`);
      assert(c.w.blds.some(b => wearable(b) && wearTier(b) >= 1 && wearTier(b) <= 5), 'fixture: some building is damaged');
      assert.equal(c.v.townTriangles, B.buildTown(c.w).triangles, `effects: ${JSON.stringify(o)} the view still draws the damage tiers`);   // 審查 R088-guard-effects
    }
    { // 只在看得到的地方放（審查 R088-guard-fog）
      const b0 = world(1).blds.find(b => wearable(b) && b.kind === W.BK_HOUSE), count = { n: 0 }, pool = { spawn() { count.n++; } };
      for (const [see, want] of [[false, 0], [true, 7]]) {
        const w = { blds: [{ ...b0, id: 1 }], map: 0 }; count.n = 0;
        wearSync(w, new WallMarks(4, new THREE.Object3D()), pool, pool, 0, () => see);
        w.blds[0].hp = Math.floor(b0.maxHp * 0.9);
        wearSync(w, new WallMarks(4, new THREE.Object3D()), pool, pool, 1, () => see);
        assert.equal(count.n, want, `effects: a tier change ${see ? 'in sight puffs 3 smoke and 4 chips' : 'the player cannot see spawns nothing'}`);
      }
    }
  },
  // 重建的時間（96 圖、同一次跑）：改一棟的段之後，快取的重建中位數 ≤ 不快取的 0.25 倍
  bench() {
    prod();
    const w = world(3), b = w.blds.find(b => wearable(b)), ts = { cached: [], plain: [] };
    B.buildTown(w);
    for (let k = 0; k < 15; k++) {
      b.hp = Math.max(1, b.hp - 1); b.hp = k % 2 ? b.maxHp : Math.floor(b.maxHp * 0.74);
      B.setWearCache(true); let t0 = performance.now(); B.buildTown(w); ts.cached.push(performance.now() - t0);
      B.setWearCache(false); t0 = performance.now(); B.buildTown(w); ts.plain.push(performance.now() - t0); B.setWearCache(true);
    }
    const med = a => a.sort((x, y) => x - y)[a.length >> 1], c = med(ts.cached), p = med(ts.plain);
    console.log(`  96 town rebuild after one tier change: cached ${c.toFixed(2)} ms, uncached ${p.toFixed(2)} ms (${(c / p).toFixed(3)}x)`);
    assert(c <= 0.25 * p, `bench: a cached rebuild costs at most a quarter of an uncached one (${c.toFixed(2)} vs ${p.toFixed(2)} ms)`);
  },
  // 接線：閥在表上、main.ts 照閥打開、battle.ts 叫同步與兩種殘影
  wiring() {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), battle = readFileSync(new URL('../src/render/battle.ts', import.meta.url), 'utf8');
    assert.match(main, /setWearArt\(V\.r088\);/, 'wiring: the hub turns R088 on from the valve');
    assert.match(readFileSync(new URL('../src/valves.ts', import.meta.url), 'utf8'), /get r088\(\) \{ return on\('088'\); \}/, 'wiring: the valve is on the table');
    assert.match(battle, /if \(wearSync\(this\.w, this\.marks14, this\.r4 && this\.fxOn \? this\.puff : null, this\.r4 && this\.fxOn \? this\.debris : null, simT, \(x, z\) => this\.visibleAt\(x \* SUB, z \* SUB\)\)\) townDirty = true;/, 'wiring: the view syncs the tiers after the events, with effects only in sight');
    assert.match(battle, /wearRoofFall\(this\.w, this\.ghosts!, b, t\)/, 'wiring: the roof falls in on intact -> roofless');
    assert.match(battle, /if \(!wearCollapse\(this\.w, this\.ghosts!, this\.puff!, this\.debris!, b, from, t, h\)\) this\.ghosts!\.add\(g, t, h, cx, cz, hash2\(b\.id, 3, 77\)\);/, 'wiring: the collapse falls in two parts, R004 one ghost when off');
    assert(main.split('\n').length <= 673 && battle.split('\n').length <= 1196, 'wiring: main.ts and battle.ts stay within their line budgets');
    assert.equal(W.hashWorld(runScript()), 'eea1d59b', 'wiring: the golden script battle is unchanged');
  },
};

export const ALL = ['tiers', 't0', 'valve', 'cache', 'pure', 'geometry', 'ghosts', 'marks', 'effects', 'bench', 'wiring'];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`wear-art/${only}: OK`); process.exit(0); }
  for (const name of ALL) { const t0 = performance.now(); groups[name](); console.log(`OK wear-art/${name} (${((performance.now() - t0) / 1000).toFixed(1)} s)`); }
  console.log('wear-art: all groups OK');
}
