// R902：教學腳本走得完、跳得過、關得掉；既有腳本戰鬥的雜湊不動。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashWorld } from '../src/sim/world.ts';
import { SCRIPT, runScript } from '../src/sim/script.ts';
import {
  TUTORIAL_BUILD, TUTORIAL_ENEMY, TUTORIAL_LESSONS, TUTORIAL_MOVE, TUTORIAL_SCRIPT, TUTORIAL_STEP_END, TUTORIAL_STORE_KEY, TUTORIAL_SUPPLY, TUTORIAL_SUPPLY_CELL, TUTORIAL_TICKS,
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
assert.equal(idle.tick, TUTORIAL_TICKS, '時間走完停在三分鐘');
assert.equal(idle.step, 0, '時間到不換課');
assert.equal(tutorialHolding(idle), true);
assert.equal(idle.flags, 0);

const moved = createTutorial();
tutorialAct(moved, { t: 'select', id: 1 });
tutorialAct(moved, { t: 'cell', x: TUTORIAL_MOVE.x, z: TUTORIAL_MOVE.z });
assert.equal(moved.flags, 1);
assert.equal(moved.step, 1, '做完移動立刻進採集');
tutorialClock(moved, 100000);
assert.equal(moved.step, 1, '之後時間再走也不跳過採集');
assert.equal(moved.tick, TUTORIAL_TICKS);
assert.equal(moved.supply, 0);

{
  const s = createTutorial();
  const goals = [
    () => { tutorialAct(s, { t: 'select', id: 1 }); tutorialAct(s, { t: 'cell', x: TUTORIAL_MOVE.x, z: TUTORIAL_MOVE.z }); },
    () => { tutorialAct(s, { t: 'select', id: 1 }); tutorialAct(s, { t: 'cell', x: TUTORIAL_SUPPLY_CELL.x, z: TUTORIAL_SUPPLY_CELL.z }); },
    () => { tutorialAct(s, { t: 'tool' }); tutorialAct(s, { t: 'cell', x: TUTORIAL_BUILD.x, z: TUTORIAL_BUILD.z }); },
    () => { tutorialAct(s, { t: 'cell', x: TUTORIAL_ENEMY.x, z: TUTORIAL_ENEMY.z }); },
  ];
  for (let i = 0; i < 4; i++) {
    assert.equal(s.step, i, `第 ${i + 1} 課從這一課開始`);
    const tick = s.tick;
    goals[i]();
    assert.equal(s.step, i + 1, `做完第 ${i + 1} 課才前進`);
    assert.equal((s.flags & (1 << i)) !== 0, true, `第 ${i + 1} 課旗標立起`);
    tutorialClock(s, 50);
    if (i < 3) {
      assert.equal(s.step, i + 1, `第 ${i + 1} 課之後時間不自動換課`);
      assert.equal(s.tick, tick + 50);
    } else {
      assert.equal(s.step, 4, '做完攻擊就結束');
      assert.equal(s.tick, tick, '做完最後一課之後時鐘不再走');
    }
  }
  assert.equal(s.step, 4);
  assert.equal(s.flags, 15);
}
{
  const s = createTutorial();
  for (let i = 0; i < 4; i++) {
    assert.equal(s.step, i, `下一步前停在第 ${i + 1} 課`);
    tutorialAct(s, { t: 'next' });
    assert.equal((s.flags & (1 << i)) === 0, true, `下一步不算做完第 ${i + 1} 課`);
    assert.equal(s.step, i + 1, `下一步離開第 ${i + 1} 課`);
  }
  assert.equal(s.flags, 0);
  assert.equal(tutorialMark(s), 'done');
}

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
assert.equal(done.tick, 2800, '最後一課做完就結束，不等時間走完');
assert.equal(done.flags, 15);
assert.equal(done.skipped, 0);
assert.equal(done.supply, TUTORIAL_SUPPLY);
assert.equal(done.built, 1);
assert.equal(done.attacked, 1);
assert.equal(done.px, TUTORIAL_MOVE.x);
assert.equal(tutorialMark(done), 'done');
assert.equal(tutorialVisible(true, 'done'), false);
assert.equal(tutorialVisible(true, null), true, '沒做完、閥開著，玩家還可以自己打開');
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

for (const mark of ['done', 'skip']) {
  let seen = 0;
  const held = initTutorial(
    { appendChild() { mounted++; } },
    true,
    { getItem() { seen++; return mark; }, setItem() { writes.push(mark); } },
  );
  held.frame(1);
  assert.equal(seen, 1, `${mark} 會讀紀錄`);
  assert.equal(held.visible(), false, `已是 ${mark} 就不再掛面板`);
}
assert.equal(mounted, 0, '做完或跳過都不掛面板');
assert.equal(writes.length, 0, '做完或跳過不再寫紀錄');

const ui = read('src/ui/tutorial.ts');
assert.equal(/HeadlessChrome|webdriver/.test(ui), false, '不偵測無頭瀏覽器');
assert.equal(ui.includes('新手教學'), true, '入口文字是新手教學');
assert.match(ui, /root\.hidden = true/, '面板先收著，不會自己彈出');
assert.equal(ui.includes("root.addEventListener('click'"), false, '面板本體不接點擊');

const main = read('src/main.ts');
const valves = read('src/valves.ts');
const readme = read('README.md');
assert.match(main, /initTutorial\(document\.getElementById\('hud'\) \?\? document\.body, V\.r902\)/);
assert.match(main, /tutorial\.frame\(t\)/);
assert.equal(main.includes("t: 'tutorial'"), false, '總機不再發教學停火指令');
assert.equal(main.includes("q.get('noR"), false);
assert.match(valves, /get r902\(\) \{ return on\('902'\); \}/);
assert.equal(readme.includes('`?noR902=1`'), true, 'README 逃生閥對照要有這一閥');
assert.equal(read('src/sim/step.ts').includes("t: 'tutorial'"), false, '模擬不再有教學停火指令');
assert.equal(read('src/sim/world.ts').includes('tutorial?:'), false, '世界不再有教學停火欄位');

console.log('OK tutorial: script completes, skip stops, valve mounts nothing, golden unchanged');
