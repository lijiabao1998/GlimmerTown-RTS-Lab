// R055 地勢與視線（第一段）：不開瀏覽器的部分。沒有高度表的世界不受影響、稜線擋視線、台地的死角、站得高看得遠、
// 直射要看得到才打得到（攻擊指令會翻上稜線）、間接射擊越過稜線、房子照舊擋、雜湊與存檔。
// 用法：node tests/terrain.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/terrain.mjs <群組名>   只跑那一群（隔離副本裡用）
// 新地圖本身在 tests/hill-map.mjs；真實 Chrome 在 tests/terrain-browser.mjs。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellOf, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY, BK_HOUSE,
  UK_TANK, UK_OBSERVER, UK_INFANTRY, UK_HOWITZER, UK_ZOMBIE } from '../src/sim/world.ts';
import { step, spotted, lineCells, ridge } from '../src/sim/step.ts';
import { ridgeBlocks, highSight, heightAt, HEIGHT_MAX, HIGH_SIGHT_MAX } from '../src/sim/terrain.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';

assert.deepEqual([HEIGHT_MAX, HIGH_SIGHT_MAX], [3, 2], 'fixture: the numbers on the card are the numbers in src/sim/terrain.ts');
const ME = SIDE_PLAYER, FOE = SIDE_ENEMY;
// 一片空地，高度照 paint(x, z)；paint 不給＝沒有高度表的世界
function field(paint) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = [];
  if (paint) { w.height = new Uint8Array(w.n * w.n); for (let z = 0; z < w.n; z++) for (let x = 0; x < w.n; x++) w.height[cellIdx(w, x, z)] = paint(x, z); }
  return w;
}
function put(w, side, kind, cx, cz, ready = false) {
  const k = UNIT_KINDS[kind];
  const u = { id: w.units.length + 1, side, kind, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: ready ? 0 : 1e9, aimX: SUB, aimZ: 0, ...(k.armored ? { hullX: SUB, hullZ: 0 } : {}) };
  w.units.push(u);
  return u;
}
const house = (w, x, z) => { const b = { id: w.blds.length + 1, kind: BK_HOUSE, x, z, w: 1, d: 1, floors: 1, hp: 400, maxHp: 400 }; w.blds.push(b); w.occ[cellIdx(w, x, z)] = b.id; return b; };
const sees = (w, side, cx, cz) => spotted(w, side, center(cx), center(cz));
// 跑 n 步，回傳 unit 開火的次數；check(unit) 每次開火的那一步呼叫
function fires(w, unit, n, cmds = [], check = () => {}) {
  let count = 0;
  for (let i = 0; i < n; i++) { step(w, i === 0 ? cmds : []); const f = w.events.filter(e => e.e === 'fire' && e.unit === unit.id).length; if (f) check(unit); count += f; }
  return count;
}
// 一道南北向的稜線：x＝15、16 兩階，x＝14、17 一階，其餘平地
const RIDGE = x => (x === 15 || x === 16 ? 2 : x === 14 || x === 17 ? 1 : 0);
// 一片高台：x ≤ 10 三階，其餘平地
const PLATEAU = x => (x <= 10 ? 3 : 0);
// 一列高度（z＝0 那一排）：直接問函式
const row = heights => { const w = field((x, z) => (z === 0 ? heights[x] ?? 0 : 0)); return ridgeBlocks(w, lineCells(0, 0, heights.length - 1, 0, w.n)); };

const groups = {
  // 沒有高度表的世界：規則不介入；舊地圖與黃金雜湊不變
  none() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'none: the golden script battle is unchanged');
    const now = [0, 1, 2, 3].map(id => { const w = createWorld(1944); step(w, [{ t: 'map', id, vegetation: 1 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1, mg: 1 }]); assert.equal(w.height, undefined, `none: map ${id} has no height table`); return hashWorld(w); });
    assert.deepEqual(now, ['ef1e35f9', '8c804e82', '728ac490', '64c27e83'], 'none: the four older maps open bit for bit as they did before this card');
    const w = field(null);
    assert.equal(w.height, undefined, 'fixture: a world without a height table');
    assert.deepEqual([ridgeBlocks(w, lineCells(2, 2, 20, 9, w.n)), highSight(w, center(2), center(2), center(20), center(9)), heightAt(w, 5, 5), ridge(w, center(2), center(2), center(20), center(9))], [false, 0, 0, false], 'none: without a height table nothing is blocked and nothing is added');
  },
  // 稜線：平地看得到、背後看不到、站上去兩邊都看得到；兩個方向一樣
  ridge() {
    { const w = field(RIDGE); put(w, ME, UK_OBSERVER, 10, 16);
      assert(sees(w, ME, 13, 16) && sees(w, ME, 15, 16), 'ridge: the ground in front and the crest itself are seen');
      assert(!sees(w, ME, 18, 16) && !sees(w, ME, 22, 16), 'ridge: the far side of a ridge is hidden'); }
    { const w = field(RIDGE); put(w, ME, UK_OBSERVER, 15, 16);
      assert(sees(w, ME, 22, 16) && sees(w, ME, 9, 16), 'ridge: from the crest both sides are seen'); }
    { const w = field(RIDGE);
      for (const [ax, az, bx, bz] of [[10, 16, 22, 16], [10, 12, 22, 20], [15, 16, 22, 16], [11, 5, 13, 28], [3, 3, 28, 30]]) {
        const there = ridgeBlocks(w, lineCells(ax, az, bx, bz, w.n)), back = ridgeBlocks(w, lineCells(bx, bz, ax, az, w.n));
        assert.equal(there, back, `ridge: what blocks ${ax},${az} from ${bx},${bz} blocks the other way too`);
      } }
    assert.equal(row([0, 1, 1]), false, 'ridge: a unit at the top of a one-level step is seen from below');
    assert.equal(row([0, 0, 0, 0]), false, 'fixture: flat ground never blocks');
    assert.equal(row([2, 2, 2, 2, 2]), false, 'fixture: nor does a level plateau');
    assert.equal(row([0, 1, 0]), true, 'fixture: one cell of higher ground between two units on the flat blocks');
  },
  // 死角：站在高台中間看不到坡腳；站到邊上看得到
  dead() {
    { const w = field(PLATEAU); put(w, ME, UK_OBSERVER, 6, 16);
      assert(!sees(w, ME, 12, 16) && !sees(w, ME, 20, 16), 'dead: from the middle of a plateau the ground below its edge is hidden'); }
    { const w = field(PLATEAU); put(w, ME, UK_OBSERVER, 10, 16);
      assert(sees(w, ME, 12, 16) && sees(w, ME, 20, 16), 'dead: from the edge itself the foot of the slope and beyond are seen'); }
    assert.equal(row([1, 1, 0]), false, 'dead: one cell back from a one-level edge the cell below is still seen');
    assert.equal(row([1, 1, 1, 0]), true, 'fixture: two cells back it is not');
  },
  // 站得高看得遠：每高一階多一格，最多兩格；往高處看沒有加成
  high() {
    const reach = (hObserver, hTarget = 0) => { const w = field(x => (x <= 5 ? hObserver : hTarget)); put(w, ME, UK_OBSERVER, 5, 16); let far = 0; for (let x = 6; x < 32; x++) if (sees(w, ME, x, 16)) far = x - 5; return far; };
    assert.equal(reach(0), 14, 'fixture: on the flat an observer sees fourteen cells');
    assert.equal(reach(1), 15, 'high: one level up it sees one cell farther');
    assert.equal(reach(3), 16, 'high: three levels up it sees two cells farther, and no more');
    { const w = field(x => (x >= 12 ? 2 : 0)); put(w, ME, UK_OBSERVER, 5, 16);
      assert.equal(highSight(w, center(5), center(16), center(20), center(16)), 0, 'high: looking uphill gives no bonus'); }
  },
  // 直射：要看得到才打得到
  direct() {
    { const w = field(RIDGE), tank = put(w, ME, UK_TANK, 11, 16, true), foe = put(w, FOE, UK_TANK, 19, 16); put(w, ME, UK_OBSERVER, 15, 13);
      assert(spotted(w, ME, foe.x, foe.z) && ridge(w, tank.x, tank.z, foe.x, foe.z), 'fixture: the enemy is in range and spotted from the crest, but the ridge stands between it and the tank');
      assert.equal(fires(w, tank, 40), 0, 'direct: a tank behind the ridge does not fire at an enemy on the other side'); }
    { const w = field(RIDGE), tank = put(w, ME, UK_TANK, 11, 16, true), hidden = put(w, FOE, UK_TANK, 19, 16), open = put(w, FOE, UK_INFANTRY, 11, 25); put(w, ME, UK_OBSERVER, 15, 13);
      assert(spotted(w, ME, hidden.x, hidden.z) && spotted(w, ME, open.x, open.z), 'fixture: both enemies are spotted');
      assert(Math.hypot(hidden.x - tank.x, hidden.z - tank.z) < Math.hypot(open.x - tank.x, open.z - tank.z), 'fixture: the hidden one is the nearer');
      step(w, []);
      assert.deepEqual(w.shells.filter(s => s.shooter === tank.id).map(s => s.target), [open.id], 'direct: with a nearer enemy hidden behind the ridge it fires at the one it can see'); }
    { const w = field(RIDGE), tank = put(w, ME, UK_TANK, 11, 16, true), foe = put(w, FOE, UK_TANK, 19, 16); put(w, ME, UK_OBSERVER, 15, 13);
      const x0 = tank.x;
      const n = fires(w, tank, 300, [{ t: 'attack', side: ME, ids: [tank.id], target: foe.id }], u => assert(!ridge(w, u.x, u.z, foe.x, foe.z), 'direct: ordered to attack, it holds fire until it has the line'));
      assert(tank.x > x0 && n > 0, `direct: ordered to attack, it drives forward and fires once it has the line (${n} shots from cell ${cellOf(tank.x)})`); }
    // 轟房子（直射的單位只能對房子下砲擊指令）：房子在稜線另一邊。下令之後立刻開動（不在山腳下等），看得到才開火
    { const w = field(RIDGE), tank = put(w, ME, UK_TANK, 11, 16, true), target = house(w, 19, 16);
      const x0 = tank.x;
      step(w, [{ t: 'fireAt', side: ME, ids: [tank.id], x: 19, z: 16 }]); for (let i = 0; i < 4; i++) step(w, []);
      assert(tank.x > x0, 'direct: an order to shell a house over the ridge starts driving at once');
      const n = fires(w, tank, 300, [], u => assert(!ridge(w, u.x, u.z, center(19), center(16)), 'direct: ordered to shell a house beyond the ridge, it holds fire until it has the line'));
      assert(n > 0 && target.hp < target.maxHp, `direct: and it shells the house once it has the line (${n} shots from cell ${cellOf(tank.x)})`); }
    // 丘陵上兩台車一起轟對面村子的一棟房子（審查時重現的情形：先到的停在稜線上，另一台把它擠回稜線後面，兩台各開一砲就卡住兩千多步）
    { const w = createWorld(1944); step(w, [{ t: 'map', id: 4 }]); w.units = [];
      const a = put(w, ME, UK_TANK, 23, 19, true), b = put(w, ME, UK_TANK, 24, 20, true); put(w, FOE, UK_TANK, 1, 1);   // 遠處留一台敵車，不然沒有對手就分出勝負
      const target = w.blds.find(h => h.x === 14 && h.z === 10);
      assert(target && target.hp > 0, 'fixture: the house at 14,10 in the far village');
      const shots = new Map([[a.id, 0], [b.id, 0]]);
      step(w, [{ t: 'fireAt', side: ME, ids: [a.id, b.id], x: 14, z: 10 }]);
      for (let i = 0; i < 1200 && target.hp > 0; i++) { step(w, []); for (const e of w.events) if (e.e === 'fire' && shots.has(e.unit)) shots.set(e.unit, shots.get(e.unit) + 1); }
      assert(target.hp <= 0, `direct: two tanks shelling one house over the ridge keep at it until it falls (${[...shots.values()].join(', ')} shots, house ${target.hp} left)`); }
  },
  // 間接射擊：越過稜線照打；沒人看得到的目標照舊規則散布加倍
  indirect() {
    { const w = field(RIDGE), gun = put(w, ME, UK_HOWITZER, 6, 16, true); put(w, FOE, UK_INFANTRY, 22, 16); put(w, ME, UK_OBSERVER, 16, 13);
      assert(fires(w, gun, 30) >= 1, 'indirect: a howitzer fires over the ridge'); }
    // 對稜線背後的一格地面砲擊六發：沒有觀測員（盲射）時落點比有觀測員時散得開
    const spread = (watched, paint = RIDGE) => {   // watched：觀測員站在哪一格（不給＝沒有觀測員）
      const w = field(paint), gun = put(w, ME, UK_HOWITZER, 6, 16, true);
      if (watched) put(w, ME, UK_OBSERVER, ...watched);
      const aim = [center(22), center(16)], order = { t: 'fireAt', side: ME, ids: [gun.id], x: 22, z: 16 }, counted = new Set(); let worst = 0, shots = 0;
      for (let i = 0; i < 2400 && shots < 6; i++) {   // 一次對地砲擊只有幾發：打完了再下一次
        step(w, gun.order === ORD_IDLE ? [order] : []);
        for (const s of w.shells) if (s.shooter === gun.id && !counted.has(s.id)) { counted.add(s.id); shots++; worst = Math.max(worst, Math.abs(s.ex - aim[0]), Math.abs(s.ez - aim[1])); }
      }
      assert(shots >= 4, `fixture: the howitzer got its rounds off (${shots})`);
      return worst;
    };
    const blind = spread(null), seen = spread([16, 13]), r = Math.floor((16 * SUB) / 12);
    assert(seen <= r, `fixture: with an observer on the crest the rounds land within the normal spread (${seen} of ${r})`);
    assert(blind > r && blind <= 2 * r, `indirect: behind the ridge and unobserved, the same rounds scatter up to twice as wide (${blind}, normal ${r})`);
    const reverse = spread([10, 16]), open = spread([10, 16], () => 0);
    assert(open <= r, `fixture: on flat ground an observer twelve cells from the target sees it and the rounds land within the normal spread (${open} of ${r})`);
    assert(reverse > r, `indirect: an observer on the near side of the ridge cannot see the target behind it, so the rounds scatter as if blind (${reverse}, normal ${r})`);
  },
  // 喪屍看人也被稜線擋住：稜線另一邊比較近的那一班看不到，追的是這一邊比較遠的那個
  zombies() {
    const w = field(RIDGE);
    w.zombies = { version: 1, wave: 1, next: 1e9, pending: 0, spawned: 0, killed: 0, lost: 0 };
    const z = put(w, FOE, UK_ZOMBIE, 13, 16), far = put(w, ME, UK_OBSERVER, 7, 16), near = put(w, ME, UK_INFANTRY, 18, 16);
    assert(Math.hypot(near.x - z.x, near.z - z.z) < Math.hypot(far.x - z.x, far.z - z.z) && spotted(w, ME, z.x, z.z), 'fixture: the squad beyond the ridge is the nearer, and the zombie is in sight of the player');
    step(w, []);
    assert.equal(z.target, far.id, 'zombies: a zombie does not see, or chase, a unit the ridge hides from it');
  },
  // 房子照舊擋視線（有高度的圖上兩種擋法都算）
  cover() {
    { const w = field(() => 0); put(w, ME, UK_OBSERVER, 10, 16); house(w, 13, 16);
      assert(!sees(w, ME, 16, 16) && sees(w, ME, 16, 12), 'cover: on a map with heights a house still blocks the line behind it'); }
    { const w = field(RIDGE); put(w, ME, UK_OBSERVER, 16, 16); house(w, 19, 16);
      assert(sees(w, ME, 19, 16) && !sees(w, ME, 22, 16) && sees(w, ME, 22, 12), 'cover: from the crest a house below hides what is behind it and nothing else'); }
  },
  // 雜湊與存檔
  save() {
    const a = field(RIDGE), b = field(RIDGE), flat = field(null);
    b.height[cellIdx(b, 3, 3)] = 1;
    assert.notEqual(hashWorld(a), hashWorld(b), 'save: one cell of height changes the hash');
    assert.notEqual(hashWorld(a), hashWorld(flat), 'save: a world with a height table hashes differently from one without');
    const log = [{ t: 'map', id: 4, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, end: 1, mg: 1 }, { t: 'ai', side: FOE, level: 3, v: 3 }, { t: 'ai', side: ME, level: 3, v: 3 }];
    const run = ticks => { const w = createWorld(21); step(w, log); while (w.tick < ticks) step(w, []); return w; };
    const mid = run(600), direct = hashWorld(run(1200));
    const text = JSON.stringify(encodeWorld(mid)), back = decodeWorld(JSON.parse(text));
    assert(back && back.height instanceof Uint8Array && back.height.length === 32 * 32, 'save: the height table comes back');
    assert.equal(hashWorld(back), hashWorld(mid), 'save: the restored world hashes the same');
    while (back.tick < 1200) step(back, []);
    assert.equal(hashWorld(back), direct, 'save: and continues like the uninterrupted battle');
    const raw = JSON.parse(text);
    assert.equal(decodeWorld({ ...raw, height: [4, 32 * 32] }), null, 'save: a height above three is refused');
    assert.equal(decodeWorld({ ...raw, height: [1, 32 * 32 - 1] }), null, 'save: a height table of the wrong length is refused');
    assert(decodeWorld({ ...raw, height: [1, 32 * 32] }), 'fixture: a well-formed table of ones is accepted');
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`terrain/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK terrain/${name}`); }

// ---- 畫面（不在隔離副本裡跑：要 three）：舊地圖的地面貼圖逐像素不變；丘陵的稜線頂比山腳亮 ----
{
  const { BattleView } = await import('../src/render/battle.ts');
  const FLAGS = { fx: true, fog: true, observerDetails: true, r004: true, r008: true, r009: true, r011: true, r014: true, r016: true };
  const fnv = a => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
  const ground = id => { const w = createWorld(1944); step(w, [{ t: 'map', id, vegetation: 1 }]); const v = new BattleView(w, FLAGS); v.update(0, 1, new Set()); return { w, px: v.groundPx }; };
  // 這張卡之前（main 8d53d1f）在 Node 裡算的四張舊地圖地面貼圖雜湊
  assert.deepEqual([0, 1, 2, 3].map(id => fnv(ground(id).px)), ['eabbe8a0', 'ff6f9fa6', '6298bf99', '8adeff83'], 'draw: the ground texture of the four older maps is pixel for pixel what it was before this card');
  const { w, px } = ground(4), PX = Math.round(Math.sqrt(px.length / 4) / w.n), W = w.n * PX;
  // 一格的平均亮度（8×8 個像素的紅綠藍加起來）
  const light = (x, z) => { let s = 0; for (let py = 0; py < PX; py++) for (let qx = 0; qx < PX; qx++) { const o = ((z * PX + py) * W + x * PX + qx) * 4; s += px[o] + px[o + 1] + px[o + 2]; } return s / (PX * PX); };
  const plain = (x, z) => w.ter[cellIdx(w, x, z)] === 0 && !w.occ[cellIdx(w, x, z)] && !w.vegetation.cells[cellIdx(w, x, z)];
  const crest = [20, 11], foot = [27, 20];
  assert(plain(...crest) && plain(...foot) && w.height[cellIdx(w, ...crest)] === 3 && w.height[cellIdx(w, ...foot)] === 0, 'fixture: an open grass cell on the crest and one at the foot of the ridge');
  const up = light(...crest), down = light(...foot);
  assert(up > down * 1.15, `draw: on the hill map the crest is drawn clearly brighter than the grass at the foot (${up.toFixed(0)} against ${down.toFixed(0)})`);
  { const flat = createWorld(1944); step(flat, [{ t: 'map', id: 4, vegetation: 1 }]); delete flat.height; const v = new BattleView(flat, FLAGS); v.update(0, 1, new Set());
    const lit = (x, z) => { let s = 0; for (let py = 0; py < PX; py++) for (let qx = 0; qx < PX; qx++) { const o = ((z * PX + py) * W + x * PX + qx) * 4; s += v.groundPx[o] + v.groundPx[o + 1] + v.groundPx[o + 2]; } return s / (PX * PX); };
    assert(!(lit(...crest) > lit(...foot) * 1.15), 'fixture: with the height table removed the same two cells look alike (the relief is what tells them apart)'); }
  // 車轍：有高度的圖上，被稜線擋住看不到的敵車不壓車轍；看得到的敵車、我方的車照壓。沒有高度表的對照：同一台車看得到、照壓
  const tracksUnder = (withHeight) => {
    const v0 = field(withHeight ? RIDGE : () => 0); if (!withHeight) delete v0.height;
    put(v0, ME, UK_OBSERVER, 10, 16);
    const hidden = put(v0, FOE, UK_TANK, 20, 16), seen = put(v0, FOE, UK_TANK, 10, 22), mine = put(v0, ME, UK_TANK, 8, 13);
    const v = new BattleView(v0, FLAGS); v.update(0, 1, new Set());
    const orders = [{ t: 'move', side: FOE, ids: [hidden.id], x: 23, z: 16 }, { t: 'move', side: FOE, ids: [seen.id], x: 12, z: 22 }, { t: 'move', side: ME, ids: [mine.id], x: 5, z: 13 }];
    for (let i = 0; i < 60; i++) { v.snapshot(); step(v0, i === 0 ? orders : []); v.onEvents(v0.events, i / 20); }
    const under = (x0, x1, z) => { let s = 0; for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let py = 0; py < PX; py++) for (let qx = 0; qx < PX; qx++) s += v.tracks[(z * PX + py) * W2(v0) + x * PX + qx]; return s; };
    return { hidden: under(20, 23, 16), seen: under(10, 12, 22), mine: under(5, 8, 13), hiddenSpotted: spotted(v0, ME, hidden.x, hidden.z) };
  };
  const W2 = v => v.n * PX;
  const hill = tracksUnder(true), level = tracksUnder(false);
  assert(!hill.hiddenSpotted && level.hiddenSpotted && level.hidden > 0, `fixture: the far tank is hidden only by the ridge, and without the height table it is seen and leaves tracks (${level.hidden})`);
  assert(hill.hidden === 0 && hill.seen > 0 && hill.mine > 0, `draw: an enemy vehicle hidden behind the ridge leaves no tracks; visible ones do (hidden ${hill.hidden}, seen ${hill.seen}, mine ${hill.mine})`);
  // 煙幕：站在高處的多看兩格；雲最近的那一點模擬看得到，畫面就要畫（R107 的預篩不能把它篩掉）
  { const { smokeSurfaceVisible } = await import('../src/render/smoke.ts');
    const v = field(x => (x <= 10 ? 3 : 0)), eye = put(v, ME, UK_OBSERVER, 10, 16), sight = UNIT_KINDS[UK_OBSERVER].sight, R = 2 * SUB;
    let band = 0;
    for (let deg = -60; deg <= 60; deg += 1) for (let d = sight + R + 2; d <= sight + 2 * SUB + R - 2; d += 8) {   // 兩端各留兩個位置單位：剛好在邊界上的那一點，四捨五入差一個單位就會翻
      const a = (deg * Math.PI) / 180, cx = Math.round(eye.x + Math.cos(a) * d), cz = Math.round(eye.z + Math.sin(a) * d);
      if (cx < 0 || cz < 0 || cx >= v.n * SUB || cz >= v.n * SUB) continue;
      const dx = eye.x - cx, dz = eye.z - cz, dd = Math.hypot(dx, dz), rim = spotted(v, ME, cx + Math.round((dx * R) / dd), cz + Math.round((dz * R) / dd));   // 雲面上離觀測員最近的那一點（跟 smoke.ts 取樣的是同一點）
      if (!rim) continue;
      band++;
      assert(smokeSurfaceVisible(v, { id: 1, x: cx, z: cz }), `draw: an elevated observer whose sight reaches the near edge of a smoke cloud sees the cloud drawn (bearing ${deg}°, ${(d / SUB).toFixed(2)} cells)`);
    }
    assert(band > 50, `fixture: many clouds lie in the band only high ground reaches (${band})`); }
  console.log(`OK terrain/draw: older ground textures unchanged; crest ${up.toFixed(0)}, foot ${down.toFixed(0)}; hidden tracks ${hill.hidden}; smoke band checked`);
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r055-negative-'));
const FIRE = '  if (!k.indirect && ridge(w, u.x, u.z, aim.x, aim.z)) return;';
const mutants = [
  ['sees_through_ridges', 'ridge', 'step.ts', '    if (w.height && ridgeBlocks(w, cells)) continue;', '', 'ridge: the far side of a ridge is hidden'],
  ['equal_blocks', 'ridge', 'terrain.ts', 'if (2 * h[cells[i]] * n > a * (n - i) + b * i) return true;', 'if (2 * h[cells[i]] * n >= a * (n - i) + b * i) return true;', 'ridge: a unit at the top of a one-level step is seen from below'],
  ['no_eye_height', 'dead', 'terrain.ts', 'const a = 2 * h[cells[0]] + 1, b = 2 * h[cells[n]] + 1;', 'const a = 2 * h[cells[0]], b = 2 * h[cells[n]] + 1;', 'dead: one cell back from a one-level edge the cell below is still seen'],
  ['uncapped', 'high', 'terrain.ts', 'return up > 0 ? Math.min(HIGH_SIGHT_MAX, up) * SUB : 0;', 'return up > 0 ? up * SUB : 0;', 'high: three levels up it sees two cells farther, and no more'],
  ['uphill_bonus', 'high', 'terrain.ts', 'return up > 0 ? Math.min(HIGH_SIGHT_MAX, up) * SUB : 0;', 'return up !== 0 ? Math.min(HIGH_SIGHT_MAX, Math.abs(up)) * SUB : 0;', 'high: looking uphill gives no bonus'],
  ['no_bonus', 'high', 'step.ts', ' + highSight(w, u.x, u.z, x, z)) continue;', ') continue;', 'high: one level up it sees one cell farther'],
  ['picks_hidden', 'direct', 'step.ts', '    if (!k.indirect && ridge(w, u.x, u.z, t.x, t.z)) continue;', '', 'direct: with a nearer enemy hidden behind the ridge it fires at the one it can see'],
  ['fires_through', 'direct', 'step.ts', FIRE, '', 'direct: ordered to attack, it holds fire until it has the line'],
  ['waits_below', 'direct', 'step.ts', 'if (inRange(u, u.tx, u.tz) && (UNIT_KINDS[u.kind].indirect || !ridge(w, u.x, u.z, u.tx, u.tz))) { u.path = []; u.pathIdx = 0; return; }', 'if (inRange(u, u.tx, u.tz)) { u.path = []; u.pathIdx = 0; return; }', 'direct: ordered to attack, it drives forward and fires once it has the line'],
  ['house_order_waits', 'direct', 'step.ts', 'u.path = inRange(u, center(gx), center(gz)) && (UNIT_KINDS[u.kind].indirect || !ridge(w, u.x, u.z, center(gx), center(gz))) ? [] : findPath(', 'u.path = inRange(u, center(gx), center(gz)) ? [] : findPath(', 'direct: an order to shell a house over the ridge starts driving at once'],
  ['fireat_stuck', 'direct', 'step.ts', 'u.order === ORD_FIRE_AT && u.pathIdx >= u.path.length && (w.tick + u.id) % 20 === 0', 'false && u.pathIdx >= u.path.length && (w.tick + u.id) % 20 === 0', 'direct: two tanks shelling one house over the ridge keep at it until it falls'],
  ['blind_ignores_ridge', 'indirect', 'step.ts', '    if (w.height && ridgeBlocks(w, cells)) continue;', '', 'indirect: an observer on the near side of the ridge cannot see the target behind it'],
  ['zombies_see_through', 'zombies', 'step.ts', '  if (w.height && ridgeBlocks(w, ray)) return false;', '', 'zombies: a zombie does not see, or chase, a unit the ridge hides from it'],
  ['houses_ignored', 'cover', 'step.ts', '    if (w.height && ridgeBlocks(w, cells)) continue;', '    if (w.height) { if (ridgeBlocks(w, cells)) continue; return true; }', 'cover: on a map with heights a house still blocks the line behind it'],
  ['howitzer_blocked', 'indirect', 'step.ts', FIRE, '  if (ridge(w, u.x, u.z, aim.x, aim.z)) return;', 'indirect: a howitzer fires over the ridge'],
  ['height_not_saved', 'save', 'worldCodec.ts', '...(vegetation ? { vegetation } : {}), ...(height ? { height } : {}) };', '...(vegetation ? { vegetation } : {}) };', 'save: the height table comes back'],
  ['height_unchecked', 'save', 'worldCodec.ts', 'unpack(r.height, new Uint8Array(cells), 0, HEIGHT_MAX)', 'unpack(r.height, new Uint8Array(cells), 0, 255)', 'save: a height above three is refused'],
  ['height_not_hashed', 'save', 'world.ts', '  if (w.height) { f.int(0x4854).int(w.height.length); for (const h of w.height) f.int(h); }', '', 'save: one cell of height changes the hash'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/terrain.mjs'), join(dir, 'tests/terrain.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/terrain.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK terrain-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`terrain: all groups OK, ${mutants.length} isolated mutants rejected`);
