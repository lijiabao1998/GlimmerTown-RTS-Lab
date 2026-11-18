// R090 小地圖：n ≥ 128（地圖 5）改成點陣、一次畫成菱形；地圖 0–4 一格一格畫，跟改之前逐筆一樣。
// 假的畫布把每一次 fill／fillRect／stroke 的顏色與路徑、drawImage、setTransform 都記下來算指紋（不比 Chrome 的像素，跟顯示卡無關）；
// 地圖 0–4、種子 1–3、第 0 步與第 600 步的指紋在 f9a4155（改 minimap.ts 之前）取好、釘在下面。
// node tests/minimap90.mjs --print 印出現在的指紋（取基線用）。
import assert from 'node:assert/strict';
import * as W from '../src/sim/world.ts';
import { step } from '../src/sim/step.ts';
import { initMinimap } from '../src/ui/minimap.ts';
import { ECO } from '../tools/duel.mjs';

class Context {
  constructor(canvas) { this.canvas = canvas; this.log = []; this.path = []; this.fillStyle = '#000'; this.strokeStyle = '#000'; this.lineWidth = 1; this.imageSmoothingEnabled = true; }
  save() { this.log.push('save'); } restore() { this.log.push('restore'); } clip() { this.log.push('clip'); } setLineDash(d) { this.log.push(`dash${d}`); }
  arc(x, y, r) { this.path.push(x, y, r); } ellipse(x, y, a, b) { this.path.push(x, y, a, b); } rect(x, y, w, h) { this.path.push(x, y, w, h); }
  beginPath() { this.path = []; } moveTo(x, y) { this.path.push(x, y); } lineTo(x, y) { this.path.push(x, y); } closePath() {}
  fill() { this.log.push(`f${this.fillStyle}:${this.path.map(v => v.toFixed(3)).join(',')}`); }
  stroke() { this.log.push(`s${this.strokeStyle}/${this.lineWidth}:${this.path.map(v => v.toFixed(3)).join(',')}`); }
  fillRect(x, y, w, h) { this.log.push(`r${this.fillStyle}:${[x, y, w, h].map(v => v.toFixed(3)).join(',')}`); }
  clearRect() { this.log.push('clear'); } setTransform(...m) { this.log.push(`t${m.map(v => +v.toFixed(4)).join(',')}`); }
  drawImage(img) { this.log.push(`d${img.width}x${img.height}${img.isBase ? 'B' : ''}`); }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  putImageData(img) { this.put = img; this.log.push(`p${img.width}`); }
}
const canvases = [];
class El {
  constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.width = 0; this.height = 0; if (tag === 'canvas') { this.ctx = new Context(this); canvases.push(this); } }
  getContext() { return this.ctx; } appendChild(c) { this.children.push(c); } addEventListener() {} setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 150, bottom: 75, width: 150, height: 75 }; }
}
Object.assign(globalThis, { document: { createElement: t => new El(t), getElementById: () => null, body: new El('body') }, innerWidth: 412, innerHeight: 860, devicePixelRatio: 2 });
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
function world(map, seed, ticks) {
  const w = W.createWorld(seed);
  step(w, [{ t: 'map', id: map, vegetation: 1 }, ...(map === 0 ? [] : [{ ...ECO, end: 1 }]), { t: 'ai', side: 0, level: 3, v: 3 }, { t: 'ai', side: 1, level: 3, v: 3 }]);
  while (w.tick < ticks && w.winner < 0) step(w, []);
  return w;
}
function paint(w) {
  canvases.length = 0;
  const mini = initMinimap({ world: () => w, visible: () => true, view: () => [[1, 1], [5, 1], [5, 5], [1, 5]], tap: () => {} });
  mini.frame(1);
  return { mini, base: canvases[1], shown: canvases[0], raster: canvases[2] };
}
const BASE = {"0/1/0":"03adf588","0/1/600":"919d64f3","0/2/0":"6e11c4b9","0/2/600":"c7268181","0/3/0":"f05a17a7","0/3/600":"7b8c278c","1/1/0":"620f836e","1/1/600":"620f836e","1/2/0":"620f836e","1/2/600":"620f836e","1/3/0":"620f836e","1/3/600":"620f836e","2/1/0":"0a6c66bf","2/1/600":"ac037000","2/2/0":"7bef3aa3","2/2/600":"34fa7185","2/3/0":"3275898c","2/3/600":"a2fdade8","3/1/0":"a9dbc456","3/1/600":"a9dbc456","3/2/0":"fcd9a33a","3/2/600":"fcd9a33a","3/3/0":"dfdbd27e","3/3/600":"dfdbd27e","4/1/0":"04995132","4/1/600":"b3aeab13","4/2/0":"04995132","4/2/600":"dca9fbf1","4/3/0":"04995132","4/3/600":"b3aeab13"};   // f9a4155（R098 合併之後、改 minimap.ts 之前）
const PRINT = process.argv.includes('--print'), got = {};
for (const map of [0, 1, 2, 3, 4]) for (const seed of [1, 2, 3]) for (const ticks of [0, 600]) {
  const { base } = paint(world(map, seed, ticks));
  got[`${map}/${seed}/${ticks}`] = fnv(base.ctx.log.join('|'));
}
if (PRINT) { console.log(JSON.stringify(got)); process.exit(0); }
assert.deepEqual(got, BASE, 'minimap: maps 0–4 paint exactly as before R090 (every fill, stroke and colour)');
console.log(`OK minimap90/old-maps: ${Object.keys(got).length} fingerprints equal f9a4155`);

// 地圖 5：點陣那一條路——每一格一個像素、顏色跟舊畫法同一份；一次 drawImage、變換是菱形；沒有一格一格的 fill
const w5 = world(5, 1, 0), { base, raster } = paint(w5), n = w5.n;
assert(raster && raster.ctx.put && raster.ctx.put.width === n, 'map5: the raster is n × n and was put once');
const diamonds = base.ctx.log.filter(op => op.startsWith('f') && op.split(',').length === 8).length;   // 小樹林本來就是小菱形（≤ 64 格）
assert(diamonds <= 64, `map5: no per-cell diamond fills on 128 (${diamonds} diamonds, only the woods)`);
const s = 150 / (2 * n), dpr = 2;
assert(base.ctx.log.includes(`t${[s * dpr, (s / 2) * dpr, -s * dpr, (s / 2) * dpr, 75 * dpr, 0].map(v => +v.toFixed(4)).join(',')}`), 'map5: the raster is drawn through the diamond transform');
const old = (i) => { const t = w5.ter[i], id = w5.occ[i], b = id ? w5.blds[id - 1] : null; return b ? (W.stageOf(b) === W.STAGE_RUBBLE ? '#6f6559' : b.builtBy === 0 ? '#a9c4e6' : '#cfc3a8') : w5.crater[i] ? '#4a3f33' : t === W.TER_ROAD ? '#8f7f62' : t === W.TER_FIELD ? '#9a9450' : t === W.TER_MUD ? '#4d6470' : '#5b7a42'; };
const d = raster.ctx.put.data;
for (let i = 0; i < n * n; i++) { const c = old(i), o = i * 4; assert(d[o] === parseInt(c.slice(1, 3), 16) && d[o + 1] === parseInt(c.slice(3, 5), 16) && d[o + 2] === parseInt(c.slice(5, 7), 16) && d[o + 3] === 255, `map5: cell ${i} has the old painter's colour ${c}`); }
console.log(`OK minimap90/map5: ${n}×${n} raster with the old colours, one drawImage through the diamond transform`);
