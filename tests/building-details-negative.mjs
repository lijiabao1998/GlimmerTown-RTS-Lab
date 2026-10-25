import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');fs.mkdirSync(path.join(root,'shots'),{recursive:true});const tmp=fs.mkdtempSync(path.join(root,'shots','r134-negative-'));
const mutants=[
 ['disabled','buildingDetailsOn = on;','buildingDetailsOn = false;','changed>0'],
 ['nonfinite','cx-0.025,h+rise-0.015,z0-0.025','NaN,h+rise-0.015,z0-0.025','finite'],
 ['normal','[0,0,dir],color);','[0,0,dir*2],color);','unit normal'],
 ['footprint','cx+half+0.025,0.035,z1+0.065','cx+half+0.025,0.035,z1+2','footprint'],
 ['rng','for (const b of w.blds) if (!skip','w.rng++; for (const b of w.blds) if (!skip','no world/RNG writes'],
];
try{
 fs.cpSync(path.join(root,'src'),path.join(tmp,'src'),{recursive:true});fs.mkdirSync(path.join(tmp,'tests'));fs.copyFileSync(path.join(root,'tests/building-details.mjs'),path.join(tmp,'tests/building-details.mjs'));fs.copyFileSync(path.join(root,'package.json'),path.join(tmp,'package.json'));
 const file=path.join(tmp,'src/render/buildings.ts'),source=fs.readFileSync(file,'utf8');
 for(const[name,from,to,expected]of mutants){assert.equal(source.split(from).length,2,name+' unique anchor');fs.writeFileSync(file,source.replace(from,to));const r=spawnSync(process.execPath,['tests/building-details.mjs'],{cwd:tmp,encoding:'utf8',timeout:60000});const output=r.stdout+r.stderr;assert.notEqual(r.status,0,name+' rejected');assert(output.includes(expected)&&output.includes('AssertionError')&&!/SyntaxError|ReferenceError/.test(output),name+' intended first red: '+output.slice(-1500));console.log('OK R134 negative '+name);}
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
