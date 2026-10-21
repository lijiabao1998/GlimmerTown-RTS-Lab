// R127 independent durability expectations and isolated exact-first-red mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, BK_HQ } from '../src/sim/world.ts';
import { startEco } from '../src/sim/eco.ts';
import { step, runLog } from '../src/sim/step.ts';
const url=new URL('../src/ui/hqDurability.ts',import.meta.url),source=fs.readFileSync(url,'utf8');
const signature='export function hqDurability(w: World, enabled = true): string {';
const mutations={},cases={};
function test(name,message,from,to,run){mutations[name]={message,from,to};cases[name]=run;}
const missing='我方指揮部：未設置',label=(hp,max,state)=>`我方指揮部：${hp}/${max} · ${state}`;
let base;
function fixture(){if(!base){base=createWorld(1944);base.units=[];startEco(base);assert(base.eco.hq.every(Boolean),'both HQ fixtures exist');}return structuredClone(base);}
const own=w=>w.blds[w.eco.hq[0]-1];
const equal=(a,b,m)=>assert.equal(a,b,m);
test('no_eco','non-economic state clears summary',signature,signature+"\n if (!w.eco) return 'stale';",(read,m)=>equal(read(createWorld(1944)),'',m));
test('winner','every terminal result clears summary',' || w.winner >= 0','',(read,m)=>{for(const winner of [0,1,2]){const w=fixture();w.winner=winner;equal(read(w),'',m);}});
test('missing','missing own HQ is explicit',"return '我方指揮部：未設置'","return ''",(read,m)=>{for(const id of [0,-1,99999]){const w=fixture();w.eco.hq[0]=id;equal(read(w),missing,m);}});
test('id','mismatched building identity stays private','b.id !== id || ','',(read,m)=>{const w=fixture();own(w).id++;equal(read(w),missing,m);});
test('kind','non-HQ pointer is not a headquarters','b.kind !== BK_HQ || ','',(read,m)=>{const w=fixture();own(w).kind=0;equal(read(w),missing,m);});
test('owner','enemy HQ pointer never reveals enemy durability',' || b.builtBy !== SIDE_PLAYER','',(read,m)=>{const w=fixture();w.eco.hq[0]=w.eco.hq[1];equal(read(w),missing,m);});
test('enemy','enemy damage cannot change own status','w.eco.hq[SIDE_PLAYER]','w.eco.hq[1]',(read,m)=>{const w=fixture();w.blds[w.eco.hq[1]-1].hp=1;equal(read(w),label(1200,1200,'完好'),m);});
test('full','full stored durability is intact',"'完好'","'受損'",(read,m)=>equal(read(fixture()),label(1200,1200,'完好'),m));
test('damage','one damage is not full health',"'受損'","'完好'",(read,m)=>{const w=fixture();own(w).hp=1199;equal(read(w),label(1199,1200,'受損'),m);});
test('threshold','existing seventy-percent boundary is heavily damaged','stageOf(b) === 1','b.hp * 10 < b.maxHp * 7',(read,m)=>{const w=fixture();for(const [hp,status]of [[841,'受損'],[840,'重損'],[839,'重損'],[1,'重損']]){own(w).hp=hp;equal(read(w),label(hp,1200,status),m);}});
test('dead','zero durability is destroyed before terminal step',"b.hp <= 0 ? '已毀'","b.hp < 0 ? '已毀'",(read,m)=>{const w=fixture();own(w).hp=0;equal(read(w),label(0,1200,'已毀'),m);});
test('stored','saved nonstandard maxHp is not recomputed','${b.maxHp}','${1200}',(read,m)=>{const w=fixture();own(w).maxHp=100;own(w).hp=71;equal(read(w),label(71,100,'受損'),m);own(w).hp=70;equal(read(w),label(70,100,'重損'),m);});
test('hp','exact current hp is not rounded','${b.hp}','${Math.round(b.hp/10)*10}',(read,m)=>{const w=fixture();own(w).hp=839;equal(read(w),label(839,1200,'重損'),m);});
test('same_tick','same-tick changes replace previous durability',signature,signature+"\n if(w.eco && w.blds[w.eco.hq[0]-1]?.hp===999)return 'stale';",(read,m)=>{const w=fixture();read(w);own(w).hp=999;equal(read(w),label(999,1200,'受損'),m);});
test('replacement','replacement own HQ reads registered identity',signature,signature+"\n if(w.eco && w.blds[w.eco.hq[0]-1]?.maxHp===300)return 'stale';",(read,m)=>{const w=fixture();read(w);const b={...own(w),id:w.blds.length+1,hp:200,maxHp:300,kind:BK_HQ,builtBy:0};w.blds.push(b);w.eco.hq[0]=b.id;equal(read(w),label(200,300,'重損'),m);});
test('clone','restored world uses restored durability',signature,signature+"\n if(w.eco && w.blds[w.eco.hq[0]-1]?.hp===567)return 'stale';",(read,m)=>{const w=fixture();read(w);const clone=structuredClone(w);own(clone).hp=567;equal(read(clone),label(567,1200,'重損'),m);equal(read(w),label(1200,1200,'完好'),'original remains separate');});
test('valve','disabled feature clears all text','!enabled || ','',(read,m)=>{const w=fixture();read(w);equal(read(w,false),'',m);});
test('readonly','presentation preserves all world fields',signature,signature+'\n if(w.eco)w.eco.supply[0]++;',(read,m)=>{const w=fixture(),before=structuredClone(w);read(w);read(w,false);assert.deepEqual(w,before,m);Object.freeze(own(w));Object.freeze(w.eco);Object.freeze(w);equal(read(w),label(1200,1200,'完好'),'frozen input readable');});
test('paused','repeated paused reads preserve durability',signature,signature+'\n if(w.eco)w.blds[w.eco.hq[0]-1].hp--;',(read,m)=>{const w=fixture();for(let i=0;i<50;i++)equal(read(w),label(1200,1200,'完好'),m);});
test('clock','wall clock does not affect text',signature,signature+"\n if(Date.now()>0)return 'clock';",(read,m)=>{const w=fixture(),now=Date.now;try{for(const ms of [1,999999]){Date.now=()=>ms;equal(read(w),label(1200,1200,'完好'),m);}}finally{Date.now=now;}});
test('replay','valve preserves simulation replay hash',signature,signature+'\n if(enabled)w.rng++;',(read,m)=>{const log=[{tick:0,cmd:{t:'eco'}}],a=runLog(createWorld(1944),log,1),b=structuredClone(a);for(let t=0;t<30;t++){step(a,[]);step(b,[]);read(a);read(b,false);}equal(hashWorld(a),hashWorld(b),m);const replay=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),a.tick);equal(hashWorld(a),hashWorld(replay),'JSON replay unchanged');equal(read(a),read(replay),'replay status reconstructed');});
test('terminal_step','actual destroyed HQ defeat clears summary',' || w.winner >= 0','',(read,m)=>{const w=fixture();own(w).hp=0;step(w,[]);equal(w.winner,1,'destroyed own HQ really causes defeat');equal(read(w),'',m);});
const name=process.argv.find(a=>a.startsWith('--mutant='))?.slice(9),group=process.env.R127_GROUP;
let code=source;if(name){const {from,to}=mutations[name];equal(code.split(from).length-1,1,'unique mutation anchor');code=code.replace(from,to);}
const js=stripTypeScriptTypes(code).replace(/from '([^']+)'/g,(_,s)=>`from '${new URL(s,url).href}'`);
const {hqDurability:read}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
let count=0;for(const[k,run]of Object.entries(cases)){if(group&&group!==k)continue;try{run(read,mutations[k].message);count++;}catch(e){console.error('FIRST_HQ_FAILURE='+JSON.stringify({group:k,name:e.name,message:e.message.split('\n')[0]}));throw e;}}
if(!name){for(const[k,m]of Object.entries(mutations)){const c=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--mutant='+k],{encoding:'utf8',timeout:15000,env:{...process.env,R127_GROUP:k}});equal(c.error,undefined,'mutant completes');assert.notEqual(c.status,0,'mutant fails');const first=(c.stdout+'\n'+c.stderr).match(/^FIRST_HQ_FAILURE=(.*)$/m);assert(first,'semantic assertion reached '+k);assert.deepEqual(JSON.parse(first[1]),{group:k,name:'AssertionError',message:m.message},'exact first red '+k);console.log('RED HQ '+k+': '+m.message);}}
console.log(`hq-durability: ${count} groups passed${name?'':`; ${Object.keys(mutations).length} isolated negatives passed`}`);
