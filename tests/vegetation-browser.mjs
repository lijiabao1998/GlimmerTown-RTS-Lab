// R116: real mobile/desktop Chrome, production raster, native input and same-tick simulation.
// Diagnostics and semantic mutants are injected only into isolated temporary Vite builds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';
import { createWorld, hashWorld, N, SUB, UK_TANK, ORD_IDLE, SHELL_AP, BK_COTTAGE, UNIT_KINDS } from '../src/sim/world.ts';
import { step, runLog, spotted, firstBlock } from '../src/sim/step.ts';
import { applyMap } from '../src/sim/maps.ts';
import { applyBuild, buildError } from '../src/sim/build.ts';
import { runScript } from '../src/sim/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r116-browser-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const buildOnly = process.argv.includes('--build-only'), fixtureOnly = process.argv.includes('--fixture-only');
const summary = [], record = s => { summary.push(s); console.log(s); };
const digest = s => createHash('sha256').update(s).digest('hex');
const occupied = w => Array.from(w.vegetation?.cells ?? []).flatMap((v, i) => v ? [[i % N, Math.floor(i / N), v]] : []);
const mapLog = [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1 } }];

// One identical fixture constructor is embedded in the isolated browser bundle. Its expected
// LOS booleans and integer damage are independent contracts, never read from rendering code.
function forestFixture() {
  const w = createWorld(1944);
  w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = [];
  w.vegetation = { version: 1, cells: new Uint8Array(w.n * w.n) };
  for (const [x, z, v] of [[14,15,1],[14,16,1],[14,17,1],[16,16,2],[17,18,2],[18,18,2],[17,19,2],[18,19,2]]) w.vegetation.cells[z * w.n + x] = v;
  for (const [side, x, z] of [[0,12,16],[1,16,16]]) w.units.push({
    id: w.units.length + 1, side, kind: UK_TANK, x: (x + 0.5) * SUB, z: (z + 0.5) * SUB,
    hp: 1000000, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0,
    cooldown: 1000000, aimX: SUB, aimZ: 0,
  });
  const [g, t] = w.units;
  w.shells.push({ id: w.nextShell++, side: g.side, kind: SHELL_AP, shooter: g.id, sx: g.x, sz: g.z, ex: t.x, ez: t.z, t: 0, T: 1, target: t.id, hitBld: 0 });
  return w;
}
function sightContract(w) {
  return [spotted(w, 0, 14.5 * SUB, 16.5 * SUB), spotted(w, 0, 16.5 * SUB, 16.5 * SUB),
    spotted(w, 1, 12.5 * SUB, 16.5 * SUB), firstBlock(w, 12.5 * SUB, 16.5 * SUB, 16.5 * SUB, 16.5 * SUB)];
}
const forest = forestFixture(), forestHit = structuredClone(forest); step(forestHit, []);
const tank = UNIT_KINDS[UK_TANK], damage = Math.floor(Math.floor(tank.dmgUnit * tank.pierce / 100) * tank.armor * 50 / 10000);
const opening = createWorld(1944); applyMap(opening, 1, 1);
const village = createWorld(1944); applyMap(village, 0, 1);
const buildCell = occupied(opening).map(([x,z]) => ({ t: 'build', side: 0, kind: BK_COTTAGE, x, z })).find(c => !buildError(opening, c));
const eco = runLog(createWorld(1944), mapLog, 1);
const legacy = runScript(0), legacy600 = runScript(600);

function fixtures() {
  assert.deepEqual(sightContract(forest), [true, false, false, -1], 'fixture: endpoint visible, middle foliage blocks both ways, shell path stays open');
  assert.equal(forest.units[1].hp - forestHit.units[1].hp, damage, 'fixture: impact takes independent 50-percent integer damage');
  assert(damage > 0 && occupied(opening).some(c => c[2] === 1) && occupied(opening).some(c => c[2] === 2), 'fixture: live two-type opening and meaningful cover damage');
  assert(buildCell, 'fixture: a legal native cottage placement actually covers foliage');
  const p = structuredClone(opening); applyBuild(p, buildCell);
  assert(occupied(p).length < occupied(opening).length && occupied(opening).length <= 64, 'fixture: preview clears foliage without altering source');
  assert(!legacy.vegetation && hashWorld(legacy600) === 'd7b3572f', 'fixture: old SCRIPT retains its historical world and 600-tick hash');
  record(`R116 fixtures: forest ${hashWorld(forest)} -> ${hashWorld(forestHit)}, damage ${damage}; Rye ${occupied(opening).length} cells, native cottage ${buildCell.x},${buildCell.z}`);
}

function savePNG(name, uri) {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(uri.split(',')[1], 'base64'));
}
function pixelDiff(a, b) {
  let count = 0, maxDelta = 0;
  const pixels = new Uint8ClampedArray(a.pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    let delta = 0;
    for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(a.pixels[i+k] - b.pixels[i+k]));
    if (delta) count++;
    maxDelta = Math.max(maxDelta, delta); pixels[i] = delta; pixels[i+3] = 255;
  }
  return { count, maxDelta, pixels: Array.from(pixels) };
}

// This is appended to main.ts after normal initialization. No hook enters src/ or dist/.
const instrumentation = `
import { ORD_IDLE, SHELL_AP } from './sim/world.ts';
import { spotted, firstBlock } from './sim/step.ts';
${forestFixture.toString()}
${sightContract.toString()}
let r116TerrainSnapshot: any;
(window as any).__r116test = {
  inspect: () => ({
    tick: w.tick, hash: hashWorld(w), phase, log: JSON.parse(JSON.stringify(log)),
    cells: Array.from(w.vegetation?.cells ?? []), shown: Array.from(view.world.vegetation?.cells ?? []),
    units: w.units.map(u => ({ id: u.id, hp: u.hp, x: u.x, z: u.z })),
    sight: sightContract(w),
    model: { shown: !!view.vegetation116.mesh, visible: !!view.vegetation116.mesh?.visible, count: view.vegetation116.cells, triangles: view.vegetation116.triangles, builds: view.vegetation116.builds },
    geometry: (() => { const out: any[] = []; view.scene.traverse((o: any) => { if (o.geometry) out.push([o.geometry.uuid, o.geometry.getAttribute('position')?.count ?? 0]); }); return out; })(),
  }),
  terrain: () => {
    const fingerprint = (a: ArrayBufferView) => { let h = 2166136261; const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (const v of bytes) h = Math.imul(h ^ v, 16777619); return h >>> 0; };
    const town = (view as any).town.geometry;
    return { triangles: view.townTriangles, position: fingerprint(town.attributes.position.array), color: fingerprint(town.attributes.color.array), ground: fingerprint((view as any).groundPx) };
  },
  rememberTerrain: () => {
    const town = (view as any).town.geometry;
    r116TerrainSnapshot = { position: town.attributes.position.array.slice(), color: town.attributes.color.array.slice(), ground: (view as any).groundPx.slice() };
  },
  terrainDifference: () => {
    const town = (view as any).town.geometry, current = { position: town.attributes.position.array, color: town.attributes.color.array, ground: (view as any).groundPx };
    const fields: any = {}, cells: any = {}, width = (view as any).groundTex.image.width, height = (view as any).groundTex.image.height, cellSize = width / w.n;
    for (const field of ['position', 'color', 'ground']) {
      const a = r116TerrainSnapshot[field], b = (current as any)[field], first: any[] = []; let count = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) {
        count++; if (first.length < 64) first.push({ index: i, native: a[i] ?? null, replay: b[i] ?? null });
        if (field === 'ground') {
          const pixel = Math.floor(i / 4), x = Math.floor((pixel % width) / cellSize), z = Math.floor(Math.floor(pixel / width) / cellSize), key = x + ',' + z;
          if (!cells[key]) cells[key] = { x, z, bytes: 0, terrain: w.ter[z * w.n + x], occupation: w.occ[z * w.n + x] };
          cells[key].bytes++;
        }
      }
      fields[field] = { nativeLength: a.length, replayLength: b.length, count, first };
    }
    const png = (pixels: Uint8Array) => { const c = document.createElement('canvas'); c.width = width; c.height = height; c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0); return c.toDataURL(); };
    const difference = new Uint8Array(current.ground.length);
    for (let i = 0; i < difference.length; i += 4) { for (let k = 0; k < 3; k++) difference[i + k] = Math.abs(current.ground[i + k] - r116TerrainSnapshot.ground[i + k]); difference[i + 3] = 255; }
    return { fields, cells: Object.values(cells), width, height, nativePNG: png(r116TerrainSnapshot.ground), replayPNG: png(current.ground), differencePNG: png(difference) };
  },
  fixture: () => {
    reset(1944, false, false, false, false, false);
    w = forestFixture(); phase = 'battle'; plan = []; pending = []; log = []; acc = 0; paused = true;
    view.setWorld(w, -1); view.snapshot(); stats = newStats(w); minimap?.dirty(); ui();
    return hashWorld(w);
  },
  refresh: () => { minimap?.dirty(); ui(); },
  mutation: (name: string) => { (globalThis as any).__r116mutation = name; },
};`;

function plugin(broken, hits) {
  const is = name => `(globalThis as any).__r116mutation === '${name}'`;
  return {
    name: broken ? 'r116-isolated-semantic-mutants' : 'r116-isolated-observation', enforce: 'pre',
    transform(code, id) {
      const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
      const replace = (from, to, label) => {
        assert.equal(code.split(from).length - 1, 1, `unique isolated R116 source anchor: ${label}`);
        code = code.replace(from, to); hits.add(label);
      };
      if (rel === 'src/main.ts') {
        if (broken) {
          replace("const r116 = q.get('noR116') !== '1';", "const r116 = q.get('__r116mutant') === 'valve' || q.get('noR116') !== '1';", 'valve');
          replace('  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));',
            `  if (view.vegetation116.mesh) view.vegetation116.mesh.visible = !(${is('model')});\n  view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));`, 'model');
          replace('if (map || vegetation) applyMap(w, mapId, vegetation ? 1 : undefined);',
            `if (map || vegetation) applyMap(w, mapId, vegetation && !(${is('generation')}) ? 1 : undefined);`, 'generation');
          replace('function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026 || large || expanded, vegetation = true, sandbox = false) {',
            `function reset(s = seed, build = r006, ai = r018, eco = r019, map = r026 || large || expanded, vegetation = true, sandbox = false) {\n  if (${is('legacy')}) vegetation = true;`, 'legacy');
        }
        code += instrumentation; hits.add('observation');
      }
      if (broken && rel === 'src/render/vegetation.ts') {
        replace('    if (this.world === w && this.state === w.vegetation && !changed) return;',
          `    if (${is('model-stale')} && this.mesh && this.world !== w) return;\n    if (this.world === w && this.state === w.vegetation && !changed) return;`, 'model-stale');
        replace("get hint(): string { return this.cells ? VEGETATION_HINT : ''; }",
          `get hint(): string { return !(${is('hint')}) && this.cells ? VEGETATION_HINT : ''; }`, 'hint');
      }
      if (broken && rel === 'src/ui/minimap.ts') {
        replace('const foliage = a.vegetation !== false ? vegetationAt(w, x, z) : 0;',
          `const foliage = a.vegetation !== false && !(${is('map')}) ? vegetationAt(w, x, z) : 0;`, 'map');
        replace('if (w !== baseWorld) baseDirty = true;', `if (!(${is('map-stale')}) && w !== baseWorld) baseDirty = true;`, 'map-world');
        replace('if (w === baseWorld && w.vegetation !== baseVegetation) baseDirty = true;', `if (!(${is('map-stale')}) && w === baseWorld && w.vegetation !== baseVegetation) baseDirty = true;`, 'map-state');
      }
      if (broken && rel === 'src/sim/step.ts') {
        replace('if (w.vegetation && vegetationBlocks(w, cells)) continue;',
          `if (!(${is('los')}) && w.vegetation && vegetationBlocks(w, cells)) continue;`, 'los');
        replace('vegetationAt(w, x, z) ? 50 :', `vegetationAt(w, x, z) ? (${is('cover')} ? 100 : 50) :`, 'cover');
      }
      if (broken && rel === 'src/sim/vegetation.ts') {
        replace('export function clearVegetation(w: World, x: number, z: number, width: number, depth: number): void {',
          `export function clearVegetation(w: World, x: number, z: number, width: number, depth: number): void {\n  if (${is('clear')}) return;`, 'clear');
      }
      return code;
    },
  };
}

async function main() {
  fixtures();
  if (fixtureOnly) return;
  const started = Date.now(), baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  const baseHits = new Set(), mutantHits = new Set();
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin(false, baseHits)], build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin(true, mutantHits)], build: { outDir: broken } });
  assert.deepEqual([...baseHits], ['observation'], 'fixture: baseline adds observation only');
  assert.equal(mutantHits.size, 13, 'fixture: every isolated semantic source mutation was applied');
  record('R116 isolated baseline/mutant builds compiled; this is not a Chrome pass');
  if (buildOnly) return;
  const overlay = {}, off = new Map();
  await withBrowser({ root: baseline, overlay, port: 8436, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 70 }, async ({ open, page }) => {
    const bounded = async (task, label) => {
      const ms = Math.min(8000, 110000 - (Date.now() - started));
      if (ms <= 0) throw Error('R116 browser operational deadline exceeded');
      let timer;
      try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${label}`)), ms); })]); }
      finally { clearTimeout(timer); }
    };
    const send = page.send.bind(page), evaluate = page.evaluate.bind(page);
    page.send = (method, args) => bounded(send(method, args), method);
    page.evaluate = expression => bounded(evaluate(expression), 'evaluate');
    const E = expression => page.evaluate(expression);
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const settle = async () => { await sleep(115); await frames(); };
    const inspect = () => E('__r116test.inspect()');
    const logic = s => ({ tick: s.tick, hash: s.hash, phase: s.phase, log: s.log, cells: s.cells, shown: s.shown, units: s.units, sight: s.sight });
    // Never read the production minimap context: repeated getImageData can switch Chrome's
    // raster backend. A fresh CPU scratch canvas preserves exact production-cache comparisons.
    const sample = () => E(`(()=>{const c=document.getElementById('minimap'),copy=document.createElement('canvas');copy.width=c.width;copy.height=c.height;const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(c,0,0);return {width:c.width,height:c.height,pixels:Array.from(ctx.getImageData(0,0,copy.width,copy.height).data),png:c.toDataURL(),webgl:document.querySelector('body>canvas').toDataURL(),state:__r116test.inspect(),calls:__rts.info().calls,triangles:__rts.info().triangles,hint:document.getElementById('hint').textContent,cam:__rts.cam()}})()`);
    const viewport = async mobile => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: mobile ? 412 : 1280, height: mobile ? 860 : 800, deviceScaleFactor: 1, mobile });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    };
    const fresh = async (query = '') => {
      await open('noR018=1&noR016=1&' + query);
      assert(await E('!!window.__rts?.ready && !!window.__r116test'), 'fixture: real production application and isolated observation are ready');
      await E('__rts.pause(true)'); await settle();
    };
    const mutation = name => E(`__r116test.mutation(${JSON.stringify(name)})`);
    const click = async (x, y, mobile) => {
      if (mobile) await touchTap(page, x, y);
      else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await frames();
    };
    const button = async (id, mobile) => {
      const p = await E(`(()=>{const b=document.getElementById(${JSON.stringify(id)}),r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,r.width,r.height,b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})()`);
      assert(p[4] && p[2] >= 44 && p[3] >= 44, `fixture: ${id} is an unobstructed native touch target`);
      await click(p[0], p[1], mobile);
    };
    const shot = async name => {
      const png = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'shots', name), Buffer.from(png.data, 'base64'));
    };
    const saveDiff = async (name, a, b) => {
      const diff = pixelDiff(a, b); savePNG(`r116-${name}-source.png`, a.png); savePNG(`r116-${name}-reference.png`, b.png);
      const png = await E(`(()=>{const c=document.createElement('canvas');c.width=${a.width};c.height=${a.height};const x=c.getContext('2d');x.putImageData(new ImageData(new Uint8ClampedArray(${JSON.stringify(diff.pixels)}),c.width,c.height),0,0);return c.toDataURL()})()`);
      savePNG(`r116-${name}-diff.png`, png);
      fs.writeFileSync(path.join(ROOT, 'shots', `r116-${name}-state.json`), JSON.stringify({ actual: { state: a.state, cam: a.cam, calls: a.calls, triangles: a.triangles }, reference: { state: b.state, cam: b.cam, calls: b.calls, triangles: b.triangles }, diff: { count: diff.count, maxDelta: diff.maxDelta } }, null, 2));
    };
    const equalMap = async (a, b, label, artifact) => {
      assert.deepEqual([a.width,a.height], [b.width,b.height], `${label}: canvas dimensions`);
      const d = pixelDiff(a,b);
      if (d.count) await saveDiff(artifact,a,b);
      assert.equal(d.count, 0, label);
    };
    const budget = (s, opening, label) => assert(s.calls <= (opening ? 20 : 22) && s.triangles <= 80000, `${label}: existing ${opening ? 20 : 22}-call / 80000-triangle budget (${s.calls}/${s.triangles})`);
    const layout = async label => {
      const g = await E(`(()=>{const h=document.getElementById('hint'),p=document.getElementById('prodbar'),m=document.getElementById('minimap'),bar=document.querySelector('#hud .btns');return {hint:h.getBoundingClientRect().toJSON(),prod:p.getBoundingClientRect().toJSON(),mini:m.getBoundingClientRect().toJSON(),bar:bar.getBoundingClientRect().toJSON(),shown:!p.hidden,scroll:h.scrollHeight,client:h.clientHeight,width:innerWidth,height:innerHeight,buttons:[...p.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})}})()`);
      assert(g.shown && g.prod.bottom <= g.hint.top - 6 && g.hint.bottom <= g.height && g.hint.right <= g.width && g.hint.top >= 0 && g.scroll <= g.client, `${label}: vegetation hint and production stay visible with clearance`);
      assert(g.mini.bottom < g.prod.top && g.bar.bottom <= g.mini.top, `${label}: minimap and toolbar do not overlap production`);
      assert(g.buttons.every(b => b.w >= 44 && b.h >= 44 && b.hit), `${label}: production touch targets remain usable`);
    };
    const forestScene = async (afterHit = false) => {
      await E('__r116test.fixture();__rts.focus(15.5,17,1.25)');
      if (afterHit) await E('__rts.stepN(1)');
      await settle();
      return sample();
    };
    const legacyScene = async () => {
      await E('__rts.runScript(0);__rts.pause(true);__rts.focus(15.5,17,1.25)'); await settle();
      return sample();
    };
    const hintCheck = s => assert(s.hint.includes('樹籬／林地') && s.hint.includes('可穿行') && s.hint.includes('50%') && s.hint.includes('不疊加'), 'hint: visible idle legend explains traversable foliage and non-stacking half damage');
    const modelCheck = (on, reference) => {
      assert.notEqual(digest(on.webgl), digest(reference.webgl), 'model: same-tick main canvas contains visible foliage pixels');
      assert(on.state.model.shown && on.state.model.visible && on.state.model.count === 8 && on.state.model.triangles > 0 && on.state.model.triangles <= 64 * 30, 'model: one bounded merged foliage mesh matches the live cells');
      assert.equal(on.calls, reference.calls + 1, 'model: foliage adds exactly one unshadowed draw call');
    };
    const miniCheck = async (on, reference, label) => {
      assert.deepEqual([on.width,on.height], [reference.width,reference.height], 'fixture: paired minimap dimensions');
      const s = on.width / 64, patch = (v,x,z) => {
        const cx = Math.floor(v.width / 2 + (x-z) * s), cy = Math.floor((x+z) * s / 2), out = [];
        for (let y=cy-1;y<=cy+1;y++) for(let x=cx-1;x<=cx+1;x++) out.push(...v.pixels.slice((y*v.width+x)*4,(y*v.width+x)*4+4));
        return out;
      };
      if (digest(on.png) === digest(reference.png)) await saveDiff(`${label}-map-missing`,on,reference);
      assert.notDeepEqual(patch(on,14.5,15.5), patch(reference,14.5,15.5), 'minimap: hedge symbol changes exact pixels at the independently projected hedge cell');
      assert.notDeepEqual(patch(on,18.5,19.5), patch(reference,18.5,19.5), 'minimap: woodland symbol changes exact pixels at the independently projected wood cell');
      const centers = occupied(forest).map(([x,z]) => [on.width/2+(x-z)*s,(x+z+1)*s/2]);
      let changes = 0;
      for(let i=0;i<on.pixels.length;i+=4) if (on.pixels.slice(i,i+4).some((v,k)=>v!==reference.pixels[i+k])) {
        changes++; const x=(i/4)%on.width+0.5,y=Math.floor(i/4/on.width)+0.5;
        assert(centers.some(([a,b])=>Math.abs(x-a)<=2 && Math.abs(y-b)<=2), 'minimap: display-only changes stay within foliage symbols, never move units or camera');
      }
      assert(changes > 0, 'minimap: enabled symbols have an actual raster');
    };

    const generationCheck = async () => {
      const s = await inspect();
      assert.deepEqual(s.cells, Array.from(opening.vegetation.cells), 'generation: ordinary new game enables the deterministic two-type vegetation layout');
      assert.equal(s.hash, hashWorld(opening), 'generation: pre-applied opening matches Node including RNG');
      assert.deepEqual(s.log, [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }], 'generation: new game records exactly one explicit vegetation map command');
    };
    const placeNative = async mobile => {
      await E(`__rts.focus(${buildCell.x+0.5},${buildCell.z+0.5},1.25)`); await settle();
      const p = await E(`__rts.screenOfCell(${buildCell.x},${buildCell.z})`);
      assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`), 'fixture: ground placement is a genuine unobstructed canvas input');
      await click(p[0],p[1],mobile); await settle();
      assert.deepEqual(await E('__rts.plan()'), [buildCell], 'fixture: native placement adds the intended foliage-cell cottage');
      return sample();
    };
    const previewCheck = s => {
      const cell = buildCell.z * N + buildCell.x;
      assert.equal(s.state.shown[cell], 0, 'clear: native building preview clears its actual foliage footprint');
      assert.deepEqual(s.state.cells, Array.from(opening.vegetation.cells), 'preview: planning does not clear foliage in the actual world');
      assert.equal(s.state.hash, hashWorld(opening), 'preview: planning does not change actual simulation or RNG');
      assert.equal(s.state.model.count, s.state.shown.filter(Boolean).length, 'preview: model refresh matches foliage cleared in the displayed world');
    };
    const nativeFlow = async mobile => {
      const label = mobile ? 'mobile' : 'desktop';
      await generationCheck();
      const openingSample = await sample(); budget(openingSample,true,label);
      await shot(`r116-${label}-opening.png`);
      await E(`__rts.focus(${buildCell.x+0.5},${buildCell.z+0.5},1.25)`); await settle();
      const before = await sample(), preview = await placeNative(mobile); previewCheck(preview);
      assert.notEqual(digest(preview.png),digest(before.png), `${label}: native preview changes the actual minimap base`);
      await shot(`r116-${label}-preview.png`);
      await button('bb-undo',mobile); await settle();
      const cancelled = await sample();
      assert.deepEqual(await E('__rts.plan()'), [], `${label}: native undo removes the planned cottage`);
      assert.deepEqual(logic(cancelled.state),logic(before.state), `${label}: cancelled preview restores current and displayed vegetation`);
      await equalMap(cancelled,before,`${label}: cancelling preview restores exact minimap pixels`,`${label}-cancel`);
      await shot(`r116-${label}-preview-cancel.png`);
      previewCheck(await placeNative(mobile));
      await button('bb-start',mobile); await E('__rts.pause(true)'); await settle();
      const started = await sample();
      await E('__r116test.rememberTerrain()');
      const terrain = await E('__r116test.terrain()');
      assert(started.state.phase === 'battle' && started.state.tick > 0, `${label}: ordinary start enters battle`);
      const replayed = runLog(createWorld(1944),started.state.log,started.state.tick);
      assert.equal(started.state.hash,hashWorld(replayed), `${label}: full native plan/eco/start matches recorded Node replay`);
      assert.deepEqual(started.state.cells,Array.from(replayed.vegetation.cells), `${label}: actual buildings and HQ use the recorded cleared vegetation`);
      for(const b of replayed.blds) for(let z=b.z;z<b.z+b.d;z++) for(let x=b.x;x<b.x+b.w;x++) assert.equal(started.state.cells[z*N+x],0,`${label}: every actual building/HQ footprint is clear`);
      budget(started,false,label); await layout(label);
      assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(started.state.log)},${started.state.tick})`),started.state.hash,`${label}: Chrome replay agrees at the exact native-start tick`);
      await E(`__rts.pause(true);__rts.focus(${buildCell.x+0.5},${buildCell.z+0.5},1.25)`); await settle();
      const replayTerrain = await E('__r116test.terrain()');
      if (JSON.stringify(replayTerrain) !== JSON.stringify(terrain)) {
        const { nativePNG, replayPNG, differencePNG, ...difference } = await E('__r116test.terrainDifference()');
        savePNG(`r116-${label}-terrain-native.png`,nativePNG); savePNG(`r116-${label}-terrain-replay.png`,replayPNG); savePNG(`r116-${label}-terrain-diff.png`,differencePNG);
        savePNG(`r116-${label}-native-scene.png`,started.webgl); await shot(`r116-${label}-replay-scene.png`);
        fs.writeFileSync(path.join(ROOT,'shots',`r116-${label}-terrain-state.json`),JSON.stringify({ native: terrain, replay: replayTerrain, difference, nativeState: started.state, replayState: await inspect() },null,2));
        record(`R116 ${label} terrain mismatch: ${JSON.stringify({native:terrain,replay:replayTerrain,cells:difference.cells})}`);
      }
      assert.deepEqual(replayTerrain,terrain,`${label}: native-start and same-log replay have identical town geometry and ground texture; native=${JSON.stringify(terrain)} replay=${JSON.stringify(replayTerrain)}`);
      await equalMap(await sample(),started,`${label}: replay restores exact cleared minimap pixels`,`${label}-replay`);
      await button('b-restart',mobile); await settle(); await generationCheck();
      await E(`__rts.focus(${buildCell.x+0.5},${buildCell.z+0.5},1.25)`); await settle();
      await equalMap(await sample(),before,`${label}: reset restores exact new-game foliage`,`${label}-reset`);
      await shot(`r116-${label}-reset.png`);
      record(`R116 ${label}: native preview/cancel/start/replay/reset; opening ${openingSample.calls}/${openingSample.triangles}, battle ${started.calls}/${started.triangles}`);
    };
    const nativeSelection = async mobile => {
      assert.equal(await E(`__rts.playLog(1944,${JSON.stringify(mapLog)},1)`), hashWorld(eco), 'fixture: production and enabled vegetation replay match Node');
      await E('__rts.pause(true);__rts.focus(29,29,1.25)'); await settle();
      const p = await E('__rts.screenOf(4)');
      assert(await E(`document.elementFromPoint(${p[0]},${p[1]})===document.querySelector('body>canvas')`),'fixture: native unit selection is unobstructed');
      await click(p[0],p[1],mobile);
      assert.deepEqual(await E('__rts.selected()'),[4], 'input: foliage preserves ordinary native unit selection');
      const selected = await inspect(); await layout('selected gun');
      const cam = await E('__rts.cam()'), target = await E('__rts.miniPoint(13,14)');
      await click(target[0],target[1],mobile); await sleep(420); await frames();
      const moved = await E('__rts.cam()');
      assert(Math.abs(moved.x-13)<0.05 && Math.abs(moved.z-14)<0.05 && (Math.abs(cam.x-moved.x)>1 || Math.abs(cam.z-moved.z)>1), 'input: native minimap tap still moves the camera to its independent world coordinate');
      assert.deepEqual(logic(await inspect()),logic(selected), 'input: native minimap navigation changes no selection command, tick or world');
      assert.deepEqual(await E('__rts.selected()'),[4], 'input: minimap navigation preserves selected unit');
      await E('__rts.select([])'); await settle(); hintCheck(await sample()); await layout('idle foliage');
    };
    const losCheck = async () => assert.deepEqual((await inspect()).sight,[true,false,false,-1], 'los: Chrome sees foliage endpoints but blocks intermediate foliage in both directions');
    const coverCheck = async () => {
      const hp = (await inspect()).units[1].hp; await E('__rts.stepN(1)'); await settle();
      const now = await inspect();
      assert.equal(hp-now.units[1].hp,damage,'cover: Chrome applies exact independent half-damage at impact');
      assert.equal(now.hash,hashWorld(forestHit),'cover: exact same-tick Node and Chrome complete-world hashes agree');
    };
    const legacyCheck = async () => {
      const s = await legacyScene();
      assert.equal(s.state.cells.length,0,'legacy: old script playback never acquires unrecorded vegetation');
      assert.equal(s.state.hash,hashWorld(legacy),'legacy: old script keeps the original complete-world hash');
      assert(!s.state.model.shown && !s.hint.includes('樹籬／林地'),'legacy: replacing a new game removes all foliage models and hints');
      return s;
    };
    const valveCheck = async () => {
      const s = await forestScene();
      assert(!s.state.model.shown && !s.hint.includes('樹籬／林地'),'valve: noR116 removes all new models and legend');
      assert.equal(s.state.hash,hashWorld(forest),'valve: display valve retains the enabled simulation hash');
      await losCheck(); await coverCheck(); return s;
    };

    for(const mobile of [true,false]) {
      const label = mobile ? 'mobile' : 'desktop', errorCount = page.errors.length;
      await viewport(mobile); await fresh('noR116=1');
      const disabled = await valveCheck();
      await forestScene(true); await shot(`r116-${label}-forest-tick1-off.png`);
      const old = await legacyCheck(); off.set(label,{ forest: disabled, legacy: old });
      await fresh(); await nativeFlow(mobile); await nativeSelection(mobile);
      const on = await forestScene(); modelCheck(on,disabled); await miniCheck(on,disabled,label); hintCheck(on);
      assert.deepEqual(logic(on.state),logic(disabled.state),`${label}: foliage display changes no world, RNG, LOS or commands`);
      budget(on,false,`${label} forest`); await losCheck(); await coverCheck();
      const stable = await inspect(); await sleep(160); await frames(); const later = await inspect();
      assert.deepEqual(logic(later),logic(stable),`${label}: paused foliage stays simulation-read-only`);
      assert.deepEqual(later.geometry,stable.geometry,`${label}: paused frames reuse every existing geometry`);
      assert.equal(later.model.builds,stable.model.builds,`${label}: stable frames never rebuild foliage`);
      await shot(`r116-${label}-forest-tick1-on.png`);
      await equalMap(await legacyCheck(),old,`${label}: new-to-old same-tick replay removes exact old foliage pixels`,`${label}-new-to-old`);
      assert.equal(await E('__rts.playScript(600)'),hashWorld(legacy600),`${label}: historical event-driven hot spot matches Node`);
      await E('__rts.pause(true)'); await settle(); const hot=await sample(); budget(hot,false,`${label} legacy hot spot`);
      await shot(`r116-${label}-legacy-hot.png`);
      await fresh('noR026=1');
      const randomOpening=await sample();
      assert.equal(randomOpening.state.hash,hashWorld(village),`${label}: normal map0 opening uses its own deterministic foliage layout`);
      assert.deepEqual(randomOpening.state.log,[{tick:0,cmd:{t:'map',id:0,vegetation:1}}],`${label}: random village records map0 vegetation explicitly`);
      assert.deepEqual(randomOpening.state.cells,Array.from(village.vegetation.cells),`${label}: normal map0 foliage matches Node`);
      budget(randomOpening,true,`${label} map0 opening`); await shot(`r116-${label}-map0-opening.png`);
      await legacyCheck(); await button('b-restart',mobile); await settle();
      await equalMap(await sample(),randomOpening,`${label}: normal map0 reset removes previous world's minimap`,`${label}-map0-reset`);
      assert.equal(page.errors.length,errorCount,`${label}: no unrelated runtime errors`);
      record(`R116 ${label}: same-tick model/minimap/hint/LOS/cover/valve, native selection/minimap; forest ${on.calls}/${on.triangles}, legacy hot ${hot.calls}/${hot.triangles}`);
    }

    // A single mutant page permits independent bounded mutations without a dozen expensive
    // SwiftShader restarts. Every negative must fail its exact assertion, never startup/runtime.
    overlay['index.html'] = fs.readFileSync(path.join(broken,'index.html'));
    await viewport(true); await fresh();
    const reference = off.get('mobile');
    const negatives = [
      ['generation', async()=>{await button('b-restart',true);await settle();await generationCheck();}, 'generation: ordinary new game enables the deterministic two-type vegetation layout'],
      ['legacy', legacyCheck, 'legacy: old script playback never acquires unrecorded vegetation'],
      ['los', async()=>{await forestScene();await losCheck();}, 'los: Chrome sees foliage endpoints but blocks intermediate foliage in both directions'],
      ['cover', async()=>{await forestScene();await coverCheck();}, 'cover: Chrome applies exact independent half-damage at impact'],
      ['clear', async()=>{await button('b-restart',true);await settle();previewCheck(await placeNative(true));}, 'clear: native building preview clears its actual foliage footprint'],
      ['model-stale', async()=>{await button('b-restart',true);await settle();previewCheck(await placeNative(true));}, 'preview: model refresh matches foliage cleared in the displayed world'],
      ['model', async()=>modelCheck(await forestScene(),reference.forest), 'model: same-tick main canvas contains visible foliage pixels'],
      ['map', async()=>miniCheck(await forestScene(),reference.forest,'negative'), 'minimap: hedge symbol changes exact pixels at the independently projected hedge cell'],
      ['hint', async()=>hintCheck(await forestScene()), 'hint: visible idle legend explains traversable foliage and non-stacking half damage'],
      ['map-stale', async()=>{await forestScene();const old=await legacyScene();await equalMap(old,reference.legacy,'cache: same-tick world replacement clears exact foliage raster','negative-cache');}, 'cache: same-tick world replacement clears exact foliage raster'],
    ];
    for(const [name,run,expected] of negatives) {
      const errors=page.errors.length; await mutation(name); let failure;
      try { await run(); } catch(error) { failure=error; }
      assert(failure instanceof assert.AssertionError && failure.message.startsWith(expected),`negative ${name}: expected first semantic assertion, got ${failure?.stack ?? 'no failure'}`);
      assert.equal(page.errors.length,errors,`negative ${name}: no unrelated runtime error`);
      record(`RED real Chrome ${name}: ${expected}`); await mutation('');
    }
    await fresh('noR116=1&__r116mutant=valve');
    const errors=page.errors.length; let failure;
    try { await valveCheck(); } catch(error) { failure=error; }
    assert(failure instanceof assert.AssertionError && failure.message.startsWith('valve: noR116 removes all new models and legend'),`negative valve: expected semantic assertion, got ${failure?.stack ?? 'no failure'}`);
    assert.equal(page.errors.length,errors,'negative valve: no unrelated runtime error');
    record('RED real Chrome valve: noR116 removes all new models and legend');
    assert(page.requests.every(r=>r.startsWith('http://127.0.0.1:8436/') || r.startsWith('data:') || r==='about:blank'),'resources: no external model, image, font or texture request');
  });
  record(`R116 real Chrome complete in ${Date.now()-started}ms (120s child limit unchanged)`);
}

try {
  await main();
  fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'shots/r116-browser.txt'),summary.join('\n')+'\n');
  if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\n### R116 real vegetation guards\n${summary.map(s=>'- '+s).join('\n')}\n`);
} catch(error) {
  const message=String(error?.stack ?? error);
  if(/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message) && !strictCI) {
    console.error('NOT RUN R116 real Chrome guards: local socket permission restriction; CI must execute them.'); console.error(error.message); process.exitCode=77;
  } else { console.error(error); console.error(`R116 browser FAIL: ${String(error.message).split('\n')[0]}`); process.exitCode=1; }
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
