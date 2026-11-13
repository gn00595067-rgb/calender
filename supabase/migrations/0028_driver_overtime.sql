-- ============================================================
-- 0028_driver_overtime：司機帳號＋加班申請／核准
--   1. contacts.driver_user_id：司機的登入帳號（人物管理建立，一個帳號只連一位人物）
--      月薪沿用 contacts.monthly_salary（0018）
--   2. driver_overtime：司機自己填加班（日期、起訖、事由），Peggy 核准／退回
--   3. 司機只能看自己的申請；核准後不能再改
--   4. driver_trips()：司機看得到主人「需要司機」的接送行程（不含費用等欄位）
-- spec：docs/specs/司機打卡與加班費.md
-- ============================================================

alter table public.contacts
  add column if not exists driver_user_id uuid unique
    references public.profiles (id) on delete set null;

create table if not exists public.driver_overtime (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  contact_id   uuid not null references public.contacts (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  work_date    date not null,
  start_time   time not null,
  end_time     time not null,
  reason       text not null check (length(btrim(reason)) > 0),
  event_id     uuid references public.events (id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint driver_overtime_time_order check (end_time > start_time)
);
create index if not exists driver_overtime_owner_idx on public.driver_overtime (owner_id, work_date);
create index if not exists driver_overtime_contact_idx on public.driver_overtime (contact_id, work_date);

drop trigger if exists driver_overtime_updated_at on public.driver_overtime;
create trigger driver_overtime_updated_at
  before update on public.driver_overtime
  for each row execute function public.set_updated_at();

-- 這位人物是不是「我」的司機身分
create or replace function public.is_my_driver_contact(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.contacts where id = c and driver_user_id = auth.uid());
$$;

-- 這位人物屬於誰（司機新增時 owner_id 要對得上）
create or replace function public.contact_owner(c uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from public.contacts where id = c;
$$;

-- 我是哪位人物的司機帳號（登入後判斷要不要進司機頁）
create or replace function public.my_driver_links()
returns table (contact_id uuid, contact_name text, owner_id uuid, owner_name text, monthly_salary int)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.owner_id, p.display_name, c.monthly_salary::int
  from public.contacts c
  join public.profiles p on p.id = c.owner_id
  where c.driver_user_id = auth.uid();
$$;

alter table public.driver_overtime enable row level security;

drop policy if exists driver_overtime_select on public.driver_overtime;
create policy driver_overtime_select on public.driver_overtime
  for select to authenticated
  using (owner_id = auth.uid() or public.is_my_driver_contact(contact_id));

-- 新增：主人（補登）或司機本人（只能送「待核准」）
drop policy if exists driver_overtime_insert on public.driver_overtime;
create policy driver_overtime_insert on public.driver_overtime
  for insert to authenticated
  with check (
    owner_id = public.contact_owner(contact_id)
    and (
      owner_id = auth.uid()
      or (public.is_my_driver_contact(contact_id) and status = 'pending'
          and author_id = auth.uid() and reviewed_at is null)
    )
  );

-- 主人：可改全部（核准／退回／修正時間）
drop policy if exists driver_overtime_update_owner on public.driver_overtime;
create policy driver_overtime_update_owner on public.driver_overtime
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and owner_id = public.contact_owner(contact_id));

-- 司機：只能改還沒核准的（退回後修改＝重新送出，狀態回到待核准）
drop policy if exists driver_overtime_update_driver on public.driver_overtime;
create policy driver_overtime_update_driver on public.driver_overtime
  for update to authenticated
  using (public.is_my_driver_contact(contact_id) and status in ('pending','rejected'))
  with check (
    public.is_my_driver_contact(contact_id)
    and owner_id = public.contact_owner(contact_id)
    and status = 'pending'
    and reviewed_at is null
  );

drop policy if exists driver_overtime_delete on public.driver_overtime;
create policy driver_overtime_delete on public.driver_overtime
  for delete to authenticated
  using (
    owner_id = auth.uid()
    or (public.is_my_driver_contact(contact_id) and status <> 'approved')
  );

-- 司機的接送行程：主人自己的＋分享給主人的分類裡「需要司機」的行程
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
    e.title,
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
revoke all on function public.my_driver_links() from public, anon;
grant execute on function public.my_driver_links() to authenticated;

-- 主人讀得到司機帳號名稱（司機看主人名字走 my_driver_links）
drop policy if exists profiles_select_driver on public.profiles;
create policy profiles_select_driver on public.profiles
  for select to authenticated
  using (exists (
    select 1 from public.contacts c
    where c.driver_user_id = profiles.id and c.owner_id = auth.uid()
  ));

notify pgrst, 'reload schema';
