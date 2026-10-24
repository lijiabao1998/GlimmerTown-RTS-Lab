// R118：獨立預期格、傷害算式與 main3654fb2 固定歷史指紋。可按群隔離跑語意負控制。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, hashWorld, N, SUB, idx, cellOf, center, blocks, speedPct, bldMaxHp, UNIT_KINDS,
  UK_TANK, UK_HOWITZER, UK_INFANTRY, UK_OBSERVER, UK_HEAVY, UK_ATGUN, UK_MORTAR, ORD_IDLE,
  BK_COTTAGE, BK_HOUSE, BK_PILLBOX, BK_HQ, SHELL_AP, SHELL_HE, SHELL_SMALL, SHELL_SMOKE, TER_ROAD, TER_MUD } from '../src/sim/world.ts';
import { TRENCH_KINDS, trenchKind, trenchCells, trenchAt, trenchCover, trenchPointsUsed, trenchError, applyTrench } from '../src/sim/trenches.ts';
import { applyBuild, buildError, pointsUsed, enemyPlan, BUILD_KINDS_24, stillConnected } from '../src/sim/build.ts';
import { applyMap } from '../src/sim/maps.ts';
import { startEco } from '../src/sim/eco.ts';
import { step, runLog, spotted, firstBlock } from '../src/sim/step.ts';
import { findPath } from '../src/sim/path.ts';
import { SCRIPT, SCRIPT_SEED } from '../src/sim/script.ts';
import { armorPct } from '../src/sim/armor.ts';
const only = process.argv[2]; let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; groups++; fn(); console.log(`OK trenches/${name}`); };
const seeds = [1944, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
const blank = () => { const w = createWorld(1944); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = []; w.winner = -1; return w; };
const cmd = (kind = 0, side = 0, x = 20, z = 20, rot = 0) => ({ t: 'trench', side, kind, x, z, rot });
const add = (w, side, kind, x, z) => { const u = { id: w.units.length + 1, side, kind, x: center(x), z: center(z), hp: 1000000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1000000, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
const building = (w, kind, x = 10, z = 10, hp = 10000) => { const maxHp = bldMaxHp(kind, 1, 1, 1), b = { id: w.blds.length + 1, kind, x, z, w: 1, d: 1, floors: 1, hp, maxHp }; w.blds.push(b); w.occ[idx(x, z)] = b.id; return b; };
const put = (w, kind = 0, x = 10, z = 10, side = 0, rot = 0) => { w.trenches = { version: 1, segments: [{ side, kind, x, z, rot }] }; };
const queue = (w, g, t, kind = SHELL_AP, hitBld = 0) => w.shells.push({ id: w.nextShell++, side: g.side, kind, shooter: g.id, sx: g.x, sz: g.z, ex: t.x, ez: t.z, t: 0, T: 1, target: hitBld ? 0 : t.id, hitBld });
const hit = (w, g, t, kind = SHELL_AP, hitBld = 0) => { const hp = t.hp; queue(w, g, t, kind, hitBld); step(w, []); return hp - t.hp; };
// R036：facing＝R104 的車體面向（穿甲彈打裝甲目標時正／側／背 75／100／125），沒給就是 100（沒有車體方向的目標）
const expected = (gun, target, pct, offset = 0, splash = false, facing = 100) => { const g = UNIT_KINDS[gun], t = UNIT_KINDS[target], falloff = splash ? Math.floor(g.dmgUnit * (g.splash - offset) / g.splash) : Math.floor(g.dmgUnit * facing / 100); return Math.floor(Math.floor(falloff * (t.armored && !(t.openTop && g.men > 0) ? g.pierce : g.soft) / 100) * t.armor * pct / 10000); }; // R044：開頂車被步兵打照軟目標算
const sorted = cells => cells.map(([x, z]) => `${x},${z}`).sort();
// 手寫各方向的相對格；不呼叫受測旋轉來產生答案。
const shapes = [
  [[[0,0],[1,0]], [[0,0],[0,1]], [[0,0],[1,0]], [[0,0],[0,1]]],
  [[[0,0],[1,0],[1,1]], [[1,0],[1,1],[0,1]], [[0,0],[0,1],[1,1]], [[0,0],[0,1],[1,0]]],
  [[[0,0],[1,0],[2,0],[3,0]], [[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[2,0],[3,0]], [[0,0],[0,1],[0,2],[0,3]]],
  [[[0,0],[1,0]], [[0,0],[0,1]], [[0,0],[1,0]], [[0,0],[0,1]]],
];
const costs = [1, 2, 1, 2], covers = [75, 75, 90, 50];

group('templates', () => {
  assert.deepEqual(TRENCH_KINDS.map(k => [k.kind, k.name, k.cost, k.cover, k.cells]), [
    [0, 'straight', 1, 75, [[0,0],[1,0]]], [1, 'bend', 2, 75, [[0,0],[1,0],[1,1]]],
    [2, 'communication', 1, 90, [[0,0],[1,0],[2,0],[3,0]]], [3, 'reinforced', 2, 50, [[0,0],[1,0]]],
  ], 'templates: four published templates and exact costs/cover');
  for (const side of [0, 1]) for (let kind = 0; kind < 4; kind++) for (let rot = 0; rot < 4; rot++) {
    const w = blank(), x = side ? 5 : 20, z = x, c = cmd(kind, side, x, z, rot), cells = shapes[kind][rot].map(([dx, dz]) => [x + dx, z + dz]), before = structuredClone(w);
    assert.deepEqual(sorted(trenchCells(c)), sorted(cells), 'templates: exact quarter-turn footprint including L empty corner');
    assert.equal(trenchError(w, c), null); assert.deepEqual(w, before, 'templates: validation is pure');
    assert.equal(applyTrench(w, c), null); assert.equal(w.rng, before.rng, 'templates: never draws World.rng');
    assert.deepEqual(w.trenches, { version: 1, segments: [{ side, kind, x, z, rot }] }, 'templates: normalized persistent segment');
    assert.equal(trenchPointsUsed(w, side), costs[kind]); assert.equal(pointsUsed(w, side), costs[kind], 'templates: shared point counter includes trenches');
    assert.deepEqual(w.events, [{ e: 'trench' }]);
    for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
      const inside = cells.some(([a, b]) => a === cx && b === cz);
      assert.equal(!!trenchAt(w, cx, cz), inside, 'templates: lookup uses actual cells, never bounding box');
      assert.equal(trenchCover(w, cx, cz), inside ? covers[kind] : 100);
    }
  }
  const a = blank(), b = blank(), c = cmd(); delete c.rot; applyTrench(a, c); applyTrench(b, cmd()); assert.deepEqual(a, b, 'templates: omitted rotation normalizes to zero');
  for (const [x,z] of [[-1,1],[32,0],[0,32],[1.5,0],[NaN,0],[Infinity,0]]) assert.equal(trenchAt(a,x,z), null, 'templates: invalid cell never aliases');
  a.trenches.version = 2; assert.equal(trenchCover(a,20,20),100,'templates: unknown version supplies no cover');
  assert.equal(trenchKind(4),null);
});

group('validation', () => {
  const reject = (c, reason, setup = () => {}) => { const w = blank(); setup(w); const before = structuredClone(w); assert.equal(trenchError(w,c),reason,'validation: precise refusal code'); assert.equal(applyTrench(w,c),reason); assert.deepEqual(w,before,'validation: rejected command leaves complete world unchanged'); };
  for (const v of [-1,2,0.5,NaN,'0',null]) reject({...cmd(),side:v},'side');
  for (const v of [-1,4,0.5,NaN,'0',null]) reject({...cmd(),kind:v},'kind');
  for (const v of [-1,4,0.5,NaN,'0',null]) reject({...cmd(),rot:v},'rot');
  for (const key of ['x','z']) for (const v of [0.5,NaN,Infinity,'20',null]) reject({...cmd(),[key]:v},'coord');
  reject(cmd(),'tick',w=>w.tick=1); reject(cmd(0,0,-1,20),'map'); reject(cmd(2,0,30,30),'map'); reject(cmd(0,0,4,4),'foreign'); reject(cmd(0,0,16,16),'neutral');
  reject(cmd(),'road',w=>w.ter[idx(21,20)]=TER_ROAD); reject(cmd(),'mud',w=>w.ter[idx(21,20)]=TER_MUD);
  reject(cmd(),'occupied',w=>building(w,BK_HOUSE,21,20)); reject(cmd(),'occupied',w=>{const b=building(w,BK_HOUSE,21,20);b.hp=0;});
  reject(cmd(),'occupied',w=>applyTrench(w,cmd(0,0,21,20))); reject(cmd(),'unit',w=>add(w,1,UK_TANK,21,20));
  const dead=blank();add(dead,1,UK_TANK,21,20).alive=false;assert.equal(applyTrench(dead,cmd()),null,'validation: dead unit does not occupy');
  const corner=blank();building(corner,BK_HOUSE,20,21);add(corner,1,UK_TANK,20,21);corner.ter[idx(20,21)]=TER_ROAD;
  assert.equal(applyTrench(corner,cmd(1)),null,'validation: L empty corner may contain road, building and unit');
  const adjacent=blank();assert.equal(applyTrench(adjacent,cmd()),null);assert.equal(applyTrench(adjacent,cmd(3,0,22,20)),null,'validation: adjacent segments connect without a gap');
});

group('vegetation', () => {
  const w=blank();w.vegetation={version:1,cells:new Uint8Array(N*N)};w.vegetation.cells.fill(2);const before=structuredClone(w), preview=structuredClone(w);
  assert.equal(applyTrench(preview,cmd(1)),null); assert.deepEqual(w,before,'vegetation: preview never contaminates real world');
  for(let z=0;z<N;z++)for(let x=0;x<N;x++)assert.equal(preview.vegetation.cells[idx(x,z)],(x===20&&z===20)||(x===21&&(z===20||z===21))?0:2,'vegetation: only actual L cells cleared, empty corner retained');
  assert.equal(preview.rng,w.rng,'vegetation: clearing does not draw RNG');const actual=structuredClone(w);step(actual,[cmd(1)]);step(preview,[]);assert.deepEqual({...actual,events:[]},{...preview,events:[]},'vegetation: preview and formal command have identical persistent result');
  const later=blank();applyTrench(later,cmd(0,0,27,22));applyMap(later,0,1);
  assert.equal(later.vegetation.cells[idx(27,22)],0,'vegetation: late same-map activation cannot regrow inside paid trench');assert.equal(later.vegetation.cells[idx(29,22)],1,'vegetation: late activation preserves surrounding hedge');
});

group('budget_order', () => {
  for(const side of [0,1]) {
    const w=blank(),p=side?3:20;
    for(const [dx,dz] of [[0,0],[3,0],[6,0],[9,0],[0,3],[3,3],[6,3]]) assert.equal(applyBuild(w,{t:'build',side,kind:BK_COTTAGE,x:p+dx,z:p+dz}),null);
    const before=structuredClone(w);assert.equal(applyTrench(w,cmd(3,side,p+9,p+3)),'points','budget_order: buildings consume trench budget');assert.deepEqual(w,before);
    assert.equal(applyTrench(w,cmd(0,side,p+9,p+3)),null);assert.equal(pointsUsed(w,side),8,'budget_order: shared total includes buildings and trenches');assert.equal(trenchPointsUsed(w,side),1);
    const v=blank();for(let i=0;i<4;i++)assert.equal(applyTrench(v,cmd(3,side,p+3*i,p)),null);
    assert.equal(buildError(v,{t:'build',side,kind:BK_COTTAGE,x:p,z:p+3}),'points','budget_order: trenches consume building budget');
  }
  const a=blank(),b=blank(),build={t:'build',side:0,kind:BK_COTTAGE,x:20,z:20},trench=cmd();step(a,[trench,build]);step(b,[build,trench]);
  assert.equal(a.trenches?.segments.length,1,'budget_order: earlier trench wins mixed overlap');assert.equal(a.blds.length,0,'budget_order: later building cannot cover trench');
  assert.equal(b.trenches,undefined,'budget_order: earlier building wins mixed overlap');assert.equal(b.blds.length,1);
  const budget=blank();for(let i=0;i<7;i++)assert.equal(applyTrench(budget,cmd(0,0,18+2*i,20)),null);
  const copy=structuredClone(budget);step(budget,[cmd(0,0,18,23),{...build,x:22,z:23}]);step(copy,[{...build,x:22,z:23},cmd(0,0,18,23)]);
  assert.equal(budget.trenches.segments.length,8,'budget_order: relative command order spends last point');assert.equal(budget.blds.length,0);assert.equal(copy.blds.length,1);assert.equal(copy.trenches.segments.length,7);
  const mapped=createWorld(1944),direct=createWorld(1944),c=cmd(0,1,0,0);step(mapped,[c,{t:'map',id:1,vegetation:1}]);applyMap(direct,1,1);applyTrench(direct,c);step(direct,[]);assert.deepEqual({...mapped,events:[]},{...direct,events:[]},'budget_order: maps precede mixed construction regardless of log order');
  const overlap=blank();applyTrench(overlap,cmd(1));assert.equal(buildError(overlap,{...build,x:21,z:21}),'occupied','budget_order: building cannot overlap actual trench cells');assert.equal(applyBuild(overlap,{...build,x:20,z:21}),null,'budget_order: L empty corner remains usable by building');
});

group('maps_hq', () => {
  const changed=blank();applyTrench(changed,cmd(0,1,3,0));const snapshot=structuredClone(changed);applyMap(changed,1,1);assert.deepEqual(changed,snapshot,'maps_hq: changing base map after successful trench is an atomic rejection');
  for(const map of [0,1])for(const seed of seeds){
    const w=createWorld(seed);applyMap(w,map,1);const rng=w.rng;
    for(const side of [0,1]) {
      const corner=cmd(0,side,side?0:30,side?0:30);assert.equal(applyTrench(w,corner),null);
      for(const kind of [1,2,3,0,0]) {
        let placed=false;for(let z=0;z<N&&!placed;z++)for(let x=0;x<N&&!placed;x++){const c=cmd(kind,side,x,z);if(trenchError(w,c)===null){applyTrench(w,c);placed=true;}}
        assert(placed,'maps_hq: all templates fit each map/seed/side');
      }
      assert.equal(pointsUsed(w,side),8,'maps_hq: maximal network uses exactly eight points');
    }
    const before=structuredClone(w);applyMap(w,map,1);assert.deepEqual(w,before,'maps_hq: repeated same-map activation is idempotent');applyMap(w,1-map,1);assert.deepEqual(w,before,'maps_hq: incompatible map cannot alter complete paid layout');
    startEco(w);assert(w.eco.hq.every(Boolean),'maps_hq: both headquarters survive maximal networks');assert.equal(w.rng,rng);
    for(const id of w.eco.hq){const b=w.blds[id-1];assert.equal(b.kind,BK_HQ);for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++)assert.equal(trenchAt(w,x,z),null,'maps_hq: headquarters never cover paid trench cells');}
    assert(stillConnected(w,-9,-9,0,0),'maps_hq: all units remain connected');
  }
  const legacy=createWorld(1944);applyMap(legacy,0,1);applyMap(legacy,1,1);const fresh=createWorld(1944);applyMap(fresh,1,1);assert.deepEqual(legacy,fresh,'maps_hq: no-trench map switching keeps original behavior');
  console.log('  24 map/seed pairs, 48 maximal networks, 48 HQs');
});

group('cover', () => {
  let cases=0;
  for(const side of [0,1])for(let kind=0;kind<4;kind++)for(let target=0;target<UNIT_KINDS.length;target++)for(const [gun,shell] of [[UK_TANK,SHELL_AP],[UK_HOWITZER,SHELL_HE],[UK_INFANTRY,SHELL_SMALL],[UK_ATGUN,SHELL_AP],[UK_MORTAR,SHELL_HE]])for(const other of ['none','crater','vegetation','house','pillbox']){
    const w=blank(),g=add(w,1-side,gun,3,3),t=add(w,side,target,10,10);put(w,kind,10,10,1-side);let pct=covers[kind];
    if(other==='crater'){w.crater[idx(10,10)]=3;pct=Math.min(pct,75);}
    if(other==='vegetation'){w.vegetation={version:1,cells:new Uint8Array(N*N)};w.vegetation.cells[idx(10,10)]=2;pct=50;}
    if(other==='house'||other==='pillbox'){building(w,other==='house'?BK_HOUSE:BK_PILLBOX);if(UNIT_KINDS[target].garrison)pct=Math.min(pct,other==='house'?50:25);}
    assert.equal(hit(w,g,t,shell),expected(gun,target,pct),'cover: all sides/types/projectiles use strongest protection without stacking');cases++;
  }
  console.log(`  ${cases} side/template/unit/projectile/cover combinations`);
});

group('rounding', () => {
  let cases=0,distinguishes=0;
  for(const gun of [UK_HOWITZER,UK_MORTAR])for(let kind=0;kind<4;kind++)for(let target=0;target<UNIT_KINDS.length;target++)for(const offset of (target===UK_HEAVY?Array.from({length:UNIT_KINDS[gun].splash},(_,i)=>i):[0,1,31,127,255,UNIT_KINDS[gun].splash-1])){
    const w=blank(),g=add(w,1,gun,3,3),t=add(w,0,target,10,10);t.x+=offset;put(w,kind,cellOf(t.x),10);queue(w,g,t,SHELL_HE);w.shells.at(-1).ex=center(10);const hp=t.hp;step(w,[]);
    const want=expected(gun,target,covers[kind],offset,true);assert.equal(hp-t.hp,want,'rounding: falloff then piercing then combined armor/cover floor');
    const k=UNIT_KINDS[gun],v=UNIT_KINDS[target],raw=Math.floor(Math.floor(k.dmgUnit*(k.splash-offset)/k.splash)*(v.armored?k.pierce:k.soft)/100);if(want!==Math.floor(Math.floor(raw*v.armor/100)*covers[kind]/100))distinguishes++;cases++;
  }
  assert(distinguishes>0,'rounding: fixtures distinguish early armor rounding');console.log(`  ${cases} blast-distance cases; ${distinguishes} distinguish early rounding`);
});

group('exceptions', () => {
  for(let kind=0;kind<4;kind++)for(const bkind of [BK_HOUSE,BK_PILLBOX]){
    const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_OBSERVER,10,10),b=building(w,bkind,10,10,1);put(w,kind);w.crater[idx(10,10)]=3;w.vegetation={version:1,cells:new Uint8Array(N*N)};w.vegetation.cells[idx(10,10)]=2;
    assert.equal(hit(w,g,t,SHELL_AP,b.id),Math.floor(20*UNIT_KINDS[UK_OBSERVER].armor/100),'exceptions: collapse bypasses trench and every ground protection');assert.equal(b.hp,0);
  }
  for(let kind=0;kind<4;kind++)for(const [gun,shell] of [[UK_TANK,SHELL_AP],[UK_HOWITZER,SHELL_HE]])for(const bkind of [BK_HOUSE,BK_PILLBOX]){
    const w=blank(),g=add(w,1,gun,3,3),t=add(w,0,UK_OBSERVER,10,10),b=building(w,bkind);put(w,kind);hit(w,g,t,shell,shell===SHELL_AP?b.id:0);
    assert.equal(b.hp,10000-(bkind===BK_PILLBOX&&shell===SHELL_AP?UNIT_KINDS[gun].dmgBld>>2:UNIT_KINDS[gun].dmgBld),'exceptions: trench does not reduce building damage');
  }
  const w=blank(),g=add(w,1,UK_HOWITZER,3,3),t=add(w,0,UK_TANK,10,10);put(w,3);const trenches=structuredClone(w.trenches);assert.equal(hit(w,g,t,SHELL_SMOKE),0,'exceptions: smoke never damages');assert.equal(w.crater[idx(10,10)],0);assert.deepEqual(w.trenches,trenches);assert(w.smoke?.clouds.length);
});

group('cells_movement', () => {
  const positions=[[10*SUB-1,center(10),false],[10*SUB,center(10),true],[center(10),10*SUB-1,false],[center(10),10*SUB,true],[12*SUB-1,center(10),true],[12*SUB,center(10),false],[center(10),11*SUB-1,true],[center(10),11*SUB,false]];
  for(const [x,z,inside] of positions){const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_TANK,10,10);t.x=x;t.z=z;put(w,3);assert.equal(hit(w,g,t),expected(UK_TANK,UK_TANK,inside?50:100),'cells_movement: hit uses current integer cell boundary');}
  for(const [x,z] of [[0,0],[30,0],[0,31],[30,31]]){const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,UK_TANK,x,z);put(w,3,x,z);assert.equal(hit(w,g,t),expected(UK_TANK,UK_TANK,50),'cells_movement: edge footprint does not wrap');}
  for(const kind of [UK_TANK,UK_HOWITZER,UK_OBSERVER]){
    const w=blank(),g=add(w,1,UK_TANK,3,3),t=add(w,0,kind,9,10);put(w,3);step(w,[{t:'move',side:0,ids:[t.id],x:12,z:10}]);const cells=new Set();
    for(let tick=0;tick<Math.ceil(5*SUB*100/(UNIT_KINDS[kind].speed*85))+20;tick++){const hp=t.hp;queue(w,g,t);step(w,[]);const x=cellOf(t.x);cells.add(x);assert.equal(hp-t.hp,expected(UK_TANK,kind,(x===10||x===11)?50:100,0,false,UNIT_KINDS[kind].armored?armorPct(t,g.x,g.z):100),'cells_movement: cover follows movement with no sticky flag');if(x===12&&t.pathIdx>=t.path.length)break;}
    assert([9,10,11,12].every(x=>cells.has(x)),'cells_movement: vehicle/gun/observer actually enter and leave trench');
  }
});

group('passability', () => {
  const w=blank();add(w,0,UK_OBSERVER,8,10);add(w,1,UK_TANK,14,10);const old=structuredClone(w);put(w,1);
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){assert.equal(blocks(w,x,z),blocks(old,x,z),'passability: trench never blocks a cell');assert.equal(speedPct(w,x,z),speedPct(old,x,z),'passability: trench never alters speed');}
  for(const [x,z,a,b] of [[8,10,14,10],[10,8,10,14],[9,9,12,12],[0,0,31,31]]){
    assert.deepEqual(findPath(w,x,z,a,b),findPath(old,x,z,a,b),'passability: unchanged A-star route');assert.equal(firstBlock(w,center(x),center(z),center(a),center(b)),firstBlock(old,center(x),center(z),center(a),center(b)),'passability: unchanged physical projectile block');
    for(const side of [0,1])assert.equal(spotted(w,side,center(a),center(b)),spotted(old,side,center(a),center(b)),'passability: unchanged sight with identical vegetation');
  }
});

group('replay_hash', () => {
  for(const map of [0,1]){
    const setup=createWorld(1944);applyMap(setup,map,1);const plan=[];
    for(const c of [cmd(1,0,28,30,3),cmd(3,1,0,0),{t:'build',side:0,kind:BK_COTTAGE,x:22,z:30}]){const err=c.t==='trench'?applyTrench(setup,c):applyBuild(setup,c);assert.equal(err,null,'replay_hash: mixed fixtures are legal');plan.push(c);}
    const enemy=enemyPlan(setup,BUILD_KINDS_24),log=[{tick:0,cmd:{t:'map',id:map,vegetation:1}},...plan.map(cmd=>({tick:0,cmd})),...enemy.map(cmd=>({tick:0,cmd})),{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}},...SCRIPT];
    const a=runLog(createWorld(1944),log,1200),b=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),1200),half=runLog(createWorld(1944),log,600),copy=structuredClone(half);runLog(half,log,1200);runLog(copy,log,1200);
    for(const v of [b,half,copy])assert.deepEqual(v,a,'replay_hash: mixed JSON and middle clone reproduce entire world');
    const before=hashWorld(a);for(const mutate of [w=>w.trenches.version++,w=>w.trenches.segments[0].side^=1,w=>w.trenches.segments[0].kind++,w=>w.trenches.segments[0].x++,w=>w.trenches.segments[0].z++,w=>w.trenches.segments[0].rot^=1,w=>w.trenches.segments.push({...w.trenches.segments[0]}),w=>w.trenches.segments.reverse(),w=>{delete w.trenches;}]){const v=structuredClone(a);mutate(v);assert.notEqual(hashWorld(v),before,'replay_hash: every persistent trench field, order and presence affects hash');}
    console.log(`  mixed map${map} 1200 hash ${before}`);
  }
  const a=blank(),before=hashWorld(a);a.trenches={version:1,segments:[]};assert.notEqual(hashWorld(a),before,'replay_hash: empty versioned state is also hashed');
});

// Frozen by evaluating repository 3654fb2, independently of this working tree.
// R036：R104 裝甲面向合入後（坦克多了車體方向、穿甲彈分正側背）重新凍結，數字是合入後實際算出來的。
group('legacy', () => {
  const fixtures=[['script',SCRIPT,'2e4bcf04bc6870f8f4f3fd9a2049b7273e24797dcdc638d3c37093eb1ff53254',['d7b3572f','eea1d59b']],['rye',[{tick:0,cmd:{t:'map',id:1}},...SCRIPT],'475b3ca00a36bd18248d5eb1f6c843e8fdb0b9606cd95cd01de89befdd4b9c1f',['0a324ceb','204c47a5']]];
  const baseline = [
    [0,'cee6f177fcd3d6476f1c6984ee1053239223e9d47235f716337290c51d042f53',['dde837f9','7f983268'],[{t:'build',side:1,kind:0,x:9,z:9,rot:1},{t:'build',side:1,kind:2,x:11,z:8,rot:0},{t:'build',side:1,kind:1,x:8,z:7,rot:0},{t:'build',side:1,kind:0,x:10,z:12,rot:1}]],
    [1,'e9cbe636cfe4c738d4bf200a77f750ca28ab4c97cefa76b7c13e06f6c9221c49',['4fe0da65','00a7d63e'],[{t:'build',side:1,kind:0,x:8,z:7,rot:1},{t:'build',side:1,kind:2,x:9,z:12,rot:0},{t:'build',side:1,kind:1,x:6,z:9,rot:0},{t:'build',side:1,kind:0,x:10,z:5,rot:1}]],
  ];
  for(const [map,digest,hashes,plan] of baseline){const w=createWorld(SCRIPT_SEED);applyMap(w,map,1);assert.deepEqual(enemyPlan(w,BUILD_KINDS_24),plan,'legacy: original pure-building enemy strategy and table unchanged');fixtures.push([`vegetation-build-eco-map${map}`,[{tick:0,cmd:{t:'map',id:map,vegetation:1}},...plan.map(cmd=>({tick:0,cmd})),{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}},...SCRIPT],digest,hashes]);}
  assert.equal(hashWorld(createWorld(SCRIPT_SEED)),'62e00ebe','legacy: original initial SCRIPT hash');
  for(const [name,input,digestWanted,hashes] of fixtures){const w=createWorld(SCRIPT_SEED),digest=createHash('sha256'),log=JSON.parse(JSON.stringify(input));assert.equal(w.trenches,undefined,'legacy: createWorld has no trench state');for(let tick=0;tick<1200;tick++){step(w,log.filter(c=>c.tick===tick).map(c=>c.cmd));digest.update(`${hashWorld(w)}:${w.rng};`);assert.equal(w.trenches,undefined,'legacy: old commands never create trench state');if(w.tick===600||w.tick===1200)assert.equal(hashWorld(w),hashes[w.tick===600?0:1],'legacy: original SCRIPT checkpoints');}assert.equal(digest.digest('hex'),digestWanted,`legacy: ${name} every-tick main3654fb2 hash/RNG fingerprint`);}
});
assert(groups>0,`unknown group ${only}`);console.log(`trenches: ${groups} groups passed`);
