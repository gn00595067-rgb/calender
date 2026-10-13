-- ============================================================
-- 0018_work_logs：工作紀錄匯入與效益（測試回饋 #4）
--   1. contacts.monthly_salary：月薪（用來比對工作價值）
--   2. work_categories：每個人的工作分類（大項／小項／時薪；aliases＝Excel 類別的其他寫法）
--   3. work_logs：從 Excel 匯入的工作紀錄（一列一筆）
--   4. 預設：Phoenix 套 Peggy 給的 9 個大項與暫訂時薪、月薪 4 萬
-- spec：docs/specs/工作紀錄匯入與效益.md
-- ============================================================

alter table public.contacts
  add column if not exists monthly_salary int;

create table if not exists public.work_categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  name        text not null,
  sub_label   text,
  hourly_rate int  not null default 0 check (hourly_rate >= 0),
  aliases     text[] not null default '{}',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists work_categories_contact_idx on public.work_categories (contact_id, position);

create table if not exists public.work_logs (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  work_date    date not null,
  start_time   text,
  end_time     text,
  hours        numeric(6, 2) not null check (hours >= 0),
  content      text,
  category_raw text,
  category_id  uuid references public.work_categories (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists work_logs_contact_date_idx on public.work_logs (contact_id, work_date);

alter table public.work_categories enable row level security;
alter table public.work_logs enable row level security;

-- 只有擁有者能看、能改（薪資相關，不分享）
drop policy if exists work_categories_all on public.work_categories;
create policy work_categories_all on public.work_categories
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists work_logs_all on public.work_logs;
create policy work_logs_all on public.work_logs
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 預設資料：Phoenix（只在還沒有分類時建立；可重複執行）
do $$
declare
  c record;
begin
  for c in select id, owner_id from public.contacts where name = 'Phoenix' loop
    update public.contacts set monthly_salary = 40000
      where id = c.id and monthly_salary is null;
    if not exists (select 1 from public.work_categories where contact_id = c.id) then
      insert into public.work_categories (owner_id, contact_id, name, sub_label, hourly_rate, position) values
        (c.owner_id, c.id, '英文教學',     '英文教學',              500, 0),
        (c.owner_id, c.id, '複習.檢討',    '複習.檢討',             500, 1),
        (c.owner_id, c.id, '檢查作業',     '每天作業.閱讀',         250, 2),
        (c.owner_id, c.id, '專題輔導',     '青山time',              500, 3),
        (c.owner_id, c.id, '聯絡老師',     '課表/考券/收集反饋',    250, 4),
        (c.owner_id, c.id, '外出/陪上課',  '外出/陪上課',           250, 5),
        (c.owner_id, c.id, '阿姨國語教學', '阿姨國語教學',          250, 6),
        (c.owner_id, c.id, '採購',         '網上/實體店',           250, 7),
        (c.owner_id, c.id, '行政/其他',    '回報進度.確認.家長溝通', 250, 8);
    end if;
  end loop;
end $$;
