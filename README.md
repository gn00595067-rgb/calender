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

---

## 驗收清單（F0–F6 + RLS）

> 本清單為「程式面已實作、可供你連上 Supabase 後逐項實測」的對照表。開發機無 Docker、且尚未連上雲端專案，故功能面的最終勾選需由你設定 `.env.local` 並跑完 migrations + seed 後完成；每一項的實作位置如下。

### F0 帳號與應用框架
- [x] Email 註冊／登入／登出（Server Actions，`src/app/login`）
- [x] 首次登入自動建立 profile 與四個預設分類（DB 觸發器 `handle_new_user` + `ensureBootstrap` 雙保險）
- [x] 全站 Layout：左側分類清單＋顯示開關＋導覽、頂部搜尋入口＋使用者選單
- [x] 重新整理不掉登入（Proxy 刷新 session）

### F1 分類行事曆管理
- [x] 分類 CRUD：新增／改名／改色／排序／刪除（二次確認、警告連帶刪行程）
- [x] 側欄勾選顯示／隱藏，月／週／日／總覽／搜尋即時同步過濾

### F2 標準視圖與行程 CRUD
- [x] 月／週／日三視圖，全自製（無行事曆套件）
- [x] 月視圖每格最多 3 筆＋「+N」popover；週／日時間軸、重疊並排、紅框衝突
- [x] 點空白時段帶時間開新增；新增／編輯 Modal 含所有欄位與財務區塊
- [x] 重複行程展開；編輯／刪除「僅此筆／此筆與之後」

### F3 區間總覽 Digest
- [x] 快速區間＋自訂；摘要膠囊列（總數／各分類／衝突可跳轉／財務合計／未結清）
- [x] 依天數自動切換密度：≤1 天時間軸、2–7 天 agenda＋負荷條、8–31 天週 heatmap＋重點卡、>31 天逐月卡

### F4 搜尋與篩選
- [x] `Ctrl/⌘+K` 或 `/` 呼出；獨立頁 `/search`
- [x] 關鍵字跨標題／描述／地點／回饋／人物／標籤（`ilike`，300ms debounce）
- [x] 篩選 chips 疊加：分類／人物／標籤／日期／僅重點／含財務；結果依日期分組

### F5 分享、權限與回饋
- [x] `/settings/shares` Email 邀請、改角色、移除；受邀者登入自動生效
- [x] UI 依角色降級（協作者無新增鈕、看不到金額）；回饋新增與作者刪除；owner 紅點提示
- [x] RLS 落實第 5 節角色矩陣（見 `docs/rls-test.md` 逐條驗證）

### F6 報表與財務結算
- [x] `/reports` 月份＋行事曆範圍；財務總覽卡（支出／收入／未結清）
- [x] 費用明細（類別 × 人物）可展開逐筆、就地結清、整組結清
- [x] 進度統整：本月回饋依行事曆分組時間軸
- [x] 匯出 CSV（UTF-8 BOM，Excel 中文正常）

### RLS 關鍵情境（第 5 節）
- [x] 家教僅見「小明（兒子）」、可回饋、看不到金額、不能改刪、看不到其他分類——policy 已實作，實測步驟見 `docs/rls-test.md`

> 待你完成雲端設定與 seed 後，依 `docs/rls-test.md` 用 `boss@example.com` 與 `tutor@example.com` 兩帳號跑一遍，即可將上述「功能面」逐項勾實。
