// R1010 故意弄壞（二）：存檔、介面、小地圖、畫面、閥。做法同 tests/bridge1010-negative.mjs（隔離副本、只跑那一群、第一個紅燈要落在指定的那一句）。卡面驗收 18。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PART = 'r1010-negative2-';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), PART));
const C = 'src/sim/worldCodec.ts', UI = 'src/ui/bridge1010.ts', MINI = 'src/ui/minimap.ts', R = 'src/render/bridge1010.ts', M = 'src/main.ts', CDP = 'tools/cdp.mjs';
const cases = [
  // 3 節 存檔
  ['codec_open', C, [['if (!wet || !(br = brOk1010(r, ter, wet, b))) return null;', 'br = { version: 1, wet: wet!, spans: (b as { spans: [] }).spans };']], 'codec', /^codec: refuses br with sw 1/],
  ['codec_wet', C, [['    ...(w.br ? { br: { ...w.br, wet: pack(w.br.wet) } } : {}),', '']], 'codec', /^codec: intact: br\.wet is packed and the encoding has no typed arrays/],
  // 5 節 介面
  ['route_nofire', UI, [['  if (!broken && !fireMode) { say(w, HOW1010); return undefined; }', '  if (false) { say(w, HOW1010); return undefined; }']], 'route', /^route: intact, fire mode off, engineer: moves as main/],
  ['hint_how', UI, [['  if (!broken && !fireMode) { say(w, HOW1010); return undefined; }', '  if (!broken && !fireMode) { return undefined; }']], 'route', /^route: intact, fire mode off with an engineer: the hint says how to blow it/],
  ['hint_reason', UI, [['  if (why) say(w, why);', '  if (why) {}']], 'route', /^route: and the hint says why/],
  // 6 節 小地圖、畫面
  ['minimap_stale', MINI, [["    { const sig = w.br?.spans.map(s => s.state).join('') ?? ''; if (sig !== baseBridge1010) { baseBridge1010 = sig; baseDirty = true; } }", '']], 'ui', /^ui: after bridge 0 breaks the next frame repaints the minimap base/],
  ['region_all', R, [['    if (skip && skip({ id: 0,', '    if (false && skip({ id: 0,']], 'art', /^art: a skip that leaves every building out leaves the bridges out too/],
  // 8 節 閥
  ['valve_ignored', M, [['...(V.r1010 && V.r1002 && V.r091 ? { br: 1 } : {}),', '...(V.r1002 && V.r091 ? { br: 1 } : {}),']], 'ui', /^ui: a new battle sends br 1 only with R1010, R1002 and R091 on/],
  ['cdp_default', CDP, [['const full1010 = /(^|&)noR1010=/.test(full50) ? full50 :', 'const full1010 = full50; const unused1010 = /(^|&)noR1010=/.test(full50) ? full50 :']], 'ui', /^ui: tools\/cdp\.mjs opens pages with noR1010=1/],
];
try {
  for (const d of ['src', 'tools']) fs.cpSync(path.join(root, d), path.join(temp, d), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/bridge1010.mjs'), path.join(temp, 'tests/bridge1010.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'junction');
  for (const [name, file, edits, group, message] of cases) {
    const originals = new Map();   // 一處弄壞可以改到兩個檔：edit 是 [從, 改成] 或 [檔, 從, 改成]
    for (const edit of edits) {
      const [f, from, to] = edit.length === 3 ? edit : [file, ...edit], target = path.join(temp, f);
      if (!originals.has(target)) originals.set(target, fs.readFileSync(target, 'utf8'));
      const now = fs.readFileSync(target, 'utf8');
      assert.equal(now.split(from).length - 1, 1, `unique ${name} anchor: ${from}`);
      fs.writeFileSync(target, now.replace(from, to));
    }
    const r = spawnSync(process.execPath, ['tests/bridge1010.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 100000 });
    for (const [target, text] of originals) fs.writeFileSync(target, text);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED bridge1010/${name}: ${first.slice(0, 150)}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith(PART));
  try { fs.unlinkSync(path.join(resolved, 'node_modules')); } catch {}
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`bridge1010 (2): ${cases.length} negative controls OK`);
