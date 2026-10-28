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
const STOP_SWITCHES = ['暫停', '停止', '等方向'];

// 開關＝「## 開關」下面第一個非空行，而且整行剛好是 **運行**／**暫停**／**停止**／**等方向**。
// 寫錯、刪掉、重複標題、塞註解在前面，一律讀成 null（＝停），寧可停錯也不要放錯。
function switchOf(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const heads = lines.filter(l => l.trim() === '## 開關');
  if (heads.length !== 1) return null;
  const i = lines.findIndex(l => l.trim() === '## 開關');
  const first = lines.slice(i + 1).find(l => l.trim());
  const m = first && first.trim().match(/^\*\*(運行|暫停|停止|等方向)\*\*$/);
  return m ? m[1] : null;
}
// 方向檔「## 待辦」以上的部分，開關那一行換成佔位字：GPT 除了開關值，這一段一個字都不能動
function upperPart(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.trim() === '## 開關');
  if (i >= 0) { const j = lines.findIndex((l, k) => k > i && l.trim()); if (j >= 0) lines[j] = '<開關>'; }
  const t = lines.findIndex(l => l.startsWith('## 待辦'));
  return lines.slice(0, t < 0 ? undefined : t).join('\n');
}

const mergeBase = git('merge-base', BASE, HEAD).trim();
const baseDir = show(BASE, DIR_FILE), mbDir = show(mergeBase, DIR_FILE), headDir = show(HEAD, DIR_FILE);
const baseSwitch = switchOf(baseDir), mbSwitch = switchOf(mbDir), headSwitch = switchOf(headDir);
// --no-renames：改名＝刪舊檔＋加新檔，兩個路徑都要過下面的白名單
const files = git('diff', '--no-renames', '--name-only', `${BASE}...${HEAD}`).split('\n').filter(Boolean);
const statusOnly = files.length > 0 && files.every(f => f === DIR_FILE);
notes.push(`main 的開關：${baseSwitch ?? '讀不到（當作停）'}；這個 PR 改了 ${files.length} 個檔`);

// 1. main 的開關不是「運行」：只准「只改方向檔」的狀態更新
if (baseSwitch !== '運行' && !statusOnly) no(`main 的開關是「${baseSwitch ?? '讀不到'}」，不是「運行」：除了只改方向檔的狀態更新，GPT 的 PR 一律不進 main。`);

// 2. 方向檔：「待辦」以上只准改開關值，而且只准改成停下來的值（跟分支起點比，main 之後改了方向不算 GPT 的錯）
if (files.includes(DIR_FILE)) {
  if (upperPart(mbDir) !== upperPart(headDir)) no('方向檔「## 待辦」以上（開關說明、方向、業主原話）GPT 不准動；只准改開關那一行。');
  if (headSwitch !== mbSwitch && !STOP_SWITCHES.includes(headSwitch ?? '')) no(`GPT 只能把開關改成「暫停／停止／等方向」，不能改成「${headSwitch ?? '讀不到的值'}」。`);
}

// 3. 白名單：GPT 只准改這些路徑（其他都是規則、守衛、CI、工具鏈、全局觀感）
const ALLOWED = [
  /^src\/(?!render\/post\.ts$).+/,          // 程式（後製＝全局觀感除外）
  /^index\.html$/,
  /^docs\/tasks\/R(?!0\d\d-)\d{3,}-[^/]+\.md$/, // GPT 的卡（R001–R099 是 Claude 的）
  /^docs\/GPT-方向\.md$/,
  /^tests\/[^/]+\.mjs$/,                      // GPT 自己加的守衛
  /^tools\/golden\.json$/,
  /^(LOG|README)\.md$/,
];
for (const f of files) if (!ALLOWED.some(re => re.test(f))) no(`改到白名單以外的檔案 ${f}：GPT 車道不准改（規則、守衛、CI、工具鏈、後製）。要改請 PR 標「等業主」並在卡面說明，交業主或 Claude。`);
// R061：Claude 的結構守衛（總機長度、閥表；R066 加卡號不重複）GPT 不改；上限檔在 tools/ 本來就改不到
const CLAUDE_TESTS = /^tests\/(hub-budget|valves|card-numbers)\.mjs$/;
for (const f of files) if (CLAUDE_TESTS.test(f)) no(`改到 Claude 的結構守衛 ${f}：總機行數上限、閥表、卡號不重複這幾支只有 Claude 改。總機放不下就先把東西搬出去；新閥加在 src/valves.ts 一行；撞號就把後來的卡改號。`);

// 4. 卡面：一張新卡；卡號比 main 上出現過的都大；第一個提交只放卡；卡頭機讀欄；驗收段落沒被改；卡之外真的有施工
if (!statusOnly) {
  const cards = files.filter(f => /^docs\/tasks\/R\d{3,}-.+\.md$/.test(f) && !show(BASE, f) && show(HEAD, f));
  if (cards.length !== 1) no(`要剛好新增一張卡（docs/tasks/R<號>-主題.md），現在 ${cards.length} 張：${cards.join(' ')}`);
  else {
    const card = cards[0], num = Number(card.match(/R(\d+)/)[1]);
    // 日誌只以第一欄的正式迭代號保留用號；敘述中引用別卡不是使用該號。
    // 已撤回且卡面刪除的迭代仍由歷史日誌列保留，不准重用。
    const used = [...git('ls-tree', '-r', '--name-only', BASE, 'docs/tasks').matchAll(/R(\d{3,})-/g), ...(show(BASE, 'LOG.md') ?? '').matchAll(/^\s*\|\s*R(\d{3,})\s*\|/gm)].map(m => Number(m[1]));
    const maxUsed = Math.max(99, ...used);
    if (num < 100) no(`GPT 的卡號從 R100 起（R001–R099 留給 Claude），這張是 R${num}。`);
    else if (num <= maxUsed) no(`卡號 R${num} 不比 main 上用過的最大號 R${maxUsed} 大：卡號只往上加，不重用（撤回過的號也不用）。`);
    const text = show(HEAD, card) ?? '';
    const hdr = text.match(/<!--\s*card:\s*sim=(yes|no);\s*golden=([^;]*);\s*valve=([^;]*);\s*owner_ok=([^>]*?)\s*-->/);
    if (!hdr) no(`卡頭缺機讀欄：標題下一行要有 <!-- card: sim=yes|no; golden=舊→新或無; valve=?noR${num}或無; owner_ok= -->`);
    else {
      const sim = hdr[1] === 'yes';
      const simTouched = files.some(f => f.startsWith('src/sim/')), goldenTouched = files.includes('tools/golden.json');
      if (!sim && simTouched) no('卡頭寫 sim=no，卻改了 src/sim/。');
      if (!sim && goldenTouched) no('卡頭寫 sim=no，卻改了 tools/golden.json。');
      if (goldenTouched && !/→/.test(hdr[2])) no('改了黃金雜湊，卡頭 golden= 要寫「舊→新」。');
      notes.push(`卡 ${card}：sim=${hdr[1]} golden=${hdr[2].trim() || '（空）'} valve=${hdr[3].trim() || '（空）'}`);
    }
    // 第一個提交只放這張卡（卡面先推、驗收先寫）
    const commits = git('rev-list', '--topo-order', '--reverse', `${BASE}..${HEAD}`).split('\n').filter(Boolean);
    const first = commits[0];
    const firstFiles = first ? git('diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', first).split('\n').filter(Boolean) : [];
    if (!(firstFiles.length === 1 && firstFiles[0] === card)) no(`分支的第一個提交要只放卡面 ${card}（現在是：${firstFiles.join(' ') || '沒有提交'}）。`);
    else {
      const acc = t => { const ls = (t ?? '').split('\n'), i = ls.findIndex(l => l.trim() === '## 驗收（動手前寫）'); if (i < 0) return null; const j = ls.findIndex((l, k) => k > i && /^## /.test(l)); return ls.slice(i + 1, j < 0 ? undefined : j).join('\n').trim(); };
      const before = acc(show(first, card)), after = acc(text);
      if (!before) no('卡面要有「## 驗收（動手前寫）」一節。');
      else if (before !== after) no('「驗收（動手前寫）」在第一個提交之後被改過（驗收條件寫了就不准改）。');
    }
    // 只有卡面、還沒施工的 PR 不能合（不然卡會先進 main，這一項就卡死了）
    const work = files.filter(f => f !== card && f !== DIR_FILE && f !== 'LOG.md');
    if (commits.length < 2 || work.length === 0) no('這個 PR 只有卡面（或只有卡面加方向檔、日誌），還沒施工：做完再轉 ready。');
  }
}

for (const n of notes) console.log('・' + n);
if (problems.length) { console.log('\nNG GPT 車道不通過：'); problems.forEach((p, i) => console.log(`${i + 1}. ${p}`)); process.exit(1); }
console.log('\nOK GPT 車道通過');
