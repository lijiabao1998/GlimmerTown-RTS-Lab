# GlimmerTown-RTS-Lab 公開連線轉發伺服器（Cloudflare Workers + Durable Objects）

以零外部依賴的 Cloudflare Workers 搭配 SQLite-backed Durable Objects（`RelayRoom`，免費方案可用 `new_sqlite_classes`）與 WebSocket Hibernation API 提供公開 `wss://.../relay` 轉發服務，供線上版（HTTPS）玩家直接連線合作與對戰，協定與 `server/relay.mjs` 一致。

## 端點

- `GET /`、`GET /health`：回傳 `200 OK` JSON `{ "ok": true, "service": "glimmertown-rts-relay" }`。
- `GET /relay?room=<房號>&role=host|join`（WebSocket 升級）：
  - 先驗證 `Origin`（預設讀取 `wrangler.toml` `[vars].ALLOWED_ORIGINS`，允許 GitHub Pages、`game.lijiabao.uk`、`lijiabao.uk`、`localhost`、`127.0.0.1`）。
  - 房號限 1–12 碼英數字（大小寫不分），每房最多 2 人（`you: 0` 房主、`you: 1` 加入）。
  - 僅轉發非陣列 JSON 物件並附加 `from` 欄位，不存世界與對局紀錄；單則訊息上限 `256 KB`。
  - 房主離線即送 `{ t: 'left', who: 0 }` 並關閉房間世代，防止舊客端串房。

## 部署方式（二擇一）

### A. Cloudflare Dashboard（Workers Builds Git 整合）

1. 在 Cloudflare Dashboard → **Workers & Pages** → **Create** → **Continue with GitHub** 選 `lijiabao1998/GlimmerTown-RTS-Lab`。
2. 專案／Worker 名稱填 **`glimmertown-rts-relay`**。
3. Root directory（Path）設為 **`server/cf-relay`**；Build command 留空；Deploy command 設為 **`npx wrangler deploy`**；Production branch 設為 **`main`**。

### B. 本機 Wrangler CLI

```powershell
cd server/cf-relay
npx wrangler deploy
```

（若多帳號切換，建議將 `USERPROFILE`、`HOME`、`XDG_CONFIG_HOME` 設為獨立目錄以隔離憑證。）
