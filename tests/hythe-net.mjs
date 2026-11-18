// R090 海斯（地圖 5）的連線與存檔（卡面驗收 9、10）。連線：真的 Session／Lockstep、假的轉發（0–300 毫秒亂序），合作與對戰各 6,000 步，
// 每一步兩邊的雜湊都一樣、沒有不同步、兩邊的紀錄一樣、紀錄重播到同一個世界。存檔：12,000 步之後 ≤ 200,000 字；第 3,000 步存、讀回、
// 跑到 12,000 跟一路跑下來的雜湊一樣。node tests/hythe-net.mjs <群> 只跑一群（coop、versus、save）。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY, UK_TANK } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { Session } from '../src/net/session.ts';
import { ECO } from '../tools/duel.mjs';

const only = process.argv[2], N = 128, TICKS = 6000;
const SETUP = [{ t: 'map', id: 5, vegetation: 1, sym: 1 }, { t: 'rules', ap: 1, morale: 2 }, { ...ECO, end: 1, mg: 2, pla: 1 }, { t: 'ai', side: SIDE_ENEMY, level: 3, v: 3 }];
const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 一個玩家：真的 Session，假的「遊戲」（同 tests/net-lockstep.mjs）
function player(role, send, versus) {
  const c = { role, w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [], given: 0 };
  c.host = {
    world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase,
    begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; },
    tick: () => { const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = []; step(c.w, now); c.hashes[c.w.tick] = hashWorld(c.w); },
    remake() {}, focus() {},
  };
  c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); else c.given++; c.pending.push(cmd); };
  c.session = new Session(role, c.host, m => send(c, m), versus);
  return c;
}
function pair(seed, versus) {
  const rnd = rngOf(seed), wire = [];
  let now = 0, seq = 0;
  const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + Math.floor(rnd() * 301), seq: seq++, to, m: { ...m, from: from.session.me } }); };
  const a = player('host', send, versus), b = player('join', send, false);
  a.session.receive({ t: 'welcome', you: 0, room: 'TEST', players: 1 });
  b.session.receive({ t: 'welcome', you: 1, room: 'TEST', players: 2 });
  a.session.receive({ t: 'joined', who: 1 });
  a.phase = 'battle'; for (const c of SETUP) a.issue(c); a.host.tick();
  const next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(seed * 3 + 1)], [b, rngOf(seed * 5 + 2)]]);
  const sideOf = c => (versus && c === b ? SIDE_ENEMY : SIDE_PLAYER);   // 對戰：加入的人帶左上那一方
  const advance = until => {
    while (Math.min(a.w.tick, b.w.tick) < until && now < until * 400) {
      now += 10;
      wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
      while (wire.length && wire[0].at <= now) { const x = wire.shift(); x.to.session.receive(x.m); }
      for (const c of [a, b]) {
        if (now < next.get(c) || c.w.tick >= until || !c.session.live() || !c.session.ready(c.w.tick)) continue;
        const r = mine.get(c), side = sideOf(c);
        if (r() < 0.06) { const own = c.w.units.filter(u => u.alive && u.side === side); if (own.length) c.issue({ t: 'move', side, ids: [own[Math.floor(r() * own.length)].id], x: Math.floor(r() * N), z: Math.floor(r() * N) }); }
        if (r() < 0.01) c.issue({ t: 'produce', side, kind: UK_TANK });
        c.host.tick(); next.set(c, now + 50);
      }
    }
  };
  return { a, b, advance };
}
function together(name, versus) {
  const { a, b, advance } = pair(versus ? 23 : 17, versus);
  advance(TICKS);
  assert.equal(a.w.map, 5, `${name}: the game is on map 5`);
  assert(a.w.tick >= TICKS && b.w.tick >= TICKS, `${name}: both players got through ${TICKS} steps (${a.w.tick}, ${b.w.tick})`);
  assert.equal(a.session.ls.desync, -1, `${name}: no desync reported`);
  const differ = []; for (let t = 1; t <= TICKS; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
  assert.deepEqual(differ.slice(0, 5), [], `${name}: after every one of ${TICKS} steps both worlds hash the same`);
  assert(a.given + b.given >= 300, `${name}: the players gave orders (${a.given + b.given})`);
  assert.equal(JSON.stringify(a.log), JSON.stringify(b.log), `${name}: both command logs are the same`);
  assert.equal(hashWorld(runLog(createWorld(a.w.seed), a.log, TICKS)), a.hashes[TICKS], `${name}: the log replays to the same world`);
  console.log(`  ${name}: ${TICKS} steps, ${a.given + b.given} orders, ${a.session.ls.checks} hash checks, no desync`);
}
const run = (name, f) => { if (only && only !== name) return; f(); console.log(`OK hythe-net/${name}`); };
run('coop', () => together('coop', false));
run('versus', () => together('versus', true));
run('save', () => {
  const opening = [...SETUP, { t: 'ai', side: SIDE_PLAYER, level: 3, v: 3 }];
  const straight = createWorld(31); step(straight, opening); while (straight.tick < 12000 && straight.winner < 0) step(straight, []);
  const text = JSON.stringify(encodeWorld(straight));
  assert(text.length <= 200000, `save: a map-5 world after ${straight.tick} steps encodes to ≤ 200,000 characters (${text.length})`);
  const w = createWorld(31); step(w, opening); while (w.tick < 3000 && w.winner < 0) step(w, []);
  const back = decodeWorld(JSON.parse(JSON.stringify(encodeWorld(w))));
  assert(back && hashWorld(back) === hashWorld(w), 'save: saving at step 3,000 and loading gives the same world');
  while (back.tick < straight.tick && back.winner < 0) step(back, []);
  assert.equal(hashWorld(back), hashWorld(straight), `save: the loaded game runs on to step ${straight.tick} with the same hash as the uninterrupted one`);
  console.log(`  save: ${text.length} characters at step ${straight.tick}; save/load at 3,000 continues identically`);
});
console.log('hythe-net: all OK');
