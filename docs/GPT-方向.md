# GPT 方向檔：業主給方向，GPT 照這份一直做下去

> 以 `origin/main` 上這一份為準。「## 待辦」以上只照業主原話改；GPT 只准把開關那一行改成暫停／停止／等方向，其他一個字都不能動（GPT 車道守衛會擋）。待辦以下由 GPT 維護，Claude 可以在待辦最上面插「修補」項。本檔不能推翻 `AGENTS.md` 與《迭代不改壞標準》。

## 開關

**運行**

（上面那一行就是開關，只看「## 開關」底下第一行，而且整行要剛好是兩個星號夾住四個值之一。寫錯、刪掉都當作停。）
四個值：
- 運行：一直做下去。
- 暫停：不開新卡；手上的 PR 留著不合，改回運行後接著做。
- 停止：馬上停，手上的 PR 不再推。
- 等方向：不開新卡，等業主給新方向。
開關不是運行的時候，`gpt-lane` 守衛讓 GPT 的 PR 都變紅，`gpt-merge` 也不會合（只改方向檔的狀態更新除外）。

## 方向

業主原話（2026-10-16，逐字）：

> 讓GPT自己發揮創意，無限迭代，除非我說停， 二戰 確定

> 核心玩法我感覺就是自己建然後給一批坦克車 榴彈砲，然後對轟，這是最簡單的玩法

執行解讀（Claude 寫，業主可改）：
- 創意自由，但每一波都要讓遊戲**更好玩或更好看**，不是換皮。優先做讓「坦克＋榴彈砲對轟、房子是掩體也會被打爛」更有戰術的東西。
- 題材是二戰；不畫仇恨符號，陣營徽記用程序生成的通用圖形（`AGENTS.md` 第 2 節第 8 條）。
- 全局觀感、離開二戰、刪既有機制、調高預算要等業主（`AGENTS.md` 第 5 節）。
- 電腦對手（敵方 AI）和步兵交給 Claude 線（業主 2026-10-18）。原本的待辦第 8 項（敵方 AI）前半「坦克找掩體推進」由 R018 做掉；後半「電腦的榴彈砲打幾發換陣地」R018 留到反砲兵（第 11 項）合進 main 之後，由 Claude 接（記在 `docs/ROADMAP.md` 進度表 R018 那一列）。第 13 項（步兵班）由 R021 做掉。R034 把這兩項從待辦拿掉，序號不重編。GPT 自己出新項目時不出這兩類；有點子就寫進卡住表交給 Claude。

## 待辦（「修補」排最前面，其餘照序；每一波做最上面一項）

| 序 | 項目 | 對應方向的哪一句 | 模擬／渲染／介面／AI | 動黃金雜湊 | 備註 |
|---|---|---|---|---|---|
| 23 | 修補：手機說明面板的「知道了」完整可見、可直接點到 | 手機優先／不改壞 | 介面 | 不會 | R114／PR47草稿卡住：help四組／四負控通過，但既有手機雙擊smoke紅，待原路徑事件診斷；未發布 |
| 16 | 鐵絲網：可布設、可破壞的障礙，形成繞行與清除的選擇 | 業主 2026-10-18「鐵絲網」 | 模擬＋渲染 | 會 | R036 協調好了：鐵絲網歸這一項，Claude 的 R024b 只做龍牙、沙包陣地。要「人過不去、車過得去」就自己在尋路加步兵的通行判斷，R024b 之後沿用 |
| 17 | 電網防禦：先考據二戰適配與供電／斷電玩法，再決定實作範圍 | 業主 2026-10-18「電網」 | 考據／模擬＋渲染 | 待定 | 保持二戰題材；不是現代科幻護盾，研究適配前不直接施工 |
| 18 | 圍牆：矮牆、石牆與混凝土圍牆，提供可打開的遮蔽線 | 業主 2026-10-18「圍牆」 | 模擬＋渲染 | 會 | 保留既有房屋破壞；與第 12 項樹籬／小樹林區分；Claude 路線圖 R027 的石牆讓給這一項（R036） |
| 24 | 多選射界：呈現共同與各自射程，避免任挑單位誤導 | 坦克＋榴彈砲 | 介面 | 不會 | R113 已做單選與有效對地任務散布上界；本項另驗多選可讀性與固定預算 |

## 卡住／等業主看圖

| 項目 | 狀態 | 原因 | 卡／PR |
|---|---|---|---|
| 18 可連接圍牆 | R120已在本機合入R036／R037，最新head驗證中，仍草稿卡住 | 2026-10-20：獨立main58667af與整合版四組逐tick hash／RNG／完整世界摘要相同；依使用者指示更新17個舊凍結值，補測試VM的r104依賴，原驗收與首紅保留。main版lane、typecheck／build、legacy及UI負控通過；完整unit351.3秒僅8支Chrome啟動失敗，其餘守衛全過；CI／新圖待核實。本機Chrome受socket EPERM；未合併發布，不宣稱舊雙擊根因已證實 | R120／[#52](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/52) |
| 23 手機說明關閉按鈕 | 卡住；Claude 的 R037（[#53](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/53)）已補，待 GPT 合 main 重跑 CI | R114 新 help Chrome4組／4負控與unit通過；CI39197550253雙擊選車[1]但鏡頭不動。R037：雙擊與快速拖曳改看事件時間戳（手指時間，?noR037=1 回到處理時間）；smoke 照時間表送，說明裡印事件時間、取消、失焦、最慢一幀。本機重現的是處理時間相隔 265–360 毫秒、跨過 350；CI 那一次沒有紀錄，不能確定是同一種。R120（#52）卡在同一項 | R114／[#47](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/47) |

## 已完成（最新在上）

| 項目 | R 號 | PR | 完成日 | 沒跑的守衛 |
|---|---|---|---|---|
| 裝甲面向（GPT 實作；困難電腦顧車頭由 Claude 接） | R104＋R036 | [#44](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/44) | 2026-10-20 | 本機 Node 22／容器：unit 的 facades、materials-view、input-browser 與 smoke 的計時、手勢項目（乾淨 main 也紅），以 CI 為準；Android 實機未測 |
| 四種可通行戰壕：共享8點、相連最強掩護 | R118 | [#51](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/51) | 2026-10-19（收尾待latest-head） | 264d24f完整CI／圖審通過；精簡診斷守衛待CI，首輪桌面小地圖像素差異根因未確立；本機Chrome受限、Android未測；未發布 |
| 可見戰場程序音效：自願開啟砲聲／爆炸／倒塌 | R117 | [#50](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/50) | 2026-10-19（發布） | 本機Chrome受限；CI真實音訊圖／九負控／圖審通過；Android、喇叭實聽與真實BFCache未測；main3654fb2的CI39221216593／Pages成功，08:25公網build逐位核對 |
| 可穿行樹籬／小樹林：中段遮視線、最強半掩護 | R116 | [#49](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/49) | 2026-10-19（發布） | 本機Chrome受限，CI實測／圖審通過；Android未測；main91849c4的CI39212799723／Pages成功，07:04公網build已逐位核對 |
| 三階粗略反砲兵情報（AI換陣地留Claude R018） | R115 | [#48](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/48) | 2026-10-19（發布） | 本機Chrome受限，CI實測通過；Android未測；main f5d4211 的 CI39205232628／Pages成功，05:43公網build已逐位核對 |
| 單選射程／近限與有效砲擊散布上界（多選另列24） | R113 | [#46](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/46) | 2026-10-19（發布） | 本機Chrome受限，CI實測通過；Android未測；main172dd372的CI／Pages成功，公網build已逐位核對 |
| 修補換局小地圖殘留舊底圖 | R112 | [#45](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/45) | 2026-10-19（發布） | 本機Chrome受限，CI實測通過；Android實機未測；main CI／Pages／公網build已核對 |
| 修補生產列隨提示高度同步避讓 | R111 | [#42](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/42) | 2026-10-19（發布） | 本機Chrome受限，CI實測通過；Android實機未測；main CI／Pages／公網build已核對 |
| 修補暫停時過期砲擊提示 | R110 | [#40](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/40) | 2026-10-19（發布） | 本機Chrome受限，CI實測通過；Android實機未測；main CI／Pages／公網build已核對 |
| 桌機追加框選、手機長按砲擊選單 | R109 | [#38](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/38) | 2026-10-18 | 本機 Chrome 受限，CI 真實滑鼠／觸控、smoke 通過；Android 實機未測 |
| 修補煙幕彈拖延勝負／戰報 | R108 | [#37](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/37) | 2026-10-18 | 本機 smoke 受限，CI smoke 通過；新增彈種鍵實際觸控／Android 實機仍未測 |
| 榴彈砲煙幕 | R107 | [#35](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/35) | 2026-10-18 | 本機 smoke 受限，CI smoke 通過；新增彈種鍵實際觸控／Android 實機未測 |
| 彈坑輕掩體 | R106 | [#34](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/34) | 2026-10-18 | 本機 smoke 受限，CI smoke 通過；Android 實機未測 |
| 建築材質 | R105 | [#32](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/32) | 2026-10-18 | 本機 smoke 受限，CI smoke 通過；Android 實機未測 |
| 試射修正 | R102 | [#5](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/5) | 2026-10-17 | 本機 smoke 受限，CI smoke 通過 |
| 前進觀測員 | R101 | [#4](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/4) | 2026-10-17 | 本機 smoke 受限，CI smoke 通過 |
| 視線與戰爭迷霧 | R100 | [#3](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/3) | 2026-10-17 | 本機 smoke 受限，CI smoke 通過 |
