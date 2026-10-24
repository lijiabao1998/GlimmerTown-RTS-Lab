// R121 independent fixtures: no AI source changes, no building/occupancy masquerading.
import assert from 'node:assert/strict';
import {createWorld,hashWorld,N,SUB,idx,center,cellOf,wireAt,wireBlocks,blocks,BK_WIRE,BK_COTTAGE,UNIT_KINDS,UK_TANK,UK_HOWITZER,UK_OBSERVER,UK_INFANTRY,UK_MORTAR,UK_ZOMBIE,ORD_IDLE,SHELL_HE,bldMaxHp} from '../src/sim/world.ts';
import {applyBuild,buildError,pointsUsed,buildKind} from '../src/sim/build.ts';
import {applyTrench} from '../src/sim/trenches.ts';
import {applyMap} from '../src/sim/maps.ts';
import {step,runLog,firstBlock,spotted} from '../src/sim/step.ts';
import {findPath} from '../src/sim/path.ts';
import {startEco,produce} from '../src/sim/eco.ts';
const only=process.argv[2];const group=(n,f)=>{if(!only||only===n){f();console.log('OK wire/'+n)}};
const blank=()=>{const w=createWorld(1944);w.ter.fill(0);w.occ.fill(0);w.crater.fill(0);w.blds=[];w.units=[];w.shells=[];w.events=[];return w};
const cmd=(x=20,z=20,rot=0)=>({t:'build',side:0,kind:BK_WIRE,x,z,rot});
const add=(w,kind,x,z,side=0)=>{const u={id:w.units.length+1,kind,side,x:center(x),z:center(z),hp:10000,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:10000,aimX:SUB,aimZ:0};w.units.push(u);return u};
const house=(w,x,z)=>{const b={id:w.blds.length+1,kind:BK_COTTAGE,x,z,w:1,d:1,floors:1,hp:100,maxHp:100};w.blds.push(b);w.occ[idx(x,z)]=b.id;return b};
group('placement',()=>{
 for(const rot of [0,1]){const w=blank();assert.equal(applyBuild(w,cmd(20,20,rot)),null);const b=w.wires.segments[0];assert.deepEqual([b.w,b.d,b.hp,b.maxHp],[rot?1:2,rot?2:1,60,60],'placement: independent dimensions and HP');assert.equal(pointsUsed(w,0),1,'placement: shared one point');assert.equal(w.blds.length,0,'placement: never an AI garrison candidate');assert.equal(w.occ.some(Boolean),false,'placement: no building occupancy');assert.equal(wireAt(w,20,20),b);}
 const w=blank();applyBuild(w,cmd());const before=structuredClone(w);assert.equal(applyBuild(w,cmd()),'occupied');assert.deepEqual(w,before);assert.equal(applyTrench(w,{t:'trench',side:0,kind:0,x:20,z:20}),'occupied');assert.equal(applyBuild(w,{...cmd(),kind:BK_COTTAGE}),'occupied');
 for(const [x,z]of [[20,21],[20,22],[20,23],[20,24],[20,25],[20,26],[20,27]])assert.equal(applyBuild(w,cmd(x,z)),null);
 assert.equal(pointsUsed(w,0),8);assert.equal(applyBuild(w,cmd(20,28)),'points','placement: eight-point cap');
 for(const c of [{...cmd(),x:20.5},{...cmd(),rot:2},{...cmd(),side:2},{...cmd(),x:0,z:0}]){const q=blank(),old=structuredClone(q);assert.ok(applyBuild(q,c));assert.deepEqual(q,old,'placement: invalid build inert');}
 const map=blank();applyBuild(map,cmd());const old=structuredClone(map);applyMap(map,1);assert.deepEqual(map,old,'placement: map cannot bury paid wire');
});
group('connectivity',()=>{
 const w=blank(); // seven-cell ring of wire with two-cell entry; closing must fail even with no units inside.
 for(const [x,z,r]of [[20,20,1],[20,22,1],[20,24,0],[22,24,0],[24,20,1],[24,22,1],[22,20,0]])assert.equal(applyBuild(w,cmd(x,z,r)),null);
 const old=structuredClone(w);assert.equal(buildError(w,cmd(20,20)), 'occupied');
 // Independent free-standing walls delimit a corridor, new wire cannot partition it.
 const q=blank();for(let z=0;z<N;z++){house(q,18,z);house(q,23,z);} // 4-cell-wide corridor.
 // Gap rule keeps wire one cell from houses; build chain across open lane using raw other wire fixture.
 q.wires={version:1,segments:[{id:1,kind:BK_WIRE,x:19,z:20,w:1,d:1,floors:1,hp:60,maxHp:60,builtBy:0},{id:2,kind:BK_WIRE,x:22,z:20,w:1,d:1,floors:1,hp:60,maxHp:60,builtBy:0}]};
 assert.equal(buildError(q,cmd(20,20)),'blocked','connectivity: cannot seal foot corridor');assert.deepEqual(w,old);
});
group('paths',()=>{
 for(let kind=0;kind<UNIT_KINDS.length;kind++){
  const w=blank();applyBuild(w,cmd());const foot=[UK_OBSERVER,UK_INFANTRY,UK_MORTAR,UK_ZOMBIE].includes(kind); // R045 喪屍也必須繞網，不把新種類當車輛。
  const p=findPath(w,19,20,22,20,1,1,kind);assert.equal(p.some(c=>wireAt(w,c%N,Math.floor(c/N))),!foot,'paths: infantry detour vehicles cross');assert.equal(blocks(w,20,20),false);
  const u=add(w,kind,19,20);add(w,UK_TANK,28,28,1);step(w,[{t:'move',side:0,ids:[u.id],x:22,z:20}]);
  let crossed=false;for(let t=0;t<Math.ceil(8*SUB/UNIT_KINDS[kind].speed);t++){step(w,[]);crossed ||= !!wireAt(w,cellOf(u.x),cellOf(u.z));if(foot)assert.equal(wireBlocks(w,cellOf(u.x),cellOf(u.z),kind),false,'paths: actual movement never enters wire');}
  assert.equal(crossed,!foot,'paths: actual movement route');assert.equal(cellOf(u.x),22);
  const b=w.wires.segments[0];b.hp=0;assert(findPath(w,19,20,22,20,0,0,kind).some(c=>wireAt(w,c%N,Math.floor(c/N))),'paths: destroyed wire opens');
 }
});
group('orders',()=>{
 // Place the barrier before the point at which each weapon enters range; check both initial planning and tracking refresh.
 for(const [kind,type] of [[UK_INFANTRY,'attack'],[UK_MORTAR,'attack'],[UK_MORTAR,'fireAt']]){
  const w=blank();applyBuild(w,cmd(20,20,1));const u=add(w,kind,19,20),enemy=add(w,UK_TANK,31,31,1);
  const command=type==='attack'?{t:type,side:0,ids:[u.id],target:enemy.id}:{t:type,side:0,ids:[u.id],x:31,z:31};
  step(w,[command]);assert(u.path.length,'orders: out-of-range command has path');
  assert(!u.path.some(c=>wireBlocks(w,c%N,Math.floor(c/N),kind)),'orders: command path avoids wire');
  if(type==='attack'){w.tick=40-u.id;step(w,[]);assert(!u.path.some(c=>wireBlocks(w,c%N,Math.floor(c/N),kind)),'orders: timed tracking refresh avoids wire');}
  for(let t=0;t<100;t++){step(w,[]);assert(!wireBlocks(w,cellOf(u.x),cellOf(u.z),kind),'orders: actual attack/fire movement avoids wire');assert(!u.path.some(c=>wireBlocks(w,c%N,Math.floor(c/N),kind)),'orders: refreshed tracking path avoids wire');}
 }
});
group('combat',()=>{
 const w=blank();applyBuild(w,cmd());const u=add(w,UK_HOWITZER,10,20),f=add(w,UK_OBSERVER,19,20),e=add(w,UK_TANK,24,20,1);
 assert.equal(firstBlock(w,center(19),center(20),center(23),center(20)),-1,'combat: wire never blocks shots');assert.equal(spotted(w,0,e.x,e.z),true,'combat: wire never blocks sight');
 const b=w.wires.segments[0];b.hp=60;
 w.shells.push({id:w.nextShell++,side:0,kind:SHELL_HE,shooter:u.id,sx:u.x,sz:u.z,ex:center(20),ez:center(20),t:0,T:1,target:0,hitBld:0});
 step(w,[]);assert.equal(b.hp,Math.max(0,60-UNIT_KINDS[UK_HOWITZER].dmgBld),'combat: actual HE damage destroys wire');assert.equal(wireBlocks(w,20,20,UK_INFANTRY),false);assert(w.events.some(e=>e.e==='wire'),'combat: destruction refresh event');
 // The independent obstacle grants no building protection even if a hand-built fixture puts a soldier on it.
 const a=blank(),c=blank();applyBuild(a,cmd());for(const q of[a,c]){const g=add(q,UK_HOWITZER,10,20);add(q,UK_INFANTRY,20,20,1);q.shells.push({id:q.nextShell++,side:0,kind:SHELL_HE,shooter:g.id,sx:g.x,sz:g.z,ex:center(20),ez:center(20),t:0,T:1,target:0,hitBld:0});step(q,[]);}assert.equal(a.units[1].hp,c.units[1].hp,'combat: no wire cover or collapse injury');
});
group('eco',()=>{
 const w=blank();applyBuild(w,cmd(29,29));startEco(w,1,1,1);assert.equal(w.eco.hq.length,2);
 for(const b of w.blds)for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)assert.equal(wireAt(w,x,z),null,'eco: HQ never overlaps wire');
 w.eco.supply[0]=1000;produce(w,0,UK_MORTAR);const count=w.units.length;for(let t=0;t<UNIT_KINDS[UK_MORTAR].buildTicks+120;t++){step(w,[]);for(const u of w.units)if(u.alive&&[UK_OBSERVER,UK_INFANTRY,UK_MORTAR].includes(u.kind))assert.equal(wireBlocks(w,cellOf(u.x),cellOf(u.z),u.kind),false,'eco: produced foot units avoid wire');}
 assert(w.units.length>count,'eco: actual unit production continues');
});
group('replay',()=>{
 const commands=[cmd(),cmd(22,20),{t:'eco',inf:1,guns:1,tanks:1}];
 const log=commands.map(cmd=>({tick:0,cmd}));const a=runLog(blank(),log,180),b=runLog(blank(),JSON.parse(JSON.stringify(log)),180),mid=runLog(blank(),log,90),clone=structuredClone(mid);runLog(clone,log,180);assert.deepEqual(a,b,'replay: JSON log deterministic');assert.deepEqual(a,clone,'replay: midpoint clone deterministic');
 for(const key of ['id','kind','x','z','w','d','floors','hp','maxHp','builtBy']){const q=structuredClone(a);q.wires.segments[0][key]++;assert.notEqual(hashWorld(q),hashWorld(a),'replay: every persistent wire field hashed');}
 console.log('wire replay180',hashWorld(a));
});
