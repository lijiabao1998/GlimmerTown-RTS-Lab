# R035 取消 GPT 每日合併上限：不限數量、逐輪迭代
<!-- card: sim=no; golden=無; valve=無; owner_ok=業主 2026-10-18 轉來 GPT 的請求 -->

**狀態**：施工中
**基線**：`43e4dbd`（main，#39 之後）
**業主**（2026-10-18，對話）：業主轉來 GPT 的原文，沒有另外加話：「請在 lijiabao1998/GlimmerTown-RTS-Lab 套用附件，取消每日8張PR上限，改為不限數量、逐輪迭代。同步修改 AGENTS.md、docs/DECISIONS.md、docs/DOTS.md、tools/gpt-merge.mjs、.github/workflows/gpt-merge.yml。保留測試、圖審、hold標籤、最新main與精確head合併等其他門檻，不放寬GPT修改範圍。依正常維護流程驗證並合併後，回報提交SHA，讓R110 PR40接續原流程。」附件沒有傳過來，Claude 照這段話自己改。

## 為什麼做這張

- 每日上限 8 個是 Claude 的預設（`docs/DECISIONS.md`「Claude 的預設」表寫著「業主一句話就改」），理由是給業主看得過來的節奏、dots 的用量上限還沒公布。業主要 GPT 無限迭代；GPT 今天已經合了 R105–R109，照這個速度今天就會撞到上限。
- 這幾個檔（`tools/`、`.github/`、規則檔）在 GPT 的白名單外面，GPT 改不了，要 Claude 改。

## 做什麼

1. `tools/gpt-merge.mjs`：拿掉每日上限（`DAILY_CAP`、`mergedToday()` 和那一條檢查）。其他條件一條不動。
2. `.github/workflows/gpt-merge.yml`：拿掉 `DAILY_CAP` 環境變數；每小時掃描的註解拿掉「被每日上限擋下」。
3. `AGENTS.md`：英文摘要與第 4 節第 6 步拿掉每日上限，寫明「沒有每日數量上限：一次一個 PR、一波接一波」；狀態更新 PR 那一段拿掉「不算每日上限」。
4. `docs/DOTS.md`：第三節貼給 dot 的話、第四節模板、第五節表格拿掉每日上限；第六節加一條：沒有上限以後，用量和越跑越偏的風險都變高。
5. `docs/DECISIONS.md`：「Claude 的預設」表拿掉每日上限那一列，「已定」表記一列。
6. `LOG.md` 加一列。

## 不改什麼

- 其他合併門檻全部照舊：PR 來自本倉庫、要合進 `main`；ci 在 PR 最新提交上全綠（`smoke`、`gpt-lane`）；不是草稿；「等業主」「卡住」「needs-human」「hold」標籤與［等業主］［卡住］標題；接在最新 `main` 上；用 `main` 上那一份 `gpt-lane` 再驗一次；標題的 R 號格式；`--match-head-commit` 照精確的 head 合併；全局觀感等 `AGENTS.md` 第 5 節的事照樣等業主看圖。
- GPT 的修改範圍（白名單、`tools/gpt-lane.mjs`）一個字都不改。
- 不改程式；黃金雜湊不變。

## 影響 GPT 車道

- GPT 自己合，和 `gpt-merge` 工作流合，都不再數今天合了幾個；條件全對就合。
- 「一次一個 PR」不變：GPT 一次只做一個 PR；排程掃描一輪最多合一個（合完 `main` 會動，其他 PR 要先把 `main` 合進分支）。
- R110（PR #40）照原流程：把最新的 `main` 合進分支、ci 綠、條件全對就合。

## 驗收（動手前寫）

1. `tools/gpt-merge.mjs`、`.github/workflows/gpt-merge.yml`、`AGENTS.md`、`docs/DOTS.md`、`docs/DECISIONS.md` 的現行規則裡找不到每日上限（`DAILY_CAP`、「不到 8 個」「每日上限」）；`docs/DECISIONS.md` 已定表那一列記錄取消，不算。
2. 本機用假的 `gh` 和假的 origin 試跑 `tools/gpt-merge.mjs`：今天已經合了 8 個以上時，條件全對的 PR 照樣合（呼叫 `gh pr merge <號> --squash --match-head-commit <sha> --delete-branch`），而且不再去查今天合了幾個。舊版在同樣情況下會擋（證明試跑真的走到上限那一段）。
3. 同一套試跑：草稿、hold 類標籤、［卡住］標題、最新提交不是 ci 跑綠的那一個、不是合進 `main`、來自 fork、沒接在最新 `main` 上、`gpt-lane` 守衛不通過、標題沒有 R 號，各自都還是不合；只改方向檔的狀態更新照樣能合。
4. 排程掃描：兩個條件都對的 PR，一輪只合一個。
5. `tools/gpt-lane.mjs` 與白名單沒有改動（`git diff` 不含它）。
6. CI（Node 24）的 `smoke` 綠；本機 typecheck 綠，unit 除了 R034 記過的 `tests/facades.mjs`（Node 22）以外全綠；黃金雜湊 `98dc0f18` 不變。

## 施工紀錄

（施工後補）

## 驗收結果

（施工後補）

### 沒做成的事

（收尾時補）
