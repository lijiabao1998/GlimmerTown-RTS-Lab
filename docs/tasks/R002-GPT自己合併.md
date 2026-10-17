# R002 GPT 自己合併
<!-- card: sim=no; golden=無; valve=無; owner_ok=業主 2026-10-17「為什麼不能讓GPT自行合併 Claude 我感覺沒問題的」 -->

**狀態**：施工中（卡面先推，驗收條件寫在動手之前）
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

（施工中補）

### 沒做成的事

（施工後補）
