// R098 地面貼圖只傳改過的格列（真的 Chrome；CI 是 SwiftShader）：把顯示卡上的地面貼圖讀回來，跟同一份 groundPx 另外整張上傳的一張
// 用同一條路讀回比，要逐位一樣、gl.getError() 為 0。萊伊、河鎮（96）、鋪滿的 128；布陣（有地盤的色調）、開戰（setWorld(w, -1) 之後馬上走一步、
// 中間不畫）、打一段（履帶、高爆、換段）、一發高爆／四分之一張那兩種上傳之後都比。?noR098=1 也比一次（萊伊）。頁面沒有錯誤。
// 夾具在 tools/r098-fixture.mjs（只在這份測試的建置裡）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture98 } from '../tools/r098-fixture.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r098-browser-'));
// 負面守衛用（tests/ground98-browser-negative.mjs）：GT98_MUTANT=staging 在建置時讓暫存先被 renderer 認得（initTexture），GT98_CASES 只跑那幾段
const STAGING = 'renderer.copyTextureToTexture(this.stage, tex, this.box, this.at);';
const mutant = process.env.GT98_MUTANT === 'staging' ? [{ name: 'r098-mutant', enforce: 'pre', transform(code, id) {
  if (!id.split('?')[0].replaceAll('\\', '/').endsWith('src/render/groundUpload.ts')) return;
  if (code.split(STAGING).length !== 2) throw new Error('mutant anchor: staging');
  return code.replace(STAGING, 'renderer.initTexture(this.stage); ' + STAGING);
} }] : [], only = process.env.GT98_CASES?.split(',');

await runOrSkip('ground98', async () => {
  try {
    await build({ root, logLevel: 'error', plugins: [fixture98(root), ...mutant], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9984 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      const check = async why => {
        await frames(); const c = await E('__r098.check()');
        assert.equal(c.err, 0, `gl: no GL error before ${why} (${c.err})`);
        assert.equal(c.diff, 0, `gpu: after ${why} the ground texture on the GPU equals a full upload of groundPx (${c.diff} bytes differ of ${c.n * c.n * 4})`);
        assert.equal(c.err2, 0, `gl: no GL error after reading back (${why})`);
        return c;
      };
      const cases = [['rye', '', 0, 450], ['town', 'map=96&', 0, 300], ['town128', 'map=96&', 0, 240], ['rye-off', '', 1, 150]];
      for (const [name, q, off, ticks] of cases.filter(c => !only || only.includes(c[0]))) {
        await open(`${q}seed=1944&noR100=1&noR098=${off}`); await E('__rts.pause(true); 0');
        await check(`${name} deploy preview`);
        await E('__rts.startBattle(); __rts.pause(true); 0');
        await check(`${name} battle start`);
        if (name === 'town128') { const t = await E('__r098.town128()'); assert.equal(t.n, 128, 'fixture: the tiled town is 128 cells'); await check(`${name} switch to 128`); }
        for (let k = 0; k < ticks / 30; k++) { await E('__rts.stepN(30)'); await frames(); }
        const fought = await check(`${name} ${ticks} ticks of fighting`);
        if (!off) assert(fought.uploads > 0, `coverage: ${name} uploaded row rectangles while fighting, before the scripted uploads (${fought.uploads})`);   // 審查之後：不靠後面 bench 的那幾次
        await E("for (const k of ['he', 'he', 'quarter', 'tracks', 'tracks']) __r098.once(k); 0");
        const c = await check(`${name} single-shell, quarter-map and track uploads`);
        if (off) assert.equal(c.uploads, 0, `valve: with ?noR098=1 no row rectangles are uploaded (${c.uploads})`);
        else assert(c.uploads > fought.uploads || c.uploads > 0, `coverage: ${name} uploaded row rectangles (${c.uploads})`);
        console.log(`ground98 ${name}: n ${c.n / 8}, ${c.uploads} row rectangles, GPU texture equals a full upload`);
        assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      }
    });
    console.log('ground98 browser: all OK');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
