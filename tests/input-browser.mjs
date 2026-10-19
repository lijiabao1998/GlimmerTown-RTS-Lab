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
  productionLayout: ['src/ui/production.ts', '    if (key !== last) {', "    if (location.search.includes('__r109mutant=productionLayout') && key === last) return;\n    if (key !== last) {"],
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
    const fresh = async (extra = '', selection = [1,4,9]) => {
      await open('noR018=1&noR006=1&noR016=1&' + extra);
      assertions(await E('!!window.__rts?.ready'), 'bootstrap: actual RTS ready');
      await E(`__rts.pause(true);__rts.runScript(0);__rts.issue({t:"eco",inf:1,guns:1,tanks:1});__rts.stepN(1);__rts.pause(true);__rts.focus(27,27,1);__rts.select(${JSON.stringify(selection)});`);
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
        const hintGeometry=()=>E(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};};return {hint:rect('#hint'),production:rect('#prodbar')};})()`);
        const beforeGeometry=await hintGeometry();
        if(!overlay['index.html'])await shot(page,path.join(ROOT,'shots/r110-paused-before-menu.png'));
        await hold(); await button('#cm-smoke');
        assertions(await E('document.querySelector("#hint").textContent.includes("已下煙幕指令")'),'hint: fixture smoke confirmation visible');
        // Find bare ground away from every projected unit and HUD; assert the actual routed cell below.
        const target=await E(`(()=>{const units=__rts.units().filter(u=>u.alive).map(u=>__rts.screenOf(u.id)),blds=__rts.blds();for(let z=25;z<=29;z++)for(let x=25;x<=29;x++){if(blds.some(b=>x>=b.x&&z>=b.z&&x<b.x+b.w&&z<b.z+b.d))continue;const p=__rts.screenOfCell(x,z),g=__rts.groundAt(...p);if(document.elementFromPoint(...p)?.tagName==='CANVAS'&&g&&Math.floor(g[0])===x&&Math.floor(g[1])===z&&units.every(u=>(u[0]-p[0])**2+(u[1]-p[1])**2>32**2))return {p,x,z};}return null;})()`);
        assertions(target,'fixture: paused order has unobstructed bare ground');
        await touchTap(page,...target.p); await frames();
        assert.deepEqual((await state()).log.slice(before.log.length).map(l=>l.cmd),[{t:'fireAt',side:0,ids:[4],x:29,z:29,ammo:'smoke'},{t:'move',side:0,ids:[1,4,9],x:target.x,z:target.z}],'hint: ordinary touch retains exact queued commands');
        assertions(await E('!document.querySelector("#hint").textContent.includes("已下煙幕指令")&&document.querySelector("#hint").textContent.includes("點地面＝移動")'),'hint: paused ordinary order immediately clears stale confirmation');
        assert.equal(await E('__rts.tick()'),tick,'hint: clearing does not advance simulation'); assert.equal((await state()).hash,before.hash,'hint: commands stay queued while paused');
        assert.deepEqual(await hintGeometry(),beforeGeometry,'hint: cleared feedback restores the pre-menu HUD/production geometry');
        if(!overlay['index.html'])record(`R110 paused HUD geometry (before menu = after clear): ${JSON.stringify(beforeGeometry)}`);
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
      async productionLayout() {
        await viewport(true);
        // Warm the real content cache with the short, unselected hint. No economy/tick change follows.
        const snapshot=()=>E(`({tick:__rts.tick(),hash:__rts.hash(),eco:__rts.eco(),content:document.querySelector('#prodbar').innerHTML})`);
        const frozen=await snapshot(), before=await state();
        assert.equal(frozen.tick,1,'fixture: production closeup is fixed at tick 1');
        const geometry=()=>E(`(()=>{
          const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          const prod=document.querySelector('#prodbar'),hint=document.querySelector('#hint'),menu=document.querySelector('#command-menu:not([hidden])');
          const targets=e=>[...e.querySelectorAll('button')].map(b=>{const r=rect(b);return {...r,hit:b.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2))};});
          return {production:rect(prod),hint:rect(hint),text:hint.textContent,visible:!prod.hidden,buttons:targets(prod),menu:menu?rect(menu):null,menuButtons:menu?targets(menu):[],obstacles:['#hud .btns','#hud .top','#minimap'].map(s=>document.querySelector(s)).filter(e=>e&&!e.hidden).map(rect),width:innerWidth,height:innerHeight};
        })()`);
        const disjoint=(a,b)=>a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;
        const check=async label=>{
          const g=await geometry();
          assertions(g.visible&&g.production.height>0&&g.hint.height>0,`fixture: ${label} has real visible production and hint rectangles`);
          if(label==='long selection') {
            // Same paused tick/camera/viewport for repaired and isolated old-cache closeups.
            const png=await page.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:620,width:412,height:240,scale:1}});
            fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});
            fs.writeFileSync(path.join(ROOT,`shots/r111-production-hint-${overlay['index.html']?'before':'after'}.png`),Buffer.from(png.data,'base64'));
          }
          // Independent DOM geometry contract, not a copy of the production placement calculation.
          assertions(g.production.bottom<=g.hint.top-6,`productionLayout: ${label} preserves six-pixel hint clearance (production bottom ${g.production.bottom}, hint top ${g.hint.top})`);
          assert.equal(g.production.bottom,g.hint.top-6,`productionLayout: ${label} tracks the hint without leaving stale excess space`);
          assertions(g.hint.left>=0&&g.hint.right<=g.width&&g.hint.top>=0&&g.hint.bottom<=g.height,`productionLayout: ${label} prompt stays fully visible`);
          assertions(g.buttons.every(b=>b.hit&&b.width>=44&&b.height>=44),`productionLayout: ${label} production buttons remain unobstructed touch targets`);
          for(const r of g.obstacles)assertions(disjoint(g.hint,r),`productionLayout: ${label} prompt avoids the other HUD rectangles`);
          if(g.menu) {
            assertions(g.menu.left>=0&&g.menu.right<=g.width&&g.menu.top>=0&&g.menu.bottom<=g.height,`productionLayout: ${label} menu stays in viewport`);
            for(const r of [g.production,g.hint,...g.obstacles])assertions(disjoint(g.menu,r),`productionLayout: ${label} menu avoids the actual production/prompt/HUD rectangles`);
            assertions(g.menuButtons.every(b=>b.hit&&b.width>=44&&b.height>=44),`productionLayout: ${label} menu remains unobstructed and clickable`);
          }
          assert.deepEqual(await snapshot(),frozen,`productionLayout: ${label} leaves economy, tick, hash and production content unchanged`);
          return g;
        };
        const sameDraws=async (previous,label)=>{
          const now=await E('__rts.info()');
          assert.equal(now.calls,previous.calls,`productionLayout: ${label} adds no draw call`);
          assert.equal(now.triangles,previous.triangles,`productionLayout: ${label} adds no triangle`);
          assertions(now.calls<=22&&now.triangles<=80000,`productionLayout: ${label} keeps the existing battle budget`);
        };
        const short=await check('short selection');
        await E('__rts.select([1,4,9])'); await frames();
        const long=await check('long selection');
        assertions(long.hint.height>short.hint.height,'fixture: selected phone hint actually wraps onto more lines');
        await E('__rts.select([])'); await frames();
        const shortAgain=await check('short selection restored');
        assert.deepEqual(shortAgain.hint,short.hint,'productionLayout: shrinking hint restores short geometry');
        assert.deepEqual(shortAgain.production,short.production,'productionLayout: shrinking hint lowers production again');
        await E('__rts.select([1,4,9])'); await frames();
        const beforeMenu=await E('__rts.info()');
        // Pass-through measurement observer in this test page only: capture the actual synchronous
        // obstacle read performed inside menu.open, before any later animation frame can repair it.
        await E(`(()=>{const p=document.querySelector('#prodbar'),measure=p.getBoundingClientRect.bind(p);window.__r111MenuRead=null;p.getBoundingClientRect=()=>{const r=measure();if(!window.__r111MenuRead&&document.querySelector('#command-menu:not([hidden])')){const h=document.querySelector('#hint');window.__r111MenuRead={production:r.toJSON(),hint:h.getBoundingClientRect().toJSON(),text:h.textContent};}return r;};})()`);
        await hold(false);
        const menuRead=await E('window.__r111MenuRead');
        assertions(menuRead&&menuRead.text.includes('選擇這一格'),'fixture: real hold records menu.open reading the current production obstacle');
        assert.equal(menuRead.production.bottom,menuRead.hint.top-6,'productionLayout: HUD and production synchronize before menu.open reads its obstacle');
        const prompt=await check('held menu prompt');
        assertions(prompt.menu,'productionLayout: real hold opens its menu');
        await sameDraws(beforeMenu,'held prompt/menu');
        await touch('touchEnd',[]); await frames(); await button('#cm-smoke');
        const success=await check('smoke success');
        assertions(success.text.includes('已下煙幕指令'),'productionLayout: smoke success prompt is visible');
        const smokeLog=[...before.log,{tick:frozen.tick,cmd:{t:'fireAt',side:0,ids:[4],x:29,z:29,ammo:'smoke'}}];
        assert.deepEqual((await state()).log,smokeLog,'productionLayout: smoke sends exactly one unchanged command');
        const clear=async()=>{const p=await gunPoint();await touch('touchStart',[[...p,1]]);await touch('touchCancel',[]);await frames();};
        const beforeClear=await E('__rts.info()'); await clear();
        const cleared=await check('cleared smoke success');
        assert.equal(cleared.text,long.text,'productionLayout: clearing success restores the selected hint');
        assert.deepEqual(cleared.hint,long.hint,'productionLayout: clearing success restores hint geometry');
        assert.deepEqual(cleared.production,long.production,'productionLayout: clearing success restores production geometry');
        await sameDraws(beforeClear,'feedback clear');
        await E('__rts.select([1,9])'); await frames(); await hold(); await check('no-gun menu prompt'); await button('#cm-smoke');
        const error=await check('smoke error');
        assertions(error.text.includes('請先選取榴彈砲'),'productionLayout: no-gun error prompt is visible');
        await clear(); const errorCleared=await check('cleared smoke error');
        assertions(!errorCleared.text.includes('請先選取榴彈砲')&&errorCleared.text.includes('點地面＝移動'),'productionLayout: clearing error immediately restores ordinary instructions');
        assert.deepEqual((await state()).log,smokeLog,'productionLayout: menu, rejected smoke and cancellation add no commands');
        const phoneDraws=await E('__rts.info()');
        await viewport(false); const desktop=await check('desktop resize');
        assertions(desktop.hint.height<errorCleared.hint.height,'fixture: desktop viewport changes actual prompt wrapping');
        await viewport(true); const phone=await check('phone resize restored');
        assert.deepEqual(phone.hint,errorCleared.hint,'productionLayout: phone resize restores hint geometry');
        assert.deepEqual(phone.production,errorCleared.production,'productionLayout: phone resize restores production geometry');
        await sameDraws(phoneDraws,'phone resize round trip');
        assert.deepEqual((await state()).log,smokeLog,'productionLayout: viewport changes never issue commands');
        // Exercise ordinary selection and ammo controls with R109 genuinely disabled.
        await fresh('noR109=1',[]); await check('noR109 short hint');
        assertions(await E('!document.getElementById("command-menu")'),'productionLayout: noR109 keeps the legacy interface');
        const legacyBefore=await state(),p=await gunPoint(); await touchTap(page,...p); await frames();
        assert.deepEqual((await state()).selected,[4],'productionLayout: noR109 ordinary touch selects the gun');
        await check('noR109 selected hint'); await button('#b-all'); await check('noR109 all-selected hint');
        const ammoDraws=await E('__rts.info()'); await button('#b-ammo');
        const ammo=await check('noR109 smoke ammo hint');
        assertions(ammo.text.includes('煙幕無傷害'),'productionLayout: noR109 ordinary ammo prompt is visible');
        await sameDraws(ammoDraws,'noR109 ammo prompt');
        await button('#b-fire'); await check('noR109 ordinary hint restored');
        assert.deepEqual((await state()).log,legacyBefore.log,'productionLayout: noR109 selection/ammo controls add no commands');
        record(`R111 paused production clearance: short ${short.hint.height}px, long ${long.hint.height}px, desktop ${desktop.hint.height}px; tick ${frozen.tick}; hash ${frozen.hash}`);
      },
      async valve() {
        await viewport(true);
        assertions(await E('!document.getElementById("selection-box")&&!document.getElementById("command-menu")'),'valve: disabled feature creates no overlay');
        const p=await gunPoint(); await touch('touchStart',[[...p,1]]); await sleep(650); await touch('touchEnd',[]); await frames();
        assertions(!(await state()).open,'valve: old long touch does not open menu');
        assert.equal(await E('__rts.runScript(600)'),'c1058cb1','valve: original 600-tick hash'); assert.equal(await E('__rts.runScript(1200)'),'79fc3ae3','valve: original 1200-tick hash');
      },
    };
    for(const [name,run] of Object.entries(cases)) {
      await fresh(name==='valve'?'noR109=1':'',name==='productionLayout'?[]:undefined); const errors=page.errors.length; try { await run(); } catch(error) { await shot(page,path.join(ROOT,`shots/r109-failure-${name}.png`)).catch(()=>{}); throw error; } assert.equal(page.errors.length,errors,`browser runtime errors in ${name}`); record(`OK real Chrome ${name}`);
    }
    // The same assertion must reject each isolated broken production bundle, not a startup error.
    overlay['index.html']=fs.readFileSync(path.join(broken,'index.html'));
    for(const [name,run] of Object.entries(cases)) {
      await fresh(`__r109mutant=${name}${name==='valve'?'&noR109=1':''}`,name==='productionLayout'?[]:undefined); const errors=page.errors.length; let failure=null;
      try { await run(); } catch(e) { failure=e; }
      if (name === 'hold' || name === 'cancel') await touch('touchCancel', []);
      assertions(failure instanceof assert.AssertionError && failure.message.startsWith(`${name}:`),`negative ${name}: expected semantic ${name} assertion, got ${failure?.stack??'no failure'}`);
      if(name==='productionLayout')assertions(failure.message.startsWith('productionLayout: long selection preserves six-pixel hint clearance'),`negative productionLayout: expected the first failure at long-hint geometry, got ${failure.message}`);
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
