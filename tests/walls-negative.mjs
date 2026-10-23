// R120: mutate isolated copies, requiring the intended semantic assertion to fail first. No launch/type errors count.
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),temp=mkdtempSync(join(tmpdir(),'r120-negative-'));
const mutants=[
 ['cost','templates','build.ts',"name: 'wall_stone', kind: BK_WALL_STONE, w: 2, d: 1, floors: 1, cost: 2","name: 'wall_stone', kind: BK_WALL_STONE, w: 2, d: 1, floors: 1, cost: 1",'templates: exact separate wall table'],
 ['dimensions','templates','build.ts',"name: 'wall_brick', kind: BK_WALL_BRICK, w: 2, d: 1","name: 'wall_brick', kind: BK_WALL_BRICK, w: 1, d: 1",'templates: exact separate wall table'],
 ['health','templates','world.ts','if (kind === BK_WALL_CONCRETE) return 360;','if (kind === BK_WALL_CONCRETE) return 400;','templates: fixed wall health and dimensions'],
 ['material','templates','world.ts','kind === BK_CHURCH || kind === BK_WALL_STONE','kind === BK_CHURCH','templates: wall material'],
 ['rng','templates','build.ts','  w.blds.push(b);','  w.rng++;\n  w.blds.push(b);','templates: construction never draws World.rng'],
 ['enemy_table','templates','build.ts','[...BUILD_KINDS, PILLBOX_KIND]','[...BUILD_KINDS, PILLBOX_KIND, { name: "wall_brick", kind: 7, w: 2, d: 1, floors: 1, cost: 1 }]','templates: enemy table excludes walls'],
 ['fractional','validation','build.ts',"  if (!Number.isInteger(cmd.x) || !Number.isInteger(cmd.z)) return 'coord';",'','validation: exact refusal reason'],
 ['road','validation','build.ts',"if (w.ter[cellIdx(w, x, z)] === TER_ROAD) return 'road';", "if (false) return 'road';",'validation: exact refusal reason'],
 ['mud','validation','build.ts',"if (w.ter[cellIdx(w, x, z)] === TER_MUD) return 'mud';", "if (false) return 'mud';",'validation: exact refusal reason'],
 ['trench_overlap','validation','build.ts','w.occ[cellIdx(w, x, z)] || trenchAt(w, x, z)','w.occ[cellIdx(w, x, z)]','validation: exact refusal reason'],
 ['atomic','validation','build.ts','  const err = buildError(w, cmd);','  w.events.push({ e: "build", bld: 999 });\n  const err = buildError(w, cmd);','validation: rejection leaves entire world unchanged'],
 ['walls_cannot_join','gap','build.ts',"if (!isWallKind(k.kind) || !isWallKind(neighbor.kind)) return 'gap';","if (true) return 'gap';",'gap: only walls may connect edge or corner'],
 ['houses_join_walls','gap','build.ts',"if (!isWallKind(k.kind) || !isWallKind(neighbor.kind)) return 'gap';","if (!isWallKind(k.kind) && !isWallKind(neighbor.kind)) return 'gap';",'gap: wall-house separation is symmetric'],
 ['empty_pocket','connectivity','build.ts',"  if (isWallKind(k.kind) && !wallKeepsOpenCells(w, f.x, f.z, f.w, f.d)) return 'blocked';",'','connectivity: prevents every newly closed empty pocket'],
 ['corner_cut','connectivity','build.ts','          if (k >= 4 && (blocked(cx + DX[k], cz, placed) || blocked(cx, cz + DZ[k], placed))) continue;','','connectivity: prevents every newly closed empty pocket'],
 ['preexisting_components','connectivity','build.ts','        if (used[before[start]]) return false;','        if (used[before[start]] || before[start] > 1) return false;','connectivity: preserves already disconnected components without rejecting them'],
 ['shared_trench_cost','budget_order','build.ts','  return p + trenchPointsUsed(w, side);','  return p;','budget_order: walls houses and trenches share points'],
 ['unlimited_budget','budget_order','build.ts',"  if (pointsUsed(w, cmd.side) + k.cost > BUILD_POINTS) return 'points';",'','budget_order: walls cannot exceed shared budget'],
 ['mixed_order','budget_order','step.ts',"for (const c of cmds) { if (c.t === 'build') applyBuild(w, c); else if (c.t === 'trench') applyTrench(w, c); }","for (const c of cmds) if (c.t === 'build') applyBuild(w, c); for (const c of cmds) if (c.t === 'trench') applyTrench(w, c);",'budget_order: earlier trench wins overlap'],
 ['vegetation_extent','budget_order','build.ts','  clearVegetation(w, f.x, f.z, f.w, f.d);','  clearVegetation(w, f.x, f.z, f.w + 1, f.d);','budget_order: only occupied wall cells clear vegetation'],
 ['hq_missing','maps_hq','eco.ts','    const at = hqSpot(w, side);','    const at = side === 0 ? null : hqSpot(w, side);','maps_hq: both headquarters exist'],
 ['hq_overwrite','maps_hq','eco.ts','      if (w.occ[i]) ok = false;','','maps_hq: headquarters never overwrite paid wall or house'],
 ['hq_production','maps_hq','eco.ts','  if (!e) return;','  if (!e || w.blds.some(b => b.kind === 7)) return;','maps_hq: both HQs actually produce a new tank'],
 ['hq_spawn','maps_hq','eco.ts','  const spot = spawnCell(w, hq);','  const spot = [hq.x, hq.z];','maps_hq: produced tanks spawn outside every paid building and HQ'],
 ['hq_egress','maps_hq','step.ts','  for (const u of w.units) if (u.alive) moveUnit(w, u);','  for (const u of w.units) if (u.alive && u.id < 10) moveUnit(w, u);','maps_hq: both produced tanks physically leave HQ for main battlefield'],
 ['ordinary_ap','destruction','step.ts','b.kind === BK_PILLBOX ? k.dmgBld >> 2 : k.dmgBld','b.kind === BK_PILLBOX || b.kind === 9 ? k.dmgBld >> 2 : k.dmgBld','destruction: actual AP and HE apply ordinary building damage'],
 ['ordinary_he','destruction','step.ts','    damageBld(w, b, k.dmgBld);','    damageBld(w, b, k.dmgBld >> 1);','destruction: actual AP and HE apply ordinary building damage'],
 ['rubble_blocks','destruction','world.ts','  return !!b && b.hp > 0;','  return !!b && (b.hp > 0 || isWallKind(b.kind));','destruction: entire two-cell segment opens only at zero HP'],
 ['rubble_speed','destruction','world.ts','  if (w.occ[i]) p = 45;','  if (w.occ[i]) p = 85;','destruction: rubble retains movement slowdown'],
 ['los','destruction','step.ts','w.blds[w.occ[c] - 1].hp > 0','w.blds[w.occ[c] - 1].hp > 0 && w.blds[w.occ[c] - 1].kind < 7','destruction: standing wall intercepts direct fire'],
 ['garrison_entry','garrison_los','step.ts',"garr ? (bldAt(w, gx, gz)?.id ?? 0) : 0","garr && (bldAt(w, gx, gz)?.kind ?? 0) < 7 ? (bldAt(w, gx, gz)?.id ?? 0) : 0",'garrison_los: observer and infantry inherit ordinary building entry'],
 ['garrison_cover','garrison_los','step.ts','home.kind === BK_PILLBOX ? 25 : 50','home.kind === BK_PILLBOX || home.kind === 9 ? 25 : 50','garrison_los: intact and damaged walls inherit fifty-percent garrison cover'],
 ['collapse','garrison_los','step.ts','damageUnit(w, u, 20, false);','damageUnit(w, u, 10, false);','garrison_los: collapse injury bypasses ground cover'],
 ['wall_hash','replay','world.ts','f.int(b.id).int(b.kind).int(b.x)','f.int(b.id).int(b.x)','replay: all persistent wall fields affect hash'],
 ['legacy','legacy','world.ts','    seed: seed >>> 0, tick: 0, rng: seed >>> 0, n: N,','    seed: seed >>> 0, tick: 0, rng: (seed + 1) >>> 0, n: N,','legacy: original initial SCRIPT hash'],
];
try{for(const [name,group,file,from,to,wanted]of mutants){const dir=join(temp,name);mkdirSync(join(dir,'tests'),{recursive:true});cpSync(join(root,'src/sim'),join(dir,'src/sim'),{recursive:true});cpSync(join(root,'tests/walls.mjs'),join(dir,'tests/walls.mjs'));writeFileSync(join(dir,'package.json'),'{"type":"module"}');const path=join(dir,'src/sim',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,`${name}: unique mutation anchor`);writeFileSync(path,source.replace(from,to));const r=spawnSync(process.execPath,[join(dir,'tests/walls.mjs'),group],{encoding:'utf8',timeout:120000}),output=`${r.stdout}\n${r.stderr}`;assert.equal(r.error,undefined,`${name}: child starts and finishes`);assert.equal(r.signal,null,`${name}: no timeout or signal`);assert.notEqual(r.status,0,`${name}: mutation must fail`);const first=/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/.exec(output)?.[1];assert.equal(first,wanted,`${name}: intended assertion must fail first, got ${output.slice(-2000)}`);console.log(`OK walls-negative/${name}: ${first}`);}}finally{rmSync(temp,{recursive:true,force:true});}
console.log(`walls-negative: ${mutants.length} isolated semantic mutants rejected`);
