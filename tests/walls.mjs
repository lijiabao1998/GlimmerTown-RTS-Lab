// R120: independent contract fixtures, topology oracle, actual shells/production, and frozen legacy fingerprints.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, N, SUB, idx, center, cellOf, blocks, speedPct, stageOf, bldMaxHp, bldMaterial, isWallKind,
  BK_HOUSE, BK_COTTAGE, BK_BARN, BK_HQ, BK_PILLBOX, BK_WALL_BRICK, BK_WALL_STONE, BK_WALL_CONCRETE,
  BM_BRICK, BM_STONE, BM_CONCRETE, TER_ROAD, TER_MUD, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY,
  ORD_IDLE, STAGE_INTACT, STAGE_ROOFLESS, STAGE_RUBBLE, SHELL_AP, SHELL_HE } from '../src/sim/world.ts';
import { BUILD_KINDS, BUILD_KINDS_24, WALL_KINDS, buildKind, footprint, buildError, applyBuild, pointsUsed, stillConnected, enemyPlan } from '../src/sim/build.ts';
import { applyTrench, trenchAt } from '../src/sim/trenches.ts';
import { applyMap } from '../src/sim/maps.ts';
import { startEco, produce, ecoStep } from '../src/sim/eco.ts';
import { step, runLog, firstBlock, spotted } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { SCRIPT, SCRIPT_SEED } from '../src/sim/script.ts';
const only=process.argv[2]; let groups=0;
const group=(name,fn)=>{if(only&&only!==name)return;groups++;fn();console.log(`OK walls/${name}`);};
const kinds=[7,8,9], hp=[130,220,360], costs=[1,2,3], seeds=[1944,1,2,3,5,8,13,21,34,55,89,144];
const blank=()=>{const w=createWorld(1944);w.ter.fill(0);w.occ.fill(0);w.crater.fill(0);w.blds=[];w.units=[];w.shells=[];w.events=[];w.winner=-1;return w;};
const cmd=(kind=7,side=0,x=20,z=20,rot=0)=>({t:'build',side,kind,x,z,rot});
const trench=(side=0,x=20,z=24)=>({t:'trench',side,kind:0,x,z,rot:0});
const add=(w,side,kind,x,z)=>{const u={id:w.units.length+1,side,kind,x:center(x),z:center(z),hp:1000000,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:1000000,aimX:SUB,aimZ:0};w.units.push(u);return u;};
const bld=(w,kind,x,z,bw=1,bd=1)=>{const maxHp=bldMaxHp(kind,bw,bd,1),b={id:w.blds.length+1,kind,x,z,w:bw,d:bd,floors:1,hp:maxHp,maxHp};w.blds.push(b);for(let dz=0;dz<bd;dz++)for(let dx=0;dx<bw;dx++)w.occ[idx(x+dx,z+dz)]=b.id;return b;};
const queue=(w,g,x,z,shell,hitBld=0,target=0)=>w.shells.push({id:w.nextShell++,side:g.side,kind:shell,shooter:g.id,sx:g.x,sz:g.z,ex:center(x),ez:center(z),t:0,T:1,target,hitBld});
// Independent four-neighbor component oracle. Eight-neighbor paths without corner cutting have exactly this connectivity.
const components=w=>{const out=new Int32Array(N*N);let n=0;for(let c=0;c<N*N;c++){const blocked=i=>{const b=w.blds[w.occ[i]-1];return b&&b.hp>0;};if(out[c]||blocked(c))continue;out[c]=++n;const q=[c];for(let p=0;p<q.length;p++){const cur=q[p],x=cur%N,z=Math.floor(cur/N);for(const [a,b]of [[x-1,z],[x+1,z],[x,z-1],[x,z+1]])if(a>=0&&b>=0&&a<N&&b<N){const i=b*N+a;if(!out[i]&&!blocked(i)){out[i]=n;q.push(i);}}}}return out;};
const preserves=(before,after)=>{const seen=new Map();for(let i=0;i<N*N;i++)if(after[i]){if(seen.has(before[i])&&seen.get(before[i])!==after[i])return false;seen.set(before[i],after[i]);}return true;};
const rawWall=(w,c)=>bld(w,c.kind,c.x,c.z,c.rot?1:2,c.rot?2:1);

group('templates',()=>{
  assert.deepEqual([BK_WALL_BRICK,BK_WALL_STONE,BK_WALL_CONCRETE],[7,8,9],'templates: published kind codes');
  assert.deepEqual(WALL_KINDS.map(k=>[k.name,k.kind,k.w,k.d,k.floors,k.cost]),[['wall_brick',7,2,1,1,1],['wall_stone',8,2,1,1,2],['wall_concrete',9,2,1,1,3]],'templates: exact separate wall table');
  assert.deepEqual(BUILD_KINDS.map(k=>[k.name,k.kind,k.w,k.d,k.floors,k.cost]),[['cottage',1,1,1,1,1],['house',0,2,1,2,2],['barn',2,2,2,1,3]],'templates: original building table unchanged');
  assert.deepEqual(BUILD_KINDS_24.map(k=>k.kind),[1,0,2,6],'templates: enemy table excludes walls');
  for(let k=-1;k<=10;k++)assert.equal(isWallKind(k),k===7||k===8||k===9,'templates: exact wall classification');
  for(const kind of kinds)for(const side of [0,1])for(const rot of [0,1]){
    const w=blank(),c=cmd(kind,side,side?4:20,side?4:20,rot),before=structuredClone(w),i=kind-7;
    assert.equal(buildError(w,c),null);assert.deepEqual(w,before,'templates: preview validation is pure');
    assert.deepEqual(footprint(c),{x:c.x,z:c.z,w:rot?1:2,d:rot?2:1},'templates: exact rotated two-cell footprint');
    assert.equal(applyBuild(w,c),null);assert.equal(w.rng,before.rng,'templates: construction never draws World.rng');
    const b=w.blds[0];assert.deepEqual([b.kind,b.w,b.d,b.floors,b.hp,b.maxHp,b.builtBy],[kind,rot?1:2,rot?2:1,1,hp[i],hp[i],side],'templates: fixed wall health and dimensions');
    assert.equal(bldMaterial(kind),[BM_BRICK,BM_STONE,BM_CONCRETE][i],'templates: wall material');assert.equal(pointsUsed(w,side),costs[i]);
    for(let z=0;z<N;z++)for(let x=0;x<N;x++)assert.equal(w.occ[idx(x,z)],x>=c.x&&x<c.x+b.w&&z>=c.z&&z<c.z+b.d?1:0,'templates: both wall cells occupied');
  }
  const a=blank(),b=blank(),c=cmd();delete c.rot;applyBuild(a,c);applyBuild(b,cmd());assert.deepEqual(a,b,'templates: omitted rotation preserves old command format');assert.equal(buildKind(99),null);
});

group('validation',()=>{
  const reject=(c,reason,setup=()=>{})=>{const w=blank();setup(w);const before=structuredClone(w);assert.equal(buildError(w,c),reason,'validation: exact refusal reason');assert.equal(applyBuild(w,c),reason);assert.deepEqual(w,before,'validation: rejection leaves entire world unchanged');};
  for(const v of [-1,2,0.5,NaN,'0',null])reject({...cmd(),side:v},'side');
  for(const v of [-1,3,99,7.5,NaN,'7',null])reject({...cmd(),kind:v},'kind');
  for(const v of [-1,2,0.5,NaN,'0',null])reject({...cmd(),rot:v},'rot');
  for(const key of ['x','z'])for(const v of [0.5,NaN,Infinity,'20',null])reject({...cmd(),[key]:v},'coord');
  reject(cmd(),'tick',w=>w.tick=1);reject(cmd(7,0,-1,20),'map');reject(cmd(7,0,31,20),'map');reject(cmd(7,0,20,31,1),'map');reject(cmd(7,0,4,4),'foreign');reject(cmd(7,0,16,16),'neutral');
  reject(cmd(),'road',w=>w.ter[idx(21,20)]=TER_ROAD);reject(cmd(),'mud',w=>w.ter[idx(21,20)]=TER_MUD);
  reject(cmd(),'occupied',w=>bld(w,BK_COTTAGE,21,20));reject(cmd(),'occupied',w=>bld(w,7,21,20).hp=0);
  reject(cmd(),'occupied',w=>applyTrench(w,trench(0,21,20)));reject(cmd(),'unit',w=>add(w,1,UK_TANK,21,20));
  const w=blank();add(w,1,UK_TANK,21,20).alive=false;assert.equal(applyBuild(w,cmd()),null,'validation: dead units do not block placement');
});

group('gap',()=>{
  for(const kind of kinds)for(const other of kinds)for(const [dx,dz,rot]of [[2,0,0],[0,1,0],[2,0,1],[2,1,1]]){const w=blank();applyBuild(w,cmd(kind));assert.equal(applyBuild(w,cmd(other,0,20+dx,20+dz,rot)),null,'gap: only walls may connect edge or corner');}
  for(const wallFirst of [true,false])for(const kind of kinds){const w=blank();applyBuild(w,cmd(wallFirst?kind:BK_COTTAGE));const before=structuredClone(w);assert.equal(applyBuild(w,cmd(wallFirst?BK_COTTAGE:kind,0,wallFirst?22:21,20)),'gap','gap: wall-house separation is symmetric');assert.deepEqual(w,before);}
  const w=blank();applyBuild(w,cmd());assert.equal(applyBuild(w,cmd(BK_COTTAGE,0,23,20)),null,'gap: one empty cell remains legal');
});

group('connectivity',()=>{
  const reject=(w,c,label)=>{const old=structuredClone(w),placed=structuredClone(w);rawWall(placed,c);assert.equal(preserves(components(w),components(placed)),false,`connectivity: independent fixture ${label} really splits empty cells`);assert.equal(buildError(w,c),'blocked','connectivity: prevents every newly closed empty pocket');assert.equal(applyBuild(w,c),'blocked');assert.deepEqual(w,old,'connectivity: failed closure leaves full state unchanged');};
  for(const diagonal of [false,true]){const w=blank();for(let z=20;z<=24;z++)for(let x=20;x<=24;x++)if((x===20||x===24||z===20||z===24)&&!(z===20&&(x===21||x===22||(diagonal&&x===20))))bld(w,7,x,z);reject(w,cmd(7,0,21,20),diagonal?'diagonal corner':'unit-free pocket');}
  {const w=blank();bld(w,7,24,2,1,30);reject(w,cmd(7,1,24,0,1),'map edge');}
  {const w=blank();bld(w,7,28,28,1,4);bld(w,7,31,28);reject(w,cmd(7,0,29,28),'map corner');}
  {const w=blank();bld(w,7,24,0,1,20);bld(w,7,24,22,1,10);add(w,0,UK_TANK,30,30);add(w,1,UK_TANK,30,2);reject(w,cmd(7,0,24,20,1),'old narrow lane with all units outside');}
  // A preexisting disconnected component is not itself a reason to reject an unrelated legal wall.
  const w=blank();bld(w,7,10,0,1,N);const before=components(w);assert.equal(applyBuild(w,cmd()),null,'connectivity: preserves already disconnected components without rejecting them');assert(preserves(before,components(w)));
  // A long chain remains useful while there is a real one-cell opening around its end.
  const open=blank();bld(open,7,24,0,1,19);bld(open,7,24,22,1,10);assert.equal(applyBuild(open,cmd(7,0,24,20,1)),null,'connectivity: real one-cell lane stays open');
});

group('budget_order',()=>{
  for(const side of [0,1]){const w=blank(),p=side?3:20;assert.equal(applyBuild(w,cmd(9,side,p,p)),null);assert.equal(applyBuild(w,cmd(8,side,p+2,p)),null);assert.equal(applyBuild(w,cmd(BK_COTTAGE,side,p,p+3)),null);assert.equal(applyTrench(w,trench(side,p+3,p+3)),null);assert.equal(pointsUsed(w,side),7,'budget_order: walls houses and trenches share points');const before=structuredClone(w);assert.equal(applyBuild(w,cmd(8,side,p+5,p)),'points','budget_order: walls cannot exceed shared budget');assert.deepEqual(w,before);assert.equal(applyBuild(w,cmd(7,side,p+4,p)),null);assert.equal(pointsUsed(w,side),8);assert.equal(applyTrench(w,trench(side,p+6,p+3)),'points','budget_order: trenches see wall costs');}
  const a=blank(),b=blank(),c=cmd(),t=trench(0,20,20);step(a,[t,c]);step(b,[c,t]);assert.equal(a.blds.length,0,'budget_order: earlier trench wins overlap');assert.equal(a.trenches.segments.length,1);assert.equal(b.blds.length,1);assert.equal(b.trenches,undefined,'budget_order: earlier wall wins overlap');
  const w=blank();w.vegetation={version:1,cells:new Uint8Array(N*N).fill(2)};const real=structuredClone(w),preview=structuredClone(w);applyBuild(preview,cmd(8,0,20,20,1));assert.deepEqual(w,real,'budget_order: cloned preview cannot mutate source');for(let i=0;i<N*N;i++)assert.equal(preview.vegetation.cells[i],i===idx(20,20)||i===idx(20,21)?0:2,'budget_order: only occupied wall cells clear vegetation');
  const plan=[cmd(8),trench(0,24,20),cmd(7,0,22,20)],original=blank();for(const c of plan)(c.t==='build'?applyBuild:applyTrench)(original,c);const removed=blank();for(const c of plan.filter((_,i)=>i!==0))(c.t==='build'?applyBuild:applyTrench)(removed,c);assert.equal(pointsUsed(original,0)-pointsUsed(removed,0),2,'budget_order: whole-segment replay removal refunds exact cost');assert.equal(removed.occ[idx(20,20)],0);assert.equal(removed.occ[idx(21,20)],0);const restored=blank();for(const c of plan)(c.t==='build'?applyBuild:applyTrench)(restored,c);assert.deepEqual(restored,original,'budget_order: replay undo restores complete original world');
});

group('maps_hq',()=>{
  let layouts=0,spawned=0;
  for(const map of [0,1])for(const seed of seeds)for(const profile of [[7,7,7,7,7,7,7,7],[9,9,8],['trench',BK_COTTAGE,8,7,7,7,7]]){
    const w=createWorld(seed);applyMap(w,map,1);const rng=w.rng;
    for(const side of [0,1]){
      // Adversarially occupy the corner/HQ search area first, alternating rotations and attaching whenever legal.
      const positions=[];for(let z=0;z<N;z++)for(let x=0;x<N;x++)positions.push([x,z]);const corner=side?0:31;positions.sort((a,b)=>Math.abs(a[0]-corner)+Math.abs(a[1]-corner)-Math.abs(b[0]-corner)-Math.abs(b[1]-corner)||a[1]-b[1]||a[0]-b[0]);
      for(let i=0;i<profile.length;i++){let placed=false;for(const [x,z]of positions){for(const rot of [i%2,1-i%2]){const kind=profile[i],c=kind==='trench'?{...trench(side,x,z),rot}:cmd(kind,side,x,z,rot),before=components(w);if((kind==='trench'?applyTrench:applyBuild)(w,c)===null){assert(preserves(before,components(w)),'maps_hq: independent connectivity after every paid placement');placed=true;break;}}if(placed)break;}assert(placed,'maps_hq: maximal affordable adversarial layout fits');}
      assert.equal(pointsUsed(w,side),8,'maps_hq: both sides spend full shared budget');
    }
    const paid=w.blds.map(b=>({...b})),trenches=structuredClone(w.trenches);startEco(w);assert(w.eco.hq.every(Boolean),'maps_hq: both headquarters exist');assert.equal(w.rng,rng,'maps_hq: layout and headquarters never draw RNG');
    for(const b of paid)for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)assert.equal(w.occ[idx(x,z)],b.id,'maps_hq: headquarters never overwrite paid wall or house');assert.deepEqual(w.trenches,trenches);
    for(const id of w.eco.hq){const b=w.blds[id-1];assert.equal(b.kind,BK_HQ);for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)assert.equal(trenchAt(w,x,z),null,'maps_hq: headquarters never cover paid trench');}
    assert(stillConnected(w,-9,-9,0,0),'maps_hq: original units remain connected');
    const lastId=w.units.length;for(const side of [0,1])produce(w,side,UK_TANK);for(let t=0;t<=UNIT_KINDS[UK_TANK].buildTicks;t++)ecoStep(w);
    const fresh=w.units.filter(u=>u.id>lastId);assert.deepEqual(fresh.map(u=>u.side),[0,1],'maps_hq: both HQs actually produce a new tank');spawned+=fresh.length;
    for(const u of w.units)u.cooldown=1000000;
    for(const u of fresh){assert.equal(w.occ[idx(cellOf(u.x),cellOf(u.z))],0,'maps_hq: produced tanks spawn outside every paid building and HQ');const x=15+u.side,z=15+u.side,path=findPath(w,cellOf(u.x),cellOf(u.z),x,z);assert.equal(path.at(-1),idx(x,z),'maps_hq: new tank has complete path to main battlefield');}
    step(w,fresh.map(u=>({t:'move',side:u.side,ids:[u.id],x:15+u.side,z:15+u.side})));
    const cap=Math.ceil(3*N*SUB*100/(UNIT_KINDS[UK_TANK].speed*40));for(let t=0;t<cap&&!fresh.every(u=>cellOf(u.x)===15+u.side&&cellOf(u.z)===15+u.side);t++)step(w,[]);
    for(const u of fresh)assert.deepEqual([cellOf(u.x),cellOf(u.z)],[15+u.side,15+u.side],'maps_hq: both produced tanks physically leave HQ for main battlefield');layouts++;
  }
  console.log(`  ${layouts} adversarial layouts, ${layouts*2} full budgets/HQs, ${spawned} produced tanks reached battlefield`);
});

group('destruction',()=>{
  for(const kind of kinds)for(const rot of [0,1])for(const [gunKind,shell]of [[UK_TANK,SHELL_AP],[UK_HOWITZER,SHELL_HE]]){
    const w=blank(),b=bld(w,kind,20,20,rot?1:2,rot?2:1),g=add(w,0,gunKind,12,20);add(w,1,UK_OBSERVER,31,31);const damage=UNIT_KINDS[gunKind].dmgBld,stages=[];
    assert.equal(stageOf(b),STAGE_INTACT);assert.equal(firstBlock(w,center(18),center(20),center(23),center(20)),idx(20,20),'destruction: standing wall intercepts direct fire');
    for(let shot=1;shot<=Math.ceil(hp[kind-7]/damage);shot++){queue(w,g,20,20,shell,shell===SHELL_AP?b.id:0);step(w,[]);assert.equal(b.hp,Math.max(0,hp[kind-7]-shot*damage),'destruction: actual AP and HE apply ordinary building damage');stages.push(...w.events.filter(e=>e.e==='stage').map(e=>e.stage));for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)assert.equal(blocks(w,x,z),b.hp>0,'destruction: entire two-cell segment opens only at zero HP');}
    assert.deepEqual(stages,[STAGE_ROOFLESS,STAGE_RUBBLE],'destruction: actual impacts cross damaged then rubble stages');assert.equal(firstBlock(w,center(18),center(20),center(23),center(20)),-1,'destruction: rubble clears entire firing line');
    for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++){assert.equal(findPath(w,18,20,x,z).at(-1),idx(x,z),'destruction: both rubble cells become reachable');assert.equal(speedPct(w,x,z),45,'destruction: rubble retains movement slowdown');assert.equal(w.occ[idx(x,z)],b.id);}
  }
  // Fire commands exercise real aiming/projectile interception rather than a manufactured hit target.
  for(const kind of kinds){const w=blank(),b=bld(w,kind,20,20,2,1),g=add(w,0,UK_TANK,17,20);g.cooldown=0;add(w,1,UK_OBSERVER,31,31);let fires=0;const cap=(Math.ceil(hp[kind-7]/UNIT_KINDS[UK_TANK].dmgBld)+1)*UNIT_KINDS[UK_TANK].reload;for(let t=0;t<cap&&b.hp;t++){step(w,t?[]:[{t:'fireAt',side:0,ids:[g.id],x:20,z:20}]);fires+=w.events.filter(e=>e.e==='fire').length;}assert.equal(b.hp,0,'destruction: native fireAt actually destroys wall');assert.equal(fires,Math.ceil(hp[kind-7]/UNIT_KINDS[UK_TANK].dmgBld),'destruction: concrete is never pillbox quarter-damage armor');}
  for(const kind of kinds){const w=blank(),b=bld(w,kind,20,20,2,1),g=add(w,0,UK_HOWITZER,12,20);g.cooldown=0;add(w,0,UK_OBSERVER,22,22);add(w,1,UK_OBSERVER,31,31);let impacts=0;const stages=[];const cap=(Math.ceil(hp[kind-7]/UNIT_KINDS[UK_HOWITZER].dmgBld)+6)*UNIT_KINDS[UK_HOWITZER].reload;for(let t=0;t<cap&&b.hp;t++){const before=b.hp;step(w,t?[]:[{t:'fireAt',side:0,ids:[g.id],x:20,z:20}]);if(b.hp<before)impacts++;stages.push(...w.events.filter(e=>e.e==='stage'&&e.bld===b.id).map(e=>e.stage));}assert.equal(b.hp,0,'destruction: native howitzer fireAt actually destroys wall');assert.equal(impacts,Math.ceil(hp[kind-7]/UNIT_KINDS[UK_HOWITZER].dmgBld),'destruction: native HE applies one damage amount per segment');assert.deepEqual(stages,[STAGE_ROOFLESS,STAGE_RUBBLE],'destruction: native HE crosses both damage stages');}
});

group('garrison_los',()=>{
  for(const kind of kinds)for(const uk of [UK_OBSERVER,UK_INFANTRY]){
    const w=blank(),b=bld(w,kind,20,20,2,1),u=add(w,0,uk,18,20),g=add(w,1,UK_TANK,24,20);step(w,[{t:'move',side:0,ids:[u.id],x:20,z:20}]);for(let t=0;t<Math.ceil(4*SUB*100/(UNIT_KINDS[uk].speed*45));t++)step(w,[]);assert.equal(w.occ[idx(cellOf(u.x),cellOf(u.z))],b.id,'garrison_los: observer and infantry inherit ordinary building entry');
    for(const stage of [STAGE_INTACT,STAGE_ROOFLESS]){b.hp=stage===STAGE_INTACT?b.maxHp:Math.floor(b.maxHp*7/10);const before=u.hp;queue(w,g,20,20,SHELL_AP,0,u.id);step(w,[]);assert.equal(before-u.hp,Math.floor(UNIT_KINDS[UK_TANK].dmgUnit*UNIT_KINDS[uk].armor*50/10000),'garrison_los: intact and damaged walls inherit fifty-percent garrison cover');}
    b.hp=1;w.crater[idx(20,20)]=3;w.vegetation={version:1,cells:new Uint8Array(N*N)};w.vegetation.cells[idx(20,20)]=2;const before=u.hp;queue(w,g,20,20,SHELL_AP,b.id);step(w,[]);assert.equal(before-u.hp,20,'garrison_los: collapse injury bypasses ground cover');
  }
  for(const kind of kinds){const w=blank(),b=bld(w,kind,20,20,2,1);add(w,0,UK_OBSERVER,18,20);assert.equal(spotted(w,0,center(23),center(20)),false,'garrison_los: even low brick wall fully blocks LOS');b.hp=0;assert.equal(spotted(w,0,center(23),center(20)),true,'garrison_los: collapse releases LOS');}
});

group('replay',()=>{
  for(const map of [0,1])for(const rot of [0,1]){
    const w=createWorld(SCRIPT_SEED);applyMap(w,map,1);const plan=[];
    for(const side of [0,1])for(const kind of kinds){let found=false;for(let z=0;z<N&&!found;z++)for(let x=0;x<N&&!found;x++){const c=cmd(kind,side,x,z,rot);if(!buildError(w,c)){assert.equal(applyBuild(w,c),null);plan.push(c);found=true;}}assert(found,'replay: each wall kind side rotation is accepted');}
    const log=[{tick:0,cmd:{t:'map',id:map,vegetation:1}},...plan.map(cmd=>({tick:0,cmd})),{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}},...SCRIPT],direct=runLog(createWorld(SCRIPT_SEED),log,1200),json=runLog(createWorld(SCRIPT_SEED),JSON.parse(JSON.stringify(log)),1200),middle=runLog(createWorld(SCRIPT_SEED),log,600),clone=structuredClone(middle);runLog(middle,log,1200);runLog(clone,log,1200);
    for(const v of [json,middle,clone])assert.deepEqual(v,direct,'replay: native JSON and middle-clone reproduce entire wall world');
    const hash=hashWorld(direct);for(const change of [b=>b.kind=BK_COTTAGE,b=>b.hp++,b=>b.maxHp++,b=>b.w++,b=>b.d++,b=>b.builtBy^=1,b=>b.x++,b=>b.z++]){const c=structuredClone(direct);change(c.blds.find(b=>isWallKind(b.kind)));assert.notEqual(hashWorld(c),hash,'replay: all persistent wall fields affect hash');}console.log(`  map${map} rotation${rot} wall replay1200 ${hash}`);
  }
});

// Frozen from independent main 58667af archive (R036/R037 integrated), not derived from the functions under test.
group('legacy',()=>{
  assert.equal(hashWorld(createWorld(SCRIPT_SEED)),'62e00ebe','legacy: original initial SCRIPT hash');
  const fixtures=[['script',SCRIPT,'2e4bcf04bc6870f8f4f3fd9a2049b7273e24797dcdc638d3c37093eb1ff53254',['d7b3572f','eea1d59b']],['rye',[{tick:0,cmd:{t:'map',id:1}},...SCRIPT],'475b3ca00a36bd18248d5eb1f6c843e8fdb0b9606cd95cd01de89befdd4b9c1f',['0a324ceb','204c47a5']]];
  for(const [map,digest,hashes,plan]of [
    [0,'cee6f177fcd3d6476f1c6984ee1053239223e9d47235f716337290c51d042f53',['dde837f9','7f983268'],[{t:'build',side:1,kind:0,x:9,z:9,rot:1},{t:'build',side:1,kind:2,x:11,z:8,rot:0},{t:'build',side:1,kind:1,x:8,z:7,rot:0},{t:'build',side:1,kind:0,x:10,z:12,rot:1}]],
    [1,'e9cbe636cfe4c738d4bf200a77f750ca28ab4c97cefa76b7c13e06f6c9221c49',['4fe0da65','00a7d63e'],[{t:'build',side:1,kind:0,x:8,z:7,rot:1},{t:'build',side:1,kind:2,x:9,z:12,rot:0},{t:'build',side:1,kind:1,x:6,z:9,rot:0},{t:'build',side:1,kind:0,x:10,z:5,rot:1}]],
  ]){const w=createWorld(SCRIPT_SEED);applyMap(w,map,1);const before=structuredClone(w);assert.deepEqual(enemyPlan(w,BUILD_KINDS_24),plan,'legacy: frozen original enemy building plan');assert.deepEqual(w,before,'legacy: enemy planning leaves complete world unchanged');fixtures.push([`map${map}-eco`,[{tick:0,cmd:{t:'map',id:map,vegetation:1}},...plan.map(cmd=>({tick:0,cmd})),{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}},...SCRIPT],digest,hashes]);}
  const worldDigests={script:'c2a6785e8a0db524c6ae977da636882d8d64d9e15b68d6b600c77a4db061112a',rye:'7931866f7537a9436900b08fad4f8e84a769da3ab0e8bf36972ce431f73bbf64','map0-eco':'dc0eb68ce460153f6418cb7b7d72cd13dbd12b3d7debe3cc1bca5c6d678048f0','map1-eco':'a265184eea5b363f10e953b2d1f090d8c5e1094dc870155785e6f7e346a6c5de'}; // git archive 58667af (main before R120; owner-approved numeric recalculation), entire JSON world each tick including events.
  for(const [name,log,want,hashes]of fixtures){const w=createWorld(SCRIPT_SEED),digest=createHash('sha256'),worldDigest=createHash('sha256');for(let tick=0;tick<1200;tick++){step(w,log.filter(c=>c.tick===tick).map(c=>c.cmd));digest.update(`${hashWorld(w)}:${w.rng};`);worldDigest.update(JSON.stringify(w));if(w.tick===600||w.tick===1200)assert.equal(hashWorld(w),hashes[w.tick===600?0:1],'legacy: original SCRIPT checkpoints');}assert.equal(digest.digest('hex'),want,`legacy: ${name} every-tick hash and RNG unchanged`);assert.equal(worldDigest.digest('hex'),worldDigests[name],`legacy: ${name} entire every-tick world unchanged`);}
});
assert(groups>0,`unknown group ${only}`);console.log(`walls: ${groups} groups passed`);
