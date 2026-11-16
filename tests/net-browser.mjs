// R083 連線合作：兩個真的 Chrome（各開一頁）＋本機的轉發伺服器（server/relay.mjs）。
// 房主開房、對方加入；房主開戰，對方進入同一局；雙方各下一個移動指令；兩邊都走過 300 步以上、雜湊比過、沒有不同步；
// 兩頁的指令紀錄在 Node 重播得到各自頁面上的雜湊，開戰到房主停下來那一步之前的紀錄兩邊一樣；開始選單有「連線合作」、?noR083=1 沒有；故意弄壞。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import { withBrowser, sleep, ROOT } from '../tools/cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r083-browser-'));
// 故意弄壞（只編進 broken 那一份，網址帶 __r083mutant 才生效）
const mutations = {
  nolog: ['src/main.ts', '  if (!netLive()) log.push(', "  if (!netLive() || location.search.includes('__r083mutant=nolog')) log.push(", 1],
  nogate: ['src/main.ts', '&& netReady(w.tick)) {', "&& (netReady(w.tick) || location.search.includes('__r083mutant=nogate'))) {", 1],
  nomenu: ['src/ui/startMenu.ts', "if (v.kind === 'start' && v.net) extra.push(", "if (v.kind === 'start' && v.net && !location.search.includes('__r083mutant=nomenu')) extra.push(", 1],
  menustays: ['src/net/client.ts', "    if (m.t === 'start') { closePanel(); (document.querySelector(", "    if (m.t === 'start' && !location.search.includes('__r083mutant=menustays')) { closePanel(); (document.querySelector(", 1],
  nodrop: ['src/net/client.ts', 'function dropIfStale(): void { if (session?.stale()) {', "function dropIfStale(): void { if (session?.stale() && !location.search.includes('__r083mutant=nodrop')) {", 1],
};
const applied = new Set();
const plugin = { name: 'r083-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };
function relay(dist) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server/relay.mjs'), '--port', '0', '--host', '127.0.0.1', '--dist', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /埠 (\d+)/.exec(out); if (m) res({ p, port: +m[1] }); });
    p.on('exit', c => rej(new Error(`relay exited ${c}: ${out}`)));
    setTimeout(() => rej(new Error('relay did not start')), 10000);
  });
}

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const srv = await relay(baseline), url = `ws://127.0.0.1:${srv.port}/relay`;
  const overlay = {};
  try {
    await withBrowser({ root: baseline, overlay, port: 8671, width: 900, height: 700, settle: 300 }, async A =>
      withBrowser({ root: baseline, overlay, port: 8673, width: 900, height: 700, settle: 300 }, async B => {
        const E = (pg, s) => pg.page.evaluate(s);
        const net = pg => E(pg, '__net()');
        const until = async (what, ok, ms = 30000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(150)) if (await ok()) return; throw new assert.AssertionError({ message: `${what} (timed out after ${ms / 1000} s)` }); };
        let room = 0;
        // 一局：房主開房、對方加入、房主開戰、雙方各下一個指令、走到 320 步以上
        const play = async (extra = '', guestMenu = false) => {
          const code = `NB${++room}`;
          await A.open(`room=${code}&net=host&relay=${encodeURIComponent(url)}${extra}`);
          await until('fixture: the host opens the room', async () => (await net(A)).state === 'ready');
          await B.open(`room=${code}&net=join&relay=${encodeURIComponent(url)}${extra}`, { menu: guestMenu });
          await until('fixture: the guest joins', async () => (await net(B)).state === 'waiting' && (await net(A)).peer);
          if (guestMenu) assert(await E(B, "!!document.getElementById('net-panel') && !document.getElementById('start-menu').hidden"), 'link: a guest who joins by link waits behind its own overlay (the start menu cannot be pressed)');
          await E(A, '__rts.startBattle()');
          await until('start: the guest is in the same battle once the host starts', async () => (await net(B)).live && (await net(A)).live);
          if (guestMenu) assert(await E(B, "!document.getElementById('net-panel') && document.getElementById('start-menu').hidden"), 'link: when the host starts, the guest\'s start menu and overlay close');
          assert.equal(await E(B, '__rts.seed()'), await E(A, '__rts.seed()'), 'start: same seed on both sides');
          assert.equal(await E(B, '__rts.map()'), await E(A, '__rts.map()'), 'start: same map on both sides');
          await until('fixture: the battle runs on both sides', async () => (await E(A, '__rts.tick()')) > 40 && (await E(B, '__rts.tick()')) > 40);
          const own = (await E(A, '__rts.units()')).filter(u => u.alive && u.side === SIDE_PLAYER);
          await E(A, `__rts.issue(${JSON.stringify({ t: 'move', side: SIDE_PLAYER, ids: [own[0].id], x: 12, z: 12 })})`);
          await E(B, `__rts.issue(${JSON.stringify({ t: 'move', side: SIDE_PLAYER, ids: [own[1].id], x: 14, z: 10 })})`);
          await until('sync: both sides get past step 320', async () => (await E(A, '__rts.tick()')) > 320 && (await E(B, '__rts.tick()')) > 320, 60000);
          return code;
        };
        const settle = async () => {
          // 房主停下來；對方最多再走 delay 步就停在等房主
          await E(A, '__rts.pause(true)'); await sleep(1200);
          const [a, b] = [await net(A), await net(B)];
          return { a, b, la: await E(A, '__rts.log()'), lb: await E(B, '__rts.log()'), ta: await E(A, '__rts.tick()'), tb: await E(B, '__rts.tick()'), ha: await E(A, '__rts.hash()'), hb: await E(B, '__rts.hash()'), seed: await E(A, '__rts.seed()') };
        };
        // ---- 共用的檢查（正向與故意弄壞都跑同一段）----
        const together = async (extra = '') => {
          await play(extra);
          assert.deepEqual([A.page.errors.length, B.page.errors.length], [0, 0], `sync: no page errors on either side (${[...A.page.errors, ...B.page.errors].join(' | ').slice(0, 300)})`);
          const s = await settle();
          assert(s.a.checks >= 2 && s.b.checks >= 2 && s.a.desync < 0 && s.b.desync < 0, `sync: the hash was compared at least twice with no desync (${s.a.checks}, ${s.b.checks}, ${s.a.desync}, ${s.b.desync})`);
          const moves = log => log.filter(e => e.tick > 0 && e.cmd.t === 'move').length;
          assert(moves(s.la) >= 2 && moves(s.lb) >= 2, `fixture: both orders reached both logs (${moves(s.la)}, ${moves(s.lb)})`);
          assert.equal(hashWorld(runLog(createWorld(s.seed), s.la, s.ta)), s.ha, 'logs: the host\'s log replays in Node to the host\'s own world');
          assert.equal(hashWorld(runLog(createWorld(s.seed), s.lb, s.tb)), s.hb, 'logs: the guest\'s log replays in Node to the guest\'s own world');
          const upTo = (log, t) => JSON.stringify(log.filter(e => e.tick < t));
          assert(s.tb >= s.ta && s.tb <= s.ta + 4 && upTo(s.la, s.ta) === upTo(s.lb, s.ta), `logs: up to where the host stopped both logs are the same (host ${s.ta}, guest ${s.tb})`);
        };
        const teardown = async (extra = '') => {
          await play(extra, true);
          await E(A, '__rts.runScript(50)');   // 房主換了世界（重開、回主選單、看重播一樣）
          const tb = await E(B, '__rts.tick()');
          await until('teardown: once the host replaces its world the guest is told and plays on alone', async () => (await net(B)).peer === false && (await E(B, '__rts.tick()')) > tb + 40, 20000);
          assert.equal((await net(A)).state, 'off', 'teardown: the host is back to single player');
          const ta = await E(A, '__rts.tick()');
          await until('teardown: and its new world runs', async () => (await E(A, '__rts.tick()')) > ta + 20, 10000);
        };
        const menu = async (extra = '') => {
          await A.open(extra, { menu: true });
          assert(await E(A, "!!document.getElementById('sm-net')"), 'menu: the start menu offers 連線合作');
          await E(A, "document.getElementById('sm-net').click()");
          assert(await E(A, "!!document.getElementById('net-panel') && document.getElementById('start-menu').hidden"), 'menu: 連線合作 opens its own page');
          await E(A, `(() => { document.getElementById('net-relay').value = ${JSON.stringify(url)}; document.getElementById('net-room').value = 'PANEL${room}'; document.getElementById('net-host').click(); })()`);
          await until('menu: 開房 opens the room and goes back to the start menu to set up the battle', async () => (await net(A)).state === 'ready' && await E(A, "!document.getElementById('net-panel') && !document.getElementById('start-menu').hidden"), 10000);
          assert.match(await E(A, "document.getElementById('net-status').textContent"), new RegExp(`PANEL${room}`), 'menu: the status line shows the room code');
          await A.open(`noR083=1${extra ? '&' + extra : ''}`, { menu: true });
          assert(!(await E(A, "!!document.getElementById('sm-net')")), 'menu: ?noR083=1 has no 連線合作 button');
        };
        // ---- 正向 ----
        await together();
        await teardown();
        await menu();
        console.log('OK R083: host and guest in one battle, both orders in both logs, hashes compared, logs replay; joining by link; the host leaving by replacing its world; menu button and valve');
        // ---- 故意弄壞 ----
        overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
        const negatives = [
          ['nolog', () => together('&__r083mutant=nolog'), 'logs: the '],   // 記兩次的指令讓其中一邊的紀錄重播不出自己的世界（哪一邊先紅看那個指令有沒有影響結局）
          ['nogate', () => together('&__r083mutant=nogate'), 'sync: no page errors on either side'],
          ['nomenu', () => menu('__r083mutant=nomenu'), 'menu: the start menu offers'],
          ['menustays', () => teardown('&__r083mutant=menustays'), "link: when the host starts, the guest's start menu"],
          ['nodrop', () => teardown('&__r083mutant=nodrop'), 'teardown: once the host replaces its world'],
        ];
        for (const [name, run, prefix] of negatives) {
          A.page.errors.length = 0; B.page.errors.length = 0;
          let failure;
          try { await run(); } catch (e) { failure = e; }
          assert(failure instanceof assert.AssertionError && failure.message.startsWith(prefix), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
          console.log(`RED R083 ${name}: ${failure.message.split('\n')[0]}`);
        }
        delete overlay['index.html'];
      }));
  } finally { srv.p.kill(); }
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R083 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R083 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
