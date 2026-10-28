// R066 卡號不准重複：docs/tasks/ 裡一個 R 號只能有一張卡，LOG.md 表格裡一個 R 號只能有一列。
// 2026-10-28 #101 與 #102 都用了 R904：各自 CI 都綠，合在一起才撞。後合的那張要改號。
import assert from 'node:assert/strict';
import fs from 'node:fs';

export function duplicates(cardFiles, logText) {
  const files = new Map(), rows = new Map();
  for (const f of cardFiles) {
    const m = /^R(\d{3})(?!\d)/.exec(f);
    if (m) files.set(m[1], [...(files.get(m[1]) ?? []), f]);
  }
  for (const line of logText.split('\n')) {
    const m = /^\| R(\d{3}) \|/.exec(line);
    if (m) rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
  }
  return {
    cards: [...files].filter(([, list]) => list.length > 1).map(([n, list]) => `R${n}：${list.join('、')}`),
    log: [...rows].filter(([, count]) => count > 1).map(([n, count]) => `R${n}：LOG.md 有 ${count} 列`),
  };
}

const HOW = '後來的那張改成沒人用過的號（開卡前看 origin/main 的 docs/tasks/、LOG.md 與所有開著的 PR）：卡檔名、卡頭標題、LOG 那一列、PR 標題一起改。';

// 負控：同號兩張卡、LOG 同號兩列都要抓得到；不同號、檔名裡別處出現的號（「接續R131」）不算
{
  const bad = duplicates(['R904-教學打磨.md', 'R904-手機直向打磨.md', 'R903-風格指南.md'], '| R904 | a |\n| R904 | b |\n| R903 | c |\n');
  assert.deepEqual(bad.cards, ['R904：R904-教學打磨.md、R904-手機直向打磨.md'], 'negative control: two R904 cards are caught');
  assert.deepEqual(bad.log, ['R904：LOG.md 有 2 列'], 'negative control: two R904 LOG rows are caught');
  const ok = duplicates(['R131-原生建築細節.md', 'R134-接續R131原生建築細節.md', 'R0661-not-a-card.md'], '| R131 | a |\n| R134 | 接續 R131 |\n');
  assert.deepEqual(ok, { cards: [], log: [] }, 'negative control: different numbers and numbers inside a title are fine');
  console.log('OK card-numbers negative controls: duplicate cards and LOG rows are caught');
}

const root = new URL('..', import.meta.url);
const found = duplicates(fs.readdirSync(new URL('docs/tasks/', root)), fs.readFileSync(new URL('LOG.md', root), 'utf8'));
assert.deepEqual(found.cards, [], `card-numbers: 同一個卡號有兩張卡 ${found.cards.join('；')}。${HOW}`);
assert.deepEqual(found.log, [], `card-numbers: 同一個卡號在 LOG.md 有兩列 ${found.log.join('；')}。${HOW}`);
console.log('OK card-numbers: every card number in docs/tasks/ and LOG.md is used once');
