import assert from 'node:assert/strict';
import { createWorld, hashWorld, UNIT_KINDS, UK_HOWITZER, SUB, center } from '../src/sim/world.ts';
import { step, runLog, FIRE_AT_ROUNDS } from '../src/sim/step.ts';
import { randSym } from '../src/sim/rng.ts';
const SHOT_DISTANCE = Math.floor((UNIT_KINDS[UK_HOWITZER].minRange + UNIT_KINDS[UK_HOWITZER].range) / (2 * SUB)) * SUB;
const TARGET_X = 2 + SHOT_DISTANCE / SUB;
const HOLD = UNIT_KINDS[UK_HOWITZER].reload * 100;
const setup = (visible = true) => {
 const w=createWorld(1944);w.blds=[];w.occ.fill(0);w.ter.fill(0);w.shells=[];w.winner=-1;
 for(const u of w.units){u.alive=false;u.cooldown=HOLD;}
 const gun=w.units[3];gun.alive=true;gun.x=center(2);gun.z=center(2);gun.cooldown=0;
 if(visible){const o=w.units[8];o.alive=true;o.x=center(TARGET_X-2);o.z=center(2);}
 return {w,gun};
};
const fire={t:'fireAt',side:0,ids:[4],x:TARGET_X,z:2};
const landOnly=w=>{for(const u of w.units)u.cooldown=HOLD;while(w.shells.length)step(w,[]);};
const shot=(w,gun,seen)=>{
 const before={rng:w.rng},r=Math.max(1,Math.floor(Math.floor(SHOT_DISTANCE/12)/(2**seen)));
 const ex=center(TARGET_X)+randSym(before,r),ez=center(2)+randSym(before,r);
 gun.cooldown=0;step(w,[fire]);
 const shell=w.shells.at(-1);assert(shell);assert.equal(shell.ex,ex,'observed rounds halve x dispersion');assert.equal(shell.ez,ez,'observed rounds halve z dispersion');return shell;
};
{
 const {w,gun}=setup();shot(w,gun,0);assert.equal(gun.ranging.seen,0,'in-flight shots grant nothing');
 landOnly(w);assert.equal(gun.ranging.seen,1,'visible impact is credited');
 shot(w,gun,1);landOnly(w);assert.equal(gun.ranging.seen,2);shot(w,gun,2);
 assert.equal(w.units[0].ranging,undefined,'tank has no ranging state');
}
{
 const {w,gun}=setup(false);step(w,[fire]);landOnly(w);assert.equal(gun.ranging.seen,0,'unseen impacts do not calibrate');
}
{
 const {w,gun}=setup();shot(w,gun,0);landOnly(w);assert.equal(gun.ranging.seen,1);
 gun.x+=1;gun.cooldown=HOLD;step(w,[]);assert.equal(gun.ranging.seen,0,'gun movement resets');
}
{
 const {w,gun}=setup();shot(w,gun,0);const epoch=gun.ranging.epoch;
 step(w,[{...fire,x:TARGET_X+1}]);assert(gun.ranging.epoch>epoch,'new area changes generation');landOnly(w);assert.equal(gun.ranging.seen,0,'old in-flight shot cannot calibrate new area');
}
{
 const {w,gun}=setup();const t=w.units[4];t.alive=true;t.hp=10000;t.x=center(TARGET_X);t.z=center(2);
 step(w,[{t:'attack',side:0,ids:[4],target:5}]);landOnly(w);assert.equal(gun.ranging.seen,1);
 t.x+=1;step(w,[]);assert.equal(gun.ranging.seen,0,'target movement resets');
}
{
 const {w,gun}=setup();shot(w,gun,0);w.units[8].alive=false;landOnly(w);assert.equal(gun.ranging.seen,0,'visibility checked at impact, not launch');
}
{
 const {w,gun}=setup();shot(w,gun,0);landOnly(w);
 const other=w.units[7];other.alive=true;other.side=0;other.x=gun.x;other.z=gun.z;other.cooldown=0;
 step(w,[{...fire,ids:[8]}]);assert.equal(other.ranging.seen,0,'guns keep independent calibration');
 const original=hashWorld(w);
 for(const field of ['x','z','ax','az','target','epoch','seen']){const c=structuredClone(w);c.units[3].ranging[field]++;assert.notEqual(hashWorld(c),original,`hash includes ${field}`);}
 const c=structuredClone(w);c.shells[0].rangingEpoch++;assert.notEqual(hashWorld(c),original,'hash includes shell generation');
}
{
 const log=[{tick:0,cmd:fire},{tick:200,cmd:fire},{tick:300,cmd:{t:'move',side:0,ids:[4],x:28,z:28}}];
 const a=runLog(createWorld(1944),log,500),b=runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),500);
 assert.equal(hashWorld(a),hashWorld(b));const c=runLog(createWorld(1944),log,180),d=structuredClone(c);runLog(c,log,500);runLog(d,log,500);assert.equal(hashWorld(a),hashWorld(c));assert.equal(hashWorld(a),hashWorld(d));
}


{
 const {w,gun}=setup();step(w,[fire]);
 for(let i=0;i<UNIT_KINDS[UK_HOWITZER].reload*FIRE_AT_ROUNDS;i++)step(w,[]);
 assert.equal(gun.ranging.seen,FIRE_AT_ROUNDS,'completed volley preserves all four observed impacts');
 shot(w,gun,FIRE_AT_ROUNDS);landOnly(w);assert.equal(gun.ranging.seen,FIRE_AT_ROUNDS+1,'repeat same-area volley preserves calibration');
 step(w,[{t:'stop',side:0,ids:[4]}]);assert.equal(gun.ranging.seen,FIRE_AT_ROUNDS+1,'stop without movement preserves calibration');
 gun.x+=1;step(w,[]);assert.equal(gun.ranging.seen,0,'idle movement invalidates calibration');
}

console.log('ranging: 9 groups passed, including natural four-round volley and same-area restart');
