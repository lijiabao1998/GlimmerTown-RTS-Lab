import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {sandboxCapacity as F,initSandbox} from '../src/ui/sandbox.ts';
import {createSandboxWorld,SANDBOX_CAP} from '../src/sim/sandbox.ts';
import {createWorld,hashWorld} from '../src/sim/world.ts';
import {step,runLog} from '../src/sim/step.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),only=process.argv[2];
const P=(side,x,z)=>({t:'sandboxPlace',side,kind:0,x,z});
const fixture=()=>{const w=createSandboxWorld(1944);step(w,[P(0,24,26),P(1,26,26),P(0,29,29)]);assert.equal(w.units.length,3,'fixture: three real placements');return w;};
const text=(p,e,d,f)=>`存活：我方 ${p}／敵方 ${e}；殘骸 ${d}；可放 ${f}`;
const groups={
 empty(){assert.equal(F(createSandboxWorld(1944)),text(0,0,0,32),'empty: exact free capacity');},
 sides(){assert.equal(F(fixture()),text(2,1,0,29),'sides: distinct living sides');},
 wrecks(){const w=fixture();w.units[0].alive=false;w.units[0].hp=0;assert.equal(F(w),text(1,1,1,29),'wrecks: death retains occupied slot');w.units[1].alive=false;w.units[1].hp=0;assert.equal(F(w),text(1,0,2,29),'wrecks: both sides counted');w.units[2].alive=false;w.units[2].hp=0;assert.equal(F(w),text(0,0,3,29),'wrecks: all dead does not release slots');},
 full(){const w=createSandboxWorld(1944);for(let z=0;z<32&&w.units.length<SANDBOX_CAP;z++)for(let x=0;x<32&&w.units.length<SANDBOX_CAP;x++)step(w,[P(w.units.length%2,x,z)]);assert.equal(w.units.length,32,'fixture: full real placement');assert.equal(F(w),text(16,16,0,0),'full: zero free slots');for(const u of w.units){u.alive=false;u.hp=0;}assert.equal(F(w),text(0,0,32,0),'full: all wrecks remain full');step(w,[{t:'sandboxReset'}]);assert.equal(F(w),text(0,0,0,32),'reset: entire capacity restored');},
 mode(){assert.equal(F(createWorld(1944)),'','mode: ordinary world never reveals enemy count');},
 valve(){assert.equal(F(fixture(),false),'','valve: feature off returns original absence');},
 purity(){const w=fixture(),copy=structuredClone(w),hash=hashWorld(w);for(let i=0;i<120;i++)F(w);assert.deepEqual(w,copy,'purity: complete world unchanged');assert.equal(hashWorld(w),hash,'purity: full hash unchanged');},
 replay(){const log=[{tick:0,cmd:P(0,24,26)},{tick:0,cmd:P(1,26,26)},{tick:1,cmd:{t:'sandboxRun',running:true}}];const a=createSandboxWorld(1944),b=createSandboxWorld(1944);for(let i=0;i<1000;i++){const cmds=log.filter(x=>x.tick===i).map(x=>x.cmd);step(a,cmds);F(a);step(b,cmds);if(i%20===0)F(b);}assert.deepEqual(a,b,'cadence: querying at 60Hz or skipped frames changes nothing');assert(a.units.some(u=>!u.alive),'fixture: real combat death');assert.equal(F(a),F(runLog(createSandboxWorld(1944),log,1000)),'replay: exact same command world summary');},
 dom(){
  let s={active:true,running:false,count:3,tool:0,side:0,hint:'原放兵結果',summary:text(1,1,1,29)},reads=0,acted=[];
  class El{constructor(){this.hidden=false;this.textContent='';this.style={};this.attrs={};this.listeners={};this.children=new Map();}set innerHTML(v){for(const m of v.matchAll(/id="([^"]+)"/g))this.children.set('#'+m[1],new El());}querySelector(id){return this.children.get(id);}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}addEventListener(k,f){this.listeners[k]=f;}}
  const els=[];globalThis.document={createElement:()=>{const e=new El();els.push(e);return e;},body:{append(){}},getElementById:()=>null};globalThis.addEventListener=()=>{};globalThis.innerHeight=860;globalThis.ResizeObserver=class{observe(){}};
  const ui=initSandbox({state:()=>{reads++;return s;},enter:()=>acted.push('enter'),exit:()=>acted.push('exit'),run:()=>acted.push('run'),reset:()=>acted.push('reset'),pick:k=>acted.push(k),side:k=>acted.push(k)}),panel=els[1],$=id=>panel.querySelector('#'+id);
  assert.equal($('sb-summary').textContent,s.summary,'dom: renders exact summary');assert.equal($('sb-summary').hidden,false,'dom: enabled summary visible');assert.equal($('sb-hint').textContent,s.hint,'dom: original feedback untouched');assert.equal($('sb-status').textContent,'沙盒 暫停 · 3/32','dom: original status retained');assert.deepEqual(acted,[],'dom: rendering issues no actions');
  s={...s,summary:''};ui.update();assert.equal($('sb-summary').hidden,true,'dom: rollback hides layout row');assert.equal($('sb-summary').textContent,'','dom: rollback clears old text');assert.equal($('sb-hint').textContent,'原放兵結果','dom: off preserves original feedback');
  s={...s,summary:text(0,0,0,32),count:0};ui.update();assert.equal($('sb-summary').textContent,text(0,0,0,32),'dom: reset no stale summary');
  s={...s,active:false};ui.update();assert.equal(panel.hidden,true,'dom: normal mode hides panel');assert.equal(els[0].hidden,false,'dom: original entry returns');assert.equal(reads,4,'dom: only original update reads state');
 },
 wiring(){const main=fs.readFileSync(path.join(ROOT,'src/main.ts'),'utf8');assert(main.includes("summary: sandboxCapacity(w, V.r136)"),'wiring: main applies independent valve');const loop=main.slice(main.indexOf('renderer.setAnimationLoop('));assert(!loop.includes('sandboxCapacity('),'wiring: no new frame refresh side channel');},
};
for(const [name,run]of Object.entries(groups))if(!only||only===name){run();console.log('OK sandbox-capacity/'+name);}
if(!only){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'r136-negative-'));const mutants=[
 ['side','sides','ui/sandbox.ts','u.side === SIDE_PLAYER','u.side === SIDE_ENEMY','sides: distinct living sides'],
 ['dead','wrecks','ui/sandbox.ts','if (!u.alive) wrecks++;','if (false) wrecks++;','wrecks: death retains occupied slot'],
 ['free-wreck','wrecks','ui/sandbox.ts','SANDBOX_CAP - w.units.length','SANDBOX_CAP - w.units.filter(u => u.alive).length','wrecks: death retains occupied slot'],
 ['cap','empty','ui/sandbox.ts','SANDBOX_CAP - w.units.length','SANDBOX_CAP - w.units.length - 1','empty: exact free capacity'],
 ['mode','mode','ui/sandbox.ts','if (!enabled || !w.sandbox)','if (!enabled)','mode: ordinary world never reveals enemy count'],
 ['valve','valve','ui/sandbox.ts','if (!enabled || !w.sandbox)','if (!w.sandbox)','valve: feature off returns original absence'],
 ['write','purity','ui/sandbox.ts','let player = 0, enemy = 0, wrecks = 0;','w.rng++; let player = 0, enemy = 0, wrecks = 0;','purity: complete world unchanged'],
 ['hide','dom','ui/sandbox.ts',"$('sb-summary').hidden = !s.summary;","$('sb-summary').hidden = true;",'dom: enabled summary visible'],
 ['sticky','dom','ui/sandbox.ts',"text('sb-summary', s.summary ?? '');","if (s.summary) text('sb-summary', s.summary);",'dom: rollback clears old text'],
 ['overwrite','dom','ui/sandbox.ts',"text('sb-summary', s.summary ?? '');","text('sb-summary', 'wrong');",'dom: renders exact summary'],
 ['wire-valve','wiring','main.ts',"summary: sandboxCapacity(w, V.r136)","summary: sandboxCapacity(w, true)",'wiring: main applies independent valve'],
 ];try{for(const [name,group,file,from,to,wanted]of mutants){const dir=path.join(tmp,name);fs.mkdirSync(path.join(dir,'tests'),{recursive:true});fs.cpSync(path.join(ROOT,'src/sim'),path.join(dir,'src/sim'),{recursive:true});fs.mkdirSync(path.join(dir,'src/ui'),{recursive:true});for(const f of ['ui/sandbox.ts','main.ts'])fs.copyFileSync(path.join(ROOT,'src',f),path.join(dir,'src',f));fs.copyFileSync(fileURLToPath(import.meta.url),path.join(dir,'tests/sandbox-capacity.mjs'));fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');const p=path.join(dir,'src',file),source=fs.readFileSync(p,'utf8');assert.equal(source.split(from).length-1,1,'negative unique '+name);fs.writeFileSync(p,source.replace(from,to));const r=spawnSync(process.execPath,[path.join(dir,'tests/sandbox-capacity.mjs'),group],{encoding:'utf8',timeout:30000});assert(!r.error&&!r.signal,'negative complete '+name);assert.notEqual(r.status,0,'negative red '+name);assert.equal(/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(r.stderr)?.[1],wanted,'negative semantic first red '+name+'\n'+r.stderr);console.log('RED sandbox-capacity/'+name+': '+wanted);}}finally{fs.rmSync(tmp,{recursive:true,force:true});}}
