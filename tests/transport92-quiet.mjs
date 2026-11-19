// R092 驗收 4、20；R146 補齊大圖固定步數與生產對照。預設全跑；可指定 small / large / production / negative。
// 小圖照原卡：三版 × 地圖 0、1 × 種子 1–5，至勝負（≤ 36,000 步）。大圖三版各用種子 1：2 跑 3,000 步，3、5 跑 4,000 步。
// 每 50 步與末步比較扣掉 tp 的雜湊，每步檢查佇列；不是牆鐘效能測試。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorld, hashWorld, center, SUB, UNIT_KINDS, ORD_IDLE,
  UK_TANK, UK_HOWITZER, UK_OBSERVER, UK_INFANTRY, UK_ATGUN, UK_ARMORED_CAR, UK_DESTROYER, UK_TRUCK, UK_HALFTRACK } from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { setAi, aiThink } from '../src/sim/ai.ts';
import { aiThink2 } from '../src/sim/ai2.ts';
import { ECO } from '../tools/duel.mjs';

const noTp = w => { const t = w.eco?.tp; if (t) delete w.eco.tp; const h = hashWorld(w); if (t) w.eco.tp = t; return h; };
function quiet(v, map, seed, last = null) {
  const open = tp => { const w = createWorld(seed); step(w, [{ t: 'map', id: map, vegetation: 1, sym: 1, more: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 1, ...(tp ? { tp: 1 } : {}) }, { t: 'ai', side: 0, level: 3, ...(v ? { v } : {}) }, { t: 'ai', side: 1, level: 3, ...(v ? { v } : {}) }]); return w; };
  const a = open(true), b = open(false), tag = `v${v ?? 1} map ${map} seed ${seed}`;
  const startUnits = a.units.length, startNext = a.ai.map(st => st.next);
  const same = () => assert.equal(noTp(a), noTp(b), `quiet: ${tag}: with tp the world is the same as without it at step ${a.tick}`);
  const queues = () => { for (const w of [a, b]) assert(!w.eco.queue.some(q => q.includes(UK_TRUCK) || q.includes(UK_HALFTRACK)), `quiet: ${tag}: the computer never queues a truck or a half-track`); };
  assert.equal(a.eco.tp, 1, `quiet: ${tag} — the world carries tp`);
  same(); queues();
  let fires = 0;
  while (last === null ? a.tick < 36000 && (a.winner < 0 || b.winner < 0) : a.tick < last) {
    const before = a.tick;
    step(a, []); step(b, []);
    assert.equal(a.tick, before + 1, `quiet: ${tag}: the simulation advances every requested step`);
    assert.equal(b.tick, a.tick, `quiet: ${tag}: both worlds advance together`);
    if (a.tick % 50 === 0 || a.winner >= 0 || b.winner >= 0) same();
    queues();
    fires += a.events.filter(e => e.e === 'fire').length;
  }
  same();
  assert.deepEqual([a.winner, a.tick], [b.winner, b.tick], `quiet: ${tag}: same winner, same last step`);
  if (last === null) assert(a.winner >= 0, `quiet: ${tag}: the game finishes within 36,000 steps`);
  else {
    assert.equal(a.tick, last, `quiet: ${tag}: reached the fixed endpoint`);
    assert(a.ai.every((st, i) => st.next > startNext[i]), `quiet: ${tag}: both computers actually think`);
    assert(a.units.length > startUnits, `quiet: ${tag}: the fixed run includes actual production`);
    assert(fires > 0, `quiet: ${tag}: the fixed run includes actual game activity`);
    console.log(`transport92-quiet: ${tag}, tick ${a.tick}, ${a.units.length - startUnits} produced, ${fires} fire events, hash ${noTp(a)}`);
  }
}

// 只比較遊戲內的生產輸出；兩份場面除了玩家車種之外相同，直接走 step 使用的思考接線。
function productionFixture(v, level, kind, memory) {
  const w = createWorld(7);
  step(w, [{ ...ECO, tp: 1 }]);
  w.units = []; w.tick = 100; w.eco.supply = [999, 999]; w.eco.queue = [[], []]; w.eco.prog = [0, 0];
  if (memory) { delete w.eco.guns; delete w.eco.inf; }
  const put = (side, k, x, z) => {
    const def = UNIT_KINDS[k];
    w.units.push({ id: w.units.length + 1, side, kind: k, x: center(x), z: center(z), hp: def.hp, alive: true,
      order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0,
      ...(def.armored ? { hullX: SUB, hullZ: 0 } : {}) });
  };
  const own = memory ? [UK_OBSERVER, UK_TANK, UK_TANK, UK_TANK, UK_HOWITZER, UK_HOWITZER]
    : [UK_OBSERVER, ...Array(10).fill(UK_TANK), UK_INFANTRY, UK_INFANTRY, UK_HOWITZER, UK_HOWITZER];
  own.forEach((k, i) => put(1, k, 5 + i % 8, 5 + Math.floor(i / 8)));
  put(0, kind, 20, 20);
  setAi(w, 1, level, v);
  const st = w.ai[0];
  const think = visible => {
    const see = () => visible, base = aiThink(w, st, see);
    return (v ? aiThink2(w, st, see, base) : base).filter(c => c.t === 'produce');
  };
  const first = think(true);
  // 第二次看不到車；要由第一輪真的留下的裝甲記憶決定，不手工寫 st.armor。
  if (memory) { w.tick += 20; return think(false); }
  return first;
}

function production() {
  let pairs = 0;
  for (const v of [undefined, 2, 3]) for (const level of [2, 3]) for (const memory of [false, true]) {
    const tag = `v${v ?? 1} level ${level} ${memory ? 'remembered' : 'visible'}`;
    const half = productionFixture(v, level, UK_HALFTRACK, memory), car = productionFixture(v, level, UK_ARMORED_CAR, memory);
    assert.deepEqual(half, car, `production: ${tag}: replacing the player's half-track with an armoured car preserves the production decision`);
    assert.deepEqual(car, [{ t: 'produce', side: 1, kind: memory ? UK_DESTROYER : UK_ATGUN }], `production: ${tag}: the control reaches a real armour-sensitive decision`);
    const truck = productionFixture(v, level, UK_TRUCK, memory);
    assert.notDeepEqual(half, truck, `production: ${tag}: an unarmoured control changes that decision`);
    pairs++;
  }
  console.log(`transport92-quiet: ${pairs} production pairs; all three versions preserve visible/remembered armour decisions, with unarmoured controls`);
}

// 子行程載入時改記憶體裡的源碼，不改工作樹、不落地副本。兩個新斷言都必須能抓到相應的壞版本。
function negative() {
  const cases = [
    { name: 'large tp changes supply', group: 'large', file: '/src/sim/step.ts',
      from: 'if (w.eco?.tp) carry92(w,', to: 'if (w.eco?.tp && w.n === 64) w.eco.supply[0]++; if (w.eco?.tp) carry92(w,',
      message: 'quiet: v1 map 2 seed 1: with tp the world is the same as without it' },
    { name: 'half-track loses armour classification', group: 'production', file: '/src/sim/world.ts',
      row: "name: '半履帶車'", from: 'armored: true', to: 'armored: false',
      message: "production: v1 level 2 visible: replacing the player's half-track with an armoured car preserves the production decision" },
  ];
  for (const c of cases) {
    const hook = `import { registerHooks } from 'node:module';
      const c = ${JSON.stringify(c)};
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (!url.endsWith(c.file)) return result;
        const source = typeof result.source === 'string' ? result.source : new TextDecoder().decode(result.source);
        const anchor = c.row ? source.split('\\n').find(line => line.includes(c.row)) : c.from;
        if (!anchor || !anchor.includes(c.from) || source.split(anchor).length !== 2) throw new Error('negative anchor mismatch: ' + c.name);
        return { ...result, source: source.replace(anchor, c.row ? anchor.replace(c.from, c.to) : c.to) };
      } });`;
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(hook)}`, fileURLToPath(import.meta.url), c.group], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, `negative: ${c.name} must fail`);
    assert((result.stdout + result.stderr).includes(c.message), `negative: ${c.name} fails at the intended assertion\n${result.stdout}${result.stderr}`);
    console.log(`transport92-quiet: negative caught — ${c.name}`);
  }
}

const groups = {
  small() { for (const v of [undefined, 2, 3]) for (const map of [0, 1]) for (let seed = 1; seed <= 5; seed++) quiet(v, map, seed); console.log('transport92-quiet: 30 completed games, with tp bit for bit the same as without it (apart from the tp fold)'); },
  large() { for (const v of [undefined, 2, 3]) for (const [map, last] of [[2, 3000], [3, 4000], [5, 4000]]) quiet(v, map, 1, last); },
  production,
  negative,
};
if (process.argv[2]) { assert(Object.hasOwn(groups, process.argv[2]), `unknown group: ${process.argv[2]}`); groups[process.argv[2]](); }
else for (const run of Object.values(groups)) run();
