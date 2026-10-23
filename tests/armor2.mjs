// R044 裝甲車、驅逐戰車、突擊砲守衛：剋制關係實戰（雙方對稱擺位、各跑到分出勝負）、速度與視野、沒帶 armor2 不能出、決定性、畫面只讀世界、電腦會出。
// 距離、時間全部從 UNIT_KINDS 推（AGENTS.md 第 3 節第 6 條）；調數值不會誤紅，剋制關係反過來才會紅。
import {
  createWorld, hashWorld, center, cellOf, idx, bldMaxHp, SUB, TICK_HZ, UNIT_KINDS, ORD_IDLE, TER_ROAD, BK_HOUSE, SIDE_PLAYER, SIDE_ENEMY,
  UK_TANK, UK_INFANTRY, UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT,
} from '../src/sim/world.ts';
import { step, runLog, spotted } from '../src/sim/step.ts';
import { BattleView } from '../src/render/battle.ts';
import { productionBlockReason } from '../src/ui/productionBlockReason.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const K = UNIT_KINDS, cells = v => Math.floor(v / SUB);
const blank = () => { const w = createWorld(7); w.ter.fill(0); w.occ.fill(0); w.crater.fill(0); w.blds = []; w.units = []; w.shells = []; w.events = []; return w; };
// 跟出生一樣：車頭朝敵人（R104 車體方向）、砲口朝敵人
const add = (w, side, kind, cx, cz) => {
  const id = w.units.length + 1, f = side === SIDE_PLAYER ? SUB : -SUB;
  w.units.push({ id, side, kind, x: center(cx), z: center(cz), hp: K[kind].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: f, aimZ: 0, ...(K[kind].armored ? { hullX: f, hullZ: 0 } : {}) });
  return w.units[id - 1];
};
const LIMIT = 4 * 60 * TICK_HZ;   // 4 分鐘還分不出勝負＝紅
// 對稱擺位：甲方在 x0、乙方在 x0＋gap，同一排一對一對；各打對面那一台（attack＝true）或都待命自己找目標。回傳勝方是不是「甲」
function fight(a, an, b, bn, gap, attack, swap = false) {
  const w = blank(), x0 = 6, A = [], B = [];
  const sa = swap ? SIDE_ENEMY : SIDE_PLAYER, sb = 1 - sa;
  for (let i = 0; i < Math.max(an, bn); i++) {
    if (i < an) A.push(add(w, sa, a, swap ? x0 + gap : x0, 12 + 3 * i));
    if (i < bn) B.push(add(w, sb, b, swap ? x0 : x0 + gap, 12 + 3 * i));
  }
  const cmds = attack ? [...A.map((u, i) => ({ t: 'attack', side: sa, ids: [u.id], target: B[Math.min(i, bn - 1)].id })), ...B.map((u, i) => ({ t: 'attack', side: sb, ids: [u.id], target: A[Math.min(i, an - 1)].id }))] : [];
  step(w, cmds);
  while (w.winner < 0 && w.tick < LIMIT) step(w, []);
  return { won: w.winner === sa, winner: w.winner, tick: w.tick, a: A.map(u => u.hp), b: B.map(u => u.hp) };
}
const show = r => `第 ${r.tick} 步、甲方剩血 ${r.a.join('/')}、乙方剩血 ${r.b.join('/')}`;

{ // 1. 驅逐戰車 2 台對中坦克 2 台：從驅逐戰車射程外 4 格對開、各打對面那一台，驅逐戰車贏（兩邊陣營都試）
  const gap = cells(K[UK_DESTROYER].range) + 4;
  const r = fight(UK_DESTROYER, 2, UK_TANK, 2, gap, true), s = fight(UK_DESTROYER, 2, UK_TANK, 2, gap, true, true);
  check(r.won && s.won, '驅逐戰車 2 台對中坦克 2 台（對稱擺位、各打對面），驅逐戰車贏', `相距 ${gap} 格；我方是驅逐戰車：${show(r)}；敵方是驅逐戰車：${show(s)}`);
}
{ // 2. 步兵 2 班對驅逐戰車 1 台（步兵射程內 1 格、都待命自己找目標）：步兵贏；同樣擺位換成中坦克，坦克贏（證明是開頂車廂，不是步兵本來就強）
  const gap = cells(K[UK_INFANTRY].range) - 1;
  const r = fight(UK_INFANTRY, 2, UK_DESTROYER, 1, gap, false), s = fight(UK_INFANTRY, 2, UK_DESTROYER, 1, gap, false, true), c = fight(UK_INFANTRY, 2, UK_TANK, 1, gap, false);
  check(r.won && s.won && !c.won, '步兵 2 班對驅逐戰車 1 台（近距離），步兵佔便宜（贏）；同樣擺位對中坦克，步兵輸', `相距 ${gap} 格；對驅逐戰車：${show(r)}；換邊：${show(s)}；對中坦克：${show(c)}`);
}
{ // 3. 突擊砲拆同一棟磚房比中坦克快（同一個距離、同一棟 2×2 兩層磚房、射擊指令）
  const demolish = kind => {
    const w = blank(), gap = cells(Math.min(K[UK_ASSAULT].range, K[UK_TANK].range)) - 2, maxHp = bldMaxHp(BK_HOUSE, 2, 2, 2);
    w.blds.push({ id: 1, kind: BK_HOUSE, x: 14, z: 12, w: 2, d: 2, floors: 2, hp: maxHp, maxHp });
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) w.occ[idx(14 + dx, 12 + dz)] = 1;
    const u = add(w, SIDE_PLAYER, kind, 14 - gap, 12); add(w, SIDE_ENEMY, UK_TANK, 30, 30).cooldown = 1e9;   // 留一台不動的敵人，局不會先結束
    step(w, [{ t: 'fireAt', side: SIDE_PLAYER, ids: [u.id], x: 14, z: 12 }]);
    while (w.blds[0].hp > 0 && w.tick < LIMIT) step(w, []);
    return { ticks: w.blds[0].hp > 0 ? Infinity : w.tick, maxHp };
  };
  const sg = demolish(UK_ASSAULT), m = demolish(UK_TANK);
  check(sg.ticks < m.ticks, '突擊砲拆同一棟磚房比中坦克快', `磚房 ${sg.maxHp} 耐久；突擊砲 ${sg.ticks} 步、中坦克 ${m.ticks} 步`);
}
{ // 4. 裝甲車 30 秒內跑的格數 > 中坦克的 1.4 倍（同一條直路來回跑）；視野比中坦克遠（中坦克視野外 2 格的敵人，裝甲車看得到、中坦克看不到）
  const run = kind => {
    const w = blank(); w.ter.fill(TER_ROAD); const u = add(w, SIDE_PLAYER, kind, 2, 10); add(w, SIDE_ENEMY, UK_TANK, 30, 30).cooldown = 1e9;
    let to = 29, walked = 0;
    while (w.tick < 30 * TICK_HZ) {
      const idle = u.order === ORD_IDLE && u.pathIdx >= u.path.length, x0 = u.x, z0 = u.z;
      if (idle && cellOf(u.x) === to) to = to === 29 ? 2 : 29;
      step(w, idle ? [{ t: 'move', side: SIDE_PLAYER, ids: [u.id], x: to, z: 10 }] : []);
      walked += Math.abs(u.x - x0) + Math.abs(u.z - z0);
    }
    return walked / SUB;
  };
  const car = run(UK_ARMORED_CAR), tank = run(UK_TANK);
  const far = cells(K[UK_TANK].sight) + 2;
  const see = kind => { const w = blank(); add(w, SIDE_PLAYER, kind, 5, 5); add(w, SIDE_ENEMY, UK_TANK, 5 + far, 5); return spotted(w, SIDE_PLAYER, center(5 + far), center(5)); };
  const sc = see(UK_ARMORED_CAR), st = see(UK_TANK);
  check(car > 1.4 * tank && sc && !st, '裝甲車 30 秒內跑的格數 > 中坦克的 1.4 倍；視野比中坦克遠',
    `30 秒：裝甲車 ${car.toFixed(1)} 格、中坦克 ${tank.toFixed(1)} 格（${(car / tank).toFixed(2)} 倍）；${far} 格外的敵人：裝甲車 ${sc ? '看得到' : '看不到'}、中坦克 ${st ? '看得到' : '看不到'}`);
}
{ // 5. 沒帶 armor2 時 produce 新兵種不接（不扣補給），生產列寫「本局未開放」；帶了照價扣、排進佇列；armor2 只在有時折進雜湊
  const NEW = [UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT];
  const start = eco => { const w = createWorld(1944); step(w, [{ t: 'eco', ...eco }]); return w; };
  const off = start({ inf: 1, guns: 1, tanks: 1 }), on = start({ inf: 1, guns: 1, tanks: 1, armor2: 1 });
  const h = [hashWorld(off), hashWorld(on)], bare = structuredClone(on); delete bare.eco.armor2; const h2 = hashWorld(bare);   // 只差 armor2 這一欄
  for (const w of [off, on]) w.eco.supply[0] = 200;
  const why = [off, on].map(w => NEW.map(k => productionBlockReason(w, k) || '可出').join('／'));
  for (const w of [off, on]) step(w, NEW.map(kind => ({ t: 'produce', side: SIDE_PLAYER, kind })));
  const cost = NEW.reduce((s, k) => s + K[k].cost, 0), qOff = off.eco.queue[0].join(','), qOn = on.eco.queue[0].join(','), sOff = off.eco.supply[0], sOn = on.eco.supply[0];
  const blocked = qOff === '' && sOff === 200 && !('armor2' in off.eco) && why[0] === NEW.map(() => '本局未開放此單位').join('／') && why[1] === NEW.map(() => '可出').join('／');
  const taken = qOn === NEW.join(',') && sOn === 200 - cost && on.eco.armor2 === 1;
  check(blocked && taken && h[0] !== h[1] && h2 === h[0], '沒帶 armor2 時 produce 新兵種不接；帶了照價扣；armor2 只在有時折進雜湊',
    `生產列提示：沒帶「${why[0]}」、帶了「${why[1]}」；沒帶：佇列 [${qOff}]、補給 ${sOff}；帶了：佇列 [${qOn}]、補給 200 → ${sOn}（三種共 ${cost}）；雜湊 ${h[0]}／${h[1]}，拿掉 armor2 ${h2}`);
}
{ // 6. 決定性＋畫面：含三種新車的紀錄重跑、JSON 重播、中途深拷貝接著跑相同；畫面邊畫邊跑只讀世界、不多場景物件
  const log = [{ tick: 0, cmd: { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 } }, { tick: 0, cmd: { t: 'ai', side: SIDE_ENEMY, level: 3 } },
    { tick: 30, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_ARMORED_CAR } }, { tick: 400, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_DESTROYER } },
    { tick: 1600, cmd: { t: 'produce', side: SIDE_PLAYER, kind: UK_ASSAULT } }, { tick: 300, cmd: { t: 'move', side: SIDE_PLAYER, ids: [1, 2, 3], x: 18, z: 19 } }].sort((a, b) => a.tick - b.tick);
  const T = 3600;
  const a = hashWorld(runLog(createWorld(1944), log, T)), b = hashWorld(runLog(createWorld(1944), JSON.parse(JSON.stringify(log)), T));
  const half = runLog(createWorld(1944), log, T / 2), copy = structuredClone(half);
  runLog(half, log, T); runLog(copy, log, T);
  const w = createWorld(1944), v = new BattleView(w, true, true, true, true, true, true, true, true, true);
  v.update(0, 0, new Set()); const objs0 = v.scene.children.length;
  let i = 0; const kinds = new Set();
  while (w.tick < T) {
    const now = []; while (i < log.length && log[i].tick <= w.tick) { if (log[i].tick === w.tick) now.push(log[i].cmd); i++; }
    v.snapshot(); step(w, now); v.onEvents(w.events, w.tick / TICK_HZ); v.update(0, w.tick / TICK_HZ, new Set(w.units.map(u => u.id)));
    for (const u of w.units) if (u.alive && u.side === SIDE_PLAYER && u.kind >= UK_ARMORED_CAR) kinds.add(u.kind);
  }
  const objs1 = v.scene.children.length; v.dispose();
  check(a === b && hashWorld(half) === a && hashWorld(copy) === a && hashWorld(w) === a && kinds.size === 3 && objs1 === objs0, '決定性：含三種新車的紀錄重跑、JSON 重播、中途深拷貝相同；畫面只讀世界、不多場景物件',
    `${a}／${b}／${hashWorld(half)}／${hashWorld(copy)}／${hashWorld(w)}；我方出過的新車 ${[...kinds].sort((x, y) => x - y)}；場景物件 ${objs0} → ${objs1}`);
}
{ // 7.（卡面「做什麼」第 4 條）電腦對電腦（普通）10 分鐘內三種新車都出過；簡單照舊一台都不出
  const game = level => {
    const w = createWorld(1944); step(w, [{ t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, { t: 'ai', side: SIDE_PLAYER, level }, { t: 'ai', side: SIDE_ENEMY, level }]);
    const n0 = w.units.length;
    while (w.tick < 10 * 60 * TICK_HZ && w.winner < 0) step(w, []);
    return { made: [UK_ARMORED_CAR, UK_DESTROYER, UK_ASSAULT].map(k => w.units.slice(n0).filter(u => u.kind === k).length), tick: w.tick, winner: w.winner };
  };
  const n = game(2), e = game(1);
  check(n.made.every(c => c >= 1) && e.made.every(c => c === 0), '電腦（普通）10 分鐘內裝甲車、驅逐戰車、突擊砲都出過；簡單一台都不出',
    `普通：裝甲車 ${n.made[0]}、驅逐戰車 ${n.made[1]}、突擊砲 ${n.made[2]}（第 ${n.tick} 步、勝方 ${n.winner}）；簡單：${e.made.join('/')}`);
}
if (fails.length) { console.log(`NG armor2：${fails.join('、')}`); process.exit(1); }
console.log('armor2: all OK');
