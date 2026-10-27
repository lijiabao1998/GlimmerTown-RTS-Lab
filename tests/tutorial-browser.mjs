// R902：教學要自己點開、點得掉；412×860 開著時不蓋住其他按鈕，開戰等按鈕仍吃得到觸控。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { withBrowser, sleep, touchTap } from '../tools/cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r902-tutorial-'));
const strictCI = process.env.GITHUB_ACTIONS === 'true' || !!process.env.GITHUB_RUN_ID || !!process.env.CI;
const summary = [], record = text => { summary.push(text); console.log(text); };

function separation(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
  if (dx < 0 && dy < 0) return 0;
  if (dx < 0) return dy;
  if (dy < 0) return dx;
  return Math.hypot(dx, dy);
}

async function main() {
  const out = path.join(temp, 'dist');
  await build({ root: ROOT, logLevel: 'error', build: { outDir: out } });
  await withBrowser({ root: out, port: 33481, width: 412, height: 860, mobile: true, chromeWaitMs: 20000, readyMs: 8000, settle: 200 }, async ({ open, page }) => {
    const E = expr => page.evaluate(expr);
    const frames = () => E('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const layout = () => E(`(() => {
      const shown = el => {
        if (!el || el.closest('[hidden]')) return false;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      };
      const box = el => {
        const r = el.getBoundingClientRect();
        return { id: el.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      };
      const tut = document.getElementById('tutorial');
      const outside = [...document.querySelectorAll('button')].filter(b => shown(b) && !(tut && tut.contains(b))).map(box);
      const inside = tut ? [...tut.querySelectorAll('button')].filter(shown).map(box) : [];
      return {
        tut: tut && shown(tut) ? box(tut) : null,
        outside, inside,
        helpHidden: document.getElementById('help').hidden,
        paused: __rts.paused(),
        phase: __rts.phase(),
        key: localStorage.getItem('gtrts.v1.tutorial'),
        hasOpen: !!document.getElementById('tutorial-open'),
        hasTut: !!document.getElementById('tutorial'),
        draws: { calls: __rts.info().calls, triangles: __rts.info().triangles },
      };
    })()`);
    const arm = () => E(`(() => {
      window.__r902hit = '';
      if (window.__r902arm) return;
      window.__r902arm = true;
      document.addEventListener('pointerdown', e => {
        const t = e.target && e.target.closest ? e.target.closest('button') : null;
        window.__r902hit = t && t.id ? t.id : '';
      }, true);
    })()`);
    const touchTarget = async (x, y) => {
      await E('window.__r902hit = ""');
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(40);
      const hit = await E('window.__r902hit');
      await page.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await sleep(30);
      return hit;
    };
    const centerOf = async id => {
      const p = await E(`(() => {
        const e = document.getElementById(${JSON.stringify(id)});
        if (!e) return null;
        const r = e.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, ok: !!(hit && (hit === e || e.contains(hit))), id: hit && hit.id };
      })()`);
      assert(p && p.ok, `點得到 ${id}，實際是 ${p && p.id}`);
      return p;
    };

    await open('');
    await arm();
    let g = await layout();
    assert.equal(g.tut, null, '第一次進不會自己彈出教學');
    assert.equal(g.helpHidden, true, '說明也是收著的');
    assert.equal(g.key, null, '還沒選過，不寫紀錄');
    assert.equal(g.hasOpen, true, '說明裡有「新手教學」');
    assert.equal(g.hasTut, true, '面板先掛著但收起');
    const closedDraws = g.draws;
    assert(closedDraws.calls <= 20 && closedDraws.triangles <= 80000, '開局繪製預算');

    await open('noR902=1');
    g = await layout();
    assert.equal(g.hasTut, false, '?noR902=1 沒有教學面板');
    assert.equal(g.hasOpen, false, '?noR902=1 沒有「新手教學」');
    assert.equal(g.key, null, '?noR902=1 不寫紀錄');

    await open('');
    await arm();
    const before = (await layout()).draws;
    const helpBtn = await centerOf('b-help');
    await touchTap(page, helpBtn.x, helpBtn.y);
    await frames();
    g = await layout();
    assert.equal(g.helpHidden, false, '問號打開說明');
    const openBtn = await centerOf('tutorial-open');
    await touchTap(page, openBtn.x, openBtn.y);
    await frames();
    g = await layout();
    assert.equal(g.helpHidden, true, '打開教學時說明跟著關掉');
    assert(g.tut, 'open: 點「新手教學」後面版出現');
    assert.equal(g.phase, 'build', '打開教學不改布陣');
    assert.deepEqual(g.draws, before, '教學面板不增加繪製');
    assert(g.inside.some(b => b.id === 'tutorial-skip'), '面板上有跳過');
    for (const b of g.inside) {
      assert(b.left >= g.tut.left - 1 && b.right <= g.tut.right + 1 && b.top >= g.tut.top - 1 && b.bottom <= g.tut.bottom + 1, `${b.id} 留在面板裡面`);
    }
    const ids = g.outside.map(b => b.id);
    for (const id of ['bb-start', 'b-help', 'b-all', 'b-restart', 'b-audio', 'town-pick', 'map-pick', 'sb-enter', 'zombies-pick']) {
      assert(ids.includes(id), `畫面上要有 ${id}`);
    }
    let minGap = Infinity, nearest = '';
    for (const b of g.outside) {
      const gap = separation(g.tut, b);
      if (gap < minGap) { minGap = gap; nearest = b.id; }
      assert(gap >= 16, `cover: 412×860 教學開著時不蓋住 ${b.id}（間距 ${gap.toFixed(1)}）`);
      const at = documentPoint(b);
      const top = await E(`(() => { const hit = document.elementFromPoint(${at.x}, ${at.y}); return hit && (hit.id === ${JSON.stringify(b.id)} || (hit.closest && hit.closest(${JSON.stringify('#' + b.id)}))) ? ${JSON.stringify(b.id)} : (hit && hit.id) || ''; })()`);
      assert.equal(top, b.id, `elementFromPoint 點到 ${b.id}`);
      const touched = await touchTarget(at.x, at.y);
      assert.equal(touched, b.id, `click: 教學開著時仍點得到 ${b.id}`);
    }
    g = await layout();
    assert.equal(g.phase, 'build', '探點擊沒有把開戰按下去');
    const start = g.outside.find(b => b.id === 'bb-start');
    await touchTap(page, start.cx, start.cy);
    await frames();
    assert.equal(await E('__rts.phase()'), 'battle', 'click: 教學開著時點得到開戰');
    const skip = await centerOf('tutorial-skip');
    await touchTap(page, skip.x, skip.y);
    await frames();
    g = await layout();
    assert.equal(g.tut, null, 'close: 點「跳過」後面版收起');
    assert.equal(g.key, 'skip', '跳過寫下 skip');
    record(`R902 412×860：自己點開、跳過收起；最近的按鈕 ${nearest} 距面板 ${minGap.toFixed(1)}px；開戰點得到；繪製 ${before.calls}/${before.triangles}`);
  });
}

function documentPoint(b) {
  return { x: b.cx, y: b.cy };
}

try {
  await main();
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### R902 教學開合\n' + summary.map(s => '- ' + s).join('\n') + '\n');
} catch (error) {
  const message = String(error?.stack ?? error);
  if (/listen (?:EPERM|EACCES).*127\.0\.0\.1|socket\(\) failed: Operation not permitted/.test(message) && !strictCI) {
    console.error('NOT RUN R902 tutorial browser: local socket permission restriction; CI must execute them.');
    console.error(error.message);
    process.exitCode = 77;
  } else {
    console.error(error);
    console.error('R902 tutorial browser FAIL: ' + String(error.message).split('\n')[0]);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
