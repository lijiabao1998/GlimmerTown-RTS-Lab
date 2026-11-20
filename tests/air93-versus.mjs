// R1003（R093 補驗）：對戰版的鎖步。兩個玩家用真的 Session、Lockstep：房主開「連線對戰」，加入的人是第 1 方；萊伊左右對稱、eco 帶 air、不叫電腦。
// 網路照 tests/air93.mjs 的 net 群：每個包隨機延遲 0–300 毫秒、亂序送達。兩邊各自造防空砲、叫自己這一方的飛機；第 0 方只叫偵察；
// 第 1 方另外偶爾偽造第 0 方的指令：俯衝轟炸第 0 方自己的指揮部（看得到、第 0 方不花補給所以常常付得起），和生產第 0 方從來不造的輕坦克。
// 對戰的鎖步只收自己那一方的指令，所以整局第 0 方不該有任何俯衝轟炸的飛機、任何輕坦克（守衛弄壞過濾就會紅：卡面施工紀錄）。卡面驗收 1。
// 用法：node tests/air93-versus.mjs
import assert from 'node:assert/strict';
import { createWorld, hashWorld, UK_AA, UK_INFANTRY, UK_LIGHT } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { STRIKE93, RECON93 } from '../src/sim/air93.ts';
import { Session } from '../src/net/session.ts';
import { ECO } from '../tools/duel.mjs';

const rngOf = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const N = 32, TICKS = 3000;
const player = (role, send) => {
  const c = { w: createWorld(1944), log: [], pending: [], phase: 'build', hashes: [], strikes0: 0, planes: [0, 0] };
  c.host = { world: () => c.w, log: () => c.log, hash: () => hashWorld(c.w), phase: () => c.phase, begin: s => { c.w = createWorld(s); c.log = []; c.pending = []; c.phase = 'battle'; },
    tick: () => {
      const now = c.session.feed(c.w, c.pending) ?? c.pending; c.pending = []; step(c.w, now); c.hashes[c.w.tick] = hashWorld(c.w);
      for (const p of c.w.sky?.planes ?? []) { c.planes[p.side] |= 1; if (p.side === 0 && p.kind === STRIKE93) c.strikes0++; }
    }, remake() {}, focus() {} };
  c.issue = cmd => { if (!c.session.live()) c.log.push({ tick: c.w.tick, cmd }); c.pending.push(cmd); };
  c.session = new Session(role, c.host, m => send(c, m), role === 'host'); return c;
};
const rnd = rngOf(1003), wire = []; let now = 0, seq = 0;
const send = (from, m) => { const to = from === a ? b : a; wire.push({ at: now + Math.floor(rnd() * 301), seq: seq++, to, m: { ...m, from: from.session.me } }); };
const a = player('host', send), b = player('join', send);
a.session.receive({ t: 'welcome', you: 0, room: 'R1003', players: 1 }); b.session.receive({ t: 'welcome', you: 1, room: 'R1003', players: 2 }); a.session.receive({ t: 'joined', who: 1 });
a.phase = 'battle'; for (const c of [{ t: 'map', id: 1, vegetation: 1, sym: 1 }, { ...ECO, air: 1 }]) a.issue(c); a.host.tick();
const next = new Map([[a, 0], [b, 0]]), mine = new Map([[a, rngOf(7)], [b, rngOf(11)]]), me = new Map([[a, 0], [b, 1]]);
let calls = [0, 0], forged = 0;
while (Math.min(a.w.tick, b.w.tick) < TICKS && now < TICKS * 400) {
  now += 10; wire.sort((x, y) => x.at - y.at || x.seq - y.seq);
  while (wire.length && wire[0].at <= now) { const x = wire.shift(); x.to.session.receive(x.m); }
  for (const c of [a, b]) {
    if (now < next.get(c) || c.w.tick >= TICKS || !c.session.live() || !c.session.ready(c.w.tick)) continue;
    const r = mine.get(c), side = me.get(c);
    if (side === 1 && r() < 0.02) c.issue({ t: 'produce', side, kind: r() < 0.5 ? UK_AA : UK_INFANTRY });   // 第 0 方不造兵（補給留著，偽造的轟炸、生產付得起）
    if (r() < 0.03) { c.issue({ t: 'air', side, kind: side === 0 ? RECON93 : r() < 0.5 ? STRIKE93 : RECON93, x: Math.floor(r() * N), z: Math.floor(r() * N) }); calls[side]++; }
    if (side === 1 && r() < 0.03) { const hq = c.w.blds[c.w.eco.hq[0] - 1]; c.issue(r() < 0.5 ? { t: 'air', side: 0, kind: STRIKE93, x: hq.x, z: hq.z } : { t: 'produce', side: 0, kind: UK_LIGHT }); forged++; }   // 偽造對方的轟炸（打它自己的指揮部）、生產
    c.host.tick(); next.set(c, now + 50);
  }
}
assert(a.session.versus && b.session.versus, 'versus: both sessions are in versus mode');
assert(a.w.tick >= TICKS && b.w.tick >= TICKS && a.session.ls.desync === -1 && b.session.ls.desync === -1, `versus: both players got through ${TICKS} steps with no desync`);
const differ = []; for (let t = 1; t <= TICKS; t++) if (a.hashes[t] !== b.hashes[t]) differ.push(t);
assert.deepEqual(differ.slice(0, 3), [], 'versus: after every step both worlds hash the same');
assert(calls[0] > 0 && calls[1] > 0 && a.planes[0] && a.planes[1], `versus: both sides called planes and both sides' planes flew (${calls})`);
assert(forged > 0 && a.strikes0 === 0 && b.strikes0 === 0 && !a.w.units.some(u => u.side === 0 && u.kind === UK_LIGHT), `versus: ${forged} forged orders for the other side never took effect (side 0 never had a dive bomber or a light tank)`);
assert(JSON.stringify(a.log) === JSON.stringify(b.log) && hashWorld(runLog(createWorld(a.w.seed), a.log, TICKS)) === a.hashes[TICKS], 'versus: both logs are the same and replay to the same world');
console.log(`air93-versus: ${TICKS} steps, calls ${calls}, ${forged} forged orders dropped, planes both sides, no desync`);
