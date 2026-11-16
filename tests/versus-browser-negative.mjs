// R085 連線對戰的故意弄壞：真的 Chrome 跑 tests/versus-browser.mjs 的同一個場面（tools/net-harness.mjs 的 versus），
// 只是編進休眠的故意弄壞（網址帶 __r085mutant 才生效），確認第一個紅燈落在指定的斷言上。
// 鎖步的篩選、鏡頭、自動存、閥與開始選單在 Node 那支（tests/versus.mjs）弄壞；這裡只放要真的頁面才看得出來的。
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT } from '../tools/cdp.mjs';
import { netHarness, runOrSkip } from '../tools/net-harness.mjs';

const on = name => `location.search.includes('__r085mutant=${name}')`;
const mutations = {
  kbtrap: ['src/net/client.ts', '    if (!panel) return;\n    e.stopImmediatePropagation();', `    if (!panel || ${on('kbtrap')}) return;\n    e.stopImmediatePropagation();`, 1],
  setupstays: ['src/net/client.ts', "(document.querySelector('#start-menu:not([hidden]) #sm-setup-done') as HTMLElement | null)?.click();", `if (!${on('setupstays')}) (document.querySelector('#start-menu:not([hidden]) #sm-setup-done') as HTMLElement | null)?.click();`, 1],
  noside: ['src/net/client.ts', 'setViewSide(s.versus ? TOP_LEFT : undefined);', `setViewSide(s.versus && !${on('noside')} ? TOP_LEFT : undefined);`, 1],
  fog0: ['src/render/battle.ts', 'return !this.fogOn || spotted(this.w, SIDE_PLAYER, x, z);', `return !this.fogOn || spotted(this.w, ${on('fog0')} ? 0 : SIDE_PLAYER, x, z);`, 1],
};
const applied = new Set();
const plugin = { name: 'r085-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };

await runOrSkip('R085 negative', () => netHarness({ plugins: [plugin], ports: [8685, 8687] }, async ({ A, B, versus }) => {
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const negatives = [
    ['kbtrap', 'keyboard: Tab stays inside the waiting overlay'],
    ['setupstays', "keyboard: when the host starts, the guest's start menu closes"],
    ['noside', 'versus: the host commands side 0, the guest side 1'],
    ['fog0', "versus: the guest sees its own units and not the host's"],
  ];
  for (const [name, want] of negatives) {
    for (const pg of [A, B]) await pg.page.send('Page.navigate', { url: 'about:blank' });   // 上一個故意弄壞的頁面還在跑：先換成空白頁再清錯誤
    await new Promise(r => setTimeout(r, 500));
    A.page.errors.length = 0; B.page.errors.length = 0;
    let failure;
    try { await versus(`&__r085mutant=${name}`); } catch (e) { failure = e; }
    assert(failure instanceof assert.AssertionError && failure.message.startsWith(want), `negative ${name}: expected first red "${want}", got ${failure?.stack ?? 'no failure'}`);
    console.log(`RED R085 ${name}: ${failure.message.split('\n')[0]}`);
  }
}));
