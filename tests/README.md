# tests/：寫入者自己加的守衛

`tools/` 只有 Claude 改；GPT 與其他寫入者要替新機制加守衛，就在這裡放一支 `<主題>.mjs`：

- 獨立的 Node 腳本（Node 22.18+ 可以直接 `import '../src/sim/xxx.ts'`）。
- 綠燈退出碼 0，紅燈非 0；紅的時候最後幾行印出原因。
- 距離、時間、血量從 `UNIT_KINDS` 推，不要寫死，不然調數值就會誤紅。
- 每支守衛都要故意弄壞一次，確認它真的會紅（記在卡面）。

`npm run unit` 會在子行程裡逐支跑（逾時 120 秒）。範本：

```js
import { createWorld } from '../src/sim/world.ts';
const w = createWorld(1944);
const ok = w.blds.length > 0;
console.log(`${ok ? 'OK' : 'NG'}  範例：地圖上有建築`);
process.exit(ok ? 0 : 1);
```
