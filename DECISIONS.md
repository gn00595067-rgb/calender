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

## Phase 2（行事曆核心）

- **視圖全自製**：月／週／日視圖不使用任何行事曆套件，時間軸 48px/小時，重疊行程以貪婪演算法（`layoutDay`）分欄並排。
- **衝突定義**：任兩筆行程時間重疊（跨分類亦算）即標為衝突，紅色內框；`conflictIds` 供視圖與總覽共用。
- **讀寫分離**：讀取（區間行程）走瀏覽器 client + TanStack Query（RLS 以 cookie session 生效）；寫入一律走 Server Actions（zod 驗證 + RLS），完成後 `invalidateQueries` + `router.refresh()`。
- **重複行程**：建立時直接展開為實體列（同 `recurrence_group_id`），上限至「重複至」日期或起始 +6 個月取較早；重複數學運算在台北牆上時間進行（台灣無日光節約，安全）。
- **編輯範圍**：`this` 僅改該筆；`following` 對此筆與同群組之後全部套用非時間欄位，時間變更則將各後續筆沿用其日期套上新時刻與新時長。人物／標籤／財務關聯僅套用於被點擊的該筆（批次覆寫語意過重）。
- **刪除重複**：`this`/`following` 兩選項；財務紀錄的 `event_id` 為 ON DELETE SET NULL，刪行程不會連帶刪除已發生的金錢紀錄（金流不應無聲消失）。
- **跨日行程**：月視圖於每個涵蓋日各顯示一次；週／日視圖目前於起始日欄呈現並裁切至當日底（完整跨日分段留待 v2）。
- **表單**：事件表單採 react-hook-form + Controller；`watch()` 觸發 React Compiler 的 library 不相容「警告」（非錯誤），僅代表該元件略過自動記憶化，功能不受影響。
- **財務可見性**：事件表單財務區塊只對該分類具 owner/editor 角色者顯示；仍以 RLS 為最終邊界。

## Phase 3（總覽與搜尋）

- **Digest 密度切換**：以區間「天數」決定呈現——≤1 天時間軸＋空檔標示（08:00–22:00 內 ≥30 分視為空檔）、2–7 天 agenda 直欄＋每日負荷條（≤180 分輕/≤360 中/>360 滿）、8–31 天週 heatmap（藍色深淺＝行程數、紅框＝當日衝突）＋重點/衝突卡片、>31 天逐月摘要卡。
- **Digest 財務**：以 `finance_records.occurred_on` 落在區間、且掛在「顯示中分類」者彙總；未掛分類的 standalone 財務不計入總覽（留給報表）。摘要僅在有 owner/editor 分類時顯示。
- **搜尋策略**：關鍵字以 `ilike` 分別打 events(標題/描述/地點)、event_notes(內容)、contacts(姓名)、tags(名稱)，聯集出候選 event id 後再套用分類/人物/標籤/日期/重點/含財務等疊加篩選；300ms debounce。搜尋範圍預設「全部可存取分類」（不受側欄顯示開關影響）。
- **PostgREST or 過濾**：關鍵字先過濾掉 `,()%*` 等會破壞 or 字串的字元。

## Phase 4（分享與回饋）

- **紅點語意**：行程卡片的紅點＝「有他人（非自己）撰寫的回饋，且我具編輯權」，供 owner/editor 審閱之用；MVP 不追蹤已讀狀態（無 schema），故不做清除，符合規格「加小紅點即可」。
- **邀請即回填**：邀請時若該 Email 已有 profile，直接回填 `member_id`；否則待對方以該 Email 註冊時由 `handle_new_user` 觸發器回填。

## Phase 5（報表結算）

- **財務範圍**：報表只統整「掛在分類上」的財務（`calendar_id` 非空），且分類需為 owner/editor；未掛分類的 standalone 財務不納入（避免跨權限外洩）。
- **費用分組**：以 `收支 × 費用類別 × 人物` 為一組，聚合筆數/金額/已未結清；可展開逐筆並就地勾選結清、或整組結清。
- **進度統整**：以「該月的行程」為基準抓取其回饋，依行事曆分組成時間軸（呼應教學進度統整情境）。
- **CSV**：以 `﻿` BOM + UTF-8 輸出，Excel 開啟中文不亂碼；欄位含結清狀態。

## 追加功能：匯入 Google 行事曆（.ics）

- **走 .ics 而非 OAuth**：原 spec 把 Google OAuth 同步列為 v2（設定重）。改以 `.ics` 檔上傳或「私人 iCal 網址」匯入，免 OAuth／免 API 金鑰，最適合快速灌真實資料。OAuth 一鍵連線仍留待 v2。
- **解析引擎 ical.js**：正確處理 VTIMEZONE、RRULE 展開、all-day、ATTENDEE。時區換算以 VTIMEZONE 為準，floating 時間視為台北。
- **人事物轉換**：ATTENDEE/ORGANIZER→contacts（以 email 優先、姓名次之去重合併，新增 `contacts.email` 欄）；ICS CATEGORIES + 關鍵字規則→tags；重複行程在選定區間內展開為實體列並共用 `recurrence_group_id`。
- **去重**：新增 `events.source_uid`，以 `(calendar_id, source_uid, starts_at)` 判定重複匯入時略過。
- **兩段式**：先 `previewIcsImportAction`（不寫入，回傳將匯入清單與新人物數）再 `commitIcsImportAction`（zod 驗證後寫入）；單次上限 1500 筆。

## 待 v2 的擴充接縫

- 拖曳調整行程時間（week/day 視圖已具座標基礎）。
- 完整跨日行程分段渲染、完整 RRULE 與例外日。
