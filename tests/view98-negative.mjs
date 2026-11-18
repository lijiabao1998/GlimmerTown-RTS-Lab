// R098 在獨立副本故意弄壞三件加速的每一處；每個都要先紅在指定的那一句（只跑那一支、那一群）。
// 「暫存先畫過一次」只有真的 GPU 看得出來，在 tests/ground98-browser-negative.mjs。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r098-negative-'));
const BV = 'src/render/battle.ts', GU = 'src/render/groundUpload.ts', PD = 'src/render/previewDiff.ts', V8 = 'src/render/view98.ts';
// [名字, 檔案, [[原文, 改成], …], 守衛, 群, 第一個紅的斷言]
const cases = [
  // 屋頂高度
  ['roof_key_ignored', BV, [[' && cached.key === key) return cached.height;', ') return cached.height;']], 'roof98', 'same', /^same: map \d+ seed \d+ modules \w+ event \d+ .+ equals a fresh ray on the whole town/],
  ['roof_clear_all', BV, [['    if (townDirty) { if (!view98()) this.observerHeights.clear();', '    if (townDirty) { this.observerHeights.clear();']], 'roof98', 'rays', /^rays: map \d+: a stage change on an empty building re-rays nobody$/],
  ['roof_world_kept', BV, [['this.territory = territorySide; this.observerHeights.clear();', 'this.territory = territorySide;']], 'roof98', 'rays', /^rays: map \d+: a new world re-rays every garrisoned unit$/],
  // 地面上傳
  ['rect_two_rows', GU, [['this.box.max.set((this.hi[z] + 1) * p, z * p + p);', 'this.box.max.set((this.hi[z] + 1) * p, Math.min(this.n * p, z * p + 2 * p));']], 'ground98', 'shadow', /^shadow: each rectangle is exactly one cell row \(8 pixels\) high$/],
  ['rows_after_full', GU, [['    if (this.fullPending) { this.fullPending = false; this.clear(); return; }', '    if (this.fullPending) { this.fullPending = false; }']], 'ground98', 'rules', /^rules: rows painted after a full request are not sent/],
  ['no_quarter_switch', GU, [['this.rows.length * 4 > this.n', 'false']], 'ground98', 'rules', /^rules: more than n\/4 dirty rows go up as one full upload$/],
  ['stale_staging', GU, [['    this.stage = new THREE.DataTexture(groundPx, n * px, n * px);', '    this.stage = this.stage ?? new THREE.DataTexture(groundPx, n * px, n * px);']], 'ground98', 'shadow', /^shadow: the staging texture reads the current groundPx/],
  ['first_partial', GU, [['    this.lo = new Int32Array(n); this.hi = new Int32Array(n).fill(-1); this.rows = [];\n    this.stage = new THREE.DataTexture(groundPx, n * px, n * px);\n    this.fullPending = true;', '    this.lo = new Int32Array(n); this.hi = new Int32Array(n).fill(-1); this.rows = [];\n    this.stage = new THREE.DataTexture(groundPx, n * px, n * px);\n    this.fullPending = false;']], 'ground98', 'rules', /^rules: a new texture starts with a full upload$/],
  ['no_mark', BV, [['dep = w.crater[i]; this.up98.mark(x, z);', 'dep = w.crater[i];']], 'ground98', 'shadow', /^shadow: after .+ the texture on the GPU equals groundPx$/],
  // 布陣預覽
  ['no_ring', PD, [['for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {', 'for (let dz = 0; dz <= 0; dz++) for (let dx = 0; dx <= 0; dx++) {']], 'preview98', '', /^preview: map \d+ after .+ the preview ground equals a full repaint, byte for byte$/],
  ['side_ignored', PD, [['s.w === w || s.side !== side ||', 's.w === w ||']], 'preview98', '', /^preview: map \d+ after the first preview .+ the preview ground equals a full repaint, byte for byte$/],
  ['same_object', PD, [['if (!s || s.w === w || s.side', 'if (!s || s.side']], 'preview98', '', /^preview: map \d+ the same world object again is a full repaint$/],
  // 閥
  ['valve_ignored', V8, [['export const view98 = (): boolean => on98;', 'export const view98 = (): boolean => true;']], 'ground98', 'rules', /^rules: with \?noR098=1 every dirty batch is a full upload, as before$/],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests')); fs.mkdirSync(path.join(temp, 'tools'));
  for (const f of ['roof98', 'ground98', 'preview98']) fs.copyFileSync(path.join(root, `tests/${f}.mjs`), path.join(temp, `tests/${f}.mjs`));
  fs.copyFileSync(path.join(root, 'tools/tile128.mjs'), path.join(temp, 'tools/tile128.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, test, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const r = spawnSync(process.execPath, [`tests/${test}.mjs`, ...(group ? [group] : [])], { cwd: temp, encoding: 'utf8', timeout: 90000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED view98/${name}: ${first}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r098-negative-'));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`view98: ${cases.length} negative controls OK`);
