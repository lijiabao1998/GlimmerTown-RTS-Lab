// R106：既有彈坑的投射物掩護；各群可獨跑，供隔離副本的負控制。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, N, SUB, idx, cellOf, center, blocks, speedPct, bldMaxHp,
  UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_INFANTRY, UK_OBSERVER, UK_HEAVY, ORD_IDLE,
  BK_HOUSE, BK_BARN, BK_CHURCH, BK_PILLBOX, SHELL_AP, SHELL_HE, SHELL_SMALL, TER_ROAD, TER_MUD } from '../src/sim/world.ts';
import { step, runLog, firstBlock } from '../src/sim/step.ts';
import { SCRIPT, SCRIPT_SEED, SCRIPT_TICKS } from '../src/sim/script.ts';
const only=process.argv[2];let groups=0;
const group=(name,fn)=>{if(only&&only!==name)return;groups++;fn();console.log(`OK crater-cover/${name}`);};
const blank=()=>{const w=createWorld(1944);w.ter.fill(0);w.occ.fill(0);w.crater.fill(0);w.blds=[];w.units=[];w.shells=[];w.events=[];w.winner=-1;return w;};
const add=(w,side,kind,x,z)=>{const u={id:w.units.length+1,side,kind,x:center(x),z:center(z),hp:1000000,alive:true,order:ORD_IDLE,target:0,tx:0,tz:0,path:[],pathIdx:0,cooldown:1000000,aimX:SUB,aimZ:0};w.units.push(u);return u;};
const queue=(w,g,t,kind=SHELL_AP,hitBld=0)=>w.shells.push({id:w.nextShell++,side:g.side,kind,shooter:g.id,sx:g.x,sz:g.z,ex:t.x,ez:t.z,t:0,T:1,target:hitBld?0:t.id,hitBld});
const hit=(w,g,t,kind=SHELL_AP,hitBld=0)=>{const hp=t.hp;queue(w,g,t,kind,hitBld);step(w,[]);return hp-t.hp;};
const expected=(gun,target,pct)=>{const k=UNIT_KINDS[gun],t=UNIT_KINDS[target];const pierced=Math.floor(k.dmgUnit*(t.armored?k.pierce:k.soft)/100);return Math.floor(pierced*t.armor*pct/10000);};
const building=(w,kind,hp)=>{const maxHp=bldMaxHp(kind,1,1,1),b={id:1,kind,x:10,z:10,w:1,d:1,floors:1,hp:hp??maxHp,maxHp};w.blds=[b];w.occ[idx(10,10)]=1;return b;};

group('projectiles',()=>{
 let cases=0;
 for(const side of [0,1])for(let kind=0;kind<UNIT_KINDS.length;kind++)for(const dep of [0,1,2,3])for(const [gun,shell] of [[UK_TANK,SHELL_AP],[UK_HOWITZER,SHELL_HE],[UK_INFANTRY,SHELL_SMALL]]){
  const w=blank(),g=add(w,1-side,gun,3,3),t=add(w,side,kind,10,10);w.crater[idx(10,10)]=dep;
  assert.equal(hit(w,g,t,shell),expected(gun,kind,dep?75:100),`side${side} kind${kind} depth${dep} shell${shell}`);cases++;
 }
 console.log(`  ${cases} side/type/depth/projectile cases`);
});

group('rounding',()=>{
 const gun=UNIT_KINDS[UK_HOWITZER],R=gun.splash;
 const offsets=[...new Set([0,1,R-1,...Array.from({length:12},(_,i)=>Math.floor(R*i/12))])];let cases=0,earlyRoundDiff=0;
 for(let kind=0;kind<UNIT_KINDS.length;kind++)for(const offset of (kind===UK_HEAVY?Array.from({length:R},(_,i)=>i):offsets)){
  const w=blank(),g=add(w,1,UK_HOWITZER,3,3),t=add(w,0,kind,10,10);t.x+=offset;w.crater[idx(cellOf(t.x),cellOf(t.z))]=1;
  queue(w,g,t,SHELL_HE);w.shells.at(-1).ex=center(10);const hp=t.hp;step(w,[]);
  const target=UNIT_KINDS[kind],falloff=Math.floor(gun.dmgUnit*(R-offset)/R),dmg=Math.floor(falloff*(target.armored?gun.pierce:gun.soft)/100);
  const want=Math.floor(dmg*target.armor*75/10000);assert.equal(hp-t.hp,want,'HE falloff then combined armor/cover floor');
  if(want!==Math.floor(Math.floor(dmg*target.armor/100)*75/100))earlyRoundDiff++;cases++;
 }
 assert(earlyRoundDiff>0,'fixtures distinguish prematurely rounded armor');
 const w=blank(),g=add(w,1,UK_INFANTRY,3,3),t=add(w,0,UK_TANK,10,10);w.crater[idx(10,10)]=1;
 assert.equal(hit(w,g,t,SHELL_SMALL),expected(UK_INFANTRY,UK_TANK,75),'small hits may floor to zero, no hidden minimum damage');
 console.log(`  ${cases} HE falloff cases; ${earlyRoundDiff} expose early rounding`);
});

group('cells',()=>{
 // 左邊／上邊一個整數單位不算進坑，剛跨格界就算；四個地圖邊角都不串格。
 const positions=[[10*SUB-1,center(10),false],[10*SUB,center(10),true],[center(10),10*SUB-1,false],[center(10),10*SUB,true],
  [11*SUB-1,center(10),true],[11*SUB,center(10),false],[center(10),11*SUB-1,true],[center(10),11*SUB,false]];
 for(const [x,z,covered] of positions){const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_TANK,10,10);t.x=x;t.z=z;w.crater[idx(10,10)]=1;assert.equal(hit(w,g,t),expected(UK_TANK,UK_TANK,covered?75:100),'current integer cell boundary');}
 for(const [x,z] of [[0,0],[0,N-1],[N-1,0],[N-1,N-1]]){const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_TANK,x,z);w.crater[idx(x,z)]=3;assert.equal(hit(w,g,t),expected(UK_TANK,UK_TANK,75),'edge crater');}
 const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_TANK,10,10);w.crater[idx(3,3)]=3;assert.equal(hit(w,g,t),expected(UK_TANK,UK_TANK,100),'shooter crater gives target no cover');
});

group('buildings',()=>{
 for(const kind of [BK_HOUSE,BK_BARN,BK_CHURCH,BK_PILLBOX])for(const stage of ['intact','roofless','rubble'])for(const dep of [0,3]){
  const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_OBSERVER,10,10),b=building(w,kind);if(stage==='roofless')b.hp=Math.floor(b.maxHp*7/10);if(stage==='rubble')b.hp=0;w.crater[idx(10,10)]=dep;
  const pct=stage==='rubble'?(dep?75:100):(kind===BK_PILLBOX?25:50);
  assert.equal(hit(w,g,t),expected(UK_TANK,UK_OBSERVER,pct),'stronger building cover overrides, rubble only uses ground');
 }
 // 建築本體不吃彈坑減傷；測直射與高爆，同一棟只扣一次。
 for(const dep of [0,3])for(const [gun,shell] of [[UK_TANK,SHELL_AP],[UK_HOWITZER,SHELL_HE]]){
  const w=blank(),g=add(w,1,gun,3,3),t=add(w,0,UK_OBSERVER,10,10),b=building(w,BK_HOUSE,10000);b.maxHp=10000;w.crater[idx(10,10)]=dep;
  hit(w,g,t,shell,shell===SHELL_AP?b.id:0);assert.equal(b.hp,10000-UNIT_KINDS[gun].dmgBld,'building damage unchanged');
 }
});

group('collapse',()=>{
 for(const kind of [BK_HOUSE,BK_BARN,BK_CHURCH,BK_PILLBOX])for(const dep of [0,1,3]){
  const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_OBSERVER,10,10),b=building(w,kind,1);w.crater[idx(10,10)]=dep;
  assert.equal(hit(w,g,t,SHELL_AP,b.id),Math.floor(20*UNIT_KINDS[UK_OBSERVER].armor/100),'falling debris is not protected by crater');assert.equal(b.hp,0);
 }
});

group('blast_order',()=>{
 const w=blank(),g=add(w,1,UK_HOWITZER,3,3),t=add(w,0,UK_TANK,10,10),losses=[],depths=[];
 for(let i=0;i<4;i++){losses.push(hit(w,g,t,SHELL_HE));depths.push(w.crater[idx(10,10)]);}
 const full=expected(UK_HOWITZER,UK_TANK,100),covered=expected(UK_HOWITZER,UK_TANK,75);
 assert.deepEqual(losses,[full,covered,covered,covered],'first blast hurts before creating cover');assert.deepEqual(depths,[1,2,3,3],'crater depth still capped at three');
 const v=blank(),vg=add(v,1,UK_HOWITZER,3,3),vt=add(v,0,UK_TANK,10,10),hp=vt.hp;queue(v,vg,vt,SHELL_HE);queue(v,vg,vt,SHELL_HE);step(v,[]);
 assert.equal(hp-vt.hp,full+covered,'same-tick shells retain deterministic sequential landing');assert.equal(v.crater[idx(10,10)],2);
 console.log(`  first/following HE ${full}/${covered}; depth ${depths.join('/')}`);
});

group('movement',()=>{
 const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_OBSERVER,9,10);for(let z=0;z<N;z++)w.crater[idx(10,z)]=1;
 step(w,[{t:'move',side:0,ids:[t.id],x:11,z:10}]);const seen=new Set();
 const cap=Math.ceil(4*SUB*100/(UNIT_KINDS[UK_OBSERVER].speed*45))+20;
 for(let i=0;i<cap;i++){const hp=t.hp;queue(w,g,t);step(w,[]);const x=cellOf(t.x),z=cellOf(t.z);seen.add(x);assert.equal(hp-t.hp,expected(UK_TANK,UK_OBSERVER,w.crater[idx(x,z)]?75:100),'cover updates after movement, no sticky flag');if(x===11&&t.pathIdx>=t.path.length)break;}
 assert(seen.has(9)&&seen.has(10)&&seen.has(11),'actually crossed into and out of crater');
 for(const [dep,pct] of [[0,85],[1,65],[2,55],[3,45]]){w.crater[idx(10,10)]=dep;assert.equal(speedPct(w,10,10),pct,'existing grass/crater slowdown');assert.equal(blocks(w,10,10),false);assert.equal(firstBlock(w,center(9),center(10),center(11),center(10)),-1);}
 w.ter[idx(10,10)]=TER_MUD;assert.equal(speedPct(w,10,10),40,'mud remains slower');w.crater[idx(10,10)]=0;w.ter[idx(10,10)]=TER_ROAD;assert.equal(speedPct(w,10,10),100,'road remains fastest');
});

group('replay',()=>{
 const log=JSON.parse(JSON.stringify(SCRIPT));
 const a=runLog(createWorld(SCRIPT_SEED),SCRIPT,SCRIPT_TICKS),b=runLog(createWorld(SCRIPT_SEED),log,SCRIPT_TICKS);
 const half=runLog(createWorld(SCRIPT_SEED),log,SCRIPT_TICKS/2),copy=structuredClone(half);runLog(half,log,SCRIPT_TICKS);runLog(copy,log,SCRIPT_TICKS);
 assert.deepEqual([hashWorld(b),hashWorld(half),hashWorld(copy)],[hashWorld(a),hashWorld(a),hashWorld(a)],'old command JSON/replay/clone');
 // 既有存檔原本就有 crater，無新增欄位；在有坑的半途世界上接續也一致。
 const old=blank(),g=add(old,1,UK_TANK,3,3),t=add(old,0,UK_OBSERVER,10,10);old.tick=200;old.crater[idx(10,10)]=2;const keys=Object.keys(old).sort(),saved=structuredClone(old);
 assert.equal(hit(old,g,t),expected(UK_TANK,UK_OBSERVER,75));hit(saved,saved.units[0],saved.units[1]);assert.equal(hashWorld(old),hashWorld(saved));assert.deepEqual(Object.keys(old).sort(),keys,'no world migration fields');
 console.log(`  script ${hashWorld(a)}; legacy ${hashWorld(old)}`);
});
assert(groups>0,`unknown group ${only}`);console.log(`crater-cover: ${groups} groups passed`);
