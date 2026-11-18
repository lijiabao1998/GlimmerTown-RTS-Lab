// R097 在獨立副本故意弄壞暫存重用的每一處；每個都要先紅在 path-scratch 指定的那一句（只跑那一群）。
// 兩處會讓搜尋停不下來（讀到陣列外、NaN 一直推進堆）：斷言它們逾時——不會不知不覺過關。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r097-negative-'));
const P = 'src/sim/path.ts', SAME = /^path: query \d+ \(.+\) identical to the 74fa704 A\*$/, ODD = /^odd: query \d+ \(.+\) identical to the 74fa704 A\*$/;
const RESET = 'memo.fill(0); spd.fill(0); g.fill(-1); came.fill(-1); done.fill(0); open.size = 0;', HANG = 'timeout';
// [名字, 檔案, [[原文, 改成], …], 群, 第一個紅的斷言（或 HANG）]
const cases = [
  // 某個陣列沒清：上一題（同一個世界改過之後、別的世界、別的兵種）的東西留下來
  ['memo_kept', P, [['memo.fill(0); ', '']], 'identity', SAME],
  ['speed_kept', P, [['spd.fill(0); ', '']], 'identity', SAME],
  ['cost_kept', P, [['g.fill(-1); ', '']], 'identity', SAME],
  ['done_kept', P, [['done.fill(0); ', '']], 'identity', SAME],
  // 只在換了世界時才清（同一個世界上彈坑、鐵絲網、房子改了就錯；審查之後）
  ['speed_per_world', P, [['spd.fill(0); ', ''], ['memo.fill(0); ', 'memo.fill(0); if (w !== W0) { spd.fill(0); W0 = w; } '], ['let K0 = -1,', 'let W0: World | null = null, K0 = -1,']], 'identity', SAME],
  ['memo_per_world', P, [['memo.fill(0); ', 'if (w !== W0) { memo.fill(0); W0 = w; } '], ['let K0 = -1,', 'let W0: World | null = null, K0 = -1,']], 'identity', SAME],
  // 堆沒清空：上一題到終點就停，剩下的鍵留到下一題
  ['heap_kept', P, [[' open.size = 0;', '']], 'identity', SAME],
  // 堆長大時沒把舊的搬過去
  ['heap_grow', P, [['b.set(this.a); ', '']], 'identity', SAME],
  // 取餘用錯模數（對稱時 M＝2K）
  ['wrong_modulus', P, [['e = v - Math.floor(v / M) * M;', 'e = v - Math.floor(v / M) * K;']], 'identity', SAME],
  // 只算一次的啟發值傳錯（f 平手時的次序）
  ['tie_h', P, [['open.push(key(ng + hn, hn, ni));', 'open.push(key(ng + hn, 0, ni));']], 'identity', SAME],
  // 速度記錯格
  ['speed_cell', P, [['speedPct(w, nx, nz)', 'speedPct(w, nz, nx)']], 'identity', SAME],
  // 負的鍵也走除法（彈坑深到速度變負數時跟 % 不一樣；審查之後）
  ['negative_keys', P, [['if (v > 0 && v < 9007199254740992) {', 'if (v === v) {']], 'odd', ODD],
  // 清空搬到搜完之後（搜到一半拋錯就留下髒的；審查之後）
  ['reset_at_end', P, [[RESET, ''], ['g = new Int32Array(K); came = new Int32Array(K);', 'g = new Int32Array(K).fill(-1); came = new Int32Array(K).fill(-1);'], ['  return out.reverse();', `  const r = out.reverse(); ${RESET}\n  return r;`]], 'throw', /^throw: after a search that threw, query \d+ \(.+\) is identical to the 74fa704 A\*$/],
  // 格數變小沒重開（結果碰巧一樣，但守衛要求換大小就重開）
  ['no_realloc', P, [['if (K !== K0) {', 'if (K > K0) {']], 'alloc', /^alloc: a different map size reallocates the five scratch arrays once$/],
  // 每次都重開（結果一樣，但又在配陣列）
  ['alloc_each', P, [['if (K !== K0) {', 'if (K === K) {']], 'alloc', /^alloc: after warm-up 150 searches on the same map create no typed arrays$/],
  // 格數變大沒重開：讀到陣列外，搜尋停不下來
  ['grow_no_realloc', P, [['if (K !== K0) {', 'if (K0 < 0 || K < K0) {']], 'alloc', HANG],
  // 邊界寫成會放過 NaN 的樣子：座標不是整數時一直推進 NaN、停不下來（審查之後）
  ['nan_bounds', P, [['!(nx >= 0 && nz >= 0 && nx < n && nz < n)', '(nx < 0 || nz < 0 || nx >= n || nz >= n)']], 'odd', HANG],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.mkdirSync(path.join(temp, 'tools'));
  fs.copyFileSync(path.join(root, 'tests/path-scratch.mjs'), path.join(temp, 'tests/path-scratch.mjs'));
  fs.copyFileSync(path.join(root, 'tools/duel.mjs'), path.join(temp, 'tools/duel.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const [name, file, edits, group, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    let mutated = original;
    for (const [from, to] of edits) { assert.equal(mutated.split(from).length - 1, 1, `unique ${name} anchor: ${from}`); mutated = mutated.replace(from, to); }
    fs.writeFileSync(target, mutated);
    const hang = message === HANG, r = spawnSync(process.execPath, ['tests/path-scratch.mjs', group], { cwd: temp, encoding: 'utf8', timeout: hang ? 12000 : 60000 });
    fs.writeFileSync(target, original);
    if (hang) {
      assert.equal(r.error?.code, 'ETIMEDOUT', `${name}: mutant must never finish the ${group} group (status ${r.status}); ${r.stderr.slice(0, 400)}`);
      console.log(`RED path-scratch/${name}: ${group} group never finishes (killed after 12 s)`);
      continue;
    }
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
