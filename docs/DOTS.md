# 用 OpenAI dots 讓 GPT 無限迭代：設定與停手

業主 2026-10-16：「Claude 你搜一下 dots ， 它的雲端環境結合，讓GPT自己發揮創意，無限迭代，除非我說停， 二戰 確定」；同日：「你給GPT寫一段，讓GPT無限自己迭代不就行了」。

Claude 2026-10-16 查證。查得到官方文件的寫「官方」，只有第三方說法的寫「第三方」，查不到的寫「未查證」。dots 9 月 29 日才推出，很多事還沒有公開文件。

## 一、分工：誰做什麼

```
你（業主）
  │ 一次性設定；貼一段話；說「停」
  ▼
dot（ChatGPT 裡的常駐代理，GPT-6 Astra）
  │ 照排程醒來 → 讀方向檔 → 挑題 → 派工 → 盯 CI → 回報
  ▼
Codex 雲端環境（真正寫程式的地方）
  │ 在 gpt/<主題> 分支施工、開草稿 PR、做完轉 ready
  ▼
GitHub Actions（唯一的裁判）
  │ ci：型別、守衛、決定性、建置、無頭 Chrome、GPT 車道守衛
  ▼
GPT 自己合，或 gpt-merge 工作流當後備（ci 跑完判一次，另外每小時掃一次）
  │ 兩邊同一組條件，全對才 squash 合併，接著發布 Pages
  ▼
https://lijiabao1998.github.io/GlimmerTown-RTS-Lab/
```

為什麼不能只靠「貼一段話」：
- **dot 是協調者，不是寫程式的人。** 官方：dot 寫程式時會在「你設定好的 Codex 雲端環境」建任務，你的電腦關著也行。dot 自己的雲端電腦沒有公開規格；第三方回報說 sudo 不能用。所以建置與測試都放在 Codex 雲端和 GitHub Actions。
- **「完成」不等於成功。** 官方原話：dot 的任務跑完，「本身不代表要求的結果已經達成」。所以合不合由 CI 決定，不由 dot 決定。
- **dot 能不能合併 PR、用什麼身分提交，官方沒寫（未查證）。** 業主 2026-10-17 同意 GPT 自己合：條件全對時 dot／Codex 可以自己 `gh pr merge --squash --match-head-commit`；合不了（沒有權限、沒有 `gh`）也沒關係，本倉庫的 `gpt-merge` 工作流照同一組條件當後備。
- **按「暫停」停不了排程。** 官方：Pause 只停 dot 目前的主任務，不停已派出去的任務，也不取消之後的排程。所以真正的開關放在倉庫裡（方向檔），CI 認它。

## 二、一次性設定（業主做，約 15 分鐘）

### GitHub（倉庫 Settings）

1. **Pages → Source 選「GitHub Actions」**。沒開的話 `main` 的發布工作會紅。
2. **（建議）Issues → Labels 新增兩個標籤：「等業主」「卡住」。** 沒有標籤時 GPT 改在 PR 標題前加［等業主］［卡住］，`gpt-merge` 兩種都認。
3. **（強烈建議）Rules → Rulesets → New branch ruleset**，套在 `main`：
   - Require status checks to pass：加 `smoke` 和 `gpt-lane`；
   - Block force pushes；Restrict deletions；
   - Bypass list 留空（Codex 可能用你的權限動作，留了 bypass 它也可能繞過）。
   官方 Codex 文件說程式碼審查規則「不取代測試、分支保護或必要的核准」。沒有這條規則時，誰都還是能直推 `main`，只能靠守規矩。
   **GPT 自己合（R002）之後這條更重要**：開了它，誰按合併（GPT、Codex、`gpt-merge`、你）都進不了 `smoke` 或 `gpt-lane` 是紅的 PR。
   開了之後，連你也不能在網頁上直接改 `main`，要走 PR（CI 約兩分鐘）；緊急停手用第五節「10 秒」那一層，不用推任何東西。

### ChatGPT

4. **確認你的帳號看得到 dots。** 官方：Pro（100／200／500 美元）給 EEA、英國、瑞士以外 18 歲以上用戶，逐步開放，資格符合也可能還看不到。台灣沒有被排除，但 dots 文件沒點名台灣（未查證），以 App 裡看不看得到為準。
5. **連上 GitHub 外掛**，只給 `lijiabao1998/GlimmerTown-RTS-Lab` 這一個倉庫。
6. **建一個 Codex 雲端環境**，倉庫選 `lijiabao1998/GlimmerTown-RTS-Lab`：Node 24；設定腳本 `npm ci`；代理階段的網路選「Common dependencies」（官方：設定腳本可以上網，代理階段預設不能上網）。
   **未查證**：Codex 在任務中途能不能 `git push`、它開 PR 時會不會把提交壓成一個、分支名能不能用 `gpt/` 開頭。第一波做完請看一次 PR：分支是不是 `gpt/…`、第一個提交是不是只有卡。不是的話告訴 Claude，Claude 改流程。
7. **建一個 dot**（名字隨你，例如「前線」），然後用**你自己的訊息**貼上第三節那一段話。2D 實驗線踩過：授權不是業主本人的訊息時，GPT 會拒絕推送。

## 三、貼給 dot 的一段話（業主用自己的訊息貼）

```
你是 lijiabao1998/GlimmerTown-RTS-Lab 的常駐開發者。這是我（業主）本人的授權：在這個倉庫無限迭代，直到我說「停」。

【做什麼】二戰戰術 RTS（three.js）。核心：自己的城＋一批坦克、榴彈砲對轟，房子是掩體也會被打爛。你自己發揮創意，每一輪都要讓它更好玩或更好看。規則以 origin/main 上的 AGENTS.md 為準。

【每次醒來】
1. 讀 origin/main 的 AGENTS.md、docs/GPT-方向.md、docs/迭代不改壞標準.md。開關（「## 開關」底下第一行）不是 **運行** 就什麼都不做。
2. 你有開著的 gpt/ PR（標了「等業主」「卡住」的不算）：CI 紅就派 Codex 修；同一步連紅 3 次就標「卡住」、在方向檔卡住表記一列，換下一項。CI 綠但沒合：轉 ready、落後 main 就把 main 合進分支（不 rebase、不 force）。一次只做一個 PR。
3. 沒有：做方向檔待辦最上面那一項（空了就自己想 3–5 項寫進去），用 docs/DOTS.md 第四節的模板派給 Codex。
4. 合併條件全對才合（AGENTS.md 第 4 節第 6 步，一條都不能少）：PR 來自本倉庫、要合進 main；PR 最新提交上 ci 的 smoke 和 gpt-lane 都綠；不是草稿；沒有「等業主」「卡住」「needs-human」「hold」標籤，標題不以［等業主］［卡住］開頭；分支接在最新的 main 上；用 main 上那一份 tools/gpt-lane.mjs 再驗一次通過；標題是「R<號>［待辦 N］主題」；今天（UTC）合的 GPT PR 不到 8 個。全對就用 gh pr merge <號> --squash --match-head-commit <最新提交> --delete-branch 自己合（不用 --admin、不跳過檢查）；少一條就不合。你沒合，gpt-merge 工作流會照同樣的條件自動合。合完看 main 的 ci 和 Pages 綠。
5. 每天第一次醒來，用三行告訴我：合了什麼（附 Pages 網址）、卡住什麼、下一步做什麼。其他時候有事才講。

【不准】直推 main、合併條件沒全對就合、--force、刪不是你建的分支；改白名單以外的檔案（白名單見 AGENTS.md 第 4 節，.github/、tools/、規則檔、package*.json、vite.config.*、src/render/post.ts 都不行）；改 docs/GPT-方向.md「## 待辦」以上除了開關那一行的任何字、把開關改成運行；拿掉「等業主」標籤；碰其他倉庫；改 GitHub 設定、安裝或移除 App；畫卐字、SS 符文或真實納粹領導人。

【要等我】畫風、後製、鏡頭、光、離開二戰、刪既有單位或機制、調高手機預算、加 npm 套件：PR 標「等業主」，你先做下一項。要動受保護檔案的事不要開 PR，寫進卡住表交給 Claude。

【我說停】開一個狀態更新 PR：分支 gpt/status-<日期>，標題「方向檔：開關改停止」，只把開關那一行改成 **停止**。然後停掉所有排程和派出去的任務。

以上動作在 GitHub 上引起的後續（Actions 會跑、自動合併、Pages 發布）我都同意。
請建一個每 2 小時的排程（時區 Asia/Taipei，結束日 2026-12-31）照上面做。
```

## 四、派給 Codex 的任務模板（dot 每一波填空）

```
倉庫 lijiabao1998/GlimmerTown-RTS-Lab。先讀 AGENTS.md、docs/迭代不改壞標準.md、docs/GPT-方向.md。
這一波：待辦第 {序} 項「{項目}」。卡號 R{號}（比 origin/main 的 docs/tasks/、LOG.md 與開著的 origin/gpt/* 分支裡出現過的最大 R 號再大 1，最小 R100）。
1. git switch --no-track -c gpt/{主題} origin/main（分支名一定要 gpt/ 開頭）
2. 第一個提交只放 docs/tasks/R{號}-{主題}.md：標題下一行寫卡頭
   <!-- card: sim=yes|no; golden=舊→新|無; valve=?noR{號}|無; owner_ok= -->
   卡面要有「## 驗收（動手前寫）」一節，寫了就不准改。
3. 之後的提交才施工。跑 npm run typecheck、npm run unit、npm run build（煙霧測試需要 Chrome，交給 CI）。
   改到 src/sim：npm run unit 會印出「現在 <雜湊>」，把 tools/golden.json 的 hash 改成它，卡頭 golden= 寫「舊→新」。
   新機制要守衛：寫 tests/{主題}.mjs（獨立 Node 腳本，綠燈退出碼 0）。距離、時間用 UNIT_KINDS 推，不要寫死。
4. 更新卡面（驗收結果、自檢清單、沒做成的事）、docs/GPT-方向.md 的待辦／已完成表、LOG.md 一列。
5. 推送，開草稿 PR：標題「R{號}［待辦 {序}］{主題}」，內文第一行「GPT 編輯」。做完把 PR 轉成 ready。不要改白名單以外的檔案。
6. 合併：等 PR 最新提交上 ci 的 smoke 和 gpt-lane 都綠，再照 AGENTS.md 第 4 節第 6 步逐條核對（不是草稿、沒有等業主／卡住標籤或標題、接在最新 main 上、main 上那一份 gpt-lane.mjs 本機再驗通過、今天 UTC 合的 GPT PR 不到 8 個）。條件全對才 gh pr merge {PR 號} --squash --match-head-commit {最新提交} --delete-branch；少一條就不合，交給 gpt-merge 工作流或下一輪。
```

## 五、怎麼停

| 層 | 怎麼做 | 效果 |
|---|---|---|
| 一句話 | 對 dot 或 Claude 說「停」 | dot 開狀態更新 PR 把開關改「停止」（只改方向檔的 PR 不用等每日上限）；Claude 會提醒你做下面兩層 |
| 10 秒（最快、不用推任何東西） | GitHub → Actions → 左邊點 `gpt-merge` → 右上「…」→ Disable workflow | 什麼都不會再被自動合進 `main` |
| 開關 | 把 `docs/GPT-方向.md`「## 開關」底下那一行改成 **停止**（沒開分支規則可以在網頁直接改；開了就走 PR）。寫錯、刪掉也會當成停 | `gpt-lane` 守衛讓所有 GPT 的 PR 變紅；dot 醒來看到開關就不開工 |
| dot 那邊 | Pause；Activity 裡停掉每個 Codex 任務；Scheduled 裡刪掉排程 | 官方：只按 Pause 停不了排程和派出去的任務，三件都要做 |
| 最硬 | GitHub → Settings → Applications 拿掉 ChatGPT／Codex 對本倉庫的權限 | dot 和 Codex 連分支都推不了 |

要重新開始：把開關改回 **運行**（只有你或 Claude 能改）、重新啟用 `gpt-merge`，再叫 dot 恢復排程。

### 恢復排程（GPT 停了，要它接著做）

R034 加。先確認開關是 **運行**、`gpt-merge` 沒被停用（Actions 頁面）。然後用**你自己的訊息**把下面這段貼給 dot：

```
這是我（業主）本人的訊息與授權：恢復 lijiabao1998/GlimmerTown-RTS-Lab 的無限迭代，直到我說「停」。照我第一次貼給你的那段話做；全文在倉庫 docs/DOTS.md 第三節，以 origin/main 那份為準。
1. 先看 Scheduled：每 2 小時的排程（時區 Asia/Taipei，結束日 2026-12-31）還在就留著，不在就重建，只留一個。Activity 裡卡住或失敗的 Codex 任務先停掉。
2. 用三行告訴我：上一次合併之後為什麼沒有新的一波、排程現在的狀態、下一步做哪一項。
3. 然後馬上開工：讀 origin/main 的 AGENTS.md、docs/GPT-方向.md、docs/迭代不改壞標準.md，從待辦最上面那一項接著做。方向檔寫明交給 Claude 的題目（電腦對手、步兵）不要做。
```

dot 說找不到第三節，或不認這段授權：把第三節整段再貼一次（最後一句會叫它建排程）。

## 六、費用與風險

- **用量**（官方）：跟 dot 講話不算額度；dot 派出去的 Codex 任務照 Codex 額度算。上線第一個月額度放寬；之後的條件還沒公布（第三方推測 10 月 29 日前後結束）。Pro 沒有 5 小時上限，但「可能有每週上限」，雲端任務吃得比較多。**建議每週看一次用量。**
- **第三方報導（未查證）**：Pro 200 方案 10 月 30 日起 Codex 額度從 Plus 的 20 倍降到 10 倍。
- **越跑越偏**（第三方轉述 GPT-6 Astra 系統卡）：連續任務從 5 個增加到 10 個時，越出範圍的比例從 8.6% 升到 19.7%。所以每一波一張卡、驗收先寫、CI 當裁判，並且建議你一兩天看一次已完成表和 Pages。
- **dot 回報完成不代表成功**（官方）。以 CI 和 Pages 為準。
- **守衛擋得住粗心，擋不住存心作對**：GPT 能改 `src/`，`src/sim` 的程式又會在 CI 的守衛行程裡執行。純度掃描禁止碰行程、檔案系統與全域物件，但最後一道防線是分支規則和你偶爾看一眼。
- **Grok Bot**：如果也想讓 Grok 參與，只讓它審 PR、留言，不讓它開工或合併，避免兩個迴圈同時推。

## 七、出處

- 官方：https://learn.chatgpt.com/docs/dots 、…/dots/tasks-and-memory 、…/dots/computers-and-apps 、…/dots/controls 、…/dots/channels 、https://learn.chatgpt.com/docs/environments/cloud-environments 、https://learn.chatgpt.com/docs/cloud/internet-access 、https://learn.chatgpt.com/docs/third-party/github 、https://learn.chatgpt.com/docs/automations 、https://learn.chatgpt.com/docs/pricing
- 第三方：https://techcrunch.com/2026/09/29/openai-launches-dots-its-bubbly-agentic-avatar/ 、https://siliconangle.com/2026/09/29/openai-launches-dots-always-on-ai-agents-in-chatgpt-with-their-own-cloud-computers/ 、https://flaviocopes.com/openai-dots/ 、https://smartscope.blog/en/blog/openai-dots-vm-specs-sudo-access-grok-bot-2026/ 、https://beam.ai/agentic-insights/openai-dots-usage-limits-pro-200
