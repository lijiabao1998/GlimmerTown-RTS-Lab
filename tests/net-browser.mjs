// R083 連線合作：兩個真的 Chrome（各開一頁）＋本機的轉發伺服器（server/relay.mjs）。場面在 tools/net-harness.mjs。
// 房主開房、對方加入；房主開戰，對方進入同一局；雙方各下一個移動指令；兩邊都走過 220 步、雜湊比過、沒有不同步；
// 兩頁的指令紀錄在 Node 重播得到各自頁面上的雜湊；用連結加入（開始選單開著）；房主換了世界、對方自己繼續打；開始選單有「連線合作」、?noR083=1 沒有。
// 故意弄壞在 tests/net-browser-negative.mjs（守衛單支 120 秒上限）。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

await runOrSkip('R083', () => netHarness({ ports: [8671, 8673] }, async ({ errors, together, teardown, menu }) => {
  await together();
  await teardown();
  await menu();
  assert.deepEqual(errors(), [], 'browser: zero page errors');
  console.log('OK R083: host and guest in one battle, both orders in both logs, hashes compared, logs replay; joining by link; the host leaving by replacing its world; menu button and valve');
}));
