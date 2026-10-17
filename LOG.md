# 施工日誌

每一張卡收工記一列，最新在上。細節寫在卡面，這裡一列不超過三百字。「沒做成的事」不准空著，也不准美化。

| 卡號 | 日期 | 寫入者 | 做了什麼 | 守衛 | 提交／PR | 沒做成的事 |
|---|---|---|---|---|---|---|
| R003 | 2026-10-17 | Claude | Claude 線技術標準：DECISIONS.md 記業主原話，新增目標、架構分層、品質門檻、驚艷門檻、手感門檻（每條有數字或可檢查的條件）；GPT 車道不受約束 | 只改文件；本機 typecheck、unit、build、smoke 全綠；黃金雜湊不變 | claude/r003-standards | 門檻沒有自動守衛；數字未經業主看圖確認 |
| R102 | 2026-10-17 | GPT | 待辦3試射修正：看見落點才減半散布，移動/換目標重置，舊彈不污染，齊射後保留校準 | typecheck/unit/build；9組行為+6負控制；CI smoke/gpt-lane；Node/Chrome fe1c5774；手機12/6008；四圖已看 | #5 | 本機Chrome受限；Android實機未測 |
| R101 | 2026-10-17 | GPT | 待辦2前進觀測員：雙方各1、遠視野、無武裝、進出建築、減傷與倒塌傷害；追加id9/10保留舊指令 | 本機typecheck/unit/build、CI smoke/gpt-lane綠；6類負控制；Node/Chrome 6a152c13；手機12calls/6008tris；四樣張已看 | #4 | 本機smoke受限；Android實機未測 |
| R100 | 2026-10-17 | GPT | 建築擋視野，隱藏敵軍與射擊線索，攻擊保留最後已知位置；逃生閥 ?noR100=1 | 本機 typecheck、unit、build 綠；新守衛破壞測試確認；CI smoke/gpt-lane 綠；手機 10 calls/5838 triangles；四張樣張已看 | #3 | 本機 Chrome socket 限制；Android 實機未測 |
| R002 | 2026-10-17 | Grok Bot | GPT 自己合併：AGENTS.md 第 1、4 節與 DOTS.md 第三、四節改成合併條件全部成立時 GPT 可以自己 squash 合（`--match-head-commit`），`gpt-merge` 工作流當後備；條件不放寬；DECISIONS.md 記業主原話。只改文件 | 本機 typecheck、unit 27 項、build、smoke 17 項全綠；黃金雜湊 57cd871f 不變 | 分支 `ccr-26a33d00-y1ir2o` | GPT 自己合還沒在 GitHub 上真的合過；分支規則要業主開 |
| R001 | 2026-10-17 | Claude | 地基與第一場小仗：整數決定性模擬（20 tick／秒、A*、對稱視線、坦克直射被房子擋、榴彈砲散布與最小射程、三段損壞、彈坑、勝負）、像素風渲染、觸控、HUD；守衛與 CI；GPT 車道（白名單守衛、自動合併、每小時掃描）；規則文件與 dots 設定。對抗式審查後修補 | unit 28 項、smoke 17 項全綠：本機與 GitHub Actions（7ccafbe，run 39001427367） | 分支 `ccr-26a33d00-y1ir2o` | 見卡面：Android 實機未測、gpt-merge 沒在 GitHub 上真的合過、Codex 推送方式未查證、Pages 未發布、單位不碰撞、沒有戰爭迷霧與敵方 AI |
