# R002 GPT 自己合併
<!-- card: sim=no; golden=無; valve=無; owner_ok=業主 2026-10-17「為什麼不能讓GPT自行合併 Claude 我感覺沒問題的」 -->

**狀態**：完成（Grok Bot 2026-10-17 依業主「你幫忙補齊一下grok」補完；只改文件，等業主點頭與 R001 一起合）
**基線**：`aecd475`
**授權**（業主原話）：2026-10-17「為什麼不能讓GPT自行合併 Claude 我感覺沒問題的」

## 為什麼做這張

R001 規定 GPT 不按合併、只由 `gpt-merge` 工作流合。業主認為讓 GPT 自己合沒問題，也跟另外兩條線一致（業主 2026-10-14「自己合就行」）。

## 做什麼

1. `AGENTS.md`：GPT 在合併條件全部成立時可以自己合（squash、`--match-head-commit`）；`gpt-merge` 工作流留著當後備。
2. `docs/DOTS.md`：貼給 dot 的一段話、Codex 模板照改；建議業主開分支規則（要求 `smoke`、`gpt-lane`），讓誰按合併都進不了紅的。
3. `docs/DECISIONS.md`：記業主原話。

## 不改什麼

- 合併條件本身不放寬：CI 全綠（含 `gpt-lane`）、不是草稿、沒有「等業主／卡住」、接在最新 main、每日上限。
- 守衛、CI、`gpt-merge` 工作流的程式不動。

## 驗收（動手前寫）

1. `AGENTS.md` 第 1、4 節寫明 GPT 可以自己合，條件跟 `gpt-merge` 相同，且一條都不少。
2. `docs/DOTS.md` 第三節那一段話與第四節 Codex 模板，不再寫「不要自己合併」，改成條件全對才合。
3. `docs/DECISIONS.md` 已定表多一列，逐字抄業主原話。
4. `npm run unit` 綠、黃金雜湊不變（這張不碰程式）。

## 施工紀錄

- 寫入者：Grok Bot（業主 2026-10-17 在對話裡要 Grok「補齊」這張卡）；接在 Claude 的卡面提交 `08781a9` 之上，沒改寫歷史。
- `AGENTS.md`：英文摘要、第 1 節表格 GPT 那一列、第 4 節第 6 步改成「條件全部成立時 GPT 可以自己合」；條件逐條照抄 `tools/gpt-merge.mjs`（本倉庫、進 `main`、最新提交 ci 全綠含 `gpt-lane`、不是草稿、沒有等業主／卡住／needs-human／hold 標籤或標題、接在最新 `main`、`main` 上那一份 `gpt-lane.mjs` 再驗、R 號標題、每日上限 8），並補上原本只寫在程式裡的「標題要 R<號>」與「狀態更新 PR 不算上限」；加「GPT 自己合的做法」：`gh pr merge --squash --match-head-commit <sha> --delete-branch`，不准 `--admin`／`--auto`；合完 ci 沒自己跑就 `gh workflow run ci.yml --ref main`。第 7 步、第 5 節標題順著改。
- `docs/DOTS.md`：第一節流程圖與「dot 能不能合併」那條改成 GPT 自己合＋`gpt-merge` 後備；第二節分支規則加一句「R002 之後這條更重要」；第三節第 4 條與【不准】改成條件全對才合；第四節 Codex 模板第 5 步拿掉「不要合併」，加第 6 步合併核對。
- `docs/DECISIONS.md`：已定表加 2026-10-17 一列，逐字抄業主原話。
- 守衛、CI、`gpt-merge` 工作流與 `tools/` 的程式一行都沒動。

## 驗收結果

1. `AGENTS.md` 第 1 節表格、第 4 節第 6 步寫明 GPT 可以自己合，條件與 `tools/gpt-merge.mjs` 相同（逐條對過，九條一條都不少）：✅
2. `docs/DOTS.md` 第三節那段話與第四節模板已沒有「不要自己合併／不要合併」，改成條件全對才合：✅（`rg "不要自己合|不按合併"` 只剩本卡引用舊文字）
3. `docs/DECISIONS.md` 已定表多一列，逐字抄「為什麼不能讓GPT自行合併 Claude 我感覺沒問題的」：✅
4. 本機（Node 24.22）`npm run typecheck` 綠、`npm run unit` 綠（27 項 OK），黃金雜湊 `57cd871f` 不變；`npm run build` 成功；`node tools/smoke.mjs` 17 項全綠（本機 Chrome）：✅

### 沒做成的事

- GPT 自己合併還沒在 GitHub 上真的跑過一次（`main` 目前只有 README，第一個 gpt PR 合併時才會驗證到 dot／Codex 有沒有合併權限與 `gh`）。
- 分支規則（要求 `smoke`、`gpt-lane`）只有業主能在 Settings 開；沒開之前，GPT 自己合只靠守規矩擋紅燈。
- `CLAUDE.md` 沒改（裡面沒有提到誰按合併，不需要）。
- 照 `AGENTS.md` 第 1 節，Grok 本該用 `grok/<主題>` 分支；這次照業主要求直接補在 Claude 的 session 分支上，與 R001 一起進同一個 PR。
