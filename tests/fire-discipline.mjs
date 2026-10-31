import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorld, hashWorld, UNIT_KINDS, center } from '../src/sim/world.ts';
import { step, runLog, applyCommand } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
import { fireDisciplineState } from '../src/ui/fireDiscipline.ts';
const hold = (ids=[1], value=true) => ({t:'fireDiscipline',side:0,ids,hold:value});
function fixture(kind=0) {
 const w=createWorld(1944); w.blds=[]; w.occ.fill(0); delete w.ai;
 const base=structuredClone(w.units[0]);
 w.units=[{...base,id:1,kind,side:0,x:center(4),z:center(4),hp:10000,path:[],pathIdx:0,cooldown:0},
 {...structuredClone(base),id:2,kind:0,side:1,x:center(12),z:center(4),hp:10000,path:[],pathIdx:0,cooldown:10000}];
 w.winner=-1; return w;
}
function combatChecks(advance) {
 const w=fixture(); advance(w,[hold()]);
 assert.equal(w.units[0].holdFire,1);
 assert.equal(w.events.filter(e=>e.e==='fire'&&e.unit===1).length,0,'hold prevents fresh shell');
 for(let i=0;i<10;i++) advance(w,[]);
 assert.equal(w.nextShell,1,'held unit never fired');
 advance(w,[hold([1],false)]);
 assert.ok(w.events.some(e=>e.e==='fire'&&e.unit===1),'release resumes auto fire');
 const hp=w.units[1].hp;
 advance(w,[hold()]);
 for(let i=0;i<15;i++)advance(w,[]);
 assert.ok(w.units[1].hp<hp,'already airborne round still lands');
 assert.ok(w.units[0].cooldown<UNIT_KINDS[0].reload,'reload continues while held');
 const x=w.units[0].x;
 advance(w,[{t:'move',side:0,ids:[1],x:5,z:4}]);
 assert.notEqual(w.units[0].x,x,'held vehicle can move');
 for(const cmd of [{t:'stop',side:0,ids:[1]},{t:'attack',side:0,ids:[1],target:2},{t:'fireAt',side:0,ids:[1],x:12,z:4}]) {advance(w,[cmd]);assert.equal(w.units[0].holdFire,1,'other orders do not release');}
}
combatChecks(step);
for(let kind=0;kind<UNIT_KINDS.length;kind++)for(const side of [0,1]){
 const w=fixture(kind);w.units[0].side=side;
 const allowed=side===0&&![2,3,11].includes(kind);
 applyCommand(w,{...hold([1,1,0,-1,999]),side});
 assert.equal(w.units[0].holdFire,allowed?1:undefined,`kind ${kind} side ${side}`);
 const before=hashWorld(w);const clone=structuredClone(w);delete clone.units[0].holdFire;
 if(allowed)assert.notEqual(before,hashWorld(clone),'state folded into hash');
 applyCommand(w,{...hold([1],false),side});assert.equal(hashWorld(w),hashWorld(clone),'release restores absent field');
 w.units[0].alive=false; applyCommand(w,{...hold(),side});assert.equal(w.units[0].holdFire,undefined);
}
const w=fixture();const before=JSON.stringify(w);
assert.deepEqual(fireDisciplineState(w,[1,1,2,999]),{ids:[1],held:0,hold:true});
assert.deepEqual(fireDisciplineState(w,[1],[hold()]),{ids:[1],held:1,hold:false});
assert.deepEqual(fireDisciplineState(w,[1],[hold(),hold([1],false)]),{ids:[1],held:0,hold:true});
assert.equal(JSON.stringify(w),before,'UI is readonly');
const log=[{tick:0,cmd:hold([1,2,3])},{tick:10,cmd:{t:'move',side:0,ids:[1],x:8,z:10}},{tick:70,cmd:hold([1,2,3],false)}];
assert.equal(hashWorld(runLog(createWorld(1944),log,130)),hashWorld(runLog(createWorld(1944),JSON.parse(JSON.stringify(log)),130)));
const mid=runLog(createWorld(1944),log,40), copy=structuredClone(mid);
for(let t=40;t<130;t++){const cmds=log.filter(x=>x.tick===t).map(x=>x.cmd);step(mid,cmds);step(copy,cmds);}
assert.equal(hashWorld(mid),hashWorld(copy));
assert.equal(hashWorld(mid),hashWorld(runLog(createWorld(1944),log,130)));
assert.equal(hashWorld(runScript()),'eea1d59b');
// Real behavioral mutation, isolated source tree; never edits production files.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r143-negative-'));
try {
 fs.cpSync(new URL('../src/sim/',import.meta.url),tmp,{recursive:true});
 const file=path.join(tmp,'step.ts'),src=fs.readFileSync(file,'utf8');
 const gate='if (u.holdFire === 1 && fireDisciplineEligible(u)) { if (k.indirect) syncRanging(w, u, null); return; }';
 assert.ok(src.includes(gate)); fs.writeFileSync(file,src.replace(gate,''));
 const broken=await import(pathToFileURL(file));
 assert.throws(()=>combatChecks(broken.step),/hold prevents fresh shell|held unit never fired/);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('OK R143: 82 side/kind cases, firing/release, in-flight damage, movement/reload, command persistence, UI queue, replay/clone/hash, real missing-gate negative');
