// R123: real Chrome input and visible HUD, independent simulation/format oracles, isolated mutants.
// The observation/transition bridge exists only in temporary test builds, never in the shipped app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, touchTap, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB, TICK_HZ, UNIT_KINDS, UK_TANK, UK_LIGHT, UK_HEAVY, UK_HOWITZER, UK_ATGUN, UK_MORTAR, UK_INFANTRY, UK_OBSERVER, BK_HQ } from '../src/sim/world.ts';
import { runLog, step } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r123-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
let holdDiagnostics;
const summary = [], record = line => { summary.push(line); console.log(line); };
const digest = value => createHash('sha256').update(value).digest('hex');
const SEED = 1944, ecoLog = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }];
const initial = runLog(createWorld(SEED), ecoLog, 1), initialHash = hashWorld(initial);
const gun = initial.units.find(u => u.side === 0 && u.kind === UK_HOWITZER);
const tank = initial.units.find(u => u.side === 0 && u.kind === UK_TANK);
const observer = initial.units.find(u => u.side === 0 && u.kind === UK_OBSERVER);
const infantry = initial.units.find(u => u.side === 0 && u.kind === UK_INFANTRY);
const allIds = initial.units.filter(u => u.side === 0 && u.alive).map(u => u.id);
// Explicit product requirement, not the reload helper's predicate or diagnostic output.
const eligibleKinds = new Set([UK_TANK, UK_LIGHT, UK_HEAVY, UK_HOWITZER, UK_ATGUN, UK_MORTAR]);
const expectedStatus = (units, ids) => {
  const selected = units.filter(u => ids.includes(u.id) && u.alive && u.side === 0 && eligibleKinds.has(u.kind));
  if (!selected.length) return '';
  const loading = selected.filter(u => u.cooldown > 0);
  const times = loading.map(u => Math.floor((u.cooldown * 10 + TICK_HZ - 1) / TICK_HZ) / 10).sort((a,b) => a-b);
  const range = times.length ? `；剩餘 ${times[0].toFixed(1)}${times[0] === times.at(-1) ? '' : `–${times.at(-1).toFixed(1)}`} 模擬秒` : '';
  return `裝填完成 ${selected.length-loading.length}／裝填中 ${loading.length}${range}；裝填完成不代表可射擊`;
};
// Derive a valid terrain target from current weapon data, outside the spawn units' pick radius.
const groundTargets = [];
for (let x = 22; x < 30; x++) for (let z = 22; z < 30; z++) {
  const d = Math.hypot((x+0.5)*SUB-gun.x, (z+0.5)*SUB-gun.z), k = UNIT_KINDS[gun.kind];
  if (d >= k.minRange && d <= k.range && !initial.occ[z*initial.n+x]) groundTargets.push({x,z});
}
groundTargets.sort((a,b) => a.x+a.z-b.x-b.z || a.x-b.x);
// A real tank must also fire. Find an existing town building via a legal one-tick simulation,
// rather than editing cooldown or depending on a fixed building ID / weapon reload value.
const tankTarget = initial.blds.filter(b => b.kind !== BK_HQ && b.hp > 0).map(b => {
  const cells = [];
  for (let z=b.z; z<b.z+b.d; z++) for (let x=b.x; x<b.x+b.w; x++) {
    const test = structuredClone(initial);
    step(test, [{t:'fireAt',side:0,ids:[tank.id],x,z}]);
    if (test.events.some(e => e.e === 'fire' && e.unit === tank.id)) cells.push([x,z]);
  }
  return {...b,cells};
}).find(b => b.cells.length);
assert(gun && tank && observer && infantry && groundTargets.length && tankTarget, 'fixture: legal artillery, tank, observer, infantry and firing targets exist');

const hits = new Set();
const plugin = mutant => ({
  name: mutant ? 'r123-isolated-browser-mutants' : 'r123-observation-only', enforce: 'pre',
  transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\','/');
    const replace = (from,to,n=1) => {
      assert.equal(code.split(from).length-1,n,`unique R123 source anchor ${rel}: ${from}`);
      code = code.replaceAll(from,to); if (mutant) hits.add(rel+':'+from);
    };
    if (rel === 'src/main.ts') {
      replace('(window as unknown as { __rts: typeof rts }).__rts = rts;', `(window as unknown as { __rts: typeof rts }).__rts = rts;
(window as any).__r123Test = {
  world: () => JSON.stringify(w),
  units: () => w.units.map(u => ({ ...u, path: [...u.path] })),
  // Read-only failure evidence; this does not change render visibility, timing or budgets.
  render: () => ({ pools: view.pools, single: !!view.range113?.mesh.visible, multi: view.multi122.mesh.visible, active: view.scene.children.filter((m: any) => m.isMesh && m.visible && (m.count ?? 1) > 0 && m.geometry.drawRange.count !== 0).map((m: any) => ({ name: m.name || Object.entries(view).find(([,v]: [string,any]) => v === m || v?.mesh === m)?.[0] || m.type, n: m.count ?? 1, shadow: m.castShadow })) }),
  pick: (x: number, y: number) => ({ unit: pickUnit(x,y), building: view.buildingAt(x,y,innerWidth,innerHeight) }),
  // Deliberately synthetic same-tick eligibility transitions. They neither tick nor refresh HUD.
  transition: (id: number, mode: string) => { const u = w.units.find(u => u.id === id)!; if (mode === 'dead') { u.alive = false; u.hp = 0; } else if (mode === 'enemy') u.side = SIDE_ENEMY; else throw Error('unknown test transition'); },
};`);
      if (mutant) {
        replace("V.r123", "(q.get('__r123mutant') === 'valve' || V.r123)", 3);   // R060：閥從閥表來；建畫面只剩一處
        replace('if (reloadInfo !== lastReloadInfo)', "if (q.get('__r123mutant') !== 'freshness' && reloadInfo !== lastReloadInfo)");
      }
    }
    if (mutant && rel === 'src/ui/hud.ts') {
      replace('if (s.hint === undefined && s.reloadInfo)', "if (new URLSearchParams(location.search).get('__r123mutant') !== 'hidden' && (s.hint === undefined || new URLSearchParams(location.search).get('__r123mutant') === 'priority') && s.reloadInfo)");
    }
    if (mutant && rel === 'src/ui/reloadStatus.ts') {
      replace('!u.alive || u.side !== SIDE_PLAYER', "(!u.alive && new URLSearchParams(location.search).get('__r123mutant') !== 'dead') || (u.side !== SIDE_PLAYER && new URLSearchParams(location.search).get('__r123mutant') !== 'enemy')");
      replace('if (!k.armored && !SOVIET_KINDS.includes(u.kind) && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR)', "if (new URLSearchParams(location.search).get('__r123mutant') !== 'eligibility' && !k.armored && !SOVIET_KINDS.includes(u.kind) && u.kind !== UK_HOWITZER && u.kind !== UK_ATGUN && u.kind !== UK_MORTAR)");
      replace('Math.ceil(u.cooldown * 10 / TICK_HZ)', "(new URLSearchParams(location.search).get('__r123mutant') === 'rounding' ? Math.floor(u.cooldown * 10 / TICK_HZ) : Math.ceil(u.cooldown * 10 / TICK_HZ))");
      replace("low === high ? ''", "(new URLSearchParams(location.search).get('__r123mutant') === 'range' || low === high) ? ''");
    }
    return code;
  },
});

async function main() {
  const started = Date.now(), baseline = path.join(temp,'baseline'), broken = path.join(temp,'broken');
  await build({root:ROOT,logLevel:'error',plugins:[plugin(false)],build:{outDir:baseline}});
  await build({root:ROOT,logLevel:'error',plugins:[plugin(true)],build:{outDir:broken}});
  assert.equal(hits.size,8,'all R123 observation and semantic mutation anchors applied');
  const overlay = {};
  await withBrowser({root:baseline,overlay,port:8443,width:412,height:860,mobile:true,chromeWaitMs:20000,readyMs:8000,settle:70},async({open,page}) => {
    const bounded = async (promise,label) => {
      const left = Math.min(8000,112000-(Date.now()-started)); if (left <= 0) throw Error('R123 operational deadline exceeded');
      let timer; try { return await Promise.race([promise,new Promise((_,reject) => { timer=setTimeout(() => reject(Error(`CDP timeout: ${label}`)),left); })]); }
      finally { clearTimeout(timer); }
    };
    const send=page.send.bind(page), evaluate=page.evaluate.bind(page);
    page.send=(m,a)=>bounded(send(m,a),m); page.evaluate=e=>bounded(evaluate(e),'evaluate');
    const E=e=>page.evaluate(e), frames=()=>E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const hint=()=>E('document.getElementById("hint").textContent');
    const units=()=>E('__r123Test.units()');
    const state=()=>E('({world:__r123Test.world(),hash:__rts.hash(),tick:__rts.tick(),log:__rts.log()})');
    const info=()=>E('({calls:__rts.info().calls,triangles:__rts.info().triangles})');
    const pixels=()=>E('document.querySelector("body>canvas").toDataURL()');
    const ranges=()=>E('({single:__rts.rangePreview(),multi:__rts.multiRange()})');
    const viewport=async mobile=>{
      await page.send('Emulation.setDeviceMetricsOverride',{width:mobile?412:1280,height:mobile?860:800,deviceScaleFactor:1,mobile});
      await page.send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
    };
    const fresh=async extra=>{
      await open('noR018=1&noR016=1&'+(extra??'')); await E('__rts.pause(true)');
      assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(ecoLog)},1)`),initialHash,'fixture: exact independent Node eco replay');
      await E('__rts.pause(true);__rts.focus(27,27,0.85)'); await frames();
    };
    const click=async(x,y,mobile)=>{
      if(mobile) await touchTap(page,x,y);
      else { await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1}); await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1}); }
      await frames();
    };
    const button=async(id,mobile)=>{
      const p=await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))];})()`);
      assert(p[2],`fixture: ${id} ordinary control unobstructed`); await click(p[0],p[1],mobile);
    };
    const selectUnit=async(id,mobile)=>{
      const u=(await units()).find(u=>u.id===id);
      await E(`__rts.focus(${u.x/SUB},${u.z/SUB},0.85)`); await frames();
      const p=await E(`__rts.screenOf(${id})`);
      assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: native unit selection is unobstructed');
      await click(p[0],p[1],mobile); assert.deepEqual(await E('__rts.selected()'),[id],'fixture: native pointer/touch selects intended unit');
    };
    const assertStatus=async(label,expected)=>{
      const text=await hint();
      assert(expected ? text.includes(expected) && text.split('裝填完成不代表可射擊').length===2 : !/裝填完成|裝填中|模擬秒/.test(text),label+': '+(expected||'no stale reload text'));
      return text;
    };
    const assertNode=async label=>{
      const s=await state(), expected=runLog(createWorld(SEED),s.log,s.tick);
      assert.equal(s.hash,hashWorld(expected),`${label}: actual native commands replay identically in Node`);
      return s;
    };
    const shot=async name=>{
      const p=await page.send('Page.captureScreenshot',{format:'png'}); fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true}); fs.writeFileSync(path.join(ROOT,'shots',name),Buffer.from(p.data,'base64'));
    };
    const layout=async label=>{
      const g=await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),r=h.getBoundingClientRect(),b=p.getBoundingClientRect();return {hint:r.toJSON(),prod:b.toJSON(),shown:!p.hidden,scrollH:h.scrollHeight,clientH:h.clientHeight,scrollW:h.scrollWidth,clientW:h.clientWidth,width:innerWidth,height:innerHeight,buttons:[...document.querySelectorAll('#prodbar button,#hud .btns button')].filter(e=>e.getBoundingClientRect().height).map(e=>{const q=e.getBoundingClientRect();return {w:q.width,h:q.height,left:q.left,right:q.right,top:q.top,bottom:q.bottom,hit:e.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2))}})};})()`);
      assert(g.shown&&g.prod.bottom<=g.hint.top-6&&g.prod.top>=0&&g.hint.bottom<=g.height&&g.hint.top>=0&&g.hint.left>=0&&g.hint.right<=g.width&&g.scrollH<=g.clientH&&g.scrollW<=g.clientW,`${label}: full reload hint and production row remain visible with clearance`);
      assert(g.buttons.every(b=>b.w>=44&&b.h>=44&&b.left>=0&&b.right<=g.width&&b.top>=0&&b.bottom<=g.height&&b.hit),`${label}: all existing toolbar and production targets remain usable`);
    };
    const fireGun=async mobile=>{
      await selectUnit(gun.id,mobile); await button('b-fire',mobile);
      await E('__rts.focus(27,27,0.85)'); await frames();
      const target=await E(`(()=>{for(const c of ${JSON.stringify(groundTargets)}){const p=__rts.screenOfCell(c.x,c.z),hit=__r123Test.pick(...p);if(p[0]>20&&p[0]<innerWidth-20&&p[1]>150&&p[1]<innerHeight-280&&document.elementFromPoint(...p)===document.querySelector('body>canvas')&&!hit.unit&&!hit.building)return {...c,p};}return null;})()`);
      assert(target,'fixture: an unobstructed in-range ground target exists');
      const before=await state(); await click(target.p[0],target.p[1],mobile);
      const queued=await state(), cmd=queued.log.at(-1);
      assert.equal(queued.tick,before.tick,'fixture: native firing while paused queues without advancing');
      assert.equal(queued.hash,before.hash,'fixture: native firing has not yet mutated the world');
      assert.deepEqual(cmd,{tick:before.tick,cmd:{t:'fireAt',side:0,ids:[gun.id],x:target.x,z:target.z}},'fixture: native toolbar and ground tap issue the intended artillery order');
      await E('__rts.stepN(1)'); await frames();
      const now=await units(); assert.equal(now.find(u=>u.id===gun.id).cooldown,UNIT_KINDS[UK_HOWITZER].reload,'fixture: actual artillery shot starts configured reload');
      await assertNode('artillery');
    };
    const fireTank=async mobile=>{
      await selectUnit(tank.id,mobile);
      const b=tankTarget; await E(`__rts.focus(${b.x+b.w/2},${b.z+b.d/2},0.85)`); await frames();
      // Pick a real visible surface on this standing building. This fixture observation never
      // manufactures a command and is not used to compute any expected reload result.
      const target=await E(`(()=>{const b=${JSON.stringify(b)};for(let y=0;y<=3;y+=0.25)for(let z=b.z+0.25;z<b.z+b.d;z+=0.5)for(let x=b.x+0.25;x<b.x+b.w;x+=0.5){const p=__rts.screenOfPoint(x,y,z),hit=__r123Test.pick(...p),c=hit.building;if(!hit.unit&&c&&b.cells.some(v=>v[0]===c[0]&&v[1]===c[1])&&document.elementFromPoint(...p)===document.querySelector('body>canvas'))return {p,cell:c};}return null;})()`);
      assert(target,'fixture: an unobstructed standing building surface exists');
      const before=await state(); await click(target.p[0],target.p[1],mobile);
      assert.deepEqual((await state()).log.at(-1),{tick:before.tick,cmd:{t:'fireAt',side:0,ids:[tank.id],x:target.cell[0],z:target.cell[1]}},'fixture: native click issues tank bombardment');
      await E('__rts.stepN(1)'); await frames();
      assert.equal((await units()).find(u=>u.id===tank.id).cooldown,UNIT_KINDS[UK_TANK].reload,'fixture: actual tank shot starts configured reload');
      await assertNode('tank');
    };
    const mixedFire=async mobile=>{
      await fireGun(mobile); await fireTank(mobile); await button('b-all',mobile);
      assert.deepEqual((await E('__rts.selected()')).sort((a,b)=>a-b),allIds,'fixture: native all selects armed units plus infantry and observer');
      await E('__rts.focus(27,27,0.85)'); await frames();
    };
    const selection=async(mobile,mutant)=>{
      const name=mobile?'mobile':'desktop'; await viewport(mobile);
      await fresh('noR123=1'); await mixedFire(mobile);
      const old={hint:await hint(),state:await state(),pixels:await pixels(),info:await info(),ranges:await ranges(),render:await E('__r123Test.render()'),buttons:await E('document.querySelectorAll("button").length')};
      if(!mutant)await shot(`r123-${name}-mixed-reload-off.png`);
      assert(!old.hint.includes('裝填完成'),'fixture: valve-off old HUD contains no reload status');
      await fresh(mutant?'__r123mutant=hidden':''); await mixedFire(mobile);
      const expected=expectedStatus(await units(),allIds);
      assert(expected.includes('–'),'fixture: actual mixed tank/artillery shots have distinct remaining times');
      await assertStatus(`${name}: visible independent mixed reload`,expected);
      const now=await info(); assert.deepEqual(await state(),old.state,`${name}: UI preserves complete world, RNG, ticks and commands`);
      assert.equal(now.triangles,old.info.triangles,`${name}: batching preserves triangle count`);
      assert.equal(now.calls,old.info.calls-1,`${name}: batching removes exactly one healthbar draw call`);
      assert.equal(digest(await pixels()),digest(old.pixels),`${name}: WebGL pixels are identical with noR123`);
      assert.deepEqual(await ranges(),old.ranges,`${name}: R113 and R122 solutions are unchanged`);
      assert.equal(await E('document.querySelectorAll("button").length'),old.buttons,`${name}: no controls added`);
      const render=await E('__r123Test.render()');
      const measurement={tick:old.state.tick,hash:old.state.hash,selected:await E('__rts.selected()'),cooldowns:(await units()).filter(u=>u.side===0&&u.alive).map(u=>[u.id,u.kind,u.cooldown]),off:old.info,on:now,pools:render.pools,single:render.single,multi:render.multi,active:render.active};
      // Capture both paired states BEFORE the hard gate so CI retains useful evidence on failure.
      // Keep the original tick, camera, selected group, all effects and <=22 / <=80000 gate.
      if(!mutant)await shot(`r123-${name}-mixed-reload.png`);
      record(`R123 ${name} combat measurement: ${JSON.stringify(measurement)}`);
      assert(now.calls<=22&&now.triangles<=80000,`${name}: unchanged combat closeup budget; ${JSON.stringify(measurement)}`);
      assert.equal((await hint()).replace('。'+expected,''),old.hint,`${name}: valve restores exact legacy HUD rather than removing old information`);
      await layout(name);
      const frozen=await state(), text=await hint(); await sleep(180); await frames();
      assert.deepEqual(await state(),frozen,`${name}: pause freezes complete simulation`); assert.equal(await hint(),text,`${name}: pause never counts down wall time`);
      for(const speed of [2,4,1]) { await button('b-speed',mobile); assert.equal(await E('document.getElementById("b-speed").textContent'),`${speed}×`); assert.equal(await hint(),text,`${name}: speed does not rescale remaining simulation seconds`); assert.deepEqual(await state(),frozen); }
      await selectUnit(gun.id,mobile); await assertStatus(`${name}: same-tick native gun selection`,expectedStatus(await units(),[gun.id]));
      assert((await ranges()).single.shown&&!(await ranges()).multi.shown,`${name}: R113 single-selection preview remains intact`);
      await selectUnit(observer.id,mobile); await assertStatus(`${name}: observer selection clears reload`,'');
      await selectUnit(infantry.id,mobile); await assertStatus(`${name}: infantry selection clears reload`,'');
      assert.equal((await state()).tick,frozen.tick,`${name}: ordinary selection never needs a simulation tick`);
      await selectUnit(tank.id,mobile); await assertStatus(`${name}: same-tick native tank selection`,expectedStatus(await units(),[tank.id]));
      await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await frames();
      await assertStatus(`${name}: Escape clears old reload`,'');
      await selectUnit(gun.id,mobile); await button('b-restart',mobile);
      assert.equal(await E('__rts.phase()'),'build'); await assertStatus(`${name}: restart clears old reload`,'');
      const opening=await info(); assert(opening.calls<=20&&opening.triangles<=80000,`${name}: opening budget; ${JSON.stringify(opening)}`);
      if(!mutant)record(`R123 ${name}: combat ${now.calls}/${now.triangles}, delta -1/0; opening ${opening.calls}/${opening.triangles}; real artillery + tank shots, pause/speed/switch/reset`);
    };
    const freshness=async mutant=>{
      await viewport(true); await fresh('noR113=1&noR122=1&noR115=1&noR116=1'+(mutant?'&__r123mutant=freshness':'')); await fireGun(true);
      // Prime once, then make no control calls. Old HUD's whole-second update and range hints
      // cannot rescue a missing R123 invalidation within this same simulation second.
      await E('__rts.pause(true)'); await frames(); const before=await state(), text=await hint();
      const ticks=Math.ceil(TICK_HZ/10); await E(`__rts.stepN(${ticks})`); await frames();
      const after=await state(), expected=expectedStatus(await units(),[gun.id]);
      assert.notEqual(expected,expectedStatus(JSON.parse(before.world).units,[gun.id]),'fixture: remaining display changed');
      assert.equal(Math.floor(after.tick/TICK_HZ),Math.floor(before.tick/TICK_HZ),'fixture: no whole-second HUD update');
      assert.notEqual(await hint(),text,'freshness: visible countdown updates without a whole-second HUD refresh');
      await assertStatus('freshness: exact independent simulation seconds',expected); await assertNode('freshness');
    };
    const rounding=async mutant=>{
      await viewport(true); await fresh(mutant?'__r123mutant=rounding':''); await fireGun(true);
      const remaining=(await units()).find(u=>u.id===gun.id).cooldown;
      await E(`__rts.issue({t:'stop',side:0,ids:[${gun.id}]});__rts.stepN(${remaining-1})`); await frames();
      assert.equal((await units()).find(u=>u.id===gun.id).cooldown,1,'fixture: one positive cooldown tick remains');
      await assertStatus('rounding: positive remaining never displays zero',expectedStatus(await units(),[gun.id]));
      if(!mutant)await shot('r123-mobile-last-tick.png');
      await E('__rts.stepN(1)'); await frames();
      await assertStatus('rounding: completed reload has no leftover seconds',expectedStatus(await units(),[gun.id])); await assertNode('rounding');
    };
    const range=async mutant=>{
      await viewport(true); await fresh(mutant?'__r123mutant=range':''); await mixedFire(true);
      const expected=expectedStatus(await units(),allIds); assert(expected.includes('–'),'fixture: mixed remaining times differ');
      await assertStatus('range: mixed reload shows independent extrema, not an average',expected);
    };
    const eligibility=async mutant=>{
      await viewport(true); await fresh(mutant?'__r123mutant=eligibility':''); await button('b-all',true);
      await assertStatus('eligibility: infantry and observer never enter reload counts',expectedStatus(await units(),allIds));
    };
    const transition=async(mode,mutant)=>{
      await viewport(true); await fresh('noR113=1&noR122=1&noR115=1&noR116=1'+(mutant?`&__r123mutant=${mode}`:'')); await selectUnit(gun.id,true);
      await assertStatus('fixture: eligible selection was displayed',expectedStatus(await units(),[gun.id])); const tick=await E('__rts.tick()');
      await E(`__r123Test.transition(${gun.id},'${mode}')`); await frames();
      assert.equal(await E('__rts.tick()'),tick,'fixture: eligibility changed without a tick or HUD action');
      assert.deepEqual(await E('__rts.selected()'),[gun.id],'fixture: selected ID remains, so filtering must be live');
      await assertStatus(`${mode}: same-tick ineligible selection clears stale reload`,'');
    };
    const priority=async mutant=>{
      await viewport(true); await fresh(mutant?'__r123mutant=priority':''); await fireGun(true);
      const before=await state(), text=await hint(), p=await E(`__rts.screenOf(${gun.id})`);
      await E(`window.__r127HoldEvents=[];for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','click'])document.addEventListener(type,e=>window.__r127HoldEvents.push({type,target:e.target?.id||e.target?.tagName,x:e.clientX,y:e.clientY}),true);`);
      await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p[0],y:p[1],id:1}]}); await sleep(650); await frames();
      const heldGeometry=await E(`(()=>{const box=e=>{const r=e?.getBoundingClientRect();return r&&[r.x,r.y,r.width,r.height];},menu=document.getElementById('command-menu');return {events:window.__r127HoldEvents,menu:box(menu),hidden:menu?.hidden,buttons:[...document.querySelectorAll('#command-menu button')].map(e=>[e.id,box(e)]),hint:document.getElementById('hint')?.textContent,log:__rts.log()};})()` );
      await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await frames();
      holdDiagnostics={heldPoint:p,heldGeometry,released:await E(`(()=>{const box=e=>{const r=e?.getBoundingClientRect();return r&&[r.x,r.y,r.width,r.height];},menu=document.getElementById('command-menu');return {events:window.__r127HoldEvents,menu:box(menu),hidden:menu?.hidden,buttons:[...document.querySelectorAll('#command-menu button')].map(e=>[e.id,box(e)]),hint:document.getElementById('hint')?.textContent,log:__rts.log()};})()` )};
      assert(await E('!!document.querySelector("#command-menu:not([hidden])")'),'fixture: native long press opens existing command menu');
      assert((await hint()).includes('選擇這一格')&&!(await hint()).includes('裝填完成'),'priority: temporary command prompt takes precedence over reload');
      await button('cm-cancel',true); assert.equal(await hint(),text,'priority: cancel restores current reload text'); assert.deepEqual(await state(),before,'priority: menu never changes world or orders');
    };
    const valve=async mutant=>{
      await viewport(true); await fresh('noR123=1'+(mutant?'&__r123mutant=valve':'')); await button('b-all',true);
      await assertStatus('valve: noR123 removes the complete status',''); assert((await ranges()).multi.shown,'valve: R122 remains enabled');
      await selectUnit(gun.id,true); assert((await ranges()).single.shown,'valve: R113 remains enabled');
      assert.equal(await E('__rts.runScript(1200)'),hashWorld(runScript(1200)),'valve: unchanged golden simulation');
      assert.equal(await E(`__rts.playLog(${SEED},${JSON.stringify(ecoLog)},1)`),initialHash); await E('__rts.pause(true)'); await frames();
      await button('b-all',true); await assertStatus('valve: replay/reset cannot re-enable the status','');
      await fresh('noR009=1&noR113=1&noR122=1'); await button('b-all',true);
      await assertStatus('valve: R123 is independent of old selection/range valves',expectedStatus(await units(),allIds));
      if(!mutant)await shot('r123-mobile-independent-valve.png');
    };
    const cases={mobile:m=>selection(true,m),desktop:m=>selection(false,m),freshness,rounding,range,eligibility,dead:m=>transition('dead',m),enemy:m=>transition('enemy',m),priority,valve};
    const targets={mobile:'mobile: visible independent mixed reload',desktop:'desktop: visible independent mixed reload',freshness:'freshness: visible countdown updates without a whole-second HUD refresh',rounding:'rounding: positive remaining never displays zero',range:'range: mixed reload shows independent extrema, not an average',eligibility:'eligibility: infantry and observer never enter reload counts',dead:'dead: same-tick ineligible selection clears stale reload',enemy:'enemy: same-tick ineligible selection clears stale reload',priority:'priority: temporary command prompt takes precedence over reload',valve:'valve: noR123 removes the complete status'};
    for(const [name,run]of Object.entries(cases)){const errors=page.errors.length;await run(false);assert.equal(page.errors.length,errors,`${name}: no runtime/shader errors`);record(`OK real Chrome ${name}`);}
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const [name,run]of Object.entries(cases)){
      const errors=page.errors.length;let failure;try{await run(true);}catch(e){failure=e;}
      assert(failure instanceof assert.AssertionError&&failure.message.startsWith(targets[name]),`negative ${name}: first failure must be targeted assertion, got ${failure?.stack??'no failure'}`);
      assert.equal(page.errors.length,errors,`negative ${name}: no unrelated runtime/shader errors`);record(`RED real Chrome ${name}: ${targets[name]}`);
    }
  });
}
try {
  await main(); fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true}); fs.writeFileSync(path.join(ROOT,'shots/r123-browser.txt'),summary.join('\n')+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### R123 real reload-status guards\n${summary.map(x=>'- '+x).join('\n')}\n`);
} catch(error) {
  const message=String(error?.stack??error);
  if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(message)&&!strictCI){console.error('NOT RUN R123 real Chrome guards: local browser/socket unavailable; CI must execute them.');console.error(error.message);process.exitCode=77;}
  else {console.error(error);console.error(`R123 browser FAIL: ${String(error.message).replace(/\s+/g,' ').slice(0,2400)} R127_HOLD_TRACE=${JSON.stringify(holdDiagnostics)}`);process.exitCode=1;}
} finally {fs.rmSync(temp,{recursive:true,force:true});}
