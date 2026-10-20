// R122: real Chrome, ordinary selection, independently classified WebGL samples, isolated mutants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB, UNIT_KINDS, UK_MORTAR } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';
import { ECO_POP, ECO_INCOME_TICKS } from '../src/sim/eco.ts';
import { runScript } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r122-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = x => { summary.push(x); console.log(x); };
const hash = s => createHash('sha256').update(s).digest('hex');
const log = [{ tick: 0, cmd: { t: 'eco', inf: 0, guns: 1, tanks: 1 } }];
const world = runLog(createWorld(1944), log, 1), expected = hashWorld(world);
const armed = world.units.filter(u => u.alive && u.side === 0 && UNIT_KINDS[u.kind].range > 0);
// Independent analytic oracle: never call the product's solver or consume its reported geometry.
const samples = [];
for (let x = 12.25; x < 31.5; x += 0.5) for (let z = 12.25; z < 31.5; z += 0.5) {
  const ds = armed.map(u => ({ d: Math.hypot(x-u.x/SUB,z-u.z/SUB), lo: UNIT_KINDS[u.kind].minRange/SUB, hi: UNIT_KINDS[u.kind].range/SUB }));
  if (ds.some(v => Math.abs(v.d-v.hi)<0.45 || (v.lo>0 && Math.abs(v.d-v.lo)<0.45))) continue;
  if (world.blds.some(b => b.hp>0 && x>b.x-0.7 && x<b.x+b.w+0.7 && z>b.z-0.7 && z<b.z+b.d+0.7)) continue;
  if (world.units.some(u => Math.hypot(x-u.x/SUB,z-u.z/SUB)<1.1)) continue;
  const count = ds.filter(v => v.d>=v.lo && v.d<=v.hi).length;
  if (count === armed.length || count > 0) samples.push({ x, z, inside: count===armed.length });
}
const rings = armed.flatMap(u => [UNIT_KINDS[u.kind].range/SUB, UNIT_KINDS[u.kind].minRange/SUB].filter(r=>r>0).map(r=>({ id:u.id, radius:r, points:Array.from({length:96},(_,i)=>[u.x/SUB+Math.cos(i*Math.PI/48)*r,u.z/SUB+Math.sin(i*Math.PI/48)*r]).filter(([x,z])=>x>0.5&&z>0.5&&x<31.5&&z<31.5) })));
const hit = new Set();
const plugin = {
  name: 'r122-isolated-browser-mutants', enforce: 'pre',
  transform(code,id) {
    const rel=path.relative(ROOT,id.split('?')[0]).replaceAll('\\','/');
    const replace=(from,to,n=1)=>{ assert.equal(code.split(from).length-1,n,`unique mutant anchor ${rel}: ${from}`); code=code.replaceAll(from,to); hit.add(from); };
    if (rel==='src/main.ts') {
      replace('  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));', "  if (q.get('__r122mutant') === 'paint' && view.multi122) view.multi122.mesh.visible = false;\n  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));");
      // Source anchors are asserted so a refactor cannot silently disable a negative control.
      replace("q.get('noR122') !== '1'", "(q.get('__r122mutant') === 'valve' || q.get('noR122') !== '1')", 2);
      replace('if (rangeInfo !== lastRangeInfo)', "if (q.get('__r122mutant') !== 'freshness' && rangeInfo !== lastRangeInfo)");
    }
    if (rel==='src/render/multiRange.ts') {
      replace('inAllRanges = inAllRanges && d >= a.z && d <= a.w;', '${new URLSearchParams(location.search).get("__r122mutant") === "intersection" ? "inAllRanges = inAllRanges || (d >= a.z && d <= a.w);" : "inAllRanges = inAllRanges && d >= a.z && d <= a.w;"}');
    }
    return code;
  },
};

async function main() {
  const started=Date.now(), baseline=path.join(temp,'baseline'), broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin],build:{outDir:broken}});
  assert.equal(hit.size,4,'all semantic mutations applied');
  const overlay={};
  // Observation only: keep full shader diagnostics that the shared CDP logger abbreviates.
  const preload = `window.__r122ConsoleErrors=[];const original=console.error.bind(console);console.error=(...args)=>{window.__r122ConsoleErrors.push(args.map(x=>typeof x==='string'?x:String(x)).join(' ').slice(0,12000));original(...args);};`;
  await withBrowser({root:baseline,overlay,preload,port:8442,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
    const bounded=async(p,label)=>{let timer;const left=Math.min(8000,112000-(Date.now()-started));if(left<=0)throw Error('R122 operational deadline exceeded');try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`CDP timeout: ${label}`)),left);})]);}finally{clearTimeout(timer);}};
    const send=page.send.bind(page),evaluate=page.evaluate.bind(page);page.send=(m,a)=>bounded(send(m,a),m);page.evaluate=e=>bounded(evaluate(e),'evaluate');
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const diag=()=>E('__rts.multiRange()'),hint=()=>E('document.getElementById("hint").textContent');
    const checkRuntime=async label=>{
      const details=await E('(window.__r122ConsoleErrors||[]).join(" | ")');
      assert(!page.errors.length&&!details,`${label}: runtime/shader errors: ${details||page.errors.join(' | ')}`);
    };
    const pixels=async()=>{await checkRuntime('before canvas pixels');return E('document.querySelector("body>canvas").toDataURL()');};
    const info=()=>E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    const state=()=>E('({hash:__rts.hash(),log:__rts.log(),tick:__rts.tick()})');
    const viewport=async mobile=>{await page.send('Emulation.setDeviceMetricsOverride',{width:mobile?412:1280,height:mobile?860:800,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});};
    const fresh=async(q='')=>{await open('noR018=1&noR016=1&'+q);await E('__rts.pause(true)');assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(log)},1)`),expected,'exact Node replay');await E('__rts.pause(true);__rts.focus(24,24,0.75)');await frames();};
    const click=async(x,y,mobile)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
    const button=async(id,mobile)=>{const p=await E(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)];})()`);assert(p[2],'fixture: ordinary control unobstructed');await click(p[0],p[1],mobile);};
    const selectAll=async mobile=>{
      if(mobile)await button('b-all',true);
      else {const points=await E('__rts.units().filter(u=>u.alive&&u.side===0).map(u=>__rts.screenOf(u.id))');const x0=Math.floor(Math.min(...points.map(p=>p[0])))-12,x1=Math.ceil(Math.max(...points.map(p=>p[0])))+12,y0=Math.floor(Math.min(...points.map(p=>p[1])))-12,y1=Math.ceil(Math.max(...points.map(p=>p[1])))+12;assert(await E(`document.elementFromPoint(${x0},${y0})===document.querySelector('body>canvas')`),'fixture: drag begins on canvas');for(const [type,x,y]of [['mousePressed',x0,y0],['mouseMoved',x1,y1],['mouseReleased',x1,y1]]){await page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,modifiers:8});if(type==='mouseMoved'){await frames();assert(await E('!!document.querySelector("#selection-box:not([hidden])")'),'ordinary Shift-drag shows selection rectangle');}}await frames();}
      assert.deepEqual((await E('__rts.selected()')).sort((a,b)=>a-b),[1,2,3,4,9],'ordinary full-group selection');
    };
    const shot=async name=>{const p=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(p.data,'base64'));};
    const patches=async()=>{await checkRuntime('before analytic pixel patches');return E(`(()=>{const c=document.querySelector('body>canvas'),a=document.createElement('canvas');a.width=c.width;a.height=c.height;const ctx=a.getContext('2d');ctx.drawImage(c,0,0);const take=(x,z,r=0)=>{const p=__rts.screenOfPoint(x,0.045,z);if(p[0]<8||p[1]<130||p[0]>innerWidth-8||p[1]>innerHeight-170)return null;return Array.from(ctx.getImageData(Math.round(p[0])-r,Math.round(p[1])-r,2*r+1,2*r+1).data);};return {fill:${JSON.stringify(samples)}.map(p=>take(p.x,p.z)),rings:${JSON.stringify(rings)}.map(r=>r.points.map(([x,z])=>take(x,z,2)))};})()`);};
    const coverage=async mutant=>{
      await viewport(false);await fresh('noR122=1');await selectAll(false);await E('__rts.focus(16,16,0.6)');await frames();const off=await patches();
      await fresh(mutant?'__r122mutant=intersection':'');await selectAll(false);await E('__rts.focus(16,16,0.6)');await frames();const on=await patches();
      let inside=0,outside=0;
      samples.forEach((p,i)=>{if(!off.fill[i]||!on.fill[i])return;if(p.inside){if(JSON.stringify(off.fill[i])!==JSON.stringify(on.fill[i]))inside++;}else{outside++;assert.deepEqual(on.fill[i],off.fill[i],'intersection: no common fill outside any selected annulus');}});
      assert(inside>=8,'intersection: independently verified common interior visibly filled');assert(outside>=20,'fixture: false-common patches cover union-minus-intersection');
      rings.forEach((r,i)=>assert(on.rings[i].some((p,j)=>p&&off.rings[i][j]&&JSON.stringify(p)!==JSON.stringify(off.rings[i][j])),`rings: unit ${r.id} radius ${r.radius} paints its own visible boundary`));
      if(!mutant){await shot('r122-desktop-common-coverage.png');record(`R122 analytic samples: ${inside} painted common points, ${outside} unchanged excluded points; ${rings.length} individual boundaries`);}
    };
    const selection=async(mobile,mutant)=>{
      const name=mobile?'mobile':'desktop';await viewport(mobile);await fresh('noR122=1');await selectAll(mobile);const off=await pixels(),oldInfo=await info(),oldState=await state();
      await fresh(mutant?'__r122mutant=paint':'');await selectAll(mobile);
      assert.notEqual(hash(await pixels()),hash(off),`${name}: actual selected overlay pixels differ from valve-off`);
      const d=await diag();assert(d.shown&&d.armedCount===4&&d.selectedCount===5&&d.excludedCount===1,`${name}: group counts exclude unarmed observer`);
      const h=await hint();assert(h.includes('名目')&&h.includes('共同')&&h.includes('1')&&h.includes('視線')&&h.includes('命中'),`${name}: visible nominal/common/excluded/caveat legend`);
      assert.deepEqual(await state(),oldState,`${name}: UI preserves world RNG and commands`);
      const now=await info();assert.equal(now.calls-oldInfo.calls,1,`${name}: one additional draw`);assert.equal(now.triangles-oldInfo.triangles,2,`${name}: two additional triangles`);assert(now.calls<=22&&now.triangles<=80000,`${name}: closeup budget`);
      const layout=await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),r=h.getBoundingClientRect(),b=p.getBoundingClientRect();return {bottom:r.bottom,top:r.top,right:r.right,scroll:h.scrollHeight,client:h.clientHeight,prod:b.bottom,height:innerHeight,width:innerWidth};})()`);assert(layout.bottom<=layout.height&&layout.right<=layout.width&&layout.top>=layout.prod+6&&layout.scroll<=layout.client,`${name}: common legend remains visible above production controls`);
      if(!mutant)await shot(`r122-${name}-multiselect.png`);
      // Existing public selection hook is used only for follow-up state transitions, not initial UI evidence.
      await E('__rts.select([4])');await frames();assert(!(await diag()).shown&&(await E('__rts.rangePreview()')).shown,`${name}: single selection returns to intact R113`);
      await E('__rts.select([])');await frames();assert(!(await diag()).shown&&!(await hint()).includes('共同'),`${name}: clear removes stale common legend`);
      await button('b-restart',mobile);assert.equal(await E('__rts.phase()'),'build');assert(!(await diag()).shown,`${name}: restart clears geometry`);const opening=await info();assert(opening.calls<=20&&opening.triangles<=80000,`${name}: opening budget`);
      record(`R122 ${name}: ${now.calls} calls/${now.triangles} triangles; delta +1/+2; opening ${opening.calls}/${opening.triangles}`);
    };
    const freshness=async mutant=>{
      await viewport(true);await fresh(mutant?'__r122mutant=freshness':'');await selectAll(true);await E('__rts.pause(true)');await frames();assert((await hint()).includes('多選 4 武裝'),'fixture: initial four-weapon legend rendered');const tick=await E('__rts.tick()');
      await E('__rts.select([4,9])');await frames();assert((await hint()).includes('多選 1 武裝')&&!(await hint()).includes('多選 4 武裝'),'freshness: same-tick group change refreshes visible legend');assert.equal(await E('__rts.tick()'),tick,'freshness: no timed HUD update rescues the fixture');assert((await diag()).armedCount===1&&(await diag()).excludedCount===1,'freshness: one armed plus observer');
      await E('__rts.select([9])');await frames();assert(!(await diag()).shown,'freshness: unarmed-only does not draw');assert.equal(await E('__rts.hash()'),expected);
    };
    const valve=async mutant=>{
      await viewport(true);await fresh('noR122=1'+(mutant?'&__r122mutant=valve':''));await selectAll(true);assert(!(await diag()).shown&&(await diag()).reason==='disabled','valve: noR122 disables multi-range renderer');
      await E('__rts.select([4])');await frames();assert((await E('__rts.rangePreview()')).shown,'valve: noR122 leaves single R113 enabled');
      const golden=hashWorld(runScript(1200));assert.equal(await E('__rts.runScript(1200)'),golden,'valve: reset preserves golden');assert(!(await diag()).shown&&(await diag()).reason==='disabled','valve: replay constructor retains noR122');
      await fresh('noR113=1');await selectAll(true);assert((await diag()).shown,'valve: noR113 does not disable R122');
    };
    const population=async()=>{
      const interval=UNIT_KINDS[UK_MORTAR].cost*ECO_INCOME_TICKS,spawnCount=ECO_POP-5;
      const production=[...log,...Array.from({length:spawnCount},(_,i)=>({tick:1+i*interval,cmd:{t:'produce',side:0,kind:UK_MORTAR}}))];
      const ticks=2+(spawnCount-1)*interval+UNIT_KINDS[UK_MORTAR].buildTicks,expectedWorld=runLog(createWorld(1944),production,ticks);
      assert.equal(expectedWorld.units.filter(u=>u.alive&&u.side===0).length,ECO_POP,'fixture: legal production replay reaches population cap');
      await viewport(true);let off;
      for(const enabled of [false,true]){await fresh(enabled?'':'noR122=1');assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(production)},${ticks})`),hashWorld(expectedWorld),'population: exact Node replay');await E('__rts.pause(true);__rts.focus(26,26,0.75)');await frames();await button('b-all',true);assert.equal((await E('__rts.selected()')).length,ECO_POP);const now=await info();if(!enabled)off=now;else{assert((await diag()).shown&&(await diag()).armedCount===ECO_POP-1,'population: all armed units included');assert.equal(now.calls-off.calls,1,'population: fixed one-call renderer');assert.equal(now.triangles-off.triangles,2,'population: fixed two-triangle renderer');assert(now.calls<=22&&now.triangles<=80000,'population: mobile closeup budget');await shot('r122-mobile-population-cap.png');record(`R122 population ${ECO_POP}: ${now.calls}/${now.triangles}, delta +1/+2`);}}
    };
    const cases={mobile:m=>selection(true,m),desktop:m=>selection(false,m),coverage,freshness,valve};
    for(const [name,run]of Object.entries(cases)){const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,`${name}: no runtime errors`);record(`OK real Chrome ${name}`);}
    await population();
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const [name,run]of Object.entries(cases)){const errors=page.errors.length;let failure;try{await run(true);}catch(e){failure=e;}const target=name==='mobile'||name==='desktop'?`${name}: actual selected overlay pixels differ from valve-off`:name==='coverage'?'intersection: no common fill outside any selected annulus':name==='freshness'?'freshness: same-tick group change refreshes visible legend':'valve: noR122 disables multi-range renderer';assert(failure instanceof assert.AssertionError&&failure.message.startsWith(target),`negative ${name}: expected targeted assertion, got ${failure?.stack??'no failure'}`);assert.equal(page.errors.length,errors,`negative ${name}: no unrelated runtime errors`);record(`RED real Chrome ${name}: ${target}`);}
  });
}
try{await main();fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r122-browser.txt'),summary.join('\n')+'\n');if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### R122 real multi-range guards\n${summary.map(x=>'- '+x).join('\n')}\n`);}
catch(error){const message=String(error?.stack??error);if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(message)&&!strictCI){console.error('NOT RUN R122 real Chrome guards: local browser/socket unavailable; CI must execute them.');console.error(error.message);process.exitCode=77;}else{console.error(error);console.error(`R122 browser FAIL: ${String(error.message).replace(/\s+/g,' ').slice(0,2400)}`);process.exitCode=1;}}
finally{fs.rmSync(temp,{recursive:true,force:true});}
