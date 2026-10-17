// GPT 車道的合併員，由 .github/workflows/gpt-merge.yml 呼叫（用 main 上的這一份，PR 改不到）。
// 兩種模式：ci 跑完（HEAD_SHA、HEAD_BRANCH 有值）只看那一個 PR；排程掃描（沒有值）看所有開著的 gpt/* PR。
// 只讀 git 物件、只呼叫 GitHub API，不執行 PR 裡的任何程式。條件全部成立才合（AGENTS.md 第 4 節）。
import { execFileSync } from 'node:child_process';

const DAILY_CAP = Number(process.env.DAILY_CAP || 8);
const HOLD = ['等業主', '卡住', 'needs-human', 'hold'];
const DIR_FILE = 'docs/GPT-方向.md';
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opt });
const gh = (...a) => run('gh', a);
const git = (...a) => run('git', ['-c', 'core.quotepath=off', ...a]);
const say = m => console.log(m);

const today = new Date().toISOString().slice(0, 10);
function mergedToday() {
  const merged = JSON.parse(gh('pr', 'list', '--state', 'merged', '--limit', '60', '--json', 'headRefName,mergedAt,isCrossRepository'));
  return merged.filter(p => !p.isCrossRepository && p.headRefName.startsWith('gpt/') && (p.mergedAt || '').startsWith(today)).length;
}

// 這個提交上有沒有一趟跑完而且綠的 ci（pull_request 事件），而且沒有還在跑或紅的
function ciGreen(sha) {
  const runs = JSON.parse(gh('run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--limit', '20', '--json', 'status,conclusion,event'));
  const pr = runs.filter(r => r.event === 'pull_request');
  if (!pr.length) return '這個提交上還沒有 PR 的 ci';
  if (pr.some(r => r.status !== 'completed')) return 'ci 還在跑';
  if (pr[0].conclusion !== 'success') return `最近一趟 ci 是 ${pr[0].conclusion}`;
  return null;
}

// 回傳 null＝合了；字串＝為什麼不合
function tryMerge(pr, sha) {
  if (pr.isCrossRepository) return `PR #${pr.number} 來自別人的 fork`;
  if (pr.headRefOid !== sha) return `PR #${pr.number} 的最新提交 ${pr.headRefOid.slice(0, 7)} 不是 ci 跑綠的那一個 ${sha.slice(0, 7)}`;
  if (pr.isDraft) return `PR #${pr.number} 還是草稿`;
  if (pr.baseRefName !== 'main') return `PR #${pr.number} 不是要合進 main`;
  const held = pr.labels.map(l => l.name).filter(n => HOLD.includes(n));
  if (held.length) return `PR #${pr.number} 有標籤 ${held.join('、')}`;
  if (/^\s*[\[［](等業主|卡住)/.test(pr.title)) return `PR #${pr.number} 標題標著等業主／卡住`;

  git('fetch', '--no-tags', 'origin', 'main', `+refs/pull/${pr.number}/head:refs/remotes/pr/${pr.number}`);
  try { git('merge-base', '--is-ancestor', 'origin/main', sha); }
  catch { return `PR #${pr.number} 沒有接在最新的 main 上（先把 main 合進分支，ci 會在最新的 main 上重跑）`; }
  const files = git('diff', '--no-renames', '--name-only', `origin/main...${sha}`).split('\n').filter(Boolean);
  const statusOnly = files.length > 0 && files.every(f => f === DIR_FILE);
  if (!statusOnly && !/^R\d{3,}/.test(pr.title)) return `PR #${pr.number} 標題要用「R<號>［待辦 N］主題」（只改方向檔的狀態更新不用）`;
  // 用 main 上的守衛再驗一次（ci 那一趟跑的可能是 PR 改過的工作流）
  try { say(run('node', ['tools/gpt-lane.mjs'], { env: { ...process.env, BASE: 'origin/main', HEAD_REF: sha, BRANCH: pr.headRefName } })); }
  catch (e) { return `GPT 車道守衛不通過：\n${e.stdout || e.message}`; }
  const n = mergedToday();
  if (!statusOnly && n >= DAILY_CAP) return `今天（UTC ${today}）已經合了 ${n} 個 GPT PR，上限 ${DAILY_CAP}（明天的排程掃描會再試）`;

  gh('pr', 'merge', String(pr.number), '--squash', '--match-head-commit', sha, '--delete-branch');
  say(`已合併 PR #${pr.number}（${pr.title}）`);
  // GITHUB_TOKEN 推進 main 不會觸發其他工作流；手動派一次 ci，讓 main 重跑並發布 Pages
  gh('workflow', 'run', 'ci.yml', '--ref', 'main');
  say('已派 ci 到 main（重跑守衛並發布 Pages）');
  return null;
}

const FIELDS = 'number,headRefName,headRefOid,isDraft,isCrossRepository,title,labels,baseRefName';
const HEAD_SHA = process.env.HEAD_SHA || '', BRANCH = process.env.HEAD_BRANCH || '';
if (HEAD_SHA) {
  if (!BRANCH.startsWith('gpt/') || !/^[0-9a-f]{40}$/.test(HEAD_SHA)) { say(`不合：不是 gpt/ 分支或沒有提交雜湊（${BRANCH} ${HEAD_SHA}）`); process.exit(0); }
  const prs = JSON.parse(gh('pr', 'list', '--state', 'open', '--head', BRANCH, '--json', FIELDS)).filter(p => !p.isCrossRepository);
  if (prs.length !== 1) { say(`不合：分支 ${BRANCH} 開著的（本倉庫）PR 有 ${prs.length} 個`); process.exit(0); }
  const why = tryMerge(prs[0], HEAD_SHA);
  if (why) say('不合：' + why);
} else {
  // 排程掃描：每個開著的 gpt/* PR，最新提交上 ci 綠了就試著合（一次最多合一個，合完 main 會動，其他的等下一輪）
  const prs = JSON.parse(gh('pr', 'list', '--state', 'open', '--limit', '50', '--json', FIELDS)).filter(p => !p.isCrossRepository && p.headRefName.startsWith('gpt/'));
  say(`排程掃描：開著的 gpt/* PR ${prs.length} 個`);
  for (const pr of prs) {
    const ci = ciGreen(pr.headRefOid);
    if (ci) { say(`#${pr.number}：${ci}`); continue; }
    const why = tryMerge(pr, pr.headRefOid);
    if (!why) break;
    say(`#${pr.number}：${why}`);
  }
}
