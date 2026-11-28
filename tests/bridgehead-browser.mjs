import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';
import { UK_OBSERVER } from '../src/sim/world.ts';

// Advance only when the real WebSocket lockstep has both players' inputs. This clock is test-only.
const clock = { name: 'bridgehead-test-clock', transform(code, id) {
  if (!id.endsWith('/src/main.ts')) return;
  const anchor = 'const rts = {';
  assert(code.includes(anchor));
  return code.replace(anchor, anchor + '\n  advanceReady: () => { for (let i = 0; i < 12 && w.tick < window.bridgeLimit && netReady(w.tick); i++) tick(); },');
} };
const label = "document.querySelector('#bridgehead-status:not([hidden]) strong')?.textContent";
const opts = '&map=hythe&noR091=0&noR1002=0&noR1010=0&noR050=0&noR087=0';
// Bound each move by its game ticks. Both clients watch their own HUD and fail if lockstep stalls.
function waitForLabel(expected, budget) {
  const point = document.getElementById('bridgehead-status');
  let lastTick = __rts.tick(), lastProgress = performance.now();
  const limit = window.bridgeLimit = lastTick + budget;
  return new Promise((resolve, reject) => {
    const check = () => {
      const { tick, peer, desync } = __net(), actual = point.querySelector('strong')?.textContent;
      if (tick !== lastTick) { lastTick = tick; lastProgress = performance.now(); }
      if (!peer || desync >= 0 || tick > limit || performance.now() - lastProgress > 30000) {
        clearInterval(timer);
        reject(new Error(`Expected ${expected}, saw ${actual} at tick ${tick} (limit ${limit}, peer ${peer}, desync ${desync})`));
      } else if (!point.hidden && actual === expected) {
        clearInterval(timer); resolve();
      }
    };
    const timer = setInterval(check, 50);
    check();
  });
}
async function shot(pg, name) {
  if (!process.env.R149_SHOTS) return;
  const png = await pg.page.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(process.env.R149_SHOTS, { recursive: true });
  fs.writeFileSync(path.join(process.env.R149_SHOTS, name + '.png'), Buffer.from(png.data, 'base64'));
}
await runOrSkip('bridgehead', () => netHarness({ plugins: [clock], ports: [8841, 8843] }, async ({ versus, A }) => {
  await versus(opts, '&noR149=1', 240, async ({ A, B, E, until }) => {
    await B.page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const peers = [A, B];
    async function labels(host, guest, budget = 100) {
      try {
        await Promise.all([host, guest].map((expected, i) => E(peers[i], `(${waitForLabel})(${JSON.stringify(expected)}, ${budget})`)));
      } catch (error) {
        for (const pg of peers) console.error(await E(pg, `({ state: __net(), hud: ${label}, scouts: __rts.units().filter(u => u.kind === ${UK_OBSERVER}).map(u => [u.id, u.alive, u.x >> 8, u.z >> 8]), last: __rts.log().slice(-3) })`));
        throw error;
      }
    }
    const units = await E(A, '__rts.units()');
    // The shared versus harness just verified a cross-map tank order for each side.
    // Halt those tanks at spawn so the scouts can demonstrate simultaneous occupation.
    for (const side of [0, 1]) {
      const tank = units.find(u => u.side === side);
      await E(peers[side], '__rts.issue(' + JSON.stringify({ t: 'stop', ids: [tank.id], side }) + ')');
    }
    const move = (side, x, z) => {
      const id = units.find(u => u.side === side && u.kind === UK_OBSERVER).id;
      return E(peers[side], '__rts.issue(' + JSON.stringify({ t: 'move', ids: [id], side, x, z }) + ')');
    };
    await labels('中立', '中立');
    for (const pg of peers) {
      const bounds = await E(pg, `(() => { const el = document.getElementById('bridgehead-status'), r = el.getBoundingClientRect(), m = document.getElementById('minimap').getBoundingClientRect();
        return [r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, r.height >= 44, r.top >= m.bottom,
          el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))]; })()`);
      assert(bounds.every(Boolean), 'bridge label is readable and tappable beneath the map: ' + bounds);
      await E(pg, "document.getElementById('bridgehead-status').click()");
      await until('bridge label focuses the side bridge', async () => {
        const cam = await E(pg, '__rts.cam()');
        return Math.abs(cam.x - 42.5) < 1 && Math.abs(cam.z - 86.5) < 1;
      });
    }
    await Promise.all(peers.map(pg => E(pg, 'window.bridgeTimer = setInterval(() => __rts.advanceReady(), 4)')));
    try {
      await Promise.all([move(0, 42, 86), move(1, 35, 80)]);
      await labels('我方控制', '敵方控制', 2400);
      await shot(A, 'host-controls');
      await move(1, 43, 86); await labels('爭奪中', '爭奪中', 650);
      await shot(B, 'mobile-contested');
      await move(0, 53, 86); await labels('敵方控制', '我方控制', 500);
      await shot(B, 'mobile-retaken');
      await move(0, 42, 86); await labels('爭奪中', '爭奪中', 500);
      await move(1, 31, 86); await labels('我方控制', '敵方控制', 500);
      console.log('West Hythe: host captured, guest contested and captured, host contested and retook, tick ' + await E(A, '__rts.tick()'));
    } finally { await Promise.all(peers.map(pg => E(pg, 'clearInterval(window.bridgeTimer)'))); }
  });
  // The opponent stayed on its main route in the solo survey. A normal new solo game therefore has no point.
  await A.open('map=hythe');
  await A.page.evaluate('__rts.startBattle()');
  assert.equal(await A.page.evaluate("__rts.log().some(e => e.cmd.t === 'bridgehead') || !!document.querySelector('#bridgehead-status:not([hidden])')"), false);
}));
