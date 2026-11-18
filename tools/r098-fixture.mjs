// R098 瀏覽器守衛與量測共用的夾具（只在測試的建置裡）：tests/ground98-browser.mjs、tools/r098-time.mjs。
// 夾具接在 main.ts 後面（拿得到 w、view、renderer、style、planner），露出：
//   check()：把顯示卡上的地面貼圖讀回來，跟同一份 groundPx 另外整張上傳的一張貼圖（用同一條路讀回）逐位比，順便收 gl.getError()；
//   town128()／deploy128()：開戰後／布陣時把世界換成鋪滿 128 格的河鎮（tools/tile128.mjs 的同一套規則）；
//   valve(on)：同一頁裡切閥；once(kind)：地面上傳的一幀（none／full／he／tracks／quarter，含 readPixels 1×1 等顯示卡做完）；
//   garrison(k)＋stageOnce()：k 個進駐單位、讓別的房子換段，同一個 rAF 的 onEvents＋update＋render；plan()＋tapOnce()：布陣時點一下（放一棟、拿掉一棟的 refreshPreview 平均）。
// 正式的入口與產物沒有這些掛勾。
import path from 'node:path';
import fs from 'node:fs';

const TILE = fs.readFileSync(new URL('./tile128.mjs', import.meta.url), 'utf8').replace(/^export /m, '');

export const fixture98 = root => ({ name: 'r098-fixture', enforce: 'pre', transform(code, id) {
  if (path.relative(root, id.split('?')[0]).replaceAll('\\', '/') !== 'src/main.ts') return;
  return code + `
import { buildError as buildError98 } from './sim/build.ts';
window.__r098 = (() => {
  ${TILE}
  const gl = () => renderer.getContext();
  const read = tex => {
    const g = gl(), t = renderer.properties.get(tex).__webglTexture, fb = g.createFramebuffer(), n = tex.image.width, out = new Uint8Array(n * n * 4);
    g.bindFramebuffer(g.FRAMEBUFFER, fb); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
    g.readPixels(0, 0, n, n, g.RGBA, g.UNSIGNED_BYTE, out);
    g.bindFramebuffer(g.FRAMEBUFFER, null); g.deleteFramebuffer(fb); renderer.resetState(); return out;
  };
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const sync = () => { const p = new Uint8Array(4), g = gl(); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, p); };
  // 只等顯示卡做完：從一張 1×1 的小貼圖讀一個像素（從畫面的後緩衝讀要先處理整張畫面，量上傳時太吵）
  let tiny = null;
  const wait = () => {
    const g = gl();
    if (!tiny) { const t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, null); tiny = g.createFramebuffer(); g.bindFramebuffer(g.FRAMEBUFFER, tiny); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0); }
    g.bindFramebuffer(g.FRAMEBUFFER, tiny); const p = new Uint8Array(4); g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, p); g.bindFramebuffer(g.FRAMEBUFFER, null); renderer.resetState();
  };
  const frame = () => { view.render(renderer, style, innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2)); sync(); };
  const paint = (x, z) => view['paintCell'](x, z);
  return {
    check: () => {
      const g = gl(), err = g.getError(), tex = view.groundTex, n = tex.image.width;
      const ref = new THREE.DataTexture(Uint8Array.from(view.groundPx), n, n);
      ref.colorSpace = tex.colorSpace; ref.magFilter = ref.minFilter = THREE.NearestFilter; ref.needsUpdate = true; renderer.initTexture(ref);
      const a = read(tex), b = read(ref); ref.dispose();
      let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return { n, diff, err, err2: g.getError(), uploads: view['up98'].uploads };
    },
    town128: () => { paused = true; w = tile128(w); view.setWorld(w, -1); return { n: w.n, blds: w.blds.length }; },
    deploy128: () => { paused = true; w = tile128(w); planner.refreshPreview(); return { n: w.n, blds: w.blds.length }; },
    // 量測（tools/r098-time.mjs）：閥在同一頁裡輪流開關（setView98），一次量一幀，交錯取中位數，機器負載飄動時兩邊受的影響一樣
    valve: on => { setView98(on); return on; },
    once: kind => {
      paused = true; const n = view['n'];
      if (kind === 'full') view['up98'].full(view.groundTex);
      else if (kind === 'he') { paint(n >> 1, n >> 1); view['up98'].dirty(view.groundTex); }
      else if (kind === 'tracks') { for (const [cx, cz] of [[n >> 2, n >> 1], [(3 * n) >> 2, (n >> 1) + 3]]) for (let k = 0; k < 20; k++) paint(cx + (k % 5), cz + ((k / 5) | 0)); view['up98'].dirty(view.groundTex); }
      else if (kind === 'quarter' || kind === 'eighth') { for (let z = 0; z < n >> (kind === 'quarter' ? 2 : 3); z++) for (let x = 0; x < n; x++) paint(x, z); view['up98'].dirty(view.groundTex); }
      // 只量上傳本身（不畫整個場景：整幀的晃動比上傳大）：先等顯示卡做完，上傳（整張＝three 的 initTexture；格列＝flush），再等做完
      wait(); const full = view['up98'].full98, t0 = performance.now();
      view['up98'].flush(renderer, view.groundTex); if (full) renderer.initTexture(view.groundTex);
      wait(); const ms = performance.now() - t0; frame(); return ms;
    },
    garrison: k => {
      paused = true; view.fogOn = false;
      const c = w.n / 2, near = w.blds.filter(b => b.hp > 0 && b.kind !== 5 && !(b.kind >= 7 && b.kind <= 10)).sort((a, e) => Math.hypot(a.x - c, a.z - c) - Math.hypot(e.x - c, e.z - c) || a.id - e.id);
      const ids = [];
      for (const b of near.slice(0, k)) { const id = w.units.length + 1; w.units.push({ id, side: 0, kind: 3, x: b.x * 256 + 128, z: b.z * 256 + 128, hp: 60, alive: true, order: 0, target: 0, tx: 0, tz: 0, path: [], pathIdx: 0, cooldown: 1e9, aimX: -256, aimZ: -256 }); ids.push(id); }
      view.onEvents(ids.map(id => ({ e: 'spawn', unit: id })), view.lastT ?? 0);
      view.target.set(c, 0, c); frame(); frame();
      window.__r098stage = { others: near.slice(k + 4), r: 0, simT: (view.lastT ?? 0) + 1 };   // 換段的房子離進駐的人至少隔幾棟
      return ids.filter(id => view.unitHeight(w.units[id - 1]) > 0).length;
    },
    stageOnce: () => {
      const st = window.__r098stage, b = st.others[st.r++ % st.others.length]; b.hp = Math.max(1, Math.floor(b.hp * 0.7)); st.simT += 0.05;
      const t0 = performance.now(); view.onEvents([{ e: 'stage', bld: b.id }], st.simT); view.update(1, st.simT, selected); frame(); return performance.now() - t0;
    },
    plan: () => {
      const cand = [];
      for (let z = 0; z < w.n && cand.length < 64; z++) for (let x = 0; x < w.n && cand.length < 64; x++) { const cmd = { t: 'build', side: 0, kind: 1, x, z }; if (!buildError98(planner.previewWorld(), cmd)) cand.push(cmd); }
      planner.plan.length = 0; for (const c of cand.slice(0, 6)) planner.plan.push(c); planner.refreshPreview(); frame();
      window.__r098tap = { cand, r: 0 }; return planner.plan.length;
    },
    tapOnce: () => {
      const st = window.__r098tap, add = st.cand[6 + (st.r++ % 50)];
      let t0 = performance.now(); planner.plan.push(add); planner.refreshPreview(); const a = performance.now() - t0; frame();
      t0 = performance.now(); planner.plan.pop(); planner.refreshPreview(); const b = performance.now() - t0; frame();
      return (a + b) / 2;
    },
  };
})();
`;
} });
