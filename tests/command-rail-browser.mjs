import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { ROOT, withBrowser, touchTap, shot } from '../tools/cdp.mjs';
import { fixture89 } from '../tools/r089-fixture.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';

const game = 'map=village&seed=1944&noR018=1&noR095=0&noR089=0&noR091=0&noR092=0&noR093=0&noR050=0&noR1002=0&noR902=0';
const sizes = [[320, 568], [320, 640], [360, 640], [360, 780], [390, 844], [412, 860], [480, 720], [860, 412]];
const frames = 'new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))';

// These two functions run in the game page. The fixture supplies only an adjacent idle truck.
function setUpPlatoon() {
  __rts.startBattle();
  __rts.pause(true);
  __rts.stepN(200);
  const before = new Set(__rts.units().map(u => u.id));
  __rts.issue({ t: 'produce', kind: 256, side: 0 });
  __rts.stepN(401);
  const platoon = __rts.units().filter(u => !before.has(u.id) && u.kind === 3 && u.side === 0);
  if (platoon.length !== 3) throw Error('Production must deliver three sections');
  const x = Math.floor(platoon[0].x / 256), z = Math.floor(platoon[0].z / 256);
  const truck = __r089.place(0, 44, x, z);
  __r089.cam(x, z, 1.3);
  __r089.clean();
  __rts.select([platoon[0].id]);
  return { sections: platoon.map(u => u.id).sort((a, b) => a - b), truck };
}

function commandGeometry() {
  const obstacles = document.querySelectorAll('button, select, #minimap, #prodbar, #hud .top, #hud .bottom, #tutorial');
  const controls = {};
  for (const [name, id] of [['platoon', 'b-platoon'], ['ride', 'b-ride']]) {
    const button = document.getElementById(id);
    const rect = button.getBoundingClientRect();
    const samples = [[.5, .5], [.15, .15], [.85, .15], [.15, .85], [.85, .85]];
    const hits = samples.every(([dx, dy]) => button.contains(document.elementFromPoint(rect.x + rect.width * dx, rect.y + rect.height * dy)));
    const overlaps = [...obstacles].filter(other => {
      if (other === button) return false;
      const box = other.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
    }).map(other => other.id || other.className);
    controls[name] = { rect: [rect.x, rect.y, rect.width, rect.height], hits, overlaps };
  }
  return controls;
}

function compactControls() {
  const all = [...document.querySelectorAll('#prodbar button, #r901-chrome button, #b-discipline, #b-air')];
  const visible = all.filter(button => button.getBoundingClientRect().width > 0);
  return visible.filter(button => {
    const r = button.getBoundingClientRect();
    const hits = button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    return !hits || r.width < 44 || r.height < 44 || button.scrollWidth > button.clientWidth + 1 || visible.some(other => {
      if (other === button) return false;
      const o = other.getBoundingClientRect();
      return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
    });
  }).map(button => button.id);
}

await runOrSkip('mobile command rail', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r148-rail-'));
  try {
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 12948 }, async ({ open, page }) => {
      const read = fn => page.evaluate('(' + fn.toString() + ')()');
      const tap = async id => {
        const [x, y] = await page.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
        await touchTap(page, x, y);
        await page.evaluate(frames);
      };
      const resize = async (width, height) => {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
        await page.evaluate(frames);
      };
      await open(game);
      assert.match(await page.evaluate('document.title'), /二戰 RTS/);
      assert.equal(await page.evaluate('!!document.querySelector("vite-error-overlay")'), false);
      const { sections, truck } = await read(setUpPlatoon);
      const selectFirst = async () => {
        await page.evaluate(`__rts.select([${sections[0]}])`);
        await page.evaluate(frames);
      };
      const logLength = await page.evaluate('__rts.log().length');
      for (const [width, height] of sizes) {
        await resize(width, height);
        await selectFirst();
        const { platoon, ride } = await read(commandGeometry);
        const buttons = { platoon: platoon.rect, ride: ride.rect };
        if (width < height) {
          const [x, y, w, h] = platoon.rect, [rx, ry, rw, rh] = ride.rect;
          assert(x === 8 && rx === x, `Both actions align with the safe left edge at ${width}×${height}: ${JSON.stringify(buttons)}`);
          assert(w >= 44 && h >= 44 && rw >= 44 && rh >= 44 && ry - y - h >= 4 && ry + rh <= height, 'Two separate full touch targets');
          for (const [name, control] of Object.entries({ platoon, ride })) {
            assert(control.hits, `Centre and corners hit ${name} at ${width}×${height}`);
            assert.deepEqual(control.overlaps, [], `${name} overlaps other controls at ${width}×${height}`);
          }
          if (height <= 700) {
            assert.deepEqual(await read(compactControls), [], 'Short screens leave every production and command button readable and reachable');
          }
          if (process.env.RTS_UI_SHOTS) {
            const file = path.join(process.env.RTS_UI_SHOTS, `rail-${width}x${height}`);
            await shot(page, file + '.png');
            fs.writeFileSync(file + '.json', JSON.stringify({ buttons }));
          }
        } else {
          assert(platoon.rect[1] === ride.rect[1] && ride.rect[0] > platoon.rect[0], 'Landscape keeps the horizontal commands');
        }
        await tap('b-platoon');
        assert.deepEqual(await page.evaluate('__rts.selected().sort((a, b) => a-b)'), sections, '全排 selects the three sections');
        await tap('b-ride');
        assert.deepEqual(await page.evaluate('__rts.selected().sort((a, b) => a-b)'), [...sections, truck], '搭車 adds the nearby vehicle');
        assert(await page.evaluate('document.getElementById("b-ride").hidden'), 'Adding the truck hides the ride action');
        assert.equal(await page.evaluate('__rts.log().length'), logLength, 'Selecting sections or a vehicle issues no world command');
      }
      await resize(360, 780);
      await selectFirst();
      for (const id of ['r901-top', 'r901-bar']) {
        await tap(id);
        assert.equal(await page.evaluate(`document.getElementById('${id}').getAttribute('aria-expanded')`), 'false');
        const { platoon, ride } = await read(commandGeometry);
        assert(platoon.hits && ride.hits, 'Both actions remain accessible when a toolbar is collapsed');
        await tap(id);
        assert.equal(await page.evaluate(`document.getElementById('${id}').getAttribute('aria-expanded')`), 'true');
      }
      await page.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 24, top: 18 } });
      await page.evaluate(frames);
      for (const control of Object.values(await read(commandGeometry))) {
        assert.equal(control.rect[0], 24, 'The action follows the safe area on a screen with an inset');
        assert(control.hits && control.overlaps.length === 0, 'The inset touch target stays clear');
      }
      await page.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
      await page.evaluate(frames);
      await tap('b-help');
      await tap('tutorial-open');
      assert(await page.evaluate('!document.getElementById("tutorial").hidden'), 'The tutorial is visible in battle');
      const clearOfTutorial = await page.evaluate(`(() => {
        const panel = document.getElementById('tutorial').getBoundingClientRect();
        return ['b-platoon', 'b-ride', 'r901-top', 'r901-bar'].every(id => {
          const r = document.getElementById(id).getBoundingClientRect();
          return r.width >= 44 && panel.left - r.right >= 16;
        });
      })()`);
      assert(clearOfTutorial, 'The tutorial leaves room to tap both left columns');
      await tap('tutorial-skip');
      await page.evaluate('__rts.select([])');
      await page.evaluate(frames);
      assert(await page.evaluate('["b-platoon", "b-ride"].every(id => document.getElementById(id).hidden)'), 'Empty selection hides both actions');
      assert.equal(await page.evaluate('document.getElementById("r901-top").getBoundingClientRect().left'), 8, 'Empty selection returns the inner column to the map for touch gestures');
      assert.deepEqual(page.errors, []);
    });
    console.log('OK R148 seven portraits, one landscape, real selection, reachable panel controls and tutorial');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
