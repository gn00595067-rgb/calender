-- ============================================================
-- 0031 Elsa 11/19 需求：
--   1. 秘書空檔只算 Peggy 本人（主角是本人或沒填主角）的行程
--   2. 司機只看點到點，不給行程名稱
--   3. 提議逾期提醒（記錄提醒過了）
--   4. 員工帳號（家庭老師）連到人物：自己記工作紀錄、寫週報
--   5. 工作分類加「大項」；工作紀錄加細項、登錄人、到班行程
--   6. 週報
-- spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
-- ============================================================

-- 1) 忙碌時段：主角裡有小孩、家人但沒有本人 → 不算 Peggy 忙（小孩的事不擋秘書排 Peggy）
create or replace function public.busy_blocks(p_from timestamptz, p_to timestamptz)
returns table (
  calendar_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  needs_driver boolean,
  driver_trip text,
  driver_pickup_minutes integer
)
language sql
stable
security definer
set search_path = public
as $$
  select e.calendar_id, e.starts_at, e.ends_at, e.all_day,
         coalesce(e.needs_driver, false), e.driver_trip, e.driver_pickup_minutes
  from public.events e
  join public.calendar_shares s on s.calendar_id = e.calendar_id
  where s.member_id = auth.uid()
    and s.role = 'freebusy'
    and p_to > p_from
    and p_to - p_from <= interval '62 days'
    and e.starts_at < p_to
    and e.ends_at > p_from
    and (
      not exists (
        select 1 from public.event_contacts ec
        where ec.event_id = e.id and ec.role = 'subject'
      )
      or exists (
        select 1 from public.event_contacts ec
        join public.contacts c on c.id = ec.contact_id
        where ec.event_id = e.id and ec.role = 'subject' and c.is_self
      )
    )
  order by e.starts_at;
$$;

-- 2) 司機：行程名稱一律回空字串（Elsa：司機端只顯示點到點與時間）
create or replace function public.driver_trips(p_from timestamptz, p_to timestamptz)
returns table (
  event_id uuid,
  title text,
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  driver_trip text,
  driver_pickup_minutes int,
  driver_pickup_location text,
  driver_dropoff_location text,
  driver_note text,
  subject_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with owners as (
    select owner_id from public.contacts where driver_user_id = auth.uid()
  ),
  cals as (
    select c.id from public.calendars c where c.owner_id in (select owner_id from owners)
    union
    select s.calendar_id from public.calendar_shares s where s.member_id in (select owner_id from owners)
  )
  select
    e.id,
    ''::text,
    e.location,
    e.starts_at,
    e.ends_at,
    e.all_day,
    e.driver_trip,
    e.driver_pickup_minutes,
    e.driver_pickup_location,
    e.driver_dropoff_location,
    e.driver_note,
    coalesce((
      select array_agg(sc.name order by sc.name)
      from public.event_contacts s
      join public.contacts sc on sc.id = s.contact_id
      where s.event_id = e.id and s.role = 'subject'
    ), '{}')
  from public.events e
  where e.needs_driver
    and e.calendar_id in (select id from cals)
    and e.starts_at < p_to
    and e.ends_at > p_from
  order by e.starts_at;
$$;
revoke all on function public.driver_trips(timestamptz, timestamptz) from public, anon;
grant execute on function public.driver_trips(timestamptz, timestamptz) to authenticated;

-- 3) 提議逾期提醒過了（避免每分鐘一直推）
alter table public.event_proposals add column if not exists reminded_at timestamptz;

-- 4) 員工帳號：這位人物的登入帳號（家庭老師、秘書…），用來記自己的工作紀錄、寫週報
alter table public.contacts add column if not exists staff_user_id uuid references auth.users (id) on delete set null;
create unique index if not exists contacts_staff_user_uniq on public.contacts (staff_user_id) where staff_user_id is not null;

-- 我是哪位家長的哪位員工（不含月薪、時薪）
create or replace function public.my_staff_links()
returns table (contact_id uuid, contact_name text, owner_id uuid, owner_name text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.owner_id,
         coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1))
  from public.contacts c
  join public.profiles p on p.id = c.owner_id
  where c.staff_user_id = auth.uid();
$$;
revoke all on function public.my_staff_links() from public, anon;
grant execute on function public.my_staff_links() to authenticated;

create or replace function public.is_staff_contact(p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contacts c where c.id = p_contact and c.staff_user_id = auth.uid());
$$;

-- 5) 工作分類加大項（Phoenix 週報：老師的教學／陪上課與試上觀察／師資招募與行政／生活物資採買）
alter table public.work_categories add column if not exists group_label text;
alter table public.work_logs add column if not exists sub_label text;
alter table public.work_logs add column if not exists author_id uuid references auth.users (id) on delete set null;
alter table public.work_logs add column if not exists event_id uuid references public.events (id) on delete set null;
alter table public.work_logs add column if not exists updated_at timestamptz not null default now();

-- 員工讀自己的分類（不含時薪：走函式）
create or replace function public.my_work_categories(p_contact uuid)
returns table (id uuid, name text, sub_label text, group_label text, aliases text[], position int)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, w.sub_label, w.group_label, w.aliases, w.position
  from public.work_categories w
  where w.contact_id = p_contact
    and (w.owner_id = auth.uid() or public.is_staff_contact(p_contact))
  order by w.position;
$$;
revoke all on function public.my_work_categories(uuid) from public, anon;
grant execute on function public.my_work_categories(uuid) to authenticated;

-- 員工：讀／新增／改／刪自己人物的工作紀錄（擁有者照舊全部）
drop policy if exists work_logs_staff_select on public.work_logs;
create policy work_logs_staff_select on public.work_logs
  for select to authenticated using (public.is_staff_contact(contact_id));
drop policy if exists work_logs_staff_insert on public.work_logs;
create policy work_logs_staff_insert on public.work_logs
  for insert to authenticated
  with check (
    public.is_staff_contact(contact_id)
    and author_id = auth.uid()
    and owner_id = (select c.owner_id from public.contacts c where c.id = contact_id)
  );
drop policy if exists work_logs_staff_update on public.work_logs;
create policy work_logs_staff_update on public.work_logs
  for update to authenticated
  using (public.is_staff_contact(contact_id))
  with check (
    public.is_staff_contact(contact_id)
    and owner_id = (select c.owner_id from public.contacts c where c.id = contact_id)
  );
drop policy if exists work_logs_staff_delete on public.work_logs;
create policy work_logs_staff_delete on public.work_logs
  for delete to authenticated using (public.is_staff_contact(contact_id));

-- 6) 週報：一位員工一週一份
create table if not exists public.weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  week_start  date not null,
  -- {大項: 執行內容與成效概述}
  summaries   jsonb not null default '{}',
  review      text not null default '' check (char_length(review) <= 5000),
  submitted_at timestamptz,
  author_id   uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (contact_id, week_start)
);
alter table public.weekly_reports enable row level security;
drop policy if exists weekly_reports_owner on public.weekly_reports;
create policy weekly_reports_owner on public.weekly_reports
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists weekly_reports_staff on public.weekly_reports;
create policy weekly_reports_staff on public.weekly_reports
  for all to authenticated
  using (public.is_staff_contact(contact_id))
  with check (
    public.is_staff_contact(contact_id)
    and owner_id = (select c.owner_id from public.contacts c where c.id = contact_id)
  );

-- 員工讀得到自己被分享的週課表（跟家庭老師一樣）
create or replace function public.can_edit_tutor_schedule(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid() or public.is_home_teacher_for(p_owner)
    or exists (select 1 from public.contacts c where c.owner_id = p_owner and c.staff_user_id = auth.uid());
$$;

notify pgrst, 'reload schema';
