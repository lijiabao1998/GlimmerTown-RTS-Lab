// R087 更多房屋（兩個真的 Chrome＋本機轉發伺服器）：房主開 R087（noR087=0）、加入的人 ?noR087=1。
// 合作走到第 600 步：雜湊比過、沒有不同步、兩邊的紀錄在 Node 重播到第 600 步一樣；加入的人的世界有每一棟新房子
// （對戰在 tests/more-houses-vs-browser.mjs：每一場 600 步是 30 秒真實時間，兩場放一支會超過 tools/unit.mjs 的 120 秒）
// （新房子是房主開局時放的，跟著第 0 步的 map 指令的 more＝1 送過去，加入的人自己的閥不影響模擬）。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';
import { createWorld, hashWorld, BK_MILL, BK_WAREHOUSE } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

await runOrSkip('more-houses-net', () => netHarness({ ports: [8691, 8693] }, async ({ A, B, together }) => {
  const E = (pg, s) => pg.page.evaluate(s);
  await together('&noR087=0', '', 600);
  const [ba, bb] = [await E(A, '__rts.blds()'), await E(B, '__rts.blds()')], [la, lb] = [await E(A, '__rts.log()'), await E(B, '__rts.log()')], seed = await E(A, '__rts.seed()');
  assert.equal(la.find(e => e.cmd.t === 'map')?.cmd.more, 1, "co-op: the host's opening map command carries more 1");
  assert(bb.some(b => b.kind === BK_MILL) && bb.filter(b => b.kind === BK_WAREHOUSE).length === 3, "co-op: the guest's world has the Rye mill and the three Strand warehouses");
  assert.deepEqual(bb.map(b => [b.id, b.kind, b.x, b.z, b.w, b.d]), ba.map(b => [b.id, b.kind, b.x, b.z, b.w, b.d]), 'co-op: the guest has every house the host has');
  assert.equal(hashWorld(runLog(createWorld(seed), lb, 600)), hashWorld(runLog(createWorld(seed), la, 600)), 'co-op: both logs replay to the same tick-600 hash');
  console.log('OK more-houses-net co-op: host R087, guest noR087, same houses and same tick-600 hash');
}));
