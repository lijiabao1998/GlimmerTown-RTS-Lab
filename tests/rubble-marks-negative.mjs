// Isolated semantic negative controls; production files and legacy tests remain untouched.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'shots'),{recursive:true});const tmp=fs.mkdtempSync(path.join(root,'shots','r139-negative-'));
const guard='    if (this.rubbleMarkGuard && b.hp <= 0) return;';
const mutants=[
 ['disabled',guard,'','rubble lifecycle: tick 199'],
 ['rollback',guard,'    if (b.hp <= 0) return;','rollback: same-tick legacy mark restored'],
 ['living',guard,guard+'\n    if (this.rubbleMarkGuard && b.hp > 0) return;','living AP/HE marks byte-for-byte unchanged'],
 ['recreate','    next.rubbleMarkGuard = this.rubbleMarkGuard;','','recreate: independent valve survives visual rebuild'],
 ['readonly',guard,'    if (this.rubbleMarkGuard && b.hp <= 0) { this.w.rng++; return; }','readonly: full world unchanged by render'],
 ['sequence',guard,'    if (this.rubbleMarkGuard && b.hp <= 0) { this.holeSeq--; return; }','later living target: exact AP/HE positions, sizes and colors preserved'],
];
try{
 fs.cpSync(path.join(root,'src'),path.join(tmp,'src'),{recursive:true});fs.mkdirSync(path.join(tmp,'tests'));fs.copyFileSync(path.join(root,'tests/rubble-marks.mjs'),path.join(tmp,'tests/rubble-marks.mjs'));fs.copyFileSync(path.join(root,'package.json'),path.join(tmp,'package.json'));
 const file=path.join(tmp,'src/render/battle.ts'),source=fs.readFileSync(file,'utf8');
 for(const[name,from,to,expected]of mutants){assert.equal(source.split(from).length,2,name+' unique anchor');fs.writeFileSync(file,source.replace(from,to));const r=spawnSync(process.execPath,['tests/rubble-marks.mjs'],{cwd:tmp,encoding:'utf8',timeout:20000});const out=r.stdout+r.stderr;assert.equal(r.signal,null,name+' no timeout');assert.equal(r.status,1,name+' rejected');const first=out.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]+)/)?.[1]??'';assert(first.includes(expected),name+' intended semantic first red: '+out.slice(-1600));console.log('RED R139 '+name+': '+first);}
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
