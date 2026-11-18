// R090 海斯（地圖 5）連線合作（兩個真的 Chrome＋本機轉發伺服器）：房主開 ?map=hythe，加入的人照房主的開局；走到第 TICKS 步，雜湊比過、沒有不同步、
// 兩邊的紀錄在 Node 重播到各自的世界（tools/net-harness.mjs 的 together）。卡面寫 1,200 步；CI 每支 120 秒，128 圖在 SwiftShader 上走不到那麼快，
// 預設 600 步（R095 也是這樣），本機可以 HYTHE_NET_TICKS=1200 跑完整的。不同步與 6,000 步在 tests/hythe-net.mjs（Node）。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

const TICKS = Number(process.env.HYTHE_NET_TICKS ?? 600);
await runOrSkip('hythe-net', () => netHarness({ ports: [8711, 8713] }, async ({ together, A, B }) => {
  await together('&map=hythe', '&map=hythe', TICKS);
  const [ma, mb] = [await A.page.evaluate('[__rts.map(), __rts.mapSize()]'), await B.page.evaluate('[__rts.map(), __rts.mapSize()]')];
  assert.deepEqual([ma, mb], [[5, 128], [5, 128]], 'co-op: both pages play map 5 (128×128)');
  console.log(`OK hythe-net co-op: map 5 on both pages, hashes compared to tick ${TICKS}, no desync`);
}));
