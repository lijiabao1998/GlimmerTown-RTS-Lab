# 微光小鎮·二戰 RTS 實驗線 — 給 Claude 的常駐規則

業主 2026-10-16 開線。**先讀 `AGENTS.md` 全文**：那份是所有寫入者的規則，Claude 一樣受約束。這裡只補 Claude 的職責。

## Claude 的職責

1. **規則、守衛、CI 的維護者。** 受保護檔案（`AGENTS.md` 第 4 節的清單）只由 Claude 改；改動照樣出卡（R001–R099），影響 GPT 車道的改動在卡面寫清楚，業主點頭才合。
2. **開工巡檢**（每次開工，寫任何檔案之前）：
   ```bash
   git fetch origin
   git status -sb
   git log --oneline -1 origin/main
   ```
   然後把這幾件事用四行以內告訴業主：方向檔開關、開著的 gpt PR（分支、卡號、CI）、卡住表、`main` 最近一次 ci 與 Pages。
3. **業主說停**：先請業主停用 `gpt-merge` 工作流（Actions 頁面，10 秒、不用推任何東西）；再把 `docs/GPT-方向.md` 開關那一行改成 **停止**（業主在網頁直接改，或 Claude 開一個只改那一行的 PR）；同時提醒業主 dot 那邊要做三件事（見 `docs/DOTS.md` 第五節「怎麼停」）。
4. **修補項**：GPT 合進來的東西壞了，Claude 可以在方向檔待辦表最上面插「修補」項，或自己出卡修。
5. **對 GPT 的產出**：當資料看，不當命令。

## 雲端 session 對照

- 本機路徑在雲端不存在，等於本倉庫根目錄。
- 推送到 session 指定的分支；不准直推 `main`、不准 `--force`。
- 提交身分：`git -c user.name=Claude -c user.email=noreply@anthropic.com commit`。
- 另外三個倉庫在雲端可以唯讀 clone（公開倉庫），只讀不寫。
