// R122: independent nominal annulus examples; --mutations isolates every negative control.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createWorld, hashWorld, N, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_MORTAR, UK_OBSERVER, SIDE_PLAYER, SIDE_ENEMY, ORD_IDLE } from '../src/sim/world.ts';

const url = new URL('../src/render/multiRange.ts', import.meta.url);
const mutations = {
  union_cpu: { group: 'centers', from: 'if (d2 < min * min || d2 > max * max) return false;', to: 'if (d2 >= min * min && d2 <= max * max) return true;', message: 'inside first circle alone is not common coverage' },
  omit_near: { group: 'annuli', from: 'if (d2 < min * min || d2 > max * max)', to: 'if (d2 > max * max)', message: 'common center is excluded by the near holes' },
  exclusive_near: { group: 'annuli', from: 'd2 < min * min', to: 'd2 <= min * min', message: 'exact near boundary is inclusive' },
  exclusive_far: { group: 'annuli', from: 'd2 > max * max', to: 'd2 >= max * max', message: 'exact far boundary is inclusive' },
  clip_right: { group: 'clipping', from: ' || x > N', to: '', message: 'right map exterior is excluded' },
  collapse_centers: { group: 'centers', from: 'this.data[at] = u.x / SUB;', to: 'this.data[at] = N / 2;', message: 'inside first circle alone is not common coverage' },
  armed_only_count: { group: 'selection', from: 's.selectedCount++;', to: 'if (UNIT_KINDS[u.kind].range > 0) s.selectedCount++;', message: 'gun plus observer counts as multiselection' },
  omit_excluded: { group: 'selection', from: 's.excludedCount++; continue;', to: 'continue;', message: 'unarmed exclusion count is explicit' },
  stale_positions: { group: 'lifecycle', from: 'this.data[at] = u.x / SUB;', to: 'this.data[at] = N / 2;', message: 'moving units invalidates old common coverage' },
  permit_overflow: { group: 'capacity', from: 's.armedCount > MULTI_RANGE_CAP', to: 's.armedCount > MULTI_RANGE_CAP + 1', message: '513 armed units fail closed rather than truncate' },
  lose_last_slot: { group: 'capacity', from: 's.armedCount > MULTI_RANGE_CAP', to: 's.armedCount >= MULTI_RANGE_CAP', message: '512 armed units retain complete intersection' },
  world_write: { group: 'readonly_pool', from: 'const s = this.solution;', to: 'const s = this.solution; w.rng = (w.rng + 1) >>> 0;', message: 'overlay preserves the entire World including RNG and events' },
  double_pass: { group: 'readonly_pool', from: 'material.forceSinglePass = true;', to: 'material.forceSinglePass = false;', message: 'transparent overlay is drawn only once' },
  dead_filter: { group: 'lifecycle', from: '!u.alive || ', to: '', message: 'dead selections are excluded' },
  enemy_filter: { group: 'lifecycle', from: 'u.side !== SIDE_PLAYER || ', to: '', message: 'enemy selections are excluded' },
  ignore_valve: { group: 'lifecycle', from: 'if (!enabled)', to: 'if (false)', message: 'disabled valve clears old multiselection' },
  stale_draw: { group: 'lifecycle', from: 'this.mesh.visible = false; this.mesh.geometry.setDrawRange(0, 0); this.mesh.material.uniforms.armedCount.value = 0;', to: 'this.mesh.visible = false; this.mesh.material.uniforms.armedCount.value = 0;', message: 'death removes old multiselection: zero draw range' },
  shader_union: { group: 'shader_contract', from: 'common = common && d >= a.z && d <= a.w;', to: 'common = common || (d >= a.z && d <= a.w);', message: 'fragment shader intersects every complete armed annulus' },
  shader_near: { group: 'shader_contract', from: 'common = common && d >= a.z && d <= a.w;', to: 'common = common && d <= a.w;', message: 'fragment shader intersects every complete armed annulus' },
}; // Mutants exist only in isolated data-URL modules, never in production files.
const mutant = process.argv.find(a => a.startsWith('--mutant='))?.slice(9);
const selectedGroup = process.env.R122_GROUP;
async function load() {
  if (!mutant) return import(url.href);
  const m = mutations[mutant]; assert.ok(m, 'known mutant');
  const source = fs.readFileSync(url, 'utf8');
  assert.equal(source.split(m.from).length - 1, 1, 'unique production mutation anchor');
  const js = stripTypeScriptTypes(source.replace(m.from, m.to)).replace(/from '([^']+)'/g, (_, spec) => `from '${spec.startsWith('.') ? new URL(spec, url).href : import.meta.resolve(spec)}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { MultiRangePreview, MULTI_RANGE_CAP } = await load();
let groups = 0;
function group(name, fn) {
  if (selectedGroup && selectedGroup !== name) return;
  try { fn(); groups++; console.log(`OK multi-range: ${name}`); }
  catch (e) { console.error(`NG multi-range: ${name}`); throw e; }
}
const R = kind => UNIT_KINDS[kind].range / SUB;
const M = kind => UNIT_KINDS[kind].minRange / SUB;
function fixture() { const w = createWorld(1944); w.units = []; return { w, view: new MultiRangePreview(), selected: new Set() }; }
function add(f, kind, x, z, side = SIDE_PLAYER) {
  const u = { id: f.w.units.length + 1, kind, x: Math.round(x * SUB), z: Math.round(z * SUB), side, hp: UNIT_KINDS[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 };
  f.w.units.push(u); f.selected.add(u.id); return u;
}
const refresh = f => f.view.update(f.w, f.selected);
function hidden(f, message) {
  assert.equal(f.view.mesh.visible, false, message);
  assert.equal(f.view.mesh.geometry.drawRange.count, 0, `${message}: zero draw range`);
  assert.equal(f.view.mesh.material.uniforms.armedCount.value, 0, `${message}: zero GPU armed count`);
  assert.equal(f.view.contains(N / 2, N / 2), false, `${message}: no stale membership`);
}
function pair(kind, x, z, dx = 0, dz = 0) { const f = fixture(); add(f, kind, x, z); add(f, kind, x + dx, z + dz); refresh(f); return f; }

group('centers', () => {
  const r = R(UK_TANK), f = pair(UK_TANK, N / 2 - r / 2, N / 2, r);
  assert.equal(f.view.contains(N / 2, N / 2), true, 'shifted circles share their midpoint');
  assert.equal(f.view.contains(N / 2 - r, N / 2), false, 'inside first circle alone is not common coverage');
  assert.equal(f.view.contains(N / 2, N / 2 + r), false, 'team-center circle is not the actual intersection');
  assert.equal(f.view.contains(N / 2, N / 2 + r / 2), true, 'offset circles include the analytic inner lens');
  assert.deepEqual([...f.view.data.slice(0, 8)], [N / 2 - r / 2, N / 2, M(UK_TANK), r, N / 2 + r / 2, N / 2, M(UK_TANK), r], 'texture rows retain each real center and range');
  for (const u of f.w.units) { const x = u.x; u.x = u.z; u.z = x; } refresh(f);
  assert.equal(f.view.contains(N / 2, N / 2 - r), false, 'offset z centers are not collapsed into a common center');
  assert.equal(f.view.contains(N / 2 + r / 2, N / 2), true, 'rotated offset circles retain their common lens');
  f.view.dispose();
});
group('annuli', () => {
  const f = fixture(), c = N / 2;
  add(f, UK_HOWITZER, c, c); add(f, UK_MORTAR, c, c); refresh(f);
  const near = Math.max(M(UK_HOWITZER), M(UK_MORTAR)), far = Math.min(R(UK_HOWITZER), R(UK_MORTAR));
  assert.ok(near < far, 'fixture has a nonempty mixed annulus');
  assert.equal(f.view.contains(c, c), false, 'common center is excluded by the near holes');
  assert.equal(f.view.contains(c + near - 1 / SUB, c), false, 'stricter near limit excludes its interior');
  assert.equal(f.view.contains(c + near, c), true, 'exact near boundary is inclusive');
  assert.equal(f.view.contains(c + far, c), true, 'exact far boundary is inclusive');
  assert.equal(f.view.contains(c + far + 1 / SUB, c), false, 'shorter maximum range excludes its exterior');
  assert.equal(f.view.contains(c + (near + far) / 2, c), true, 'different weapon ranges intersect as annuli');
  f.w.units[1].kind = UK_HOWITZER; f.w.units[1].x += M(UK_HOWITZER) * SUB; refresh(f);
  assert.equal(f.view.contains(c + M(UK_HOWITZER), c), false, 'offset second weapon near hole removes coverage valid for the first');
  assert.equal(f.view.contains(c - M(UK_HOWITZER), c), true, 'offset annuli retain a point outside both independent near holes');
  f.view.dispose();
});
group('tangent_disjoint', () => {
  const r = R(UK_TANK), c = N / 2, f = pair(UK_TANK, c - r, c, 2 * r);
  assert.equal(f.view.contains(c, c), true, 'externally tangent circles include the single touching point');
  assert.equal(f.view.contains(c, c + 1 / SUB), false, 'tangent circles have no finite-width common strip');
  f.w.units[1].x += 1; refresh(f);
  assert.equal(f.view.contains(c, c), false, 'separated circles have no former touching point');
  for (let x = 0; x <= N; x++) for (let z = 0; z <= N; z++) assert.equal(f.view.contains(x, z), false, 'disjoint circles have empty intersection');
  f.view.dispose();
});
group('clipping', () => {
  const f = pair(UK_TANK, 0, 0);
  assert.equal(f.view.contains(0, 0), true, 'map origin is included');
  assert.equal(f.view.contains(-1 / SUB, 0), false, 'left map exterior is excluded');
  assert.equal(f.view.contains(0, -1 / SUB), false, 'top map exterior is excluded');
  for (const u of f.w.units) { u.x = N * SUB; u.z = N * SUB; } refresh(f);
  assert.equal(f.view.contains(N, N), true, 'far map boundary is included');
  assert.equal(f.view.contains(N + 1 / SUB, N), false, 'right map exterior is excluded');
  assert.equal(f.view.contains(N, N + 1 / SUB), false, 'bottom map exterior is excluded');
  f.view.dispose();
});
group('selection', () => {
  const f = fixture(), c = N / 2;
  add(f, UK_TANK, c, c); add(f, UK_OBSERVER, 0, 0);
  let s = refresh(f);
  assert.equal(s.selectedCount, 2, 'gun plus observer counts as multiselection');
  assert.equal(s.armedCount, 1, 'unarmed observer is excluded from annulus intersection');
  assert.equal(s.excludedCount, 1, 'unarmed exclusion count is explicit');
  assert.equal(f.view.contains(c, c), true, 'one armed plus unarmed preserves armed coverage');
  assert.match(s.legend, /無武裝.*1|1.*無武裝/, 'legend gives unarmed exclusion count');
  assert.match(s.legend, /名目/, 'legend labels nominal coverage');
  assert.match(s.legend, /視線/, 'legend warns about line of sight');
  assert.match(s.legend, /命中/, 'legend warns about hits');
  f.w.units[0].kind = UK_OBSERVER; s = refresh(f);
  assert.equal(s.armedCount, 0); assert.equal(s.excludedCount, 2);
  hidden(f, 'all-unarmed selection has no weapon overlay');
  assert.match(s.legend, /無武裝/, 'all-unarmed selection explains the absence');
  f.view.dispose();
});
group('lifecycle', () => {
  const f = pair(UK_TANK, N / 2, N / 2), [a, b] = f.w.units;
  const stale = () => { a.x = b.x = SUB; refresh(f); assert.equal(f.view.contains(N / 2, N / 2), false, 'moving units invalidates old common coverage'); };
  stale(); a.x = b.x = N / 2 * SUB; a.z = b.z = N / 2 * SUB; refresh(f);
  b.alive = false; assert.equal(refresh(f).selectedCount, 1, 'dead selections are excluded'); hidden(f, 'death removes old multiselection');
  b.alive = true; b.side = SIDE_ENEMY; assert.equal(refresh(f).selectedCount, 1, 'enemy selections are excluded'); hidden(f, 'side change removes old multiselection');
  b.side = SIDE_PLAYER; refresh(f); f.selected.delete(b.id); refresh(f); hidden(f, 'single selection clears old multiselection');
  f.selected.add(b.id); refresh(f); f.selected.clear(); refresh(f); hidden(f, 'empty selection clears old multiselection');
  f.selected.add(a.id); f.selected.add(b.id); refresh(f); f.view.update(f.w, f.selected, false); hidden(f, 'disabled valve clears old multiselection');
  refresh(f); const next = createWorld(17); next.units = []; f.view.update(next, f.selected); hidden(f, 'new match clears old multiselection');
  f.selected.add(999999); b.side = SIDE_ENEMY; b.alive = false; assert.equal(refresh(f).selectedCount, 1, 'unknown dead and enemy selected ids do not count');
  f.view.dispose();
});
group('capacity', () => {
  assert.equal(MULTI_RANGE_CAP, 512, 'capacity remains the frozen 512 limit');
  const f = fixture(); for (let i = 0; i < 512; i++) add(f, UK_TANK, N / 2, N / 2);
  let s = refresh(f); assert.equal(s.armedCount, 512); assert.equal(f.view.contains(N / 2, N / 2), true, '512 armed units retain complete intersection');
  add(f, UK_OBSERVER, 0, 0); s = refresh(f); assert.equal(s.excludedCount, 1); assert.equal(f.view.mesh.visible, true, 'unarmed selections do not consume armed capacity');
  add(f, UK_TANK, 0, 0); s = refresh(f); assert.equal(s.reason, 'overflow', '513 armed units fail closed rather than truncate');
  assert.equal(s.armedCount, 513); hidden(f, 'overflow hides incomplete common coverage');
  assert.match(s.legend, /512/, 'overflow legend states the capacity');
  f.selected.delete(f.w.units.at(-1).id); refresh(f); assert.equal(f.view.contains(N / 2, N / 2), true, 'capacity recovery restores a complete intersection');
  f.view.dispose();
});
group('shader_contract', () => {
  const v = new MultiRangePreview(), shader = v.mesh.material.fragmentShader.replace(/\s+/g, ' ');
  assert.ok(shader.includes('common = common && d >= a.z && d <= a.w;'), 'fragment shader intersects every complete armed annulus');
  assert.ok(shader.includes('length(worldXZ - a.xy)'), 'shader measures each actual center');
  assert.ok(shader.includes('if (i >= armedCount) break;'), 'shader processes only active armed slots');
  assert.ok(shader.includes('(float(i) + 0.5) / 512.0'), 'shader samples texel centers at the fixed capacity');
  assert.ok(shader.includes('outerRing = outerRing || abs(d - a.w)'), 'shader retains every outer range boundary');
  assert.ok(shader.includes('innerRing = innerRing || (a.z > 0.0'), 'shader retains every nonzero near boundary');
  v.dispose();
});
group('readonly_pool', () => {
  const f = pair(UK_TANK, N / 2, N / 2), v = f.view, mesh = v.mesh, geometry = mesh.geometry, material = mesh.material, data = v.data;
  const textures = Object.values(material.uniforms).map(u => u.value).filter(x => x?.isDataTexture);
  assert.equal(textures.length, 1, 'one fixed data texture backs the one-pass overlay');
  const texture = textures[0];
  assert.equal(texture.image.width, 512); assert.equal(texture.image.height, 1);
  assert.equal(texture.image.data, data); assert.equal(data.length, 512 * 4);
  assert.equal(texture.type, THREE.FloatType); assert.equal(texture.format, THREE.RGBAFormat);
  assert.equal(texture.minFilter, THREE.NearestFilter); assert.equal(texture.magFilter, THREE.NearestFilter); assert.equal(texture.generateMipmaps, false);
  assert.equal(material.uniforms.armedCount.value, 2, 'shader count exactly matches the active armed pool');
  assert.equal(material.isShaderMaterial, true); assert.equal(material.transparent, true);
  assert.equal(material.forceSinglePass, true, 'transparent overlay is drawn only once');
  assert.equal(material.depthWrite, false); assert.equal(mesh.castShadow, false);
  assert.equal(geometry.index.count, 6, 'single plane adds exactly two triangles');
  assert.equal(geometry.drawRange.count, 6, 'active overlay draws exactly two triangles');
  const snapshot = structuredClone(f.w), hash = hashWorld(f.w), selection = [...f.selected];
  for (let i = 0; i < 20; i++) { v.update(f.w, f.selected, i % 2 === 0); assert.equal(v.mesh, mesh); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); assert.equal(v.data, data); assert.equal(texture.image.data, data); }
  assert.deepEqual(f.w, snapshot, 'overlay preserves the entire World including RNG and events');
  assert.equal(hashWorld(f.w), hash); assert.deepEqual([...f.selected], selection, 'overlay never changes user selection');
  const disposals = { texture: 0, geometry: 0, material: 0 };
  for (const [name, resource] of Object.entries({ texture, geometry, material })) resource.addEventListener('dispose', () => disposals[name]++);
  v.dispose(); assert.deepEqual(disposals, { texture: 1, geometry: 1, material: 1 }, 'all owned GPU resources are disposed');
});
if (process.argv.includes('--mutations')) {
  assert.ok(Object.keys(mutations).length > 0, 'semantic negative controls are registered');
  for (const [name, m] of Object.entries(mutations)) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--mutant=${name}`], { encoding: 'utf8', timeout: 25000, env: { ...process.env, R122_GROUP: m.group } });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, `${name}: mutant must fail`);
    assert.match(output, /AssertionError/, `${name}: must fail an assertion, not startup`);
    assert.ok(output.includes(`NG multi-range: ${m.group}`), `${name}: intended group must be first red\n${output}`);
    assert.ok(output.includes(m.message), `${name}: first failure must be intended semantic assertion\n${output}`);
    console.log(`OK multi-range negative: ${name} → ${m.message}`);
  }
}
assert.ok(groups > 0); console.log(`multi-range: ${groups} groups OK`);
