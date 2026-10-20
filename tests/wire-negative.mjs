import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),temp=mkdtempSync(join(tmpdir(),'r121-negative-'));
const mutants=[
 ['hp','placement','world.ts','if (kind === BK_WIRE) return 60;','if (kind === BK_WIRE) return 90;','placement: independent dimensions and HP'],
 ['cost','placement','build.ts',"name: 'wire', kind: BK_WIRE, w: 2, d: 1, floors: 1, cost: 1","name: 'wire', kind: BK_WIRE, w: 2, d: 1, floors: 1, cost: 2",'placement: shared one point'],
 ['foot','paths','world.ts','return onFoot(kind) &&','return false && onFoot(kind) &&','paths: infantry detour vehicles cross'],
 ['cars','paths','world.ts','return onFoot(kind) &&','return (onFoot(kind) || kind === UK_TANK) &&','paths: infantry detour vehicles cross'],
 ['corridor','connectivity','build.ts','k.kind === BK_WIRE || w.wires?.segments.length','false','connectivity: cannot seal foot corridor'],
 ['attack-path','orders','step.ts','cellOf(t.x), cellOf(t.z), 0, 0, u.kind)','cellOf(t.x), cellOf(t.z))','orders: command path avoids wire'],
 ['fire-path','orders','step.ts','gx, gz, 0, 0, u.kind)','gx, gz)','orders: command path avoids wire'],
 ['tracking-path','orders','step.ts','cellOf(u.tx), cellOf(u.tz), 0, 0, u.kind)','cellOf(u.tx), cellOf(u.tz))','orders: timed tracking refresh avoids wire'],
 ['damage','combat','step.ts','b.hp = Math.max(0, b.hp - k.dmgBld);','b.hp = Math.max(0, b.hp - 1);','combat: actual HE damage destroys wire'],
 ['event','combat','step.ts',"w.events.push({ e: 'wire' });","void 0;",'combat: destruction refresh event'],
 ['hash','replay','world.ts','f.int(s.id).int(s.kind).int(s.x)','f.int(s.id).int(s.x)','replay: every persistent wire field hashed'],
];
try{for(const[name,group,file,from,to,wanted]of mutants){const dir=join(temp,name);mkdirSync(join(dir,'tests'),{recursive:true});cpSync(join(root,'src/sim'),join(dir,'src/sim'),{recursive:true});cpSync(join(root,'tests/wire.mjs'),join(dir,'tests/wire.mjs'));writeFileSync(join(dir,'package.json'),'{"type":"module"}');const p=join(dir,'src/sim',file),s=readFileSync(p,'utf8');assert.equal(s.split(from).length,2,name+': unique anchor');writeFileSync(p,s.replace(from,to));const r=spawnSync(process.execPath,[join(dir,'tests/wire.mjs'),group],{encoding:'utf8',timeout:30000});assert(!r.error&&!r.signal,name+': process completed');assert.notEqual(r.status,0);const first=/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/.exec(r.stderr)?.[1];assert.equal(first,wanted,`${name}: ${r.stdout}\n${r.stderr}`);console.log('RED wire/'+name+': '+first);}}finally{rmSync(temp,{recursive:true,force:true});}
