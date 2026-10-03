-- ============================================================
-- 0008_rate_plans：老師收費方案（1對1／1對2 不同鐘點費）
--   1. contact_rate_plans：每位老師可設多個方案（人數、固定/時薪、整堂總價）
--   2. 既有 contacts.default_rate 轉成一筆「1對1」方案（冪等，可重複執行）
--   3. finance_records 加方案快照（方案改名/刪除後歷史仍正確）
-- spec：docs/specs/課程收費方案-1對1與1對2.md
-- ============================================================

-- ------------------------------------------------------------
-- 1) 收費方案
-- ------------------------------------------------------------
create table if not exists public.contact_rate_plans (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  label        text not null,
  headcount    int  not null default 1 check (headcount >= 1),
  billing_mode text not null check (billing_mode in ('fixed','hourly')),
  rate         numeric(12,0) not null check (rate >= 0),
  position     int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists contact_rate_plans_contact_idx
  on public.contact_rate_plans (contact_id, position);

-- ------------------------------------------------------------
-- 2) 舊費率 → 1對1 方案（只補還沒有任何方案的老師）
-- ------------------------------------------------------------
insert into public.contact_rate_plans (owner_id, contact_id, label, headcount, billing_mode, rate, position)
select c.owner_id, c.id, '1對1', 1, coalesce(c.billing_mode, 'fixed'), c.default_rate, 0
from public.contacts c
where c.default_rate is not null
  and not exists (
    select 1 from public.contact_rate_plans p where p.contact_id = c.id
  );

-- ------------------------------------------------------------
-- 3) 財務紀錄：方案快照
--    rate_plan_id  ：當時用的方案（方案刪除後 set null）
--    lesson_label  ：方案名稱快照，如「1對2」
--    headcount     ：班型人數快照
--    learner_count ：上課的主角數（統計時平均分攤用）
-- ------------------------------------------------------------
alter table public.finance_records
  add column if not exists rate_plan_id  uuid
    references public.contact_rate_plans (id) on delete set null,
  add column if not exists lesson_label  text,
  add column if not exists headcount     int check (headcount >= 1),
  add column if not exists learner_count int check (learner_count >= 1);

-- ============================================================
-- RLS：擁有者可寫；能看到該老師的人（分享者）可讀方案
-- ============================================================
alter table public.contact_rate_plans enable row level security;

drop policy if exists contact_rate_plans_select on public.contact_rate_plans;
create policy contact_rate_plans_select on public.contact_rate_plans
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.contacts c
      where c.id = contact_rate_plans.contact_id
    )
  );

drop policy if exists contact_rate_plans_insert on public.contact_rate_plans;
create policy contact_rate_plans_insert on public.contact_rate_plans
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists contact_rate_plans_update on public.contact_rate_plans;
create policy contact_rate_plans_update on public.contact_rate_plans
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists contact_rate_plans_delete on public.contact_rate_plans;
create policy contact_rate_plans_delete on public.contact_rate_plans
  for delete to authenticated
  using (owner_id = auth.uid());
