// R095 步兵排（兩個真的 Chrome＋本機轉發伺服器）：連線對戰。房主開 R095、加入的人 ?noR095=1，走到第 1,000 步，中間加入的人替自己那一方（第 1 方）買一個排。
// 雜湊比過、沒有不同步、兩邊的紀錄在 Node 重播到各自的世界（tools/net-harness.mjs 的 versus）。合作在 tests/platoon95-net-browser.mjs。
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

// 補給夠了就讓加入的人替 side 下排的生產指令，等它進到兩邊的紀錄
export const platoonOrder = side => async ({ A, B, E, until }) => {
  await until(`fixture: side ${side} can afford a platoon`, async () => (await E(B, '__rts.eco()')).supply[side] >= 66, 60000);
  await E(B, `__rts.issue(${JSON.stringify({ t: 'produce', side, kind: 256 })})`);
  const has = async pg => (await E(pg, '__rts.log()')).some(e => e.cmd.t === 'produce' && e.cmd.kind === 256 && e.cmd.side === side);
  await until(`platoon: the guest's platoon order reaches both logs (side ${side})`, async () => (await has(A)) && (await has(B)), 30000);
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()))
  await runOrSkip('platoon95-vs', () => netHarness({ ports: [8703, 8705] }, async ({ versus }) => {
    await versus('&noR095=0', '&noR095=1', 1000, platoonOrder(1));
    console.log('OK platoon95-vs: the joiner bought a platoon for its own side, hashes compared to tick 1000');
  }));
