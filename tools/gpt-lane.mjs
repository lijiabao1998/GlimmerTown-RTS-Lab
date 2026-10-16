// GPT 車道守衛：gpt/* 分支的 PR 能不能進 main，機器說了算（AGENTS.md 第 4 節）。
// CI 與合併工作流都用 main 上的這一份跑（PR 改不到它）。
// 用法：BASE=origin/main HEAD_REF=<sha 或分支> BRANCH=gpt/xxx node tools/gpt-lane.mjs　退出碼 0＝可以、1＝不行
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'origin/main';
const HEAD = process.env.HEAD_REF || 'HEAD';
const BRANCH = process.env.BRANCH || '';
// core.quotepath=off：中文檔名（docs/GPT-方向.md、中文卡名）才不會被 git 轉成跳脫字串
const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=off', ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const show = (ref, file) => { try { return git('show', `${ref}:${file}`); } catch { return null; } };
const problems = [], notes = [];
const no = msg => problems.push(msg);

if (!BRANCH.startsWith('gpt/')) { console.log(`不是 gpt/ 分支（${BRANCH || '未知'}），本守衛不適用。`); process.exit(0); }

const DIR_FILE = 'docs/GPT-方向.md';
const SWITCHES = ['運行', '暫停', '停止', '等方向'];
const STOP_SWITCHES = ['暫停', '停止', '等方向'];

// 方向檔的段落：## 開關 的值、## 方向 整段
function section(text, title) {
  if (!text) return null;
  const lines = text.split('\n'), i = lines.findIndex(l => l.trim() === `## ${title}`);
  if (i < 0) return null;
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join('\n').trim();
}
function switchOf(text) {
  const s = section(text, '開關');
  const m = s && s.match(/\*\*(運行|暫停|停止|等方向)\*\*/);
  return m ? m[1] : null;
}

const baseDir = show(BASE, DIR_FILE), headDir = show(HEAD, DIR_FILE);
const baseSwitch = switchOf(baseDir), headSwitch = switchOf(headDir);
const files = git('diff', '--name-only', `${BASE}...${HEAD}`).split('\n').filter(Boolean);
const statusOnly = files.length > 0 && files.every(f => f === DIR_FILE);
notes.push(`main 的開關：${baseSwitch ?? '讀不到'}；這個 PR 改了 ${files.length} 個檔`);

// 1. 開關不是「運行」：只准「只改方向檔」的狀態更新
if (baseSwitch !== '運行' && !statusOnly) no(`main 的開關是「${baseSwitch ?? '讀不到'}」，不是「運行」：除了只改方向檔的狀態更新，GPT 的 PR 一律不進 main。`);

// 2. 方向檔：「方向」一段不准動；「開關」只准改成停下來的值
if (files.includes(DIR_FILE)) {
  if (section(baseDir, '方向') !== section(headDir, '方向')) no('方向檔的「## 方向」只照業主原話改，GPT 不准動。');
  if (headSwitch !== baseSwitch) {
    if (!SWITCHES.includes(headSwitch ?? '')) no(`方向檔的開關讀不到合法值（${headSwitch}）。`);
    else if (!STOP_SWITCHES.includes(headSwitch)) no(`GPT 只能把開關改成「暫停／停止／等方向」，不能改成「${headSwitch}」。`);
  }
}

// 3. 保護的檔案：規則、守衛、CI、相依套件、全局觀感
const PROTECTED = [
  [/^\.github\//, 'CI 設定'],
  [/^tools\/(?!golden\.json$)/, '守衛與工具（tools/golden.json 除外）'],
  [/^(AGENTS|CLAUDE)\.md$/, '規則檔'],
  [/^docs\/(迭代不改壞標準|DOTS|DECISIONS|R000-願景)\.md$/, '規則與業主決定'],
  [/^(package\.json|package-lock\.json|tsconfig\.json|vite\.config\.ts)$/, '工具鏈與相依套件'],
  [/^src\/render\/post\.ts$/, '全局觀感（後製、畫風）'],
];
for (const f of files) for (const [re, why] of PROTECTED) if (re.test(f)) no(`動到受保護的檔案 ${f}（${why}）：GPT 車道不准改，要改請在 PR 標「等業主」並在卡面說明，交業主或 Claude。`);

// 4. 卡面：一張 R100 以上的新卡；第一個提交只放卡；卡頭機讀欄；驗收段落沒被改
if (!statusOnly) {
  const cards = files.filter(f => /^docs\/tasks\/R\d{3,}-.+\.md$/.test(f) && !show(BASE, f));
  if (cards.length !== 1) no(`要剛好新增一張卡（docs/tasks/R<號>-主題.md），現在 ${cards.length} 張：${cards.join(' ')}`);
  else {
    const card = cards[0], num = Number(card.match(/R(\d+)/)[1]);
    if (num < 100) no(`GPT 的卡號從 R100 起（R001–R099 留給 Claude），這張是 R${num}。`);
    const text = show(HEAD, card) ?? '';
    const hdr = text.match(/<!--\s*card:\s*sim=(yes|no);\s*golden=([^;]*);\s*valve=([^;]*);\s*owner_ok=([^>]*?)\s*-->/);
    if (!hdr) no(`卡頭缺機讀欄：標題下一行要有 <!-- card: sim=yes|no; golden=舊→新或無; valve=?noR${num}; owner_ok= -->`);
    else {
      const sim = hdr[1] === 'yes';
      const simTouched = files.some(f => f.startsWith('src/sim/')), goldenTouched = files.includes('tools/golden.json');
      if (!sim && simTouched) no('卡頭寫 sim=no，卻改了 src/sim/。');
      if (!sim && goldenTouched) no('卡頭寫 sim=no，卻改了 tools/golden.json。');
      if (goldenTouched && !/→/.test(hdr[2])) no('改了黃金雜湊，卡頭 golden= 要寫「舊→新」。');
      notes.push(`卡 ${card}：sim=${hdr[1]} golden=${hdr[2].trim() || '（空）'} valve=${hdr[3].trim() || '（空）'}`);
    }
    // 第一個提交只放這張卡（卡面先推、驗收先寫）
    const commits = git('rev-list', '--reverse', `${BASE}..${HEAD}`).split('\n').filter(Boolean);
    const first = commits[0];
    const firstFiles = first ? git('diff-tree', '--no-commit-id', '--name-only', '-r', first).split('\n').filter(Boolean) : [];
    if (!(firstFiles.length === 1 && firstFiles[0] === card)) no(`分支的第一個提交要只放卡面 ${card}（現在是：${firstFiles.join(' ') || '沒有提交'}）。`);
    else {
      const acc = t => section(t, '驗收（動手前寫）') ?? section(t, '驗收');
      const before = acc(show(first, card)), after = acc(text);
      if (!before) no('卡面要有「## 驗收（動手前寫）」一節。');
      else if (before !== after) no('「驗收（動手前寫）」在第一個提交之後被改過（驗收條件寫了就不准改）。');
    }
  }
}

for (const n of notes) console.log('・' + n);
if (problems.length) { console.log('\nNG GPT 車道不通過：'); problems.forEach((p, i) => console.log(`${i + 1}. ${p}`)); process.exit(1); }
console.log('\nOK GPT 車道通過');
