// R085 連線對戰（不開瀏覽器的部分）。兩個 Chrome 的實測在 tests/versus-browser.mjs。
// 「我方」可以換（src/side.ts）、介面與畫面不再從 world.ts 拿「我方」、模擬不碰它；對戰的鎖步只收自己那一方的指令；
// 房主的開局拿掉 ai、帶 vs；加入的人照開局換成對戰；停火在 sym 的局兩方都能用；戰報與勝負照「我方」；
// 順手修的 R083 第二輪審查：開打之後才來的人有回覆、離開的人的包不收、https 頁面的本機位址、每條連線自己的 ping 計時器、轉發伺服器關了就不讀、檔案用 pipeline。
// 用法：node tests/versus.mjs            全部跑，另外故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/versus.mjs <群組名>   只跑那一群（隔離副本裡用）
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createWorld, center, UK_TANK, UK_HOWITZER } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { Lockstep } from '../src/net/lockstep.ts';
import { Session } from '../src/net/session.ts';
import * as side from '../src/side.ts';
import { newStats, statsStep, makeReport } from '../src/ui/report.ts';
import { fireDisciplineState, toggleFireDiscipline } from '../src/ui/fireDiscipline.ts';
import { menuLayout } from '../src/ui/startMenu.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const src = rel => readFileSync(join(root, rel), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const code = text => text.replace(/\/\/[^\n]*/g, '');   // 去掉行尾註解（掃原始碼時不看註解裡的字）

// 假的「遊戲」：真的 Session，世界只是一個物件
function game(world) {
  const c = { w: world, log: [], begun: [] };
  c.host = { world: () => c.w, log: () => c.log, hash: () => 'h', phase: () => 'battle', begin: s => { c.begun.push(s); c.w = { tick: 0, seed: s }; }, tick() {}, remake() {}, focus() {} };
  return c;
}
const OPENING = [{ t: 'map', id: 4, vegetation: 1, sym: 1 }, { t: 'build', side: 0, kind: 1, x: 20, z: 24 }, { t: 'build', side: 1, kind: 1, x: 8, z: 4 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, end: 1, mg: 2 }, { t: 'ai', side: 1, level: 3, v: 3 }];
function hostLive(versus, world = { tick: 0, seed: 9 }) {
  const c = game(world), sent = [];
  const s = new Session('host', c.host, m => sent.push(m), versus);
  s.receive({ t: 'welcome', you: 0, room: 'VS', players: 1 });
  s.receive({ t: 'joined', who: 1 });
  c.log = OPENING.map(cmd => ({ tick: 0, cmd: structuredClone(cmd) }));
  const out = s.feed(c.w, OPENING.map(x => structuredClone(x)));
  return { c, s, sent, out };
}

const groups = {
  // src/side.ts：活的綁定，換了就跟著變
  side() {
    assert.deepEqual([side.SIDE_PLAYER, side.SIDE_ENEMY], [0, 1], 'side: single player and co-op view side 0');
    side.setViewSide(1);
    assert.deepEqual([side.SIDE_PLAYER, side.SIDE_ENEMY], [1, 0], 'side: a versus guest views side 1');
    side.setViewSide();
    assert.deepEqual([side.SIDE_PLAYER, side.SIDE_ENEMY], [0, 1], 'side: and back to side 0');
    side.setViewSide(7);
    assert.deepEqual([side.SIDE_PLAYER, side.SIDE_ENEMY], [0, 1], 'side: anything else counts as side 0');
  },
  // 原始碼：模擬不碰 side.ts；介面、畫面、總機的「我方」都從 side.ts 來
  imports() {
    const ts = dir => readdirSync(join(root, dir), { recursive: true }).filter(f => String(f).endsWith('.ts')).map(f => `${dir}/${String(f).replaceAll('\\', '/')}`);
    const sim = ts('src/sim').filter(f => /side\.ts['"]/.test(src(f)));
    assert.deepEqual(sim, [], 'imports: the simulation never imports src/side.ts');
    const view = [...ts('src/ui'), ...ts('src/render'), 'src/main.ts'];
    const fromWorld = view.filter(f => [...src(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*'[./]*\/?sim\/world\.ts'/g)].some(m => /\bSIDE_(PLAYER|ENEMY)\b/.test(m[1])));
    assert.deepEqual(fromWorld, [], 'imports: no interface, render or hub file takes SIDE_PLAYER／SIDE_ENEMY from sim/world.ts');
    const users = view.filter(f => /\bSIDE_(PLAYER|ENEMY)\b/.test(code(src(f)).replace(/import[^;]*;/g, '')));
    const missing = users.filter(f => !/import\s*\{[^}]*\bSIDE_(PLAYER|ENEMY)\b[^}]*\}\s*from\s*'\.\.?\/side\.ts'/.test(src(f)));
    assert(users.length >= 20, `fixture: the files that use 我方 were found (${users.length})`);
    assert.deepEqual(missing, [], 'imports: every file that uses 我方 takes it from src/side.ts');
  },
  // 對戰的鎖步：第 1 步以後只收自己那一方的（沒有 side 的也丟）；第 0 步不篩；合作全收；兩邊一樣
  lockstep() {
    const host = [{ t: 'move', side: 0, ids: [2], x: 6, z: 6 }, { t: 'move', side: 1, ids: [6], x: 7, z: 7 }, { t: 'fireDiscipline', side: 0, ids: [2], hold: true }];
    const guest = [{ t: 'move', side: 1, ids: [5], x: 3, z: 3 }, { t: 'move', side: 0, ids: [1], x: 4, z: 4 }, { t: 'map', id: 1 }, { t: 'produce', side: 1, kind: 3 }, { t: 'stop', side: 1, ids: [5] }];
    const opening = [{ t: 'build', side: 1, kind: 1, x: 2, z: 2 }, { t: 'map', id: 1 }];
    const run = (me, versus) => {
      const L = new Lockstep(me, [0, 1], 1, 4, versus);
      L.put(0, 0, opening); L.put(0, 1, []);
      L.put(5, 0, host); L.put(5, 1, guest);
      return { zero: L.take(0, []).cmds, five: L.take(5, []).cmds };
    };
    const a = run(0, true), b = run(1, true), coop = run(0, false);
    assert.deepEqual(a.five, [host[0], host[2], guest[0], guest[3], guest[4]], 'lockstep: versus drops orders for the other side and commands without a side (after step 0)');
    assert.deepEqual(b.five, a.five, 'lockstep: both players drop the same ones');
    assert.deepEqual(a.zero, opening, "lockstep: the opening at step 0 is not filtered (the host's deployment for both sides)");
    assert.deepEqual(coop.five, [...host, ...guest], 'lockstep: co-op keeps everything');
  },
  // 房主的開局、加入的人、R083 第二輪審查的兩條
  session() {
    const v = hostLive(true), start = v.sent.find(m => m.t === 'start');
    const noAi = OPENING.filter(c => c.t !== 'ai');
    assert(start && start.vs === 1, 'session: the versus opening says vs');
    assert.deepEqual(start.setup, noAi, 'session: the versus opening has no ai command');
    assert.deepEqual(v.out, noAi, 'session: and the host steps without it');
    assert.deepEqual(v.c.log.map(e => e.cmd), noAi, "session: and the host's own log has no ai command either");
    assert(v.s.versus && v.s.ls.versus, 'session: the host lockstep is versus');
    const coop = hostLive(false), cs = coop.sent.find(m => m.t === 'start');
    assert(cs && cs.vs === undefined && coop.out === null && coop.c.log.length === OPENING.length && !coop.s.ls.versus, 'session: co-op is unchanged (ai kept, no vs)');
    const z = hostLive(true, { tick: 0, seed: 9, zombies: { wave: 1 } }), zs = z.sent.find(m => m.t === 'start');
    assert(zs && zs.vs === undefined && !z.s.versus, 'session: zombie mode opens as co-op (there is no top-left side)');
    for (const vs of [1, undefined]) {
      const g = game({ tick: 0, seed: 1 }), gs = new Session('join', g.host, () => {});
      gs.receive({ t: 'welcome', you: 1, room: 'VS', players: 2 });
      gs.receive({ t: 'start', seed: 9, setup: noAi, delay: 4, ...(vs ? { vs } : {}), from: 0 });
      assert.deepEqual([gs.versus, gs.ls?.versus, g.begun], [!!vs, !!vs, [9]], `session: a guest who gets vs ${vs ? 'plays versus' : 'plays co-op'}`);
    }
    // R083 第二輪審查 a：開打之後才來的人（例如對方重新整理）也要告訴他
    v.sent.length = 0;
    v.s.receive({ t: 'left', who: 1 }); v.s.receive({ t: 'joined', who: 1 });
    assert(v.sent.some(m => m.t === 'error' && /已經開打了/.test(m.why)), 'session: someone joining a live battle is told it already started');
    // R083 第二輪審查 b：離開的人那個位置被別人佔了，新來的人送的包不收
    v.s.receive({ t: 'tick', at: 1e9, cmds: [], from: 1 });
    v.s.ls.put(10, 0, []);
    assert(v.s.ls.ready(10), 'session: packets from a player who left are ignored (a newcomer in the freed seat cannot stall the host)');
  },
  // 停火：sym 的局第 1 方也能用；沒有 sym 照舊只有第 0 方
  fire() {
    const mk = sym => {
      const w = createWorld(1944); w.blds = []; w.occ.fill(0); delete w.ai; if (sym) w.sym = 1;
      const base = structuredClone(w.units[0]);
      w.units = [{ ...base, id: 1, kind: 0, side: 1, x: center(4), z: center(4), hp: 10000, path: [], pathIdx: 0, cooldown: 0 },
        { ...structuredClone(base), id: 2, kind: 0, side: 0, x: center(12), z: center(4), hp: 10000, path: [], pathIdx: 0, cooldown: 10000 }];
      w.winner = -1; return w;
    };
    const fired = (sym, hold) => { const w = mk(sym); let n = 0; step(w, hold ? [{ t: 'fireDiscipline', side: 1, ids: [1], hold: true }] : []); for (let i = 0; i < 12; i++) { n += w.events.filter(e => e.e === 'fire' && e.unit === 1).length; step(w, []); } return { n, hold: w.units[0].holdFire }; };
    assert(fired(true, false).n > 0, 'fixture: a side-1 tank fires at the side-0 tank in range');
    const on = fired(true, true);
    assert.deepEqual([on.hold, on.n], [1, 0], 'fire: in a sym battle side 1 can hold fire');
    const off = fired(false, true);
    assert(off.hold === undefined && off.n > 0, 'fire: without sym side 1 still cannot (old battles unchanged)');
    const w = mk(true), issued = [];
    side.setViewSide(1);
    try {
      assert.deepEqual(fireDisciplineState(w, [1]).ids, [1], 'fire: the hold button counts the side-1 tank for the versus guest');
      toggleFireDiscipline(() => ({ world: w, selected: [1], pending: [], active: true }), c => issued.push(c));
    } finally { side.setViewSide(); }
    assert.equal(issued[0]?.side, 1, 'fire: and sends it for side 1 (it used to be written as 0)');
  },
  // 戰報與勝負照「我方」
  async report() {
    const w = createWorld(1944), ids = s => w.units.filter(u => u.side === s).map(u => u.id);
    const extra = structuredClone(w.units.find(u => u.side === 1 && u.kind === UK_TANK)); extra.id = w.units.length + 1; w.units.push(extra);   // 左上多一台坦克：兩邊不一樣才看得出來
    side.setViewSide(1);
    let r;
    try {
      const st = newStats(w);
      statsStep(st, w, [{ e: 'fire', unit: ids(0)[0] }, { e: 'fire', unit: ids(0)[0] }, { e: 'fire', unit: ids(1)[0] }]);
      w.units.find(u => u.side === 0 && u.kind === UK_HOWITZER).alive = false;
      r = makeReport(w, st);
    } finally { side.setViewSide(); }
    assert.deepEqual([r.start[0][0], r.start[1][0]], [4, 3], 'report: for the versus guest 我方 is side 1 (tanks at the start: 4 and 3)');
    assert.deepEqual(r.fires, [1, 2], 'report: fires are listed 我方 first');
    assert.deepEqual([r.kills, r.lost], [1, 0], 'report: kills and losses are from side 1');
    // 戰報畫面與勝負：最小的假 DOM（第一個建出來的元素就是戰報那一層）
    class El { constructor() { this.hidden = false; this.className = ''; this.innerHTML = ''; this.textContent = ''; this.style = {}; } append() {} appendChild() {} addEventListener() {} setAttribute() {} querySelector() { return new El(); } }
    let panel = null;
    globalThis.document = { createElement: () => { const e = new El(); panel ??= e; return e; }, getElementById: () => null, body: new El() };
    try {
      const { initReportView } = await import('../src/ui/reportView.ts'), view = initReportView({ again() {} });
      const show = winner => { view.show({ ...r, winner }); return [/<h2>([^<]*)<\/h2>/.exec(panel.innerHTML)?.[1], panel.className]; };
      side.setViewSide(1);
      try { assert.deepEqual([show(1), show(0)], [['勝利', 'win'], ['戰敗', 'lose']], 'report: the report title — side 1 winning is 勝利 for the versus guest'); }
      finally { side.setViewSide(); }
      assert.deepEqual([show(0), show(1)], [['勝利', 'win'], ['戰敗', 'lose']], 'report: and unchanged for side 0');
    } finally { delete globalThis.document; }
  },
  // client.ts：https 的本機位址、每條連線自己的 ping 計時器（假的 WebSocket、計時器、DOM）
  async client() {
    const active = new Set(); let next = 0;
    const KEYS = ['location', 'window', 'clearInterval', 'addEventListener', 'document', 'WebSocket', 'localStorage'];
    const saved = Object.fromEntries(KEYS.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));   // Node 自己的 WebSocket、clearInterval 用完要還回去
    class El { constructor() { this.style = {}; this.value = ''; this.hidden = false; this.textContent = ''; } setAttribute() {} appendChild() {} focus() {} remove() {} querySelectorAll() { return []; } }
    const byId = new Map(), sockets = [];
    Object.assign(globalThis, {
      location: { protocol: 'http:', host: '127.0.0.1:1', search: '?room=AB&net=host' },
      window: { setInterval: () => { active.add(++next); return next; } },
      clearInterval: id => active.delete(id),
      addEventListener() {},
      document: { createElement: () => new El(), getElementById: id => (byId.has(id) ? byId.get(id) : (byId.set(id, new El()), byId.get(id))), querySelector: () => null, body: new El() },
      WebSocket: class { constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); } send() {} close() { this.readyState = 3; } },
    });
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true, writable: true });
    try {
      const client = await import('../src/net/client.ts');
      for (const url of ['ws://localhost', 'ws://localhost:8788/relay', 'ws://[::1]:8788/relay', 'ws://game.localhost:8788/relay', 'ws://127.0.0.2:8788/relay', 'wss://example.org/relay'])
        assert.equal(client.httpsBlocks(url), false, `client: https pages may reach ${url}`);
      for (const url of ['ws://192.168.1.5:8788/relay', 'ws://example.org/relay', 'ws://localhost.example.org/relay'])
        assert.equal(client.httpsBlocks(url), true, `client: https pages cannot reach ${url}`);
      const w = { tick: 0, seed: 1 };
      client.initNet({ world: () => w, log: () => [], hash: () => '', phase: () => 'build', begin() {}, tick() {}, remake() {}, focus() {} });
      assert.equal(sockets.length, 1, 'fixture: the link opened one connection');
      sockets[0].onopen();
      const first = next;
      client.openNetPanel(() => {});
      byId.get('net-host').onclick();   // 開另一個房：舊的連線關掉（它的 onclose 晚一點才到）
      assert.equal(sockets.length, 2, 'fixture: a second connection');
      sockets[1].onopen();
      const second = next;
      sockets[0].onclose();
      assert(active.has(second) && !active.has(first), "client: an old connection closing late stops its own ping timer, not the new one's");
    } finally {
      for (const k of KEYS) { delete globalThis[k]; if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); }
    }
  },
  // 轉發伺服器（真的行程）：自己關掉的連線不再讀、不再轉；下載到一半被中斷不會讓它停擺
  async relay() {
    const base = mkdtempSync(join(tmpdir(), 'r085-dist-')), dist = join(base, 'dist');
    mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>R085'); writeFileSync(join(dist, 'big.bin'), Buffer.alloc(4 << 20, 7));
    const p = spawn(process.execPath, [join(root, 'server/relay.mjs'), '--port', '0', '--host', '127.0.0.1', '--dist', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const port = await new Promise((res, rej) => { let out = ''; p.stdout.on('data', d => { out += d; const m = /埠 (\d+)/.exec(out); if (m) res(+m[1]); }); p.on('exit', c => rej(new Error(`relay exited ${c}`))); setTimeout(() => rej(new Error('relay did not start')), 10000); });
      const inbox = [], h = new WebSocket(`ws://127.0.0.1:${port}/relay?room=RAW&role=host`);
      h.onmessage = e => inbox.push(JSON.parse(e.data));
      await new Promise((res, rej) => { h.onopen = res; h.onerror = rej; });
      const frame = (op, text) => { const body = Buffer.from(text), mask = Buffer.from([1, 2, 3, 4]); for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3]; return Buffer.concat([Buffer.from([0x80 | op, 0x80 | body.length]), mask, body]); };
      const g = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
      let got = Buffer.alloc(0); g.on('data', d => { got = Buffer.concat([got, d]); }); g.on('error', () => {});
      g.write('GET /relay?room=RAW&role=join HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      for (let i = 0; i < 100 && !inbox.some(m => m.t === 'joined'); i++) await sleep(20);
      assert(inbox.some(m => m.t === 'joined'), 'fixture: a raw guest joins');
      g.write(frame(8, ''));   // 送「關閉」；之後（自己這一頭不關）照樣送一包
      await sleep(200);
      g.write(frame(1, JSON.stringify({ t: 'tick', at: 9, cmds: [] })));
      await sleep(500);
      assert(!inbox.some(m => m.t === 'tick'), 'relay: after the relay closes a connection it neither reads nor forwards what still arrives on it');
      g.destroy();
      for (let i = 0; i < 20; i++) await new Promise(res => { const c = net.connect(port, '127.0.0.1', () => c.write('GET /big.bin HTTP/1.1\r\nHost: x\r\n\r\n')); c.once('data', () => { c.resetAndDestroy(); res(); }); c.on('error', res); setTimeout(res, 1500); });
      await sleep(300);
      assert.equal(p.exitCode, null, 'relay: twenty downloads cut off halfway do not bring it down');
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200, 'relay: and it still serves the page');
      assert(/pipeline\(fs\.createReadStream\(file\), res,/.test(src('server/relay.mjs')) && !/\.pipe\(res\)/.test(src('server/relay.mjs')), 'relay: static files use pipeline (the file is closed when a download is cut off; a read error does not crash it)');
      h.close();
    } finally { p.kill(); rmSync(base, { recursive: true, force: true }); }
  },
  // 接線（原始碼）：每開一局換回第 0 方、加入的人的鏡頭、對戰不自動存、閥、開始選單、勝負橫幅、腳下的圈
  wiring() {
    const main = src('src/main.ts');
    assert.match(main, /\n {2}w = sandbox \? createSandboxWorld\(s\) : createWorld\(s\); setViewSide\(\);/, 'wiring: every new battle starts from side 0 (reset)');
    assert.match(main, /if \(SIDE_PLAYER\) view\.target\.set\(w\.n - view\.target\.x, 0, w\.n - view\.target\.z\); \}, versus: V\.r085 \}\);/, 'wiring: the guest camera starts on the top-left side');
    assert.match(main, /replaying: \(\) => !!replay\?\.playing\(\) \|\| netVersus\(\),/, 'wiring: a versus battle is not autosaved');
    assert.match(src('src/valves.ts'), /get r085\(\) \{ return on\('085'\); \}/, 'wiring: the valve is on the table');
    const view = { kind: 'start', map: 'rye', mode: 'battle', ai: 2, maps: ['rye'], modes: ['battle'], aiOn: true, rye: true, tutorial: false, audio: null, resume: false, net: true };
    const ids = v => menuLayout(v).extra.map(x => x.id);
    assert.deepEqual([ids({ ...view, vs: true }).includes('sm-vs'), ids(view).includes('sm-vs'), ids({ ...view, net: false, vs: true }).includes('sm-vs')], [true, false, false], 'wiring: the start menu offers 連線對戰 only when versus is on');
    assert.match(src('src/ui/hud.ts'), /ban\.textContent = s\.winner === SIDE_PLAYER \? '勝利' : s\.winner === SIDE_ENEMY \? '戰敗'/, 'wiring: the win banner follows 我方');
    assert.match(src('src/render/battle.ts'), /this\.discs\.setColorAt\(nd, TEAM_COL\[u\.side === SIDE_PLAYER \? 0 : 1\]\)/, 'wiring: the ring under each unit is blue for 我方');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); await groups[only](); console.log(`versus/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { await run(); console.log(`OK versus/${name}`); }

// ---- 故意弄壞（隔離的副本）----
const temp = mkdtempSync(join(tmpdir(), 'r085-negative-'));
const mutants = [
  ['sim_imports_side', 'imports', 'src/sim/eco.ts', "import { trenchAt } from './trenches.ts';", "import { trenchAt } from './trenches.ts'; import { SIDE_PLAYER as VIEW } from '../side.ts'; void VIEW;", 'imports: the simulation never imports'],
  ['ui_world_side', 'imports', 'src/ui/pick.ts', "import { SUB } from '../sim/world.ts';\nimport { SIDE_PLAYER } from '../side.ts';", "import { SUB, SIDE_PLAYER } from '../sim/world.ts';", 'imports: no interface'],
  ['no_filter', 'lockstep', 'src/net/lockstep.ts', "(!this.versus || t < this.from || (c as { side?: unknown }).side === p)", 'true', 'lockstep: versus drops'],
  ['filter_opening', 'lockstep', 'src/net/lockstep.ts', '(!this.versus || t < this.from ||', '(!this.versus ||', 'lockstep: the opening at step 0'],
  ['keep_ai', 'session', 'src/net/session.ts', "setup = vs ? pending.filter(c => c.t !== 'ai') : pending;", 'setup = pending;', 'session: the versus opening has no ai'],
  ['log_ai', 'session', 'src/net/session.ts', "if (log[i].tick === 0 && log[i].cmd.t === 'ai') log.splice(i, 1);", ';', "session: and the host's own log"],
  ['guest_coop', 'session', 'src/net/session.ts', 'this.begin(m.seed, m.setup, m.vs === 1);', 'this.begin(m.seed, m.setup, false);', 'session: a guest who gets vs'],
  ['joined_live', 'session', 'src/net/session.ts', "else this.send({ t: 'error', why: this.ls ?", "else if (!this.ls) this.send({ t: 'error', why: this.ls ?", 'session: someone joining a live battle'],
  ['gone_packets', 'session', 'src/net/lockstep.ts', 'if (from === this.me || this.gone.has(from)) return;', 'if (from === this.me) return;', 'session: packets from a player who left'],
  ['fire_side1', 'fire', 'src/sim/fireDiscipline.ts', '(u.side === SIDE_PLAYER || (!!w?.sym && u.side === SIDE_ENEMY))', 'u.side === SIDE_PLAYER', 'fire: in a sym battle side 1'],
  ['fire_nosym', 'fire', 'src/sim/fireDiscipline.ts', '(!!w?.sym && u.side === SIDE_ENEMY)', '(u.side === SIDE_ENEMY)', 'fire: without sym side 1 still cannot'],
  ['fire_button', 'fire', 'src/ui/fireDiscipline.ts', "issue({ t: 'fireDiscipline', side: SIDE_PLAYER,", "issue({ t: 'fireDiscipline', side: 0,", 'fire: and sends it for side 1'],
  ['report_fires', 'report', 'src/ui/report.ts', 'fires: [st.fires[SIDE_PLAYER], st.fires[SIDE_ENEMY]],', 'fires: st.fires.slice(),', 'report: fires are listed'],
  ['report_title', 'report', 'src/ui/reportView.ts', "r.winner === SIDE_PLAYER ? '勝利' : r.winner === SIDE_ENEMY ? '戰敗'", "r.winner === 0 ? '勝利' : r.winner === 1 ? '戰敗'", 'report: the report title'],
  ['https_narrow', 'client', 'src/net/client.ts', '(127(\\.\\d{1,3}){3}|localhost|\\[::1\\]|[a-z0-9.-]+\\.localhost)([:/?#]|$)', '(127\\.0\\.0\\.1|localhost)[:/]', 'client: https pages may reach ws://localhost'],
  ['ping_shared', 'client', 'src/net/client.ts', [['  let ping = 0;', '  '], ['const versusWorlds =', 'let ping = 0;\nconst versusWorlds =']], null, "client: an old connection closing late"],
  ['relay_reads_closed', 'relay', 'server/relay.mjs', '    if (closed) return;', '', 'relay: after the relay closes a connection'],
  ['relay_pipe', 'relay', 'server/relay.mjs', 'pipeline(fs.createReadStream(file), res, () => {});', 'fs.createReadStream(file).pipe(res);', 'relay: static files use pipeline'],
  ['reset_side', 'wiring', 'src/main.ts', 'createWorld(s); setViewSide();', 'createWorld(s);', 'wiring: every new battle starts from side 0'],
  ['no_mirror_cam', 'wiring', 'src/main.ts', ' if (SIDE_PLAYER) view.target.set(w.n - view.target.x, 0, w.n - view.target.z);', '', 'wiring: the guest camera'],
  ['versus_saves', 'wiring', 'src/main.ts', ' || netVersus(),', ',', 'wiring: a versus battle is not autosaved'],
  ['menu_vs', 'wiring', 'src/ui/startMenu.ts', "if (v.kind === 'start' && v.net && v.vs) extra.push({ id: 'sm-vs'", "if (v.kind === 'start' && v.net) extra.push({ id: 'sm-vs'", 'wiring: the start menu offers 連線對戰 only'],
];
try {
  for (const [name, group, file, from, to, want] of mutants) {   // from 可以是一串 [舊, 新]（ping_shared），那時 to 不用
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    for (const d of ['src', 'server']) cpSync(join(root, d), join(dir, d), { recursive: true });
    cpSync(join(root, 'tests/versus.mjs'), join(dir, 'tests/versus.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, file);
    let source = readFileSync(path, 'utf8');
    for (const [a, b] of Array.isArray(from) ? from : [[from, to]]) { assert.equal(source.split(a).length, 2, `${name}: unique mutation anchor (${a.slice(0, 40)})`); source = source.replace(a, b); }
    writeFileSync(path, source);
    const r = spawnSync(process.execPath, [join(dir, 'tests/versus.mjs'), group], { encoding: 'utf8', timeout: 120000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(want), `${name}: intended assertion must fail first (wanted "${want}"), got ${first || output.slice(-1500)}`);
    console.log(`OK versus-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`versus: all groups OK, ${mutants.length} isolated mutants rejected`);
