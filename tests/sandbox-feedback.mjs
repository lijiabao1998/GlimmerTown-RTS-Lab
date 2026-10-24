// R129: application outcomes are transient; interactive audio uses the original bounded queue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSandboxWorld} from '../src/sim/sandbox.ts';
import {createWorld,hashWorld,N} from '../src/sim/world.ts';
import {step} from '../src/sim/step.ts';
import {BattleAudio} from '../src/render/audio.ts';

const only=process.argv[2],root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const P=(x=24,z=26,side=0)=>({t:'sandboxPlace',side,kind:0,x,z}),visible={visibleUnit:()=>true,visibleAt:()=>true};
const drain=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
const firing=()=>{const w=createSandboxWorld(1944);step(w,[P(),P(26,26,1),{t:'sandboxRun',running:true}]);assert.equal(w.events.filter(e=>e.e==='fire').length,2,'fixture: two real visible tank fire events');return w};
class Context {
 constructor(deferSuspend=false){this.state='suspended';this.currentTime=0;this.destination={};this.onstatechange=null;this.resumes=[];this.suspends=[];this.sources=[];this.buffers=[];this.deferSuspend=deferSuspend;}
 stateTo(s){this.state=s;this.onstatechange?.();}
 createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
 createBuffer(channels,length,rate){const b={length,sampleRate:rate,numberOfChannels:channels,copyToChannel(){}};this.buffers.push(b);return b;}
 createBufferSource(){const c=this,s={buffer:null,playbackRate:{value:1},onended:null,connect(){},disconnect(){},start(){c.sources.push(s)},stop(){s.onended?.()}};return s;}
 resume(){return new Promise((resolve,reject)=>this.resumes.push({resolve:()=>{this.stateTo('running');resolve()},reject}));}
 suspend(){if(this.deferSuspend)return new Promise(resolve=>this.suspends.push(()=>{this.stateTo('suspended');resolve()}));this.stateTo('suspended');return Promise.resolve();}
 close(){this.stateTo('closed');return Promise.resolve();}
 finish(){for(const s of this.sources)s.onended?.();}
}
function pendingAudio(active=true,deferSuspend=false){const ctx=new Context(deferSuspend),audio=new BattleAudio(()=>{},()=>ctx);audio.setActive(active);audio.toggleFromGesture();return {ctx,audio};}
const groups={
 results(){
  const w=createSandboxWorld(1944),a=[],keys=Object.keys(w).sort();
  step(w,[P(),P(),P(26,26)],a);
  assert.deepEqual(a,[null,'unit',null],'feedback: outcomes follow actual application order');
  assert.equal(w.units.length,2,'feedback: one overlapping placement rejected');
  assert.deepEqual(Object.keys(w).sort(),keys,'feedback: no persistent result state');
  const cap=createSandboxWorld(1944),cells=[];for(let z=0;z<N&&cells.length<31;z++)for(let x=0;x<N&&cells.length<31;x++)if(!cap.occ[z*N+x])cells.push(P(x,z));
  step(cap,cells);assert.equal(cap.units.length,31);const b=[];
  step(cap,[P(24,26),P(26,26)],b);assert.deepEqual(b,[null,'capacity'],'feedback: capacity result is from the updated world');assert.equal(cap.units.length,32,'feedback: fixed 32 capacity');
  const invalid=[],clone=structuredClone(cap);step(cap,[P(24,26)],invalid);step(clone,[P(24,26)]);assert.equal(hashWorld(cap),hashWorld(clone),'feedback: collecting results never changes world hash');
  const normal=createWorld(1944),old=structuredClone(normal),none=[];step(normal,[P()],none);step(old,[]);assert.deepEqual(none,[],'feedback: ordinary worlds emit no sandbox outcome');assert.deepEqual(normal,old,'feedback: ordinary world unchanged');
 },
 async format(){
  const {sandboxPlacementFeedback:F}=await import('../src/ui/sandbox.ts');
  assert.equal(F([]),'','feedback text: empty batch stays empty');assert.equal(F([null]),'已放置 1 輛。','feedback text: one actual acceptance');
  const text=F([null,'unit','capacity','unit']);
  assert.match(text,/已放置 1 輛；未放置 3 輛/,'feedback text: accepted and rejected totals');
  assert.match(text,/已有單位，請換一格。/,'feedback text: overlap reason retained');assert.match(text,/已達 32 輛上限/,'feedback text: capacity reason retained');
  assert.equal(text.split('已有單位').length-1,1,'feedback text: repeated reasons summarized once');
 },
 async interaction(){
  const w=firing(),before=structuredClone(w),{audio,ctx}=pendingAudio();
  audio.enqueueInteraction(w,w.events,visible);assert.equal(audio.debug().pending,2,'interaction: synchronous fire retained during pending resume');
  audio.enqueue(w,w.events,visible);audio.flush();assert.equal(audio.debug().pending,2,'interaction: frame flush preserves pending interactive cues');assert.equal(ctx.sources.length,0,'interaction: never play before native resume settles');
  assert.deepEqual(w,before,'interaction: collection leaves complete world unchanged');step(w,[]);step(w,[]);assert.deepEqual(w.events,[],'fixture: original fire events gone');
  ctx.resumes.shift().resolve();await drain();audio.flush();assert.deepEqual(audio.debug().played,[2,0,0],'interaction: stored kinds play once after world events clear');audio.flush();assert.equal(ctx.sources.length,2,'interaction: no duplicate next-frame playback');
  assert.equal(ctx.buffers.length,3);assert.equal(audio.debug().pcmSamples,37485,'interaction: original PCM budget');audio.dispose();
 },
 async capacity(){
  const w=firing(),{audio,ctx}=pendingAudio();for(let i=0;i<12;i++)audio.enqueueInteraction(w,w.events,visible);audio.flush();assert.equal(audio.debug().pending,8,'interaction capacity: original eight-slot pending bound');
  ctx.resumes.shift().resolve();await drain();audio.flush();assert.equal(ctx.sources.length,4,'interaction capacity: four starts per rendered frame');assert.equal(audio.debug().pending,0);ctx.finish();audio.flush();assert.equal(ctx.sources.length,4,'interaction capacity: overflow never drains as history');assert(audio.debug().peakVoices<=8);audio.dispose();
 },
 async lifecycle(){
  const w=firing();for(const stop of ['pause','reset','off','silence','dispose']){
   const {audio,ctx}=pendingAudio();audio.enqueueInteraction(w,w.events,visible);
   if(stop==='pause')audio.setActive(false);else if(stop==='reset')audio.reset();else if(stop==='off')audio.toggleFromGesture();else if(stop==='silence')audio.silence();else audio.dispose();
   assert.equal(audio.debug().pending,0,'interaction lifecycle: every stop clears pending cues');ctx.resumes.shift().resolve();await drain();audio.flush();assert.equal(ctx.sources.length,0,'interaction lifecycle: no late old cue after resume settles');audio.dispose();
  }
  const {audio,ctx}=pendingAudio();audio.enqueueInteraction(w,w.events,visible);ctx.resumes.shift().reject(Error('native denial'));await drain();audio.flush();assert.equal(audio.debug().pending,0,'interaction lifecycle: failed resume clears queue');assert.equal(audio.status().state,'unavailable');audio.dispose();
 },
 async suspendRace(){
  const w=firing(),{audio,ctx}=pendingAudio(false,true);ctx.resumes.shift().resolve();await drain();assert.equal(ctx.suspends.length,1,'fixture: older suspend still pending');
  audio.setActive(true);audio.enqueueInteraction(w,w.events,visible);ctx.suspends.shift()();await drain();assert.equal(audio.debug().pending,2,'interaction race: older suspend retains active interactive cues');
  ctx.resumes.shift().resolve();await drain();audio.flush();assert.equal(ctx.sources.length,2,'interaction race: later resume plays original cues once');audio.dispose();
 },
};
for(const [name,run]of Object.entries(groups))if(!only||only===name){await run();console.log('OK sandbox-feedback/'+name);}
if(!only){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r129-negative-'));
 const mutants=[
  ['missing-results','results','sim/step.ts',"placementResults?.push(typeof result === 'string' ? result : null)",'void result','feedback: outcomes follow actual application order'],
  ['false-accept','results','sim/sandbox.ts','if (error) return error;','if (error) return null;','feedback: outcomes follow actual application order'],
  ['hide-rejection','format','ui/sandbox.ts','return failed.length ?','return false ?','feedback text: accepted and rejected totals'],
  ['skip-interaction','interaction','render/audio.ts','    this.collect(world, events, visibility);\n    if (this.pendingCount) this.interactivePending = true;','    if (false) this.collect(world, events, visibility);\n    if (this.pendingCount) this.interactivePending = true;','interaction: synchronous fire retained during pending resume'],
  ['drop-pending','interaction','render/audio.ts','if (!(this.interactivePending && this.enabled && this.active && !this.unavailable && !this.disposed))','if (true)','interaction: frame flush preserves pending interactive cues'],
  ['keep-stop','lifecycle','render/audio.ts','silence(keepInteraction = false)','silence(keepInteraction = true)','interaction lifecycle: every stop clears pending cues'],
  ['lose-suspend','suspendRace','render/audio.ts','this.silence(this.enabled && this.active);','this.silence();','interaction race: older suspend retains active interactive cues'],
 ];
 try{for(const[name,group,file,from,to,wanted]of mutants){const dir=path.join(temp,name);fs.mkdirSync(path.join(dir,'tests'),{recursive:true});fs.mkdirSync(path.join(dir,'src/ui'),{recursive:true});fs.mkdirSync(path.join(dir,'src/render'),{recursive:true});fs.cpSync(path.join(root,'src/sim'),path.join(dir,'src/sim'),{recursive:true});fs.copyFileSync(path.join(root,'src/ui/sandbox.ts'),path.join(dir,'src/ui/sandbox.ts'));fs.copyFileSync(path.join(root,'src/render/audio.ts'),path.join(dir,'src/render/audio.ts'));fs.copyFileSync(fileURLToPath(import.meta.url),path.join(dir,'tests/sandbox-feedback.mjs'));fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');const target=path.join(dir,'src',file),source=fs.readFileSync(target,'utf8');assert.equal(source.split(from).length-1,1,'negative '+name+': unique anchor');fs.writeFileSync(target,source.replace(from,to));const r=spawnSync(process.execPath,[path.join(dir,'tests/sandbox-feedback.mjs'),group],{encoding:'utf8',timeout:30000});assert(!r.error&&!r.signal,'negative '+name+': completes');assert.notEqual(r.status,0,'negative '+name+': must fail');const first=/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(r.stderr)?.[1];assert.equal(first,wanted,'negative '+name+': first red\n'+r.stdout+'\n'+r.stderr);console.log('RED sandbox-feedback/'+name+': '+first);}}
 finally{assert.equal(path.resolve(temp,'..'),path.resolve(os.tmpdir()),'cleanup: temporary directory within OS temp');fs.rmSync(temp,{recursive:true,force:true});}
}
