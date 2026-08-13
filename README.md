# ExecCal｜高階主管行事曆

給老闆／高階主管的行事曆產品。核心價值：**在一個螢幕內，花最少的力氣，看清一段期間內所有重要的事。**

- 🎯 **分類行事曆**：本人／小孩／公事／私事，色彩即分類。
- 🔭 **區間總覽（招牌）**：輸入任一期間，依長度自動切換密度的單螢幕摘要。
- 🔎 **全文搜尋與篩選**：行程、人物、標籤、回饋一次搜到。
- 🔐 **細緻權限**：家教只能看指定課程、填寫教學回饋，且看不到費用金額（由資料庫 RLS 保證）。
- 💰 **財務結算**：行程可掛收支，月報表統整、就地結清、CSV 匯出。

技術：Next.js 16（App Router, TS strict）、Tailwind v4 + shadcn/ui、Supabase（Auth + PostgreSQL + RLS）、TanStack Query、react-hook-form + zod、date-fns（Asia/Taipei）。

---

## 環境需求

- Node.js ≥ 20（開發用 v24）
- npm
- 一個 Supabase 專案（免費方案即可）

> 本專案原則上支援 Supabase CLI 本機開發（需 Docker）。**因開發機未安裝 Docker，預設走「Supabase 雲端」路線**，以下步驟以雲端為主。若你有 Docker，可改用 `supabase start` 本機開發（見文末）。

---

## 快速開始（雲端 Supabase）

### 1. 安裝依賴

```bash
npm install
```

### 2. 建立 Supabase 專案

1. 到 <https://supabase.com> 註冊並「New project」，選一個地區（建議 `Southeast Asia (Singapore)`）。
2. 專案建立後，到 **Project Settings → API**，記下：
   - `Project URL`
   - `anon public` 金鑰
   - `service_role` 金鑰（機密，僅供 seed 使用）

### 3. 填寫環境變數

複製 `.env.example` 為 `.env.local`，填入上一步的值：

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

### 4. （建議）關閉 Email 驗證，方便測試

Supabase Dashboard → **Authentication → Providers → Email**，把「Confirm email」關掉，這樣註冊後即可直接登入。

### 5. 套用資料庫 migrations

**方式 A－用 Supabase CLI（推薦）**

```bash
npx supabase login          # 依指示在瀏覽器授權
npx supabase link --project-ref <你的 project ref>   # ref 在專案 URL 或 Settings 內
npm run db:push             # = supabase db push，套用 supabase/migrations/*.sql
```

**方式 B－手動貼上 SQL**

若不想用 CLI，可到 Dashboard → **SQL Editor**，依序把
`supabase/migrations/0001_schema.sql`、`0002_functions_triggers.sql`、`0003_rls.sql`
的內容各自貼上並執行。

### 6. 灌入種子資料

```bash
npm run seed
```

會建立兩個測試帳號與一整套可展示的行程／財務／回饋資料。

### 7. 啟動

```bash
npm run dev
```

開啟 <http://localhost:3000>。

---

## 測試帳號

| 角色 | Email | 密碼 | 說明 |
|---|---|---|---|
| 老闆 | `boss@example.com` | `test1234` | 擁有四個行事曆與所有財務資料 |
| 家教 | `tutor@example.com` | `test1234` | 只被分享「小明（兒子）」，可回饋、看不到金額 |

登入老闆帳號後，先看 **區間總覽 `/digest`** 與 **報表 `/reports`**，最能感受產品價值。
再用家教帳號登入，驗證權限隔離（詳見 `docs/rls-test.md`）。

---

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 生產建置 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm run seed` | 灌入／重置種子資料（幂等） |
| `npm run db:push` | 套用 migrations 至已連結的 Supabase 專案 |
| `npm run gen:types` | 由遠端 schema 重新產生 `src/types/database.ts`（需先 `supabase link`） |

---

## 功能頁面

| 路由 | 說明 |
|---|---|
| `/login` | 登入／註冊 |
| `/calendar` | 主行事曆（月／週／日切換，自製視圖） |
| `/digest` | 區間總覽（招牌功能） |
| `/search` | 搜尋與篩選（`Ctrl/⌘ + K` 或 `/` 快捷） |
| `/reports` | 統整報表與財務結算 |
| `/settings/calendars` | 分類管理 |
| `/settings/shares` | 分享與權限 |
| `/settings/contacts` | 人物管理 |

---

## 若你有 Docker（本機 Supabase）

```bash
npx supabase start          # 啟動本機 Supabase（含 Postgres）
# 將 supabase start 輸出的 API URL 與 anon/service_role key 填入 .env.local
npm run seed
npm run dev
```

migrations 會在 `supabase start` 時自動套用。

---

## 專案結構

```
src/
  app/
    (app)/            登入後版面與各功能頁（受保護）
    login/            登入／註冊 + Server Actions
  components/
    app/              版面骨架、側欄、命令面板、共用狀態元件
    ui/               shadcn/ui 元件
  lib/
    supabase/         browser / server / proxy 三套 client
    queries/          伺服器端資料查詢
    date.ts           Asia/Taipei 日期工具
    permissions.ts    角色能力矩陣
  types/              資料庫與領域型別
supabase/
  migrations/         版本化 schema + RLS
  seed.ts             種子資料
docs/rls-test.md      權限隔離驗證清單
DECISIONS.md          設計取捨紀錄
```

（驗收清單於文件底部，開發完成後補上。）
