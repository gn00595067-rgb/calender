# RLS 隔離驗證清單

以兩個測試帳號驗證 Row Level Security。所有「不應看到」的查詢都必須回傳 **0 列**（而非靠前端隱藏）。

- **老闆** `boss@example.com`：擁有 本人／小明（兒子）／公事／私事 四個行事曆。
- **家教** `tutor@example.com`：僅被以 **contributor** 分享「小明（兒子）」。

## 一、以 SQL 驗證（Supabase Dashboard → SQL Editor）

Supabase 的 SQL Editor 預設以 service_role 執行（繞過 RLS），需模擬使用者。可用下列方式在單一 transaction 內模擬 JWT：

```sql
-- 模擬家教身分（將 <TUTOR_UUID> 換成 auth.users 內 tutor 的 id）
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','<TUTOR_UUID>','email','tutor@example.com','role','authenticated')::text,
  true);
set local role authenticated;

-- 1. 家教只看得到「小明（兒子）」一個行事曆
select name from public.calendars;              -- 期望：僅「小明（兒子）」

-- 2. 家教看得到小明的行程（含數學家教課）
select title from public.events;                -- 期望：只有小明分類的行程

-- 3. 家教「看不到」任何財務金額
select count(*) from public.finance_records;    -- 期望：0

-- 4. 家教「不能」新增行程（RLS 會擋）
insert into public.events (calendar_id, creator_id, title, starts_at, ends_at)
values (
  (select id from public.calendars limit 1),
  '<TUTOR_UUID>', '偷加的行程', now(), now() + interval '1 hour'
);                                              -- 期望：錯誤 / 0 rows（policy 拒絕）

-- 5. 家教「可以」對數學家教課新增回饋
insert into public.event_notes (event_id, author_id, content)
values (
  (select id from public.events where title = '數學家教課' limit 1),
  '<TUTOR_UUID>', '測試回饋'
);                                              -- 期望：成功

rollback;
```

```sql
-- 模擬老闆身分
begin;
select set_config('request.jwt.claims',
  json_build_object('sub','<BOSS_UUID>','email','boss@example.com','role','authenticated')::text,
  true);
set local role authenticated;

select count(*) from public.calendars;          -- 期望：4
select count(*) from public.finance_records;    -- 期望：> 0（看得到金額）
rollback;
```

## 二、以雙帳號在 UI 實測（對應規格第 5 節關鍵情境）

| # | 操作 | 期望結果 |
|---|---|---|
| 1 | 以 `tutor@example.com` 登入 | 側欄「與我分享」只有「小明（兒子）」，沒有本人／公事／私事 |
| 2 | 進入行事曆／總覽 | 只看得到小明分類的行程 |
| 3 | 開啟「數學家教課」詳情 | 看得到課程資訊與回饋區，**看不到**任何金額欄位（含該堂家教費） |
| 4 | 嘗試新增／編輯行程 | 沒有「新增行程」按鈕；後端亦拒絕（RLS） |
| 5 | 在數學家教課填寫回饋＋進度摘要 | 成功送出，老闆端該行程出現紅點提示 |
| 6 | 於報表頁 `/reports` | 家教無法看到費用金額（頁面降級或 0 筆） |
| 7 | 回到 `boss@example.com` | 看得到全部四個行事曆與所有金額、家教填寫的回饋 |

## 三、跨帳號負向清單（每條都應為「看不到」）

- 家教 SELECT 老闆「公事」的 events → 0 列
- 家教 SELECT 任何 finance_records → 0 列
- 家教 UPDATE / DELETE 小明的 events → 被拒
- 家教 SELECT 老闆的 contacts（未關聯到可見行程者）→ 0 列
- 非成員第三方帳號 SELECT 小明的 events / shares → 0 列
