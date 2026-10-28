// Isolated owner-authorized QA candidate (no formal R number): test the real phone layout and the R901 rollback in Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, shot } from './qa-safe-cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'r901-scroll-'));
try {
  await build({ root, logLevel: 'error', build: { outDir: out } });
  await withBrowser({ root: out, overlay: {}, port: 8431, width: 412, height: 915, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 100 }, async ({ open, page }) => {
    const E = expr => page.evaluate(expr);
    const frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    for (const [width, height] of [[360,640],[390,844],[412,860],[360,915],[390,915],[412,915]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await open('noR018=1&noR006=1&noR016=1');
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await E('__rts.pause(true);__rts.runScript(0);__rts.issue({t:"eco",inf:1,guns:1,tanks:1});__rts.stepN(1);__rts.pause(true)');
      await frames();
      await shot(page, path.join(root, 'shots', `r901-scroll-${width}x${height}-production.png`));
      assert.equal(await E('document.body.classList.contains("r901")'), true);
      const hint = await E('(()=>{const h=document.querySelector("#hint"), old=h.textContent;h.textContent="測試";const short=h.getBoundingClientRect().height;h.textContent="長提示測試文字".repeat(30);const s=getComputedStyle(h), result={whiteSpace:s.whiteSpace, overflow:s.overflow, wraps:h.getBoundingClientRect().height>short, fits:h.scrollWidth<=h.clientWidth && h.scrollHeight<=h.clientHeight};window.__qaOriginalHint=old;return result})()');
      assert.equal(hint.whiteSpace, 'normal', `${width}: long hint wraps`);
      assert(hint.wraps && hint.fits && hint.overflow !== 'hidden', `${width}: long hint is not truncated`);
      await frames();
      const chromeClear = await E(`(()=>{const p=document.querySelector('#prodbar').getBoundingClientRect(),h=document.querySelector('#hint').getBoundingClientRect();return [...document.querySelectorAll('#r901-chrome button')].every(b=>{const r=b.getBoundingClientRect();return [p,h].every(o=>r.right<=o.left||r.left>=o.right||r.bottom<=o.top||r.top>=o.bottom)&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})})()`);
      assert(chromeClear, `${width}x${height}: long hint/production does not overlap chrome keys`);
      await shot(page, path.join(root, 'shots', `r901-scroll-${width}x${height}-long-hint.png`));
      await E('document.querySelector("#hint").textContent=window.__qaOriginalHint;delete window.__qaOriginalHint');
      const before = await E('document.querySelector(".production-buttons").scrollLeft');
      const row = await E('(()=>{const r=document.querySelector(".production-buttons").getBoundingClientRect();return {x:r.right-20,y:r.top+r.height/2}})()');
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x: row.x, y: row.y, id: 1}] });
      for (let dx = 20; dx <= 180; dx += 20) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x: row.x-dx, y: row.y, id: 1}] }); await sleep(20); }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(250);
      assert((await E('document.querySelector(".production-buttons").scrollLeft')) > before, `${width}: touch swipe scrolls production`);
      const count = await E('document.querySelectorAll(".production-buttons button").length');
      for (let i=0; i<count; i++) {
        const hit = await E(`(()=>{const b=document.querySelectorAll('.production-buttons button')[${i}];b.scrollIntoView({block:'nearest',inline:'center'});const r=b.getBoundingClientRect();return {w:r.width,h:r.height,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
        assert(hit.w>=44 && hit.h>=44 && hit.hit, `${width}: production button ${i} has a reachable 44px target`);
      }
      await shot(page, path.join(root, 'shots', `r901-scroll-${width}x${height}-scrolled.png`));
      await open('noR018=1&noR006=1&noR016=1&noR901=1');
      await frames();
      const rollback = await E('({active:document.body.classList.contains("r901"),hint:getComputedStyle(document.querySelector("#hint")).whiteSpace,buttons:getComputedStyle(document.querySelector(".production-buttons")).display})');
      await shot(page, path.join(root, 'shots', `r901-scroll-${width}x${height}-rollback.png`));
      assert.deepEqual(rollback, { active:false, hint:'normal', buttons:'contents' }, `${width}: noR901 restores the prior layout`);
      console.log(`PASS r901-scroll ${width}x${height}: wrapping, touch scroll, reachable targets, rollback`);
    }
    assert.deepEqual(page.errors, [], 'r901-scroll: no browser runtime errors');
  });
  console.log('PASS r901-scroll-browser: all six viewport cases completed');
} finally { fs.rmSync(out, { recursive: true, force: true }); }
