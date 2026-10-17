# 微光小鎮·二戰 RTS 實驗線（GlimmerTown-RTS-Lab）

**同一座城的第四種時間：戰爭。** 你蓋的城就是戰場，而且會被打爛。

《微光小鎮 Glimmerville》的第四條線：二戰戰術即時戰略。靈感來自《紅色警戒 1》與《突襲 2》：一批坦克加榴彈砲對轟，房子是掩體也會被轟塌，榴彈砲要有人看得到目標才打得準。

- 願景：[`docs/R000-願景.md`](docs/R000-願景.md)
- 業主決定：[`docs/DECISIONS.md`](docs/DECISIONS.md)
- 規則（所有 AI 寫入者）：[`AGENTS.md`](AGENTS.md)；Claude 另讀 [`CLAUDE.md`](CLAUDE.md)
- GPT 無限迭代：[`docs/GPT-方向.md`](docs/GPT-方向.md)（開關與待辦）、[`docs/DOTS.md`](docs/DOTS.md)（OpenAI dots 設定與怎麼停）
- 每一輪做了什麼、沒做成什麼：[`LOG.md`](LOG.md)

**線上版**（`main` 綠燈後自動發布；倉庫 Settings → Pages 要先選 GitHub Actions）：<https://lijiabao1998.github.io/GlimmerTown-RTS-Lab/>

## 怎麼玩（R001）

- 點我方單位（藍圈）選取；「全選」選全部。
- 點地面＝移動；點敵人（紅圈）＝攻擊；點房子＝轟它；「砲擊」模式下點地面＝對那一格開火。
- 桌機：右鍵也能下指令；滾輪縮放；拖曳平移；空白鍵暫停；Esc 取消選取。
- 手機：單指點選與下指令；單指拖曳平移；雙指縮放。
- 坦克被房子擋住時，砲彈會打在房子上。房子三段損壞：完好 → 沒屋頂的空殼（冒煙）→ 瓦礫（可以走、不擋射線）。
- 榴彈砲移動中不能打，有最小射程；沒有友軍看得到目標時散布加倍。
- 網址參數：`?seed=` 換地圖、`?px=3` 換渲染解析度、`?fx=off` 關掉爆炸與煙。

## 開發

```bash
npm ci
npm run dev        # 開發伺服器（埠 8401）
npm run check      # 型別 → Node 守衛 → 建置單檔 → 無頭 Chrome 煙霧測試
```

煙霧測試需要 Chrome／Chromium（`CHROME_PATH` 可指定）。樣張存在 `shots/`（不進倉庫，CI 當附件）。
