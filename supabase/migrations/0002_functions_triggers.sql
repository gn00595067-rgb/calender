-- ============================================================
-- 函式與觸發器
-- 權限判斷函式一律 SECURITY DEFINER 並鎖定 search_path，
-- 直接讀取底層表以避免 policy 遞迴。
-- ============================================================

-- 目前登入者的 email（供分享認領比對）
create or replace function public.auth_email()
returns text
language sql
stable
as $$
  select nullif(lower(auth.jwt() ->> 'email'), '');
$$;

-- 取得使用者對某行事曆的有效角色：owner / editor / contributor / viewer / null
create or replace function public.calendar_role(cal uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.calendars c
      where c.id = cal and c.owner_id = auth.uid()
    ) then 'owner'
    else (
      select s.role from public.calendar_shares s
      where s.calendar_id = cal and s.member_id = auth.uid()
      limit 1
    )
  end;
$$;

create or replace function public.is_calendar_owner(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.calendars c
    where c.id = cal and c.owner_id = auth.uid()
  );
$$;

create or replace function public.has_calendar_access(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) is not null;
$$;

create or replace function public.can_edit_calendar(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) in ('owner','editor');
$$;

create or replace function public.can_note_calendar(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) in ('owner','editor','contributor');
$$;

create or replace function public.can_view_finance(cal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.calendar_role(cal) in ('owner','editor');
$$;

-- 以 event 為單位的便捷判斷
create or replace function public.can_view_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_calendar_access((select e.calendar_id from public.events e where e.id = ev));
$$;

create or replace function public.can_edit_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_edit_calendar((select e.calendar_id from public.events e where e.id = ev));
$$;

create or replace function public.can_note_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_note_calendar((select e.calendar_id from public.events e where e.id = ev));
$$;

-- 是否與目標使用者共享至少一個行事曆（供 profiles 可見性）
create or replace function public.shares_any_calendar(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists ( -- target 擁有的行事曆，我是成員
      select 1 from public.calendar_shares s
      join public.calendars c on c.id = s.calendar_id
      where s.member_id = auth.uid() and c.owner_id = target
    )
    or exists ( -- 我擁有的行事曆，target 是成員
      select 1 from public.calendar_shares s
      join public.calendars c on c.id = s.calendar_id
      where c.owner_id = auth.uid() and s.member_id = target
    );
$$;

-- ------------------------------------------------------------
-- updated_at 自動更新（events）
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- handle_new_user：註冊時建立 profile 與四個預設分類
-- ------------------------------------------------------------
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

  insert into public.calendars (owner_id, name, kind, color, position)
  values
    (new.id, '本人', 'self',    '#2563EB', 0),
    (new.id, '小孩', 'child',   '#16A34A', 1),
    (new.id, '公事', 'work',    '#9333EA', 2),
    (new.id, '私事', 'private', '#EA580C', 3);

  -- 回填此 email 先前收到的分享邀請
  update public.calendar_shares
  set member_id = new.id
  where lower(invited_email) = lower(coalesce(new.email, '')) and member_id is null;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
