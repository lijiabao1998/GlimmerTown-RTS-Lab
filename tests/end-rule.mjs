// R077 指揮部倒了就結束：勝負判定第二版（eco 指令帶 end 才用）。不開瀏覽器的部分。
// 用法：node tests/end-rule.mjs            全部跑，另外把模擬故意弄壞幾次（隔離副本），確認第一個紅燈落在指定的斷言上
//       node tests/end-rule.mjs <群組名>   只跑那一群（隔離副本裡用）
// 真實 Chrome 在 tests/end-rule-browser.mjs；對戰的數字用 tools/duel.mjs --end 量，寫在卡面。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createWorld, hashWorld, center, cellIdx, SUB, UNIT_KINDS, ORD_IDLE, SIDE_PLAYER, SIDE_ENEMY, UK_HOWITZER, UK_TANK, SHELL_AP, SHELL_HE, SHELL_SMOKE, BK_HQ } from '../src/sim/world.ts';
import { step, END_WAIT_CELLS } from '../src/sim/step.ts';
import { isCommand } from '../src/sim/commandCheck.ts';
import { runScript } from '../src/sim/script.ts';
import { encodeWorld, decodeWorld } from '../src/sim/worldCodec.ts';

assert.equal(END_WAIT_CELLS, 3, 'fixture: the number on the card is the number in src/sim/step.ts');
const DRAW = 2;
// 一片空地，雙方各一棟 2×2 的指揮部：我方 (26,26)、敵方 (4,4)；各一門不會開火的榴彈砲（當砲彈的主人）。end＝帶不帶新判定
function arena(end) {
  const w = createWorld(7);
  w.blds = []; w.occ.fill(0); w.ter.fill(0); w.crater.fill(0); w.units = []; w.shells = [];
  const hq = (x, z, side) => { const b = { id: w.blds.length + 1, kind: BK_HQ, x, z, w: 2, d: 2, floors: 1, hp: 1200, maxHp: 1200, builtBy: side }; w.blds.push(b); for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) w.occ[cellIdx(w, x + i, z + j)] = b.id; return b; };
  const gun = (side, cx, cz) => { const k = UNIT_KINDS[UK_HOWITZER], u = { id: w.units.length + 1, side, kind: UK_HOWITZER, x: center(cx), z: center(cz), hp: k.hp, alive: true, order: ORD_IDLE, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: SUB, aimZ: 0 }; w.units.push(u); return u; };
  const mine = hq(26, 26, SIDE_PLAYER), theirs = hq(4, 4, SIDE_ENEMY);
  w.eco = { supply: [0, 0], hq: [mine.id, theirs.id], queue: [[], []], prog: [0, 0], ...(end ? { end: 1 } : {}) };
  return { w, mine, theirs, myGun: gun(SIDE_PLAYER, 20, 20), foeGun: gun(SIDE_ENEMY, 10, 10) };
}
// 一發還在飛的砲彈：落點 (ex, ez)（位置單位）、還要飛 T 步
function shell(w, shooter, ex, ez, T, extra = {}) {
  const s = { id: w.shells.length + 1, side: shooter.side, kind: SHELL_HE, shooter: shooter.id, sx: shooter.x, sz: shooter.z, ex, ez, t: 0, T, target: 0, hitBld: 0, ...extra };
  w.shells.push(s);
  return s;
}
const tick = w => { w.eco.supply = [0, 0]; step(w, []); };
const until = (w, cap) => { let n = 0; while (w.winner < 0 && n < cap) { tick(w); n++; } return n; };
const FAR = [center(15), center(25)];   // 離兩棟指揮部都很遠的空地

const groups = {
  // 旗標、雜湊、指令檢查、存檔
  flag() {
    assert.equal(hashWorld(runScript()), 'eea1d59b', 'flag: the golden script battle is unchanged');
    const plain = arena(false).w, flagged = arena(true).w;
    assert.notEqual(hashWorld(plain), hashWorld(flagged), 'flag: end is folded into the hash');
    assert.deepEqual([isCommand({ t: 'eco', inf: 1, end: 1 }), isCommand({ t: 'eco', inf: 1 }), isCommand({ t: 'eco', end: 'yes' })], [true, true, false], 'flag: the command check knows the new field');
    const viaCmd = on => { const w = createWorld(3); step(w, [{ t: 'eco', inf: 1, guns: 1, tanks: 1, ...(on ? { end: 1 } : {}) }]); return w; };
    assert.deepEqual([viaCmd(true).eco.end, viaCmd(false).eco.end], [1, undefined], 'flag: end arrives through the eco command and nothing is stored without it');
    const a = arena(true);
    shell(a.w, a.myGun, FAR[0], FAR[1], 40);
    assert.deepEqual(decodeWorld(JSON.parse(JSON.stringify(encodeWorld(a.w)))), { ...a.w, events: [] }, 'flag: the flag survives the save codec field for field');
    const copy = structuredClone(a.w);
    a.theirs.hp = 0; copy.blds[a.theirs.id - 1].hp = 0;
    tick(a.w); tick(copy);
    assert.deepEqual([copy.winner, hashWorld(copy)], [a.w.winner, hashWorld(a.w)], 'flag: a deep copy decides the battle on the same step with the same hash');
  },
  // 沒有 end：照舊等所有還在飛的砲彈
  legacy() {
    const a = arena(false);
    a.theirs.hp = 0; shell(a.w, a.myGun, FAR[0], FAR[1], 40);
    tick(a.w);
    assert.equal(a.w.winner, -1, 'legacy: without end the far shell still delays the result');
    const waited = until(a.w, 100);
    assert(a.w.winner === SIDE_PLAYER && waited >= 38 && waited <= 41, `legacy: the result comes when the shell has landed (waited ${waited} more steps, winner ${a.w.winner})`);
  },
  // 有 end：不相干的砲彈不等
  quick() {
    const a = arena(true);
    a.theirs.hp = 0; shell(a.w, a.myGun, FAR[0], FAR[1], 40);
    tick(a.w);
    assert.equal(a.w.winner, SIDE_PLAYER, 'quick: with end the result is declared the same step');
    const b = arena(true);
    b.mine.hp = 0; shell(b.w, b.foeGun, FAR[0], FAR[1], 40);
    tick(b.w);
    assert.equal(b.w.winner, SIDE_ENEMY, 'quick: the same holds for the other side');
    const c = arena(true);
    shell(c.w, c.myGun, FAR[0], FAR[1], 40);
    for (let i = 0; i < 60; i++) tick(c.w);
    assert.equal(c.w.winner, -1, 'quick: with both headquarters standing nobody wins');
  },
  // 有 end：還打得到另一棟指揮部的砲彈要等
  threat() {
    const onMine = a => shell(a.w, a.foeGun, center(27), center(27), 30);
    const a = arena(true);
    a.theirs.hp = 0; a.mine.hp = 1; onMine(a);
    tick(a.w);
    assert.equal(a.w.winner, -1, 'threat: a shell that can still reach the other headquarters delays the result');
    until(a.w, 100);
    assert.deepEqual([a.w.winner, a.mine.hp], [DRAW, 0], 'threat: when that shell brings the other headquarters down too, it is a draw');
    const b = arena(true);
    b.theirs.hp = 0; onMine(b);
    tick(b.w);
    assert.equal(b.w.winner, -1, 'threat: the result waits even when the headquarters will survive the hit');
    const waited = until(b.w, 100);
    assert(b.w.winner === SIDE_PLAYER && b.mine.hp > 0 && waited >= 28 && waited <= 31, `threat: once the shell has landed and the headquarters stands, the winner is declared (waited ${waited}, winner ${b.w.winner})`);
  },
  // 邊界：落點離佔地三格以內才等；會打中那棟的穿甲彈算；煙幕彈不算
  edge() {
    const at = (ex, ez, extra) => { const a = arena(true); a.theirs.hp = 0; shell(a.w, a.foeGun, ex, ez, 30, extra); tick(a.w); return a.w.winner; };
    const left = 26 * SUB;   // 我方指揮部佔地的左緣（位置單位）
    assert.equal(at(left - END_WAIT_CELLS * SUB, center(26)), -1, 'edge: a shell landing exactly three cells from the footprint delays');
    assert.equal(at(left - END_WAIT_CELLS * SUB - 1, center(26)), SIDE_PLAYER, 'edge: one unit beyond three cells does not delay');
    assert.equal(at(center(26), left - END_WAIT_CELLS * SUB - 1), SIDE_PLAYER, 'edge: the same on the other axis');
    assert.equal(at(FAR[0], FAR[1], { kind: SHELL_AP, hitBld: 1 }), -1, 'edge: an armour-piercing shell that will hit the headquarters delays');
    assert.equal(at(FAR[0], FAR[1], { kind: SHELL_AP, hitBld: 0 }), SIDE_PLAYER, 'edge: an armour-piercing shell aimed elsewhere does not');
    assert.equal(at(center(27), center(27), { kind: SHELL_SMOKE }), SIDE_PLAYER, 'edge: smoke never delays');
  },
  // 兩棟都倒了：已經沒有砲彈能改變結果
  draw() {
    const a = arena(true);
    a.theirs.hp = 0; a.mine.hp = 0; shell(a.w, a.myGun, FAR[0], FAR[1], 40);
    tick(a.w);
    assert.equal(a.w.winner, DRAW, 'draw: with both headquarters down the draw is declared the same step');
    const b = arena(false);
    b.theirs.hp = 0; b.mine.hp = 0; shell(b.w, b.myGun, FAR[0], FAR[1], 40);
    tick(b.w);
    assert.equal(b.w.winner, -1, 'fixture: without end even a certain draw waits for the shell');
  },
  // 沒有補給的局：全軍覆沒才算輸，照舊等所有砲彈（這種局沒有 eco，也就沒有 end）
  noeco() {
    const a = arena(false);
    delete a.w.eco;
    a.foeGun.alive = false; shell(a.w, a.myGun, FAR[0], FAR[1], 40);
    step(a.w, []);
    assert.equal(a.w.winner, -1, 'noeco: a battle without headquarters still waits for every shell');
    let n = 0; while (a.w.winner < 0 && n < 100) { step(a.w, []); n++; }
    assert.equal(a.w.winner, SIDE_PLAYER, 'noeco: and is decided by who has units left');
  },
  // 喪屍模式：指揮部失守立即結束、指揮部還在就沒有人贏，帶不帶 end 都一樣（它在 checkWinner 最前面自己判完，走不到新加的那一段）
  zombies() {
    const start = end => { const w = createWorld(1944); step(w, [{ t: 'map', id: 1, vegetation: 1 }, { t: 'zombies' }, { t: 'eco', inf: 1, guns: 1, tanks: 1, ...(end ? { end: 1 } : {}) }]); return w; };
    for (const end of [false, true]) {
      const w = start(end), hq = w.blds[w.eco.hq[SIDE_PLAYER] - 1], shooter = w.units.find(u => u.alive && u.side === SIDE_PLAYER);
      assert(w.zombies && hq && hq.hp > 0 && shooter && w.eco.end === (end ? 1 : undefined), 'fixture: a zombie-mode world with a standing player headquarters');
      shell(w, shooter, FAR[0], FAR[1], 40);
      step(w, []);
      assert.equal(w.winner, -1, `zombies: with the headquarters standing nobody has won (end ${end})`);
      hq.hp = 0;
      step(w, []);
      assert.equal(w.winner, SIDE_ENEMY, `zombies: losing the headquarters ends the battle at once, shell in the air or not (end ${end})`);
    }
  },
};

const only = process.argv[2];
if (only) { assert(groups[only], `unknown group ${only}`); groups[only](); console.log(`end-rule/${only}: OK`); process.exit(0); }
for (const [name, run] of Object.entries(groups)) { run(); console.log(`OK end-rule/${name}`); }

// ---- 接線（不在隔離副本裡跑）----
{
  const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../src/valves.ts'), /get r077\(\) \{ return on\('077'\); \}/, 'valve: r077 is on the table');
  assert.equal((read('../src/main.ts').match(/\.\.\.\(V\.r077 \? \{ end: 1 \} : \{\}\)/g) ?? []).length, 1, 'wiring: the eco command of a new battle carries end, behind the valve');
  assert.match(read('../README.md'), /\?noR077=1/, 'readme: the valve is documented');
  console.log('OK end-rule/wiring');
}

// ---- 故意弄壞 ----
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), temp = mkdtempSync(join(tmpdir(), 'r077-negative-'));
const WAIT = 'if (left && w.shells.some(s => s.kind !== SHELL_SMOKE && (s.hitBld === left.id || nearBld(left, s.ex, s.ez, END_WAIT_CELLS * SUB)))) return;';
const mutants = [
  ['unhashed', 'flag', 'world.ts', ' if (e.end) f.int(0x454e).int(e.end);', '', 'flag: end is folded into the hash'],
  ['never_stored', 'flag', 'eco.ts', '...(end ? { end: 1 } : {}), ', '', 'flag: end arrives through the eco command'],
  ['always_new', 'legacy', 'step.ts', '  if (w.eco?.end) {', '  if (w.eco) {', 'legacy: without end the far shell still delays the result'],
  ['waits_for_everything', 'quick', 'step.ts', WAIT, WAIT.replace('(s.hitBld === left.id || nearBld(left, s.ex, s.ez, END_WAIT_CELLS * SUB))', '(s.id > 0)'), 'quick: with end the result is declared the same step'],
  ['waits_for_nothing', 'threat', 'step.ts', WAIT, '', 'threat: a shell that can still reach the other headquarters delays the result'],
  ['wrong_winner', 'quick', 'step.ts', 'w.winner = !left ? 2 : a ? SIDE_PLAYER : SIDE_ENEMY;', 'w.winner = !left ? 2 : a ? SIDE_ENEMY : SIDE_PLAYER;', 'quick: with end the result is declared the same step'],
  ['wider_wait', 'edge', 'step.ts', 'nearBld(left, s.ex, s.ez, END_WAIT_CELLS * SUB)', 'nearBld(left, s.ex, s.ez, (END_WAIT_CELLS + 1) * SUB)', 'edge: one unit beyond three cells does not delay'],
  ['ignores_aimed_shot', 'edge', 'step.ts', 's.hitBld === left.id || ', '', 'edge: an armour-piercing shell that will hit the headquarters delays'],
  ['smoke_delays', 'edge', 'step.ts', 'if (left && w.shells.some(s => s.kind !== SHELL_SMOKE && (', 'if (left && w.shells.some(s => s.kind >= 0 && (', 'edge: smoke never delays'],
  ['draw_waits', 'draw', 'step.ts', 'if (w.winner >= 0 || (a && b)) return;', 'if (w.winner >= 0 || (a && b) || (!left && w.shells.length)) return;', 'draw: with both headquarters down the draw is declared the same step'],
];
try {
  for (const [name, group, file, from, to, wanted] of mutants) {
    const dir = join(temp, name);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    cpSync(join(root, 'src/sim'), join(dir, 'src/sim'), { recursive: true });
    cpSync(join(root, 'tests/end-rule.mjs'), join(dir, 'tests/end-rule.mjs'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const path = join(dir, 'src/sim', file), source = readFileSync(path, 'utf8');
    assert.equal(source.split(from).length, 2, `${name}: unique mutation anchor`);
    writeFileSync(path, source.replace(from, to));
    const r = spawnSync(process.execPath, [join(dir, 'tests/end-rule.mjs'), group], { encoding: 'utf8', timeout: 100000 }), output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.error, undefined, `${name}: child starts and completes`);
    assert.notEqual(r.status, 0, `${name}: mutation must fail`);
    const first = /AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/.exec(output)?.[1] ?? '';
    assert(first.startsWith(wanted), `${name}: intended assertion must fail first (wanted "${wanted}"), got ${first || output.slice(-1500)}`);
    console.log(`OK end-rule-negative/${name}: ${first}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log(`end-rule: all groups OK, ${mutants.length} isolated mutants rejected`);
