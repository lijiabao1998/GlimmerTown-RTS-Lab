// R095 步兵排（Node）：src/sim/platoon.ts 與 eco／step／world／commandCheck／worldCodec／ai／ai3 的改動、src/ui/platoon95.ts 的純函式。
// 用法：node tests/platoon95.mjs            全部的群組（故意弄壞在 tests/platoon95-negative.mjs；真的 Chrome 在 tests/platoon95-browser.mjs）
//       node tests/platoon95.mjs <群組名>   只跑那一群
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../src/sim/world.ts';
import { step, formationAt } from '../src/sim/step.ts';
import { isCommand, checkLog } from '../src/sim/commandCheck.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';
import { ECO_POP } from '../src/sim/eco.ts';
import { produce3 } from '../src/sim/ai3.ts';
import * as P from '../src/sim/platoon.ts';
import { countdown95, reason95, progMax95, platoonOf } from '../src/ui/platoon95.ts';
import { duel } from '../tools/duel.mjs';

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const { UK_INFANTRY, UK_TANK, SUB, SIDE_PLAYER, SIDE_ENEMY } = W;
const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 };
// 開局：地圖、（對稱）、eco（帶不帶 pla）
const open = (map = 1, pla = true, sym = false, seed = 1944) => { const w = W.createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, ...(sym ? { sym: 1 } : {}) }, { ...ECO, ...(pla ? { pla: 1 } : {}) }]); return w; };
const alive = (w, side) => w.units.filter(u => u.alive && u.side === side).length;
const sections = (w, side) => w.units.filter(u => u.alive && u.side === side && u.kind === UK_INFANTRY);
const run = (w, n, cmds = []) => { for (let i = 0; i < n; i++) step(w, i === 0 ? cmds : []); return w; };

export const groups = {
  // 旗標：只在有的時候算進雜湊（eco 的 pla、單位的 pl）；檢查不收文字；存檔來回一樣、壞的不收；沒有旗標時買排什麼都不變
  flag() {
    const a = open(1, false), b = open(1, false); a.eco.supply = [200, 200]; b.eco.supply = [200, 200]; step(b, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }]); step(a, []);
    assert.equal(W.hashWorld(b), W.hashWorld(a), 'flag: without the flag ordering a platoon changes nothing');
    const on = open(1, true), off = open(1, false);
    assert(on.eco.pla === 1 && off.eco.pla === undefined && W.hashWorld(on) !== W.hashWorld(off), 'flag: the flag is stored and hashed only when present');
    const c = structuredClone(on); c.eco.pla = 0; delete c.eco.pla;
    assert.notEqual(W.hashWorld(c), W.hashWorld(on), 'flag: the eco pla flag is in the hash');
    const u1 = structuredClone(on), u2 = structuredClone(on); u2.units[u2.units.findIndex(u => u.kind === UK_INFANTRY)].pl = 99;
    assert.notEqual(W.hashWorld(u1), W.hashWorld(u2), 'flag: a unit platoon number is in the hash');
    assert(isCommand({ t: 'eco', inf: 1, pla: 1 }) && !isCommand({ t: 'eco', inf: 1, pla: 'x' }) && checkLog([{ tick: 0, cmd: { t: 'eco', pla: 'x' } }]) !== null, 'flag: the command check takes 1 and refuses text');
    // 存檔
    const w = open(1, true); w.eco.supply = [200, 200]; run(w, 400, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }]);
    step(w, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }]);
    const enc = JSON.parse(JSON.stringify(encodeWorld(w))), back = decodeWorld(enc);
    assert(back && W.hashWorld(back) === W.hashWorld(w) && sections(w, 0).some(u => u.pl) && w.eco.queue[0].includes(P.PLATOON_ITEM), 'flag: a platoon battle round-trips through the save codec');
    // 每一條規則各一個只有它擋得住的壞存檔
    const enc0 = JSON.parse(JSON.stringify(encodeWorld(open(1, false)))), enc1 = JSON.parse(JSON.stringify(encodeWorld(open(1, true))));
    const inf = (x, side) => x.units.filter(u => u.alive && u.kind === UK_INFANTRY && u.side === side), tank = (x, side) => x.units.filter(u => u.alive && u.kind === UK_TANK && u.side === side);
    const bad = [
      ['pla 2', enc1, x => { x.eco.pla = 2; }],
      ['a platoon token without the flag', enc0, x => { x.eco.queue[0] = [P.PLATOON_ITEM]; }],
      ['a platoon number without the flag', enc0, x => { const u = inf(x, 0)[0]; u.pl = u.id; }],
      ['a tank with a platoon number', enc1, x => { const t = { ...tank(x, 0)[0], id: x.units.length + 1 }; x.units.push(t); t.pl = inf(x, 0)[0].id; }],
      ['a platoon number that points at nothing', enc1, x => { inf(x, 0)[0].pl = 0; }],
      ['a platoon number that points forward', enc1, x => { const s0 = inf(x, 0)[0]; const later = x.units.find(u => u.kind === UK_INFANTRY && u.side === 0 && u.id > s0.id) ?? (x.units.push({ ...s0, id: x.units.length + 1 }), x.units[x.units.length - 1]); s0.pl = later.id; }],
      ['a platoon headed by a tank', enc1, x => { const u = inf(x, 0).find(u => tank(x, 0).some(t => t.id < u.id)); u.pl = tank(x, 0).find(t => t.id < u.id).id; }],
      ['a platoon headed by the enemy', enc1, x => { const u = x.units.filter(u => u.kind === UK_INFANTRY).sort((a, b) => b.id - a.id)[0]; const foe = x.units.find(f => f.kind === UK_INFANTRY && f.side !== u.side && f.id < u.id); u.pl = foe.id; }],
    ];
    for (const [name, base, f] of bad) { const x = JSON.parse(JSON.stringify(base)); f(x); assert.equal(decodeWorld(x), null, `flag: the save codec refuses ${name}`); }
    assert(decodeWorld(JSON.parse(JSON.stringify(enc1))) && decodeWorld(JSON.parse(JSON.stringify(enc0))), 'flag: the untouched saves are accepted');
    console.log('  flag: hashed only when present; check and codec refuse bad values');
  },
  // 排：66 補給、300 步、佔一格 → 同一步三班、同一個排號、三個不同的集結格（對稱時鏡像）；人口不夠 3 格時等；單班照常
  platoon() {
    for (const [map, sym] of [[1, false], [2, true]]) {
      const w = open(map, true, sym); w.eco.supply = [200, 200];
      const n0 = w.units.length, s0 = w.eco.supply[0], t0 = w.tick;
      step(w, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }, { t: 'produce', side: 1, kind: P.PLATOON_ITEM }]);
      assert(s0 - w.eco.supply[0] === P.PLATOON_COST && P.PLATOON_COST === 66 && w.eco.queue[0].length === 1 && w.eco.queue[0][0] === P.PLATOON_ITEM, `platoon: one queue slot for 66 supply (map ${map}: spent ${s0 - w.eco.supply[0]})`);
      let born = -1;
      for (let i = 0; i < 400 && born < 0; i++) { step(w, []); if (w.units.length > n0) born = w.tick; }
      const fresh = w.units.slice(n0);
      for (const side of [0, 1]) {
        const mine = fresh.filter(u => u.side === side);
        assert(mine.length === 3 && mine.every(u => u.kind === UK_INFANTRY && u.pl === mine[0].id) && new Set(mine.map(u => `${u.tx},${u.tz}`)).size === 3, `platoon: three sections in one tick share a platoon number and rally on three cells (map ${map}, side ${side})`);
      }
      assert(P.PLATOON_TICKS === 300 && born - t0 === P.PLATOON_TICKS + 1, `platoon: it takes exactly 300 ticks (ordered at ${t0}, born at ${born})`);
      if (sym) {
        const a = fresh.filter(u => u.side === 0), b = fresh.filter(u => u.side === 1);
        const off = us => us.map(u => [u.tx - us[0].tx, u.tz - us[0].tz]);
        const want = side => [0, 1, 2].map(j => (j ? P.FORMATION_PLA[j] : [0, 0]).map(v => (side === SIDE_ENEMY ? 0 - v : v)));
        assert(JSON.stringify(off(a)) === JSON.stringify(want(SIDE_PLAYER)) && JSON.stringify(off(b)) === JSON.stringify(want(SIDE_ENEMY)), `platoon: under symmetry the other side rallies on the mirrored cells (${JSON.stringify(off(a))} / ${JSON.stringify(off(b))})`);
      }
    }
    // 人口不夠 3 格：做好了也等
    const w = open(1, true); w.eco.supply = [500, 0];
    for (const u of w.units) if (u.side === 1) { u.alive = false; u.hp = 0; }   // 沒有人打它：人數只會因為出生而變
    const cap = w.eco.pop; while (alive(w, 0) < cap - 2) { const id = w.units.length + 1; w.units.push({ ...structuredClone(w.units.find(u => u.side === 0 && u.kind === UK_TANK)), id, x: W.center(16), z: W.center(16), path: [], pathIdx: 0, order: W.ORD_IDLE, cooldown: 1e9 }); }
    step(w, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }]);
    run(w, 400);
    assert(alive(w, 0) === cap - 2 && w.eco.queue[0][0] === P.PLATOON_ITEM, `platoon: with fewer than 3 free population slots the platoon waits (${alive(w, 0)}/${cap})`);
    const last = w.units[w.units.length - 1]; last.alive = false; last.hp = 0;   // 空出第 3 格（最後放進去的那一台）：剛好放得下
    run(w, 3);
    assert(alive(w, 0) === cap && !w.eco.queue[0].length, `platoon: with exactly 3 free slots the platoon arrives (${alive(w, 0)}/${cap})`);
    // 單班照常
    const s = open(1, true); s.eco.supply = [200, 0]; const k0 = sections(s, 0).length;
    step(s, [{ t: 'produce', side: 0, kind: UK_INFANTRY }]); run(s, 200);
    assert(sections(s, 0).length === k0 + 1 && sections(s, 0).every(u => !u.pl), 'platoon: a single section still works and has no platoon number');
    console.log('  platoon: 3 sections a platoon, shared number, spread and mirrored rally, waits for population');
  },
  // 讀佇列的地方：佇列 [256, 3] 時倒數、理由、進度條、電腦（第三版、第一版）都不丟錯、數字對
  readers() {
    const w = open(1, true); w.eco.supply = [200, 200];
    step(w, [{ t: 'produce', side: SIDE_PLAYER, kind: P.PLATOON_ITEM }, { t: 'produce', side: SIDE_PLAYER, kind: UK_INFANTRY }]);
    let text, why, max;
    try { text = countdown95(w); why = [reason95(w, P.PLATOON_ITEM), reason95(w, UK_INFANTRY)]; max = progMax95(w.eco.queue[SIDE_PLAYER]); }
    catch (e) { text = `threw ${e.message}`; }
    assert(/^步兵排：製造剩餘 \d+ 遊戲秒 · 後續 1$/.test(text) && max === P.PLATOON_TICKS && why[0] === '' && why[1] === '', `readers: countdown, reason and progress read the platoon token (${text}; ${why}; ${max})`);
    // 做好了在等：人口真的不夠才說要空出 3 格；出口被擋住時跟單一單位一樣只說等待部署
    const full = open(1, true); for (const u of full.units) if (u.side === 1) { u.alive = false; u.hp = 0; }
    const tmpl = full.units.find(u => u.side === 0 && u.kind === UK_TANK);
    while (alive(full, 0) < full.eco.pop - 2) full.units.push({ ...structuredClone(tmpl), id: full.units.length + 1, x: W.center(16), z: W.center(16), cooldown: 1e9 });
    full.eco.queue[0] = [P.PLATOON_ITEM]; full.eco.prog[0] = P.PLATOON_TICKS;
    const room = open(1, true); room.eco.queue[0] = [P.PLATOON_ITEM]; room.eco.prog[0] = P.PLATOON_TICKS;
    assert(countdown95(full) === '步兵排：等待部署（要空出 3 格人口） · 後續 0' && countdown95(room) === '步兵排：等待部署 · 後續 0', `readers: the platoon only blames population when population is the reason (${countdown95(full)} / ${countdown95(room)})`);
    // 電腦（第三版）：佇列裡只有一個排時不丟錯、不再多買一個排
    const m2 = open(2, true); m2.eco.supply = [500, 500];
    for (const u of m2.units) if (u.side === 0 && u.kind === UK_INFANTRY) { u.alive = false; u.hp = 0; }
    const core2 = m2.units.filter(u => u.alive && u.side === 0 && W.UNIT_KINDS[u.kind].armored); for (const u of core2.slice(6)) { u.alive = false; u.hp = 0; }
    const own2 = () => m2.units.filter(u => u.alive && u.side === 0);
    let p0, p1;
    try { p0 = produce3(m2, { side: 0, level: 3, v: 3 }, own2(), []); m2.eco.queue[0] = [P.PLATOON_ITEM]; p1 = produce3(m2, { side: 0, level: 3, v: 3 }, own2(), []); } catch (e) { p1 = `threw ${e.message}`; }
    assert(p0 === P.PLATOON_ITEM && p1 !== P.PLATOON_ITEM && typeof p1 !== 'string', `readers: the third-version computer reads a queued platoon as three sections (${p0}, ${p1})`);
    const ai1 = open(1, true); ai1.eco.supply = [200, 200]; step(ai1, [{ t: 'produce', side: 1, kind: P.PLATOON_ITEM }, { t: 'ai', side: 1, level: 2 }]);
    let ok = true; try { run(ai1, 600); } catch { ok = false; }
    assert(ok, 'readers: the first-version computer runs with a platoon in its queue');
    const off = open(1, false);
    assert.equal(reason95(off, P.PLATOON_ITEM), '這一局沒有步兵排', 'readers: without the flag the platoon button says why');
    console.log(`  readers: ${text}`);
  },
  // 人口上限：有旗標 24／48／64，沒有 16／40／40（64 圖原本 56：手機預算的退路）
  caps() {
    const got = [1, 2, 3].map(m => [open(m, true).eco.pop, open(m, false).eco.pop ?? ECO_POP]);
    assert.deepEqual(got, [[24, 16], [48, 40], [64, 40]], `caps: 24/48/64 with the flag, 16/40/40 without (${JSON.stringify(got)})`);
    console.log('  caps: OK');
  },
  // 隊形：有旗標 25 格互不相同、前 9 格跟沒有旗標一樣、對稱時另一方取負
  formation() {
    const on = open(1, true), off = open(1, false), sym = open(2, true, true);
    const a = Array.from({ length: 25 }, (_, k) => formationAt(on, 0, k)), b = Array.from({ length: 9 }, (_, k) => formationAt(off, 0, k));
    assert(new Set(a.map(p => p.join())).size === 25 && a.slice(0, 9).every((p, i) => p.join() === b[i].join()) && formationAt(on, 0, 25).join() === a[0].join(), 'formation: 25 distinct cells with the flag, the first nine as before');
    assert(Array.from({ length: 25 }, (_, k) => formationAt(sym, SIDE_ENEMY, k)).every((p, k) => p.join() === formationAt(sym, SIDE_PLAYER, k).map(v => 0 - v).join()), 'formation: under symmetry the other side uses the mirrored table');
    console.log('  formation: OK');
  },
  // 全排：選一班 → 同一排活著的班；死的不算；不是排裡的班 → 空；敵方的不算
  select() {
    const w = open(1, true); w.eco.supply = [300, 300];
    step(w, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }, { t: 'produce', side: 1, kind: P.PLATOON_ITEM }]); run(w, 400);
    const pl = sections(w, 0).filter(u => u.pl), single = sections(w, 0).find(u => !u.pl);
    pl[2].alive = false; pl[2].hp = 0;
    assert.deepEqual(platoonOf(w, [pl[1].id]), [pl[0].id, pl[1].id], 'select: one section selects the living sections of its platoon');
    assert.deepEqual(platoonOf(w, [single.id]), [], 'select: a section outside any platoon selects nothing more');
    const foe = sections(w, 1).find(u => u.pl);
    assert.deepEqual(platoonOf(w, [foe.id]), [], 'select: never selects the enemy');
    console.log('  select: OK');
  },
  // 電腦：困難（有旗標）在主力夠了的時候出排；沒有旗標不出；簡單、普通照舊；大地圖真的出得來
  ai() {
    const w = open(2, true), mine = () => w.units.filter(u => u.alive && u.side === 0);
    w.eco.supply = [200, 200];
    for (const u of w.units) if (u.side === 0 && u.kind === UK_INFANTRY) { u.alive = false; u.hp = 0; }
    const hard = produce3(w, { side: 0, level: 3, v: 3 }, mine(), []);
    assert.equal(hard, P.PLATOON_ITEM, `ai: with the flag the hard computer orders a platoon once its core is ready (${hard})`);
    const off = open(2, false); off.eco.supply = [200, 200];
    for (const u of off.units) if (u.side === 0 && u.kind === UK_INFANTRY) { u.alive = false; u.hp = 0; }
    assert.notEqual(produce3(off, { side: 0, level: 3, v: 3 }, off.units.filter(u => u.alive && u.side === 0), []), P.PLATOON_ITEM, 'ai: without the flag the computer never orders a platoon');
    for (const lv of [1, 2]) assert.equal(produce3(w, { side: 0, level: lv, v: 3 }, mine(), []), produce3(off, { side: 0, level: lv, v: 3 }, off.units.filter(u => u.alive && u.side === 0), []), `ai: the ${lv === 1 ? 'easy' : 'normal'} computer orders the same with or without the flag`);
    const core = w.units.filter(u => u.alive && u.side === 0 && W.UNIT_KINDS[u.kind].armored);
    for (const u of core.slice(3)) { u.alive = false; u.hp = 0; }
    assert.notEqual(produce3(w, { side: 0, level: 3, v: 3 }, mine(), []), P.PLATOON_ITEM, 'ai: below four core vehicles there is no platoon');
    // 規則的細節：班數 × 2 要小於主力、最多 6 班、佇列裡的排算 3 班
    const mk = (map, core, secs, queue) => {
      const x = open(map, true); x.eco.supply = [500, 500];
      const t = structuredClone(x.units.find(u => u.side === 0 && u.kind === UK_TANK)), s0 = structuredClone(x.units.find(u => u.side === 0 && u.kind === UK_INFANTRY));
      for (const u of x.units) if (u.side === 0 && u.kind !== W.UK_OBSERVER) { u.alive = false; u.hp = 0; }
      for (let i = 0; i < core; i++) x.units.push({ ...structuredClone(t), id: x.units.length + 1 });
      for (let i = 0; i < secs; i++) x.units.push({ ...structuredClone(s0), id: x.units.length + 1 });
      x.eco.queue[0] = queue;
      let r; try { r = produce3(x, { side: 0, level: 3, v: 3 }, x.units.filter(u => u.alive && u.side === 0), []); } catch (e) { r = `threw ${e.message}`; }
      return r;
    };
    assert.equal(mk(2, 6, 0, []), P.PLATOON_ITEM, 'ai: fixture — six core vehicles and no sections orders a platoon');
    assert.notEqual(mk(2, 4, 2, []), P.PLATOON_ITEM, 'ai: sections × 2 must stay below the core');
    assert.notEqual(mk(2, 20, 6, []), P.PLATOON_ITEM, 'ai: at most six sections');
    const q3 = mk(2, 6, 0, [P.PLATOON_ITEM]);
    assert(q3 !== P.PLATOON_ITEM && typeof q3 !== 'string', `ai: a queued platoon counts as three sections (${q3})`);
    // 小地圖：困難的電腦有沒有旗標都一樣（一局兩分鐘、出排只會輸；卡面的退路）
    const sm = open(1, true), so = open(1, false); sm.eco.supply = so.eco.supply = [500, 500];
    for (const x of [sm, so]) { const t = structuredClone(x.units.find(u => u.side === 0 && u.kind === UK_TANK)); for (let i = 0; i < 6; i++) x.units.push({ ...structuredClone(t), id: x.units.length + 1 }); for (const u of x.units) if (u.side === 0 && u.kind === UK_INFANTRY) { u.alive = false; u.hp = 0; } }
    assert.equal(produce3(sm, { side: 0, level: 3, v: 3 }, sm.units.filter(u => u.alive && u.side === 0), []), produce3(so, { side: 0, level: 3, v: 3 }, so.units.filter(u => u.alive && u.side === 0), []), 'ai: on the small maps the hard computer orders exactly as without the flag');
    const r = duel({ map: 2, seed: 1, ticks: 24000, a: { level: 3, v: 3 }, b: { level: 3, v: 3 }, end: true, mg: 2, pla: true });
    assert(r.infBuilt[0] + r.infBuilt[1] >= 3, `ai: on the 64 map the hard computers really build platoons (${r.infBuilt})`);
    console.log(`  ai: hard orders platoons; 64-map mirror built ${r.infBuilt}`);
  },
  // 買排的門檻與「為什麼不能按」：補給差一點、剛好、佇列滿、指揮部倒了、這一局沒有步兵
  gates() {
    const order = w => { const q = w.eco.queue[0].length; step(w, [{ t: 'produce', side: 0, kind: P.PLATOON_ITEM }]); return w.eco.queue[0].length > q; };
    const lo = open(1, true); lo.eco.supply = [65, 0];
    assert(reason95(lo, P.PLATOON_ITEM) === '補給不足，還差 1' && !order(lo), `gates: 65 supply is one short (${reason95(lo, P.PLATOON_ITEM)})`);
    const ok = open(1, true); ok.eco.supply = [66, 0];
    assert(reason95(ok, P.PLATOON_ITEM) === '' && order(ok), 'gates: 66 supply buys a platoon');
    const fullq = open(1, true); fullq.eco.supply = [999, 0]; fullq.eco.queue[0] = [0, 0, 0, 0, 0];
    assert(reason95(fullq, P.PLATOON_ITEM) === '生產佇列已滿' && !order(fullq), 'gates: a full queue takes no platoon');
    const dead = open(1, true); dead.eco.supply = [999, 0]; dead.blds[dead.eco.hq[0] - 1].hp = 0;
    assert(reason95(dead, P.PLATOON_ITEM) === '指揮部已毀或不存在' && !order(dead), 'gates: no platoon without a headquarters');
    const noinf = W.createWorld(1944); step(noinf, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'eco', guns: 1, tanks: 1, pla: 1 }]); noinf.eco.supply = [999, 0];
    assert(reason95(noinf, P.PLATOON_ITEM) === '這一局沒有步兵排' && !order(noinf), 'gates: a battle without infantry has no platoons');
    console.log('  gates: OK');
  },
  // 接線：新開的局在閥後面送 pla；cdp 預設；讀佇列的地方都經過 platoon.ts
  wiring() {
    const m = src('src/main.ts');
    assert(m.includes('...(V.r095 ? { pla: 1 } : {}), ...(V.r080 ?') && /get r095\(\) \{ return on\('095'\); \}/.test(src('src/valves.ts')), 'wiring: a new battle carries pla behind ?noR095=1');
    assert(src('tools/cdp.mjs').includes('const url = /(^|&)noR095=/.test(url87) ? url87 : `${url87}&noR095=1`;'), 'wiring: tools/cdp.mjs adds noR095=1 unless a guard asks for R095');
    assert(m.includes('progMax: progMax95(q0),') && m.includes('countdown95(w, V.r125)') && m.includes('reason95(w, kind,') && !/UNIT_KINDS\[q0\[0\]\]/.test(m), 'wiring: the production bar reads the queue through platoon95.ts');
    const eco = src('src/sim/eco.ts');
    assert(eco.includes('if (e.prog[side] < ticksOf(q[0]))') && eco.includes('+ popOf(q[0]) > (e.pop ?? ECO_POP)') && !/UNIT_KINDS\[q\[0\]\]/.test(eco), 'wiring: the economy reads the queue through platoon.ts');
    // 生產列有沒有「步兵排」看這一頁的閥（?noR095=1 的頁面整顆不放：既有守衛量每一顆鍵）；有的話藏不藏、全排能不能用看世界的旗標；佇列那一行用短字
    assert(m.includes('cost: UNIT_KINDS[UK_INFANTRY].cost }, ...(V.r095 ? [PLATOON_UI_ITEM] : [])] : [])') && src('src/ui/platoon95.ts').includes('pla = !!s.world.eco?.pla') && src('src/ui/platoon95.ts').includes("if (!s.active || !s.world.eco?.pla) return false;") && !/V\.r095/.test(src('src/ui/platoon95.ts')), 'wiring: the platoon UI follows the world flag, not this page\'s valve');
    assert(src('src/ui/production.ts').includes('(it.short ?? it.label[0])') && /short: '排'/.test(src('src/ui/platoon95.ts')), 'wiring: the queue strip shows a platoon as 排, not 步');
    console.log('  wiring: OK');
  },
};
export const ALL = ['flag', 'platoon', 'readers', 'caps', 'formation', 'select', 'ai', 'gates', 'wiring'];
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const only = process.argv[2];
  for (const g of only ? [only] : ALL) { assert(groups[g], `unknown group ${g}`); const t0 = Date.now(); groups[g](); console.log(`OK platoon95/${g} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  console.log('platoon95: all OK');
}
