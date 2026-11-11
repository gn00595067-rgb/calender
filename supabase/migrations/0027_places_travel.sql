-- ============================================================
-- 0027 車程估算與出門提醒
-- spec：docs/specs/車程估算與出門提醒.md
-- 1) places：常用地點（家、公司…）的地址與座標
-- 2) events：估算車程、出發地、出門提醒提前分鐘、出門提醒已推播
-- ============================================================

create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  address     text not null check (length(trim(address)) between 1 and 200),
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now(),
  unique (owner_id, name)
);

alter table public.places enable row level security;

-- 本人＋被分享成可編輯／可新增的人看得到（豪哥要用 Peggy 的「家」）；
-- 老師身分（scheduler）與唯讀看不到，家裡地址不外流。
drop policy if exists places_select on public.places;
create policy places_select on public.places
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.calendar_shares s
      join public.calendars c on c.id = s.calendar_id
      where c.owner_id = places.owner_id
        and s.member_id = auth.uid()
        and s.role in ('editor', 'contributor')
    )
  );

drop policy if exists places_insert on public.places;
create policy places_insert on public.places
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists places_update on public.places;
create policy places_update on public.places
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists places_delete on public.places;
create policy places_delete on public.places
  for delete to authenticated
  using (owner_id = auth.uid());

alter table public.events add column if not exists travel_minutes integer
  check (travel_minutes is null or travel_minutes between 0 and 600);
alter table public.events add column if not exists travel_origin text;
alter table public.events add column if not exists leave_minutes integer
  check (leave_minutes is null or leave_minutes between 0 and 720);
alter table public.events add column if not exists leave_push_sent_at timestamptz;

notify pgrst, 'reload schema';
