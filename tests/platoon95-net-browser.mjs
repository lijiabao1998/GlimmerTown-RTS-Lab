// R095 步兵排（兩個真的 Chrome＋本機轉發伺服器）：連線合作。房主開 R095（noR095=0）、加入的人 ?noR095=1（兩台閥不一樣），走到第 600 步，
// 中間加入的人替我方下排的生產指令（?noR095=1 的頁面沒有「步兵排」那一顆，用 __rts.issue；按鈕那一條在對戰那一支）。雜湊比過、沒有不同步、兩邊的紀錄在 Node 重播到各自的世界（tools/net-harness.mjs）。對戰在 tests/platoon95-vs-browser.mjs。
// 600 步（不是卡面原本寫的 2,000）：一步 50 毫秒，2,000 步要 100 秒，CI 每支守衛 120 秒上限；合作有電腦在算，這台筆電一秒只走 10 步左右（排在第 160 步左右下、第 460 步左右出生，都在 600 步以內）。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';
import { platoonOrder } from './platoon95-vs-browser.mjs';

await runOrSkip('platoon95-net', () => netHarness({ ports: [8699, 8701] }, async ({ together, A, B }) => {
  await together('&noR095=0', '&noR095=1', 600, platoonOrder(0, false));
  const [la, lb] = [await A.page.evaluate('__rts.log()'), await B.page.evaluate('__rts.log()')];
  assert(la.some(e => e.cmd.t === 'eco' && e.cmd.pla === 1) && lb.some(e => e.cmd.t === 'eco' && e.cmd.pla === 1), 'co-op: the host decides the flag; the guest on ?noR095=1 plays the same battle');
  console.log('OK platoon95-net co-op: host R095, guest noR095, platoon ordered by the guest, hashes compared to tick 600');
}));
