# R900 Grok 合併權限與卡號段
<!-- card: sim=no; golden=無; valve=無; owner_ok=2026-10-28 -->

## 為什麼做
業主 2026-10-28：「合併權限允許」；規則檔由業主特准 Grok 本次直接改：「這次允許你直接改規則檔」。

## 做什麼
- `AGENTS.md` 第 1 節加 Grok 列、卡號規則加 R900–R999、英文摘要同步。
- `CLAUDE.md` 加 Grok 線說明。
- `docs/DECISIONS.md` 加一列決定。

## 不改什麼
`tools/`、`docs/GPT-方向.md` 開關、模擬與畫面程式、其他人的分支。

## 驗收（動手前寫）
- 只改文件；`npm run check` 綠；黃金雜湊不變；CI（含 smoke）綠。

## 驗收結果
見 PR 的 CI。

### 沒做成的事
CI 守衛沒有對 `grok/*` 分支做機器檢查（`tools/` 只有 Claude 改），目前靠 Grok 自律遵守合併條件。
