import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, touchTap, shot, sleep } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SUB } from '../src/sim/world.ts';
import { runLog, step, spotted } from '../src/sim/step.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r130-browser-'));
const metrics = [];
const browserPort = Number(process.argv.find(x => x.startsWith('--port='))?.split('=')[1] ?? 9971);
// 只加在隔離測試產物；正式產物沒有壓力局掛勾。
const fixture = { name: 'r130-pressure', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `
    window.__r130Pressure = () => {
      paused=true;view.setWorld(w);view.fogOn=false;
      const sample=structuredClone(w.units.find(u=>u.side===0));w.units=[];w.events=[];
      const cells=[];for(let z=37;z<60;z++)for(let x=37;x<60;x++)if(!w.occ[z*w.n+x])cells.push([x,z]);
      const add=(alive,side,x,z)=>{const u={...structuredClone(sample),id:w.units.length+1,alive,side,kind:UK_INFANTRY,hp:alive?60:0,x:center130(x),z:center130(z),path:[],pathIdx:0};w.units.push(u);w.events.push({e:'spawn',unit:u.id,x:u.x,z:u.z});return u;};
      function center130(c){return c*SUB+SUB/2;}
      for(let i=0;i<520;i++)add(false,i%2,85,85);
      for(let i=0;i<80;i++)add(true,i<40?0:1,...cells[i]);
      const dead=[];for(let i=0;i<12;i++)dead.push(add(true,i%2,...cells[i]));
      view.onEvents(w.events,0);w.events=[];view.update(1,0,selected);
      for(const u of dead){u.hp=0;u.alive=false;}view.update(1,0,selected);
      view.target.set(48,0,48);view.zoom=1.6;
      return {ids:w.units.length,capacity:view.prevX.length,alive:view.menDbg.alive,men:view.men.count,
        finite:Array.from(view.men.instanceMatrix.array.subarray(0,view.men.count*16)).every(Number.isFinite)};
    };
    window.__r130Expire=()=>{w.tick=620;view.update(1,31,selected);return view.men.count-view.menDbg.alive;};
  `;
} };
try {
  await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: temp } });
  await withBrowser({ root: temp, width: 412, height: 860, mobile: true, port: browserPort }, async ({ open, page }) => {
    const E = x => page.evaluate(x), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const tap = async id => {
      const b = await E(`(()=>{const e=document.getElementById(${JSON.stringify(id)}),r=e?.getBoundingClientRect();return e&&!e.hidden?{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}:null})()`);
      assert(b && b.w >= 44 && b.h >= 44 && b.hit, `entry: native ${id} is reachable`);
      await touchTap(page, b.x, b.y); await frames();
    };
    const capture = async (name, opening = false) => {
      await frames(); const info = await E('__rts.info()');
      assert(info.calls <= (opening ? 20 : 22) && info.triangles <= 80000, `budget: ${name} ${JSON.stringify(info)}`);
      const data = await E('({tick:__rts.tick(),n:__rts.mapSize(),map:__rts.map(),buildings:__rts.blds().length,hash:__rts.hash(),camera:__rts.cam()})');
      metrics.push({ name, ...data, ...info }); await shot(page, path.join(root, 'shots', name + '.png'));
      console.log(name, JSON.stringify({ ...data, ...info }));
    };
    await open(''); await tap('town-pick');
    assert.equal(await E('__rts.mapSize()'), 96, 'entry: native optional 96 map');
    assert.equal(await E('__rts.tick()'), 0); await capture('r130-phone-opening', true);
    await tap('map-pick'); assert.equal(await E('__rts.map()'), 1, 'entry: map key returns from 96 to Rye');
    await tap('map-pick'); assert.equal(await E('__rts.map()'), 2, 'entry: original 32 to 64 sequence');
    await tap('map-pick'); assert.equal(await E('__rts.map()'), 1, 'entry: original 64 to 32 sequence');
    await tap('town-pick'); await tap('zombies-pick');
    assert.equal(await E('__rts.mapSize()'), 96); assert(await E('!!__rts.report().data.zombies'), 'entry: zombie mode works on new town');
    await tap('town-pick'); await tap('town-pick');
    assert(await E('!!__rts.report().data.zombies'), 'entry: map switches preserve optional mode');
    for (const width of [320, 360, 412]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile: true }); await frames();
      const b = await E("(()=>{const r=document.getElementById('town-pick').getBoundingClientRect(),m=document.getElementById('minimap').getBoundingClientRect();return {ok:r.left>=0&&r.right<=innerWidth,overlap:r.left<m.right&&m.left<r.right&&r.top<m.bottom&&m.top<r.bottom}})()");
      assert(b.ok && !b.overlap, `entry: ${width}px no clipped control or minimap overlap`);
    }
    await open('map=96'); await tap('bb-start'); await E('__rts.pause(true)'); await sleep(3000);
    await E("__rts.issue({t:'move',side:0,ids:__rts.units().filter(u=>u.alive&&u.side===0).map(u=>u.id),x:48,z:48})");
    const seed = await E('__rts.seed()'), log = await E('__rts.log()');
    await E('__rts.stepN(600-__rts.tick());__rts.focus(48,48,2)'); await sleep(600);
    assert.equal(await E('__rts.hash()'), hashWorld(runLog(createWorld(seed), log, 600)), 'replay: Node and Chrome town battle agree');
    await capture('r130-phone-centre-30s');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await frames();
    await capture('r130-desktop-centre-30s');
    const combat = runLog(createWorld(seed), log, 600); let hit = null;
    while (combat.tick < 2400 && !hit && combat.winner < 0) {
      step(combat, []);
      if (combat.units.some(u => u.alive && u.side === 1 && spotted(combat, 0, u.x, u.z))) hit = combat.events.find(e => e.e === 'impact' && spotted(combat, 0, e.x, e.z));
    }
    assert(hit, 'combat: real visible encounter on the expanded map');
    await E(`__rts.stepN(${combat.tick}-__rts.tick());__rts.focus(${hit.x / SUB},${hit.z / SUB},2)`); await frames();
    assert.equal(await E('__rts.hash()'), hashWorld(combat), 'replay: Node and Chrome combat agree');
    await capture('r130-desktop-combat');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true }); await frames();
    await capture('r130-phone-combat');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await frames();
    await E('__rts.focus(18,18,2)'); await frames(); await capture('r130-desktop-village');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await E('__rts.focus(48,48,0.16)'); await frames();
    for (const [x, z] of [[0, 0], [96, 0], [0, 96], [96, 96]]) {
      const p = await E(`__rts.screenOfPoint(${x},0,${z})`);
      assert(p[0] >= 8 && p[0] <= 1272 && p[1] >= 70 && p[1] <= 820, 'overview: whole 96 map inside view');
    }
    await capture('r130-desktop-full-map');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await open('map=96'); const pressure = await E('__r130Pressure()'); await frames();
    assert.equal(pressure.alive, 80 * 6, 'pressure: legal 40+40 infantry population');
    assert(pressure.men - pressure.alive <= 64 && pressure.capacity > pressure.ids && pressure.finite, 'pressure: bodies bounded and long-session IDs finite');
    await capture('r130-phone-pop80'); assert.equal(await E('__r130Expire()'), 0, 'pressure: old bodies expire');
    await open('map=96&mode=zombies'); assert(await E('!!__rts.report().data.zombies'));
    const zs = await E('__rts.seed()'); await tap('bb-start'); await E('__rts.pause(true)'); const zl = await E('__rts.log()');
    await E('__rts.stepN(1801-__rts.tick())');
    assert.equal(await E('__rts.hash()'), hashWorld(runLog(createWorld(zs), zl, 1801)), 'replay: Node and Chrome town zombies agree');
    await open('map=96&noR026=1'); assert.equal(await E('__rts.mapSize()'), 96, 'entry: Rye valve does not block 96');
    await open('map=96&noR130=1'); assert.equal(await E('__rts.mapSize()'), 32, 'valve: ignores new-map URL');
    assert.equal(await E("!!document.getElementById('town-pick')"), false, 'valve: removes entry');
    assert.equal(await E('__rts.runScript()'), 'eea1d59b', 'valve: legacy golden unchanged');
    assert.deepEqual(page.errors, [], 'runtime: zero errors');
  });
  fs.writeFileSync(path.join(root, 'shots', 'r130-metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
} finally {
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('r130-browser-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
