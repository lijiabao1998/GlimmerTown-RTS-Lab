// R1006 計時：整數平方根的起點、找目標先框再算。只改算法、不改結果：這支守衛證明「答案逐位相同」。
// 卡面：docs/tasks/R1006-計時整數平方根.md。RECORD=1 node tests/timing1006.mjs 印出整局群的雜湊（要在改之前的提交上跑）。
import assert from 'node:assert/strict';
import { createWorld, hashWorld, center, UNIT_KINDS, ORD_IDLE, SUB, UK_INFANTRY, UK_ENGINEER, UK_FLAME, UK_SNIPER, UK_AT91, UK_TANK, SIDE_PLAYER as ME, SIDE_ENEMY as FOE } from '../src/sim/world.ts';
import { step, pickAim } from '../src/sim/step.ts';
import { isqrt } from '../src/sim/math.ts';
import { freeNear } from '../src/sim/ai.ts';
import { ECO } from '../tools/duel.mjs';

const RECORD = process.env.RECORD === '1';
const only = process.argv[2];
let groups = 0;
const group = (name, fn) => { if (only && only !== name) return; fn(); groups++; console.log(`ok ${name}`); };

// 改之前的寫法（main 5b9fc66 的 src/sim/math.ts 照抄）：當對照
function isqrtOld(n) {
  if (n <= 0) return 0;
  let x = n, y = Math.floor((x + 1) / 2);
  while (y < x) { x = y; y = Math.floor((x + Math.floor(n / x)) / 2); }
  return x;
}

if (!RECORD) group('isqrt', () => {
  for (let n = 0; n <= 4194304; n++) if (isqrt(n) !== isqrtOld(n)) assert.fail(`isqrt: ${n} gives ${isqrt(n)}, the old one ${isqrtOld(n)}`);
  const at = n => assert.equal(isqrt(n), isqrtOld(n), `isqrt: ${n}`);
  for (let k = 2048; k <= 1048576; k += 97) for (const n of [k * k - 1, k * k, k * k + 1]) at(n);
  for (const n of [1048576 * 1048576 - 1, 1048576 * 1048576, 1048576 * 1048576 + 1, 4294967295, 4294967296, 4294967297, 1e10, 2 ** 40 - 1, 2 ** 40]) at(n);
  let s = 12345;   // 決定性抽樣（自己的線性同餘，不碰 World.rng）
  for (let i = 0; i < 200000; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const hi = (Math.imul(s, 69069) + 1) >>> 0, n = (hi % 1048576) * 1048576 + (s % 1048576);   // 0 … 2^40
    at(n);
  }
});

// 方框：剛好在射程上（距離＝射程）照樣挑到；射程外 1 個位置單位不挑。四個方向都試；地上清空（沒有房子、樹林、高度）
function lone() {
  const w = createWorld(7);
  step(w, [{ t: 'map', id: 1, vegetation: 0 }]);
  w.units.length = 0; w.blds.length = 0; w.occ.fill(0); delete w.vegetation; delete w.height;
  const add = (side, k, x, z) => { const id = w.units.length + 1; w.units.push({ id, side, kind: k, x, z, hp: UNIT_KINDS[k].hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 }); return w.units[id - 1]; };
  return { w, add };
}
if (!RECORD) group('box', () => {
  for (const [kind, foeKind] of [[UK_FLAME, UK_INFANTRY], [UK_SNIPER, UK_INFANTRY], [UK_AT91, UK_TANK]]) {
    const r = UNIT_KINDS[kind].range;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const extra of [0, 1]) {
      const { w, add } = lone(), x0 = center(13), z0 = center(17), me = add(ME, kind, x0, z0);   // x、z 不一樣：方框把 x、z 寫混了也會紅
      add(FOE, foeKind, x0 + dx * (r + extra), z0 + dz * (r + extra));
      const aim = pickAim(w, me);
      if (extra) assert.equal(aim?.unit ?? null, null, `box: kind ${kind} must not pick a target ${r + extra} away towards (${dx}, ${dz})`);
      else assert.equal(aim?.unit?.id, 2, `box: kind ${kind} picks the target exactly at its range ${r} towards (${dx}, ${dz})`);
    }
  }
});

// 整局：每 500 步的世界雜湊跟改之前（main 5b9fc66）量到的一樣
const AI = s => ({ t: 'ai', side: s, level: 3, v: 3 });
function teams() {   // tools/r1002-time.mjs 的場景，另外每邊加兩組狙擊手、兩組反戰車小組
  const w = createWorld(31);
  step(w, [{ t: 'map', id: 3, vegetation: 1, sym: 1 }, { ...ECO, end: 1, mg: 2, pla: 1, sw: 2 }, { t: 'rules', force: 3 }, AI(0), AI(1)]);
  for (const side of [0, 1]) {
    const hq = w.blds[w.eco.hq[side] - 1];
    for (let i = 0; i < 12; i++) {
      const kind = i < 8 ? (i % 2 ? UK_FLAME : UK_ENGINEER) : i < 10 ? UK_SNIPER : UK_AT91, k = UNIT_KINDS[kind];
      const at = freeNear(w, hq.x + (side ? 3 + (i % 4) : -2 - (i % 4)), hq.z + (side ? 3 + (i >> 2) : -2 - (i >> 2)));
      w.units.push({ id: w.units.length + 1, side, kind, x: center(at[0]), z: center(at[1]), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 0, aimX: SUB, aimZ: 0 });
    }
  }
  return w;
}
const SCEN = {
  teams,
  hills: () => { const w = createWorld(44); step(w, [{ t: 'map', id: 4, vegetation: 1 }, { t: 'rules', ap: 1, morale: 2 }, { t: 'eco', inf: 1, mg: 2, guns: 1, tanks: 1 }, AI(0), AI(1)]); return w; },
  hythe: () => { const w = createWorld(90); step(w, [{ t: 'map', id: 5, vegetation: 1 }, { ...ECO, end: 1, mg: 2, sw: 2 }, AI(0), AI(1)]); return w; },
  zombie: () => { const w = createWorld(13); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1 }, AI(0)]); return w; },
};
// main 5b9fc66 上 RECORD=1 量到的（第 500、1000 … 4000 步，最後一筆是結束的步數與陣亡數）
const WANT = {
  teams: ["77c804d3", "9eeb3e9e", "66781aec", "fed91b71", "f2c81fbd", "6c18cf80", "169b1385", "e9b381cf", "end 4000 dead 55"],
  hills: ["b727cb3f", "1a80b72f", "5deffb7a", "14de3dea", "5e312d82", "6a2796ad", "3ca3562b", "c25d7d5e", "end 4000 dead 24"],
  hythe: ["b57d91bc", "1df349d1", "96f7bb8a", "9e97f4d9", "4a2ba1d2", "8515501a", "314aac5e", "806dfb7a", "end 4000 dead 24"],
  zombie: ["d5060e7d", "f7be6c13", "0c074ca9", "4ba0a89b", "c209158f", "510a333c", "dd3ac568", "end 3992 dead 29"],
};
group('battles', () => {
  const got = {};
  for (const [name, make] of Object.entries(SCEN)) {
    const w = make(), h = [];
    while (w.tick < 4000 && w.winner < 0) { step(w, []); if (w.tick % 500 === 0) h.push(hashWorld(w)); }
    h.push(`end ${w.tick} dead ${w.units.filter(u => !u.alive).length}`);
    got[name] = h;
    if (!RECORD) assert.deepEqual(h, WANT[name], `battles: ${name} hashes every 500 steps match main 5b9fc66`);
  }
  if (RECORD) console.log(JSON.stringify(got, null, 1));
});
console.log(`timing1006: ${groups} groups ok`);
