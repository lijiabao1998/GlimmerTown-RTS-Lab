// R010 戰報守衛（Node）：一場會打完的固定紀錄，戰報的每個數字對得上世界與事件；戰報不改世界、算兩次相同；慢動作的倍率與時長。
import { createWorld, hashWorld, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog } from '../src/sim/step.ts';
import { newStats, statsStep, makeReport, slowmoFactor } from '../src/ui/report.ts';
import { endgameLog } from '../tools/endgame.mjs';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const { log, endTick, winner } = endgameLog();
// 照紀錄一步一步跑，戰報統計吃每一步的事件；另外自己數一份當標準答案（不拿受測的東西當答案）
const w = createWorld(1944), st = newStats(w), fires = [0, 0];
let i = 0, firstWin = -1;
while (w.tick < endTick + 40) {
  const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; }
  step(w, now); statsStep(st, w, w.events);
  for (const e of w.events) if (e.e === 'fire') fires[w.units[e.unit - 1].side]++;
  if (w.winner >= 0 && firstWin < 0) firstWin = w.tick;
}
{
  const h0 = hashWorld(w), r = makeReport(w, st), r2 = makeReport(w, st);
  const alive = side => [0, 1, 2, 3].map(k => w.units.filter(u => u.side === side && u.kind === k && u.alive).length);
  const dead = side => w.units.filter(u => u.side === side && !u.alive).length;
  const ok = r.winner === w.winner && JSON.stringify(r.left) === JSON.stringify([alive(SIDE_PLAYER), alive(SIDE_ENEMY)])
    && r.kills === dead(SIDE_ENEMY) && r.lost === dead(SIDE_PLAYER) && r.rubble === w.blds.filter(b => b.hp === 0).length
    && JSON.stringify(r.fires) === JSON.stringify(fires) && r.endTick === firstWin && r.endTick === endTick && r.seconds === Math.floor(endTick / 20) && !!r.lastKill;
  check(winner >= 0 && ok, '戰報的勝方、剩下台數、擊毀、損失、瓦礫、開火數、戰鬥時間都對得上世界與事件',
    `勝方 ${r.winner}、第 ${r.endTick} 步（${r.seconds} 秒）；剩下 ${JSON.stringify(r.left)}；擊毀 ${r.kills}、損失 ${r.lost}；瓦礫 ${r.rubble}、空殼 ${r.roofless}；開火 ${r.fires}（自己數 ${fires}）`);
  check(hashWorld(w) === h0 && JSON.stringify(r) === JSON.stringify(r2), '戰報不改世界、同一局算兩次結果相同');
  const replay = runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), endTick + 40);
  check(hashWorld(replay) === hashWorld(w), '一步一步跑（有戰報統計）與直接重播，世界雜湊相同', `${hashWorld(w)} / ${hashWorld(replay)}`);
}
{ // 慢動作：照 main.ts 的迴圈積分（每幀 1/60 秒），勝負出現後 2.5 秒內推進 0.25 倍，之後恢復
  let acc = 0, ticks = 0, after = 0;
  for (let f = 0; f < 60 * 4; f++) {
    const ms = (f * 1000) / 60;
    acc += (1 / 60) * slowmoFactor(ms);
    while (acc >= 1 / 20) { acc -= 1 / 20; if (ms < 2500) ticks++; else after++; }
  }
  const want = 2.5 * 20 * 0.25;   // 卡面寫的 0.25 倍、2.5 秒（不拿受測的常數當答案）
  check(Math.abs(ticks - want) <= want * 0.1 && after >= 0.9 * 1.5 * 20 && slowmoFactor(-1) === 1, '慢動作：勝負後 2.5 秒內 0.25 倍（±10%），之後恢復正常',
    `2.5 秒內 ${ticks} 步（應為 ${want}），之後 1.5 秒 ${after} 步`);
}

if (fails.length) { console.log(`NG report：${fails.join('、')}`); process.exit(1); }
console.log('report: all OK');
