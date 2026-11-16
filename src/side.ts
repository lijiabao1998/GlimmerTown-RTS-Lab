// R085「我方」是哪一方——只給介面、畫面與總機（src/ui、src/render、src/main.ts）。單機、合作：第 0 方（右下）；連線對戰時加入的人：第 1 方（左上）。
// 模擬（src/sim）照舊從 world.ts 拿常數：模擬不知道是誰在看（tests/versus.mjs 掃原始碼）。
// 這裡是活的綁定（export let）：換了之後，所有匯入的地方下一次讀到的就是新的值，用到它們的那幾百行字一個都不用改。
import { SIDE_PLAYER as FIRST, SIDE_ENEMY as SECOND } from './sim/world.ts';

export let SIDE_PLAYER = FIRST;
export let SIDE_ENEMY = SECOND;
// 換「我方」：只認第 0、1 方，其他值當成第 0 方；不給值＝換回第 0 方（每開一局 main.ts 的 reset() 都先換回來）
export function setViewSide(side: number = FIRST): void {
  SIDE_PLAYER = side === SECOND ? SECOND : FIRST;
  SIDE_ENEMY = SIDE_PLAYER === FIRST ? SECOND : FIRST;
}
