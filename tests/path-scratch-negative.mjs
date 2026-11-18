// R097 在獨立副本故意弄壞暫存重用的每一處；每個都要先紅在 path-scratch 指定的那一句（只跑那一群）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r097-negative-'));
const P = 'src/sim/path.ts', SAME = /^path: query \d+ \(.+\) identical to the 74fa704 A\*$/;
const cases = [
  // 某個陣列沒清：上一題（別的世界、別的兵種、改過的世界）的東西留下來
  ['memo_kept', P, 'memo.fill(0); ', '', 'identity', SAME],
  ['speed_kept', P, 'spd.fill(0); ', '', 'identity', SAME],
  ['cost_kept', P, 'g.fill(-1); ', '', 'identity', SAME],
  ['done_kept', P, 'done.fill(0); ', '', 'identity', SAME],
  // 堆沒清空：上一題到終點就停，剩下的鍵留到下一題
  ['heap_kept', P, ' open.size = 0;', '', 'identity', SAME],
  // 格數變小沒重開（結果碰巧一樣，但守衛要求換大小就重開；變大沒重開會讀到陣列外、搜尋停不下來，identity 那一群會逾時）
  ['no_realloc', P, 'if (K !== K0) {', 'if (K > K0) {', 'alloc', /^alloc: a different map size reallocates the five scratch arrays once$/],
  // 堆長大時沒把舊的搬過去
  ['heap_grow', P, 'b.set(this.a); ', '', 'identity', SAME],
  // 取餘用錯模數（對稱時 M＝2K）
  ['wrong_modulus', P, 'let e = v - q * M;', 'let e = v - q * K;', 'identity', SAME],
  // 只算一次的啟發值傳錯（f 平手時的次序）
  ['tie_h', P, 'open.push(key(ng + hn, hn, ni));', 'open.push(key(ng + hn, 0, ni));', 'identity', SAME],
  // 速度記錯格
  ['speed_cell', P, 'speedPct(w, nx, nz)', 'speedPct(w, nz, nx)', 'identity', SAME],
  // 每次都重開（結果一樣，但又在配陣列）
  ['alloc_each', P, 'if (K !== K0) {', 'if (K === K) {', 'alloc', /^alloc: after warm-up 150 searches on the same map create no typed arrays$/],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.mkdirSync(path.join(temp, 'tools'));
  fs.copyFileSync(path.join(root, 'tests/path-scratch.mjs'), path.join(temp, 'tests/path-scratch.mjs'));
  fs.copyFileSync(path.join(root, 'tools/duel.mjs'), path.join(temp, 'tools/duel.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const [name, file, from, to, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    assert.equal(original.split(from).length - 1, 1, `unique ${name} anchor`);
    fs.writeFileSync(target, original.replace(from, to));
    const r = spawnSync(process.execPath, ['tests/path-scratch.mjs', group], { cwd: temp, encoding: 'utf8', timeout: 110000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED path-scratch/${name}: ${first}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r097-negative-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`path-scratch: ${cases.length} negative controls OK`);
