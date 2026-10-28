// R124: actual Chrome UI; observation and deliberate fixture transitions exist only in temporary builds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB, UNIT_KINDS, UK_TANK, UK_HOWITZER, BK_HQ } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r124-browser-'));
const strictCI=process.env.GITHUB_ACTIONS==='true'||!!process.env.GITHUB_RUN_ID||!!process.env.CI;
const summary=[], record=x=>{summary.push(x);console.log(x);};
const digest=x=>createHash('sha256').update(x).digest('hex');
const SEED=1944, ecoLog=[{tick:0,cmd:{t:'eco',inf:1,guns:1,tanks:1}}];
const initial=runLog(createWorld(SEED),ecoLog,1), initialHash=hashWorld(initial);
const tank=initial.units.find(u=>u.side===0&&u.kind===UK_TANK);
const gun=initial.units.find(u=>u.side===0&&u.kind===UK_HOWITZER);
const observer=initial.units.find(u=>u.side===0&&u.kind===2);
const infantry=initial.units.find(u=>u.side===0&&u.kind===3);
const tankTarget=initial.blds.filter(b=>b.kind!==BK_HQ&&b.hp>0).map(b=>{
  const cells=[];
  for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++){
    const w=structuredClone(initial);step(w,[{t:'fireAt',side:0,ids:[tank.id],x,z}]);
    if(w.events.some(e=>e.e==='fire'&&e.unit===tank.id))cells.push([x,z]);
  }
  return {...b,cells};
}).find(b=>b.cells.length);
const smokeTarget=initial.blds.filter(b=>b.kind!==BK_HQ&&b.hp>0).map(b=>{
  const cells=[];
  for(let z=b.z;z<b.z+b.d;z++)for(let x=b.x;x<b.x+b.w;x++){
    const w=structuredClone(initial);step(w,[{t:'fireAt',side:0,ids:[gun.id],x,z,ammo:'smoke'}]);
    if(w.events.some(e=>e.e==='fire'&&e.unit===gun.id))cells.push([x,z]);
  }
  return {...b,cells};
}).find(b=>b.cells.length);
assert(tank&&gun&&observer&&infantry&&tankTarget&&smokeTarget,'fixture: actual native bombardment targets exist');
// Explicit independent product oracle. No imported presentation helper or stage/material helper.
const kinds=new Set([0,1,4,5,6,7]);
const expected=(world,ids)=>{
  const unique=new Map();
  for(const u of world.units){
    if(!ids.includes(u.id)||!u.alive||u.side!==0||!kinds.has(u.kind)||u.order!==3||(u.target!==0&&!(u.fireAmmo===3&&u.target>0)))continue;
    if(!Number.isInteger(u.tx)||!Number.isInteger(u.tz)||u.tx<0||u.tz<0||u.tx>=world.n||u.tz>=world.n)continue;
    const b=world.blds.find(b=>b.id===world.occ[u.tz*world.n+u.tx]);if(b)unique.set(b.id,b);
  }
  if(!unique.size)return '';
  const blds=[...unique.values()].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id);
  const text=blds.slice(0,2).map(b=>{
    const material=b.kind===2?'木造':[3,8].includes(b.kind)?'石造':[6,9].includes(b.kind)?'混凝土':'磚造';
    const stage=b.hp<=0?'瓦礫':b.hp/b.maxHp<=0.7?'重損':'完整';
    return `#${b.id}(${b.x},${b.z}) ${material} ${b.hp}/${b.maxHp} ${stage}`;
  }).join('；');
  return `掩體目標 ${blds.length}：${text}${blds.length>2?`；另 ${blds.length-2} 棟未列（低耐久優先）`:''}`;
};
const hits=new Set();
const plugin=mutant=>({name:'r124-browser-observation',enforce:'pre',transform(code,id){
  const rel=path.relative(ROOT,id.split('?')[0]).replaceAll('\\','/');
  const replace=(from,to,n=1)=>{assert.equal(code.split(from).length-1,n,`unique R124 source anchor ${rel}: ${from}`);code=code.replaceAll(from,to);if(mutant)hits.add(rel+':'+from);};
  if(rel==='src/main.ts'){
    replace('(window as unknown as { __rts: typeof rts }).__rts = rts;',`(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r124Test = {
  world: () => JSON.stringify(w),
  pick: (x: number, y: number) => ({ unit: pickUnit(x,y), building: view.buildingAt(x,y,innerWidth,innerHeight) }),
  // Synthetic adversarial transitions, deliberately without ticking or refreshing the HUD.
  patchUnit: (id: number, patch: object) => Object.assign(w.units.find(u=>u.id===id)!,patch),
  patchBuilding: (id: number, patch: object) => Object.assign(w.blds.find(b=>b.id===id)!,patch),
  replaceSelection: (ids: number[]) => { selected.clear(); for(const id of ids)selected.add(id); },
  setCoverValve: (enabled: boolean) => { if(enabled)q.delete('noR124');else q.set('noR124','1');hud?.update(); },
};`);
    if(mutant){
      replace("V.r124","(q.get('__r124mutant') === 'valve' || V.r124)",3);   // R060：閥從閥表來
      replace('if (coverInfo !== lastCoverInfo)',"if (q.get('__r124mutant') !== 'freshness' && coverInfo !== lastCoverInfo)");
    }
  }
  if(mutant&&rel==='src/ui/hud.ts'){
    replace("root.classList.toggle('cover-durability', !!s.coverEnabled);","root.classList.toggle('cover-durability', !!s.coverEnabled && new URLSearchParams(location.search).get('__r124mutant') !== 'layout');");
    replace('if (s.hint === undefined && s.coverInfo)',"if (new URLSearchParams(location.search).get('__r124mutant') !== 'hidden' && (s.hint === undefined || new URLSearchParams(location.search).get('__r124mutant') === 'priority') && s.coverInfo)");
  }
  if(mutant&&rel==='src/ui/coverDurability.ts'){
    replace('!u.alive || u.side !== SIDE_PLAYER',"(!u.alive && new URLSearchParams(location.search).get('__r124mutant') !== 'dead') || (u.side !== SIDE_PLAYER && new URLSearchParams(location.search).get('__r124mutant') !== 'enemy')");
    replace('u.fireAmmo === SHELL_SMOKE && u.target > 0',"u.fireAmmo === SHELL_SMOKE && u.target > 0 && new URLSearchParams(location.search).get('__r124mutant') !== 'smoke'");
    replace('u.order !== ORD_FIRE_AT',"(u.order !== ORD_FIRE_AT && new URLSearchParams(location.search).get('__r124mutant') !== 'order')");
    replace('a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id',"new URLSearchParams(location.search).get('__r124mutant') === 'sort' ? a.id - b.id : a.hp * b.maxHp - b.hp * a.maxHp || a.id - b.id");
  }
  return code;
}});

async function main(){
  const started=Date.now(),baseline=path.join(temp,'baseline'),broken=path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true)],build:{outDir:broken}});
  assert.equal(hits.size,9,'all R124 observation and semantic mutant anchors applied');
  // Allows syntax/build validation in restricted executors without claiming Chrome was run.
  if(process.argv.includes('--prepare-only')){record('PREPARED R124 baseline and isolated mutant builds; browser not run');return;}
  const overlay={};
  await withBrowser({root:baseline,overlay,port:8444,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page})=>{
    const bounded=async(p,label)=>{const left=Math.min(8000,112000-(Date.now()-started));if(left<=0)throw Error('R124 operational deadline exceeded');let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CDP timeout: '+label)),left);})]);}finally{clearTimeout(timer);}};
    const send=page.send.bind(page),evaluate=page.evaluate.bind(page);page.send=(m,a)=>bounded(send(m,a),m);page.evaluate=e=>bounded(evaluate(e),'evaluate');
    const E=e=>page.evaluate(e),frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const hint=()=>E('document.getElementById("hint").textContent');
    const state=()=>E('({world:__r124Test.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
    const world=async()=>JSON.parse((await state()).world);
    const status=async()=>expected(await world(),await E('__rts.selected()'));
    const info=()=>E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    const pixels=()=>E('document.querySelector("body>canvas").toDataURL()');
    const ranges=()=>E('({single:__rts.rangePreview(),multi:__rts.multiRange()})');
    const viewport=async(width=412,height=860,mobile=true)=>{await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await frames();};
    const fresh=async(extra='')=>{await open('noR018=1&noR016=1&'+extra);await E('__rts.pause(true)');assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(ecoLog)},1)`),initialHash,'fixture: Node eco replay matches');await E('__rts.pause(true);__rts.focus(27,27,0.85)');await frames();};
    const click=async(x,y,mobile)=>{if(mobile)await touchTap(page,x,y);else{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});}await frames();};
    const button=async(id,mobile)=>{const p=await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))];})()`);assert(p[2],`fixture: ${id} control unobstructed`);await click(p[0],p[1],mobile);};
    const select=async(id,mobile)=>{const u=(await world()).units.find(u=>u.id===id);await E(`__rts.focus(${u.x/SUB},${u.z/SUB},0.85)`);await frames();const p=await E(`__rts.screenOf(${id})`);assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: native unit selection unobstructed');await click(p[0],p[1],mobile);assert.deepEqual(await E('__rts.selected()'),[id],'fixture: native selection selects intended unit');};
    const assertStatus=async(label,wanted)=>{const text=await hint();assert(wanted?text.includes(wanted)&&text.split('掩體目標').length===2:!text.includes('掩體目標'),label);return text;};
    const assertNode=async label=>{const s=await state();assert.equal(s.hash,hashWorld(runLog(createWorld(SEED),s.log,s.tick)),`${label}: native command replay identical in Node`);};
    const shot=async name=>{const s=await page.send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(s.data,'base64'));};
    let narrowBaseline=null;
    const layout=async(label,check=true)=>{
      const g=await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),r=h.getBoundingClientRect(),b=p.getBoundingClientRect();const toolbar=document.querySelector('#hud .btns'),stats=document.querySelector('#hud .top'),mini=document.getElementById('minimap');return {toolbar:toolbar.getBoundingClientRect().toJSON(),stats:stats.getBoundingClientRect().toJSON(),statsOverflow:stats.scrollWidth-stats.clientWidth,mini:mini?.getBoundingClientRect().toJSON(),hint:r.toJSON(),prod:b.toJSON(),shown:!p.hidden,scrollH:h.scrollHeight,clientH:h.clientHeight,scrollW:h.scrollWidth,clientW:h.clientWidth,width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('#prodbar button,#hud .btns button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const q=e.getBoundingClientRect();return {id:e.id||e.textContent,w:q.width,h:q.height,left:q.left,right:q.right,top:q.top,bottom:q.bottom,hit:e.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))}})};})()`);
      record(`R124 layout ${label}: ${JSON.stringify(g)}`);
      const invalid=b=>b.w<44||b.h<44||b.left<0||b.right>g.width||b.top<0||b.bottom>g.height||!b.hit;
      const brief={size:[g.width,g.height],toolbar:[g.toolbar.left,g.toolbar.top,g.toolbar.right,g.toolbar.bottom],stats:[g.stats.left,g.stats.top,g.stats.right,g.stats.bottom,g.statsOverflow],mini:g.mini?[g.mini.left,g.mini.top,g.mini.right,g.mini.bottom]:null,hint:[g.hint.left,g.hint.top,g.hint.right,g.hint.bottom],prod:[g.prod.top,g.prod.bottom],overflow:[g.scrollW-g.clientW,g.scrollH-g.clientH],invalidButtons:g.buttons.filter(invalid)};
      if(!check){narrowBaseline=brief;return g;}
      const evidence=JSON.stringify({enabled:brief,...(label==='narrow-multi'?{baseline:narrowBaseline}:{})});
      assert(g.shown&&g.prod.bottom<=g.hint.top-6&&g.prod.top>=0&&g.hint.bottom<=g.height&&g.hint.top>=0&&g.hint.left>=0&&g.hint.right<=g.width&&g.scrollH<=g.clientH&&g.scrollW<=g.clientW,`${label}: complete durability hint and production row visible with clearance; ${evidence}`);
      assert(g.buttons.every(b=>b.w>=44&&b.h>=44&&b.left>=0&&b.right<=g.width&&b.top>=0&&b.bottom<=g.height&&b.hit),`${label}: existing 44px toolbar and production targets remain usable; ${evidence}`);
      if(g.width<=411)assert(g.toolbar.bottom<=g.stats.top&&g.stats.left>=0&&g.stats.right<=g.width&&g.statsOverflow<=0&&g.mini&&g.stats.bottom<=g.mini.top&&g.mini.left>=0&&g.mini.right<=g.width&&g.mini.bottom<=g.prod.top,`${label}: narrow toolbar, full top stats, minimap and production do not overlap; ${evidence}`);
    };
    const fireTank=async mobile=>{
      await select(tank.id,mobile);const b=tankTarget;await E(`__rts.focus(${b.x+b.w/2},${b.z+b.d/2},0.85)`);await frames();
      const target=await E(`(()=>{const b=${JSON.stringify(b)};for(let y=0;y<=3;y+=0.25)for(let z=b.z+0.25;z<b.z+b.d;z+=0.5)for(let x=b.x+0.25;x<b.x+b.w;x+=0.5){const p=__rts.screenOfPoint(x,y,z),hit=__r124Test.pick(...p),c=hit.building;if(!hit.unit&&c&&b.cells.some(v=>v[0]===c[0]&&v[1]===c[1])&&document.elementFromPoint(...p)===document.querySelector('body>canvas'))return {p,cell:c};}return null;})()`);
      assert(target,'fixture: unobstructed building surface exists');const before=await state();await click(target.p[0],target.p[1],mobile);
      assert.deepEqual((await state()).log.at(-1),{tick:before.tick,cmd:{t:'fireAt',side:0,ids:[tank.id],x:target.cell[0],z:target.cell[1]}},'fixture: native building click issues bombardment');
      assert.equal((await state()).hash,before.hash,'fixture: paused native order is queued without world mutation');await E('__rts.stepN(1)');await frames();
      assert.equal((await world()).units.find(u=>u.id===tank.id).cooldown,UNIT_KINDS[UK_TANK].reload,'fixture: real shot starts tank reload');await assertNode('tank bombardment');
    };
    const native=async(mobile,mutant)=>{
      const name=mobile?'mobile':'desktop';await viewport(mobile?412:1280,mobile?860:800,mobile);await fresh('noR124=1');await fireTank(mobile);
      const off={hint:await hint(),state:await state(),pixels:await pixels(),info:await info(),ranges:await ranges(),buttons:await E('document.querySelectorAll("button").length')};
      assert(!off.hint.includes('掩體目標'),'fixture: valve-off baseline has no durability text');if(!mutant)await shot(`r124-${name}-off.png`);
      await fresh(mutant?'__r124mutant=hidden':'');await fireTank(mobile);const text=await status();assert(text,'fixture: native bombardment resolves building');await assertStatus(`${name}: native target durability visible`,text);
      assert.deepEqual(await state(),off.state,`${name}: valve preserves complete world, RNG, events and commands`);assert.deepEqual(await info(),off.info,`${name}: no rendering cost from text`);assert.equal(digest(await pixels()),digest(off.pixels),`${name}: valve WebGL pixels identical`);assert.deepEqual(await ranges(),off.ranges,`${name}: previous range information intact`);assert.equal(await E('document.querySelectorAll("button").length'),off.buttons,`${name}: no new controls`);
      assert.equal((await hint()).replace('。'+text,''),off.hint,`${name}: exact previous HUD restored by valve`);await layout(name);if(!mutant)await shot(`r124-${name}-target.png`);
      const budget=await info();record(`R124 ${name} combat: ${JSON.stringify(budget)}`);assert(budget.calls<=22&&budget.triangles<=80000,`${name}: unchanged combat budget`);
      const frozen=await state(),frozenText=await hint();await sleep(150);await frames();assert.deepEqual(await state(),frozen,`${name}: pause freezes complete simulation`);assert.equal(await hint(),frozenText,`${name}: wall time never consumes durability`);
      await select(observer.id,mobile);await assertStatus(`${name}: observer does not disclose old target`,'');await select(infantry.id,mobile);await assertStatus(`${name}: infantry does not disclose old target`,'');await select(tank.id,mobile);await assertStatus(`${name}: same-tick reselection reconstructs target`,text);
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await frames();await assertStatus(`${name}: native Escape clears durability`,'');
      await select(tank.id,mobile);const oldTick=await E('__rts.tick()');await E(`__rts.playLog(${SEED},${JSON.stringify(ecoLog)},1);__rts.pause(true)`);await frames();await assertStatus(`${name}: replay removes previous target`,'');assert((await E('__rts.tick()'))<oldTick,'fixture: replay actually replaced world');
      await button('b-restart',mobile);await assertStatus(`${name}: restart/build removes previous target`,'');assert.equal(await E('__rts.phase()'),'build');const opening=await info();record(`R124 ${name} opening: ${JSON.stringify(opening)}`);assert(opening.calls<=20&&opening.triangles<=80000,`${name}: unchanged opening budget`);
    };
    const quiet='noR113=1&noR122=1&noR115=1&noR116=1&noR123=1';
    const freshness=async mutant=>{
      await viewport();await fresh(quiet+(mutant?'&__r124mutant=freshness':''));await fireTank(true);const old=await state(),b=(await world()).blds.find(b=>b.id===tankTarget.id);
      await E(`__r124Test.patchBuilding(${b.id},{hp:${Math.floor(b.maxHp*0.7)}})`);await frames();assert.equal((await state()).tick,old.tick,'fixture: damage transition occurs without tick/control refresh');await assertStatus('freshness: same-tick damage updates current hp and stage',await status());
      await E(`__r124Test.patchBuilding(${b.id},{hp:0})`);await frames();await assertStatus('freshness: same-tick rubble remains explicit',await status());assert((await hint()).includes('瓦礫'),'freshness: destroyed target not reported intact');if(!mutant)await shot('r124-mobile-rubble.png');
      await E('__r124Test.replaceSelection([])');await frames();await assertStatus('freshness: same-tick selection clear removes stale target','');
    };
    const multi=async mutant=>{
      await viewport();await fresh(mutant?'__r124mutant=sort':'');
      const w=await world(),arms=w.units.filter(u=>u.side===0&&kinds.has(u.kind));const targets=w.blds.filter(b=>b.kind!==BK_HQ).slice(0,3);
      assert(arms.length>=4&&targets.length===3,'fixture: three distinct cover targets and duplicate shooter');
      for(let i=0;i<targets.length;i++){const b=targets[i];await E(`__r124Test.patchBuilding(${b.id},{hp:${[900,400,1][i]},maxHp:1000})`);}
      for(let i=0;i<arms.length;i++){const b=targets[i%3];await E(`__r124Test.patchUnit(${arms[i].id},{order:3,target:0,tx:${b.x},tz:${b.z}})`);}
      await button('b-all',true);const text=await status();assert(text.includes('另 1 棟未列')&&text.indexOf('#'+targets[2].id+'(')<text.indexOf('#'+targets[1].id+'('),'fixture: weakest-first oracle and overflow are meaningful');await assertStatus('multi: independent weakest two and distinct target count',text);
      assert(!text.includes('#'+targets[0].id+'('),'multi: strongest target omitted rather than weakest');const frozen=await state();await frames();assert.deepEqual(await state(),frozen,'multi: presentation leaves synthetic complete world untouched');
      for(const [width,height,name]of [[412,860,'mobile-multi'],[360,780,'narrow-multi'],[860,412,'landscape-multi']]){
        await viewport(width,height);
        if(name==='narrow-multi'){
          // Preserve exact baseline evidence BEFORE the strict 360px gate. The test-only
          // valve changes presentation, not the synthetic world, selection or commands.
          const before=await state();await E('__r124Test.setCoverValve(false)');await frames();
          await assertStatus('fixture: narrow baseline valve removes only durability','');
          if(!mutant)await shot('r124-narrow-multi-off.png');await layout('narrow-multi-off',false);
          await E('__r124Test.setCoverValve(true)');await frames();
          assert.deepEqual(await state(),before,'narrow: valve comparison preserves complete world and commands');
          await assertStatus('narrow: enabled comparison restores current durability',text);
        }
        // Save the enabled pixels even when an original strict layout gate is red.
        if(!mutant)await shot(`r124-${name}.png`);await layout(name);
      }
      await viewport(412,860);await E(`__r124Test.patchUnit(${arms[0].id},{order:0});__r124Test.patchUnit(${arms[3].id},{order:0})`);await frames();await assertStatus('multi: order changes remove only their distinct target',await status());
    };
    const transition=async(mode,mutant)=>{
      await viewport();await fresh(quiet+(mutant?'&__r124mutant='+mode:''));await fireTank(true);await assertStatus('fixture: target initially visible',await status());const tick=await E('__rts.tick()');
      await E(`__r124Test.patchUnit(${tank.id},${JSON.stringify(mode==='dead'?{alive:false,hp:0}:mode==='enemy'?{side:1}:{order:0})})`);await frames();assert.equal(await E('__rts.tick()'),tick,'fixture: eligibility change did not tick');assert.deepEqual(await E('__rts.selected()'),[tank.id],'fixture: selected id retained for live eligibility check');await assertStatus(`${mode}: same-tick invalid order or shooter clears target`,'');
    };
    const priority=async mutant=>{
      await viewport();await fresh(mutant?'__r124mutant=priority':'');await fireTank(true);await select(tank.id,true);const text=await hint(),before=await state(),p=await E(`__rts.screenOf(${tank.id})`);
      await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p[0],y:p[1],id:1}]});await sleep(650);await frames();await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await frames();assert(await E('!!document.querySelector("#command-menu:not([hidden])")'),'fixture: native long press opens command menu');
      assert((await hint()).includes('選擇這一格')&&!(await hint()).includes('掩體目標'),'priority: command prompt overrides durability text');await button('cm-cancel',true);assert.equal(await hint(),text,'priority: cancel restores current target');assert.deepEqual(await state(),before,'priority: menu changes neither world nor orders');
    };
    const smoke=async mutant=>{
      await viewport();await fresh(mutant?'__r124mutant=smoke':'');await select(gun.id,true);await button('b-ammo',true);
      assert.equal(await E('document.getElementById("b-fire").getAttribute("aria-pressed")'),'true','fixture: selecting smoke already enables fire mode');
      assert.equal(await E('document.getElementById("b-ammo").textContent'),'煙幕','fixture: native ammo toggle selects smoke');
      const b=smokeTarget;await E(`__rts.focus(${b.x+b.w/2},${b.z+b.d/2},0.85)`);await frames();
      const target=await E(`(()=>{const b=${JSON.stringify(b)};for(let y=0;y<=3;y+=0.25)for(let z=b.z+0.25;z<b.z+b.d;z+=0.5)for(let x=b.x+0.25;x<b.x+b.w;x+=0.5){const p=__rts.screenOfPoint(x,y,z),hit=__r124Test.pick(...p),c=hit.building;if(!hit.unit&&c&&b.cells.some(v=>v[0]===c[0]&&v[1]===c[1])&&document.elementFromPoint(...p)===document.querySelector('body>canvas'))return {p,cell:c};}return null;})()`);
      assert(target,'fixture: unobstructed native smoke building target');const before=await state();await click(target.p[0],target.p[1],true);
      assert.deepEqual((await state()).log.at(-1),{tick:before.tick,cmd:{t:'fireAt',side:0,ids:[gun.id],x:target.cell[0],z:target.cell[1],ammo:'smoke'}},'fixture: native controls issue actual smoke command');
      await E('__rts.stepN(1)');await frames();const w=await world(),u=w.units.find(u=>u.id===gun.id);assert(u.fireAmmo===3&&u.target>0&&w.shells.some(s=>s.shooter===gun.id&&s.kind===3),'fixture: real smoke order has a positive rounds counter and launches smoke');
      await assertStatus('smoke: positive rounds counter still shows targeted building durability',await status());await assertNode('smoke bombardment');if(!mutant)await shot('r124-mobile-smoke-target.png');
    };
    const narrow=async mutant=>{
      await viewport(360,780);await fresh(mutant?'__r124mutant=layout':'');await button('b-all',true);
      // Separate class-removal mutant: the first red must remain the original control gate,
      // not an input fixture, screenshot, import, or a relaxed replacement threshold.
      if(!mutant)await shot('r124-narrow-layout.png');await layout('narrow-fix');
    };
    const valve=async mutant=>{
      await viewport();await fresh('noR124=1'+(mutant?'&__r124mutant=valve':''));await fireTank(true);await assertStatus('valve: noR124 removes complete durability status','');assert((await hint()).includes('裝填完成'),'valve: previous reload text preserved');assert((await ranges()).single.shown,'valve: previous range display preserved');
      assert.equal(await E('__rts.runScript(1200)'),hashWorld(runScript(1200)),'valve: golden simulation unchanged');
      await fresh('noR009=1&noR113=1&noR122=1&noR123=1');await fireTank(true);await assertStatus('valve: durability independent of other presentation valves',await status());if(!mutant)await shot('r124-mobile-independent-valve.png');
    };
    const cases={mobile:m=>native(true,m),desktop:m=>native(false,m),freshness,multi,dead:m=>transition('dead',m),enemy:m=>transition('enemy',m),order:m=>transition('order',m),priority,smoke,narrow,valve};
    const targets={mobile:'mobile: native target durability visible',desktop:'desktop: native target durability visible',freshness:'freshness: same-tick damage updates current hp and stage',multi:'multi: independent weakest two and distinct target count',dead:'dead: same-tick invalid order or shooter clears target',enemy:'enemy: same-tick invalid order or shooter clears target',order:'order: same-tick invalid order or shooter clears target',priority:'priority: command prompt overrides durability text',smoke:'smoke: positive rounds counter still shows targeted building durability',narrow:'narrow-fix: existing 44px toolbar and production targets remain usable',valve:'valve: noR124 removes complete durability status'};
    for(const[name,run]of Object.entries(cases)){const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,`${name}: no runtime/shader errors`);record(`OK real Chrome ${name}`);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const[name,run]of Object.entries(cases)){const errors=page.errors.length;let failure;try{await run(true);}catch(e){failure=e;}assert(failure instanceof assert.AssertionError&&failure.message.startsWith(targets[name]),`negative ${name}: first failure must be targeted assertion, got ${failure?.stack??'no failure'}`);assert.equal(page.errors.length,errors,`negative ${name}: no unrelated runtime/shader errors`);record(`RED real Chrome ${name}: ${targets[name]}`);}
  });
}
try{await main();fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r124-browser.txt'),summary.join('\n')+'\n');if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### R124 real cover durability guards\n${summary.map(x=>'- '+x).join('\n')}\n`);}
catch(error){const message=String(error?.stack??error);fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});fs.writeFileSync(path.join(ROOT,'shots/r124-browser.txt'),summary.join('\n')+'\nFAIL '+message+'\n');if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(message)&&!strictCI){console.error('NOT RUN R124 real Chrome guards: local browser/socket unavailable; CI must execute them.');console.error(error.message);process.exitCode=77;}else{console.error(error);console.error(`R124 browser FAIL: ${String(error.message).replace(/\s+/g,' ').slice(0,2400)}`);process.exitCode=1;}}
finally{fs.rmSync(temp,{recursive:true,force:true});}
