-- ============================================================
-- 0005_billing：家教收費優化
--   1. expense_categories 費用類別（選單制，防呆＋週/月/年統計）
--   2. contacts 預設收費（計費方式／預設金額／類別／付款方式）
--   3. prepaid_accounts 預繳/預付儲值帳戶
--   4. finance_records 擴充（category_id／付款方式／預繳關聯）
-- 命名 snake_case；沿用 0002 的權限函式；RLS 於本檔一併設定。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 費用類別（選單制）
-- ------------------------------------------------------------
create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  -- 分群統計用（例：小孩 / 大人 / 通用），可空
  group_label text,
  position    int  not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);
create index expense_categories_owner_idx on public.expense_categories (owner_id, position);

-- ------------------------------------------------------------
-- 2) 人物（老師）預設收費
-- ------------------------------------------------------------
alter table public.contacts
  add column billing_mode           text
    check (billing_mode in ('fixed','hourly')),
  add column default_rate           numeric(12,0)
    check (default_rate >= 0),
  add column default_category_id    uuid
    references public.expense_categories (id) on delete set null,
  add column default_direction      text
    check (default_direction in ('expense','income')),
  add column default_payment_method text
    check (default_payment_method in ('monthly','per_time','prepaid_deduct','prepaid_term'));

-- ------------------------------------------------------------
-- 3) 預繳/預付 儲值帳戶
--    kind: deduct=預繳累扣（有金額餘額）／term=預付學期（可含總堂數）
--    餘額＝total_amount − Σ(此帳戶底下 covered_by_prepaid 的每堂金額)
-- ------------------------------------------------------------
create table public.prepaid_accounts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  contact_id     uuid references public.contacts (id) on delete set null,
  calendar_id    uuid references public.calendars (id) on delete set null,
  label          text not null,
  kind           text not null check (kind in ('deduct','term')),
  total_amount   numeric(12,0) not null default 0 check (total_amount >= 0),
  total_sessions int check (total_sessions >= 0),
  note           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create index prepaid_accounts_owner_idx   on public.prepaid_accounts (owner_id);
create index prepaid_accounts_contact_idx on public.prepaid_accounts (contact_id);

-- ------------------------------------------------------------
-- 4) 財務紀錄擴充
--    category_id        ：選單類別（canonical；沿用 category_label 存名稱備援）
--    payment_method     ：付款方式
--    prepaid_account_id ：關聯的預繳帳戶
--    is_prepaid_topup   ：這筆＝儲值/預付本身（實際付出的錢）
--    covered_by_prepaid ：這堂由預繳帳戶支付（計次數但不重複計支出）
-- ------------------------------------------------------------
alter table public.finance_records
  add column category_id        uuid
    references public.expense_categories (id) on delete set null,
  add column payment_method     text
    check (payment_method in ('monthly','per_time','prepaid_deduct','prepaid_term')),
  add column prepaid_account_id uuid
    references public.prepaid_accounts (id) on delete set null,
  add column is_prepaid_topup   boolean not null default false,
  add column covered_by_prepaid boolean not null default false;
create index finance_prepaid_idx  on public.finance_records (prepaid_account_id);
create index finance_category_idx on public.finance_records (category_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.expense_categories enable row level security;
alter table public.prepaid_accounts   enable row level security;

-- expense_categories：擁有者可寫；被可檢視的財務引用者可讀
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.finance_records fr
      where fr.category_id = expense_categories.id
        and fr.calendar_id is not null
        and public.can_view_finance(fr.calendar_id)
    )
  );
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated
  using (owner_id = auth.uid());

-- prepaid_accounts：擁有者可寫；被可檢視的財務引用者可讀
create policy prepaid_accounts_select on public.prepaid_accounts
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.finance_records fr
      where fr.prepaid_account_id = prepaid_accounts.id
        and fr.calendar_id is not null
        and public.can_view_finance(fr.calendar_id)
    )
  );
create policy prepaid_accounts_insert on public.prepaid_accounts
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy prepaid_accounts_update on public.prepaid_accounts
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy prepaid_accounts_delete on public.prepaid_accounts
  for delete to authenticated
  using (owner_id = auth.uid());
