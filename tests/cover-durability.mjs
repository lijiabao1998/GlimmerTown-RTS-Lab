import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, UK_TANK, UK_HOWITZER, UK_LIGHT, UK_HEAVY, UK_ATGUN, UK_MORTAR, UK_INFANTRY, UK_OBSERVER, ORD_FIRE_AT } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
const url = new URL('../src/ui/coverDurability.ts', import.meta.url), source = fs.readFileSync(url, 'utf8');
const mutations = {
  eligibility: ['eligibility', 'if (!k.armored &&', 'if (false &&'],
  selected: ['selected', '!selected.has(u.id) || ', ''],
  alive: ['alive', '!u.alive || ', ''],
  side: ['side', 'u.side !== SIDE_PLAYER', 'false'],
  order: ['order', 'u.order !== ORD_FIRE_AT || ', ''],
  target: ['target', '(u.target !== 0 && !(u.fireAmmo === SHELL_SMOKE && u.target > 0)) || ', ''],
  integer: ['integer', '!Number.isInteger(u.tx) || !Number.isInteger(u.tz)', 'false'],
  coordinates: ['coordinates', 'bldAt(w, u.tx, u.tz)', 'w.blds[0]'],
  empty: ['empty', 'if (!targets.size)', 'if (false)'],
  dedup: ['dedup', 'targets.set(b.id, b)', 'targets.set(u.id, b)'],
  stored: ['stored', '${b.hp}/${b.maxHp}', '${b.hp}/${999}'],
  material: ['material', 'BLD_MATERIAL_NAMES[bldMaterial(b.kind)]', "'木造'"],
  stage: ['stage', "['完整', '重損', '瓦礫'][stageOf(b)]", "'完整'"],
  identity: ['identity', '#${b.id}(${b.x},${b.z})', '#0(0,0)'],
  ratio: ['ratio', 'a.hp * b.maxHp - b.hp * a.maxHp', 'a.hp - b.hp'],
  ties: ['ties', 'a.id - b.id', 'b.id - a.id'],
  cap: ['cap', 'ordered.slice(0, 2)', 'ordered'],
  overflow: ['overflow', 'targets.size - 2', 'targets.size'],
  freshness: ['freshness', "if (!enabled) return '';", "if (!enabled) return ''; if (w.tick === 0) return '';"],
  valve: ['valve', "if (!enabled) return '';", ''],
  readonly: ['readonly', 'const targets =', 'w.rng ^= 1; const targets ='],
  smoke: ['smoke', '(u.target !== 0 && !(u.fireAmmo === SHELL_SMOKE && u.target > 0))', 'u.target !== 0'],
  selection: ['selection', 'const targets =', 'selected.clear(); const targets ='],
};
const expectedFailures = ["eligible weapons only", "unselected orders remain private", "dead units contribute no target", "enemy orders remain private", "only bombardment orders contribute", "unit targets contribute no building", "noninteger cells never alias an occupied cell", "outside and empty cells have no building", "empty selection has no summary", "duplicate building shown once", "stored legacy maxHp is authoritative", "material matches building kind", "stage follows exact damage boundaries", "identity and grid retained", "lowest fraction wins rather than absolute hp", "equal fractions use stable id order", "only two identities occupy HUD", "overflow explicitly counts omitted targets", "current world is read at same tick", "valve immediately clears", "complete world remains unchanged", "actual issued smoke mission exposes its building", "selection remains unchanged"];
const mutant = process.argv.find(a=>a.startsWith('--mutant='))?.slice(9), filter=process.env.R124_GROUP;
let code=source;
if(mutant){const [,from,to]=mutations[mutant];assert.equal(code.split(from).length-1,1,'unique mutation anchor');code=code.replace(from,to);}
const js=stripTypeScriptTypes(code).replace(/from '([^']+)'/g,(_,s)=>`from '${new URL(s,url).href}'`);
const {coverDurability}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function fixture(){const w=createWorld(1944);w.blds=[];w.occ.fill(0);w.units=[];return {w,s:new Set()};}
function bld(f,id=1,{x=id*2,z=2,kind=0,hp=100,maxHp=100}={}){const b={id,x,z,kind,hp,maxHp,w:1,d:1,floors:1};f.w.blds[id-1]=b;f.w.occ[z*32+x]=id;return b;}
function unit(f,b,{kind=UK_TANK,side=0,alive=true,select=true,order=ORD_FIRE_AT,target=0}={}){const u={id:f.w.units.length+1,kind,side,alive,order,target,tx:b.x,tz:b.z,hp:100,cooldown:0,x:0,z:0,path:[],pathIdx:0,aimX:1,aimZ:0};f.w.units.push(u);if(select)f.s.add(u.id);return u;}
const read=f=>coverDurability(f.w,f.s);
const item=(b,material='磚造',stage='完整')=>`#${b.id}(${b.x},${b.z}) ${material} ${b.hp}/${b.maxHp} ${stage}`;
const single=(b,material,stage)=>`掩體目標 1：${item(b,material,stage)}`;
const checks={
 eligibility(){for(const kind of [UK_TANK,UK_HOWITZER,UK_LIGHT,UK_HEAVY,UK_ATGUN,UK_MORTAR,UK_INFANTRY,UK_OBSERVER]){const f=fixture(),b=bld(f);unit(f,b,{kind});assert.equal(read(f),[UK_INFANTRY,UK_OBSERVER].includes(kind)?'':single(b),'eligible weapons only');}},
 selected(){const f=fixture(),b=bld(f);unit(f,b,{select:false});assert.equal(read(f),'','unselected orders remain private');},
 alive(){const f=fixture(),b=bld(f);unit(f,b,{alive:false});assert.equal(read(f),'','dead units contribute no target');},
 side(){const f=fixture(),b=bld(f);unit(f,b,{side:1});assert.equal(read(f),'','enemy orders remain private');},
 order(){for(const order of [0,1,2]){const f=fixture(),b=bld(f);unit(f,b,{order});assert.equal(read(f),'','only bombardment orders contribute');}},
 target(){for(const target of [-1,1]){const f=fixture(),b=bld(f);unit(f,b,{target});assert.equal(read(f),'','unit targets contribute no building');}},
 integer(){for(const [x,z] of [[2.5,2],[2,2.5],[NaN,2],[2,Infinity]]){const f=fixture(),b=bld(f),u=unit(f,b);u.tx=x;u.tz=z;f.w.occ[x+z*32]=1;assert.equal(read(f),'','noninteger cells never alias an occupied cell');}},
 coordinates(){for(const [x,z] of [[-1,2],[32,2],[2,-1],[2,32],[31,31]]){const f=fixture(),b=bld(f),u=unit(f,b);u.tx=x;u.tz=z;assert.equal(read(f),'','outside and empty cells have no building');}const f=fixture(),b=bld(f),u=unit(f,b);f.w.occ.fill(0);f.w.wires={version:1,segments:[b]};assert.equal(read(f),'','independent wires are not cover buildings');},
 empty(){const f=fixture();assert.equal(read(f),'','empty selection has no summary');},
 dedup(){const f=fixture(),b=bld(f);unit(f,b);unit(f,b,{kind:UK_HOWITZER});assert.equal(read(f),single(b),'duplicate building shown once');},
 stored(){const f=fixture(),b=bld(f,1,{hp:73,maxHp:101});unit(f,b);assert.equal(read(f),single(b),'stored legacy maxHp is authoritative');},
 material(){for(const [kind,name] of [[0,'磚造'],[2,'木造'],[3,'石造'],[6,'混凝土'],[7,'磚造'],[8,'石造'],[9,'混凝土']]){const f=fixture(),b=bld(f,1,{kind});unit(f,b);assert.equal(read(f),single(b,name),'material matches building kind');}},
 stage(){for(const [hp,stage] of [[100,'完整'],[71,'完整'],[70,'重損'],[1,'重損'],[0,'瓦礫']]){const f=fixture(),b=bld(f,1,{hp});unit(f,b);assert.equal(read(f),single(b,'磚造',stage),'stage follows exact damage boundaries');}},
 identity(){const f=fixture(),b=bld(f,1,{x:7,z:9});unit(f,b);assert.equal(read(f),single(b),'identity and grid retained');},
 ratio(){const f=fixture(),a=bld(f,1,{hp:20,maxHp:100}),b=bld(f,2,{hp:30,maxHp:300});unit(f,a);unit(f,b);assert.equal(read(f),`掩體目標 2：${item(b,'磚造','重損')}；${item(a,'磚造','重損')}`,'lowest fraction wins rather than absolute hp');},
 ties(){const f=fixture(),a=bld(f),b=bld(f,2);unit(f,b);unit(f,a);assert.equal(read(f),`掩體目標 2：${item(a)}；${item(b)}`,'equal fractions use stable id order');},
 cap(){const f=fixture();for(let i=1;i<=4;i++)unit(f,bld(f,i));assert.equal((read(f).match(/#/g)||[]).length,2,'only two identities occupy HUD');},
 overflow(){const f=fixture();for(let i=1;i<=4;i++)unit(f,bld(f,i));assert.ok(read(f).endsWith('；另 2 棟未列（低耐久優先）'),'overflow explicitly counts omitted targets');},
 freshness(){const f=fixture(),b=bld(f),u=unit(f,b);assert.equal(read(f),single(b),'current world is read at same tick');b.hp=0;assert.equal(read(f),single(b,'磚造','瓦礫'),'same tick damage is fresh');u.order=1;assert.equal(read(f),'','same tick movement clears');u.order=ORD_FIRE_AT;u.alive=false;assert.equal(read(f),'','same tick death clears');u.alive=true;u.side=1;assert.equal(read(f),'','same tick side change clears');u.side=0;f.s.clear();assert.equal(read(f),'','same tick clear clears');f.s.add(u.id);const fresh=fixture(),newB=bld(fresh,1,{hp:50});unit(fresh,newB);assert.equal(coverDurability(fresh.w,f.s),single(newB,'磚造','重損'),'new world and reused ids replace old state');for(let i=0;i<100;i++)assert.equal(read(f),single(b,'磚造','瓦礫'),'paused calls never advance damage');u.fireAmmo=3;assert.equal(read(f),single(b,'磚造','瓦礫'),'smoke order can inspect public building state');},
 valve(){const f=fixture(),b=bld(f);unit(f,b);assert.equal(coverDurability(f.w,f.s,false),'','valve immediately clears');assert.equal(read(f),single(b),'valve can restore current state');},
 readonly(){const f=fixture(),b=bld(f);unit(f,b);const old=structuredClone(f.w),hash=hashWorld(f.w);read(f);assert.deepEqual(f.w,old,'complete world remains unchanged');assert.equal(hashWorld(f.w),hash,'hash unchanged');Object.freeze(b);for(const u of f.w.units){Object.freeze(u.path);Object.freeze(u);}Object.freeze(f.w.units);Object.freeze(f.w.blds);Object.freeze(f.w);assert.equal(read(f),single(b),'frozen state is readable');},
 smoke(){const f=fixture(),b=bld(f,1,{x:15,z:15}),u=unit(f,b,{kind:UK_HOWITZER});step(f.w,[{t:'fireAt',side:0,ids:[u.id],x:b.x,z:b.z,ammo:'smoke'}]);assert.equal(u.order,ORD_FIRE_AT,'fixture actual smoke command accepted');assert(u.target>0,'fixture actual smoke rounds are positive');assert.equal(read(f),single(b),'actual issued smoke mission exposes its building');},
 selection(){const f=fixture(),b=bld(f);unit(f,b);const before=[...f.s];read(f);assert.deepEqual([...f.s],before,'selection remains unchanged');const ro={has:id=>f.s.has(id)};assert.equal(coverDurability(f.w,ro),single(b),'does not require selection mutation methods');},
};
let count=0;
for(const [name,fn] of Object.entries(checks)){if(filter&&name!==filter)continue;try{fn();count++;console.log(`OK cover-durability: ${name}`);}catch(e){console.error(`FIRST_COVER_FAILURE=${JSON.stringify({group:name,name:e.name,message:e.message.split('\n')[0]})}`);throw e;}}
assert(count>0,'at least one guard ran');
if(process.argv.includes('--mutations')){assert.equal(Object.keys(mutations).length,Object.keys(checks).length);for(const [name,[group]] of Object.entries(mutations)){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--mutant=${name}`],{encoding:'utf8',timeout:20000,env:{...process.env,R124_GROUP:group}});assert.equal(child.error,undefined);assert.notEqual(child.status,0,`${name} must fail`);const first=(child.stdout+'\n'+child.stderr).match(/^FIRST_COVER_FAILURE=(.*)$/m);assert(first,`${name} must reach semantic guard`);const failure=JSON.parse(first[1]);assert.equal(failure.group,group);assert.equal(failure.name,'AssertionError',`${name} must fail assertion rather than runtime`);assert.equal(failure.message,expectedFailures[Object.keys(mutations).indexOf(name)],`${name}: exact first assertion`);console.log(`OK cover-durability negative: ${name} -> ${failure.message}`);}}
console.log(`cover-durability: ${count} groups OK`);
