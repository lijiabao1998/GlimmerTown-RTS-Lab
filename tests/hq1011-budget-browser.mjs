// R1011 驗收 22：預算（真的 Chrome，手機 412×860；CI 是 SwiftShader）。
//   一、開局（布陣）與開戰那一刻的繪製呼叫、三角形跟 ?noR1011=1 一模一樣，而且在鐵律之內（≤ 20 次、≤ 80,000 個三角形，含陰影那一趟）。
//   二、__rts.playLog 餵一份雙方指揮部都升到第 2 級的紀錄（沒有電腦）：跟同一份紀錄不升級的比，繪製呼叫不多、仍 ≤ 20，三角形最多多 400（zoom 1 與 0.55 各量三次取最大）。
//   三、同一個建置裡把 hq1011Art 換成每座多畫 200 個方塊的故意弄壞版（只在這支守衛的建置裡、只在 window.__fat1011 開著時），第二條要紅。
//   樣張：shots/r1011-hq-level0.png、shots/r1011-hq-level2.png（近拍我方指揮部）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { withBrowser, shot, ROOT } from '../tools/cdp.mjs';
import { runOrSkip } from '../tools/net-harness.mjs';
import { fixture89, measure } from '../tools/r089-fixture.mjs';
import { createWorld, hashWorld } from '../src/sim/world.ts';
import { runLog } from '../src/sim/step.ts';

// 故意弄壞版（只在這支守衛的建置裡）：window.__fat1011 開著時，每座升過級的指揮部多畫 200 個方塊
const HEAD = 'export function hq1011Art(g: Geo, b: Building): void {';
const fat1011 = root => ({ name: 'r1011-fat', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/render/hq1011.ts') return;
  assert.equal(code.split(HEAD).length - 1, 1, 'budget: fixture — the fat mutant finds hq1011Art');
  return code.replace(HEAD, `${HEAD}\n  if ((globalThis as { __fat1011?: boolean }).__fat1011) for (let k = 0; k < 200; k++) g.box(b.x + 0.2 + (k % 20) * 0.08, 0.3 + Math.floor(k / 20) * 0.05, b.z + 0.2, b.x + 0.25 + (k % 20) * 0.08, 0.33 + Math.floor(k / 20) * 0.05, b.z + 0.25, WET);`);
} });
const shots = path.join(ROOT, 'shots'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r1011-budget-'));
const ECO11 = { t: 'eco', inf: 1, guns: 1, tanks: 1, sw: 2, tech: 1, hq11: 1 };
const log = up => [{ tick: 0, cmd: { t: 'map', id: 1, vegetation: 1 } }, { tick: 0, cmd: ECO11 },
  ...(up ? [{ tick: 0, cmd: { t: 'produce', side: 0, kind: 1201 } }, { tick: 0, cmd: { t: 'produce', side: 1, kind: 1201 } }, { tick: 300, cmd: { t: 'produce', side: 0, kind: 1202 } }, { tick: 300, cmd: { t: 'produce', side: 1, kind: 1202 } }] : [])];
const TICKS = 720;
const ok = (base, m) => m.calls <= base.calls && m.calls <= 20 && m.triangles - base.triangles <= 400 && m.triangles <= 80000;
await runOrSkip('hq1011-budget', async () => {
  try {
    fs.mkdirSync(shots, { recursive: true });
    await build({ root: ROOT, logLevel: 'error', plugins: [fixture89(ROOT), fat1011(ROOT)], build: { outDir: tmp } });
    await withBrowser({ root: tmp, width: 412, height: 860, mobile: true, port: 9712 }, async ({ open, page }) => {
      const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
      // 一、開局與開戰那一刻
      const opening = async q => { await open(`${q}&noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1`); await E('__rts.pause(true); 0'); const a = await measure(E, frames); await E('__rts.startBattle(); __rts.pause(true); __r089.clean(); 0'); return [a, await measure(E, frames)]; };
      const [on0, on1] = await opening('noR1011=0'), [off0, off1] = await opening('noR1011=1');
      assert.deepEqual([[on0.calls, on0.triangles], [on1.calls, on1.triangles]], [[off0.calls, off0.triangles], [off1.calls, off1.triangles]], `budget: the opening and the first battle frame draw exactly what they drew without R1011 (${on0.calls}/${on0.triangles}, ${on1.calls}/${on1.triangles})`);
      assert(on0.calls <= 20 && on0.triangles <= 80000 && on1.calls <= 20 && on1.triangles <= 80000, 'budget: the opening is inside the phone budget (20 calls, 80,000 triangles)');
      // 二、雙方指揮部第 2 級 vs 同一份紀錄不升級（noR018＝沒有電腦：走時間時兩邊都不出兵、不動）
      await open('noR1011=0&noR050=0&noR1002=0&noR091=0&seed=1944&noR100=1&noR018=1'); await E('__rts.pause(true); 0');
      const settle = async () => { await E('__rts.stepN(20); __rts.pause(true); __r089.clean(); 0'); for (let k = 0; k < 4; k++) await frames(); const r = await E('__rts.rising().rising'); assert.equal(r, 0, `budget: fixture — no building is still rising when measured (${r})`); };
      const worst = async (cx, cz, zoom) => { await E(`__r089.cam(${cx}, ${cz}, ${zoom})`); let m = null; for (let i = 0; i < 3; i++) { const x = await measure(E, frames); if (!m || x.triangles > m.triangles || x.calls > m.calls) m = x; } return m; };
      const play = async up => {
        const lg = log(up), h = await E(`__rts.playLog(1944, ${JSON.stringify(lg)}, ${TICKS})`);
        assert.equal(h, hashWorld(runLog(createWorld(1944), lg, TICKS)), `budget: fixture — the page replays the ${up ? 'upgrade' : 'plain'} log to the Node hash`);
        await settle();
        const lv = await E('__rts.blds().filter(b => b.kind === 5).map(b => b.hqLv ?? 0)');
        assert.deepEqual(lv, up ? [2, 2] : [0, 0], `budget: fixture — both HQs at level ${up ? 2 : 0}`);
        return { 1: await worst(16, 16, 1), 0.55: await worst(16, 16, 0.55) };
      };
      const near = async name => { const [x, z] = await E('(() => { const b = __rts.blds().find(b => b.kind === 5 && b.builtBy === 0); return [b.x + 1, b.z + 1]; })()'); await E(`__r089.cam(${x}, ${z}, 3)`); await frames(); await frames(); await shot(page, path.join(shots, `r1011-hq-${name}.png`)); };
      const base = await play(false); await near('level0');
      const up = await play(true); await near('level2');
      const got = [];
      for (const zoom of [1, 0.55]) {
        const b = base[zoom], m = up[zoom];
        got.push(`zoom ${zoom}: ${b.calls}/${b.triangles} → ${m.calls}/${m.triangles} (+${m.triangles - b.triangles})`);
        assert(m.triangles > b.triangles, `budget: fixture — the level 2 HQs are really drawn (${got.at(-1)})`);
        assert(ok(b, m), `budget: at zoom ${zoom} two level-2 HQs add no draw call, stay within 20 calls and add at most 400 triangles (${got.at(-1)})`);
      }
      // 三、故意弄壞：每座多畫 200 個方塊，同一條要紅
      await E('window.__fat1011 = true; 0');
      const fat = await play(true), bad = [1, 0.55].filter(zoom => !ok(base[zoom], fat[zoom]));
      assert.deepEqual(bad, [1, 0.55], `budget: the fat mutant (200 boxes more per HQ) fails that check at both zooms (${[1, 0.55].map(z => `${base[z].triangles} → ${fat[z].triangles}`).join(', ')})`);
      await E('window.__fat1011 = false; 0');
      assert.equal(page.errors.length, 0, `page: no page errors (${page.errors.join(' | ').slice(0, 300)})`);
      console.log(`hq1011 budget: opening ${on0.calls}/${on0.triangles}, battle ${on1.calls}/${on1.triangles} (same as noR1011=1); ${got.join(' · ')}; fat mutant ${[1, 0.55].map(z => `+${fat[z].triangles - base[z].triangles}`).join('/')} red; shots/r1011-hq-level0.png, level2.png`);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
