// GPT 車道的合併：ci 在 gpt/* PR 上綠燈後由 .github/workflows/gpt-merge.yml 呼叫（用 main 上的這一份，PR 改不到）。
// 只讀 git 物件、只呼叫 GitHub API，不執行 PR 裡的任何程式。條件全部成立才合（AGENTS.md 第 4 節）。
import { execFileSync } from 'node:child_process';

const HEAD_SHA = process.env.HEAD_SHA, BRANCH = process.env.HEAD_BRANCH || '';
const DAILY_CAP = Number(process.env.DAILY_CAP || 8);
const HOLD = ['等業主', '卡住', 'needs-human', 'hold'];
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opt });
const gh = (...a) => run('gh', a);
const say = m => console.log(m);
const skip = m => { say('不合：' + m); process.exit(0); };   // 不合不是錯誤，工作流保持綠

if (!BRANCH.startsWith('gpt/') || !/^[0-9a-f]{40}$/.test(HEAD_SHA || '')) skip(`不是 gpt/ 分支或沒有提交雜湊（${BRANCH} ${HEAD_SHA}）`);

const prs = JSON.parse(gh('pr', 'list', '--state', 'open', '--head', BRANCH, '--json', 'number,headRefOid,isDraft,title,labels,baseRefName'));
if (prs.length !== 1) skip(`分支 ${BRANCH} 開著的 PR 有 ${prs.length} 個`);
const pr = prs[0];
if (pr.headRefOid !== HEAD_SHA) skip(`PR #${pr.number} 的最新提交 ${pr.headRefOid.slice(0, 7)} 不是 CI 跑綠的那一個 ${HEAD_SHA.slice(0, 7)}`);
if (pr.isDraft) skip(`PR #${pr.number} 還是草稿`);
if (pr.baseRefName !== 'main') skip(`PR #${pr.number} 不是要合進 main`);
const held = pr.labels.map(l => l.name).filter(n => HOLD.includes(n));
if (held.length) skip(`PR #${pr.number} 有標籤 ${held.join('、')}`);
if (/^\s*[\[［](等業主|卡住)/.test(pr.title)) skip(`PR #${pr.number} 標題標著等業主／卡住`);
if (!/^R\d{3,}/.test(pr.title)) skip(`PR #${pr.number} 標題要用「R<號>［待辦 N］主題」`);

// 用 main 上的守衛再驗一次（CI 那一趟可能跑的是 PR 改過的工作流）
run('git', ['fetch', '--no-tags', 'origin', 'main', `+refs/pull/${pr.number}/head:refs/remotes/pr/${pr.number}`]);
try { run('git', ['merge-base', '--is-ancestor', 'origin/main', HEAD_SHA]); }
catch { skip(`PR #${pr.number} 沒有接在最新的 main 上（先把 main 合進分支，CI 會在最新的 main 上重跑）`); }
try { say(run('node', ['tools/gpt-lane.mjs'], { env: { ...process.env, BASE: 'origin/main', HEAD_REF: HEAD_SHA, BRANCH } })); }
catch (e) { skip(`GPT 車道守衛不通過：\n${e.stdout || e.message}`); }

// 每天最多合幾個（UTC 日）
const today = new Date().toISOString().slice(0, 10);
const merged = JSON.parse(gh('pr', 'list', '--state', 'merged', '--limit', '60', '--json', 'headRefName,mergedAt'));
const n = merged.filter(p => p.headRefName.startsWith('gpt/') && (p.mergedAt || '').startsWith(today)).length;
if (n >= DAILY_CAP) skip(`今天（UTC ${today}）已經合了 ${n} 個 GPT PR，上限 ${DAILY_CAP}`);

gh('pr', 'merge', String(pr.number), '--squash', '--match-head-commit', HEAD_SHA, '--delete-branch');
say(`已合併 PR #${pr.number}（${pr.title}）`);
// GITHUB_TOKEN 推進 main 不會觸發其他工作流；手動派一次 ci，讓 main 重跑並發布 Pages
gh('workflow', 'run', 'ci.yml', '--ref', 'main');
say('已派 ci 到 main（重跑守衛並發布 Pages）');
