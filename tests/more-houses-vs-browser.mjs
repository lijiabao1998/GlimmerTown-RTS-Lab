// R087 更多房屋（兩個真的 Chrome＋本機轉發伺服器）：連線對戰，房主開 R087（noR087=0）、加入的人 ?noR087=1，走到第 600 步。
// 對戰的場面在 tools/net-harness.mjs 的 versus：雜湊比過至少兩次、沒有不同步、兩邊的紀錄在 Node 重播到各自的世界。合作在 tests/more-houses-net-browser.mjs。
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

await runOrSkip('more-houses-vs', () => netHarness({ ports: [8695, 8697] }, async ({ versus }) => {
  await versus('&noR087=0', '', 600);
  console.log('OK more-houses-vs: host R087, guest noR087, hashes compared to tick 600 with no desync');
}));
