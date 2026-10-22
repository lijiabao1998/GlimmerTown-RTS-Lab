import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK, UK_HOWITZER, UK_INFANTRY, N, SUB, center } from '../src/sim/world.ts';
import { createSandboxWorld, SANDBOX_CAP, sandboxPlaceError } from '../src/sim/sandbox.ts';
import { step, applyCommand, runLog, commandTick } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';

const P = (side, kind, x, z) => ({ t: 'sandboxPlace', side, kind, x, z });
const R = running => ({ t: 'sandboxRun', running });
const core = w => { const c = structuredClone(w); c.events = []; if (c.sandbox) c.sandbox.frame = 0; return c; };
const candidates = w => { const cells=[]; for(let z=0;z<N;z++)for(let x=0;x<N;x++)if(!w.occ[z*N+x])cells.push([x,z]);return cells; };
export const sandboxLog = [
  {tick:0,cmd:P(0,UK_TANK,24,26)}, {tick:0,cmd:P(1,UK_TANK,26,26)}, {tick:0,cmd:P(0,UK_HOWITZER,29,29)},
  {tick:1,cmd:{t:'fireAt',side:0,ids:[3],x:12,z:12,ammo:'smoke'}}, {tick:1,cmd:R(true)},
  {tick:45,cmd:R(false)}, {tick:46,cmd:P(1,UK_HOWITZER,2,2)}, {tick:47,cmd:R(true)},
  {tick:95,cmd:{t:'sandboxReset'}}, {tick:96,cmd:P(0,UK_TANK,24,26)}, {tick:97,cmd:R(true)}, {tick:130,cmd:R(false)},
];

const cases = {
  activation() {
    const w=createSandboxWorld(1944), normal=createWorld(1944);
    assert.equal(w.n,32,'activation: existing 32 map');
    assert.deepEqual(w.ter,normal.ter,'activation: same terrain'); assert.deepEqual(w.blds,normal.blds,'activation: same village');
    assert.equal(w.units.length,0,'activation: empty army'); assert.equal(w.tick,0,'activation: zero battle time');
    assert.deepEqual(w.sandbox,{version:1,running:false,frame:0},'activation: paused explicit world');
    assert.equal(w.eco,undefined,'activation: no economy'); assert.equal(w.ai,undefined,'activation: no AI');
    for(const cmd of [P(0,0,24,26),R(true),{t:'sandboxReset'}]) {
      const a=createWorld(1944), b=structuredClone(a);
      applyCommand(a,cmd); assert.deepEqual(a,b,'activation: ordinary world rejects new command');
      step(a,[cmd]);step(b,[]);assert.deepEqual(a,b,'activation: ordinary step rejects new command');
    }
    const before=core(w);
    step(w,[{t:'map',id:1},{t:'ai',side:1,level:3},{t:'eco',inf:1},{t:'produce',side:0,kind:0},{t:'build',side:0,kind:1,x:24,z:24},{t:'trench',side:0,kind:0,x:24,z:24}]);
    assert.deepEqual(core(w),before,'activation: sandbox rejects setup and economy commands');
    assert.equal(hashWorld(runScript()),'eea1d59b','legacy: original golden hash');
  },
  placement() {
    const w=createSandboxWorld(1944), commands=[P(0,UK_TANK,24,26),P(1,UK_TANK,26,24),P(0,UK_HOWITZER,29,29),P(1,UK_HOWITZER,2,2)];
    step(w,commands);
    assert.equal(w.tick,0,'placement: no battle tick');assert.equal(commandTick(w),1,'placement: one command frame');
    assert.equal(w.units.length,4,'placement: both sides and both kinds');
    for(const[i,c]of commands.entries()){
      const u=w.units[i],k=UNIT_KINDS[c.kind];
      assert.deepEqual([u.id,u.side,u.kind,u.x,u.z,u.hp,u.cooldown,u.alive],[i+1,c.side,c.kind,center(c.x),center(c.z),k.hp,0,true],'placement: independent unit values');
    }
    const building=w.blds.find(b=>b.hp>0);
    const rejects=[P(2,0,23,23),P(0,UK_INFANTRY,23,23),P(0,99,23,23),P(0,0,-1,23),P(0,0,32,23),P(0,0,23,32),P(0,0,23,-1),P(0,0,NaN,23),P(0,0,23,Infinity),P(0,0,23.5,23),P(0,0,23,23.5),P(0,0,building.x,building.z),commands[0]];
    for(const c of rejects){const before=core(w),hash=hashWorld(w);assert(sandboxPlaceError(w,c),'placement: invalid input has reason');assert.equal(hashWorld(w),hash,'placement: check is read only');step(w,[c]);assert.deepEqual(core(w),before,'placement: invalid input rejected without effects');}
    // 車輛正在跨格時，鄰格的中心也可能重疊。
    w.units[0].x=center(23)+SUB/3;w.units[0].z=center(23);
    const c=P(1,0,23,23);assert.equal(sandboxPlaceError(w,c),'unit','placement: partial overlap rejected');
  },
  capacity() {
    assert.equal(SANDBOX_CAP,32,'capacity: explicit fixed limit');
    const w=createSandboxWorld(1944),cells=candidates(w);
    for(const[x,z]of cells){if(w.units.length===32)break;step(w,[P(w.units.length%2,w.units.length%2,x,z)]);}
    assert.equal(w.units.length,32,'capacity: 32 accepted');
    const before=core(w);step(w,[P(0,0,29,29)]);assert.deepEqual(core(w),before,'capacity: 33rd rejected');
    w.units[0].alive=false;w.units[0].hp=0;
    assert.equal(sandboxPlaceError(w,P(0,0,29,29)),'capacity','capacity: wreck counts');
    step(w,[{t:'sandboxReset'}]);assert.equal(w.units.length,0,'capacity: reset releases slots');
    step(w,[P(0,0,24,26)]);assert.equal(w.units[0].id,1,'capacity: fresh IDs after reset');
  },
  pause() {
    const w=createSandboxWorld(1944);
    step(w,[P(0,0,24,26),P(1,0,26,26),P(0,1,29,29)]);
    assert.equal(w.tick,0,'pause: setup does not run combat');
    step(w,[R(true),{t:'fireAt',side:0,ids:[3],x:12,z:12,ammo:'smoke'}]);
    assert.equal(w.tick,1,'pause: start advances one battle tick');
    assert(w.shells.length>0,'pause: real combat shells exist');assert(w.units.some(u=>u.cooldown>0),'pause: real reload exists');
    w.smoke={windX:1,windZ:0,clouds:[{id:999,side:0,x:1000,z:1000,born:0,expires:3}]};
    w.counterbattery=[{side:0,zone:0,cell:0,shots:1,last:0}];
    step(w,[R(false),{t:'move',side:0,ids:[1],x:23,z:26}]);
    const frozen=core(w),frame=commandTick(w),tick=w.tick;
    for(let i=0;i<80;i++)step(w,[]);
    assert.deepEqual(core(w),frozen,'pause: combat state fully frozen');assert.equal(w.tick,tick,'pause: combat clock frozen');assert.equal(commandTick(w),frame+80,'pause: command clock monotonic');
    step(w,[P(1,1,2,2)]);assert.equal(w.units.length,4,'pause: edit accepted');
    assert.deepEqual(w.units.slice(0,3),frozen.units,'pause: editing leaves existing units frozen');assert.deepEqual(w.shells,frozen.shells,'pause: editing leaves shells frozen');assert.deepEqual(w.smoke,frozen.smoke,'pause: editing leaves smoke frozen');
    step(w,[R(true)]);assert.equal(w.tick,tick+1,'pause: resume one tick only');assert.notDeepEqual(w.units.slice(0,3),frozen.units,'pause: resume runs combat');
    const solo=createSandboxWorld(7);step(solo,[P(0,0,24,26),R(true)]);for(let i=0;i<10;i++)step(solo,[]);assert.equal(solo.winner,-1,'pause: no forced victory');
  },
  reset() {
    const w=runLog(createSandboxWorld(1944),sandboxLog,90),frame=commandTick(w);
    w.crater[0]=3;w.units[0].hp=1;w.smoke={windX:1,windZ:0,clouds:[]};
    step(w,[{t:'sandboxReset'}]);
    assert.deepEqual(core(w),core(createSandboxWorld(1944)),'reset: entire same seed world restored');
    assert.equal(commandTick(w),frame+1,'reset: command frame retained');assert.equal(w.tick,0,'reset: battle clock cleared');
    step(w,[P(0,0,24,26),{t:'sandboxReset'},P(1,1,2,2)]);
    assert.deepEqual(w.units.map(u=>[u.id,u.side,u.kind]),[[1,1,1]],'reset: command order respected');
  },
  replay() {
    for(const seed of [0,7,1944,2026]){
      const json=JSON.parse(JSON.stringify(sandboxLog)),w=createSandboxWorld(seed);
      let saved,prefixWorld;
      for(let frame=0;frame<200;frame++){step(w,json.filter(c=>c.tick===frame).map(c=>c.cmd));if(frame===61)saved=structuredClone(w);if(frame===89)prefixWorld=structuredClone(w);}
      assert.equal(w.tick,33,'replay: battle time excludes pause and reset');assert.equal(commandTick(w),200,'replay: log timeline includes paused edits');
      assert.deepEqual(runLog(structuredClone(saved),json,90),prefixWorld,'replay: deep clone continuation before reset');
      const replay=runLog(createSandboxWorld(seed),json,200),copy=runLog(saved,json,200);
      assert.deepEqual(replay,w,'replay: JSON command roundtrip');assert.deepEqual(copy,w,'replay: deep clone continuation');
      assert.equal(hashWorld(copy),hashWorld(w),'replay: clone hash parity');assert.equal(hashWorld(replay),hashWorld(w),'replay: replay hash parity');
    }
    const w=createSandboxWorld(1944),hash=hashWorld(w);
    for(const[key,value]of [['version',2],['frame',1],['running',true]]){const c=structuredClone(w);c.sandbox[key]=value;assert.notEqual(hashWorld(c),hash,'replay: every sandbox field hashed');}
    const normal=structuredClone(w);delete normal.sandbox;assert.notEqual(hashWorld(normal),hash,'replay: mode identity hashed');
  },
};
if(!process.env.R128_IMPORT_ONLY)for(const[name,run]of Object.entries(cases))if(!process.argv[2]||process.argv[2]===name){run();console.log('OK sandbox/'+name);}
