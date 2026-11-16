// R083 連線合作：不開瀏覽器的部分。鎖步的規矩（預先的空包、等、合併的順序、不同步、離線）、
// 兩個模擬的玩家（真的 Session＋假的網路：延遲 0–300 毫秒、亂序到）一起打 2,000 步——每一步兩邊的雜湊一樣、紀錄一樣、重播一樣；
// 轉發伺服器（真的開一個 server/relay.mjs 行程）。
// 用法：node tests/net-lockstep.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/net-lockstep.mjs <群組名>   只跑那一群（隔離副本裡用）
// 兩個真的 Chrome 的部分在 tests/net-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY, UK_TANK } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { Lockstep, NET_DELAY, NET_HASH_EVERY } from '../src/net/lockstep.ts';
import { Session } from '../src/net/session.ts';

const ME = SIDE_PLAYER, FOE = SIDE_ENEMY;
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1, mg: 2 };
const SETUP = [{ t: 'map', id: 1, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, ECO, { t: 'ai', side: FOE, level: 3, v: 3 }];
const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mv = (id, x, z) => ({ t: 'move', side: ME, ids: [id], x, z });

// 一個模擬的玩家：真的 Session，假的「遊戲」（世界、紀錄、pending，tick 跟 main.ts 一樣先問 feed）
function player(role, send) {
  const c = { role, w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [], given: 0 };
  c.host = {
    world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase,
    begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; },
    tick: () => {
      const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = [];
      step(c.w, now); c.hashes[c.w.tick] = hashWorld(c.w);
    },
    remake() {}, focus() {},
  };
  c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); else c.given++; c.pending.push(cmd); };
  c.session = new Session(role, c.host, m => send(c, m));
  return c;
}
// 兩個玩家＋假的轉發伺服器：每一則訊息延遲 lo–hi 毫秒（亂序到），一步 50 毫秒；回傳兩個玩家與「把時間往前推」
function pair({ seed = 7, lo = 0, hi = 300, cmds = 0.06 } = {}) {
  const rnd = rngOf(seed), wire = [];
  let now = 0, seq = 0;
  const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + lo + Math.floor(rnd() * (hi - lo + 1)), seq: seq++, to, m: { ...m, from: from.session.me } }); };
  const a = player('host', send), b = player('join', send);
  a.session.receive({ t: 'welcome', you: 0, room: 'TEST', players: 1 });
  b.session.receive({ t: 'welcome', you: 1, room: 'TEST', players: 2 });
  a.session.receive({ t: 'joined', who: 1 });
  // 房主開戰：第 0 步的開局照 issue 記、走第一步（feed 在這一步把開局送出去）
  a.phase = 'battle'; for (const c of SETUP) a.issue(c); a.host.tick();
  const next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(seed * 3 + 1)], [b, rngOf(seed * 5 + 2)]]);
  const advance = (until, { stop = () => false, gone = new Set() } = {}) => {
    while (Math.min(...[a, b].filter(c => !gone.has(c)).map(c => c.w.tick)) < until && now < until * 400) {
      now += 10;
      wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
      while (wire.length && wire[0].at <= now) { const x = wire.shift(); if (!gone.has(x.to)) x.to.session.receive(x.m); }
      for (const c of [a, b]) {
        if (gone.has(c) || stop(c) || now < next.get(c) || c.w.tick >= until || !c.session.live() || !c.session.ready(c.w.tick)) continue;
        const r = mine.get(c);
        if (r() < cmds) { const own = c.w.units.filter(u => u.alive && u.side === ME); if (own.length) c.issue(mv(own[Math.floor(r() * own.length)].id, 2 + Math.floor(r() * 28), 2 + Math.floor(r() * 28))); }
        if (r() < cmds / 6) c.issue({ t: 'produce', side: ME, kind: UK_TANK });
        c.host.tick(); next.set(c, now + 50);
      }
    }
    return now;
  };
  return { a, b, advance, wire, at: () => now };
}

const groups = {
  // 第 from…from＋delay−1 步預先當成大家都送了空包；第 from＋delay 步要等
  prefill() {
    const ls = new Lockstep(0, [0, 1], 1);
    assert.deepEqual([1, 2, 3, 4].map(t => ls.ready(t)), [true, true, true, true], 'prefill: the first steps count as empty packets from everyone');
    assert.equal(NET_DELAY, 4, 'fixture: the delay on the card');
    assert.equal(ls.ready(1 + NET_DELAY), false, 'prefill: the step after them waits');
  },
  // 等：對方的包沒到不走；到了才走
  wait() {
    const ls = new Lockstep(0, [0, 1], 1);
    for (let t = 1; t <= 4; t++) ls.take(t, []);
    assert.equal(ls.ready(5), false, 'wait: without the other player\'s packet the step does not run');
    assert.throws(() => ls.take(5, []), /not ready/, 'wait: and taking it anyway is refused');
    ls.receive(1, { t: 'tick', at: 5, cmds: [] });
    assert.equal(ls.ready(5), true, 'wait: once it arrives the step runs');
  },
  // 合在一起的順序：照玩家編號、再照下的先後；跟到達的先後無關
  order() {
    const run = theirsFirst => {   // 對方（1 號）的包比我自己的（0 號）先到，或後到
      const ls = new Lockstep(0, [0, 1], 1), theirs = { t: 'tick', at: 5, cmds: [mv(2, 4, 4), mv(3, 5, 5)] };
      if (theirsFirst) ls.receive(1, theirs);
      ls.take(1, [mv(1, 3, 3)]);   // 我的：第 5 步
      if (!theirsFirst) ls.receive(1, theirs);
      for (let t = 2; t <= 4; t++) ls.take(t, []);
      return ls.take(5, []).cmds.map(c => c.ids[0]);
    };
    assert.deepEqual([run(true), run(false)], [[1, 2, 3], [1, 2, 3]], 'order: commands are merged by player number, then in the order they were given');
    const late = new Lockstep(1, [0, 1], 1);
    late.take(1, [mv(9, 1, 1)]); for (let t = 2; t <= 4; t++) late.take(t, []);
    late.receive(0, { t: 'tick', at: 5, cmds: [mv(8, 1, 1)] });
    assert.deepEqual(late.take(5, []).cmds.map(c => c.ids[0]), [8, 9], 'order: player 1 sees the same order (player 0 first) whatever arrives first');
    const bad = new Lockstep(0, [0, 1], 1);
    for (let t = 1; t <= 4; t++) bad.take(t, []);
    bad.receive(1, { t: 'tick', at: 5, cmds: [{ t: 'move', side: 0, ids: 'x' }, mv(4, 1, 1)] });
    assert.deepEqual(bad.take(5, []).cmds.map(c => c.ids[0]), [4], 'order: malformed commands from the network are dropped (both sides run the same check)');
  },
  // 兩個模擬的玩家一起打 2,000 步：每一步兩邊的雜湊一樣、紀錄一樣、重播一樣
  sync() {
    const { a, b, advance } = pair({ seed: 11 });
    const took = advance(2000);
    if (process.env.NET_PACE) console.log(`simulated ms for 2,000 steps: ${took}`);
    assert.equal(a.session.ls.desync, -1, 'sync: no desync reported');
    assert(a.w.tick >= 2000 && b.w.tick >= 2000, `fixture: both players got through 2,000 steps (${a.w.tick}, ${b.w.tick})`);
    assert(took <= 2000 * 50 * 1.6, `sync: with 0–300 ms of network delay the battle keeps pace (2,000 steps of 50 ms took ${took} ms of simulated time)`);
    const given = a.given + b.given;
    assert(given >= 100, `fixture: the players gave orders (${given})`);
    const differ = [];
    for (let t = 1; t <= 2000; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
    assert.deepEqual(differ.slice(0, 5), [], 'sync: after every one of 2,000 steps both worlds hash the same');
    const ran = [a, b].map(c => c.log.filter(e => e.tick > 0).length), late = a.given + b.given - [a, b].reduce((n, c) => n + c.pending.length, 0);
    assert(ran[0] >= late - 2 * NET_DELAY * 2 && ran[0] <= given, `sync: every command both players gave is in the log at the step it ran (${ran[0]} of ${given}; the last few are still on the way)`);
    assert.equal(JSON.stringify(a.log), JSON.stringify(b.log), 'sync: both command logs are the same');
    const replayed = runLog(createWorld(a.w.seed), a.log, 2000);
    assert.equal(hashWorld(replayed), a.hashes[2000], 'sync: the log replays to the same world (replays of an online battle work)');
    assert(a.session.ls.checks >= 15 && b.session.ls.checks >= 15, `sync: the hash was compared every ${NET_HASH_EVERY} steps (${a.session.ls.checks}, ${b.session.ls.checks})`);
    assert.deepEqual([a.log[0].tick, a.log.slice(0, SETUP.length).map(e => e.cmd.t)], [0, SETUP.map(c => c.t)], 'fixture: the opening is logged at step 0');
  },
  // 不同步：偷偷改一邊的世界，下一次比雜湊兩邊都停下來
  desync() {
    const { a, b, advance } = pair({ seed: 5, hi: 120 });
    advance(150);
    const u = b.w.units.find(x => x.alive && x.side === ME); u.hp -= 1;
    advance(260);
    assert.equal(a.session.ls.desync, 200, `desync: both sides stop at the next hash check (${a.session.ls.desync})`);
    assert.equal(b.session.ls.desync, 200, 'desync: on the other side too');
    assert(a.w.tick <= 200 + NET_DELAY && b.w.tick <= 200 + NET_DELAY, `desync: and do not run on (${a.w.tick}, ${b.w.tick})`);
  },
  // 離線：一方離開之後，另一方從對方最後一包之後繼續走
  leave() {
    const { a, b, advance } = pair({ seed: 9, hi: 100 });
    advance(400);
    const gone = new Set([a]);
    b.session.receive({ t: 'left', who: 0 });
    advance(900, { gone });
    assert(b.w.tick >= 900, `leave: the player who stayed carries on without stalling (step ${b.w.tick})`);
    assert(b.session.peerLeft && !b.session.peer, 'leave: and knows the other one left');
  },
  // 房主開戰之前對方要先進來；開打之後才進來的人拿到「已經開打了」
  start() {
    const sent = [], fake = { world: () => ({ tick: 37, seed: 1, sandbox: undefined }), log: () => [], hash: () => '', phase: () => 'battle', begin() {}, tick() {}, remake() {}, focus() {} };
    const s = new Session('host', fake, m => sent.push(m));
    s.receive({ t: 'welcome', you: 0, room: 'X', players: 1 });
    s.receive({ t: 'joined', who: 1 });
    assert(!s.peer && sent.some(m => m.t === 'error'), 'start: someone joining after the battle started is told it already started');
    const lone = new Session('host', { ...fake, world: () => ({ tick: 0, seed: 1 }) }, () => {});
    lone.receive({ t: 'welcome', you: 0, room: 'X', players: 1 });
    assert.equal(lone.feed({ tick: 0, seed: 1 }, []), null, 'start: starting with nobody else in the room plays alone (no lockstep)');
    assert.equal(lone.live(), false, 'start: and stays offline');
    const off = new Session('join', fake, () => {});
    assert.equal(off.feed({ tick: 5, seed: 1 }, [mv(1, 1, 1)]), null, 'start: before the host starts, feed gives nothing (tick() keeps using its own commands)');
    let gw = { tick: 0, seed: 1 };
    const g = new Session('join', { ...fake, world: () => gw, begin: s => { gw = { tick: 0, seed: s }; } }, () => {});
    g.receive({ t: 'welcome', you: 1, room: 'X', players: 2 });
    g.receive({ t: 'tick', at: 5, cmds: [mv(1, 1, 1)], from: 0 });   // 房主的包比開局先到（真的伺服器不會這樣；保險）
    g.receive({ t: 'start', seed: 1, setup: [], delay: NET_DELAY, from: 0 });
    for (let t = 1; t <= 4; t++) g.ls.take(t, []);
    assert(g.ls.ready(5) && g.ls.take(5, []).cmds[0]?.ids[0] === 1, 'start: a packet that arrives before the opening is kept for its step');
  },
};

// 一局結束與斷線（R083 審查）：本機換了世界＝這一局不算數；自己斷線＝跟對方離線一樣繼續打；新的人進來清掉「對方離線」
groups.teardown = () => {
  const { a, b, advance } = pair({ seed: 3, hi: 80 });
  advance(150);
  assert.equal(a.session.stale(), false, 'fixture: while the same world is running the session is current');
  a.w = createWorld(99);   // 房主重開（再來一局、回主選單、看重播、沙盒、讀存檔都會換掉世界）
  assert.equal(a.session.stale(), true, 'teardown: once the world is replaced the online game is over (the client then disconnects)');
  const stay = pair({ seed: 4, hi: 80 });
  stay.advance(150);
  stay.b.session.disconnected();
  stay.advance(600, { gone: new Set([stay.a]) });
  assert(stay.b.w.tick >= 600 && stay.b.session.peerLeft, `teardown: after losing its own connection a player carries on alone (step ${stay.b.w.tick})`);
  const fake = { world: () => ({ tick: 0, seed: 1 }), log: () => [], hash: () => '', phase: () => 'build', begin() {}, tick() {}, remake() {}, focus() {} };
  const h = new Session('host', fake, () => {});
  h.receive({ t: 'welcome', you: 0, room: 'X', players: 1 });
  h.receive({ t: 'joined', who: 1 }); h.receive({ t: 'left', who: 1 }); h.receive({ t: 'joined', who: 1 });
  assert(h.peer && !h.peerLeft, 'teardown: a new guest joining clears the earlier 對方離線');
};
// 迴圈（真的 main.ts 那一段）：連線時等對方的時間不存起來；單機照舊
groups.frame = () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), from = main.indexOf('  let steps = 0;'), to = main.indexOf('  const alpha =', from);
  assert(from > 0 && to > from, 'fixture: the frame loop is where it was');
  const chunk = stripTypeScriptTypes(main.slice(from, to));
  const run = (acc, live, ready) => { const c = vm.createContext({ acc, TICK_HZ: 20, w: { tick: 0, events: [] }, view: {}, battleAudio: undefined, ticks: 0, netLive: () => live, netReady: () => ready }); c.tick = () => { c.ticks++; }; vm.runInContext(chunk, c); return { acc: c.acc, ticks: c.ticks }; };
  const waiting = run(30, true, false);
  assert(waiting.ticks === 0 && waiting.acc <= 1 / 20 + 1e-9, `frame: online, the time spent waiting for the other player is not banked (${waiting.acc} s left)`);
  assert.deepEqual(run(0.12, false, true), { acc: 0.12 - 2 / 20, ticks: 2 }, 'frame: single player is unchanged (two steps, the rest carried over)');
  assert.deepEqual(run(30, false, true), { acc: 0, ticks: 8 }, 'frame: single player still drops the backlog after 8 steps');
};

// ---- 轉發伺服器：真的開一個行程 ----
async function relayGroup() {
  const base = mkdtempSync(join(tmpdir(), 'r083-dist-')), dist = join(base, 'dist'), empty = mkdtempSync(join(tmpdir(), 'r083-empty-'));
  mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>R083'); writeFileSync(join(base, 'secret.txt'), 'outside');
  const start = dir => new Promise((res, rej) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL('../server/relay.mjs', import.meta.url)), '--port', '0', '--host', '127.0.0.1', '--dist', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; const m = /埠 (\d+)/.exec(out); if (m) res({ p, port: +m[1] }); });
    p.on('exit', c => rej(new Error(`relay exited ${c}: ${out}`)));
    setTimeout(() => rej(new Error('relay did not start')), 10000);
  });
  const srv = await start(dist), srv2 = await start(empty);
  const open = (room, role, port = srv.port) => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay?room=${room}&role=${role}`), inbox = [];
    ws.onmessage = e => inbox.push(JSON.parse(e.data));
    ws.onerror = () => rej(new Error('ws error'));
    ws.onopen = () => res({ ws, inbox, next: async (t = 3000) => { for (const t0 = Date.now(); Date.now() - t0 < t; await new Promise(r => setTimeout(r, 10))) if (inbox.length) return inbox.shift(); return null; } });
  });
  try {
    const h = await open('ROOM1', 'host');
    assert.deepEqual(await h.next(), { t: 'welcome', you: 0, room: 'ROOM1', players: 1 }, 'relay: the host opens the room as player 0');
    const g = await open('room1', 'join');
    assert.deepEqual(await g.next(), { t: 'welcome', you: 1, room: 'ROOM1', players: 2 }, 'relay: the guest joins as player 1 (room codes are not case sensitive)');
    assert.deepEqual(await h.next(), { t: 'joined', who: 1 }, 'relay: the host is told');
    h.ws.send(JSON.stringify({ t: 'tick', at: 5, cmds: [] }));
    assert.deepEqual(await g.next(), { t: 'tick', at: 5, cmds: [], from: 0 }, 'relay: a message goes to the other player, stamped with who sent it');
    assert.equal(await h.next(300), null, 'relay: and not back to the sender');
    const third = await open('ROOM1', 'join');
    assert.equal((await third.next())?.t, 'error', 'relay: a third player cannot get in');
    const nowhere = await open('NOPE', 'join');
    assert.equal((await nowhere.next())?.t, 'error', 'relay: joining a room nobody opened fails');
    const twice = await open('ROOM1', 'host');
    assert.equal((await twice.next())?.t, 'error', 'relay: the same room cannot be opened twice');
    const other = await open('ROOM2', 'host');
    await other.next();
    other.ws.send(JSON.stringify({ t: 'ping', id: 1 }));
    assert.equal(await g.next(300), null, 'relay: rooms do not hear each other');
    g.ws.close();
    assert.deepEqual(await h.next(), { t: 'left', who: 1 }, 'relay: when someone leaves the other is told');
    h.ws.close();
    const h3 = await open('ROOM3', 'host'); await h3.next();
    const g3 = await open('ROOM3', 'join'); await g3.next(); await h3.next();
    h3.ws.close();
    assert.deepEqual(await g3.next(), { t: 'left', who: 0 }, 'relay: the guest is told when the host leaves');
    const again = await open('ROOM3', 'host');
    assert.equal((await again.next())?.you, 0, 'relay: when the host leaves the room closes, even with the guest still connected (the code can be opened again)');
    for (const x of [third, nowhere, twice, other, again, g3]) x.ws.close();
    const page = await fetch(`http://127.0.0.1:${srv.port}/`);
    assert.equal(page.status, 200, 'relay: it serves the game page');
    assert.match(await page.text(), /R083/, 'relay: the page in dist/');
    const none = await fetch(`http://127.0.0.1:${srv2.port}/`);
    assert(none.status === 503 && /npm run build/.test(await none.text()), 'relay: without a built page it says to run npm run build');
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/..%2fsecret.txt`)).status, 404, 'relay: nothing outside dist/ is served');
    // 壞的請求不讓整個行程掛掉（R083 審查）
    const raw = text => new Promise(res => { const c = net.connect(srv.port, '127.0.0.1', () => c.write(text)); c.on('data', () => { c.resetAndDestroy(); res(); }); c.on('error', () => res()); setTimeout(res, 1500); });
    await raw('GET /% HTTP/1.1\r\nHost: x\r\n\r\n');
    await raw('GET /nope HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    await raw('GET /relay?room=Q HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(srv.p.exitCode, null, 'relay: a malformed URL or a reset on a refused upgrade does not bring the server down');
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/%E4%B8`)).status, 400, 'relay: a bad percent-escape gets 400');
    const d1 = await open('DEEP', 'host'); await d1.next();
    const d2 = await open('DEEP', 'join'); await d2.next(); await d1.next();
    d2.ws.send(`{"t":"tick","x":${'['.repeat(30000)}${']'.repeat(30000)}}`);
    assert.deepEqual(await d1.next(), { t: 'left', who: 1 }, 'relay: a message that cannot be forwarded (nested too deep) drops its sender, not the server');
    assert.equal(srv.p.exitCode, null, 'relay: and the server is still up');
    // 房主走了之後，留下來的人送的不會轉給同一個房號的新房主
    const s1 = await open('STALE', 'host'); await s1.next();
    const s2 = await open('STALE', 'join'); await s2.next(); await s1.next();
    s1.ws.close(); await s2.next();
    const s3 = await open('STALE', 'host'); await s3.next();
    s2.ws.send(JSON.stringify({ t: 'tick', at: 9, cmds: [] }));
    assert.equal(await s3.next(400), null, 'relay: someone left behind in a closed room does not reach the new host of the same code');
    for (const x of [d1, s2, s3]) x.ws.close();
  } finally {
    srv.p.kill(); srv2.p.kill();
    rmSync(base, { recursive: true, force: true }); rmSync(empty, { recursive: true, force: true });
  }
}
groups.relay = relayGroup;

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); await groups[only](); console.log(`net-lockstep/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { await run(); console.log(`OK net-lockstep/${name}`); }

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r083-negative-'));
const mutants = [
  ['no_prefill', 'prefill', 'src/net/lockstep.ts', '    for (let t = from; t < from + delay; t++) for (const p of this.players) this.put(t, p, []);\n', '', 'prefill: the first steps count as empty packets'],
  ['no_wait', 'wait', 'src/net/lockstep.ts', "    return this.players.every(p => at?.has(p) || (this.gone.has(p) && t > (this.last.get(p) ?? -1)));", '    return true;', "wait: without the other player's packet"],
  ['arrival_order', 'order', 'src/net/lockstep.ts', '    for (const p of this.players) cmds.push(...(at?.get(p) ?? []));', '    for (const v of at?.values() ?? []) cmds.push(...v);', 'order: commands are merged by player number'],
  ['no_check', 'order', 'src/net/lockstep.ts', '    at.set(p, cmds.filter(c => isCommand(c)) as Command[]);', '    at.set(p, cmds as Command[]);', 'order: malformed commands from the network are dropped'],
  ['no_log', 'sync', 'src/net/session.ts', '      for (const c of cmds) log.push({ tick: t, cmd: structuredClone(c) });\n', '', 'sync: every command both players gave is in the log'],
  ['guest_no_setup', 'sync', 'src/net/session.ts', '    ls.put(0, 0, setup); ls.put(0, 1, []);', '    ls.put(0, 0, []); ls.put(0, 1, []);', 'sync: no desync reported'],
  ['no_delay', 'sync', 'src/net/lockstep.ts', '      this.put(t + this.delay, this.me, own);\n      out.push({ t: \'tick\', at: t + this.delay, cmds: own });', '      this.put(t + 1, this.me, own);\n      out.push({ t: \'tick\', at: t + 1, cmds: own });', 'sync: with 0–300 ms of network delay the battle keeps pace'],
  ['hash_ignored', 'desync', 'src/net/lockstep.ts', '      if (hq !== mine) { if (this.desync < 0 || t < this.desync) this.desync = t; }', '      if (false) { this.desync = t; }', 'desync: both sides stop at the next hash check'],
  ['leave_ignored', 'leave', 'src/net/lockstep.ts', '  leave(p: number): void { if (p !== this.me) this.gone.add(p); }', '  leave(p: number): void { }', 'leave: the player who stayed carries on'],
  ['late_join_accepted', 'start', 'src/net/session.ts', "case 'joined': if (!this.ls && this.host.world().tick === 0) {", "case 'joined': if (!this.ls) {", 'start: someone joining after the battle started'],
  ['early_dropped', 'start', 'src/net/session.ts', "else if (this.role === 'join' && this.early.length < 1000) this.early.push(m);", ";", 'start: a packet that arrives before the opening'],
  ['never_stale', 'teardown', 'src/net/session.ts', '  stale(): boolean { return !!this.ls && this.host.world() !== this.world; }', '  stale(): boolean { return false; }', 'teardown: once the world is replaced'],
  ['disconnect_waits', 'teardown', 'src/net/session.ts', '    if (this.ls) { for (const p of this.ls.stillHere()) if (p !== this.me) this.ls.leave(p);', '    if (this.ls) { for (const p of [] as number[]) this.ls.leave(p);', 'teardown: after losing its own connection'],
  ['left_sticky', 'teardown', 'src/net/session.ts', '{ this.peer = true; this.peerLeft = false; }', '{ this.peer = true; }', 'teardown: a new guest joining clears'],
  ['banks_wait', 'frame', 'src/main.ts', ' else if (netLive()) acc = Math.min(acc, 1 / TICK_HZ);', ';', 'frame: online, the time spent waiting'],
  ['relay_url_crash', 'relay', 'server/relay.mjs', "  try { url = new URL(req.url, 'http://x'); rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }\n  catch {", "  { url = new URL(req.url, 'http://x'); rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }\n  if (false) {", 'relay: a malformed URL or a reset'],
  ['relay_reset_crash', 'relay', 'server/relay.mjs', "  socket.on('error', () => socket.destroy());   // R083 審查", "  // R083 審查", 'relay: a malformed URL or a reset'],
  ['relay_deep_crash', 'relay', 'server/relay.mjs', "    try { others(room, you, { ...msg, from: you }); } catch { ws.close(1007); }", "    others(room, you, { ...msg, from: you });", 'relay: a message that cannot be forwarded'],
  ['relay_stale_member', 'relay', 'server/relay.mjs', "    if (you < 0 || rooms.get(room)?.[you] !== ws || !msg", "    if (you < 0 || !msg", 'relay: someone left behind in a closed room'],
  ['relay_echo', 'relay', 'server/relay.mjs', 'if (m && i !== you) m.send(', 'if (m) m.send(', 'relay: the host is told'],   // 轉回給自己：房主開房那一刻就先聽到自己進來
  ['relay_no_cap', 'relay', 'server/relay.mjs', '  if (free < 0 || free >= MAX_PLAYERS) return', '  if (false) return', 'relay: a third player cannot get in'],
  ['relay_keeps_room', 'relay', 'server/relay.mjs', '    if (you === 0 || members.every(m => !m)) rooms.delete(room);', '    if (members.every(m => !m)) rooms.delete(room);', 'relay: when the host leaves the room closes'],
  ['relay_escapes', 'relay', 'server/relay.mjs', "  if (!file.startsWith(DIST + path.sep) || ", "  if (", 'relay: nothing outside dist/'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'src'), { recursive: true });
    for (const d of ['src/sim', 'src/net', 'server']) cpSync(join(root, d), join(dir, d), { recursive: true });
    cpSync(join(root, 'src/main.ts'), join(dir, 'src/main.ts'));
    cpSync(join(root, 'tests/net-lockstep.mjs'), join(dir, 'tests/net-lockstep.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/net-lockstep.mjs'), group], { encoding: 'utf8', timeout: 120000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK net-lockstep-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`net-lockstep: all groups OK, ${mutants.length} isolated mutants rejected`);
