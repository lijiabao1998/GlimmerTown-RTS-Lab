// R098 地面貼圖只傳改過的格列（只改效能）。這支在 Node 裡用一張「影子貼圖」當顯示卡：
//   - three 的規則：貼圖的 version 變了（needsUpdate），畫的時候整張傳 groundPx；copyTextureToTexture 先 setTexture2D(dst)，version 變了也先整張傳；
//   - 上傳器的 flush 交給一個假的 renderer，它照 copyTextureToTexture 的 CPU 那一支把矩形從暫存（＝groundPx）抄進影子；
//   每一幀之後影子要＝groundPx（顯示卡上的跟整張上傳的一樣），矩形要在貼圖裡、剛好 PX 像素高、暫存就是現在的 groundPx。
// 群：shadow（地圖 0–4 與鋪滿的 128 打一段：履帶、高爆、換段、新房子；開戰的 setWorld(w, -1) 之後馬上走一步、中間不畫；換到別的大小）、
//     same（閥開關兩邊每一步的 groundPx 逐位一樣）、rules（整張之後的格列不送、超過 n/4 整張、閥關著整張）。
import assert from 'node:assert/strict';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { BattleView, setView98 } from '../src/render/battle.ts';
import { GroundUpload98 } from '../src/render/groundUpload.ts';
import { tile128 } from '../tools/tile128.mjs';

const only = process.argv[2], run = (name, f) => { if (only && only !== name) return; f(); console.log(`OK ground98/${name}`); };
const PX = 8, ECO = { t: 'eco', inf: 1, guns: 1, tanks: 1, armor2: 1, soviet: 1, international: 1, end: 1, pla: 1, mg: 2 };
const ai = side => ({ t: 'ai', side, level: 3, v: 3 });
function world(map, seed) {
  const w = W.createWorld(seed);
  step(w, [{ t: 'map', id: map === 128 ? 3 : map, vegetation: 1, more: 1, sym: 1 }, ...(map === 0 ? [] : [ECO]), ai(0), ai(1)]);
  return map === 128 ? tile128(w) : w;
}
// 影子貼圖：照 three 的規則「畫」一幀
function gpu(v) {
  const s = { px: null, ver: -1, tex: null, rects: 0, fulls: 0, max: 0 };
  const full = tex => { s.px = Uint8Array.from(v.groundPx); s.ver = tex.version; s.tex = tex; s.fulls++; };
  const stale = tex => tex !== s.tex || tex.version !== s.ver;   // 新的貼圖物件第一次用一定整張；同一張 version 變了也整張
  const fake = { copyTextureToTexture(src, dst, box, at) {
    assert.equal(dst, v.groundTex, 'shadow: the upload goes to the ground texture in use');
    assert.equal(src.image.data, v.groundPx, 'shadow: the staging texture reads the current groundPx (after a size change too)');
    const Wd = v.groundTex.image.width, x0 = box.min.x, y0 = box.min.y, x1 = box.max.x, y1 = box.max.y;
    assert(x0 >= 0 && y0 >= 0 && x1 <= Wd && y1 <= Wd && x0 < x1 && at.x === x0 && at.y === y0, `shadow: rectangle ${x0},${y0}-${x1},${y1} lies inside the ${Wd}-pixel texture at its own position`);
    assert.equal(y1 - y0, PX, `shadow: each rectangle is exactly one cell row (${PX} pixels) high`);
    assert.equal(y0 % PX, 0, 'shadow: each rectangle starts on a cell row');
    if (stale(dst)) full(dst);   // setTexture2D(dst) 先整張
    for (let y = y0; y < y1; y++) s.px.set(src.image.data.subarray((y * Wd + x0) * 4, (y * Wd + x1) * 4), (y * Wd + x0) * 4);
    s.rects++;
  } };
  s.frame = (why) => {
    v['up98'].flush(fake, v.groundTex);
    if (stale(v.groundTex)) full(v.groundTex);   // 畫的時候整張
    const a = s.px, b = v.groundPx;
    assert(a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0, `shadow: after ${why} the texture on the GPU equals groundPx`);
  };
  return s;
}
// 打一段：每一步 snapshot → step → onEvents → update → 畫一幀
function play(w, v, s, ticks, tag) {
  for (let t = 0; t < ticks; t++) {
    v.snapshot(); step(w, []); const simT = w.tick / 20;
    v.onEvents(w.events, simT); v.update(0, simT, new Set()); s.frame(`${tag} tick ${w.tick}`);
  }
}

run('shadow', () => {
  setView98(true);
  let rects = 0, fulls = 0, frames = 0;
  for (const map of [0, 1, 2, 3, 4, 128]) {
    const w = world(map, 1944 + map), v = new BattleView(w, { fog: false, fx: true, r016: true }), s = gpu(v);
    s.frame(`map ${map} opening`);
    v.setWorld(w, -1); v.snapshot(); step(w, []); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set());   // 開戰：setWorld(w, -1) 之後馬上走一步、中間不畫
    s.frame(`map ${map} startBattle`);
    play(w, v, s, map >= 96 || map === 128 ? 500 : 700, `map ${map}`);
    // 打幾發高爆、讓幾棟換段（事件直接送）
    for (let k = 0; k < 12; k++) {
      const b = w.blds[(k * 7) % w.blds.length]; if (!b) break;
      b.hp = Math.max(0, b.hp - Math.ceil(b.maxHp / 3)); w.crater[W.cellIdx(w, b.x, Math.max(0, b.z - 1))] = 2;
      v.onEvents([{ e: 'stage', bld: b.id }, { e: 'impact', x: W.center(b.x), z: W.center(Math.max(0, b.z - 1)), kind: W.SHELL_HE, crater: 1 }], 40 + k); v.update(0, 40 + k, new Set()); s.frame(`map ${map} shell ${k}`);
    }
    // 換到別的大小再換回來（sizeTo 換了 groundPx）
    const other = world(map === 1 ? 3 : 1, 7);
    v.setWorld(other, -1); s.frame(`map ${map} → map ${other.map} (size change)`);
    play(other, v, s, 60, `map ${map} → other`);
    for (let k = 0; k < 4; k++) { const b = other.blds[(k * 5) % other.blds.length]; b.hp = Math.max(0, b.hp - Math.ceil(b.maxHp / 3)); v.onEvents([{ e: 'stage', bld: b.id }], 60 + k); v.update(0, 60 + k, new Set()); s.frame(`map ${map} → other, shell ${k}`); }
    v.setWorld(w, -1); s.frame(`back to map ${map}`);
    rects += s.rects; fulls += s.fulls; frames += 1;
    v.dispose?.();
  }
  assert(rects >= 2000 && fulls >= 6 * 4, `shadow: coverage (${rects} rectangles uploaded, ${fulls} full uploads)`);
  console.log(`  ${rects} row rectangles and ${fulls} full uploads; the shadow GPU texture equals groundPx after every frame`);
});

run('same', () => {
  // 閥開關兩邊：每一步的 groundPx 逐位一樣（上傳的方式不碰畫法）
  for (const map of [1, 3, 128]) {
    const hashes = [];
    for (const on of [true, false]) {
      setView98(on);
      const w = world(map, 77), v = new BattleView(w, { fog: false, fx: true, r016: true }), s = gpu(v), h = [];
      for (let t = 0; t < 400; t++) { v.snapshot(); step(w, []); v.onEvents(w.events, w.tick / 20); v.update(0, w.tick / 20, new Set()); s.frame(`same map ${map} ${on}`); if (t % 40 === 39) h.push(Buffer.from(v.groundPx).toString('base64').length + ':' + W.hashWorld(w) + ':' + crc(v.groundPx)); }
      hashes.push(h); v.dispose?.();
    }
    assert.deepEqual(hashes[0], hashes[1], `same: map ${map} groundPx with and without ?noR098=1 is identical every 40 ticks`);
  }
  setView98(true);
});
function crc(a) { let h = 2166136261; for (let i = 0; i < a.length; i += 7) h = Math.imul(h ^ a[i], 16777619); return (h >>> 0).toString(16); }

run('rules', () => {
  const u = new GroundUpload98(), tex = { needsUpdate: false, version: 0, set needs(v) {} };
  const T = { version: 0, set needsUpdate(v) { if (v) this.version++; } };
  const px = new Uint8Array(16 * PX * 16 * PX * 4);
  u.resize(16, PX, px);
  assert(u.full98, 'rules: a new texture starts with a full upload');
  const calls = [], R = { copyTextureToTexture: (s, d, b) => calls.push([b.min.x, b.min.y, b.max.x, b.max.y]) };
  u.flush(R, T); assert.equal(calls.length, 0, 'rules: the first upload of a new texture is a full one (no rows)');
  u.mark(3, 2); u.mark(5, 2); u.mark(4, 9); u.dirty(T); u.flush(R, T);
  assert.deepEqual(calls, [[3 * PX, 2 * PX, 6 * PX, 3 * PX], [4 * PX, 9 * PX, 5 * PX, 10 * PX]], 'rules: one rectangle per dirty cell row, spanning its dirtiest cells');
  calls.length = 0; u.full(T); u.mark(1, 1); u.dirty(T); u.flush(R, T);
  assert.equal(calls.length, 0, 'rules: rows painted after a full request are not sent (the full upload covers them)');
  calls.length = 0; for (let z = 0; z < 5; z++) u.mark(0, z); const v0 = T.version; u.dirty(T); u.flush(R, T);
  assert(calls.length === 0 && T.version === v0 + 1, 'rules: more than n/4 dirty rows go up as one full upload');
  setView98(false); calls.length = 0; u.mark(2, 2); const v1 = T.version; u.dirty(T); u.flush(R, T); setView98(true);
  assert(calls.length === 0 && T.version === v1 + 1, 'rules: with ?noR098=1 every dirty batch is a full upload, as before');
  const px2 = new Uint8Array(8 * PX * 8 * PX * 4); u.resize(8, PX, px2); u.flush(R, T); u.mark(1, 1); u.dirty(T); calls.length = 0;
  const R2 = { copyTextureToTexture: (s) => { calls.push(s.image.data === px2); } }; u.flush(R2, T);
  assert.deepEqual(calls, [true], 'rules: after a size change the staging texture reads the new groundPx');
});
console.log('ground98: all OK');
