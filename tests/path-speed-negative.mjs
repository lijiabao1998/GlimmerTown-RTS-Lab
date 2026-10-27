// R064 在獨立副本故意弄壞兩處加速；每個都要先紅在 path-speed 指定的那一句。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r064-negative-'));
const cases = [
  // 快取記錯格：跟改之前的 A* 答案不同
  ['memo', 'src/sim/path.ts', 'const i = z * n + x;', 'const i = x * n + z;', /^path: map \d+ query \d+ identical to the pre-R064 A\*$/],
  // 格子篩太緊（0 格）：貼著外牆的喪屍挑不到房子，跟改之前的掃法不同
  ['margin', 'src/sim/zombies.ts', 'm = Math.floor((reach + HALF) / SUB) + 1;', 'm = 0;', /^aim: zombie at \d+,\d+ picks the same building as the pre-R064 scan$/],
];
try {
  fs.cpSync(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'tests'));
  fs.copyFileSync(path.join(root, 'tests/path-speed.mjs'), path.join(temp, 'tests/path-speed.mjs'));
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
  for (const [name, file, from, to, message] of cases) {
    const target = path.join(temp, file), original = fs.readFileSync(target, 'utf8');
    assert.equal(original.split(from).length - 1, 1, `unique ${name} anchor`);
    fs.writeFileSync(target, original.replace(from, to));
    const r = spawnSync(process.execPath, ['tests/path-speed.mjs'], { cwd: temp, encoding: 'utf8', timeout: 110000 });
    fs.writeFileSync(target, original);
    assert(!r.error && r.status !== 0, `${name}: mutant must fail, ${r.error ?? r.status}`);
    const first = r.stderr.match(/AssertionError[^\r\n]*?: ([^\r\n]+)/)?.[1];
    assert.match(first ?? '', message, `${name}: first red must be the intended assertion; ${r.stderr.slice(0, 600)}`);
    console.log(`RED path-speed/${name}: ${first}`);
  }
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r064-negative-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log(`path-speed: ${cases.length} negative controls OK`);
