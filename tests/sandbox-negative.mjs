// 語意突變只寫到 OS temp 的副本，原程式與驗收標準不動。
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),temp=mkdtempSync(join(tmpdir(),'r128-negative-'));
const mutants=[
 ['empty','activation','sandbox.ts','w.units = [];','w.units = w.units;','activation: empty army'],
 ['gate','activation','sandbox.ts','if (!w.sandbox) return;','if (!w.sandbox) w.sandbox = { version: 1, running: false, frame: 0 };','activation: ordinary world rejects new command'],
 ['setup','activation','step.ts',"if (w.sandbox && cmd.t !== 'move'","if (false && w.sandbox && cmd.t !== 'move'",'activation: sandbox rejects setup and economy commands'],
 ['side','placement','sandbox.ts',"if (c.side !== SIDE_PLAYER && c.side !== SIDE_ENEMY)","if (false && c.side !== SIDE_PLAYER && c.side !== SIDE_ENEMY)",'placement: invalid input has reason'],
 ['kind','placement','sandbox.ts',"if (c.kind !== UK_TANK && c.kind !== UK_HOWITZER)","if (false && c.kind !== UK_TANK && c.kind !== UK_HOWITZER)",'placement: invalid input has reason'],
 ['integer','placement','sandbox.ts','!Number.isInteger(c.x) || !Number.isInteger(c.z) || ','','placement: invalid input has reason'],
 ['bounds','placement','sandbox.ts','!inGrid(w, c.x, c.z)','false','placement: invalid input has reason'],
 ['building','placement','sandbox.ts','if (blocks(w, c.x, c.z))','if (false && blocks(w, c.x, c.z))','placement: invalid input has reason'],
 ['overlap','placement','sandbox.ts','if (w.units.some(','if (false && w.units.some(','placement: invalid input has reason'],
 ['values','placement','sandbox.ts','hp: k.hp, alive: true','hp: k.hp - 1, alive: true','placement: independent unit values'],
 ['cap','capacity','sandbox.ts','w.units.length >= SANDBOX_CAP','w.units.length > SANDBOX_CAP','capacity: 33rd rejected'],
 ['wreck','capacity','sandbox.ts','w.units.length >= SANDBOX_CAP','w.units.filter(u => u.alive).length >= SANDBOX_CAP','capacity: wreck counts'],
 ['frozen','pause','step.ts','if (!w.sandbox.running) return;','if (false && !w.sandbox.running) return;','pause: setup does not run combat'],
 ['winner','pause','step.ts','if (!w.sandbox) checkWinner(w);','checkWinner(w);','pause: no forced victory'],
 ['reset','reset','sandbox.ts','for (const key of Object.keys(w)) delete (w as unknown as Record<string, unknown>)[key];','void 0;','reset: entire same seed world restored'],
 ['frame','reset','sandbox.ts','w.sandbox!.frame = frame;','w.sandbox!.frame = 0;','reset: command frame retained'],
 ['hash-version','replay','world.ts','.int(w.sandbox.version)','','replay: every sandbox field hashed'],
 ['hash-frame','replay','world.ts','.int(w.sandbox.frame)','','replay: every sandbox field hashed'],
 ['hash-running','replay','world.ts','.int(w.sandbox.running ? 1 : 0)','','replay: every sandbox field hashed'],
 ['log-clock','replay','step.ts','w.sandbox?.frame ?? w.tick','w.tick','replay: log timeline includes paused edits'],
];
try{for(const[name,group,file,from,to,wanted]of mutants){
 const dir=join(temp,name);mkdirSync(join(dir,'tests'),{recursive:true});cpSync(join(root,'src/sim'),join(dir,'src/sim'),{recursive:true});cpSync(join(root,'tests/sandbox.mjs'),join(dir,'tests/sandbox.mjs'));writeFileSync(join(dir,'package.json'),'{"type":"module"}');
 const p=join(dir,'src/sim',file),source=readFileSync(p,'utf8');assert.equal(source.split(from).length,2,name+': unique anchor');writeFileSync(p,source.replace(from,to));
 const r=spawnSync(process.execPath,[join(dir,'tests/sandbox.mjs'),group],{encoding:'utf8',timeout:30000});assert(!r.error&&!r.signal,name+': completed');assert.notEqual(r.status,0,name+': must fail');
 const first=/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(r.stderr)?.[1];assert.equal(first,wanted,`${name}: first red\n${r.stdout}\n${r.stderr}`);console.log('RED sandbox/'+name+': '+first);
}}finally{assert.equal(resolve(temp,'..'),resolve(tmpdir()),'cleanup: temporary directory stays inside OS temp');rmSync(temp,{recursive:true,force:true});}
