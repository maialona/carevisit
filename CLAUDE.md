# CareVisit 專案指南

## 架構

- **Frontend**: React + Vite，部署在 Zeabur（service: `carevisit-squy`）
- **Backend**: FastAPI + SQLAlchemy (async) + PostgreSQL，部署在 Zeabur（service: `carevisit`）
- **Database**: Zeabur managed PostgreSQL

## Zeabur 部署規則（非常重要）

### 絕對不要做的事

1. **不要改 Dockerfile 的 port** — 必須是 `8000`，Zeabur networking 設定對應 `8000`。改了會直接 502。
2. **不要刪 `backend/zbpack.json`** — Zeabur 用它決定啟動命令。
3. **不要從 Dockerfile CMD 移除 `seed.py`** — 它負責建表和 migration。
4. **不要一次改多個基礎設施檔案來 debug** — 只會讓問題疊加，更難排查。

### 部署 debug 原則

- 一次只改一個東西，部署後觀察結果再改下一個。
- 先看 Zeabur Runtime Logs 確認實際錯誤，不要猜。
- 502 通常是 port 不對或 container crash，不是程式碼邏輯問題。
- 瀏覽器顯示的 CORS 錯誤可能是後端 500 的假象（500 response 不帶 CORS header）。要看 Runtime Logs 確認真正的錯誤。

### 關鍵檔案不要亂動

| 檔案 | 用途 | 注意事項 |
|---|---|---|
| `backend/Dockerfile` | 容器建構 | port 必須是 8000，CMD 必須包含 seed.py |
| `backend/zbpack.json` | Zeabur 啟動命令 | 不要刪除 |
| `backend/app/main.py` | FastAPI 入口 | 不要加 debug print/try-catch 到 import 層級 |
| `backend/app/core/logging.py` | 日誌設定 | 保留 FileHandler + StreamHandler |

## 資料庫 Migration

- 沒有用 Alembic 做正式 migration flow。
- `seed.py` 在每次容器啟動時執行 `Base.metadata.create_all`（只建新表，不改現有表）。
- 如果新增欄位到現有表，必須在 `main.py` 的 `lifespan` 裡加 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，否則 production 資料庫不會有新欄位。

## CORS 設定

- `backend/app/main.py` 設定 CORS middleware。
- 目前用 `allow_origins=["*"]`。
- `backend/app/core/config.py` 的 `FRONTEND_URL` 包含所有允許的前端 URL。
- Zeabur 環境變數 `FRONTEND_URL` 可覆蓋預設值。

## 前端 API URL

- `frontend/src/api/axios.ts` 自動偵測環境：
  - localhost → `http://localhost:8000/api`
  - 其他 → `https://carevisit.zeabur.app/api`
- 可用 `VITE_API_URL` 環境變數覆蓋。
