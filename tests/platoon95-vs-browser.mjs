// R095 步兵排（兩個真的 Chrome＋本機轉發伺服器）：連線對戰。房主開 R095、加入的人 ?noR095=1，走到第 1,000 步，中間加入的人替自己那一方（第 1 方）買一個排。
// 雜湊比過、沒有不同步、兩邊的紀錄在 Node 重播到各自的世界（tools/net-harness.mjs 的 versus）。合作在 tests/platoon95-net-browser.mjs。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

// 補給夠了就讓加入的人（?noR095=1）自己按生產列的「步兵排」——世界帶 pla，按鈕就要在；等指令進到兩邊的紀錄、三班在兩邊都出生
export const platoonOrder = side => async ({ A, B, E, until }) => {
  await until(`fixture: side ${side} can afford a platoon`, async () => (await E(B, '__rts.eco()')).supply[side] >= 66, 60000);
  assert(await E(B, "(b => !!b && !b.hidden && !!b.offsetParent)(document.getElementById('pb-k256'))"), 'ui: the guest on ?noR095=1 sees 步兵排 because the world carries the flag');
  const count = async pg => (await E(pg, '__rts.units()')).filter(u => u.alive && u.side === side && u.kind === 3).length, before = [await count(A), await count(B)];
  await E(B, "document.getElementById('pb-k256').click()");
  const has = async pg => (await E(pg, '__rts.log()')).some(e => e.cmd.t === 'produce' && e.cmd.kind === 256 && e.cmd.side === side);
  await until(`platoon: the guest's platoon order reaches both logs (side ${side})`, async () => (await has(A)) && (await has(B)), 30000);
  await until(`platoon: three sections arrive on both pages (side ${side})`, async () => (await count(A)) >= before[0] + 3 && (await count(B)) >= before[1] + 3, 60000);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()))
  await runOrSkip('platoon95-vs', () => netHarness({ ports: [8703, 8705] }, async ({ versus }) => {
    await versus('&noR095=0', '&noR095=1', 1000, platoonOrder(1));
    console.log('OK platoon95-vs: the joiner bought a platoon for its own side, hashes compared to tick 1000');
  }));
