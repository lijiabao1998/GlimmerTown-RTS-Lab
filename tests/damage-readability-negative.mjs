import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {spawnSync}from'node:child_process';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'shots'),{recursive:true});const tmp=fs.mkdtempSync(path.join(root,'shots','r138-negative-'));
const mutants=[
 ['disabled','damageDetailsOn = on;','damageDetailsOn = false;','enabled: every civilian damaged mesh changes'],
 ['rollback','const segs = 3;','const segs = 4;','rollback: exact pre-R138 geometry'],
 ['nonfinite','const h = wallHeight(b) * 0.72;','const h = Number.NaN;','finite: geometry'],
 ['footprint','x + sx, 0.06 + hh * 0.1 + mound * 0.13','x + sx + b.w, 0.06 + hh * 0.1 + mound * 0.13','footprint: native occupied cells'],
 ['readonly','for (const b of w.blds) if (!skip','w.rng++; for (const b of w.blds) if (!skip','readonly: complete world and RNG'],
];
try{
 fs.cpSync(path.join(root,'src'),path.join(tmp,'src'),{recursive:true});fs.mkdirSync(path.join(tmp,'tests'));fs.copyFileSync(path.join(root,'tests/damage-readability.mjs'),path.join(tmp,'tests/damage-readability.mjs'));fs.copyFileSync(path.join(root,'package.json'),path.join(tmp,'package.json'));
 const file=path.join(tmp,'src/render/buildings.ts'),source=fs.readFileSync(file,'utf8');
 for(const[name,from,to,expected]of mutants){assert(source.includes(from),name+' source anchor');fs.writeFileSync(file,source.replace(from,to));const r=spawnSync(process.execPath,['tests/damage-readability.mjs'],{cwd:tmp,encoding:'utf8',timeout:20000});const output=r.stdout+r.stderr;assert.equal(r.signal,null,name+' no timeout');assert.notEqual(r.status,0,name+' rejected');assert(output.includes('AssertionError')&&output.includes(expected)&&!/SyntaxError|ReferenceError/.test(output),name+' exact semantic first red: '+output.slice(-1600));console.log('RED R138 '+name+': '+expected);}
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
