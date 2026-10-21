// R126: independently specified purchase explanations, real purchases, exact-first-red negatives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_MORTAR, UK_LIGHT, UK_HEAVY, idx, inMap } from '../src/sim/world.ts';
import { startEco, produce, ecoStep, hqAlive, ECO_QUEUE, ECO_POP } from '../src/sim/eco.ts';
import { step, runLog } from '../src/sim/step.ts';
import { productionCountdown } from '../src/ui/productionCountdown.ts';
const url=new URL('../src/ui/productionBlockReason.ts',import.meta.url), source=fs.readFileSync(url,'utf8');
const signature='export function productionBlockReason(w: World, kind: number, enabled = true): string {';
const missingText=n=>`補給不足，還差 ${n}`;
const HQ='指揮部已毀或不存在', FULL='生產佇列已滿', LOCKED='本局未開放此單位';
const kinds=[UK_TANK,UK_HOWITZER,UK_OBSERVER,UK_INFANTRY,UK_ATGUN,UK_MORTAR,UK_LIGHT,UK_HEAVY];
const mutations={};
function mutant(name,group,from,to,message){mutations[name]={group,edits:[[from,to]],message};}
function inject(name,group,code,message){mutant(name,group,signature,`${signature}\n  ${code}`,message);}
mutant('no_eco','no_eco',signature,`${signature}\n  if (!w.eco) return 'stale';`,'non-economic world clears reasons');
mutant('winner','winner',' || w.winner >= 0','','terminal results clear reasons');
mutant('hq_dead','hq_dead','!hqAlive(w, SIDE_PLAYER)','false','destroyed HQ reports its purchase rejection');
mutant('hq_missing','hq_missing','!hqAlive(w, SIDE_PLAYER)','false','missing HQ reports its purchase rejection');
mutant('invalid','invalid','!PRODUCIBLE.includes(kind)','false','unsupported kinds are rejected without indexing unit data');
for(const [gate,list] of [['inf',[UK_INFANTRY]],['guns',[UK_ATGUN,UK_MORTAR]],['tanks',[UK_LIGHT,UK_HEAVY]]]) for(const kind of list) mutant(`gate_${kind}`,`gate_${kind}`,`!e.${gate}`,'false',`disabled gate rejects kind ${kind}`);
mutant('full','full','length >= ECO_QUEUE','length > ECO_QUEUE','exact queue capacity reports full');
mutant('overfull','overfull','length >= ECO_QUEUE','length === ECO_QUEUE','legacy overfull queue still reports full');
mutant('last_slot','last_slot','length >= ECO_QUEUE','length >= ECO_QUEUE - 1','last queue slot remains purchasable');
mutant('shortfall','shortfall','cost - e.supply[SIDE_PLAYER]','cost - e.supply[SIDE_PLAYER] + 1','every unit shows exact shortage at supply boundaries');
mutant('same_kind','same_kind','UNIT_KINDS[kind].cost','UNIT_KINDS[0].cost','same-tick kind changes use the selected unit cost');
mutant('affordable','affordable','missing > 0','missing >= 0','exact cost is not a shortage');
mutant('enemy_supply','enemy','e.supply[SIDE_PLAYER]','e.supply[SIDE_ENEMY]','enemy economics do not change friendly reason');
mutant('enemy_queue','enemy','e.queue[SIDE_PLAYER]','e.queue[SIDE_ENEMY]','enemy economics do not change friendly reason');
mutant('enemy_hq','enemy_hq','hqAlive(w, SIDE_PLAYER)','hqAlive(w, SIDE_ENEMY)','enemy HQ state does not change friendly reason');
const cache=[[signature,`let cachedTick=-1, cached='';\n${signature}\n  if(w.tick===cachedTick)return cached;\n  cachedTick=w.tick;`],['return missing > 0 ?', 'return cached = missing > 0 ?']];
for(const [group,message] of [['same_supply','same-tick supply updates replace shortage'],['same_queue','same-tick queue changes replace shortage'],['same_hq','same-tick HQ changes replace shortage'],['restart','replacement world does not reuse previous shortage'],['restored','restored world reads its own supply']])mutations[`cache_${group}`]={group,edits:cache,message};
mutant('valve','valve','!enabled || ','','disabled feature immediately clears reason');
inject('readonly','readonly','w.rng += 1;','reason reads preserve all world state');
inject('paused','paused','if(w.eco)w.eco.supply[0]++;','paused repeated reads preserve exact shortage');
inject('wall_clock','wall_clock',"if(Date.now()>0)return 'clock';",'wall clock cannot change purchase reason');
inject('population','population',"if(w.units.filter(u=>u.alive&&u.side===0).length>=ECO_POP)return '人口已滿';",'population cap does not prevent buying');
inject('exit','exit',"if(w.eco && w.eco.prog[0]>=UNIT_KINDS[0].buildTicks)return '出口堵塞';",'blocked exits do not prevent buying');
inject('actual','actual',"if(w.eco && w.eco.supply[0]===0)return '';",'actual rejected purchase has the exact missing amount');
inject('replay','replay','if(enabled)w.rng += 1;','rendering and valve preserve replay hash');
const mutationName=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9), selected=process.env.R126_REASON_GROUP;
let code=source;
if(mutationName){const m=mutations[mutationName];assert.ok(m,'known mutation');for(const [from,to]of m.edits){assert.equal(code.split(from).length-1,1,`${mutationName}: unique anchor`);code=code.replace(from,to);}code=code.replace('import { ECO_QUEUE,','import { ECO_POP, ECO_QUEUE,');code=code.replace('import { SIDE_PLAYER,','import { SIDE_ENEMY, SIDE_PLAYER,');}
const js=stripTypeScriptTypes(code).replace(/from '([^']+)'/g,(_,s)=>`from '${new URL(s,url).href}'`);
const {productionBlockReason:read}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let base;
function fixture(){if(!base){base=createWorld(1944);base.units=[];startEco(base,1,1,1);base.units=[];assert.ok(hqAlive(base,0)&&hqAlive(base,1),'fixture has live headquarters');base.eco.supply[0]=1000;}return structuredClone(base);}
function poor(){const w=fixture();w.eco.supply[0]=0;return w;}
function purchase(w,kind,accepted){const supply=w.eco.supply[0],queue=[...w.eco.queue[0]];produce(w,0,kind);assert.deepEqual(w.eco.queue[0],accepted?[...queue,kind]:queue,'actual produce queue acceptance matches fixture');assert.equal(w.eco.supply[0],accepted?supply-UNIT_KINDS[kind].cost:supply,'actual produce charges exactly once or not at all');}
let groups=0;
function group(name,fn){if(selected&&selected!==name)return;try{fn();groups++;console.log(`OK production-block-reason: ${name}`);}catch(e){console.error(`FIRST_REASON_FAILURE=${JSON.stringify({group:name,name:e.name,message:e.message.split('\n')[0]})}`);throw e;}}
group('no_eco',()=>{read(poor(),UK_TANK);assert.equal(read(createWorld(1944),UK_TANK),'','non-economic world clears reasons');});
group('winner',()=>{for(const winner of [0,1,2]){const w=poor();read(w,UK_TANK);w.winner=winner;assert.equal(read(w,UK_TANK),'','terminal results clear reasons');}});
group('hq_dead',()=>{const w=fixture();w.blds[w.eco.hq[0]-1].hp=0;assert.equal(read(w,UK_TANK),HQ,'destroyed HQ reports its purchase rejection');purchase(w,UK_TANK,false);});
group('hq_missing',()=>{for(const id of [0,99999]){const w=fixture();w.eco.hq[0]=id;assert.equal(read(w,UK_TANK),HQ,'missing HQ reports its purchase rejection');purchase(w,UK_TANK,false);}});
group('invalid',()=>{for(const kind of [-1,99999]){const w=fixture();let reason;try{reason=read(w,kind);}catch{assert.fail('unsupported kinds are rejected without indexing unit data');}assert.equal(reason,LOCKED,'unsupported kinds are rejected without indexing unit data');purchase(w,kind,false);}});
for(const [gate,list]of [['inf',[UK_INFANTRY]],['guns',[UK_ATGUN,UK_MORTAR]],['tanks',[UK_LIGHT,UK_HEAVY]]])for(const kind of list)group(`gate_${kind}`,()=>{for(const value of [undefined,0]){const w=fixture();w.eco[gate]=value;assert.equal(read(w,kind),LOCKED,`disabled gate rejects kind ${kind}`);purchase(w,kind,false);w.eco[gate]=1;assert.equal(read(w,kind),'','enabled gate allows affordable purchase');purchase(w,kind,true);}});
group('full',()=>{const w=fixture();w.eco.queue[0]=Array(ECO_QUEUE).fill(UK_TANK);assert.equal(read(w,UK_TANK),FULL,'exact queue capacity reports full');purchase(w,UK_TANK,false);});
group('overfull',()=>{const w=fixture();w.eco.queue[0]=Array(ECO_QUEUE+1).fill(UK_TANK);assert.equal(read(w,UK_TANK),FULL,'legacy overfull queue still reports full');purchase(w,UK_TANK,false);});
group('last_slot',()=>{const w=fixture();w.eco.queue[0]=Array(ECO_QUEUE-1).fill(UK_TANK);assert.equal(read(w,UK_TANK),'','last queue slot remains purchasable');purchase(w,UK_TANK,true);assert.equal(read(w,UK_TANK),FULL,'purchase immediately fills final queue slot');});
group('shortfall',()=>{for(const kind of kinds)for(const supply of [0,1,UNIT_KINDS[kind].cost-1]){const w=fixture();w.eco.supply[0]=supply;assert.equal(read(w,kind),missingText(UNIT_KINDS[kind].cost-supply),'every unit shows exact shortage at supply boundaries');purchase(w,kind,false);}});
group('affordable',()=>{for(const kind of kinds)for(const extra of [0,1,100]){const w=fixture();w.eco.supply[0]=UNIT_KINDS[kind].cost+extra;assert.equal(read(w,kind),'','exact cost is not a shortage');purchase(w,kind,true);}});
group('enemy',()=>{const w=poor();w.eco.supply[1]=10000;w.eco.queue[1]=Array(ECO_QUEUE).fill(UK_HEAVY);assert.equal(read(w,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost),'enemy economics do not change friendly reason');w.eco.supply[0]=10000;w.eco.supply[1]=0;assert.equal(read(w,UK_TANK),'','enemy shortage does not block player');});
group('enemy_hq',()=>{const w=poor();w.blds[w.eco.hq[1]-1].hp=0;assert.equal(read(w,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost),'enemy HQ state does not change friendly reason');});
group('same_kind',()=>{const w=poor();read(w,UK_TANK);assert.equal(read(w,UK_OBSERVER),missingText(UNIT_KINDS[UK_OBSERVER].cost),'same-tick kind changes use the selected unit cost');});
group('same_supply',()=>{const w=poor();read(w,UK_TANK);w.eco.supply[0]=UNIT_KINDS[UK_TANK].cost;assert.equal(read(w,UK_TANK),'','same-tick supply updates replace shortage');});
group('same_queue',()=>{const w=poor();read(w,UK_TANK);w.eco.queue[0]=Array(ECO_QUEUE).fill(UK_TANK);assert.equal(read(w,UK_TANK),FULL,'same-tick queue changes replace shortage');});
group('same_hq',()=>{const w=poor();read(w,UK_TANK);w.blds[w.eco.hq[0]-1].hp=0;assert.equal(read(w,UK_TANK),HQ,'same-tick HQ changes replace shortage');});
group('restart',()=>{read(poor(),UK_TANK);assert.equal(read(fixture(),UK_TANK),'','replacement world does not reuse previous shortage');});
group('restored',()=>{const w=poor();read(w,UK_TANK);const clone=structuredClone(w);clone.eco.supply[0]=1;assert.equal(read(clone,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost-1),'restored world reads its own supply');});
group('valve',()=>{const w=poor();read(w,UK_TANK);assert.equal(read(w,UK_TANK,false),'','disabled feature immediately clears reason');assert.equal(read(w,UK_TANK,true),missingText(UNIT_KINDS[UK_TANK].cost),'reenabling reads current reason');});
group('readonly',()=>{const w=poor(),before=structuredClone(w);read(w,UK_TANK);read(w,UK_TANK,false);assert.deepEqual(w,before,'reason reads preserve all world state');Object.freeze(w.eco.supply);Object.freeze(w.eco.queue[0]);Object.freeze(w.eco.queue);Object.freeze(w.eco);Object.freeze(w);assert.equal(read(w,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost),'frozen world remains readable');});
group('paused',()=>{const w=poor();for(let i=0;i<100;i++)assert.equal(read(w,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost),'paused repeated reads preserve exact shortage');});
group('wall_clock',()=>{const w=poor(),now=Date.now;try{for(const ms of [1000,999999999]){Date.now=()=>ms;assert.equal(read(w,UK_TANK),missingText(UNIT_KINDS[UK_TANK].cost),'wall clock cannot change purchase reason');}}finally{Date.now=now;}});
group('population',()=>{const w=fixture(),sample=createWorld(1944).units.find(u=>u.kind===UK_OBSERVER);w.units=Array.from({length:ECO_POP},(_,i)=>({...structuredClone(sample),id:i+1,side:0,alive:true}));w.eco.queue[0]=[UK_TANK];w.eco.prog[0]=UNIT_KINDS[UK_TANK].buildTicks;ecoStep(w);assert.equal(read(w,UK_TANK),'','population cap does not prevent buying');assert.match(productionCountdown(w),/等待部署/,'existing deployment wait remains visible');purchase(w,UK_TANK,true);assert.equal(w.eco.queue[0].length,2,'capped army can buy behind waiting head');});
group('exit',()=>{const w=fixture(),hq=hqAlive(w,0);for(let z=hq.z-1;z<=hq.z+hq.d;z++)for(let x=hq.x-1;x<=hq.x+hq.w;x++)if(inMap(x,z))w.occ[idx(x,z)]=hq.id;w.eco.queue[0]=[UK_TANK];w.eco.prog[0]=UNIT_KINDS[UK_TANK].buildTicks;ecoStep(w);assert.equal(read(w,UK_TANK),'','blocked exits do not prevent buying');assert.match(productionCountdown(w),/等待部署/,'blocked exit retains existing deployment wait');assert.equal(w.units.length,0,'finished unit really cannot deploy');purchase(w,UK_TANK,true);});
group('actual',()=>{const w=poor();assert.equal(read(w,UK_OBSERVER),missingText(UNIT_KINDS[UK_OBSERVER].cost),'actual rejected purchase has the exact missing amount');purchase(w,UK_OBSERVER,false);w.eco.supply[0]=UNIT_KINDS[UK_OBSERVER].cost;assert.equal(read(w,UK_OBSERVER),'','funded real command is enabled');step(w,[{t:'produce',side:0,kind:UK_OBSERVER}]);assert.deepEqual(w.eco.queue[0],[UK_OBSERVER],'existing command path buys one unit');assert.equal(w.eco.prog[0],1,'existing manufacturing begins normally');});
group('replay',()=>{const log=[{tick:0,cmd:{t:'eco'}},{tick:1,cmd:{t:'produce',side:0,kind:UK_OBSERVER}},{tick:2,cmd:{t:'produce',side:0,kind:UK_TANK}}];const a=createWorld(1944),b=createWorld(1944);for(let t=0;t<40;t++){const commands=log.filter(e=>e.tick===t).map(e=>e.cmd);step(a,commands);step(b,commands);read(a,UK_TANK);read(b,UK_TANK,false);}assert.equal(hashWorld(a),hashWorld(b),'rendering and valve preserve replay hash');const replay=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),a.tick);assert.equal(hashWorld(a),hashWorld(replay),'JSON replay preserves exact simulation');assert.equal(read(a,UK_TANK),read(replay,UK_TANK),'replay reconstructs current reason');const clone=structuredClone(a);for(let i=0;i<20;i++){step(a,[]);step(clone,[]);read(a,UK_TANK);}assert.equal(hashWorld(a),hashWorld(clone),'midgame clone continuation is presentation independent');});
if(process.argv.includes('--mutations')){assert.equal(new Set(Object.values(mutations).map(m=>m.group)).size,groups,'every semantic group has an isolated negative');for(const [name,m]of Object.entries(mutations)){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),`--mutant=${name}`],{encoding:'utf8',timeout:15000,env:{...process.env,R126_REASON_GROUP:m.group}}),output=`${child.stdout}\n${child.stderr}`;assert.equal(child.error,undefined,`${name}: child finishes`);assert.notEqual(child.status,0,`${name}: mutant fails`);const first=output.match(/^FIRST_REASON_FAILURE=(.*)$/m);assert.ok(first,`${name}: reaches semantic assertion, not syntax/import failure\n${output}`);assert.deepEqual(JSON.parse(first[1]),{group:m.group,name:'AssertionError',message:m.message},`${name}: exact first semantic failure\n${output}`);assert.equal((output.match(/^FIRST_REASON_FAILURE=/gm)||[]).length,1,`${name}: single intended group failure`);console.log(`OK production-block-reason negative: ${name} -> ${m.message}`);}console.log(`production-block-reason: ${Object.keys(mutations).length} isolated negatives OK`);}
assert.ok(groups>0,'at least one guard executes');console.log(`production-block-reason: ${groups} groups OK`);
