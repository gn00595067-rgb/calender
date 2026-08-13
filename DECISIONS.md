# 設計取捨紀錄（DECISIONS）

記錄開發過程中，文件未明定而由工程師自行決定的取捨。依 Phase 累積。

## 環境與架構

- **無 Docker → 走 Supabase 雲端 fallback**：本機未偵測到 Docker，依規格第 2 節改採「連接 Supabase 雲端免費專案」路線。migrations 照樣版本化於 `supabase/migrations/*.sql`，套用方式改為 `supabase db push`。README 提供建立專案與填寫 `.env.local` 的傻瓜步驟，並附 `.env.example`。
- **Next.js 16 名詞變更**：Middleware 已更名為 **Proxy**（`src/proxy.ts`，匯出 `proxy`）。`cookies()`、`params`、`searchParams` 皆為 async，一律 await。以上依 `node_modules/next/dist/docs` 內建文件確認。
- **資料庫型別暫以手寫**：因本機無法對雲端 `supabase gen types`，先手寫 `src/types/database.ts` 與 migrations 完全對應。之後可用 `npm run gen:types`（需先 `supabase link`）重新產生覆蓋。
- **手寫型別不含 Relationships**：故 `getAccessibleCalendars` 改用兩段查詢（先查 shares 再查 calendars）而非 PostgREST 內嵌 join，避免型別推斷失敗。

## Phase 0（基礎建設）

- **字體**：以 `Noto Sans TC` 作為全站 sans 字體，確保繁中字形完整。
- **首次登入 bootstrap**：`ensureBootstrap()` 具幂等性，在每次進入 App 時（`(app)/layout.tsx`）確保 profile 與四個預設分類存在，並回填 `calendar_shares.member_id`。DB 端亦會以觸發器建立（Phase 1），兩者互為保險。
- **分類顯示開關狀態**：以 `localStorage`（`execcal:hidden-calendars`）持久化「隱藏中的分類 id」，跨視圖即時過濾。以 effect 讀取以避免 SSR hydration 不一致。
- **「其他」分類預設色**：規格色票未定義 `other`，採青色 `#0891B2`。
- **未設定環境變數時**：Proxy 直接放行、`(app)` layout 顯示「尚未連接 Supabase」引導頁，避免整站 500。

## 待 v2 的擴充接縫

- （尚無）
