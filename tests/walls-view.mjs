// R120: inspect real merged geometry, mark matrices and effect pools. Chrome pixel/UI checks are separate.
// Mutations compile isolated production modules in memory; the first failure must be the named semantic guard.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createWorld, hashWorld, N, SUB, idx, center, BK_HOUSE, BK_PILLBOX, UK_TANK, UK_OBSERVER, UNIT_KINDS, ORD_IDLE, ORD_FIRE_AT, SHELL_AP, SHELL_HE, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE } from '../src/sim/world.ts';
import { applyMap } from '../src/sim/maps.ts';
import { buildError, applyBuild, pointsUsed } from '../src/sim/build.ts';
import { applyTrench } from '../src/sim/trenches.ts';
import { Geo } from '../src/render/geo.ts';
const paths = { buildings: '../src/render/buildings.ts', battle: '../src/render/battle.ts' };
const sources = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, fs.readFileSync(new URL(p, import.meta.url), 'utf8')]));
const mutations = {
  absent_wall: { group: 'shape', file: 'buildings', from: 'if (wallShown(b)) { boundaryWall(g, b, false); return; }', to: 'if (wallShown(b)) return;', message: 'shape: each kind has a solid roofless wall body at the independently specified height' },
  tall_brick: { group: 'shape', file: 'buildings', from: '[BK_WALL_BRICK]: 0.3,', to: '[BK_WALL_BRICK]: 0.6,', message: 'shape: each kind has a solid roofless wall body at the independently specified height' },
  wrong_material: { group: 'material', file: 'buildings', from: '[BK_WALL_CONCRETE]: { wall: C(0x9c998e)', to: '[BK_WALL_CONCRETE]: { wall: C(0xa5644c)', message: 'material: each wall body uses its independent brick stone or concrete color' },
  missing_joints: { group: 'joints', file: 'buildings', from: 'for (let row = 0; row < rows; row++)', to: 'for (let row = 0; row < 0; row++)', message: 'joints: brick courses stone blocks and concrete seams remain geometrically distinct' },
  wrong_axis: { group: 'orientation', file: 'buildings', from: 'return b.w >= b.d ? { x0: b.x,', to: 'return true ? { x0: b.x,', message: 'orientation: both rotations have a two-cell length and independently specified narrow thickness' },
  disconnected: { group: 'connection', file: 'buildings', from: '{ x0: b.x, x1: b.x + b.w,', to: '{ x0: b.x + 0.1, x1: b.x + b.w - 0.1,', message: 'connection: adjacent collinear wall geometry reaches the shared occupied-cell boundary' },
  damage_ignored: { group: 'damage', file: 'buildings', from: 'if (wallShown(b)) { boundaryWall(g, b, true); return; }', to: 'if (wallShown(b)) { boundaryWall(g, b, false); return; }', message: 'damage: damaged walls lose height and have multiple broken tops with no house interior' },
  concrete_rubble: { group: 'rubble', file: 'buildings', from: '[BM_CONCRETE]: [C(0x9c998e), C(0x74746e), C(0xb8b5a9), C(0x5e605b)]', to: '[BM_CONCRETE]: [C(0xa9a596), C(0x7d7a6e), C(0xc0baaa), C(0x625e55)]', message: 'rubble: concrete fragments retain their independent concrete palette and remain near ground' },
  invisible_fallback: { group: 'fallback', file: 'buildings', from: 'if (!wallsOn && isWallKind(b.kind)) b = { ...b, kind: BK_HOUSE };', to: 'if (!wallsOn && isWallKind(b.kind)) return g;', message: 'fallback: every recorded wall and damage stage draws the exact ordinary-house fallback' },
  fallback_roof: { group: 'fallback_height', file: 'buildings', from: 'ROOF_RISE[visibleKind(kind)] ?? 0.32', to: 'ROOF_RISE[kind] ?? 0.32', message: 'fallback_height: disabled walls use ordinary wall and roof heights in every battle consumer' },
  world_write: { group: 'readonly', file: 'buildings', from: 'export function buildTown(w: World, skip?: (b: Building) => boolean, lod = 0): Geo {', to: 'export function buildTown(w: World, skip?: (b: Building) => boolean, lod = 0): Geo { w.rng ^= 1;', message: 'readonly: all rendering paths preserve the complete world including RNG' },
  marks_off_surface: { group: 'marks_surface', file: 'battle', from: 'const { x0, x1, z0, z1 } = wallBounds(b);', to: 'const x0=b.x+.1, x1=b.x+b.w-.1, z0=b.z+.1, z1=b.z+b.d-.1;', message: 'marks_surface: AP and HE centers lie on the actual wall face for both rotations and all directions' },
  marks_overflow: { group: 'marks_clip', file: 'battle', from: 'if (wallShown(b)) {\n      // AP', to: 'if (false) {\n      // AP', message: 'marks_clip: the complete AP outer rim and HE stain fit the narrow face and conservative damaged height' },
  retained_rim: { group: 'marks_prune', file: 'battle', from: '(wallShown(b) && H.kind[i] === 0 ? 1.55 : 1)', to: '1', message: 'marks_prune: damage removes every AP rim above the surviving wall and rubble removes all marks' },
  smoke_wide: { group: 'smoke', file: 'battle', from: 'const fx = bounds?.x0 ?? b.x, fz = bounds?.z0 ?? b.z, fw = bounds ? bounds.x1 - bounds.x0 : b.w, fd = bounds ? bounds.z1 - bounds.z0 : b.d;', to: 'const fx = b.x, fz = b.z, fw = b.w, fd = b.d;', message: 'smoke: fire and smoke origins stay inside the narrow damaged wall surface' },
  startup_smoke_tall: { group: 'startup_smoke', file: 'battle', from: 'wallHeight(b) * (bounds ? 0.72 : 1)', to: 'wallHeight(b)', message: 'startup_smoke: a loaded damaged wall reconstructs smoke below its broken top' },
  bars_tall: { group: 'bars', file: 'battle', from: 'wallShown(b) && stageOf(b) === STAGE_ROOFLESS ? 0.72 : 1', to: 'false ? 0.72 : 1', message: 'bars: actual health-bar matrix follows the low damaged wall without a phantom roof' },
  phantom_roof: { group: 'ghosts', file: 'buildings', from: '[BK_WALL_BRICK]: 0, [BK_WALL_STONE]: 0, [BK_WALL_CONCRETE]: 0', to: '[BK_WALL_BRICK]: 0.32, [BK_WALL_STONE]: 0.32, [BK_WALL_CONCRETE]: 0.32', message: 'ghosts: rising wall uses its exact intact height without an imaginary roof' },
  stale_preview: { group: 'lifecycle', file: 'battle', from: 'this.town.geometry.dispose(); this.town.geometry = buildTown(w).geometry();', to: 'this.town.geometry.dispose();', message: 'lifecycle: preview geometry exactly matches a fresh rendering of the draft world' },
  garrison_ground: { group: 'garrison', file: 'battle', from: 'const height = ray.intersectObject(this.pickTown ?? this.town, false)[0]?.point.y ?? 0;', to: 'const height = wallShown(b) ? 0 : ray.intersectObject(this.pickTown ?? this.town, false)[0]?.point.y ?? 0;', message: 'garrison: inherited roof indicator sits on the actual low or broken wall surface' },
  noR105_hides_wall: { group: 'combinations', file: 'buildings', from: 'if (wallShown(b)) { boundaryWall(g, b, false); return; }', to: 'if (wallShown(b)) { if (!materialsOn) return; boundaryWall(g, b, false); return; }', message: 'combinations: noR105 and omitted R024 selection never hide or corrupt recorded wall stages' },
  legacy_height: { group: 'legacy', file: 'buildings', from: 'const h = wallHeight(b), alongX =', to: 'const h = wallHeight(b) + 0.01, alongX =', message: 'legacy: both historical map geometry fingerprints remain unchanged' },
  extra_mesh: { group: 'budget', file: 'battle', from: 'this.scene.add(this.town);', to: 'this.scene.add(this.town); if (w.blds.some(b => b.kind >= 7)) this.scene.add(this.town.clone());', message: 'budget: maximum walls and mixed trenches add no meshes or draw calls' },
};
const mutant = process.argv.find(s => s.startsWith('--mutant='))?.slice(9);
if (mutant) {
  const m = mutations[mutant]; assert(m, 'known mutant'); assert.equal(sources[m.file].split(m.from).length, 2, `${mutant}: unique anchor`);
  sources[m.file] = sources[m.file].replace(m.from, m.to);
}
function moduleURL(key, aliases = {}) {
  const base = new URL(paths[key], import.meta.url);
  const code = stripTypeScriptTypes(sources[key]).replace(/from '([^']+)'/g, (_, spec) => `from '${aliases[spec] ?? (spec.startsWith('.') ? new URL(spec, base).href : import.meta.resolve(spec))}'`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const buildingsURL = moduleURL('buildings');
const { buildingGeo, buildTown, bldColors, wallHeight, roofRise, smokeSources, setWalls, setMaterials, setFacades } = await import(buildingsURL);
const { BattleView } = await import(moduleURL('battle', { './buildings.ts': buildingsURL }));
const KINDS = [7, 8, 9], HEIGHT = [0.3, 0.48, 0.56], THICK = [0.28, 0.38, 0.34], WALL_COLOR = [0xa5644c, 0xb2aea0, 0x9c998e], TRIM = [0xd2b397, 0x716f63, 0x74746e];
const STAGES = [STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE];
const near = (a, b, eps = 0.00001) => Math.abs(a - b) <= eps;
const building = (kind = 7, rot = 0, stage = 0) => ({ id: 1, kind, x: 12, z: 12, w: rot ? 1 : 2, d: rot ? 2 : 1, floors: 1, hp: stage === 2 ? 0 : stage === 1 ? 70 : 100, maxHp: 100, builtBy: 0 });
const geometry = (b, stage = b.hp === 0 ? 2 : b.hp <= 70 ? 1 : 0) => buildingGeo(new Geo(), b, stage);
function bounds(g) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.pos.length; i++) { const a = i % 3; min[a] = Math.min(min[a], g.pos[i]); max[a] = Math.max(max[a], g.pos[i]); }
  return { min, max };
}
function colorSet(g) { const s = new Set(), c = new THREE.Color(); for (let i = 0; i < g.col.length; i += 3) s.add(c.setRGB(g.col[i], g.col[i + 1], g.col[i + 2]).getHex()); return s; }
function blank(bs = []) {
  const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = bs; w.units = []; w.events = []; w.shells = [];
  bs.forEach((b, i) => { b.id = i + 1; for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) w.occ[idx(x, z)] = b.id; }); return w;
}
const view = (w, fx = false, rise = false, holes = true) => new BattleView(w, { fx: fx, fog: false, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: holes, r016: rise });
function addUnit(w, kind = UK_TANK, x = 7, z = 12) {
  const u = { id: w.units.length + 1, side: 0, kind, x: center(x), z: center(z), hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 99999, aimX: SUB, aimZ: 0 }; w.units.push(u); return u;
}
function hit(v, b, direction, kind = SHELL_AP, n = 1) {
  const w = v.w, [dx, dz] = direction, cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  for (let i = 0; i < n; i++) {
    const ex = cx * SUB, ez = cz * SUB, sx = (cx + dx * 3) * SUB, sz = (cz + dz * 3) * SUB;
    w.shells = [{ id: i + 1, side: 0, kind, shooter: 1, sx, sz, ex, ez, t: 0, T: 99, target: 0, hitBld: b.id }]; v.snapshot();
    v.onEvents([{ e: 'impact', kind, x: kind === SHELL_HE ? sx : ex, z: kind === SHELL_HE ? sz : ez, r: 4 * SUB, bld: b.id }], 1);
  }
}
function marks(v) { const H = v.holes, out = []; for (let i = 0; i < H.live.length; i++) if (H.live[i]) out.push(Object.fromEntries(['kind','x','y','z','nx','nz','w','h'].map(k => [k, H[k][i]]))); return out; }
const DIRECTIONS = [[-1,0],[1,0],[0,-1],[0,1]];
function actualBounds(b) { const t = THICK[b.kind - 7] / 2, cx = b.x + b.w / 2, cz = b.z + b.d / 2; return b.w > b.d ? [b.x, b.x + b.w, cz - t, cz + t] : [cx - t, cx + t, b.z, b.z + b.d]; }
function budget(v) {
  let calls = 0, triangles = 0, meshes = 0;
  v.scene.traverse(o => { if (!o.isMesh) return; meshes++; if (!o.visible) return; const count = o.isInstancedMesh ? o.count : 1, verts = Math.min(o.geometry.drawRange.count, o.geometry.index?.count ?? o.geometry.attributes.position.count); if (!count || !verts) return; const passes = o.castShadow ? 2 : 1; calls += passes; triangles += verts / 3 * count * passes; }); return { calls, triangles, meshes };
}
const groups = {
  shape() {
    for (const kind of KINDS) { const b = building(kind), g = geometry(b), a = bounds(g); assert(g.pos.length > 0 && near(a.min[1], 0) && near(a.max[1], HEIGHT[kind - 7]) && g.nor.every((v, i) => i % 3 !== 1 || v === 0 || v === 1), 'shape: each kind has a solid roofless wall body at the independently specified height'); assert.equal(wallHeight(b), HEIGHT[kind - 7]); assert.equal(roofRise(kind), 0); }
  },
  material() {
    for (const enabled of [true, false]) { setMaterials(enabled); for (const kind of KINDS) { assert(colorSet(geometry(building(kind))).has(WALL_COLOR[kind - 7]), 'material: each wall body uses its independent brick stone or concrete color'); assert.equal(bldColors(kind).wall.getHex(), WALL_COLOR[kind - 7]); } } setMaterials(true);
  },
  joints() {
    const gs = KINDS.map(k => geometry(building(k))), counts = gs.map(g => g.triangles);
    assert(counts[0] > counts[1] && counts[1] > counts[2] && gs.every((g, i) => colorSet(g).has(TRIM[i])), 'joints: brick courses stone blocks and concrete seams remain geometrically distinct');
  },
  orientation() {
    for (const kind of KINDS) for (const rot of [0,1]) { const a = bounds(geometry(building(kind, rot))); const long = rot ? 2 : 0, short = rot ? 0 : 2; assert(near(a.max[long] - a.min[long], 2) && near(a.max[short] - a.min[short], THICK[kind - 7] + .002), 'orientation: both rotations have a two-cell length and independently specified narrow thickness'); }
  },
  connection() {
    for (const kind of KINDS) for (const rot of [0,1]) { const b = building(kind, rot), c = { ...b, id: 2, x: b.x + (rot ? 0 : 2), z: b.z + (rot ? 2 : 0) }, a = bounds(geometry(b)), d = bounds(geometry(c)), axis = rot ? 2 : 0; assert(near(a.max[axis], d.min[axis]) && near(a.max[axis], (rot ? b.z : b.x) + 2), 'connection: adjacent collinear wall geometry reaches the shared occupied-cell boundary'); }
  },
  damage() {
    for (const kind of KINDS) for (const rot of [0,1]) { const b = building(kind, rot, 1), g = geometry(b), a = bounds(g), tops = new Set(g.pos.filter((_, i) => i % 3 === 1).filter(y => y > HEIGHT[kind - 7] * .504)); assert(a.max[1] <= HEIGHT[kind - 7] * .72 && a.max[1] > HEIGHT[kind - 7] * .504 && tops.size >= 4 && !colorSet(g).has(0x2b2724), 'damage: damaged walls lose height and have multiple broken tops with no house interior'); }
  },
  rubble() {
    const allowed = [[0x9a5a44,0x724a39,0xb6795c,0x583e33],[0xa9a596,0x7d7a6e,0xc0baaa,0x625e55],[0x9c998e,0x74746e,0xb8b5a9,0x5e605b]];
    for (const materials of [true,false]) { setMaterials(materials); for (const kind of KINDS) { const g = geometry(building(kind, 0, 2)), a = bounds(g), cs = colorSet(g); assert(g.triangles === 120 && a.min[1] === 0 && a.max[1] <= .17 && cs.size >= 3 && [...cs].every(c => allowed[kind - 7].includes(c)), 'rubble: concrete fragments retain their independent concrete palette and remain near ground'); assert(g.pos.every(Number.isFinite) && g.col.every(Number.isFinite)); } } setMaterials(true);
  },
  fallback() {
    setWalls(false);
    for (const materials of [true,false]) { setMaterials(materials); for (const kind of KINDS) for (const stage of STAGES) { const b = building(kind, 0, stage), g = geometry(b), old = geometry({ ...b, kind: BK_HOUSE }); assert.deepEqual(g, old, 'fallback: every recorded wall and damage stage draws the exact ordinary-house fallback'); assert(g.pos.length > 0); } } setWalls(true); setMaterials(true);
  },
  fallback_height() {
    setWalls(false); for (const kind of KINDS) assert(near(wallHeight(building(kind)), .46) && roofRise(kind) === .32, 'fallback_height: disabled walls use ordinary wall and roof heights in every battle consumer'); setWalls(true);
  },
  readonly() {
    for (const walls of [true,false]) for (const materials of [true,false]) { setWalls(walls); setMaterials(materials); const w = blank(KINDS.map((k,i) => ({ ...building(k, i % 2, i), x: 10 + i * 4 }))), before = structuredClone(w), h = hashWorld(w); buildTown(w); smokeSources(w); const v = view(w, true); v.update(0,0,new Set()); v.setWorld(w); v.dispose(); assert.deepEqual(w, before, 'readonly: all rendering paths preserve the complete world including RNG'); assert.equal(hashWorld(w), h); } setWalls(true); setMaterials(true);
  },
  marks_surface() {
    for (const kind of KINDS) for (const rot of [0,1]) for (const stage of [0,1]) {
      const b = building(kind,rot,stage), v = view(blank([b])), [x0,x1,z0,z1] = actualBounds(b);
      for (const dir of DIRECTIONS) for (const shell of [SHELL_AP,SHELL_HE]) hit(v,b,dir,shell);
      const hs = marks(v); assert.equal(hs.length,8);
      const mesh = new THREE.Mesh(geometry(b).geometry(), new THREE.MeshBasicMaterial()); mesh.updateMatrixWorld();
      for (const m of hs) { const ray = new THREE.Raycaster(new THREE.Vector3(m.x+m.nx*.1,m.y,m.z+m.nz*.1), new THREE.Vector3(-m.nx,0,-m.nz)), face = ray.intersectObject(mesh)[0]; assert((m.nx ? near(m.x,m.nx<0?x0:x1) : near(m.z,m.nz<0?z0:z1)) && face && Math.abs(face.distance-.1)<.002, 'marks_surface: AP and HE centers lie on the actual wall face for both rotations and all directions'); }
      mesh.geometry.dispose(); mesh.material.dispose(); v.dispose();
    }
  },
  marks_clip() {
    for (const kind of KINDS) for (const rot of [0,1]) for (const stage of [0,1]) {
      const b=building(kind,rot,stage),v=view(blank([b])),[x0,x1,z0,z1]=actualBounds(b),top=HEIGHT[kind-7]*(stage?.504:1);
      for(const dir of DIRECTIONS) for(const shell of [SHELL_AP,SHELL_HE]) hit(v,b,dir,shell,4);
      for(const m of marks(v)) { const s=m.kind===0?1.55:1,along=m.nx?m.z:m.x,lo=m.nx?z0:x0,hi=m.nx?z1:x1; assert(m.y-m.h*s/2>=-.00001&&m.y+m.h*s/2<=top+.00001&&along-m.w*s/2>=lo-.00001&&along+m.w*s/2<=hi+.00001,'marks_clip: the complete AP outer rim and HE stain fit the narrow face and conservative damaged height'); } v.dispose();
    }
  },
  marks_prune() {
    const b=building(8),w=blank([b]),v=view(w);hit(v,b,[-1,0],SHELL_AP,80); const original=marks(v),cut=.48*.504;
    const expected=original.filter(m=>m.y+m.h*1.55/2<=cut); assert(expected.length>0&&expected.length<original.length);
    b.hp=70;v.onEvents([{e:'stage',bld:1,stage:1}],2);assert.equal(marks(v).length,expected.length,'marks_prune: damage removes every AP rim above the surviving wall and rubble removes all marks');
    b.hp=0;v.onEvents([{e:'stage',bld:1,stage:2}],3);hit(v,b,[-1,0]);assert.equal(v.holeCount,0,'marks_prune: damage removes every AP rim above the surviving wall and rubble removes all marks');v.dispose();
  },
  smoke() {
    for(const kind of KINDS) for(const rot of [0,1]) { const b=building(kind,rot),w=blank([b]),v=view(w,true);b.hp=70;v.onEvents([{e:'stage',bld:1,stage:1}],1);const [x0,x1,z0,z1]=actualBounds(b),es=v.emitters.filter(e=>e.id===1&&e.kind<2);assert.equal(es.length,2);assert(es.every(e=>e.x>=x0&&e.z>=z0&&e.x+e.w<=x1+.00001&&e.z+e.d<=z1+.00001&&near(e.h,HEIGHT[kind-7]*.72)),'smoke: fire and smoke origins stay inside the narrow damaged wall surface');v.dispose(); }
  },
  startup_smoke() {
    for(const kind of KINDS) {const b=building(kind,0,1),v=view(blank([b]),true),es=v.emitters;assert(es.length===1&&near(es[0].h,HEIGHT[kind-7]*.72),'startup_smoke: a loaded damaged wall reconstructs smoke below its broken top');const src=smokeSources(v.w)[0];assert(near(src[1],HEIGHT[kind-7]*.5));v.dispose();}
  },
  bars() {
    for(const kind of KINDS) for(const stage of [0,1]) {const b=building(kind,0,stage),w=blank([b]),u=addUnit(w);u.order=ORD_FIRE_AT;u.tx=b.x;u.tz=b.z;const v=view(w);v.update(0,1,new Set());assert.equal(v.barDbg.n,1);const matrix=new THREE.Matrix4();v.barBg.getMatrixAt(0,matrix);const middle=new THREE.Vector3(.5,0,0).applyMatrix4(matrix);assert(near(middle.y,HEIGHT[kind-7]*(stage?.72:1)+.35),'bars: actual health-bar matrix follows the low damaged wall without a phantom roof');v.dispose();}
  },
  ghosts() {
    for(const kind of KINDS) {const b=building(kind),w=blank([b]),v=view(w,true,true);v.onEvents([{e:'build',bld:1}],1);assert(near(v.ghosts.list[0].h,HEIGHT[kind-7]),'ghosts: rising wall uses its exact intact height without an imaginary roof');assert.deepEqual(v.ghosts.list[0].pos,geometry(b).pos);v.update(0,1,new Set());const pos=v.ghosts.mesh.geometry.attributes.position.array,n=v.ghosts.mesh.geometry.drawRange.count;assert([...pos.slice(0,n*3)].filter((_,i)=>i%3===1).every(y=>y<0));v.update(0,1.8,new Set());assert.equal(v.ghostCount,0);assert.equal(v.townTriangles,geometry(b).triangles);b.hp=70;v.onEvents([{e:'stage',bld:1,stage:1}],2);const broken=geometry(b);b.hp=0;v.onEvents([{e:'stage',bld:1,stage:2}],3);assert.deepEqual(v.ghosts.list[0].pos,broken.pos);assert(near(v.ghosts.list[0].h,HEIGHT[kind-7]*.72+.05));v.update(0,4.2,new Set());assert.equal(v.ghostCount,0);assert.equal(v.townTriangles,120);v.dispose();}
  },
  garrison() {
    for(const kind of KINDS) for(const rot of [0,1]) for(const stage of [0,1]) {const b=building(kind,rot,stage),w=blank([b]),u=addUnit(w,UK_OBSERVER,b.x,b.z),v=view(w),y=v.unitHeight(u);assert(y>0&&y<=HEIGHT[kind-7]+.00001&&(!stage||y<HEIGHT[kind-7]),'garrison: inherited roof indicator sits on the actual low or broken wall surface');v.dispose();}
  },
  lifecycle() {
    const w=blank(),v=view(w),preview=blank([building(7),{...building(8,1),x:16},{...building(9),x:20}]);v.setWorld(preview,0);assert.deepEqual(v.town.geometry.attributes.position.array,new Float32Array(buildTown(preview).pos),'lifecycle: preview geometry exactly matches a fresh rendering of the draft world');v.setWorld(w);assert.equal(v.townTriangles,0);v.setWorld(preview);const saved=v.town.geometry.attributes.position.array.slice();v.setWorld(blank());v.setWorld(preview);assert.deepEqual(v.town.geometry.attributes.position.array,saved);v.dispose();
  },
  legacy() {
    const fp=g=>{let h=2166136261;const s=JSON.stringify([g.pos,g.col,g.nor]);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16);};
    setMaterials(false);setFacades(false);for(const walls of [true,false]){setWalls(walls);const a=createWorld(1944),b=createWorld(1944);applyMap(b,1);assert.deepEqual([fp(buildTown(a)),fp(buildTown(b))],['fc43cc18','2eb8beb0'],'legacy: both historical map geometry fingerprints remain unchanged');}setWalls(true);setMaterials(true);setFacades(true);
  },
  combinations() {
    // R024 has no render-module switch: its old list can omit pillboxes while recorded ones must still render.
    for(const r024 of [true,false])for(const r105 of [true,false]){setMaterials(r105);const bs=KINDS.map((k,i)=>({...building(k, i%2, i),x:10+i*4}));if(r024)bs.push({...building(BK_PILLBOX),x:24,w:1,d:1});const w=blank(bs),before=structuredClone(w),v=view(w);assert.equal(v.townTriangles,338 + (r024 ? geometry(bs.at(-1)).triangles : 0),'combinations: noR105 and omitted R024 selection never hide or corrupt recorded wall stages');assert.deepEqual(w,before);v.dispose();}setMaterials(true);
  },
  budget() {
    for(const map of [0,1]) for(const mixed of [false,true]) {
      const w=createWorld(1944);applyMap(w,map,1);
      for(const side of [0,1]) {if(mixed) {let found=false;for(let z=0;z<N&&!found;z++)for(let x=0;x<N&&!found;x++)if(applyTrench(w,{t:'trench',side,kind:0,x,z,rot:0})===null)found=true;assert(found);}
        for(let count=0;count<(mixed?7:8);count++){let placed=false;for(let z=0;z<N&&!placed;z++)for(let x=0;x<N&&!placed;x++)for(let rot=0;rot<2&&!placed;rot++){const c={t:'build',side,kind:7,x,z,rot};if(buildError(w,c)===null){assert.equal(applyBuild(w,c),null);placed=true;}}assert(placed,'budget fixture places every affordable wall');}assert.equal(pointsUsed(w,side),8);}
      setWalls(true);const on=view(w);on.update(0,0,new Set());const a=budget(on);setWalls(false);const off=view(w);off.update(0,0,new Set());const b=budget(off);const legacy=structuredClone(w);legacy.blds=legacy.blds.map(b=>b.kind>=7?{...b,kind:BK_HOUSE}:b);const old=view(legacy);old.update(0,0,new Set());const c=budget(old);
      assert(a.calls===c.calls&&b.calls===c.calls&&a.meshes===c.meshes&&b.meshes===c.meshes,'budget: maximum walls and mixed trenches add no meshes or draw calls');assert(a.calls<=20&&a.triangles<=80000&&b.calls<=20&&b.triangles<=80000,'budget: opening including shadows stays under unchanged mobile limits');console.log(`  map${map} ${mixed?'mixed':'max'}: ${a.calls} calls/${a.triangles} triangles, fallback ${b.calls}/${b.triangles}`);for(const v of [on,off,old])v.dispose();setWalls(true);
    }
  },
};
const only=process.argv.find(s=>s.startsWith('--group='))?.slice(8)??(mutant?mutations[mutant].group:undefined);
let count=0;
for(const [name,run]of Object.entries(groups))if(!only||name===only){count++;try{run();console.log(`OK walls-view ${name}`);}catch(error){console.error(`NG walls-view ${name}`);console.error(`${error.code==='ERR_ASSERTION'?'AssertionError [ERR_ASSERTION]':error.name}: ${error.message.split('\n')[0]}`);process.exit(1);}}
assert(count>0,'requested view group exists');
if(!only&&!mutant||process.argv.includes('--mutations'))for(const[name,m]of Object.entries(mutations)){const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--mutant=${name}`],{encoding:'utf8',timeout:15000,maxBuffer:2e6});assert.equal(p.status,1,`${name}: semantic mutant exits 1\n${p.stdout}\n${p.stderr}`);const first=p.stderr.match(/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/)?.[1];assert.equal(first,m.message,`${name}: first failure must be intended assertion, not startup\n${p.stderr.slice(-1500)}`);console.log(`RED walls-view ${name}: ${first}`);}
console.log(`walls-view: ${count} requested geometry/effect guards passed; real Chrome screenshots and frame measurements remain separate`);
