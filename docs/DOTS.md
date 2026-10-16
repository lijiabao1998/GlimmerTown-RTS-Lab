# 用 OpenAI dots 讓 GPT 無限迭代：設定與停手

業主 2026-10-16：「Claude 你搜一下 dots ， 它的雲端環境結合，讓GPT自己發揮創意，無限迭代，除非我說停， 二戰 確定」。

Claude 2026-10-16 查證。查得到官方文件的寫「官方」，只有第三方說法的寫「第三方」，查不到的寫「未查證」。dots 9 月 29 日才推出，很多事還沒有公開文件。

## 一、分工：誰做什麼

```
你（業主）
  │ 一次性設定；說「停」
  ▼
dot（ChatGPT 裡的常駐代理，GPT-6 Astra）
  │ 照排程醒來 → 讀方向檔 → 挑題 → 派工 → 盯 CI → 回報
  ▼
Codex 雲端環境（真正寫程式的地方）
  │ 在 gpt/<主題> 分支施工、開 PR
  ▼
GitHub Actions（唯一的裁判）
  │ ci：型別、守衛、決定性、建置、無頭 Chrome、GPT 車道守衛
  ▼
gpt-merge 工作流（唯一的合併者）
  │ 條件全對才 squash 合併，接著發布 Pages
  ▼
https://lijiabao1998.github.io/GlimmerTown-RTS-Lab/
```

為什麼這樣分：
- **dot 是協調者，不是寫程式的人。** 官方文件：dot 寫程式時會在「你設定好的 Codex 雲端環境」建任務，你的電腦關著也行。dot 自己的雲端電腦沒有公開規格；第三方回報說 sudo 不能用。所以建置與測試都放在 Codex 雲端和 GitHub Actions。
- **「完成」不等於成功。** 官方文件原話：dot 的任務跑完，「本身不代表要求的結果已經達成」。所以合不合由 CI 決定，不由 dot 決定。
- **dot 能不能合併 PR、用什麼身分提交，官方沒寫（未查證）。** 所以合併交給本倉庫的 `gpt-merge` 工作流。dot 和 Codex 只開 PR，不按合併。
- **按「暫停」停不了排程。** 官方文件：Pause 只停 dot 目前的主任務，不停已派出去的任務，也不取消之後的排程。所以真正的開關放在倉庫裡（方向檔），CI 認它。

## 二、一次性設定（業主做，約 15 分鐘）

### GitHub（倉庫 Settings）

1. **Pages → Source 選「GitHub Actions」**。沒開的話 `main` 的發布工作會紅。
2. **（強烈建議）Rules → Rulesets → New branch ruleset**，套在 `main`：
   - Require status checks to pass：加 `smoke` 和 `gpt-lane`；
   - Block force pushes；Restrict deletions；
   - Bypass list 留空（Codex 可能用你的權限動作，留了 bypass 它也可能繞過）。
   官方 Codex 文件說程式碼審查規則「不取代測試、分支保護或必要的核准」。沒有這條規則時，誰都還是能直推 `main`，只能靠守規矩。
   開了這條規則之後，連你也不能在網頁上直接改 `main`，要走 PR（CI 約兩分鐘）；緊急停手用第六節的「10 秒」那一層，不用推任何東西。

### ChatGPT

3. **確認你的帳號看得到 dots。** 官方：Pro（100／200／500 美元）給 EEA、英國、瑞士以外 18 歲以上用戶，逐步開放，資格符合也可能還看不到。台灣沒有被排除，但 dots 文件沒點名台灣（未查證），以 App 裡看不看得到為準。
4. **連上 GitHub 外掛**，只給 `lijiabao1998/GlimmerTown-RTS-Lab` 這一個倉庫。
5. **建一個 Codex 雲端環境**，倉庫選 `lijiabao1998/GlimmerTown-RTS-Lab`：
   - Node 版本：24；
   - 設定腳本：`npm ci`；
   - 代理階段的網路：「Common dependencies」，方法只開 GET（官方：設定腳本可以上網，代理階段預設不能上網）。
   無頭 Chrome 不必在 Codex 裡裝；煙霧測試交給 GitHub Actions。
6. **建一個 dot**（名字隨你，例如「前線」），然後用**你自己的訊息**依序貼上第三節的「授權書」和第四節的「常駐指令」。2D 實驗線踩過：授權不是業主本人的訊息時，GPT 會拒絕推送。
7. **排程**：叫 dot 建一個排程，每 2 小時醒一次，時區 Asia/Taipei，結束日 2026-12-31（官方：排程要有時間與結束日；到期前請 dot 續）。

## 三、授權書（業主用自己的訊息貼給 dot）

```
我是 lijiabao1998/GlimmerTown-RTS-Lab 的業主。我授權你在這個倉庫無限迭代，直到我說停：

可以做：
- 讀這個倉庫的任何檔案、Actions 紀錄與附件。
- 在我設定好的 Codex 雲端環境建任務，在 gpt/<主題> 分支提交、推送。
- 開 PR、更新 PR、在 PR 留言、加移除標籤「等業主」「卡住」、把 PR 轉成 ready。
- 照 AGENTS.md 第 4 節自己挑題、自己出卡、自己發揮創意。

不可以做：
- 推送或合併到 main（合併只由 gpt-merge 工作流做）；--force；刪除不是你建的分支。
- 改 .github/、tools/（golden.json 除外）、AGENTS.md、CLAUDE.md、docs/DECISIONS.md、docs/DOTS.md、docs/R000-願景.md、docs/迭代不改壞標準.md、package.json、package-lock.json、tsconfig.json、vite.config.ts、src/render/post.ts。
- 把 docs/GPT-方向.md 的開關改成「運行」，或改「方向」那一段。
- 碰其他倉庫（GlimmerTown、GlimmerTown-lab、GlimmerTown3D-lab 只能讀）。
- 改 GitHub 設定、安裝或移除 App、動任何帳號。
- 畫卐字、SS 符文等仇恨符號，或出現真實納粹領導人。

這些動作的 CI 副作用（Actions 會跑、gpt-merge 會自動合併、Pages 會發布）我都同意。
我說「停」的時候：把 docs/GPT-方向.md 的開關改成「停止」（開一個只改這一行的 PR），然後停止所有排程和派出去的任務。
```

## 四、常駐指令（業主貼給 dot；每次醒來照做）

```
每次醒來：
1. 讀 lijiabao1998/GlimmerTown-RTS-Lab 的 origin/main：docs/GPT-方向.md、AGENTS.md、docs/迭代不改壞標準.md。
2. 開關不是「運行」：什麼都不做，回報一句「開關是 X，沒有開工」，結束。
3. main 最近一次跑完的 ci 是紅的：照 AGENTS.md 第 6 節處理，不開新卡。
4. 你有 gpt/ 的 PR 開著：
   - CI 紅：派 Codex 修（把失敗的那一步和紀錄貼給它）；同一項連 3 次紅在同一步就標卡住、換下一項。
   - CI 綠但還沒合：檢查是不是草稿、有沒有落後 main、有沒有「等業主／卡住」標籤；該轉 ready 就轉，落後就派 Codex 把 main 合進分支。
   - 一次只做一個 PR。
5. 沒有開著的 PR：照 AGENTS.md 第 4 節挑待辦最上面一項（空了就照方向自己出 3–5 項），派一個 Codex 任務（用第五節的模板）。
6. 每天第一次醒來，用 3 行回報業主：昨天合了哪些 PR（附 Pages 網址）、卡住什麼、今天打算做什麼。其他時候有事才講。
7. 業主在對話裡說「停」：照授權書最後一句做，然後不再醒來工作。
```

## 五、派給 Codex 的任務模板（dot 每一波填空）

```
倉庫 lijiabao1998/GlimmerTown-RTS-Lab。先讀 AGENTS.md、docs/迭代不改壞標準.md、docs/GPT-方向.md。
這一波：待辦第 {序} 項「{項目}」。卡號 R{號}（R100–R899 中 origin/main 與所有 origin/gpt/* 都沒用過的最小號）。
1. git switch --no-track -c gpt/{主題} origin/main
2. 第一個提交只放 docs/tasks/R{號}-{主題}.md：標題下一行寫卡頭
   <!-- card: sim=yes|no; golden=舊→新|無; valve=?noR{號}|無; owner_ok= -->
   段落要有「## 驗收（動手前寫）」，寫了就不准改。推上去，開 PR，標題「R{號}［待辦 {序}］{主題}」，內文第一行「GPT 編輯」。
3. 施工。跑 npm run typecheck、npm run unit、npm run build（煙霧測試需要 Chrome，交給 CI）。
   改到 src/sim：先跑 node tools/unit.mjs 看新雜湊，把 tools/golden.json 的 hash 改成新值，卡頭 golden= 寫「舊→新」。
4. 更新卡面（驗收結果、自檢清單、沒做成的事）、docs/GPT-方向.md 的待辦／已完成表、LOG.md 一列。
5. 推送，把 PR 轉成 ready。不要合併，不要改受保護的檔案。
```

## 六、怎麼停

| 層 | 怎麼做 | 效果 |
|---|---|---|
| 一句話 | 對 dot 或 Claude 說「停」 | dot 開 PR 把開關改「停止」；Claude 會提醒你做下面兩層 |
| 10 秒（最快、不用推任何東西） | GitHub → Actions → 左邊點 `gpt-merge` → 右上「…」→ Disable workflow | 什麼都不會再被自動合進 `main` |
| 開關 | 把 `docs/GPT-方向.md` 的 **運行** 改成 **停止**（沒開分支規則可以在網頁直接改；開了就走 PR） | `gpt-lane` 守衛讓所有 GPT 的 PR 變紅；dot 醒來看到開關就不開工 |
| dot 那邊 | Pause；Activity 裡停掉每個 Codex 任務；Scheduled 裡刪掉排程 | 官方：只按 Pause 停不了排程和派出去的任務，三件都要做 |
| 最硬 | GitHub → Settings → Applications 拿掉 ChatGPT／Codex 對本倉庫的權限 | dot 和 Codex 連分支都推不了 |

要重新開始：把開關改回 **運行**（只有你或 Claude 能改）、重新啟用 `gpt-merge`，再叫 dot 恢復排程。

## 七、費用與風險

- **用量**（官方）：跟 dot 講話不算額度；dot 派出去的 Codex 任務照 Codex 額度算。上線第一個月額度放寬；之後的條件還沒公布（第三方推測 10 月 29 日前後結束）。Pro 沒有 5 小時上限，但「可能有每週上限」，雲端任務吃得比較多。**建議每週看一次用量。**
- **第三方報導（未查證）**：Pro 200 方案 10 月 30 日起 Codex 額度從 Plus 的 20 倍降到 10 倍。
- **越跑越偏**（第三方轉述 GPT-6 Astra 系統卡）：連續任務從 5 個增加到 10 個時，越出範圍的比例從 8.6% 升到 19.7%。所以每一波一張卡、驗收先寫、CI 當裁判，並且建議你一兩天看一次已完成表和 Pages。
- **dot 回報完成不代表成功**（官方）。以 CI 和 Pages 為準。
- **Grok Bot**：如果也想讓 Grok 參與，只讓它審 PR、留言，不讓它開工或合併，避免兩個迴圈同時推。

## 八、出處

- 官方：https://learn.chatgpt.com/docs/dots 、…/dots/tasks-and-memory 、…/dots/computers-and-apps 、…/dots/controls 、…/dots/channels 、https://learn.chatgpt.com/docs/environments/cloud-environments 、https://learn.chatgpt.com/docs/cloud/internet-access 、https://learn.chatgpt.com/docs/third-party/github 、https://learn.chatgpt.com/docs/automations 、https://learn.chatgpt.com/docs/pricing
- 第三方：https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/ 、https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/ 、https://flaviocopes.com/openai-dots/ 、https://smartscope.blog/en/blog/openai-dots-vm-specs-sudo-access-grok-bot-2026/ 、https://beam.ai/agentic-insights/openai-dots-usage-limits-pro-200
