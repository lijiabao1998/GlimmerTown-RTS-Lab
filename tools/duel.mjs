// 電腦對電腦的批次對戰（R057）：同一張圖、同一組規則，換種子跑很多局，數誰贏、一局多長。不開瀏覽器，只跑模擬。
// 雙方起手對稱（都沒有布陣的房子），補給與兵種跟遊戲開局送的 eco 指令一樣。
//
// 用法：node tools/duel.mjs [--map 1] [--seeds 1-20] [--ticks 24000] [--rules ap,morale,force=3,income=3]
//                           [--a 3] [--b 3] [--av 2] [--bv 2] [--swap] [--rows]
//   --map    0 村莊、1 萊伊、2 鄉間 64、3 河鎮 96（預設 1）
//   --a/--b  我方（右下）、敵方（左上）的電腦難度 1–3（預設 3）；--av/--bv 電腦的版本（不給＝第一版）
//   --swap   每個種子再跑一局兩邊對調的（a 的設定放到敵方那一側），抵掉出生位置的差別
//   --rows   每一局印一列
// 守衛與卡面的量測直接 import { duel, summarize }。
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { hqAlive } from '../src/sim/eco.ts';

export const ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1 };   // 跟 src/main.ts 開局送的一樣（全部兵種）

// 一局。a＝我方（side 0）、b＝敵方（side 1）的電腦：{ level, v? }。回傳勝負、步數與過程中的統計
export function duel({ map = 1, seed = 1, ticks = 24000, rules = null, a = { level: 3 }, b = { level: 3 } } = {}) {
  const w = createWorld(seed), ai = (side, s) => ({ t: 'ai', side, level: s.level, ...(s.v ? { v: s.v } : {}) });
  const first = [{ t: 'map', id: map, vegetation: 1 }, ...(rules ? [{ t: 'rules', ...rules }] : []), ECO, ai(SIDE_ENEMY, b), ai(SIDE_PLAYER, a)];
  const stat = { fires: [0, 0], kills: [0, 0], bounces: 0, morale: [0, 0, 0, 0], routs: 0, firstContact: -1 };
  let routing = new Set();
  step(w, first);
  while (w.winner < 0 && w.tick < ticks) {
    step(w, []);
    for (const e of w.events) {
      if (e.e === 'fire') { const u = w.units[e.unit - 1]; if (u && u.side < 2) stat.fires[u.side]++; if (stat.firstContact < 0) stat.firstContact = w.tick; }
      else if (e.e === 'kill') { const u = w.units[e.unit - 1]; if (u && u.side < 2) stat.kills[1 - u.side]++; }
      else if (e.e === 'impact' && e.bounce) stat.bounces++;
      else if (e.e === 'morale') stat.morale[e.state]++;
    }
    if (w.rules?.morale) { const now = new Set(); for (const u of w.units) if (u.alive && u.rout) { now.add(u.id); if (!routing.has(u.id)) stat.routs++; } routing = now; }
  }
  const alive = side => w.units.filter(u => u.alive && u.side === side).length;
  // hqDown：到步數上限還沒宣布勝負、但有一方的指揮部其實已經倒了（勝負判定在等還在飛的砲彈；砲多的大地圖上天上幾乎隨時有砲彈）
  const hqDown = w.winner < 0 && !!w.eco && (!hqAlive(w, 0) || !hqAlive(w, 1));
  return { seed, map, winner: w.winner, ticks: w.tick, alive: [alive(0), alive(1)], hash: hashWorld(w), hqDown, ...stat };
}

const median = xs => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };
// 一批的結果：a 贏幾局、b 贏幾局、平手、打不完（到步數上限；hqDown＝其中指揮部已經倒了、只是遊戲還沒宣布的）、分出勝負的那些局多長
export function summarize(rows) {
  const n = rows.length, aWins = rows.filter(r => r.winnerIs === 'a').length, bWins = rows.filter(r => r.winnerIs === 'b').length;
  const draws = rows.filter(r => r.winnerIs === 'draw').length, timeouts = rows.filter(r => r.winnerIs === 'timeout').length;
  const done = rows.filter(r => r.winnerIs === 'a' || r.winnerIs === 'b').map(r => r.ticks), sum = k => rows.reduce((s, r) => s + k(r), 0);
  return { n, aWins, bWins, draws, timeouts, hqDown: rows.filter(r => r.hqDown).length, aShare: aWins + bWins ? Math.round((aWins * 100) / (aWins + bWins)) : null,
    medianSeconds: Math.round(median(done) / 20), shortestSeconds: done.length ? Math.round(Math.min(...done) / 20) : 0, longestSeconds: done.length ? Math.round(Math.max(...done) / 20) : 0,
    bounces: sum(r => r.bounces), morale: [1, 2, 3].map(i => sum(r => r.morale[i])), routs: sum(r => r.routs) };
}
// 一批：每個種子一局；swap 再加一局兩邊對調的（a 的設定放到敵方那一側）
export function batch({ seeds, swap = false, a, b, ...rest }) {
  const rows = [];
  for (const seed of seeds) {
    const r = duel({ ...rest, seed, a, b });
    rows.push({ ...r, swapped: false, winnerIs: r.winner === SIDE_PLAYER ? 'a' : r.winner === SIDE_ENEMY ? 'b' : r.winner === 2 ? 'draw' : 'timeout' });
    if (swap) { const s = duel({ ...rest, seed, a: b, b: a }); rows.push({ ...s, swapped: true, winnerIs: s.winner === SIDE_ENEMY ? 'a' : s.winner === SIDE_PLAYER ? 'b' : s.winner === 2 ? 'draw' : 'timeout' }); }
  }
  return rows;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
  const has = name => process.argv.includes(`--${name}`);
  const [lo, hi] = String(arg('seeds', '1-10')).split('-').map(Number), seeds = Array.from({ length: (hi ?? lo) - lo + 1 }, (_, i) => lo + i);
  const rules = arg('rules', '') ? Object.fromEntries(String(arg('rules')).split(',').map(p => { const [k, v] = p.split('='); return [k, v === undefined ? 1 : Number(v)]; })) : null;
  const side = (lv, v) => ({ level: Number(arg(lv, 3)), ...(arg(v, '') ? { v: Number(arg(v)) } : {}) });
  const t0 = Date.now(), rows = batch({ seeds, swap: has('swap'), map: Number(arg('map', 1)), ticks: Number(arg('ticks', 24000)), rules, a: side('a', 'av'), b: side('b', 'bv') });
  const ab = (r, pair) => (r.swapped ? [pair[1], pair[0]] : pair).join('／');   // 對調的那一局 a 在敵方那一側：照 a／b 的順序印，不照左右
  if (has('rows')) for (const r of rows) console.log(`seed ${r.seed}${r.swapped ? ' 對調' : ''}：${r.winnerIs} ${Math.round(r.ticks / 20)} 秒${r.hqDown ? '（指揮部已倒、遊戲還沒宣布）' : ''}，剩（a／b）${ab(r, r.alive)}，擊毀（a／b）${ab(r, r.kills)}，跳彈 ${r.bounces}，壓制 ${r.morale.slice(1).join('／')}，潰退 ${r.routs}`);
  console.log(JSON.stringify({ map: Number(arg('map', 1)), rules, a: side('a', 'av'), b: side('b', 'bv'), ...summarize(rows), wallSeconds: Math.round((Date.now() - t0) / 1000) }));
}
