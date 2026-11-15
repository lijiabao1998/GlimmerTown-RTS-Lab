// R065 真 Chrome：渲染目標真的開了多重取樣；?noR065=1 的畫面與「沒有 R065 那一行」的程式逐位相同；開著時房子邊緣多出中間色。
// R079（業主 2026-11-15「改回關」）：預設不取樣——預設的畫面逐位等於 ?noR065=1，在「當成有顯示卡」的時候也一樣；要開用 ?msaa=4；閥贏過 ?msaa。
// 守衛的 Chrome 是軟體繪圖（SwiftShader），產品在那裡不取樣：?r065ForceMsaa（只在這支守衛的建置裡有）讓它當成有顯示卡，驗取樣真的有效、也驗「有顯示卡時的預設」。
// 本機可以用真顯示卡跑：GT_REAL_GPU=1 node tests/msaa-browser.mjs（這時不必強制，直接驗真顯示卡上的預設與 ?msaa=4）。
// 這一支只跑桌機寬（1440）；手機寬（412）在 tests/msaa-phone-browser.mjs（同一份程式換一組畫面）。R079 每個畫面從四種開法變六種，一支跑完會超過 CI 每支守衛 120 秒的上限，所以依寬度拆成兩支，驗的東西沒有少。
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
  if (file === 'src/render/post.ts') {
    const SOFT = 'export function softwareRenderer(name: string): boolean {';
    assert.equal(code.split(SAMPLE_LINE).length, 2, 'fixture: unique sample line'); assert.equal(code.split(SOFT).length, 2, 'fixture: unique software check');
    return code.replace(SAMPLE_LINE, `if (!new URLSearchParams(location.search).has('r065Legacy')) { ${SAMPLE_LINE} }`).replace(SOFT, `${SOFT} if (new URLSearchParams(location.search).has('r065ForceMsaa')) return false;`);
  }
  if (file === 'src/main.ts') return code + '\nwindow.__r065Cam=(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);};';
} };
// 讀主畫面（preserveDrawingBuffer）：逐位指紋與顏色種類
const READ = `(()=>{const c=document.querySelector('canvas:not(#minimap)'),k=document.createElement('canvas');k.width=c.width;k.height=c.height;const x=k.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0);const d=x.getImageData(0,0,k.width,k.height).data;let h=2166136261>>>0;const set=new Set();for(let i=0;i<d.length;i+=4){const v=(d[i]<<16)|(d[i+1]<<8)|d[i+2];set.add(v);h=Math.imul(h^v,16777619)>>>0;}return {w:k.width,h:k.height,hash:h.toString(16),colors:set.size};})()`;
const VIEWS = globalThis.__r065Views ?? [[1440, 900, false]], PORT = globalThis.__r065Port ?? 9965, SUFFIX = VIEWS[0][0] === 1440 ? '' : `-${VIEWS[0][0]}`;
const results = [];
try {
  await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 1440, height: 900, port: PORT }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const maxSamples = await E(`(()=>{const g=document.createElement('canvas').getContext('webgl2');return g?g.getParameter(g.MAX_SAMPLES):0;})()`);
    const gpu = await E(`(()=>{const g=document.createElement('canvas').getContext('webgl2'),x=g.getExtension('WEBGL_debug_renderer_info');return x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);})()`);
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(gpu);
    console.log(`R065 chrome renderer: ${gpu} (software ${software}), MAX_SAMPLES ${maxSamples}`);
    assert.ok(maxSamples >= 2, `chrome: WebGL2 MSAA available (MAX_SAMPLES ${maxSamples})`);
    for (const [width, height, mobile] of VIEWS) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      for (const [label, map, x, z, zoom] of [['rye', '', 16, 16, 1], ['rye-close', '', 15, 14, 3], ['96', '&map=96', 18, 18, 2]]) {
        const row = { label, width };
        // on＝打開（當成有顯示卡）；auto＝預設；gpuAuto＝當成有顯示卡的預設；optin＝只帶 ?msaa=4（軟體繪圖照舊不取樣、真顯示卡會取樣）；off＝閥關著又帶 ?msaa=4（閥贏）；legacy＝拿掉 R065 那一行
        for (const [name, extra] of [['on', '&msaa=4&r065ForceMsaa=1'], ['auto', ''], ['gpuAuto', '&r065ForceMsaa=1'], ['optin', '&msaa=4'], ['off', '&noR065=1&msaa=4'], ['legacy', '&noR065=1&r065Legacy=1']]) {
          await open(`seed=1944&noR100=1${map}${extra}`); await E(`__r065Cam(${x},${z},${zoom})`); await frames();
          const state = await E('({hash:__rts.hash(),camera:__rts.cam(),tick:__rts.tick()})'), info = await E('__rts.info()'), px = await E(READ);
          row[name] = { state, msaa: info.msaa, rt: info.rt, ...px };
          if (name === 'on' || name === 'off') await shot(page, path.join(root, 'shots', `r065-${label}-${width}-${name}.png`));
        }
        results.push(row); console.log('R065', JSON.stringify(row));
        assert.equal(row.on.msaa, Math.min(4, maxSamples), 'samples: ?msaa=4 renders with 4x (or the GPU cap)');
        assert.equal(row.off.msaa, 0, 'valve: ?noR065=1 renders without samples even with ?msaa=4'); assert.equal(row.legacy.msaa, 0);
        assert.deepEqual(row.on.state, row.off.state, 'same world and camera on/off'); assert.deepEqual(row.off.state, row.legacy.state, 'same world and camera off/legacy');
        assert.deepEqual(row.on.rt, row.off.rt, 'same render resolution (pixel style unchanged)');
        assert.equal(row.off.hash, row.legacy.hash, 'valve: ?noR065=1 is pixel-identical to the pre-R065 pipeline');
        assert.deepEqual(row.auto.state, row.off.state, 'same world and camera auto/off'); assert.deepEqual(row.gpuAuto.state, row.off.state, 'same world and camera gpuAuto/off'); assert.deepEqual(row.optin.state, row.off.state, 'same world and camera optin/off');
        // R079：預設不取樣，畫面逐位等於 ?noR065=1（也就等於 R065 之前）——軟體繪圖、真顯示卡、當成有顯示卡都一樣
        assert.equal(row.auto.msaa, 0, 'default: the default page renders without samples');
        assert.equal(row.auto.hash, row.off.hash, 'default: the default frame is pixel-identical to ?noR065=1');
        assert.equal(row.gpuAuto.msaa, 0, 'default: with a GPU that could sample, the default page still renders without samples');
        assert.equal(row.gpuAuto.hash, row.off.hash, 'default: with a GPU that could sample, the default frame is still pixel-identical to ?noR065=1');
        if (software) { assert.equal(row.optin.msaa, 0, 'software: SwiftShader renders without samples even when asked'); assert.equal(row.optin.hash, row.off.hash, 'software: its frame stays pixel-identical to the pre-R065 pipeline'); }
        else { assert.equal(row.optin.msaa, row.on.msaa, 'gpu: on a real GPU ?msaa=4 renders with samples'); assert.equal(row.optin.hash, row.on.hash, 'gpu: and its frame equals the forced MSAA frame'); }
        assert.notEqual(row.on.hash, row.off.hash, 'msaa changes the frame');
        assert.ok(row.on.colors > row.off.colors, `edges: msaa adds in-between colors (${row.on.colors} vs ${row.off.colors})`);
      }
    }
    assert.deepEqual(page.errors, []);
  });
  fs.writeFileSync(path.join(root, 'shots', `r065-msaa${SUFFIX}.json`), JSON.stringify(results, null, 2));
  console.log(`R065 msaa-browser: ${results.length} views OK`);
} catch (e) { console.error('R065 MSAA FAILURE ' + e.stack); process.exitCode = 1; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
