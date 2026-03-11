# CareVisit 長照紀錄管理系統

這是一個結合 FastAPI (後端) 與 React + Vite (前端) 的長照管理系統，支援 AI 潤飾與語音紀錄功能。

## 本地開發環境設置

### 1. 後端 (Backend) 設置

後端使用 Python 3.11+。

1. **進入後端目錄：**
   ```bash
   cd backend
   ```

2. **建立虛擬環境：**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # macOS/Linux
   # 或 .venv\Scripts\activate # Windows
   ```

3. **安裝依賴：**
   ```bash
   pip install -r requirements.txt
   ```

4. **設置環境變數：**
   複製 `.env.example` 並更名為 `.env`，填入必要的資訊（如 `SECRET_KEY` 和 `OPENAI_API_KEY`）。
   本地開發建議將 `DATABASE_URL` 設為 SQLite：
   `DATABASE_URL=sqlite+aiosqlite:///./carevisit.db`

5. **初始化資料庫與種子資料：**
   ```bash
   python seed.py
   ```

6. **啟動後端伺服器：**
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

---

### 2. 前端 (Frontend) 設置

前端使用 Node.js。

1. **進入前端目錄：**
   ```bash
   cd frontend
   ```

2. **安裝依賴：**
   ```bash
   npm install
   ```

3. **設置環境變數：**
   複製 `.env.example` 並更名為 `.env`：
   `VITE_API_URL=http://localhost:8000/api`

4. **啟動開發伺服器：**
   ```bash
   npm run dev
   ```
   預設會在 `http://localhost:5173` 啟動。

---

### 3. 本地登入帳號

執行 `seed.py` 後，您可以使用以下預設帳號（密碼皆為 `admin1234` 或 `user1234`）：
- **管理員 (Admin):** `admin@test.com` / `admin1234`
- **督導員 (User):** `user@test.com` / `user1234`

## 使用 Docker 啟動 (選擇性)

如果您有安裝 Docker，可以直接在根目錄執行：
```bash
docker-compose up --build
```
這會同時啟動前後端伺服器。
