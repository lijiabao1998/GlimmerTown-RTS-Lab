// R036 電腦顧車頭守衛：困難的坦克側面或背面對著射程內的集火目標時，先朝目標開一格把車頭轉成正面；普通不會。
// 困難模式種子 34、89（R104 卡住時在 12000 步超時）要打贏不動的玩家。
import { createWorld, center, SUB, UNIT_KINDS, UK_TANK, ORD_IDLE, ORD_MOVE, SIDE_PLAYER, SIDE_ENEMY } from '../src/sim/world.ts';
import { step, spotted } from '../src/sim/step.ts';
import { aiThink, setAi } from '../src/sim/ai.ts';
import { armorPct, ARMOR_FRONT } from '../src/sim/armor.ts';

const fails = [];
function check(ok, name, detail = '') {
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? '　— ' + detail : ''}`);
  if (!ok) fails.push(name);
}
const blank = () => { const w = createWorld(1944); w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.shells = []; return w; };
const add = (w, side, x, z, hullX, hullZ) => {
  const k = UNIT_KINDS[UK_TANK];
  const u = { id: w.units.length + 1, side, kind: UK_TANK, x: center(x), z: center(z), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0, hullX, hullZ };
  w.units.push(u); return u;
};

{ // 1. 側面對著目標：困難先朝目標開一格、開完是正面；普通直接集火、不動
  const scene = level => {
    const w = blank(), me = add(w, SIDE_ENEMY, 10, 10, 0, SUB), foe = add(w, SIDE_PLAYER, 16, 10, -SUB, 0);   // 我方坦克車頭朝南，目標在正東 6 格（射程 9 格內）
    setAi(w, SIDE_ENEMY, level);   // 還沒跑任何一步：先看電腦第一次想會下什麼
    const before = armorPct(me, foe.x, foe.z), c = structuredClone(w), cmds = aiThink(c, c.ai[0], spotted);
    return { w, me, foe, before, cmds };
  };
  const hard = scene(3), normal = scene(2);
  const mv = hard.cmds.find(c => c.t === 'move' && c.ids.includes(hard.me.id));
  check(hard.before > ARMOR_FRONT && mv && mv.x === 11 && mv.z === 10 && !hard.cmds.some(c => c.t === 'attack' && c.ids.includes(hard.me.id)),
    '困難：側面對著射程內的目標時，先朝目標開一格（不是直接開火）', `目標打過來 ${hard.before}%；指令 ${JSON.stringify(hard.cmds)}`);
  const atk = normal.cmds.find(c => c.t === 'attack' && c.ids.includes(normal.me.id));
  check(atk && atk.target === normal.foe.id && !normal.cmds.some(c => c.t === 'move'), '普通：同樣情況直接集火、不轉車頭', `指令 ${JSON.stringify(normal.cmds)}`);
  // 讓困難那一場照常跑：開完那一格，車頭對著目標（目標打過來是正面）
  const w = hard.w, me = hard.me, foe = hard.foe;
  let turned = false;
  for (let i = 0; i < 200 && me.alive && foe.alive; i++) {
    step(w, []);
    if (me.order !== ORD_MOVE && me.pathIdx >= me.path.length && armorPct(me, foe.x, foe.z) === ARMOR_FRONT) { turned = true; break; }
  }
  check(turned, '困難：開完一格以後，目標打過來是正面（75%）', `第 ${w.tick} 步，車體 ${me.hullX},${me.hullZ}；目標打過來 ${armorPct(me, foe.x, foe.z)}%`);
}

{ // 2. R104 卡住的兩局：困難模式種子 34、89，玩家不動，電腦 12000 步內打贏
  for (const seed of [34, 89]) {
    const w = createWorld(seed);
    step(w, [{ t: 'ai', side: SIDE_ENEMY, level: 3 }]);
    while (w.winner < 0 && w.tick < 12000) step(w, []);
    check(w.winner === SIDE_ENEMY, `困難、種子 ${seed}：12000 步內打贏不動的玩家（R104 卡住時超時）`, `勝方 ${w.winner}，第 ${w.tick} 步`);
  }
}

if (fails.length) { console.log(`NG armor-ai：${fails.join('、')}`); process.exit(1); }
console.log('armor-ai: all OK');
