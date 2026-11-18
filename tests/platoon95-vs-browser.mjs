// R095 步兵排（兩個真的 Chrome＋本機轉發伺服器）：連線對戰。房主與加入的人都開 R095，走到第 1,000 步，中間加入的人自己按「步兵排」替自己那一方（第 1 方）買一個排。兩台閥不一樣的情況在合作那一支。
// 雜湊比過、沒有不同步、兩邊的紀錄在 Node 重播到各自的世界（tools/net-harness.mjs 的 versus）。合作在 tests/platoon95-net-browser.mjs。
import assert from 'node:assert/strict';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

// 補給夠了就讓加入的人下排的生產指令：button＝true 時自己按生產列的「步兵排」（要看得到），不然用 __rts.issue（?noR095=1 的頁面沒有那一顆）；等指令進到兩邊的紀錄、三班在兩邊都出生
export const platoonOrder = (side, button = true) => async ({ A, B, E, until }) => {
  await until(`fixture: side ${side} can afford a platoon`, async () => (await E(B, '__rts.eco()')).supply[side] >= 66, 60000);
  if (button) assert(await E(B, "(b => !!b && !b.hidden && !!b.offsetParent)(document.getElementById('pb-k256'))"), 'ui: the guest sees 步兵排 because the world carries the flag');
  const count = async pg => (await E(pg, '__rts.units()')).filter(u => u.alive && u.side === side && u.kind === 3).length, before = [await count(A), await count(B)];
  await E(B, button ? "document.getElementById('pb-k256').click()" : `__rts.issue(${JSON.stringify({ t: 'produce', side, kind: 256 })})`);
  const has = async pg => (await E(pg, '__rts.log()')).some(e => e.cmd.t === 'produce' && e.cmd.kind === 256 && e.cmd.side === side);
  await until(`platoon: the guest's platoon order reaches both logs (side ${side})`, async () => (await has(A)) && (await has(B)), 30000);
  await until(`platoon: three sections arrive on both pages (side ${side})`, async () => (await count(A)) >= before[0] + 3 && (await count(B)) >= before[1] + 3, 60000);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()))
  await runOrSkip('platoon95-vs', () => netHarness({ ports: [8703, 8705] }, async ({ versus }) => {
    await versus('&noR095=0', '&noR095=0', 1000, platoonOrder(1));
    console.log('OK platoon95-vs: the joiner bought a platoon for its own side, hashes compared to tick 1000');
  }));
