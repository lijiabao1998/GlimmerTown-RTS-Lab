// R127: test-only builds exercise actual Chrome DOM/input and exact first-failure mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UNIT_KINDS, UK_TANK } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r127-browser-'));
const strictCI=process.env.GITHUB_ACTIONS==='true'||!!process.env.GITHUB_RUN_ID||!!process.env.CI;
const summary=[],record=s=>{summary.push(s);console.log(s);};
const SEED=1944,log=[{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}}];
const initial=runLog(createWorld(SEED),log,1),initialHash=hashWorld(initial);
const M=name=>`new URLSearchParams(location.search).get('__r127mutant') === '${name}'`;
const plugin=mutants=>({name:'r127-test-only',enforce:'pre',transform(code,id){
  const rel=path.relative(ROOT,id).replaceAll('\\','/');
  const replace=(from,to)=>{assert.equal(code.split(from).length-1,1,'unique test anchor '+from);code=code.replace(from,to);};
  if(rel==='src/main.ts'){
    replace('(window as unknown as { __rts: typeof rts }).__rts = rts;',`(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r127 = {
 world: () => JSON.stringify(w),
 hp: (hp: number, maxHp=1000, side=0) => { Object.assign(w.blds[w.eco!.hq[side]-1], {hp,maxHp}); },
 invalid: (field: string, value: number) => { (w.blds[w.eco!.hq[0]-1] as any)[field]=value; },
 patch: (s: any) => { Object.assign(w.eco!, s); },
 hide: () => { phase='build'; },
 nonEco: () => { delete w.eco; },
 replace: () => { w=structuredClone(w); Object.assign(w.blds[w.eco!.hq[0]-1],{hp:333,maxHp:777}); },
 swap: () => { const b={...w.blds[w.eco!.hq[0]-1],id:w.blds.length+1,hp:456,maxHp:789};w.blds.push(b);w.eco!.hq[0]=b.id; },
 multi: () => { const targets=w.blds.filter(b=>b.kind!==5).slice(0,3); const arms=w.units.filter(u=>u.side===0&&(UNIT_KINDS[u.kind].armored||[1,4,5].includes(u.kind))); selected.clear(); for(const u of w.units.filter(u=>u.side===0&&u.alive))selected.add(u.id); for(let i=0;i<targets.length;i++)Object.assign(targets[i],{hp:[900,400,1][i],maxHp:1000}); for(let i=0;i<arms.length;i++)Object.assign(arms[i],{order:3,target:0,tx:targets[i%3].x,tz:targets[i%3].z}); fireMode=true; ui(); },
 speed: () => { speed=2; }
};`);
    if(mutants)replace("hq: q.get('noR127') !== '1',",`hq: ${M('valve')} || q.get('noR127') !== '1',`);
  }
  if(mutants&&rel==='src/ui/hqDurability.ts'){
    replace('w.eco.hq[SIDE_PLAYER]',`w.eco.hq[${M('enemy')} ? 1 : SIDE_PLAYER]`);
    replace('const state =',`if (${M('stored')}) return '我方指揮部：999/999 · 完好';
const state =`);
    replace("stageOf(b) === 1 ? '重損'",`stageOf(b) === 1 && !(${M('stage')}) ? '重損'`);
    replace("return '我方指揮部：未設置';",`return ${M('missing')} ? '我方指揮部：0/0 · 完好' : '我方指揮部：未設置';`);
    replace("b.hp <= 0 ? '已毀'",`b.hp <= 0 && !(${M('zero')}) ? '已毀'`);
  }
  if(mutants&&rel==='src/ui/production.ts'){
    replace('a.produce(it.kind);',`if (!(${M('commands')})) a.produce(it.kind);`);
    replace("const hqText = s.visible ? (s.hq ?? '') : '';",`const hqText = ${M('hidden')} && !s.visible ? '過期' : s.visible ? (s.hq ?? '') : '';`);
    replace('if (hqElement.textContent !== hqText)',`if (!(${M('freshness')} && hqElement.textContent) && hqElement.textContent !== hqText)`);
    replace('root.hidden = !s.visible;',`root.hidden = !s.visible; if (${M('layout')}) root.style.width='2000px';`);
  }
  if(mutants&&rel==='src/ui/commandMenu.ts'){
    replace('const finger =', `const finger = ${M('menuHold')} ? 0 :`);
  }
  return code;
}});
async function main(){
  const baseline=path.join(temp,'baseline'),broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true)],build:{outDir:broken}});
  if(process.argv.includes('--prepare-only')){record('PREPARED R127 baseline/mutant builds; Chrome not run');return;}
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8457,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:50},async({open,page})=>{
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>E('({world:__r127.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
    const text=()=>E('document.getElementById("pb-hq")?.textContent??""');
    const viewport=async(width=412,height=860,mobile=true)=>{await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await frames();};
    const fresh=async(extra='')=>{await open('noR018=1&noR016=1&'+extra);assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1)`),initialHash,'fixture: initial replay hash');await E('__rts.pause(true)');await frames();};
    const hp=async(value,max=1000,side=0)=>{await E(`__r127.hp(${value},${max},${side})`);await frames();};
    const patch=async value=>{await E(`__r127.patch(${JSON.stringify(value)})`);await frames();};
    const click=async(kind=UK_TANK,mobile=true)=>{
      const p=await E(`(()=>{const e=document.getElementById('pb-k${kind}'),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})()`);
      assert(p[2],'input: original production target reachable');
      if(mobile)await touchTap(page,p[0],p[1]);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p[0],y:p[1],button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p[0],y:p[1],button:'left',buttons:0,clickCount:1});}await frames();
    };
    const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
    const legacy=()=>E('({supply:document.getElementById("pb-supply").textContent,queue:document.getElementById("pb-queue").textContent,progress:document.querySelector("#pb-prog i").style.width,countdown:document.getElementById("pb-countdown").textContent,reason:document.getElementById("pb-reason").textContent,buttons:[...document.querySelectorAll("#prodbar button")].map(e=>[e.id,e.textContent,e.className,e.title,e.getAttribute("aria-label")])})');
    const native=async(mutant=false,mobile=true,off=false)=>{
      await viewport(mobile?412:1280,mobile?860:800,mobile);await fresh((mutant?'__r127mutant=commands':'')+(off?'&noR127=1':''));
      for(const [index,kind]of [UK_TANK,UK_TANK,2].entries()){
        const before=await state();await click(kind,mobile);const issued=await state();
        assert.equal(issued.log.length,before.log.length+1,'commands: each real click records exactly one original produce');
        assert.deepEqual(issued.log.at(-1),{tick:before.tick,cmd:{t:'produce',side:0,kind}},'commands: unchanged command data');
        assert.equal(issued.world,before.world,'commands: input alone does not mutate world');
        await E('__rts.stepN(1)');await frames();const after=await state();
        assert.equal(after.hash,hashWorld(runLog(createWorld(SEED),after.log,after.tick)),'commands: Node replay matches accepted and rejected clicks');
        const a=JSON.parse(after.world).eco,b=JSON.parse(before.world).eco;
        assert.equal(a.queue[0].length,b.queue[0].length+(index===1?0:1),'commands: simulation accepts or rejects once');
        assert.equal(a.supply[0],b.supply[0]-(index===1?0:UNIT_KINDS[kind].cost),'commands: exactly one debit or none');
        if(index===1)assert.equal(await E('document.getElementById("pb-reason").textContent'),`坦克：補給不足，還差 ${UNIT_KINDS[UK_TANK].cost-b.supply[0]}`,'valve: R126 rejection retained');
      }
      return {state:await state(),legacy:await legacy()};
    };
    for(const mobile of [true,false]){
      const errors=page.errors.length,on=await native(false,mobile);await shot(`r127-${mobile?'touch':'mouse'}-production.png`);
      const off=await native(false,mobile,true);
      assert.deepEqual(off,on,'valve: world commands and R125/R126 identical');
      assert.equal(await E('document.getElementById("pb-hq")'),null,'valve: no summary DOM');
      await shot(`r127-${mobile?'touch':'mouse'}-off.png`);
      assert.equal(page.errors.length,errors,'native: no runtime errors');
    }
    const hidden=async label=>{assert.equal(await text(),'','hidden: '+label+' clears summary');assert(await E('document.getElementById("pb-hq").hidden && document.getElementById("prodbar").hidden'),'hidden: '+label+' hides summary and bar');};
    const menuHold=async mutant=>{
      for(const [width,height]of mutant?[[412,860]]:[[412,860],[860,412],[360,780],[1280,800]]){
        // Keep the first viewport identical to the original R109 failing scenario.
        // Desktop-sized viewport also enables touch so the initiating release is real.
        await viewport(width,height,true);
        await open('noR018=1&noR006=1&noR016=1&'+(mutant?'__r127mutant=menuHold':''));
        await E('__rts.pause(true);__rts.runScript(0);__rts.issue({t:"eco",inf:1,guns:1,tanks:1});__rts.stepN(1);__rts.pause(true);__rts.focus(27,27,1);__rts.select([1,4,9]);');await frames();
        const menuState=async()=>({...(await state()),selected:await E('__rts.selected()'),cam:await E('__rts.cam()')});
        for(const action of ['cancel','he','smoke']){
          let p=await E('__rts.screenOf(4)');
          let gunPoint=await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName==='CANVAS'`);
          if(!gunPoint&&width!==412){
            // Landscape HUD may cover the gun projection. Use a measured free canvas
            // point instead, without changing any HUD geometry or input event semantics.
            p=await E(`(()=>{for(let y=80;y<innerHeight-8;y+=16)for(let x=innerWidth/2;x<innerWidth-8;x+=16){const g=__rts.groundAt(x,y);if(document.elementFromPoint(x,y)?.tagName==='CANVAS'&&g&&g[0]>=0&&g[0]<32&&g[1]>=0&&g[1]<32)return [x,y];}return null;})()`);
          }
          assert(p&&await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName==='CANVAS'`),'menu fixture: real hold starts on canvas');
          const before=await menuState();
          await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p[0],y:p[1],id:1}]});await sleep(650);await frames();
          const geometry=await E(`(()=>{const e=document.getElementById('command-menu'),r=e.getBoundingClientRect();return {open:!e.hidden,rect:r.toJSON(),label:document.getElementById('cm-target').textContent,buttons:[...e.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {id:b.id,rect:q.toJSON(),hit:document.elementFromPoint(q.x+q.width/2,q.y+q.height/2)===b}})};})()`);
          assert(geometry.open,'menu fixture: actual hold opens menu before release');
          record(`R127 hold ${width}x${height} ${action}: `+JSON.stringify({point:p,...geometry}));
          if(!mutant&&action==='cancel')await shot(`r127-${width}x${height}-menu-held.png`);
          const r=geometry.rect;
          assert(p[0]<r.left||p[0]>r.right||p[1]<r.top||p[1]>r.bottom,'menuHold: menu excludes initiating release point');
          assert(r.left>=0&&r.top>=0&&r.right<=width&&r.bottom<=height,'menuHold: menu remains inside viewport');
          assert.deepEqual(await menuState(),before,'menuHold: opening does not change world log selection or camera');
          await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames();
          assert(await E('!document.getElementById("command-menu").hidden'),'menuHold: release leaves menu open');
          assert.deepEqual(await menuState(),before,'menuHold: release causes no unintended action');
          const b=geometry.buttons.find(b=>b.id==='cm-'+action);
          assert(b.hit&&b.rect.width>=44&&b.rect.height>=44,'menuHold: later explicit target remains reachable and 44px');
          await touchTap(page,b.rect.x+b.rect.width/2,b.rect.y+b.rect.height/2);await frames();
          assert(await E('document.getElementById("command-menu").hidden'),'menuHold: explicit choice closes menu');
          const after=await menuState();
          if(action==='cancel')assert.deepEqual(after,before,'menuHold: explicit cancel preserves complete state');
          else{
            assert.deepEqual({...after,log:before.log},before,'menuHold: explicit choice only records command');
            const coordinates=geometry.label.match(/砲擊格 (\d+) · (\d+)/);assert(coordinates,'menu fixture: frozen cell label present');
            const target=gunPoint?{x:29,z:29}:{x:Number(coordinates[1])-1,z:Number(coordinates[2])-1};
            assert.deepEqual(after.log,[...before.log,{tick:before.tick,cmd:{t:'fireAt',side:0,ids:[4],...target,...(action==='smoke'?{ammo:'smoke'}:{})}}],'menuHold: deliberate HE or smoke records one correct original command');
            if(!mutant)await shot(`r127-${width}x${height}-menu-${action}.png`);
          }
        }
      }
    };
    const cases={
      menuHold,
      commands:async mutant=>{await native(mutant);},
      stored:async mutant=>{await fresh(mutant?'__r127mutant=stored':'');await hp(777,777);assert.equal(await text(),'我方指揮部：777/777 · 完好','stored: exact saved durability');await hp(776,777);assert.equal(await text(),'我方指揮部：776/777 · 受損','stored: nonfull is damaged');},
      enemy:async mutant=>{await fresh(mutant?'__r127mutant=enemy':'');await hp(800);await hp(1,999,1);assert.equal(await text(),'我方指揮部：800/1000 · 受損','enemy: opponent never replaces own summary');},
      stage:async mutant=>{await fresh(mutant?'__r127mutant=stage':'');await hp(700);assert.equal(await text(),'我方指揮部：700/1000 · 重損','stage: inclusive seventy percent boundary');await hp(701);assert.equal(await text(),'我方指揮部：701/1000 · 受損','stage: above boundary');await hp(1);assert.equal(await text(),'我方指揮部：1/1000 · 重損','stage: last hit point');},
      zero:async mutant=>{await fresh(mutant?'__r127mutant=zero':'');await hp(0);assert.equal(await text(),'我方指揮部：0/1000 · 已毀','zero: destroyed before simulation winner update');await E('__rts.stepN(1)');await frames();assert.equal(await E('__rts.winner()'),1,'zero: real simulation step resolves HQ loss');await hidden('real HQ defeat');await shot('r127-defeat-hidden.png');},
      missing:async mutant=>{await fresh(mutant?'__r127mutant=missing':'');assert.notEqual(await text(),'我方指揮部：未設置','missing: valid HQ is configured');for(const value of [0,999999]){await patch({hq:[value,initial.eco.hq[1]]});assert.equal(await text(),'我方指揮部：未設置','missing: invalid HQ has no fallback');}for(const [field,value]of [['builtBy',1],['kind',0],['id',999]]){await fresh();await E(`__r127.invalid('${field}',${value})`);await frames();assert.equal(await text(),'我方指揮部：未設置','missing: identity kind and ownership validated');}},
      freshness:async mutant=>{await fresh(mutant?'__r127mutant=freshness':'');await hp(800);assert.equal(await text(),'我方指揮部：800/1000 · 受損','freshness: same-tick damage is current');const before=await state();await E('__r127.speed()');await sleep(80);await frames();assert.deepEqual(await state(),before,'readonly: paused display does not mutate whole world');assert.equal(await text(),'我方指揮部：800/1000 · 受損','paused: no wall clock change');await E('__r127.swap()');await frames();assert.equal(await text(),'我方指揮部：456/789 · 重損','identity: same-tick HQ replacement');await E('__r127.replace()');await frames();assert.equal(await text(),'我方指揮部：333/777 · 重損','identity: replacement world current');await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1);__rts.pause(true)`);await frames();const b=initial.blds[initial.eco.hq[0]-1];assert.equal(await text(),`我方指揮部：${b.hp}/${b.maxHp} · 完好`,'identity: actual replay resets durability');},
      hidden:async mutant=>{await fresh(mutant?'__r127mutant=hidden':'');await E('__r127.hide()');await frames();await hidden('build phase');await fresh();await E('__r127.nonEco()');await frames();await hidden('non economy');await fresh();await E('document.getElementById("b-restart").click()');await frames();assert.equal(await E('__rts.phase()'),'build','hidden: actual restart enters build');await hidden('restart');},
      valve:async mutant=>{await fresh('noR127=1'+(mutant?'&__r127mutant=valve':''));assert.equal(await E('document.getElementById("pb-hq")'),null,'valve: no summary element when disabled');await fresh('noR125=1&noR126=1');assert((await text()).includes('我方指揮部'),'valve: R127 independent of R125/R126');assert.equal(await E('document.getElementById("pb-countdown")'),null);assert.equal(await E('document.getElementById("pb-reason")'),null);},
      layout:async mutant=>{await fresh(mutant?'__r127mutant=layout':'');await hp(456,789);await E('__r127.multi()');await frames();assert((await E('document.getElementById("hint").textContent')).includes('另 1 棟未列'),'fixture: combined R124 multi-target hint active');await patch({supply:[0,999],queue:[[0,1,2,3],[]],prog:[1,0]});for(const [width,height]of mutant?[[412,860]]:[[412,860],[860,412],[360,780],[1280,800]]){
        await viewport(width,height,width<1000);if(!mutant)await click(UK_TANK,width<1000);
        const g=await E(`(()=>{const p=document.getElementById('prodbar'),h=document.getElementById('hint');return {p:p.getBoundingClientRect().toJSON(),h:h.getBoundingClientRect().toJSON(),overflow:p.scrollWidth-p.clientWidth,width:innerWidth,height:innerHeight,rows:['pb-countdown','pb-reason','pb-hq'].map(id=>{const e=document.getElementById(id);return {r:e.getBoundingClientRect().toJSON(),overflow:e.scrollWidth-e.clientWidth}}),buttons:[...document.querySelectorAll('#prodbar button,#hud .btns button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {r:r.toJSON(),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};})()`);
        record(`R127 layout ${width}x${height}: `+JSON.stringify(g));
        if(!mutant)await shot(`r127-${width}x${height}-summary.png`);
        assert(g.p.top>=0&&g.p.bottom<=g.h.top-6&&g.p.left>=0&&g.p.right<=g.width&&g.overflow<=0,'layout: complete production without overflow');
        for(const row of g.rows)assert(row.r.height>0&&row.r.top>=g.p.top&&row.r.bottom<=g.p.bottom&&row.overflow<=0,'layout: all status rows readable');
        assert(g.rows[0].r.bottom<=g.rows[1].r.top&&g.rows[1].r.bottom<=g.rows[2].r.top,'layout: status rows do not overlap');
        assert(g.buttons.every(b=>b.hit&&b.r.width>=44&&b.r.height>=44&&b.r.top>=0&&b.r.bottom<=g.height&&b.r.left>=0&&b.r.right<=g.width),'layout: original controls visible reachable and 44px');
      }}
    };
    const targets={menuHold:'menuHold: menu excludes initiating release point',commands:'commands: each real click records exactly one original produce',stored:'stored: exact saved durability',enemy:'enemy: opponent never replaces own summary',stage:'stage: inclusive seventy percent boundary',zero:'zero: destroyed before simulation winner update',missing:'missing: invalid HQ has no fallback',freshness:'freshness: same-tick damage is current',hidden:'hidden: build phase clears summary',valve:'valve: no summary element when disabled',layout:'layout: complete production without overflow'};
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,name+': no runtime errors');record('OK Chrome '+name);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;let fail;try{await run(true);}catch(e){fail=e;}assert(fail instanceof assert.AssertionError&&fail.message.startsWith(targets[name]),'negative '+name+': first failure must be target, got '+(fail?.stack??'no failure'));assert.equal(page.errors.length,errors,'negative '+name+': no runtime errors');record('RED Chrome '+name+': '+targets[name]);}
  });
}
try{await main();}catch(error){const msg=String(error?.stack??error);record('FAIL '+msg);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg)&&!strictCI){console.error('NOT RUN R127 Chrome: local browser/socket unavailable; CI required.');process.exitCode=77;}else{console.error(error);process.exitCode=1;record('R127 FIRST RED '+String(error.message).replace(/\n/g,' '));}}
finally{fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r127-browser.txt'),summary.join('\n')+'\n');fs.rmSync(temp,{recursive:true,force:true});}
