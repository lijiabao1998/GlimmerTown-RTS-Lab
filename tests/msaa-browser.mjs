// R065 真 Chrome：渲染目標真的開了多重取樣；?noR065=1 的畫面與「沒有 R065 那一行」的程式逐位相同；開著時房子邊緣多出中間色。
// 同一個世界、同一個鏡頭：萊伊與 96 圖、桌機與手機寬、一般遠近與拉近。截圖存在 shots/r065-*.png 給業主看。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r065-msaa-'));
const SAMPLE_LINE = 'if (this.rt.samples !== samples) { this.rt.samples = samples; this.rt.dispose(); }';
const fixture = { name: 'r065-msaa-proof', enforce: 'pre', transform(code, id) {
  const file = path.relative(root, id.split('?')[0]).replaceAll('\\', '/');
  // ?r065Legacy＝拿掉 R065 那一行（回到 R065 之前的 Pipeline），用來證明 ?noR065=1 逐位等於原本
  if (file === 'src/render/post.ts') { assert.equal(code.split(SAMPLE_LINE).length, 2, 'fixture: unique sample line'); return code.replace(SAMPLE_LINE, `if (!new URLSearchParams(location.search).has('r065Legacy')) { ${SAMPLE_LINE} }`); }
  if (file === 'src/main.ts') return code + '\nwindow.__r065Cam=(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);};';
} };
// 讀主畫面（preserveDrawingBuffer）：逐位指紋與顏色種類
const READ = `(()=>{const c=document.querySelector('canvas:not(#minimap)'),k=document.createElement('canvas');k.width=c.width;k.height=c.height;const x=k.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0);const d=x.getImageData(0,0,k.width,k.height).data;let h=2166136261>>>0;const set=new Set();for(let i=0;i<d.length;i+=4){const v=(d[i]<<16)|(d[i+1]<<8)|d[i+2];set.add(v);h=Math.imul(h^v,16777619)>>>0;}return {w:k.width,h:k.height,hash:h.toString(16),colors:set.size};})()`;
const results = [];
try {
  await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 1440, height: 900, port: 9965 }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const maxSamples = await E(`(()=>{const g=document.createElement('canvas').getContext('webgl2');return g?g.getParameter(g.MAX_SAMPLES):0;})()`);
    assert.ok(maxSamples >= 2, `chrome: WebGL2 MSAA available (MAX_SAMPLES ${maxSamples})`);
    for (const [width, height, mobile] of [[1440, 900, false], [412, 860, true]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      for (const [label, map, x, z, zoom] of [['rye', '', 16, 16, 1], ['rye-close', '', 15, 14, 3], ['96', '&map=96', 18, 18, 2]]) {
        const row = { label, width };
        for (const [name, extra] of [['on', ''], ['off', '&noR065=1'], ['legacy', '&noR065=1&r065Legacy=1']]) {
          await open(`seed=1944&noR100=1${map}${extra}`); await E(`__r065Cam(${x},${z},${zoom})`); await frames();
          const state = await E('({hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick()})'), info = await E('__rts.info()'), px = await E(READ);
          row[name] = { state, msaa: info.msaa, rt: info.rt, ...px };
          if (name !== 'legacy') await shot(page, path.join(root, 'shots', `r065-${label}-${width}-${name}.png`));
        }
        results.push(row); console.log('R065', JSON.stringify(row));
        assert.equal(row.on.msaa, Math.min(4, maxSamples), 'samples: default renders with 4x (or the GPU cap)');
        assert.equal(row.off.msaa, 0, 'valve: ?noR065=1 renders without samples'); assert.equal(row.legacy.msaa, 0);
        assert.deepEqual(row.on.state, row.off.state, 'same world and camera on/off'); assert.deepEqual(row.off.state, row.legacy.state, 'same world and camera off/legacy');
        assert.deepEqual(row.on.rt, row.off.rt, 'same render resolution (pixel style unchanged)');
        assert.equal(row.off.hash, row.legacy.hash, 'valve: ?noR065=1 is pixel-identical to the pre-R065 pipeline');
        assert.notEqual(row.on.hash, row.off.hash, 'msaa changes the frame');
        assert.ok(row.on.colors > row.off.colors, `edges: msaa adds in-between colors (${row.on.colors} vs ${row.off.colors})`);
      }
    }
    assert.deepEqual(page.errors, []);
  });
  fs.writeFileSync(path.join(root, 'shots', 'r065-msaa.json'), JSON.stringify(results, null, 2));
  console.log(`R065 msaa-browser: ${results.length} views OK`);
} catch (e) { console.error('R065 MSAA FAILURE ' + e.stack); process.exitCode = 1; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
