// R084 左右對稱：真實 Chrome。新開的局（布陣的那一刻）map 指令帶 sym＝1、世界的 sym 跟著開；?noR084=1 不帶；故意弄壞一處。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, ROOT } from '../tools/cdp.mjs';

const strictCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITHUB_RUN_ID);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r084-browser-'));
const mutations = {
  flag: ['src/main.ts', '...(V.r084 ? { sym: 1 } : {})', "...(V.r084 && !location.search.includes('__r084mutant=flag') ? { sym: 1 } : {})", 1],
};
const applied = new Set();
const plugin = { name: 'r084-dormant-negatives', enforce: 'pre', transform(code, id) {
  const rel = path.relative(ROOT, id.split('?')[0]).replaceAll('\\', '/');
  for (const [name, [file, from, to, count]] of Object.entries(mutations)) if (rel === file) {
    assert.equal(code.split(from).length - 1, count, `negative anchor: ${name}`);
    code = code.replaceAll(from, to); applied.add(name);
  }
  return code;
} };

async function main() {
  const baseline = path.join(temp, 'baseline'), broken = path.join(temp, 'broken');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: baseline } });
  await build({ root: ROOT, logLevel: 'error', plugins: [plugin], build: { outDir: broken } });
  assert.equal(applied.size, Object.keys(mutations).length, 'fixture: every dormant negative compiled once');
  const overlay = {};
  await withBrowser({ root: baseline, overlay, port: 8675, width: 412, height: 860, mobile: true, settle: 300 }, async ({ open, page }) => {
    const E = s => page.evaluate(s);
    const mapCmd = async q => { await open(q); return (await E('__rts.log()')).find(c => c.cmd.t === 'map')?.cmd; };
    const sends = async (extra = '') => {
      const m = await mapCmd(extra);
      assert.equal(m?.sym, 1, `start: a new battle's map command carries sym 1 (${JSON.stringify(m)})`);
      await E('(() => { __rts.startBattle(); })()');
      assert.equal(await E('__rts.phase()'), 'battle', 'fixture: the battle starts');
    };
    const valved = async () => {
      const m = await mapCmd('noR084=1');
      assert(m && m.sym === undefined, `valve: noR084 sends no sym (${JSON.stringify(m)})`);
    };
    await sends(); await valved();
    assert.equal(page.errors.length, 0, `browser: zero page errors (${page.errors.join(' | ')})`);
    console.log('OK R084: a new battle sends sym 1; the valve sends none');
    overlay['index.html'] = fs.readFileSync(path.join(broken, 'index.html'));
    let failure;
    try { await sends('__r084mutant=flag'); } catch (e) { failure = e; }
    assert(failure instanceof assert.AssertionError && failure.message.startsWith("start: a new battle's map command carries sym 1"), `negative flag: expected first red, got ${failure?.stack ?? 'no failure'}`);
    console.log(`RED R084 flag: ${failure.message.split('\n')[0]}`);
    delete overlay['index.html'];
  });
}

try { await main(); }
catch (e) {
  const msg = String(e?.stack ?? e);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted|找不到 Chrome/.test(msg) && !strictCI) { console.error('NOT RUN R084 Chrome: local browser unavailable; CI required'); process.exitCode = 77; }
  else { console.error(e); console.error('R084 browser FAIL: ' + String(e?.message).split('\n')[0]); process.exitCode = 1; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
