// Regression: LOG prose references are not allocated cards; actual and withdrawn cards remain reserved.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const guard = readFileSync(new URL('../tools/gpt-lane.mjs', import.meta.url), 'utf8');
const runCase = (name, log, existing, number, pass, script = guard) => {
  const dir = mkdtempSync(join(tmpdir(), 'rts-lane-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
    const put = (p, text) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); };
    git('init', '-q'); git('config', 'user.name', 'lane fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('docs/GPT-方向.md', '## 開關\n\n**運行**\n\n## 待辦\n'); put('LOG.md', log);
    if (existing) put(`docs/tasks/R${existing}-old.md`, 'historical immutable card');
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    put(`docs/tasks/R${number}-fixture.md`, `# R${number}\n<!-- card: sim=no; golden=無; valve=無; owner_ok= -->\n## 驗收（動手前寫）\nFrozen check.\n`);
    git('add', '.'); git('commit', '-qm', 'card first');
    put('src/fixture.ts', 'export const fixture = true;\n'); git('add', '.'); git('commit', '-qm', 'implementation');
    put('guard.mjs', script);
    const r = spawnSync(process.execPath, ['guard.mjs'], { cwd: dir, env: { ...process.env, BASE: base, HEAD_REF: 'HEAD', BRANCH: 'gpt/fixture' }, encoding: 'utf8' });
    assert.equal(r.status, pass ? 0 : 1, `${name}: ${r.stdout}\n${r.stderr}`);
    if (!pass) assert.match(r.stdout, /卡號.*最大號/, `${name}: reject for the intended card-number reason`);
    console.log(`OK ${name}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
runCase('prose reference does not allocate R129', '| R039 | mentions R129 |\n| R128 | complete |\n', '128', 129, true);
runCase('actual card still reserves its number', '| R128 | complete |\n', '129', 129, false);
runCase('withdrawn iteration retained by LOG', '| R129 | withdrawn, card removed |\n', '128', 129, false);
runCase('higher real iteration blocks older card', '| R130 | complete |\n', '130', 129, false);
runCase('indented historical row still reserves number', '  |  R129  | withdrawn |\n', '128', 129, false);
runCase('next unused number accepted', '| R130 | complete |\n', '130', 131, true);
const old = guard.replace('/^\\s*\\|\\s*R(\\d{3,})\\s*\\|/gm', '/\\bR(\\d{3,})\\b/g');
assert.notEqual(old, guard, 'negative control must restore original faulty parser');
runCase('negative control: old parser reproduces exact original red', '| R039 | mentions R129 |\n| R128 | complete |\n', '128', 129, false, old);
