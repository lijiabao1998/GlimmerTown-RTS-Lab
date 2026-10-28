// R061：GPT 車道守衛擋 GPT 改 Claude 的結構守衛（tests/hub-budget.mjs、tests/valves.mjs；R066 加 tests/card-numbers.mjs）；改別的守衛照樣放行。
// 隔離 git 夾具跟 tests/gpt-lane-card-number.mjs 同一種做法：用這個分支上的 tools/gpt-lane.mjs 跑。
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const guard = readFileSync(new URL('../tools/gpt-lane.mjs', import.meta.url), 'utf8');
const runCase = (name, touched, pass, script = guard) => {
  const dir = mkdtempSync(join(tmpdir(), 'rts-lane-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
    const put = (p, text) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); };
    git('init', '-q'); git('config', 'user.name', 'lane fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('docs/GPT-方向.md', '## 開關\n\n**運行**\n\n## 待辦\n'); put('LOG.md', '| R140 | done |\n');
    put('tests/hub-budget.mjs', 'claude\n'); put('tests/valves.mjs', 'claude\n'); put('tests/card-numbers.mjs', 'claude\n'); put('tests/other.mjs', 'gpt\n');
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    put('docs/tasks/R141-fixture.md', '# R141\n<!-- card: sim=no; golden=無; valve=無; owner_ok= -->\n## 驗收（動手前寫）\nFrozen check.\n');
    git('add', '.'); git('commit', '-qm', 'card first');
    put('src/fixture.ts', 'export const fixture = true;\n'); put(touched, 'changed by gpt\n'); git('add', '.'); git('commit', '-qm', 'implementation');
    put('guard.mjs', script);
    const r = spawnSync(process.execPath, ['guard.mjs'], { cwd: dir, env: { ...process.env, BASE: base, HEAD_REF: 'HEAD', BRANCH: 'gpt/fixture' }, encoding: 'utf8' });
    assert.equal(r.status, pass ? 0 : 1, `${name}: ${r.stdout}\n${r.stderr}`);
    if (!pass) assert.match(r.stdout, /Claude 的結構守衛/, `${name}: rejected for the intended reason`);
    console.log(`OK ${name}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
runCase('GPT may not edit tests/hub-budget.mjs', 'tests/hub-budget.mjs', false);
runCase('GPT may not edit tests/valves.mjs', 'tests/valves.mjs', false);
runCase('GPT may not edit tests/card-numbers.mjs (R066)', 'tests/card-numbers.mjs', false);
runCase('GPT may still edit its own guards', 'tests/other.mjs', true);
const old = guard.replace(/\n\/\/ R061：[^\n]*\nconst CLAUDE_TESTS[^\n]*\nfor \(const f of files\) if \(CLAUDE_TESTS[^\n]*/, '');
assert.notEqual(old, guard, 'negative control removes the R061 rule');
assert.throws(() => runCase('negative control: without the rule GPT could edit hub-budget', 'tests/hub-budget.mjs', false, old), /AssertionError|expected/i);
assert.throws(() => runCase('negative control: without the rule GPT could edit card-numbers', 'tests/card-numbers.mjs', false, old), /AssertionError|expected/i);
console.log('OK negative control: without the R061 rule the edit would pass the lane');
