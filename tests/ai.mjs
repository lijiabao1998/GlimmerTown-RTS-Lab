// R018 電腦對手守衛：會主動進攻並打贏不動的玩家、不偷看迷霧、普通以上集火、決定性、不抽 World.rng、難度有差。
import { createWorld, hashWorld, SUB, UK_TANK, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { aiThink, setAi } from '../src/sim/ai.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const corner = 26.5 * SUB;   // 我方出生角落中心
const tankDist = w => { const t = w.units.filter(u => u.side === SIDE_ENEMY && u.alive && u.kind === UK_TANK); if (!t.length) return Infinity; const x = t.reduce((s, u) => s + u.x, 0) / t.length, z = t.reduce((s, u) => s + u.z, 0) / t.length; return Math.hypot(x - corner, z - corner) / SUB; };
// 玩家什麼都不下，敵方由電腦指揮；每次電腦要想的時候，先在世界的複本上看它會下什麼（檢查不偷看、集火、不抽亂數）
function play(seed, level, cap = 12000, audit = false) {
  const w = createWorld(seed);
  step(w, [{ t: 'ai', side: SIDE_ENEMY, level }]);
  const a = { d0: tankDist(w), d60: Infinity, fires: 0, peeks: 0, attacks: 0, splitFocus: 0, rngTouched: 0 };
  while (w.winner < 0 && w.tick < cap) {
    const st = w.ai[0];
    if (audit && w.tick >= st.next) {
      const c = structuredClone(w), rng0 = c.rng, cmds = aiThink(c, c.ai[0], spotted);
      if (c.rng !== rng0) a.rngTouched++;
      const tankTargets = new Set();
      for (const cmd of cmds) if (cmd.t === 'attack') {
        a.attacks++;
        const t = c.units[cmd.target - 1];
        if (!spotted(c, SIDE_ENEMY, t.x, t.z)) a.peeks++;
        if (cmd.ids.some(id => c.units[id - 1].kind === UK_TANK)) tankTargets.add(cmd.target);
      }
      if (tankTargets.size > 1) a.splitFocus++;
    }
    step(w, []);
    for (const e of w.events) if (e.e === 'fire' && w.units[e.unit - 1].side === SIDE_ENEMY) a.fires++;
    if (w.tick <= 1200) a.d60 = Math.min(a.d60, tankDist(w));   // 60 秒內（或勝負前）敵方坦克重心最靠近我方角落的距離（沒有坦克活著＝不算）
  }
  return { w, a };
}
{ // 1. 主動進攻、打贏不動的玩家（種子 1944，普通）
  const { w, a } = play(1944, 2, 12000, true);
  check(Number.isFinite(a.d60) && a.d0 - a.d60 >= 6 && a.fires > 0 && w.winner === SIDE_ENEMY, '普通：60 秒內敵方坦克往我方推進 6 格以上、有開火、10 分鐘內打贏不動的玩家',
    `坦克重心離我方角落 ${a.d0.toFixed(1)} → 最近 ${a.d60.toFixed(1)} 格；開火 ${a.fires}；勝方 ${w.winner}（第 ${w.tick} 步）`);
  // 2. 不偷看、集火、不抽亂數（同一場）
  check(a.attacks > 0 && a.peeks === 0, '不偷看：每一次攻擊指令的目標，當下都是電腦這一方看得到的', `攻擊指令 ${a.attacks} 次、看不到的目標 ${a.peeks} 次`);
  check(a.splitFocus === 0, '普通集火：同一次想的時候，坦克的攻擊目標只有一個', `分散 ${a.splitFocus} 次`);
  check(a.rngTouched === 0, '電腦想的時候不抽 World.rng', `動到 ${a.rngTouched} 次`);
}
{ // 2b. 集火 vs 各打各的：兩輛電腦坦克各自最近的目標不同（我方兩輛一樣血），普通打同一個、簡單各打各的
  const scene = level => {
    const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.shells = [];
    for (const u of w.units) u.alive = false;
    const put = (u, cx, cz) => { u.alive = true; u.hp = 100; u.x = (cx + 0.5) * SUB; u.z = (cz + 0.5) * SUB; u.order = 0; u.path = []; u.pathIdx = 0; };
    const [p1, p2] = w.units.filter(u => u.side === SIDE_PLAYER && u.kind === UK_TANK), [e1, e2] = w.units.filter(u => u.side === SIDE_ENEMY && u.kind === UK_TANK);
    put(e1, 10, 8); put(e2, 10, 16); put(p1, 14, 8); put(p2, 14, 16);
    setAi(w, SIDE_ENEMY, level);   // 直接設定（不先走一步：走一步時電腦已經想過、下過攻擊）
    const c = structuredClone(w), cmds = aiThink(c, c.ai[0], spotted), targets = new Set();
    for (const cmd of cmds) if (cmd.t === 'attack') targets.add(cmd.target);
    return targets.size;
  };
  const normal = scene(2), easy = scene(1);
  check(normal === 1 && easy === 2, '集火：最近目標不同時，普通兩輛打同一個、簡單各打各的', `普通 ${normal} 個目標、簡單 ${easy} 個目標`);
}
{ // 3. 決定性：含 ai 指令的紀錄跑兩次相同、JSON 來回相同、中途深拷貝接著跑相同；沒有 ai 指令的舊紀錄跟原本一樣
  const log = [{ tick: 0, cmd: { t: 'ai', side: SIDE_ENEMY, level: 3 } }, { tick: 0, cmd: { t: 'move', side: 0, ids: [1, 2, 3], x: 18, z: 19 } }, { tick: 300, cmd: { t: 'fireAt', side: 0, ids: [4], x: 10, z: 10 } }];
  const a = hashWorld(runLog(createWorld(1944), log, 2000)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), 2000));
  const half = runLog(createWorld(1944), log, 1000), copy = structuredClone(half);
  runLog(half, log, 2000); runLog(copy, log, 2000);
  const noAi = runLog(createWorld(1944), log.slice(1), 2000);
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && !noAi.ai && hashWorld(noAi) !== a, '決定性：含電腦的紀錄重跑、JSON 重播、中途深拷貝相同；沒有 ai 指令就沒有電腦',
    `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}`);
}
{ // 4. 難度有差：12 個種子、玩家不動，困難贏的局數 ≥ 普通 ≥ 簡單，而且困難 > 簡單
  const seeds = [1944, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  const wins = [1, 2, 3].map(lv => seeds.filter(s => play(s, lv).w.winner === SIDE_ENEMY).length);
  check(wins[2] >= wins[1] && wins[1] >= wins[0] && wins[2] > wins[0], '難度有差：12 個種子裡困難 ≥ 普通 ≥ 簡單、困難 > 簡單（玩家不動時電腦贏的局數）', `簡單 ${wins[0]}、普通 ${wins[1]}、困難 ${wins[2]}`);
}

if (fails.length) { console.log(`NG ai：${fails.join('、')}`); process.exit(1); }
console.log('ai: all OK');
