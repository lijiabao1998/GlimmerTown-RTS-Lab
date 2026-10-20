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
| 23 | 修補：手機說明面板的「知道了」完整可見、可直接點到 | 手機優先／不改壞 | 介面 | 不會 | R114／PR47草稿卡住：R037手勢修復已在main，舊卡R114不大於main最大R120，待Claude處理受保護車道門檻；未發布 |
| 16 | 鐵絲網：可布設、可破壞的障礙，形成繞行與清除的選擇 | 業主 2026-10-18「鐵絲網」 | 模擬＋渲染 | 會 | R036 協調好了：鐵絲網歸這一項，Claude 的 R024b 只做龍牙、沙包陣地。要「人過不去、車過得去」就自己在尋路加步兵的通行判斷，R024b 之後沿用 |
| 17 | 電網防禦：先考據二戰適配與供電／斷電玩法，再決定實作範圍 | 業主 2026-10-18「電網」 | 考據／模擬＋渲染 | 待定 | 保持二戰題材；不是現代科幻護盾，研究適配前不直接施工 |
| 24 | 多選射界：呈現共同與各自射程，避免任挑單位誤導 | 坦克＋榴彈砲 | 介面 | 不會 | R113 已做單選與有效對地任務散布上界；本項另驗多選可讀性與固定預算 |

## 卡住／等業主看圖

| 項目 | 狀態 | 原因 | 卡／PR |
|---|---|---|---|
| 23 手機說明關閉按鈕 | 卡住；R037已整合於本機，但舊卡R114被最新main卡號門檻擋住，交Claude處理受保護規則 | 2026-10-20：原PR47的0cedb08以merge合main58667af，原驗收／首紅保留，沒有改名重編卡或修改工具。當時main版tools/gpt-lane.mjs第73–80行實測拒絕R114不大於R118；2026-10-20 06:08 UTC以最新main c32ccbf守衛重新核對同一本機整合50c2f97，仍拒絕「卡號 R114 不比 main 上用過的最大號 R120 大」，沒有舊卡恢復例外。typecheck／build及非瀏覽器守衛通過、golden eea1d59b；8支Chrome守衛與smoke受socket EPERM未能驗收。R037提供實質時間戳修復，但原CI39197550253缺診斷，根因仍未知。未推R114整合、未重跑CI、未解除Draft／卡住、未發布。待Claude處理舊卡恢復門檻，再驗最新head CI與新圖；R120（#52）已獨立完成並合併為main c32ccbf，CI39375945968與Pages成功；其通過不代表R114舊卡門檻已解除 | R114／[#47](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/47) |

## 已完成（最新在上）

| 項目 | R 號 | PR | 完成日 | 沒跑的守衛 |
|---|---|---|---|---|
| 三種可連接／可轟開圍牆，共享8點、防封閉與noR120 | R120 | [#52](https://github.com/lijiabao1998/GlimmerTown-RTS-Lab/pull/52) | 2026-10-20（整合驗證完成，待合併發布） | db48cafa CI39371516702 unit372.8秒／smoke169.4秒／lane綠；四標準圖及18張圍牆樣張已看；本機8Chrome受限、Android未測。舊雙擊根因仍無原紀錄，R037當前整合與負控已驗證；收尾head及main CI／Pages仍須核實 |
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
