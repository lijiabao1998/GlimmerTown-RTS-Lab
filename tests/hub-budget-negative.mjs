// R061 負控：在隔離副本把總機各多塞超過空間的行數，hub-budget 必須紅、而且紅在那個檔名。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r061-negative-'));
try {
  for (const f of ['tests/hub-budget.mjs', 'tools/hub-budget.json', 'src/main.ts', 'src/render/battle.ts']) {
    fs.mkdirSync(path.join(temp, path.dirname(f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(temp, f));
  }
  const run = () => spawnSync(process.execPath, ['tests/hub-budget.mjs'], { cwd: temp, encoding: 'utf8' });
  const clean = run(); assert.equal(clean.status, 0, `copy is green before mutation\n${clean.stdout}`);
  const budget = JSON.parse(fs.readFileSync(path.join(root, 'tools/hub-budget.json'), 'utf8'));
  for (const f of ['src/main.ts', 'src/render/battle.ts']) {
    const original = fs.readFileSync(path.join(temp, f), 'utf8'), n = original.split('\n').length - 1;
    fs.writeFileSync(path.join(temp, f), original + '// filler\n'.repeat(budget[f] - n + 1));   // 剛好超過上限一行
    const r = run(); fs.writeFileSync(path.join(temp, f), original);
    assert.equal(r.status, 1, `${f}: one line over the ceiling must fail`);
    assert.match(r.stdout, new RegExp(`^NG  ${f.replace(/[./]/g, '\\$&')} \\d+ 行，上限 ${budget[f]}，超過 1 行`, 'm'), `${f}: red names the file\n${r.stdout}`);
    console.log(`RED hub-budget/${f}: over by one line`);
  }
  // 剛好等於上限是綠
  const f = 'src/main.ts', original = fs.readFileSync(path.join(temp, f), 'utf8'), n = original.split('\n').length - 1;
  fs.writeFileSync(path.join(temp, f), original + '// filler\n'.repeat(budget[f] - n));
  assert.equal(run().status, 0, 'exactly at the ceiling stays green');
} finally {
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(parent) && path.basename(resolved).startsWith('r061-negative-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log('hub-budget: negative controls OK');
