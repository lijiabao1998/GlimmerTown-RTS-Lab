// R085 連線對戰：兩個真的 Chrome（各開一頁）＋本機的轉發伺服器。場面在 tools/net-harness.mjs 的 versus。
// 房主開對戰的房、對方用連結加入；等的時候鍵盤留在「等房主開戰」那一層、開戰時開始選單從設定頁也關掉（R083 第二輪審查）；
// 兩邊都沒有電腦；房主全選只選到第 0 方、對方只選到第 1 方；對方的鏡頭在左上；對方看得到自己的、看不到霧裡的第 0 方；
// 對方的生產列下的是第 1 方；偷下對方那一方的指令兩邊都丟掉；雜湊比過、兩邊的紀錄在 Node 重播得到各自的雜湊；對方換了世界之後「我方」回到第 0 方；開始選單有「連線對戰」、?noR085=1 沒有。
// 故意弄壞在 tests/versus-browser-negative.mjs（守衛單支 120 秒上限）。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

await runOrSkip('R085', () => netHarness({ ports: [8681, 8683] }, async ({ errors, versus }) => {
  await versus();
  assert.deepEqual(errors(), [], 'browser: zero page errors');
  console.log('OK R085: versus room by link, keyboard kept in the overlay, no computer, each side selects and sees its own, guest camera top-left, production for side 1, cross-side orders dropped, hashes compared, logs replay, back to side 0 after leaving, menu button and valve');
}));
