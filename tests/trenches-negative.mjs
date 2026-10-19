// R118：每個隔離副本只跑對應語意群；第一個錯誤必須是指定 AssertionError，不能靠啟動或編譯紅燈。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),temp=mkdtempSync(join(tmpdir(),'r118-negative-'));
const mutants=[
  ['wrong_cost','templates','trenches.ts',"name: 'straight', cost: 1","name: 'straight', cost: 2",'templates: four published templates and exact costs/cover'],
  ['wrong_rotation','templates','trenches.ts','rot === 1 ? [-z, x]','rot === 1 ? [z, x]','templates: exact quarter-turn footprint including L empty corner'],
  ['rng_draw','templates','trenches.ts','  w.trenches.segments.push(s);','  w.rng++;\n  w.trenches.segments.push(s);','templates: never draws World.rng'],
  ['loose_integer','validation','trenches.ts',"  if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.z)) return 'coord';",'','validation: precise refusal code'],
  ['road_allowed','validation','trenches.ts',"  if (cells.some(([x, z]) => w.ter[idx(x, z)] === TER_ROAD)) return 'road';",'','validation: precise refusal code'],
  ['overlap_allowed','validation','trenches.ts','w.occ[idx(x, z)] || trenchAt(w, x, z)','w.occ[idx(x, z)]','validation: precise refusal code'],
  ['eager_state','validation','trenches.ts','  const err = trenchError(w, cmd);','  if (!w.trenches) w.trenches = { version: 1, segments: [] };\n  const err = trenchError(w, cmd);','validation: rejected command leaves complete world unchanged'],
  ['clear_empty_corner','vegetation','trenches.ts','clearVegetation(w, x, z, 1, 1);','clearVegetation(w, s.x, s.z, 2, 2);','vegetation: only actual L cells cleared, empty corner retained'],
  ['late_regrowth','vegetation','maps.ts','    for (const s of w.trenches?.segments ?? []) for (const [x, z] of trenchCells(s)) clearVegetation(w, x, z, 1, 1);','','vegetation: late same-map activation cannot regrow inside paid trench'],
  ['free_trench','budget_order','trenches.ts',"  if (pointsUsed(w, cmd.side) + k.cost > BUILD_POINTS) return 'points';",'','budget_order: buildings consume trench budget'],
  ['free_build','budget_order','build.ts','  return p + trenchPointsUsed(w, side);','  return p;','budget_order: shared total includes buildings and trenches'],
  ['reorder_commands','budget_order','step.ts',"for (const c of cmds) { if (c.t === 'build') applyBuild(w, c); else if (c.t === 'trench') applyTrench(w, c); }","for (const c of cmds) if (c.t === 'build') applyBuild(w, c); for (const c of cmds) if (c.t === 'trench') applyTrench(w, c);",'budget_order: earlier trench wins mixed overlap'],
  ['map_order','budget_order','step.ts',"  for (const c of cmds) if (c.t === 'map') applyMap(w, c.id | 0, c.id === 0 || c.id === 1 ? c.vegetation : undefined);",'','budget_order: maps precede mixed construction regardless of log order'],
  ['building_overlap','budget_order','build.ts',"w.occ[idx(x, z)] || trenchAt(w, x, z)","w.occ[idx(x, z)]",'budget_order: later building cannot cover trench'],
  ['hq_overlap','maps_hq','eco.ts',' || trenchAt(w, cx, cz)','','maps_hq: headquarters never cover paid trench cells'],
  ['map_overwrite','maps_hq','maps.ts','  if (w.trenches?.segments.length && (w.map ?? 0) !== id) return;','','maps_hq: changing base map after successful trench is an atomic rejection'],
  ['no_cover','cover','step.ts','  const ground = Math.min(terrain, allowGroundCover ? trenchCover(w, x, z) : 100);','  const ground = terrain;','cover: all sides/types/projectiles use strongest protection without stacking'],
  ['stack_cover','cover','step.ts','Math.min(terrain, allowGroundCover ? trenchCover(w, x, z) : 100)','Math.floor(terrain * (allowGroundCover ? trenchCover(w, x, z) : 100) / 100)','cover: all sides/types/projectiles use strongest protection without stacking'],
  ['early_round','rounding','step.ts','Math.floor((dmg * UNIT_KINDS[u.kind].armor * cover) / 10000)','Math.floor(Math.floor(dmg * UNIT_KINDS[u.kind].armor / 100) * cover / 100)','rounding: falloff then piercing then combined armor/cover floor'],
  ['collapse_cover','exceptions','step.ts','allowGroundCover ? trenchCover(w, x, z) : 100','trenchCover(w, x, z)','exceptions: collapse bypasses trench and every ground protection'],
  ['wrong_hit_cell','cells_movement','step.ts','  const ground = Math.min(terrain, allowGroundCover ? trenchCover(w, x, z) : 100);','  const ground = Math.min(terrain, allowGroundCover ? trenchCover(w, x + 1, z) : 100);','cells_movement: hit uses current integer cell boundary'],
  ['blocks_path','passability','world.ts','  return !!b && b.hp > 0;','  return (!!b && b.hp > 0) || !!w.trenches?.segments.some(s => s.x === x && s.z === z);','passability: trench never blocks a cell'],
  ['missing_hash','replay_hash','world.ts','f.int(s.side).int(s.kind).int(s.x).int(s.z).int(s.rot);','f.int(s.side).int(s.kind).int(s.x).int(s.z);','replay_hash: every persistent trench field, order and presence affects hash'],
  ['old_state','legacy','world.ts','  return w;\n}','  w.trenches = { version: 1, segments: [] };\n  return w;\n}','legacy: original initial SCRIPT hash'],
];
try{
  for(const [name,group,file,from,to,wanted]of mutants){
    const dir=join(temp,name);mkdirSync(join(dir,'tests'),{recursive:true});cpSync(join(root,'src/sim'),join(dir,'src/sim'),{recursive:true});cpSync(join(root,'tests/trenches.mjs'),join(dir,'tests/trenches.mjs'));writeFileSync(join(dir,'package.json'),'{"type":"module"}');
    const path=join(dir,'src/sim',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,`${name}: unique mutation anchor`);writeFileSync(path,source.replace(from,to));
    const r=spawnSync(process.execPath,[join(dir,'tests/trenches.mjs'),group],{encoding:'utf8',timeout:120000}),output=`${r.stdout}\n${r.stderr}`;
    assert.equal(r.error,undefined,`${name}: child starts and completes`);assert.equal(r.signal,null,`${name}: no timeout or signal`);assert.notEqual(r.status,0,`${name}: mutation must fail`);
    const first=/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/.exec(output)?.[1];assert.equal(first,wanted,`${name}: intended assertion must fail first, got ${output.slice(-2000)}`);console.log(`OK trenches-negative/${name}: ${first}`);
  }
}finally{rmSync(temp,{recursive:true,force:true});}
console.log(`trenches-negative: ${mutants.length} isolated semantic mutants rejected`);
