// R902 新手教學腳本。跟 script.ts 的 SCRIPT 分開：不寫進對戰世界，黃金雜湊不經過這裡。
// 時鐘 20 步／秒，跟對戰同一拍，但只推進這塊演練。整數、沒有亂數、沒有現實時間。

export const TUTORIAL_STORE_KEY = 'gtrts.v1.tutorial';
export const TUTORIAL_DONE = 'done';
export const TUTORIAL_SKIP = 'skip';
export const TUTORIAL_HZ = 20;
export const TUTORIAL_TICKS = 3600; // 3 分鐘
export const TUTORIAL_SUPPLY = 8; // 這一課採回來的量；不讀布陣表
export const TUTORIAL_W = 4;
export const TUTORIAL_H = 3;

// 每一課的結束 tick（不含）。加總 3600。
export const TUTORIAL_STEP_END = [800, 1600, 2600, 3600];

export const TUTORIAL_PLAYER = { x: 0, z: 1 };
export const TUTORIAL_MOVE = { x: 3, z: 1 };
export const TUTORIAL_SUPPLY_CELL = { x: 3, z: 0 };
export const TUTORIAL_BUILD = { x: 1, z: 2 };
export const TUTORIAL_ENEMY = { x: 2, z: 2 };

export const TUTORIAL_LESSONS = [
  { title: '移動', body: '點「選我方」，再點「移到空地」。戰場上同樣是先點自己的單位，再點地面。' },
  { title: '採集', body: '點「選我方」，再點「採補給」。戰場上指揮部每秒進來 1 點補給，這一課把那件事做成可以採的一點。' },
  { title: '建造', body: '點「選農舍」，再點「蓋在空地」。戰場上是布陣時在我方半場點地面蓋房子。' },
  { title: '攻擊', body: '點「攻擊敵人」。戰場上是點敵方單位，下攻擊。' },
] as const;

export interface Tut {
  tick: number;
  step: number; // 0–3 進行中，4＝走完
  flags: number; // bit 0–3：移動、採集、建造、攻擊
  skipped: number;
  sel: number; // 0 沒選、1 我方、2 敵方
  px: number;
  pz: number;
  supply: number;
  built: number;
  attacked: number;
  tool: number; // 1＝已選農舍
}

export type TutAct =
  | { t: 'select'; id: number }
  | { t: 'cell'; x: number; z: number }
  | { t: 'tool' }
  | { t: 'skip' };

export interface TutBeat { tick: number; act: TutAct }

// 固定腳本：每一下都落在那一課的時間窗裡。runTutorial 照 tick 餵，形狀跟對戰腳本那一份一樣。
export const TUTORIAL_SCRIPT: TutBeat[] = [
  { tick: 40, act: { t: 'select', id: 1 } },
  { tick: 120, act: { t: 'cell', x: TUTORIAL_MOVE.x, z: TUTORIAL_MOVE.z } },
  { tick: 900, act: { t: 'cell', x: TUTORIAL_SUPPLY_CELL.x, z: TUTORIAL_SUPPLY_CELL.z } },
  { tick: 1700, act: { t: 'tool' } },
  { tick: 1900, act: { t: 'cell', x: TUTORIAL_BUILD.x, z: TUTORIAL_BUILD.z } },
  { tick: 2800, act: { t: 'cell', x: TUTORIAL_ENEMY.x, z: TUTORIAL_ENEMY.z } },
];

export function createTutorial(): Tut {
  return {
    tick: 0, step: 0, flags: 0, skipped: 0, sel: 0,
    px: TUTORIAL_PLAYER.x, pz: TUTORIAL_PLAYER.z,
    supply: 0, built: 0, attacked: 0, tool: 0,
  };
}

export function tutorialVisible(enabled: boolean, stored: string | null): boolean {
  return enabled && stored !== TUTORIAL_DONE && stored !== TUTORIAL_SKIP;
}

export function tutorialMark(s: Tut): string {
  if (s.skipped) return TUTORIAL_SKIP;
  if (s.step >= 4) return TUTORIAL_DONE;
  return '';
}

export function tutorialHolding(s: Tut): boolean {
  if (s.skipped || s.step >= 4) return false;
  const end = TUTORIAL_STEP_END[s.step];
  return s.tick + 1 >= end && (s.flags & (1 << s.step)) === 0;
}

export function tutorialStatus(s: Tut): string {
  const who = s.sel === 1 ? '已選我方' : '未選單位';
  const tool = s.tool ? '已選農舍' : '未選農舍';
  const built = s.built ? '已蓋農舍' : '尚未建造';
  const hit = s.attacked ? '已攻擊' : '尚未攻擊';
  return `${who}　${tool}　我方 (${s.px},${s.pz})　補給 ${s.supply}　${built}　${hit}`;
}

// 往前 n 步。當前這一動還沒做，就停在該課最後一步。
export function tutorialClock(s: Tut, n: number): void {
  const steps = n | 0;
  for (let i = 0; i < steps; i++) {
    if (s.skipped || s.step >= 4) return;
    const end = TUTORIAL_STEP_END[s.step];
    if (s.tick + 1 >= end && (s.flags & (1 << s.step)) === 0) return;
    s.tick++;
    if (s.tick >= end) {
      if (s.step >= 3) { s.step = 4; return; }
      s.step++;
    }
  }
}

export function tutorialAct(s: Tut, a: TutAct): void {
  if (s.skipped || s.step >= 4) return;
  if (a.t === 'skip') { s.skipped = 1; return; }
  if (a.t === 'select') { s.sel = a.id === 1 || a.id === 2 ? a.id : 0; return; }
  if (a.t === 'tool') { if (s.step === 2) s.tool = 1; return; }
  if (a.t !== 'cell') return;
  const x = a.x | 0, z = a.z | 0;
  if (x < 0 || z < 0 || x >= TUTORIAL_W || z >= TUTORIAL_H) return;
  if (s.step === 0 && s.sel === 1 && x === TUTORIAL_MOVE.x && z === TUTORIAL_MOVE.z) {
    s.px = x; s.pz = z; s.flags |= 1; return;
  }
  if (s.step === 1 && s.sel === 1 && x === TUTORIAL_SUPPLY_CELL.x && z === TUTORIAL_SUPPLY_CELL.z) {
    s.supply += TUTORIAL_SUPPLY; s.flags |= 2; return;
  }
  if (s.step === 2 && s.tool === 1 && x === TUTORIAL_BUILD.x && z === TUTORIAL_BUILD.z) {
    s.built = 1; s.flags |= 4; return;
  }
  if (s.step === 3 && x === TUTORIAL_ENEMY.x && z === TUTORIAL_ENEMY.z) {
    s.attacked = 1; s.sel = 2; s.flags |= 8;
  }
}

// 把固定腳本跑完。玩家在畫面上做的是同一組動作；這裡給守衛一條不會卡住的路徑。
export function runTutorial(): Tut {
  const s = createTutorial();
  let i = 0;
  while (s.step < 4 && s.skipped === 0) {
    while (i < TUTORIAL_SCRIPT.length && TUTORIAL_SCRIPT[i].tick === s.tick) {
      tutorialAct(s, TUTORIAL_SCRIPT[i].act);
      i++;
    }
    const at = s.tick;
    tutorialClock(s, 1);
    if (s.tick === at) break;
  }
  return s;
}
