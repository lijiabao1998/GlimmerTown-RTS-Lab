// R129 精確 CI 例外候選：執行完整守衛，以只讀 Git 契約 fixture 驗每個拒絕及第一個紅燈。
// 不需要完整 checkout 歷史、不連網、不寫原倉庫；真實 Git 歷史另由本地接續驗證。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../tools/gpt-lane.mjs', import.meta.url), 'utf8');
const CI = '.github/workflows/ci.yml', CARD = 'docs/tasks/R129-沙盒互動回饋修補.md';
const BRANCH = 'gpt/sandbox-feedback-r129';
const BASE_PIN = '7cbc1100928620e6fe138a6368e92d1fce68a234';
const HEAD_PIN = '76c93727d7eda8ce1920c97dd181f284f314c81d';
const CI_BLOB = 'ff61451de0bffce035dd651da60fc11c31c71ed7';
const BASE = 'fixture-main', HEAD = 'fixture-head', FIRST = 'fixture-first';
const DIR = 'docs/GPT-方向.md';
const direction = value => `# 方向\n## 開關\n**${value}**\n\n## 方向\n固定方向\n\n## 待辦\n32 修補\n`;
const card = `# R129 修補\n<!-- card: sim=yes; golden=eea1d59b→eea1d59b; valve=?noR128=1; owner_ok= -->\n## 驗收（動手前寫）\n固定驗收，不准改。\n## 施工紀錄\n施工。\n`;
const defaults = () => ({
  branch: BRANCH, files: [CI, CARD, 'src/ui/sandbox.ts', 'LOG.md'],
  baseDirection: direction('運行'), headDirection: direction('運行'),
  cardPath: CARD, cardText: card, firstCard: card, firstFiles: [CARD],
  baseAncestor: true, headAncestor: true, blob: CI_BLOB, mode: '100644',
});

function run(code, changes = {}) {
  const f = { ...defaults(), ...changes }, lines = [], unexpected = [];
  const exit = {}, missing = () => { throw new Error('fixture: missing Git object'); };
  const execFileSync = (command, raw) => {
    assert.equal(command, 'git');
    assert.deepEqual(Array.from(raw.slice(0, 2)), ['-c', 'core.quotepath=off']);
    const a = Array.from(raw.slice(2));
    if (a[0] === 'show') {
      const colon = a[1].indexOf(':'), ref = a[1].slice(0, colon), file = a[1].slice(colon + 1);
      if (ref === BASE) {
        if (file === DIR) return f.baseDirection;
        if (file === 'LOG.md') return 'R128\n';
        if (file === CARD && f.cardInBase) return card;
        return missing();
      }
      if (ref === HEAD) {
        if (file === DIR) return f.headDirection;
        if (file === f.cardPath) return f.cardText;
        if (file === f.extraCard) return card;
        return missing();
      }
      if (ref === FIRST && file === f.cardPath) return f.firstCard;
    }
    if (a.join('|') === `merge-base|${BASE}|${HEAD}`) return BASE + '\n';
    if (a[0] === 'merge-base' && a[1] === '--is-ancestor') {
      if (a[2] === BASE_PIN && a[3] === BASE) return f.baseAncestor ? '' : missing();
      if (a[2] === HEAD_PIN && a[3] === HEAD) return f.headAncestor ? '' : missing();
    }
    if (a.join('|') === `rev-parse|--verify|${HEAD}:${CI}`) return f.blob === null ? missing() : f.blob + '\n';
    if (a.join('|') === `ls-tree|${HEAD}|--|${CI}`) return f.mode === null ? missing() : `${f.mode} blob ${f.blob}\t${CI}\n`;
    if (a.join('|') === `diff|--no-renames|--name-only|${BASE}...${HEAD}`) return f.files.join('\n') + '\n';
    if (a.join('|') === `ls-tree|-r|--name-only|${BASE}|docs/tasks`) return 'docs/tasks/R128-沙盒.md\n';
    if (a.join('|') === `rev-list|--topo-order|--reverse|${BASE}..${HEAD}`) return [FIRST, HEAD].join('\n') + '\n';
    if (a.join('|') === `diff-tree|--no-commit-id|--no-renames|--name-only|-r|${FIRST}`) return f.firstFiles.join('\n') + '\n';
    unexpected.push(a);
    throw new Error('unexpected Git read: ' + a.join(' '));
  };
  const importLine = /^import \{ execFileSync \} from 'node:child_process';\r?\n/m;
  assert(importLine.test(code), 'guard import anchor present');
  let status = 0;
  try {
    vm.runInNewContext(code.replace(importLine, ''), {
      execFileSync, process: { env: { BASE, HEAD_REF: HEAD, BRANCH: f.branch }, exit(n) { status = n; throw exit; } },
      console: { log(...args) { lines.push(args.join(' ')); } },
    }, { timeout: 1000, filename: 'gpt-lane-candidate.mjs' });
  } catch (e) { if (e !== exit) throw e; }
  assert.deepEqual(unexpected, [], 'fixture must recognize every actual Git read');
  const output = lines.join('\n');
  return { status, output, firstRed: output.match(/^1\. (.+)$/m)?.[1] ?? null };
}

const rejected = [], passed = [];
function pass(name, changes = {}) {
  const result = run(source, changes);
  assert.equal(result.status, 0, name + ': ' + result.output);
  assert.equal(result.firstRed, null, name);
  passed.push(name);
}
function reject(code, name, changes, firstRed) {
  const result = run(code, changes);
  assert.equal(result.status, 1, name + ': unauthorized change must fail');
  assert(result.firstRed?.includes(firstRed), `${name}: first red must be ${firstRed}; actual ${result.firstRed}`);
  return result.firstRed;
}
const protectedPath = path => `白名單以外的檔案 ${path}`;
pass('exact approved R129 CI blob');
assert(run(source).output.includes('R129 CI 精確例外'), 'approval note identifies the narrow exception');
pass('ordinary allowed descendant changes', { files: [CI, CARD, 'src/ui/sandbox.ts', 'README.md'] });
pass('ordinary GPT change without CI', { branch: 'gpt/ordinary', files: [CARD, 'src/ui/sandbox.ts'] });
pass('stopped status-only update', { files: [DIR], baseDirection: direction('停止'), headDirection: direction('停止') });
pass('non-GPT guard scope unchanged', { branch: 'claude/example' });

const otherCard = 'docs/tasks/R130-其他.md';
const cases = [
  ['other GPT branch', { branch: 'gpt/other' }, protectedPath(CI)],
  ['branch prefix is not approval', { branch: BRANCH + '-copy' }, protectedPath(CI)],
  ['unrelated main history', { baseAncestor: false }, protectedPath(CI)],
  ['missing approved head ancestor', { headAncestor: false }, protectedPath(CI)],
  ['one changed workflow blob', { blob: '0'.repeat(40) }, protectedPath(CI)],
  ['missing or deleted workflow', { blob: null }, protectedPath(CI)],
  ['renamed workflow', { blob: null, files: [CI, '.github/workflows/renamed.yml', CARD] }, protectedPath(CI)],
  ['other workflow remains protected', { files: [CI, CARD, '.github/workflows/other.yml'] }, protectedPath('.github/workflows/other.yml')],
  ['guard cannot approve itself', { files: [CI, CARD, 'tools/gpt-lane.mjs'] }, protectedPath('tools/gpt-lane.mjs')],
  ['package remains protected', { files: [CI, CARD, 'package.json'] }, protectedPath('package.json')],
  ['rules remain protected', { files: [CI, CARD, 'AGENTS.md'] }, protectedPath('AGENTS.md')],
  ['post remains protected', { files: [CI, CARD, 'src/render/post.ts'] }, protectedPath('src/render/post.ts')],
  ['exception cannot follow another card', { cardPath: otherCard, files: [CI, otherCard, 'src/ui/sandbox.ts'], firstFiles: [otherCard] }, protectedPath(CI)],
  ['merged R129 card cannot reuse approval', { cardInBase: true }, protectedPath(CI)],
  ['main stop still wins', { baseDirection: direction('停止') }, 'main 的開關是「停止」'],
  ['malformed main switch still stops', { baseDirection: '## 開關\n<!-- hidden -->\n**運行**\n' }, 'main 的開關是「讀不到」'],
  ['protected direction prefix', { files: [CI, CARD, DIR], headDirection: direction('運行').replace('固定方向', '偷改方向') }, '方向檔「## 待辦」以上'],
  ['first commit card only', { firstFiles: [CARD, 'src/ui/sandbox.ts'] }, '分支的第一個提交要只放卡面'],
  ['frozen acceptance still applies', { cardText: card.replace('固定驗收，不准改。', '偷改驗收。') }, '「驗收（動手前寫）」在第一個提交之後被改過'],
  ['card header still required', { cardText: card.replace(/<!--.*-->/, '') }, '卡頭缺機讀欄'],
  ['two cards still rejected', { extraCard: otherCard, files: [CI, CARD, otherCard] }, '要剛好新增一張卡'],
  ['sim=no cannot edit simulation', { files: [CI, CARD, 'src/sim/step.ts'], cardText: card.replace('sim=yes', 'sim=no') }, '卡頭寫 sim=no，卻改了 src/sim/'],
  ['sim=no cannot edit golden', { files: [CI, CARD, 'tools/golden.json'], cardText: card.replace('sim=yes', 'sim=no') }, '卡頭寫 sim=no，卻改了 tools/golden.json'],
  ['old card number remains rejected', { files: ['docs/tasks/R100-重用.md', 'src/ui/sandbox.ts'], cardPath: 'docs/tasks/R100-重用.md', firstFiles: ['docs/tasks/R100-重用.md'] }, '不比 main 上用過的最大號'],
  ['card only remains rejected', { files: [CARD] }, '還沒施工'],
  ['same blob with executable mode', { mode: '100755' }, protectedPath(CI)],
  ['same blob as symbolic link', { mode: '120000' }, protectedPath(CI)],
  ['missing file mode', { mode: null }, protectedPath(CI)],
];
for (const [name, changes, firstRed] of cases) rejected.push({ name, firstRed: reject(source, name, changes, firstRed) });

// 故意破壞每個新限制；同一語意拒絕案例必須首先變紅，不能只因錨點或啟動錯誤而紅。
const mutations = [
  ['branch binding', `  && BRANCH === '${BRANCH}'`, '', 0],
  ['base history binding', `  && ancestor('${BASE_PIN}', BASE)`, '', 2],
  ['head history binding', `  && ancestor('${HEAD_PIN}', HEAD)`, '', 3],
  ['R129 card binding', '  && files.includes(R129_CARD) && show(BASE, R129_CARD) === null && show(HEAD, R129_CARD) !== null', '', 12],
  ['workflow blob binding', `  && blob(HEAD, R129_CI) === '${CI_BLOB}'`, '', 4],
  ['file mode binding', "  && mode(HEAD, R129_CI) === '100644';", ';', 25],
  ['path binding', '(f === R129_CI && r129CiApproved)', 'r129CiApproved', 8],
  ['later guards cannot be skipped', '// 4. 卡面：', 'if (r129CiApproved) process.exit(0);\n// 4. 卡面：', 18],
];
const mutantResults = [];
for (const [name, before, after, index] of mutations) {
  assert.equal(source.split(before).length, 2, name + ': mutation anchor must occur exactly once');
  const [caseName, changes, firstRed] = cases[index];
  assert.throws(() => reject(source.replace(before, after), caseName, changes, firstRed),
    e => e.code === 'ERR_ASSERTION' && e.message.startsWith(caseName + ': unauthorized change must fail'),
    name + ': intended semantic assertion must catch the mutant');
  mutantResults.push(name);
}
console.log(`OK R129 lane candidate: ${passed.length} controls, ${rejected.length} rejected inputs, ${mutantResults.length} semantic mutants; main adoption not performed`);
for (const result of rejected) console.log(`  rejected ${result.name}: ${result.firstRed}`);
for (const name of mutantResults) console.log(`  mutant caught: ${name}`);
