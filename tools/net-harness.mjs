// R083 連線的瀏覽器守衛共用（tests/net-browser.mjs、tests/net-browser-negative.mjs）：建一份遊戲頁、開本機的轉發伺服器、兩個真的 Chrome，
// 給幾個場面：play（開房、加入、開戰、雙方各下一個指令、走到 TICKS 步）、together（同一局、雜湊比過、紀錄重播）、teardown（房主換了世界）、menu（開始選單的鍵與那一頁）。
// 守衛單支有 120 秒上限（tools/unit.mjs），所以正向與故意弄壞分兩支。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'vite';
import { withBrowser, sleep, ROOT } from './cdp.mjs';
import { createWorld, hashWorld, SIDE_PLAYER } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

export const TICKS = 220;   // 雜湊在第 100、200 步比
function relay(dist) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server/relay.mjs'), '--port', '0', '--host', '127.0.0.1', '--dist', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /埠 (\d+)/.exec(out); if (m) res({ p, port: +m[1] }); });
    p.on('exit', c => rej(new Error(`relay exited ${c}: ${out}`)));
    setTimeout(() => rej(new Error('relay did not start')), 10000);
  });
}

export async function netHarness({ plugins = [], ports = [8671, 8673] } = {}, fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r083-net-')), dist = path.join(temp, 'dist');
  try {
    await build({ root: ROOT, logLevel: 'error', plugins, build: { outDir: dist } });
    const srv = await relay(dist), url = `ws://127.0.0.1:${srv.port}/relay`;
    try {
      await withBrowser({ root: dist, port: ports[0], width: 900, height: 700, settle: 300 }, async A =>
        withBrowser({ root: dist, port: ports[1], width: 900, height: 700, settle: 300 }, async B => {
          const E = (pg, s) => pg.page.evaluate(s);
          const net = pg => E(pg, '__net()');
          const errors = () => [...A.page.errors, ...B.page.errors];
          // 等到 ok() 成立；頁面一出錯就馬上紅（不必等到逾時）
          const until = async (what, ok, ms = 30000) => {
            for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(150)) {
              if (errors().length) throw new assert.AssertionError({ message: `sync: no page errors on either side (${errors().join(' | ').slice(0, 300)})` });
              if (await ok()) return;
            }
            throw new assert.AssertionError({ message: `${what} (timed out after ${ms / 1000} s)` });
          };
          let room = 0;
          const play = async (extra = '', guestMenu = false) => {
            const code = `NB${++room}`;
            await A.open(`room=${code}&net=host&relay=${encodeURIComponent(url)}${extra}`);
            await until('fixture: the host opens the room', async () => (await net(A)).state === 'ready');
            await B.open(`room=${code}&net=join&relay=${encodeURIComponent(url)}${extra}`, { menu: guestMenu });
            await until('fixture: the guest joins', async () => (await net(B)).state === 'waiting' && (await net(A)).peer);
            if (guestMenu) assert(await E(B, "!!document.getElementById('net-panel') && !document.getElementById('start-menu').hidden"), 'link: a guest who joins by link waits behind its own overlay (the start menu cannot be pressed)');
            await E(A, '__rts.startBattle()');
            await until('start: the guest is in the same battle once the host starts', async () => (await net(B)).live && (await net(A)).live);
            if (guestMenu) assert(await E(B, "!document.getElementById('net-panel') && document.getElementById('start-menu').hidden"), "link: when the host starts, the guest's start menu and overlay close");
            assert.equal(await E(B, '__rts.seed()'), await E(A, '__rts.seed()'), 'start: same seed on both sides');
            assert.equal(await E(B, '__rts.map()'), await E(A, '__rts.map()'), 'start: same map on both sides');
            await until('fixture: the battle runs on both sides', async () => (await E(A, '__rts.tick()')) > 40 && (await E(B, '__rts.tick()')) > 40);
            const own = (await E(A, '__rts.units()')).filter(u => u.alive && u.side === SIDE_PLAYER);
            await E(A, `__rts.issue(${JSON.stringify({ t: 'move', side: SIDE_PLAYER, ids: [own[0].id], x: 12, z: 12 })})`);
            await E(B, `__rts.issue(${JSON.stringify({ t: 'move', side: SIDE_PLAYER, ids: [own[1].id], x: 14, z: 10 })})`);
            await until(`sync: both sides get past step ${TICKS}`, async () => (await E(A, '__rts.tick()')) > TICKS && (await E(B, '__rts.tick()')) > TICKS, 60000);
          };
          const together = async (extra = '') => {
            await play(extra);
            await E(A, '__rts.pause(true)'); await sleep(1000);   // 房主停下來；對方最多再走 delay 步就停在等房主
            const [a, b] = [await net(A), await net(B)];
            const s = { la: await E(A, '__rts.log()'), lb: await E(B, '__rts.log()'), ta: await E(A, '__rts.tick()'), tb: await E(B, '__rts.tick()'), ha: await E(A, '__rts.hash()'), hb: await E(B, '__rts.hash()'), seed: await E(A, '__rts.seed()') };
            assert(a.checks >= 2 && b.checks >= 2 && a.desync < 0 && b.desync < 0, `sync: the hash was compared at least twice with no desync (${a.checks}, ${b.checks}, ${a.desync}, ${b.desync})`);
            const moves = log => log.filter(e => e.tick > 0 && e.cmd.t === 'move').length;
            assert(moves(s.la) >= 2 && moves(s.lb) >= 2, `fixture: both orders reached both logs (${moves(s.la)}, ${moves(s.lb)})`);
            assert.equal(hashWorld(runLog(createWorld(s.seed), s.la, s.ta)), s.ha, "logs: the host's log replays in Node to the host's own world");
            assert.equal(hashWorld(runLog(createWorld(s.seed), s.lb, s.tb)), s.hb, "logs: the guest's log replays in Node to the guest's own world");
            const upTo = (log, t) => JSON.stringify(log.filter(e => e.tick < t));
            assert(s.tb >= s.ta && s.tb <= s.ta + 4 && upTo(s.la, s.ta) === upTo(s.lb, s.ta), `logs: up to where the host stopped both logs are the same (host ${s.ta}, guest ${s.tb})`);
          };
          const teardown = async (extra = '', ms = 10000) => {
            await play(extra, true);
            await E(A, '__rts.runScript(50)');   // 房主換了世界（重開、回主選單、看重播一樣）
            const tb = await E(B, '__rts.tick()');
            await until('teardown: once the host replaces its world the guest is told and plays on alone', async () => (await net(B)).peer === false && (await E(B, '__rts.tick()')) > tb + 40, ms);
            assert.equal((await net(A)).state, 'off', 'teardown: the host is back to single player');
            const ta = await E(A, '__rts.tick()');
            await until('teardown: and its new world runs', async () => (await E(A, '__rts.tick()')) > ta + 20, 10000);
          };
          const menu = async (extra = '') => {
            await A.open(extra, { menu: true });
            assert(await E(A, "!!document.getElementById('sm-net')"), 'menu: the start menu offers 連線合作');
            await E(A, "document.getElementById('sm-net').click()");
            assert(await E(A, "!!document.getElementById('net-panel') && document.getElementById('start-menu').hidden"), 'menu: 連線合作 opens its own page');
            await E(A, `(() => { document.getElementById('net-relay').value = ${JSON.stringify(url)}; document.getElementById('net-room').value = 'PANEL${++room}'; document.getElementById('net-host').click(); })()`);
            await until('menu: 開房 opens the room and goes back to the start menu to set up the battle', async () => (await net(A)).state === 'ready' && await E(A, "!document.getElementById('net-panel') && !document.getElementById('start-menu').hidden"), 10000);
            assert.match(await E(A, "document.getElementById('net-status').textContent"), new RegExp(`PANEL${room}`), 'menu: the status line shows the room code');
            await A.open(`noR083=1${extra ? '&' + extra : ''}`, { menu: true });
            assert(!(await E(A, "!!document.getElementById('sm-net')")), 'menu: ?noR083=1 has no 連線合作 button');
          };
          await fn({ A, B, errors, together, teardown, menu });
        }));
    } finally { srv.p.kill(); }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

// 共用的收尾：本機沒有 Chrome（或不能開埠）時回 77，CI 上照樣算紅
export async function runOrSkip(label, main) {
  const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
  try { await main(); }
  catch (e) {
    const msg = String(e?.stack ?? e);
    if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error(`NOT RUN ${label} Chrome: local browser unavailable; CI required`); process.exitCode = 77; }
    else { console.error(e); console.error(`${label} browser FAIL: ` + String(e?.message).split('\n')[0]); process.exitCode = 1; }
  }
}
