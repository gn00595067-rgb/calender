-- ============================================================
-- 0025 分享身分「老師」（scheduler）：可看全部、新增行程，只能改／刪自己登錄的，看不到金額
-- spec：docs/specs/老師登錄小孩行程.md
-- ============================================================

alter table public.calendar_shares drop constraint if exists calendar_shares_role_check;
alter table public.calendar_shares
  add constraint calendar_shares_role_check
  check (role in ('editor','contributor','viewer','scheduler'));

-- 可在此行事曆新增行程（scheduler 也可以；改／刪另由 can_edit_event 判斷是不是自己登錄的）
create or replace function public.can_edit_calendar(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) in ('owner','editor','scheduler');
$$;

create or replace function public.can_note_calendar(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) in ('owner','editor','contributor','scheduler');
$$;

-- 可改／刪這筆行程：owner／editor 全部；scheduler 只限自己登錄的
create or replace function public.can_edit_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = ev
      and (
        public.calendar_role(e.calendar_id) in ('owner','editor')
        or (public.calendar_role(e.calendar_id) = 'scheduler' and e.creator_id = auth.uid())
      )
  );
$$;

-- can_view_finance 不變（owner／editor），scheduler 看不到金額

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (
    public.can_edit_calendar(calendar_id)
    and (public.calendar_role(calendar_id) <> 'scheduler' or creator_id = auth.uid())
  )
  with check (
    public.can_edit_calendar(calendar_id)
    and (public.calendar_role(calendar_id) <> 'scheduler' or creator_id = auth.uid())
  );

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated
  using (
    public.can_edit_calendar(calendar_id)
    and (public.calendar_role(calendar_id) <> 'scheduler' or creator_id = auth.uid())
  );

-- 註冊時：被邀請當「老師」的人不建預設 4 個行事曆，免得老師把行程記到自己的空行事曆、家長看不到
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
    where lower(invited_email) = lower(coalesce(new.email, '')) and role = 'scheduler'
  ) then
    insert into public.calendars (owner_id, name, kind, color, position)
    values
      (new.id, '本人', 'self',    '#2563EB', 0),
      (new.id, '小孩', 'child',   '#16A34A', 1),
      (new.id, '公事', 'work',    '#9333EA', 2),
      (new.id, '私事', 'private', '#EA580C', 3);
  end if;

  -- 回填此 email 先前收到的分享邀請
  update public.calendar_shares
  set member_id = new.id
  where lower(invited_email) = lower(coalesce(new.email, '')) and member_id is null;

  return new;
end;
$$;

notify pgrst, 'reload schema';
