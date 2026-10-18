// R109: real Chrome input and DOM geometry. No synthetic production event handlers or shipped test hooks.
// Build into an isolated temporary directory: unit runs before the normal build.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, shot, touchTap } from '../tools/cdp.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r109-input-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [];
const record = text => { summary.push(text); console.log(text); };
const MUTANTS = {
  box: ['src/main.ts', 'if (inSelectionRect(rect, x, y)) selected.add(u.id);', "if (!location.search.includes('__r109mutant=box') && inSelectionRect(rect, x, y)) selected.add(u.id);"],
  hold: ['src/ui/gestures.ts', 'this.actions.hold(c.cx, c.cy);', "if (!location.search.includes('__r109mutant=hold')) this.actions.hold(c.cx, c.cy);"],
  cancel: ['src/ui/gestures.ts', 'if (this.points.size > 1) {\n      this.clearCandidate(); this.actions.dismiss();', "if (this.points.size > 1) {\n      this.clearCandidate(); if (!location.search.includes('__r109mutant=cancel')) this.actions.dismiss();"],
  cancelMain: ['src/main.ts', 'if (dismissOnly) { commandMenu?.close();', "if (dismissOnly && !location.search.includes('__r109mutant=cancel')) { commandMenu?.close();"],
  routing: ['src/main.ts', 'bombardCommand(w, selected, target, chosen)', "bombardCommand(w, selected, target, location.search.includes('__r109mutant=routing') ? 'he' : chosen)"],
  valve: ['src/main.ts', "const r109 = q.get('noR109') !== '1';", "const r109 = location.search.includes('__r109mutant=valve') || q.get('noR109') !== '1';"],
  hint: ['src/main.ts', 'function clearBattleHint() {\n  if (battleHint === undefined) return;\n  battleHint = undefined;\n  hud?.update();\n}', "function clearBattleHint() {\n  if (battleHint === undefined) return;\n  battleHint = undefined;\n  if (!location.search.includes('__r109mutant=hint')) hud?.update();\n}"],
};
const hits = new Set();
const plugin = {
  name: 'r109-isolated-negative-controls', enforce: 'pre',
  transform(code, id) {
    const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
    for (const [name, [file, from, to]] of Object.entries(MUTANTS)) if (rel === file) {
      assert.equal(code.split(from).length - 1, 1, `negative-control anchor ${name} must be unique`);
      code = code.replace(from, to); hits.add(name);
    }
    if (rel === 'src/main.ts') code = "document.documentElement.dataset.r109Mutant = new URLSearchParams(location.search).get('__r109mutant') ?? '';\n" + code;
    return code;
  },
  transformIndexHtml: { order: 'pre', handler(html) {
    return html.replace('</style>', 'html[data-r109-mutant="layout"] #command-menu button { height: 20px; min-height: 20px; }\n</style>');
  } },
};
const assertions = (condition, message) => assert.ok(condition, message);
async function main() {
  const started = Date.now();
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(hits.size, Object.keys(MUTANTS).length, 'all isolated production mutations applied');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8429, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 100 }, async ({ open, page }) => {
    // Operational deadlines stay below the unchanged unit child timeout; never count them as a semantic mutant red.
    const bounded = async (task, label) => {
      const remaining = Math.min(8000, 110000 - (Date.now() - started));
      if (remaining <= 0) throw new Error('browser operational deadline exceeded');
      let timer;
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${label}`)), remaining); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expr => page.evaluate(expr);
    const state = () => E('({log:__rts.log(),selected:__rts.selected(),cam:__rts.cam(),hash:__rts.hash(),open:!!document.querySelector("#command-menu:not([hidden])")})');
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const viewport = async mobile => { await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile }); await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 }); await frames(); };
    const fresh = async (extra = '') => {
      await open('noR018=1&noR006=1&noR016=1&' + extra);
      assertions(await E('!!window.__rts?.ready'), 'bootstrap: actual RTS ready');
      await E('__rts.pause(true);__rts.runScript(0);__rts.issue({t:"eco",inf:1,guns:1,tanks:1});__rts.stepN(1);__rts.pause(true);__rts.focus(27,27,1);__rts.select([1,4,9]);');
      await frames();
    };
    // Keep button and buttons consistent while dragging, as Puppeteer's CdpMouse.move does.
    const mouse = (type, x, y, modifiers = 0) => page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers });
    const touch = (type, points) => page.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x,y,id=1]) => ({ x, y, id })) });
    const gunPoint = async () => {
      const p = await E('__rts.screenOf(4)');
      assertions(await E(`document.elementFromPoint(${p[0]},${p[1]})?.tagName==='CANVAS'`), 'fixture: gun point must hit the game canvas');
      return p;
    };
    const hold = async (release = true) => {
      const p = await gunPoint(); await touch('touchStart', [[...p,1]]); await sleep(650); await frames();
      if (release) { await touch('touchEnd', []); await frames(); }
      return p;
    };
    const button = async selector => {
      const r = await E(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return r&&{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e};})()`);
      assertions(r?.hit, `fixture: ${selector} must be clickable at its measured center`); await touchTap(page, r.x, r.y); await frames(); return r;
    };
    const cases = {
      async box() {
        await viewport(false); await E('__rts.focus(27,27,1);__rts.select([9])'); await frames();
        const points = await E('__rts.units().filter(u=>u.alive&&u.side===0).map(u=>({id:u.id,p:__rts.screenOf(u.id)}))');
        const x0 = Math.floor(Math.min(...points.map(p=>p.p[0])))-12, x1=Math.ceil(Math.max(...points.map(p=>p.p[0])))+12;
        const y0 = Math.floor(Math.min(...points.map(p=>p.p[1])))-12, y1=Math.ceil(Math.max(...points.map(p=>p.p[1])))+12;
        const want = points.map(p=>p.id).sort((a,b)=>a-b), before=await state();
        await E(`window.__r109Trace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','resize','blur'])window.addEventListener(type,e=>window.__r109Trace.push({type,id:e.pointerId,pointer:e.pointerType,button:e.button,buttons:e.buttons,shift:e.shiftKey,target:e.target?.id||e.target?.tagName,x:e.clientX,y:e.clientY}),true);`);
        for (const [ax,ay,bx,by] of [[x0,y0,x1,y1],[x1,y0,x0,y1],[x0,y1,x1,y0],[x1,y1,x0,y0]]) {
          await E('__rts.select([9])'); await mouse('mousePressed',ax,ay,8); await mouse('mouseMoved',bx,by,8); await frames();
          const boxVisible=await E('!!document.querySelector("#selection-box:not([hidden])")');
          assertions(boxVisible, 'box: real Shift drag displays rectangle '+(boxVisible?'':JSON.stringify(await E('({events:window.__r109Trace,phase:__rts.phase(),winner:__rts.winner(),help:document.querySelector("#help")?.hidden,report:document.querySelector("#report")?.hidden,box:document.querySelector("#selection-box")?.outerHTML})'))));
          if (!overlay['index.html']) await shot(page,path.join(ROOT,'shots/r109-box.png'));
          await mouse('mouseReleased',bx,by,8); await frames();
          assert.deepEqual((await state()).selected.sort((a,b)=>a-b),want,'box: four directions add all live friendly projected units');
        }
        const after=await state(); assert.deepEqual(after.cam,before.cam,'box: drag does not pan or fling'); assert.deepEqual(after.log,before.log,'box: selection never issues a command'); assert.equal(after.hash,before.hash,'box: selection does not alter simulation');
      },
      async hold() {
        await viewport(true); const before=await state(); await hold(false);
        assertions((await state()).open,'hold: long press opens menu before release');
        await touch('touchEnd',[]); await frames(); const after=await state();
        assertions(after.open,'hold: ordinary release keeps menu clickable'); assert.deepEqual(after.log,before.log,'hold: open/release never issues a command'); assert.deepEqual(after.selected,before.selected,'hold: release is not an extra tap');
        await button('#cm-cancel'); assertions(!(await state()).open,'hold: cancel closes'); assert.deepEqual((await state()).log,before.log,'hold: cancel never orders');
      },
      async routing() {
        await viewport(true); const before=await state();
        const toolbar=await E('[document.querySelector("#b-fire").getAttribute("aria-pressed"),document.querySelector("#b-ammo").getAttribute("aria-pressed")]');
        await hold(); await button('#cm-smoke'); let after=await state();
        assert.deepEqual(after.log.slice(before.log.length).map(l=>l.cmd),[{t:'fireAt',side:0,ids:[4],x:29,z:29,ammo:'smoke'}],'routing: real smoke touch sends exactly one filtered fireAt to frozen cell');
        await hold(); await button('#cm-he'); after=await state();
        assert.deepEqual(after.log.slice(before.log.length).map(l=>l.cmd),[{t:'fireAt',side:0,ids:[4],x:29,z:29,ammo:'smoke'},{t:'fireAt',side:0,ids:[4],x:29,z:29}],'routing: HE is separate one-shot bombardment');
        assert.deepEqual(await E('[document.querySelector("#b-fire").getAttribute("aria-pressed"),document.querySelector("#b-ammo").getAttribute("aria-pressed")]'),toolbar,'routing: toolbar modes preserved');
        await E('__rts.select([1,9])'); await hold(); const n=(await state()).log.length; await button('#cm-smoke');
        assert.equal((await state()).log.length,n,'routing: no eligible gun produces no command'); assertions(await E('document.querySelector("#hint").textContent.includes("請先選取榴彈砲")'),'routing: no-gun reason visible');
      },
      async hint() {
        await viewport(true); const before=await state(), tick=await E('__rts.tick()');
        await hold(); await button('#cm-smoke');
        assertions(await E('document.querySelector("#hint").textContent.includes("已下煙幕指令")'),'hint: fixture smoke confirmation visible');
        // Find bare ground away from every projected unit and HUD; assert the actual routed cell below.
        const target=await E(`(()=>{const units=__rts.units().filter(u=>u.alive).map(u=>__rts.screenOf(u.id)),blds=__rts.blds();for(let z=25;z<=29;z++)for(let x=25;x<=29;x++){if(blds.some(b=>x>=b.x&&z>=b.z&&x<b.x+b.w&&z<b.z+b.d))continue;const p=__rts.screenOfCell(x,z),g=__rts.groundAt(...p);if(document.elementFromPoint(...p)?.tagName==='CANVAS'&&g&&Math.floor(g[0])===x&&Math.floor(g[1])===z&&units.every(u=>(u[0]-p[0])**2+(u[1]-p[1])**2>32**2))return {p,x,z};}return null;})()`);
        assertions(target,'fixture: paused order has unobstructed bare ground');
        await touchTap(page,...target.p); await frames();
        assert.deepEqual((await state()).log.slice(before.log.length).map(l=>l.cmd),[{t:'fireAt',side:0,ids:[4],x:29,z:29,ammo:'smoke'},{t:'move',side:0,ids:[1,4,9],x:target.x,z:target.z}],'hint: ordinary touch retains exact queued commands');
        assertions(await E('!document.querySelector("#hint").textContent.includes("已下煙幕指令")&&document.querySelector("#hint").textContent.includes("點地面＝移動")'),'hint: paused ordinary order immediately clears stale confirmation');
        assert.equal(await E('__rts.tick()'),tick,'hint: clearing does not advance simulation'); assert.equal((await state()).hash,before.hash,'hint: commands stay queued while paused');
        if(!overlay['index.html'])await shot(page,path.join(ROOT,'shots/r110-paused-hint.png'));
        await E('__rts.select([1,9])'); await hold(); await button('#cm-smoke');
        assertions(await E('document.querySelector("#hint").textContent.includes("請先選取榴彈砲")'),'hint: fixture no-gun error visible');
        const n=(await state()).log.length; await touch('touchStart',[[...target.p,1]]); await touch('touchCancel',[]); await frames();
        assertions(await E('!document.querySelector("#hint").textContent.includes("請先選取榴彈砲")'),'hint: closed-menu pointer cancellation immediately clears stale error');
        assert.equal((await state()).log.length,n,'hint: cancellation never orders'); assert.equal(await E('__rts.tick()'),tick,'hint: cancellation stays paused');
      },
      async cancel() {
        await viewport(true); const before=await state(), p=await hold(false);
        assertions((await state()).open,'cancel: fixture menu is open before second finger');
        // Find a second finger landing on the canvas rather than the menu or HUD.
        const second=await E(`(()=>{for(let y=240;y<600;y+=35)for(let x=60;x<360;x+=35)if(Math.hypot(x-${p[0]},y-${p[1]})>70&&document.elementFromPoint(x,y)?.tagName==='CANVAS')return[x,y];return null;})()`);
        assertions(second,'fixture: second finger has unobstructed canvas point');
        await touch('touchStart',[[...p,1],[...second,2]]); await frames(); assertions(!(await state()).open,'cancel: second pointer dismisses active menu');
        const cam=(await state()).cam;
        const moved=[second[0]+(second[0]>p[0]?30:-30),second[1]+(second[1]>p[1]?25:-25)];
        await touch('touchMove',[[...p,1],[...moved,2]]); await touch('touchEnd',[]); await frames();
        assertions(Math.abs((await state()).cam.zoom-cam.zoom)>0.0001,'cancel: two-finger pinch still zooms'); assert.deepEqual((await state()).log,before.log,'cancel: pinch releases do not tap');
        await E('__rts.focus(27,27,1)'); await frames(); await hold(false); await touch('touchCancel',[]); await sleep(550);
        assertions(!(await state()).open,'cancel: pointercancel closes and cannot fire late');
        const q=await gunPoint(); await touch('touchStart',[[...q,1]]); await E('__rts.runScript(0);__rts.pause(true)'); await sleep(550); await touch('touchEnd',[]);
        assertions(!(await state()).open,'cancel: replay/reset cancels pending hold'); assert.equal((await state()).log.length,0,'cancel: replay/reset has no stale command');
      },
      async layout() {
        await viewport(true); await frames(); const before=await E('__rts.info()'); await hold();
        const geom=await E(`(()=>{const root=document.querySelector('#command-menu'),r=root.getBoundingClientRect();const rect=e=>{const p=e.getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,bottom:p.bottom,width:p.width,height:p.height}};return {menu:rect(root),buttons:[...root.querySelectorAll('button')].map(e=>({...rect(e),hit:document.elementFromPoint(e.getBoundingClientRect().x+e.offsetWidth/2,e.getBoundingClientRect().y+e.offsetHeight/2)===e})),obstacles:['#hud .btns','#hud .top','#hud .bottom','#minimap','#prodbar'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden).map(rect)};})()`);
        assertions(geom.buttons.every(b=>b.width>=44&&b.height>=44&&b.hit),'layout: every real touch target is >=44px and hit-testable');
        const m=geom.menu; assertions(m.left>=0&&m.top>=0&&m.right<=412&&m.bottom<=860,'layout: menu stays in viewport');
        for(const r of geom.obstacles)assertions(m.right<=r.left||m.left>=r.right||m.bottom<=r.top||m.top>=r.bottom,'layout: menu avoids actual HUD rectangles');
        const after=await E('__rts.info()'); assert.equal(after.calls,before.calls,'layout: DOM overlay adds no draw call'); assert.equal(after.triangles,before.triangles,'layout: DOM overlay adds no triangle');
        assertions(after.calls<=22&&after.triangles<=80000,'layout: battle budget unchanged');
        if(!overlay['index.html'])await shot(page,path.join(ROOT,'shots/r109-menu-mobile.png'));
        await button('#cm-cancel');
        // Close the older R107 touch coverage gap using a genuine touch event.
        await button('#b-ammo'); assert.equal(await E('document.querySelector("#b-ammo").getAttribute("aria-pressed")'),'true','layout: existing ammo button accepts touch');
      },
      async valve() {
        await viewport(true);
        assertions(await E('!document.getElementById("selection-box")&&!document.getElementById("command-menu")'),'valve: disabled feature creates no overlay');
        const p=await gunPoint(); await touch('touchStart',[[...p,1]]); await sleep(650); await touch('touchEnd',[]); await frames();
        assertions(!(await state()).open,'valve: old long touch does not open menu');
        assert.equal(await E('__rts.runScript(600)'),'c789deeb','valve: original 600-tick hash'); assert.equal(await E('__rts.runScript(1200)'),'f3364bb6','valve: original 1200-tick hash');
      },
    };
    for(const [name,run] of Object.entries(cases)) {
      await fresh(name==='valve'?'noR109=1':''); const errors=page.errors.length; try { await run(); } catch(error) { await shot(page,path.join(ROOT,`shots/r109-failure-${name}.png`)).catch(()=>{}); throw error; } assert.equal(page.errors.length,errors,`browser runtime errors in ${name}`); record(`OK real Chrome ${name}`);
    }
    // The same assertion must reject each isolated broken production bundle, not a startup error.
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const [name,run] of Object.entries(cases)) {
      await fresh(`__r109mutant=${name}${name==='valve'?'&noR109=1':''}`); const errors=page.errors.length; let failure=null;
      try { await run(); } catch(e) { failure=e; }
      if (name === 'hold' || name === 'cancel') await touch('touchCancel', []);
      assertions(failure instanceof assert.AssertionError && failure.message.startsWith(`${name}:`),`negative ${name}: expected semantic ${name} assertion, got ${failure?.stack??'no failure'}`);
      assert.equal(page.errors.length,errors,`negative ${name} caused an unrelated runtime error`); record(`RED real Chrome ${name}: ${failure.message.split('\n')[0]}`);
    }
  });
}
try {
  await main();
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### R109 real-input browser guards\n${summary.map(s=>'- '+s).join('\n')}\n`);
} catch(error) {
  const text=String(error?.stack??error);
  const blocked=/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(text);
  if(blocked&&!strictCI) { console.error('NOT RUN R109 real Chrome guards: local socket permission restriction; CI must execute them.');console.error(error.message);process.exitCode=77; }
  else { console.error(error);console.error(`R109 browser FAIL: ${String(error.message).split('\n')[0]}`);process.exitCode=1; }
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
