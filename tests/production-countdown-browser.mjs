// R125: actual browser rendering, native produce commands and isolated semantic mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UNIT_KINDS, TICK_HZ } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'r125-browser-'));
const strictCI=process.env.GITHUB_ACTIONS==='true'||!!process.env.GITHUB_RUN_ID||!!process.env.CI;
const summary=[],record=s=>{summary.push(s);console.log(s);};
const SEED=1944,log=[{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}}],initial=runLog(createWorld(SEED),log,1),initialHash=hashWorld(initial);
const plugin=mutant=>({name:'r125-test-only',enforce:'pre',transform(code,id){
  const rel=path.relative(ROOT,id).replaceAll('\\','/');
  const replace=(from,to)=>{assert.equal(code.split(from).length-1,1,'unique test anchor '+from);code=code.replace(from,to);};
  if(rel==='src/main.ts'){
    replace('(window as unknown as { __rts: typeof rts }).__rts = rts;',`(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r125 = { world: () => JSON.stringify(w), patch: (progress: number, queue: number[] = [0]) => { w.eco!.queue[0]=queue; w.eco!.prog[0]=progress; }, destroyHQ: () => {w.blds[w.eco!.hq[0]-1].hp=0;}, finish: () => {w.winner=0;}, speed: () => {speed=2;} };`);
    if(mutant)replace("  countdown: V.r125,","  countdown: q.get('__r125mutant') === 'valve' || V.r125,");
  }
  if(mutant&&rel==='src/ui/production.ts'){
    replace("const text = s.visible ? (s.countdown ?? '') : '';","const text = new URLSearchParams(location.search).get('__r125mutant') === 'hidden' ? '過期' : s.visible ? (s.countdown ?? '') : '';");
    replace("if (el.textContent !== text) el.textContent = text;","if (new URLSearchParams(location.search).get('__r125mutant') !== 'freshness' && el.textContent !== text) el.textContent = text;");
  }
  if(mutant&&rel==='src/ui/productionCountdown.ts'){
    replace('Math.ceil(remaining / TICK_HZ)',"(new URLSearchParams(location.search).get('__r125mutant') === 'rounding' ? 0 : Math.ceil(remaining / TICK_HZ))");
    replace(": '等待部署'",": new URLSearchParams(location.search).get('__r125mutant') === 'deployment' ? '已到場' : '等待部署'");
    replace('!hqAlive(w, SIDE_PLAYER)',"(!hqAlive(w, SIDE_PLAYER) && new URLSearchParams(location.search).get('__r125mutant') !== 'hq')");
  }
  return code;
}});
async function main(){
  const baseline=path.join(temp,'baseline'),broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true)],build:{outDir:broken}});
  if(process.argv.includes('--prepare-only')){record('PREPARED R125 baseline/mutant builds; Chrome not run');return;}
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8455,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>E('({world:__r125.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
    const text=()=>E('document.getElementById("pb-countdown")?.textContent??""');
    const viewport=async(width=412,height=860,mobile=true)=>{await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await frames();};
    const fresh=async(extra='')=>{await open('noR018=1&noR016=1&'+extra);assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1)`),initialHash,'fixture replay hash');await E('__rts.pause(true)');await frames();};
    const patch=async(prog,queue=[0])=>{await E(`__r125.patch(${prog},${JSON.stringify(queue)})`);await frames();};
    const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
    const layout=async label=>{
      const g=await E(`(()=>{const p=document.getElementById('prodbar'),t=document.getElementById('pb-countdown'),h=document.getElementById('hint');return {p:p.getBoundingClientRect().toJSON(),t:t.getBoundingClientRect().toJSON(),h:h.getBoundingClientRect().toJSON(),overflow:p.scrollWidth-p.clientWidth,textOverflow:t.scrollWidth-t.clientWidth,width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('#prodbar button,#hud .btns button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const r=e.getBoundingClientRect();return {id:e.id,r:r.toJSON(),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};})()`);
      record('R125 layout '+label+': '+JSON.stringify(g));
      assert(g.p.top>=0&&g.p.bottom<=g.h.top-6&&g.p.left>=0&&g.p.right<=g.width&&g.overflow<=0&&g.textOverflow<=0,'layout: production and countdown visible without overflow');
      assert(g.t.height>0&&g.t.top>=g.p.top&&g.t.bottom<=g.p.bottom,'layout: complete time row fits production');
      assert(g.buttons.every(b=>b.hit&&b.r.width>=44&&b.r.height>=44&&b.r.top>=0&&b.r.bottom<=g.height&&b.r.left>=0&&b.r.right<=g.width),'layout: native controls retain 44px visible unobstructed targets');
    };
    const legacy=()=>E('({supply:document.getElementById("pb-supply").textContent,queue:document.getElementById("pb-queue").textContent,progress:document.querySelector("#pb-prog i").style.width,buttons:[...document.querySelectorAll("#prodbar button")].map(e=>[e.id,e.textContent,e.className])})');
    // Native touch and mouse produce through the existing handlers, then compare exact replay/hash.
    for(const mobile of [true,false]){
      const errors=page.errors.length;
      await viewport(mobile?412:1280,mobile?860:800,mobile);await fresh();assert.equal(await text(),'','native: empty queue blank');
      const p=await E('(()=>{const e=document.getElementById("pb-k0"),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})()');assert(p[2],'native: produce button reachable');
      if(mobile)await touchTap(page,p[0],p[1]);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p[0],y:p[1],button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p[0],y:p[1],button:'left',buttons:0,clickCount:1});}
      await E('__rts.stepN(1)');await frames();const s=await state();assert.equal(s.log.at(-1).cmd.t,'produce','native: real button issues production');assert.equal(s.hash,hashWorld(runLog(createWorld(SEED),s.log,s.tick)),'native: Node replay identical');
      assert.equal(await text(),`坦克：製造剩餘 ${Math.ceil((UNIT_KINDS[0].buildTicks-1)/TICK_HZ)} 遊戲秒 · 後續 0`,'native: correct initial manufacture countdown');
      await layout(mobile?'mobile':'desktop');await shot(`r125-${mobile?'mobile':'desktop'}-production.png`);
      const frozen=await state(),oldText=await text();await E('__r125.speed()');await sleep(150);await frames();assert.deepEqual(await state(),frozen,'paused: complete world frozen at double speed');assert.equal(await text(),oldText,'paused: no wall-clock countdown');
      const beforeLegacy=await legacy();
      const world=JSON.parse(frozen.world);await fresh('noR125=1');await E(`__rts.playLog(${SEED},${JSON.stringify(s.log)},${s.tick});__rts.pause(true)`);await frames();assert.equal((await state()).world,JSON.stringify(world),'valve: complete world identical');assert.equal(await text(),'','valve: removed time text');assert.equal(await E('document.getElementById("pb-countdown")'),null,'valve: removed time row');await shot(`r125-${mobile?'mobile':'desktop'}-off.png`);
      assert.deepEqual(await legacy(),beforeLegacy,'valve: all original production content and buttons preserved');
      await E('document.getElementById("pb-k2").click();__rts.stepN(1)');await frames();assert.equal((await state()).log.at(-1).cmd.kind,2,'valve: native production handler remains active');
      await E('document.getElementById("b-restart").click()');await frames();assert.equal(await E('__rts.phase()'),'build','restart: build phase restored');assert.equal(await text(),'','restart: old countdown cleared');assert.equal(page.errors.length,errors,'native: no runtime or shader errors');
    }
    const cases={
      freshness:async mutant=>{await fresh(mutant?'__r125mutant=freshness':'');await patch(1);assert.equal(await text(),`坦克：製造剩餘 ${Math.ceil((UNIT_KINDS[0].buildTicks-1)/TICK_HZ)} 遊戲秒 · 後續 0`,'freshness: same-tick data visible');await patch(UNIT_KINDS[1].buildTicks-1,[1,0,2]);assert.equal(await text(),'榴彈砲：製造剩餘 1 遊戲秒 · 後續 2','freshness: same-tick kind and queue replaced');const s=await state();await frames();assert.deepEqual(await state(),s,'readonly: frame presentation never changes world');await E(`__rts.playLog(${SEED},${JSON.stringify(log)},1);__rts.pause(true)`);await frames();assert.equal(await text(),'','freshness: replay clears old queue');await patch(1);await E('document.getElementById("b-restart").click()');await frames();assert.equal(await text(),'','restart: enabled old countdown cleared');assert.equal(await E('__rts.phase()'),'build','restart: actual build state');},
      rounding:async mutant=>{await fresh(mutant?'__r125mutant=rounding':'');await patch(UNIT_KINDS[0].buildTicks-1);assert.equal(await text(),'坦克：製造剩餘 1 遊戲秒 · 後續 0','rounding: final positive tick not zero');},
      deployment:async mutant=>{await fresh(mutant?'__r125mutant=deployment':'');await patch(UNIT_KINDS[0].buildTicks,[0,1,7,2,4]);assert.equal(await text(),'坦克：等待部署 · 後續 4','deployment: completion not arrival promise');if(!mutant){for(const [width,height]of [[412,860],[860,412],[360,780]]){await viewport(width,height);await layout(`${width}x${height}-waiting`);await shot(`r125-${width}x${height}-waiting.png`);}}},
      hq:async mutant=>{await fresh(mutant?'__r125mutant=hq':'');await patch(0);await E('__r125.destroyHQ()');await frames();assert.equal(await text(),'','hq: same-tick destruction clears countdown');},
      hidden:async mutant=>{await fresh(mutant?'__r125mutant=hidden':'');await patch(0);await E('__r125.finish()');await frames();assert.equal(await text(),'','hidden: ended battle clears stale text');assert(await E('document.getElementById("prodbar").hidden'),'hidden: ended production row hidden');},
      valve:async mutant=>{await fresh('noR125=1'+(mutant?'&__r125mutant=valve':''));assert.equal(await E('document.getElementById("pb-countdown")'),null,'valve: no time element when disabled');}
    };
    const targets={freshness:'freshness: same-tick data visible',rounding:'rounding: final positive tick not zero',deployment:'deployment: completion not arrival promise',hq:'hq: same-tick destruction clears countdown',hidden:'hidden: ended battle clears stale text',valve:'valve: no time element when disabled'};
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,name+': no runtime errors');record('OK Chrome '+name);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const[name,run]of Object.entries(cases)){await viewport();const errors=page.errors.length;let fail;try{await run(true);}catch(e){fail=e;}assert(fail instanceof assert.AssertionError&&fail.message.startsWith(targets[name]),'negative '+name+': first failure must be target, got '+(fail?.stack??'no failure'));assert.equal(page.errors.length,errors,'negative '+name+': no runtime errors');record('RED Chrome '+name+': '+targets[name]);}
  });
}
try{await main();}catch(error){const msg=String(error?.stack??error);record('FAIL '+msg);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg)&&!strictCI){console.error('NOT RUN R125 Chrome: local browser/socket unavailable; CI required.');process.exitCode=77;}else{console.error(error);process.exitCode=1;}}
finally{fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r125-browser.txt'),summary.join('\n')+'\n');fs.rmSync(temp,{recursive:true,force:true});}
