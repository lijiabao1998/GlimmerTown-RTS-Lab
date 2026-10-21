// R126: real Chrome input, read-only feedback, replay parity and independent semantic mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK, UK_INFANTRY } from '../src/sim/world.ts';
import { ECO_QUEUE, ECO_POP } from '../src/sim/eco.ts';
import { runLog } from '../src/sim/step.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r126-browser-'));
const strictCI=process.env.GITHUB_ACTIONS==='true'||!!process.env.GITHUB_RUN_ID||!!process.env.CI;
const summary=[],record=s=>{summary.push(s);console.log(s);};
const SEED=1944,log=[{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}}];
const initial=runLog(createWorld(SEED),log,1),initialHash=hashWorld(initial),cost=UNIT_KINDS[UK_TANK].cost;
const M=name=>`new URLSearchParams(location.search).get('__r126mutant') === '${name}'`;
const plugin=mutants=>({name:'r126-test-only',enforce:'pre',transform(code,id){
  const rel=path.relative(ROOT,id).replaceAll('\\','/');
  const replace=(from,to)=>{assert.equal(code.split(from).length-1,1,'unique test anchor '+from);code=code.replace(from,to);};
  if(rel==='src/main.ts'){
    replace('(window as unknown as { __rts: typeof rts }).__rts = rts;',`(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r126 = {
 world: () => JSON.stringify(w),
 patch: (s: any) => { Object.assign(w.eco!, s); },
 destroy: () => { w.blds[w.eco!.hq[0]-1].hp=0; },
 finish: () => { w.winner=0; },
 hide: () => { phase='build'; },
 replace: () => { w=structuredClone(w); },
 speed: () => { speed=2; },
 population: () => { const u=w.units.find(u=>u.side===0)!; while(w.units.filter(u=>u.alive&&u.side===0).length<${ECO_POP}) w.units.push({...structuredClone(u),id:w.units.length+1}); },
 exit: () => { const h=w.blds[w.eco!.hq[0]-1]; for(let z=h.z-1;z<=h.z+h.d;z++)for(let x=h.x-1;x<=h.x+h.w;x++)if(x>=0&&z>=0&&x<32&&z<32)w.occ[z*32+x]=h.id; }
};`);
    if(mutants)replace("blockReason: q.get('noR126') !== '1' ?",`blockReason: (${M('valve')} || q.get('noR126') !== '1') ?`);
  }
  if(mutants&&rel==='src/ui/productionBlockReason.ts'){
    replace('const e = w.eco;',`const e = w.eco;
if (${M('population')} && w.units.filter(u=>u.alive&&u.side===0).length>=${ECO_POP}) return '人口已滿';
if (${M('exit')} && e.queue[0].length && e.prog[0]>=UNIT_KINDS[e.queue[0][0]].buildTicks) return '出口堵塞';`);
    replace('if (!hqAlive(w, SIDE_PLAYER))',`if (!(${M('hq')}) && !hqAlive(w, SIDE_PLAYER))`);
    replace("return '本局未開放此單位';",`return ${M('feature')} ? '' : '本局未開放此單位';`);
    replace("return '生產佇列已滿';",`return ${M('queue')} ? '' : '生產佇列已滿';`);
    replace('UNIT_KINDS[kind].cost - e.supply[SIDE_PLAYER]',`UNIT_KINDS[kind].cost - e.supply[${M('enemy')} ? 1 : SIDE_PLAYER] + (${M('supply')} ? 1 : 0)`);
  }
  if(mutants&&rel==='src/ui/production.ts'){
    replace('a.produce(it.kind);',`if (!(${M('commands')}) || !a.blockReason?.(it.kind)) a.produce(it.kind);`);
    replace('if (s.context !== feedbackContext)',`if (!(${M('identity')}) && s.context !== feedbackContext)`);
    replace("const reason = s.visible && feedbackKind !== undefined ? a.blockReason(feedbackKind) : '';",`const reason = (${M('hidden')} ? feedbackKind !== undefined : s.visible && feedbackKind !== undefined) ? (${M('hidden')} ? '過期' : a.blockReason(feedbackKind!)) : '';`);
    replace("if (reasonElement.textContent !== text) reasonElement.textContent = text;\n      reasonElement.hidden = !text;\n      if (!reason)",`if (!(${M('freshness')} && reasonElement.textContent) && reasonElement.textContent !== text) reasonElement.textContent = text;
      reasonElement.hidden = !text;
      if (!reason)`);
    replace('root.hidden = !s.visible;',`root.hidden = !s.visible; if (${M('layout')}) root.style.width='2000px';`);
  }
  return code;
}});
async function main(){
  const baseline=path.join(temp,'baseline'),broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true)],build:{outDir:broken}});
  if(process.argv.includes('--prepare-only')){record('PREPARED R126 baseline/mutant builds; Chrome not run');return;}
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8456,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:50},async({open,page})=>{
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>E('({world:__r126.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
    const reason=()=>E('document.getElementById("pb-reason")?.textContent??""');
    const title=(kind=UK_TANK)=>E(`document.getElementById('pb-k${kind}').title`);
    const viewport=async(width=412,height=860,mobile=true)=>{await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await frames();};
    const fresh=async(extra='')=>{await open('noR018=1&noR016=1&'+extra);assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1)`),initialHash,'fixture: initial replay hash');await E('__rts.pause(true)');await frames();};
    const patch=async value=>{await E(`__r126.patch(${JSON.stringify(value)})`);await frames();};
    const click=async(kind=UK_TANK,mobile=true)=>{
      const p=await E(`(()=>{const e=document.getElementById('pb-k${kind}'),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})()`);
      assert(p[2],'input: original production target reachable');
      if(mobile)await touchTap(page,p[0],p[1]);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p[0],y:p[1],button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p[0],y:p[1],button:'left',buttons:0,clickCount:1});}
      await frames();
    };
    const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
    const layout=async label=>{
      const g=await E(`(()=>{const p=document.getElementById('prodbar'),r=document.getElementById('pb-reason'),c=document.getElementById('pb-countdown'),h=document.getElementById('hint');return {p:p.getBoundingClientRect().toJSON(),r:r.getBoundingClientRect().toJSON(),c:c.getBoundingClientRect().toJSON(),h:h.getBoundingClientRect().toJSON(),overflow:p.scrollWidth-p.clientWidth,textOverflow:r.scrollWidth-r.clientWidth,width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('#prodbar button,#hud .btns button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const b=e.getBoundingClientRect();return {r:b.toJSON(),hit:e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}})};})()`);
      record('R126 layout '+label+': '+JSON.stringify(g));
      assert(g.p.top>=0&&g.p.bottom<=g.h.top-6&&g.p.left>=0&&g.p.right<=g.width&&g.overflow<=0&&g.textOverflow<=0,'layout: complete production without overflow');
      assert(g.r.height>0&&g.r.top>=g.p.top&&g.r.bottom<=g.p.bottom&&(!g.c.height||g.c.bottom<=g.r.top),'layout: reason and countdown do not overlap');
      assert(g.buttons.every(b=>b.hit&&b.r.width>=44&&b.r.height>=44&&b.r.top>=0&&b.r.bottom<=g.height&&b.r.left>=0&&b.r.right<=g.width),'layout: original controls visible and unobstructed');
    };
    const legacy=()=>E('({supply:document.getElementById("pb-supply").textContent,queue:document.getElementById("pb-queue").textContent,progress:document.querySelector("#pb-prog i").style.width,countdown:document.getElementById("pb-countdown").textContent,buttons:[...document.querySelectorAll("#prodbar button")].map(e=>[e.id,e.textContent,e.className])})');
    const native=async(mutant=false,mobile=true,off=false)=>{
      await viewport(mobile?412:1280,mobile?860:800,mobile);await fresh((mutant?'__r126mutant=commands':'')+(off?'&noR126=1':''));
      // First tank accepted, second rejected from insufficient funds, third observer accepted.
      for(const [index,kind]of [UK_TANK,UK_TANK,2].entries()){
        const before=await state();await click(kind,mobile);const issued=await state();
        assert.equal(issued.log.length,before.log.length+1,'commands: each real click records exactly one original produce');
        assert.deepEqual(issued.log.at(-1),{tick:before.tick,cmd:{t:'produce',side:0,kind}},'commands: unchanged command data');
        assert.equal(issued.world,before.world,'commands: UI input itself does not mutate world');
        await E('__rts.stepN(1)');await frames();const after=await state();
        assert.equal(after.hash,hashWorld(runLog(createWorld(SEED),after.log,after.tick)),'commands: accepted and refused replay identical');
        const a=JSON.parse(after.world).eco,b=JSON.parse(before.world).eco;
        assert.equal(a.queue[0].length,b.queue[0].length+(index===1?0:1),'commands: simulation alone accepts or refuses');
        assert.equal(a.supply[0],b.supply[0]-(index===1?0:UNIT_KINDS[kind].cost),'commands: exactly one debit or none');
        if(index===1&&!off)assert.equal(await reason(),`坦克：補給不足，還差 ${cost-JSON.parse(before.world).eco.supply[0]}`,'commands: rejected native click explains deficit');
      }
      return {state:await state(),legacy:await legacy()};
    };
    for(const mobile of [true,false]){
      const errors=page.errors.length;
      const on=await native(false,mobile);await shot(`r126-${mobile?'touch':'mouse'}-production.png`);
      const off=await native(false,mobile,true);
      assert.deepEqual(off,on,'valve: complete world, accepted/rejected commands and R125 unchanged');
      assert.equal(await E('document.getElementById("pb-reason")'),null,'valve: no reason DOM');
      const oldButtons=await E('[...document.querySelectorAll("#prodbar button")].map(e=>({kind:Number(e.id.slice(4)),label:e.firstChild.textContent,title:e.title,aria:e.getAttribute("aria-label")}))');
      for(const b of oldButtons){assert.equal(b.title,`${b.label}：補給 ${UNIT_KINDS[b.kind].cost}`,'valve: original button title');assert.equal(b.aria,null,'valve: no added reason aria label');}
      assert(await E('document.getElementById("prodbar").classList.contains("production-countdown")'),'valve: R125 layout class preserved');
      await shot(`r126-${mobile?'touch':'mouse'}-off.png`);
      assert.equal(page.errors.length,errors,'native: no runtime or shader errors');
    }
    const cases={
      commands:async mutant=>{await native(mutant);},
      supply:async mutant=>{await fresh(mutant?'__r126mutant=supply':'');await patch({supply:[cost-7,999]});await click();assert.equal(await reason(),'坦克：補給不足，還差 7','supply: exact own deficit');},
      enemy:async mutant=>{await fresh(mutant?'__r126mutant=enemy':'');await patch({supply:[cost,0]});assert.equal(await title(),`坦克：補給 ${cost}`,'enemy: opponent funds never affect own availability');},
      queue:async mutant=>{await fresh(mutant?'__r126mutant=queue':'');await patch({supply:[999,999],queue:[Array(ECO_QUEUE).fill(0),[]]});await click();assert.equal(await reason(),'坦克：生產佇列已滿','queue: full queue explains rejection');},
      hq:async mutant=>{await fresh(mutant?'__r126mutant=hq':'');await E('__r126.destroy()');await frames();await click();assert.equal(await reason(),'坦克：指揮部已毀或不存在','hq: destruction explains rejection');await fresh();await patch({hq:[0,initial.eco.hq[1]]});await click();assert.equal(await reason(),'坦克：指揮部已毀或不存在','hq: missing HQ explains rejection');},
      feature:async mutant=>{await fresh(mutant?'__r126mutant=feature':'');await patch({inf:0});await click(UK_INFANTRY);assert.equal(await reason(),'步兵：本局未開放此單位','feature: unavailable expansion explains rejection');if(!mutant){await patch({guns:0,tanks:0});for(const kind of [4,5,6,7]){await click(kind);assert((await reason()).endsWith('本局未開放此單位'),'feature: each unavailable expansion rejected');}}},
      freshness:async mutant=>{await fresh(mutant?'__r126mutant=freshness':'');await patch({supply:[cost-7,999]});await click();await patch({supply:[cost-3,999]});assert.equal(await reason(),'坦克：補給不足，還差 3','freshness: same-tick deficit replaces prior feedback');const frozen=await state();await E('__r126.speed()');await sleep(80);await frames();assert.deepEqual(await state(),frozen,'readonly: paused presentation preserves entire world');assert.equal(await reason(),'坦克：補給不足，還差 3','paused: wall clock cannot change reason');await patch({supply:[cost,999]});assert.equal(await reason(),'','freshness: replenishment clears refusal');assert.equal(await title(),`坦克：補給 ${cost}`,'freshness: replenishment clears unavailable button');},
      identity:async mutant=>{await fresh(mutant?'__r126mutant=identity':'');await patch({supply:[0,999]});await click();assert((await reason()).includes('補給不足'),'fixture: feedback visible before replacement');const before=await state();await E('__r126.replace()');await frames();assert.equal(await reason(),'','identity: equal-value new world clears last-clicked feedback');assert.deepEqual(await state(),before,'identity: replacement fixture preserves values');await click();assert((await reason()).includes('補給不足'),'fixture: feedback shown before actual replay');await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1);__rts.pause(true)`);await frames();assert.equal(await reason(),'','identity: actual replay clears old clicked feedback');assert.equal((await state()).hash,initialHash,'identity: actual replay restores initial world');},
      hidden:async mutant=>{await fresh(mutant?'__r126mutant=hidden':'');await patch({supply:[0,999]});await click();await E('__r126.finish()');await frames();assert.equal(await reason(),'','hidden: battle end clears stale reason');assert(await E('document.getElementById("prodbar").hidden'),'hidden: end hides production');await fresh();await patch({supply:[0,999]});await click();await E('__r126.hide()');await frames();assert.equal(await reason(),'','hidden: nonbattle clears stale reason');await fresh();await patch({supply:[0,999]});await click();await E('document.getElementById("b-restart").click()');await frames();assert.equal(await reason(),'','hidden: restart clears stale reason');assert.equal(await E('__rts.phase()'),'build','hidden: actual restart');},
      population:async mutant=>{await fresh(mutant?'__r126mutant=population':'');await patch({supply:[999,999],queue:[[0],[]],prog:[UNIT_KINDS[0].buildTicks,0]});await E('__r126.population()');await frames();assert.equal(await title(),`坦克：補給 ${cost}`,'population: deployment cap not purchase blocker');await click();assert.equal(await reason(),'','population: accepted click has no false blocker');await E('__rts.stepN(1)');await frames();assert.equal((await E('__rts.eco()')).queue[0].length,2,'population: queue accepts despite deployment cap');assert.equal(await E('document.getElementById("pb-countdown").textContent'),'坦克：等待部署 · 後續 1','population: R125 waiting remains');},
      exit:async mutant=>{await fresh(mutant?'__r126mutant=exit':'');await patch({supply:[999,999],queue:[[0],[]],prog:[UNIT_KINDS[0].buildTicks,0]});await E('__r126.exit()');await frames();assert.equal(await title(),`坦克：補給 ${cost}`,'exit: obstructed deployment not purchase blocker');await click();await E('__rts.stepN(1)');await frames();assert.equal((await E('__rts.eco()')).queue[0].length,2,'exit: blocked exit still accepts purchase');assert.equal(await E('document.getElementById("pb-countdown").textContent'),'坦克：等待部署 · 後續 1','exit: R125 waiting remains');},
      valve:async mutant=>{await fresh('noR126=1'+(mutant?'&__r126mutant=valve':''));assert.equal(await E('document.getElementById("pb-reason")'),null,'valve: no reason element when disabled');},
      layout:async mutant=>{await fresh(mutant?'__r126mutant=layout':'');await patch({supply:[0,999],queue:[[0,1,2,3],[]],prog:[1,0]});for(const [width,height]of mutant?[[412,860]]:[[412,860],[860,412],[360,780],[1280,800]]){await viewport(width,height,width<1000);if(!mutant)await click(UK_TANK,width<1000);await layout(`${width}x${height}`);if(!mutant)await shot(`r126-${width}x${height}-reason.png`);}}
    };
    const targets={commands:'commands: each real click records exactly one original produce',supply:'supply: exact own deficit',enemy:'enemy: opponent funds never affect own availability',queue:'queue: full queue explains rejection',hq:'hq: destruction explains rejection',feature:'feature: unavailable expansion explains rejection',freshness:'freshness: same-tick deficit replaces prior feedback',identity:'identity: equal-value new world clears last-clicked feedback',hidden:'hidden: battle end clears stale reason',population:'population: deployment cap not purchase blocker',exit:'exit: obstructed deployment not purchase blocker',valve:'valve: no reason element when disabled',layout:'layout: complete production without overflow'};
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,name+': no runtime errors');record('OK Chrome '+name);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;let fail;try{await run(true);}catch(e){fail=e;}assert(fail instanceof assert.AssertionError&&fail.message.startsWith(targets[name]),'negative '+name+': first failure must be target, got '+(fail?.stack??'no failure'));assert.equal(page.errors.length,errors,'negative '+name+': no runtime errors');record('RED Chrome '+name+': '+targets[name]);}
  });
}
try{await main();}catch(error){const msg=String(error?.stack??error);record('FAIL '+msg);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg)&&!strictCI){console.error('NOT RUN R126 Chrome: local browser/socket unavailable; CI required.');process.exitCode=77;}else{console.error(error);process.exitCode=1;}}
finally{fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r126-browser.txt'),summary.join('\n')+'\n');fs.rmSync(temp,{recursive:true,force:true});}
