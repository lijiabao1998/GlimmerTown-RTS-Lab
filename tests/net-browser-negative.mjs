// R083 連線合作的故意弄壞：真的 Chrome 跑 tests/net-browser.mjs 的同一套場面（tools/net-harness.mjs），
// 只是編進休眠的故意弄壞（網址帶 __r083mutant 才生效），確認第一個紅燈落在指定的斷言上。
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../tools/cdp.mjs';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

const mutations = {
  nolog: ['src/main.ts', '  if (!netLive()) log.push(', "  if (!netLive() || location.search.includes('__r083mutant=nolog')) log.push(", 1],
  nogate: ['src/main.ts', '{ if (!netReady(w.tick)) break; acc -=', "{ if (!netReady(w.tick) && !location.search.includes('__r083mutant=nogate')) break; acc -=", 1],
  nomenu: ['src/ui/startMenu.ts', "if (v.kind === 'start' && v.net) extra.push(", "if (v.kind === 'start' && v.net && !location.search.includes('__r083mutant=nomenu')) extra.push(", 1],
  menustays: ['src/net/client.ts', "    if (m.t === 'start') { mark(); closePanel(); (document.querySelector(", "    if (m.t === 'start' && !location.search.includes('__r083mutant=menustays')) { mark(); closePanel(); (document.querySelector(", 1],   // R085：同一行多了 mark()
  nodrop: ['src/net/client.ts', 'function dropIfStale(): void { if (session?.stale()) {', "function dropIfStale(): void { if (session?.stale() && !location.search.includes('__r083mutant=nodrop')) {", 1],
};
const applied = new Set();
const plugin = { name: 'r083-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };

await runOrSkip('R083 negative', () => netHarness({ plugins: [plugin], ports: [8677, 8679] }, async ({ A, B, together, teardown, menu }) => {
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const negatives = [
    ['nolog', () => together('&__r083mutant=nolog'), 'logs: the '],   // 記兩次的指令讓其中一邊的紀錄重播不出自己的世界（哪一邊先紅看那個指令有沒有影響結局）
    ['nogate', () => together('&__r083mutant=nogate'), 'sync: no page errors on either side'],
    ['nomenu', () => menu('__r083mutant=nomenu'), 'menu: the start menu offers'],
    ['menustays', () => teardown('&__r083mutant=menustays'), "link: when the host starts, the guest's start menu"],
    ['nodrop', () => teardown('&__r083mutant=nodrop', 6000), 'teardown: once the host replaces its world'],   // 不斷線：房主的新世界卡在舊的鎖步裡，對方一直等不到「離開」
  ];
  for (const [name, run, want] of negatives) {
    const prefixes = [want].flat(), prefix = prefixes.join('」或「');
    // 上一個故意弄壞的頁面（例如 nogate 那一頁）還在跑、還在丟錯：先把兩頁都換成空白頁，再清掉錯誤
    for (const pg of [A, B]) await pg.page.send('Page.navigate', { url: 'about:blank' });
    await new Promise(r => setTimeout(r, 500));
    A.page.errors.length = 0; B.page.errors.length = 0;
    let failure;
    try { await run(); } catch (e) { failure = e; }
    assert(failure instanceof assert.AssertionError && prefixes.some(p => failure.message.startsWith(p)), `negative ${name}: expected first red "${prefix}", got ${failure?.stack ?? 'no failure'}`);
    console.log(`RED R083 ${name}: ${failure.message.split('\n')[0]}`);
  }
}));
