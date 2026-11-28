import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { ROOT, withBrowser, touchTap, shot } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';

// Read the actual unit paths in the test bundle. No fixture enters the shipped game.
const paths = { name: 'r147-inspect-paths', enforce: 'pre', transform(code, id) {
  if (path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `\nwindow.__endCells = () => w.units.slice(0, 4).map(u => u.path.at(-1) ?? (Math.floor(u.z/SUB)*w.n + Math.floor(u.x/SUB)));`;
} };
const frames = 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))';
async function click(page, x, y, mobile, button = 'left') {
  if (mobile) return touchTap(page, x, y);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
  }
}
async function scenario(open, page, mobile, disabled) {
  const E = expr => page.evaluate(expr);
  await open('map=village&seed=1944&noR018=1&noR019=1&noR902=1' + (disabled ? '&noR147=1' : ''));
  await E('__rts.startBattle(); __rts.pause(true); __rts.focus(22,22,1.5)');
  await E(frames);
  if (mobile && await E('document.body.classList.contains("r901-top-off")')) {
    const pos = await E('(()=>{const r=document.querySelector("#r901-top").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()');
    await click(page, ...pos, true);
  }
  const all = await E('(()=>{const r=document.querySelector("#b-all").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()');
  await click(page, ...all, mobile);
  assert((await E('__rts.selected()')).includes(4), 'native Select All includes artillery');
  const dest = await E(`(() => {
    for (let x=19; x<=23; x++) for (let z=19; z<=23; z++) {
      const p=__rts.screenOfCell(x,z);
      if (Math.hypot(p[0]-innerWidth/2,p[1]-innerHeight/2)>innerWidth*.26) continue;
      if (document.elementFromPoint(...p)?.tagName!=='CANVAS') continue;
      if (__rts.blds().some(b=>b.hp>0 && x>=b.x && z>=b.z && x<b.x+b.w && z<b.z+b.d)) continue;
      if (__rts.units().some(u=>Math.hypot(...__rts.screenOf(u.id).map((n,i)=>n-p[i]))<40)) continue;
      return p;
    }
  })()`);
  assert(dest, 'an open, visible ground tile accepts the pointer');
  await click(page, ...dest, mobile, 'right');
  assert.equal((await E('__rts.log().at(-1).cmd.t')), 'move');
  await E('__rts.stepN(1)');
  await E(frames);
  const count = await E('document.querySelectorAll("#move-destinations span").length');
  const expected = await E('__endCells()');
  const executed = { hash: await E('__rts.hash()'), log: await E('__rts.log()') };
  const markers = 'document.querySelectorAll("#move-destinations span")';
  async function checkPins() {
    const { rendered, projected } = await E(`(() => {
      const rendered = [...${markers}].map(e => { const r=e.getBoundingClientRect(); return [e.textContent,r.x,r.y,document.elementFromPoint(r.x,r.y)?.tagName]; });
      const projected = __endCells().map(c=>__rts.screenOfCell(c%32, Math.floor(c/32)));
      return { rendered, projected };
    })()`);
    const grouped = Map.groupBy(expected, cell => cell);
    for (const [cell, units] of grouped) {
      const name = units.length > 1 ? '×' + units.length : '#' + (expected.indexOf(cell) + 1);
      const p = projected[expected.indexOf(cell)];
      assert(rendered.some(([s,x,y,hit]) => s===name && Math.abs(x-p[0])<=1 && Math.abs(y-p[1])<=1 && hit==='CANVAS'),
        `ground-aligned, pass-through marker ${name} at ${p} in ${JSON.stringify(rendered)}`);
    }
  }
  async function capture() {
    if (!process.env.RTS_UI_SHOTS) return;
    const name = 'move-' + (mobile ? 'phone' : 'desktop') + (disabled ? '-off' : '');
    const file = path.join(process.env.RTS_UI_SHOTS, name);
    const cells = await E('__endCells().map(c=>__rts.screenOfCell(c%32,Math.floor(c/32)))');
    await shot(page, file + '.png');
    fs.writeFileSync(file + '.json', JSON.stringify({ cells, hash: executed.hash }));
  }
  if (disabled) {
    assert.equal(count, 0);
    await E('__rts.focus(22.6,22,1.5)'); await E(frames); await capture();
  }
  else {
    assert.equal(count, new Set(expected).size, 'all issued vehicle stops are visible');
    await checkPins();
    await E('__rts.focus(22.6,22,1.5)'); await E(frames); await checkPins();
    await capture();
    if (mobile) {
      await E('__rts.issue({t:"stop",side:0,ids:[1,2,3,4]}); __rts.stepN(1)');
      assert.equal(await E(`${markers}.length`), 0);
    } else {
      await E('new Promise(r => setTimeout(r, 2050))'); await E(frames);
      assert.equal(await E(`${markers}.length`), 0, 'also expires while paused');
    }
  }
  assert.deepEqual(page.errors, []);
  return executed;
}
await runOrSkip('move destinations', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r147-ui-'));
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [paths], build: { outDir: tmp } });
    for (const mobile of [false, true]) {
      await withBrowser({ root: tmp, mobile, width: mobile ? 412 : 1280, height: mobile ? 860 : 800, port: 12947 }, async ({ open, page }) => {
        const on = await scenario(open, page, mobile, false);
        assert.deepEqual(await scenario(open, page, mobile, true), on, 'same input log and world with the valve off');
      });
    }
    console.log('OK R147 native group movement, projected endpoints, camera, expiry, replacement and valve');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
