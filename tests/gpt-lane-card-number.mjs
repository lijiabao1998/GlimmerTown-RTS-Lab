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
    if (!pass) assert.match(r.stdout, /卡號.*(最大號|R899)/, `${name}: reject for the intended card-number reason`);
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

// Owner-approved fix: Grok/Claude cards must not exhaust the GPT allocation.
runCase('Grok card R905 does not exhaust GPT range', '| R139 | complete |\n| R905 | Grok |\n', '905', 140, true);
runCase('withdrawn Grok LOG row is outside GPT range', '| R139 | complete |\n| R999 | withdrawn Grok |\n', '139', 140, true);
runCase('Claude range does not reserve GPT numbers', '| R099 | Claude |\n', '099', 100, true);
runCase('highest available GPT number accepted', '| R898 | complete |\n| R905 | Grok |\n', '898', 899, true);
runCase('withdrawn GPT R899 remains reserved', '| R899 | withdrawn GPT |\n| R905 | Grok |\n', '905', 899, false);
runCase('Grok range cannot be borrowed by GPT', '| R139 | complete |\n', '139', 900, false);
const unfiltered = guard.replace('used.filter(n => n >= 100 && n <= 899)', 'used');
assert.notEqual(unfiltered, guard, 'range negative control must change the production guard');
runCase('negative control: unfiltered Grok card recreates R140 rejection', '| R139 | complete |\n| R905 | Grok |\n', '905', 140, false, unfiltered);
