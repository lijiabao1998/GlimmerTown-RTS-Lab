// R086 房屋細化（真的 Chrome）：同一份建置、同一個鏡頭（暫停）。
// 1. 只開「省面」（新樣子關掉，網址 r086CullOnly 切）跟 ?noR086=1 截圖比：看不見的面不畫細節，畫面上看不出來（差異 ≤ 0.05% 的像素）。
// 2. ?noR134=1 跟 ?noR134=1&noR086=1 截圖一模一樣（R086 只在 R134 開著時有作用）。
// 3. 三角形：?noR086=1 減開著＝ Node 算的整鎮差 × 2（主畫面＋陰影）；兩邊繪製次數一樣、世界雜湊一樣。
// 4. 預算：開局 ≤ 20 次繪製／80,000；近景 ≤ 22／80,000。
// 5. 開關對照圖存到 shots/r086-*.png（CI 附件；卡面引用）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'vite';
import { withBrowser, shot } from '../tools/cdp.mjs';

const root = path.resolve(import.meta.dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r086-browser-')), shots = path.join(root, 'shots');
const B = await import('../src/render/buildings.ts'), { Geo } = await import('../src/render/geo.ts');
const prod = art => { B.setWalls(true); B.setWireDetail(true); B.setMaterials(true); B.setBuildingDetails(true); B.setDamageDetails(true); B.setFacades(true); B.setHouseArt(art); };
// 只開省面：r086CullOnly 時把新樣子那一道關掉（同一份建置）；暫停並擺鏡頭
const fixture = { name: 'r086-cull-only', enforce: 'pre', transform(code, id) {
  const file = path.relative(root, id.split('?')[0]).replaceAll('\\', '/');
  if (file === 'src/render/buildings.ts') {
    const anchor = 'const artOn = () => houseArtOn && buildingDetailsOn; // R086 art';
    assert.equal(code.split(anchor).length, 2, 'fixture: the art gate is unique');
    return code.replace(anchor, "const artOn = () => houseArtOn && buildingDetailsOn && !new URLSearchParams(location.search).has('r086CullOnly'); // R086 art");
  }
  if (file === 'src/main.ts') return code + '\nwindow.__r086Cam=(x,z,zoom)=>{paused=true;view.target.set(x,0,z);view.zoomBy(zoom/view.zoom);};';
} };
// PNG（8 位元 RGB／RGBA、不交錯）解碼：比像素用
function png(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; } else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}
// 兩張截圖不一樣的像素（位置清單）；寫一張差異圖（不一樣的地方是紅點，其他是淡灰的原圖）
const diffPixels = (fa, fb, out) => {
  const a = png(fs.readFileSync(fa)), b = png(fs.readFileSync(fb));
  assert.deepEqual([a.w, a.h], [b.w, b.h], 'fixture: same screenshot size');
  const list = [], img = Buffer.alloc(a.w * a.h * 3);
  for (let i = 0; i < a.w * a.h; i++) {
    let same = true; for (let k = 0; k < 3; k++) if (a.data[i * a.bpp + k] !== b.data[i * b.bpp + k]) same = false;
    if (!same) { list.push([i % a.w, Math.floor(i / a.w)]); img[i * 3] = 255; }
    else { const g = (a.data[i * a.bpp] + a.data[i * a.bpp + 1] + a.data[i * a.bpp + 2]) / 6 + 120; img[i * 3] = img[i * 3 + 1] = img[i * 3 + 2] = g; }
  }
  if (out) fs.writeFileSync(out, encodePng(a.w, a.h, img));
  return { list, total: a.w * a.h };
};
// PNG 編碼（RGB、不濾波）：差異圖用
function encodePng(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// 點到線段的距離（像素）
const segDist = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const nodeDelta = blds => { const w = { blds, wires: { segments: [] } }; prod(false); const off = B.buildTown(w).triangles; prod(true); return off - B.buildTown(w).triangles; };

try {
  await build({ root, logLevel: 'error', plugins: [fixture], build: { outDir: tmp } });
  await withBrowser({ root: tmp, width: 1440, height: 900, port: 9985 }, async ({ open, page }) => {
    const E = s => page.evaluate(s), frames = () => E('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    const view = async (name, query, cam, size) => {
      await page.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: size[0] < 600 });
      await open(query);
      if (typeof cam === 'number') cam = await E(`(() => { const b = __rts.blds().filter(b => b.kind === ${cam} && b.hp > 0).sort((a, b) => b.w * b.d - a.w * a.d || a.id - b.id)[0]; return [b.x + b.w / 2, b.z + b.d / 2, 3]; })()`);   // 那一種的第一棟（大的先）近拍
      if (cam) await E(`__r086Cam(${cam.join(',')})`); else await E('__rts.pause(true)');
      await frames();
      const file = path.join(shots, `r086-${name}.png`);
      await shot(page, file);
      return { file, info: await E('__rts.info()'), hash: await E('__rts.hash()'), blds: await E('__rts.blds()'), errors: [...page.errors] };
    };
    const phone = [412, 860], desk = [1440, 900];
    // 1. 省面看不出來
    for (const [name, map, cam, size] of [['rye-phone', '', null, phone], ['m64-phone', 'map=64&', null, phone], ['m64-near', 'map=64&', [18, 18, 3], desk], ['rye-near', '', [16, 16, 3], desk]]) {
      const off = await view(`${name}-off`, `${map}seed=1944&noR100=1&noR086=1`, cam, size), cull = await view(`${name}-cull`, `${map}seed=1944&noR100=1&r086CullOnly=1`, cam, size);
      assert.equal(cull.hash, off.hash, 'fixture: same world');
      const d = diffPixels(off.file, cull.file, path.join(shots, `r086-${name}-cull-diff.png`)), share = d.list.length / d.total;
      // 每一棟建築四個角的直邊（從地面到牆頂）投到畫面上；省面拿掉的細條端面就在這些角上
      const edges = await E(`__rts.blds().flatMap(b => { const x0 = b.x + 0.1, x1 = b.x + b.w - 0.1, z0 = b.z + 0.1, z1 = b.z + b.d - 0.1, h = b.floors * 0.36 + 0.1; return [[x0, z0], [x0, z1], [x1, z0], [x1, z1]].map(([x, z]) => [__rts.screenOfPoint(x, 0, z), __rts.screenOfPoint(x, h, z)]); })`);
      const far = d.list.filter(([x, y]) => !edges.some(([a, b]) => a && b && segDist(x, y, a, b) <= 2));
      console.log(`r086 cull-only ${name}: ${(share * 100).toFixed(4)}% pixels differ, ${far.length} of them farther than 2 px from a building corner`);
      assert(share <= 0.0005, `cull: drawing no detail on the hidden faces does not show (${name}: ${(share * 100).toFixed(4)}% of the pixels differ)`);
      assert.equal(far.length, 0, `cull: every differing pixel is within 2 px of a building's outer corner (${name}; diff image shots/r086-${name}-cull-diff.png)`);
      assert.equal(cull.info.calls, off.info.calls, `cull: same draw calls (${name})`);
    }
    // 2. R134 關著時 R086 沒有作用
    const a = await view('nor134', 'seed=1944&noR100=1&noR134=1', null, phone), b = await view('nor134-nor086', 'seed=1944&noR100=1&noR134=1&noR086=1', null, phone);
    assert.equal(diffPixels(a.file, b.file).list.length, 0, 'inert: with R134 off, R086 changes no pixel');
    assert.deepEqual([a.info.calls, a.info.triangles], [b.info.calls, b.info.triangles], 'inert: and no triangle');
    // 3、4. 三角形、繪製次數、預算；開關對照圖
    for (const [name, map, cam, size, calls] of [['rye-phone', '', null, phone, 20], ['m64-phone', 'map=64&', null, phone, 20], ['m96-phone', 'map=96&', null, phone, 20], ['rye-street', '', [16, 16, 3], desk, 22], ['m96-near', 'map=96&', [18, 18, 3], desk, 22], ['village', 'map=village&', [16, 16, 2], desk, 22], ['village-phone', 'map=village&', null, phone, 20], ['hills-phone', 'map=hills&', null, phone, 20], ['barn', 'map=64&', 2, desk, 22], ['cottage', 'map=64&', 1, desk, 22], ['m96-wide', 'map=96&', [48, 48, 0.55], desk, 22]]) {
      const on = await view(`${name}-on`, `${map}seed=1944&noR100=1`, cam, size), off = await view(`${name}-off`, `${map}seed=1944&noR100=1&noR086=1`, cam, size);
      assert.equal(on.hash, off.hash, `fixture: same world (${name})`);
      assert.equal(on.info.calls, off.info.calls, `browser: the same draw calls with R086 on and off (${name}: ${on.info.calls} vs ${off.info.calls})`);
      assert(on.info.calls <= calls && on.info.triangles <= 80000, `browser: within the budget (${name}: ${on.info.calls} calls, ${on.info.triangles} triangles)`);
      if (!map.startsWith('map=96')) assert.equal(off.info.triangles - on.info.triangles, 2 * nodeDelta(on.blds), `browser: the triangles saved are exactly twice the Node town saving (main pass + shadow; ${name})`);
      console.log(`r086 ${name}: on ${on.info.calls} calls / ${on.info.triangles} triangles, off ${off.info.calls} / ${off.info.triangles}`);
      assert.deepEqual([...on.errors, ...off.errors], [], `browser: zero page errors (${name})`);
    }
  });
  console.log('OK R086 browser: hidden-face trim invisible, inert without R134, exact triangle saving, budgets, shots in shots/r086-*.png');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
