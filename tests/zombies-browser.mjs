// R045 真 Chrome：原生入口、兩張地圖的第二波近戰、預算、重播、戰報與逃生閥。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, shot, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, UK_ZOMBIE, SUB } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { runScript } from '../src/sim/script.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r045-browser-'));
const legacy = hashWorld(runScript());
// 僅隔離測試 bundle 有這個世界夾具；正式入口與產物不加測試掛勾。
const stressPlugin = { name: 'r045-render-fixture', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `
    window.__r045Stress = () => {
      paused = true; view.setWorld(w); view.fogOn = false;
      for(const u of w.units) if(u.side===SIDE_PLAYER){u.kind=3;u.hp=60;u.alive=true;}
      const sample = structuredClone(w.units.find(u => u.alive && u.side === SIDE_PLAYER));
      const add = (alive, x, z, side=1, kind=11) => {
        const u = { ...structuredClone(sample), id:w.units.length+1, side, kind, hp:alive?60:0, alive, x:x*SUB, z:z*SUB, path:[], pathIdx:0 };
        w.units.push(u);w.events.push({e:'spawn',unit:u.id,x:u.x,z:u.z});return u;
      };
      while(w.units.filter(u=>u.alive&&u.side===SIDE_PLAYER).length<40)add(true,55,55,0,3);
      while (w.units.length < 520) add(false, 50, 50);
      const dead = []; for(let i=0;i<12;i++) dead.push(add(true,52+i%4,52+Math.floor(i/4),i%2,i%2?11:3));
      view.onEvents(w.events,0);w.events=[];view.update(1,0,selected);
      for(const u of dead) { u.hp=0;u.alive=false; } view.update(1,0,selected);
      for(let i=0;i<48;i++) add(true,50+i%8,50+Math.floor(i/8));
      view.onEvents(w.events,0);w.events=[];view.update(1,0,selected);
      view.target.set(54,0,53);view.zoom=1.6;
      const result = {ids:w.units.length,capacity:view.prevX.length,men:view.men.count,alive:view.menDbg.alive,
        finite:Array.from(view.men.instanceMatrix.array.subarray(0,view.men.count*16)).every(Number.isFinite)};
      view.update(1,31,selected);result.faded=view.men.count-view.menDbg.alive;return result;
    };
  `;
} };
const budget = info => { assert(info.calls <= 22 && info.triangles <= 80000, `battle budget: ${JSON.stringify(info)}`); };
function secondWave(seed, log) {
  const w = runLog(createWorld(seed), log, 1);
  while (w.winner < 0 && w.zombies.wave <= 2 && w.tick < 2701) {
    const hp = new Map(w.units.filter(u => u.kind === UK_ZOMBIE).map(u => [u.id, u.hp]));
    step(w, []);
    const e = w.events.find(e => e.e === 'fire' && w.units[e.unit - 1].kind === UK_ZOMBIE && spotted(w, 0, e.x, e.z));
    // 大圖的慢速喪屍第二波尚未貼身，取守軍真正命中的當步。
    const hit = w.units.find(u => u.kind === UK_ZOMBIE && u.alive && u.hp < hp.get(u.id) && spotted(w, 0, u.x, u.z));
    // 取實際交戰的喪屍；遠程交火的中點在手機窄畫幅可能只拍到空地。
    const contact = e ? w.units[e.unit - 1] : hit;
    if (w.zombies.wave === 2 && contact) return { tick: w.tick, hash: hashWorld(w), id: contact.id, x: contact.x / SUB, z: contact.z / SUB };
  }
  assert.fail('fixture: second wave includes visible melee or a real hit');
}
try {
  await build({ root, logLevel: 'error', plugins: [stressPlugin], build: { outDir: temp } });
  for (const map of [1, 2]) await withBrowser({ root: temp, width: 412, height: 860, mobile: true, port: 9821 + map * 20 }, async ({ open, page }) => {
    const E = e => page.evaluate(e), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const tap = async id => {
      const b = await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e?.getBoundingClientRect();return e&&!e.hidden?{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}:null})()`);
      assert(b && b.w >= 44 && b.h >= 44 && b.hit, `native ${id}: complete reachable button`);
      await touchTap(page, b.x, b.y); await frames();
    };
    const query = map === 2 ? 'map=64' : '';
    await open(query);
    assert.equal(await E('!!__rts.report().data.zombies'), false, 'entry: normal battle stays the default');
    await tap('zombies-pick');
    assert.equal(await E('!!__rts.report().data.zombies'), true, 'entry: native touch enables mode');
    assert.equal(await E('__rts.tick()'), 0);
    await tap('zombies-pick'); assert.equal(await E('!!__rts.report().data.zombies'), false, 'entry: native touch returns to normal');
    await tap('zombies-pick');
    // 三顆入口同一排，且不與小地圖互擋；地圖切換保留模式。
    const boxes = await E("['sb-enter','map-pick','zombies-pick','minimap'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]})");
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]; assert(!(a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]), 'entry: controls and minimap do not overlap');
    }
    await tap('map-pick'); assert.equal(await E('!!__rts.report().data.zombies'), true, 'entry: map switch preserves mode');
    await tap('map-pick'); assert.equal(await E('__rts.map()'), map);
    const opening = await E('__rts.info()'); assert(opening.calls <= 20 && opening.triangles <= 80000, 'opening: phone budget');
    await shot(page, path.join(root, 'shots', `r045-map${map}-phone-start.png`));
    await tap('bb-start'); await E('__rts.pause(true)');
    const goal = await E("document.querySelector('#start-order .so-goal')?.textContent");
    assert.equal(goal, '喪屍從地圖邊緣湧來。守住指揮部，撐越多波越好。', 'entry: correct start order');
    assert(await E("document.getElementById('zombies-pick').hidden"), 'entry: battle hides mode button');
    const log = await E('__rts.log()'), seed = await E('__rts.seed()');
    assert(log.some(e => e.tick === 0 && e.cmd.t === 'zombies') && !log.some(e => e.cmd.side === 1), 'entry: replay records mode without enemy AI or construction');
    assert.equal((await E('__rts.eco()')).hq[1], 0);
    assert.equal(await E('__rts.units().filter(u=>u.alive&&u.side===1).length'), 0);
    const contact = secondWave(seed, log);
    await E(`__rts.stepN(${contact.tick}-__rts.tick());__rts.focus(${contact.x},${contact.z},2.5)`);
    assert.equal(await E('__rts.hash()'), contact.hash, 'replay: Node and Chrome second wave agree');
    assert.equal((await E('__rts.report().data.zombies')).wave, 2);
    await sleep(3000); await frames();
    const inFrame = async () => {
      const [x, y] = await E(`__rts.screenOf(${contact.id})`);
      assert(await E(`(()=>{const u=__rts.units().find(u=>u.id===${contact.id});return u?.alive && ${x}>32 && ${x}<innerWidth-32 && ${y}>200 && ${y}<innerHeight-200 && document.elementFromPoint(${x},${y})?.tagName==='CANVAS'})()`), 'shot: live combat zombie is inside the unobstructed frame');
    };
    await inFrame();
    const mobile = await E('__rts.info()'); budget(mobile);
    await shot(page, path.join(root, 'shots', `r045-map${map}-phone-wave2.png`));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await frames(); await inFrame();
    const desktop = await E('__rts.info()'); budget(desktop);
    await shot(page, path.join(root, 'shots', `r045-map${map}-desktop-wave2.png`));
    assert.equal(page.errors.length, 0, `runtime: ${page.errors.join(' | ')}`);
    console.log(`OK zombies Chrome map${map}: opening ${opening.calls}/${opening.triangles}; wave2 tick ${contact.tick} phone ${mobile.calls}/${mobile.triangles}, desktop ${desktop.calls}/${desktop.triangles}; hash ${contact.hash}`);
    if (map === 1) {
      const loss = runLog(createWorld(seed), log, contact.tick); while (loss.winner < 0 && loss.tick < 9000) step(loss, []);
      assert.equal(loss.winner, 1); await E(`__rts.stepN(${loss.tick}-__rts.tick())`); await sleep(2800); await frames();
      assert.equal(await E('__rts.hash()'), hashWorld(loss));
      const report = await E("({shown:__rts.report().shown,text:document.querySelector('#report .survival')?.textContent,best:localStorage.getItem('gtrts.v1.zombies.best')})");
      assert(report.shown && report.text.includes(`第 ${loss.zombies.wave} 波`) && report.text.includes(`${loss.zombies.killed} 隻`) && +report.best >= loss.zombies.wave, 'report: survival and best record');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await frames();
      await shot(page, path.join(root, 'shots', 'r045-phone-report.png'));
      console.log(`OK zombies Chrome report: ${report.text}`);
    }
    await open(query + '&mode=zombies'); assert(await E('!!__rts.report().data.zombies'), 'URL: activates mode');
    if (map === 2) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
      const stress = await E('__r045Stress()'); await frames();
      assert(stress.ids > 512 && stress.capacity > stress.ids && stress.finite, `render: stable IDs above 512 retain finite transforms: ${JSON.stringify(stress)}`);
      assert.equal(stress.alive, (48+40)*6, 'render: full legal infantry and zombie population is visible');
      assert(stress.men - stress.alive <= 64 && stress.faded === 0, 'render: mixed bodies are bounded and expire');
      const info = await E('__rts.info()'); budget(info);
      await shot(page, path.join(root, 'shots', 'r045-phone-cap48.png'));
      console.log(`OK zombies Chrome cap48/id512: ${JSON.stringify(stress)}; ${info.calls}/${info.triangles}`);
    }
    await open(query + '&mode=zombies&noR045=1');
    assert.equal(await E("!!document.getElementById('zombies-pick')"), false, 'valve: removes entry');
    assert.equal(await E('!!__rts.report().data.zombies'), false, 'valve: ignores mode URL');
    assert.equal(await E("getComputedStyle(document.querySelector('#help li.r045')).display"), 'none');
    assert.equal(await E('__rts.runScript()'), legacy, 'valve: old golden unchanged');
    assert.equal(page.errors.length, 0, `runtime: ${page.errors.join(' | ')}`);
    console.log(`OK zombies Chrome map${map}: URL, valve and legacy ${legacy}`);
  });
} catch (error) {
  // Preserve the original assertion; the sharded runner only keeps the final stderr lines.
  process.exitCode = 1;
  console.error(`R045 first failure: ${error.stack || error}`);
  console.error(`R045 assertion: ${error.message || error}`);
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r045-browser-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
