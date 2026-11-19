-- ============================================================
-- 0030 分享身分「只看空檔」（freebusy）＋提議行程待審核；人物「老師的規則」
-- spec：docs/specs/只看空檔與提議行程審核.md
-- ============================================================

-- 1) 新身分 freebusy
alter table public.calendar_shares drop constraint if exists calendar_shares_role_check;
alter table public.calendar_shares
  add constraint calendar_shares_role_check
  check (role in ('editor','contributor','viewer','scheduler','freebusy'));

-- 2) 看得到行程內容：只看空檔的不算（行程、人物、標籤、回饋、費用的 RLS 都經過這裡或 can_view_event）
create or replace function public.has_calendar_access(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.calendar_role(cal), 'freebusy') <> 'freebusy';
$$;

-- 分類本身（名稱、顏色）只看空檔的人也要看得到，才能選「提議到哪個分類」
drop policy if exists calendars_select on public.calendars;
create policy calendars_select on public.calendars
  for select to authenticated
  using (public.has_calendar_access(id) or public.calendar_role(id) = 'freebusy');

-- 3) 忙碌時段：只回時間（含司機接送設定，用來把車程也算成沒空），不回標題、地點、人物
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
  order by e.starts_at;
$$;
revoke all on function public.busy_blocks(timestamptz, timestamptz) from public;
grant execute on function public.busy_blocks(timestamptz, timestamptz) to authenticated;

-- 4) 提議的行程
create table if not exists public.event_proposals (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles (id) on delete cascade,
  calendar_id   uuid not null references public.calendars (id) on delete cascade,
  proposer_id   uuid not null references public.profiles (id) on delete cascade,
  proposer_name text,
  title         text not null check (char_length(title) between 1 and 200),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text check (location is null or char_length(location) <= 200),
  note          text check (note is null or char_length(note) <= 1000),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note   text check (review_note is null or char_length(review_note) <= 500),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint event_proposals_time check (ends_at > starts_at)
);
create index if not exists event_proposals_owner_idx
  on public.event_proposals (owner_id, status, starts_at);
create index if not exists event_proposals_proposer_idx
  on public.event_proposals (proposer_id, created_at desc);

-- 提議者名字：照帳號顯示名稱帶入（不信任前端傳的）
create or replace function public.event_proposals_fill_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1))
      into new.proposer_name
      from public.profiles p where p.id = new.proposer_id;
  end if;
  return new;
end;
$$;
drop trigger if exists event_proposals_fill_name on public.event_proposals;
create trigger event_proposals_fill_name
  before insert on public.event_proposals
  for each row execute function public.event_proposals_fill_name();

alter table public.event_proposals enable row level security;

drop policy if exists event_proposals_select on public.event_proposals;
create policy event_proposals_select on public.event_proposals
  for select to authenticated
  using (proposer_id = auth.uid() or owner_id = auth.uid());

-- 提議者：用自己的名義、在分享給他「只看空檔」的分類、新增待審核
drop policy if exists event_proposals_insert on public.event_proposals;
create policy event_proposals_insert on public.event_proposals
  for insert to authenticated
  with check (
    proposer_id = auth.uid()
    and status = 'pending'
    and review_note is null
    and reviewed_at is null
    and public.calendar_role(calendar_id) = 'freebusy'
    and owner_id = (select c.owner_id from public.calendars c where c.id = calendar_id)
  );

-- 提議者：只能改自己待審核的，改完仍是待審核
drop policy if exists event_proposals_update_proposer on public.event_proposals;
create policy event_proposals_update_proposer on public.event_proposals
  for update to authenticated
  using (proposer_id = auth.uid() and status = 'pending')
  with check (
    proposer_id = auth.uid()
    and status = 'pending'
    and review_note is null
    and reviewed_at is null
    and public.calendar_role(calendar_id) = 'freebusy'
    and owner_id = (select c.owner_id from public.calendars c where c.id = calendar_id)
  );

-- Peggy：審核（核准／退回）
drop policy if exists event_proposals_update_owner on public.event_proposals;
create policy event_proposals_update_owner on public.event_proposals
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 提議者撤回自己待審核的；Peggy 可刪任何一筆
drop policy if exists event_proposals_delete on public.event_proposals;
create policy event_proposals_delete on public.event_proposals
  for delete to authenticated
  using ((proposer_id = auth.uid() and status = 'pending') or owner_id = auth.uid());

-- 5) 被邀請為「只看空檔」的人跟「老師」一樣，不建預設 4 個行事曆
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1),
    '使用者'
  );

  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), v_name)
  on conflict (id) do nothing;

  if not exists (
    select 1 from public.calendar_shares
    where lower(invited_email) = lower(coalesce(new.email, ''))
      and role in ('scheduler', 'freebusy')
  ) then
    insert into public.calendars (owner_id, name, kind, color, position)
    values
      (new.id, '本人', 'self',    '#2563EB', 0),
      (new.id, '小孩', 'child',   '#16A34A', 1),
      (new.id, '公事', 'work',    '#9333EA', 2),
      (new.id, '私事', 'private', '#EA580C', 3);
  end if;

  update public.calendar_shares
  set member_id = new.id
  where lower(invited_email) = lower(coalesce(new.email, '')) and member_id is null;

  return new;
end;
$$;

-- 6) 老師的規則（跟家長談好的個人約定，自由文字）
alter table public.contacts
  add column if not exists rules text check (rules is null or char_length(rules) <= 2000);

notify pgrst, 'reload schema';
