// R902：教學腳本走得完、跳得過、關得掉；既有腳本戰鬥的雜湊不動。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashWorld } from '../src/sim/world.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';
import {
  TUTORIAL_BUILD, TUTORIAL_ENEMY, TUTORIAL_LESSONS, TUTORIAL_MOVE, TUTORIAL_SCRIPT, TUTORIAL_STEP_END, TUTORIAL_STORE_KEY, TUTORIAL_SUPPLY, TUTORIAL_TICKS,
  createTutorial, runTutorial, tutorialAct, tutorialClock, tutorialHolding, tutorialMark, tutorialVisible,
} from '../src/sim/tutorial.ts';
import { initTutorial } from '../src/ui/tutorial.ts';

const read = rel => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const golden = JSON.parse(read('tools/golden.json'));

assert.equal(hashWorld(runScript()), golden.hash, '教學卡不改腳本戰鬥雜湊');
assert.deepEqual(SCRIPT.map(row => row.tick), [0, 0, 240, 240, 500, 500, 700, 900], 'SCRIPT 的 tick 序列不變');
assert.equal(SCRIPT.filter(row => row.cmd.t === 'move').length, 3);
assert.equal(SCRIPT.filter(row => row.cmd.t === 'attack').length, 2);

const sim = read('src/sim/tutorial.ts');
assert.equal(sim.includes("from './script.ts'"), false, '教學不 import script.ts');
assert.equal(sim.includes('runScript'), false, '教學不呼叫 runScript');
assert.equal(TUTORIAL_STORE_KEY.startsWith('gtrts.v1.'), true, '本機鍵名用 gtrts.v1. 開頭');
assert.deepEqual(TUTORIAL_LESSONS.map(lesson => lesson.title), ['移動', '採集', '建造', '攻擊']);
assert.deepEqual([...TUTORIAL_STEP_END], [800, 1600, 2600, 3600]);
assert.equal(TUTORIAL_TICKS, 3600);
assert.equal(TUTORIAL_TICKS / 20, 180, '3600 tick＝3 分鐘');
for (let i = 0; i < TUTORIAL_SCRIPT.length; i++) {
  const beat = TUTORIAL_SCRIPT[i];
  assert.equal(beat.tick >= (i ? TUTORIAL_SCRIPT[i - 1].tick : 0), true, '腳本 tick 不倒退');
  const step = TUTORIAL_STEP_END.findIndex(end => beat.tick < end);
  assert.equal(step >= 0 && step < 4, true, `腳本第 ${i} 拍落在某一課`);
}

const idle = createTutorial();
tutorialClock(idle, 100000);
assert.equal(idle.tick, 799, '什麼都不做就停在移動這一課的最後一步');
assert.equal(idle.step, 0);
assert.equal(tutorialHolding(idle), true);
assert.equal(idle.flags, 0);

const moved = createTutorial();
tutorialAct(moved, { t: 'select', id: 1 });
tutorialAct(moved, { t: 'cell', x: TUTORIAL_MOVE.x, z: TUTORIAL_MOVE.z });
assert.equal(moved.flags, 1);
tutorialClock(moved, 100000);
assert.equal(moved.step, 1, '只做完移動就停在採集');
assert.equal(moved.tick, 1599);
assert.equal(moved.supply, 0);

const early = createTutorial();
tutorialAct(early, { t: 'cell', x: TUTORIAL_ENEMY.x, z: TUTORIAL_ENEMY.z });
assert.equal(early.attacked, 0, '攻擊做在移動之前不算');
assert.equal(early.flags, 0);
tutorialAct(early, { t: 'cell', x: TUTORIAL_BUILD.x, z: TUTORIAL_BUILD.z });
assert.equal(early.built, 0, '還沒選農舍、也還沒到建造這一課，蓋下去不算');

const skipped = createTutorial();
tutorialAct(skipped, { t: 'skip' });
tutorialClock(skipped, TUTORIAL_TICKS);
assert.equal(skipped.skipped, 1);
assert.equal(skipped.step, 0, '跳過不算走完');
assert.equal(skipped.tick, 0, '跳過之後時鐘不再走');
assert.equal(tutorialMark(skipped), 'skip');
assert.equal(tutorialVisible(true, tutorialMark(skipped)), false);

const done = runTutorial();
const again = runTutorial();
assert.equal(done.step, 4, '腳本走完四課');
assert.equal(done.tick, TUTORIAL_TICKS);
assert.equal(done.flags, 15);
assert.equal(done.skipped, 0);
assert.equal(done.supply, TUTORIAL_SUPPLY);
assert.equal(done.built, 1);
assert.equal(done.attacked, 1);
assert.equal(done.px, TUTORIAL_MOVE.x);
assert.equal(tutorialMark(done), 'done');
assert.equal(tutorialVisible(true, 'done'), false);
assert.equal(tutorialVisible(true, null), true, '第一次進、沒有紀錄就出現');
assert.equal(tutorialVisible(false, null), false, '閥關掉就不出現');
assert.equal(JSON.stringify(done), JSON.stringify(again), '同一份腳本兩次結果相同');

let mounted = 0;
const writes = [];
const off = initTutorial(
  { appendChild() { mounted++; } },
  false,
  { getItem() { throw new Error('valve off must not read storage'); }, setItem(key, value) { writes.push([key, value]); } },
);
off.frame(1);
off.frame(99999);
assert.equal(mounted, 0, '?noR902=1 不掛上面板');
assert.equal(off.visible(), false);
assert.equal(writes.length, 0, '?noR902=1 不寫本機紀錄');

const previousNavigator = globalThis.navigator;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { webdriver: false, userAgent: 'HeadlessChrome/0' } });
let headlessMounted = 0;
const headlessWrites = [];
const headless = initTutorial(
  { appendChild() { headlessMounted++; } },
  true,
  { getItem() { throw new Error('headless must not read storage'); }, setItem(key, value) { headlessWrites.push([key, value]); } },
);
headless.frame(1);
headless.frame(99999);
assert.equal(headlessMounted, 0, '無頭測試瀏覽器不掛面板');
assert.equal(headless.visible(), false);
assert.equal(headlessWrites.length, 0, '無頭測試瀏覽器不寫紀錄');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });

const main = read('src/main.ts');
const valves = read('src/valves.ts');
const readme = read('README.md');
assert.match(main, /initTutorial\(document\.getElementById\('hud'\) \?\? document\.body, V\.r902\)/);
assert.match(main, /tutorial\.frame\(t\)/);
assert.equal(main.includes("q.get('noR"), false);
assert.match(valves, /get r902\(\) \{ return on\('902'\); \}/);
assert.equal(readme.includes('`?noR902=1`'), true, 'README 逃生閥對照要有這一閥');

console.log('OK tutorial: script completes, skip stops, valve mounts nothing, golden unchanged');
