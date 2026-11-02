-- ============================================================
-- 0023_tutor_reports：家教老師填報（專科老師上課紀錄＋家庭老師每日回報）
--   1. contacts：老師類型、可填科目、開放給家庭老師、上課學生
--      家庭老師時薪另放 tutor_rate_settings（只有家長讀得到；contacts 會被共用行事曆的人讀到）
--   2. tutor_reports：一筆＝一次上課紀錄或一天的回報（內容放 content jsonb）
--   3. tutor_report_comments：家長留言、老師回覆
--   4. 權限：家長看全部；老師只看／改自己的；家庭老師另外看得到家長開放的專科紀錄
-- spec：docs/specs/家教老師填報.md
-- ============================================================

alter table public.contacts
  add column if not exists tutor_kind text check (tutor_kind in ('specialist', 'home')),
  add column if not exists tutor_subjects text[] not null default '{}',
  add column if not exists tutor_shared boolean not null default false,
  add column if not exists is_student boolean not null default false;

-- 家庭老師各工作類別時薪：只有家長（owner）能讀寫
create table if not exists public.tutor_rate_settings (
  contact_id uuid primary key references public.contacts (id) on delete cascade,
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  rates      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.tutor_rate_settings enable row level security;
drop policy if exists tutor_rate_settings_owner on public.tutor_rate_settings;
create policy tutor_rate_settings_owner on public.tutor_rate_settings
  for all to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.owner_id = auth.uid())
  );

-- 上課學生預設：哥哥（立齊 Rick）、妹妹（以瑄 Iris）
update public.contacts set is_student = true
where is_family and name in ('哥哥', '妹妹');

create table if not exists public.tutor_reports (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  teacher_contact_id uuid not null references public.contacts (id) on delete cascade,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  -- 觸發器自動帶入（老師讀不到 contacts，家庭老師看專科紀錄時要顯示名字）
  teacher_name       text not null default '',
  kind               text not null check (kind in ('lesson', 'daily')),
  report_date        date not null,
  subject            text,
  start_time         time,
  end_time           time,
  mode               text,
  student_ids        uuid[] not null default '{}',
  -- 連到行事曆那堂課（選填）與自動寫的回饋摘要
  event_id           uuid references public.events (id) on delete set null,
  event_note_id      uuid references public.event_notes (id) on delete set null,
  content            jsonb not null default '{}'::jsonb,
  -- 系統算的時數（分鐘）；每日回報依工作類別：{"教學統籌": 90, ...}
  minutes            int not null default 0,
  minutes_by_category jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists tutor_reports_owner_date_idx on public.tutor_reports (owner_id, report_date desc);
create index if not exists tutor_reports_author_date_idx on public.tutor_reports (author_id, report_date desc);
-- 家庭老師一天一筆
create unique index if not exists tutor_reports_daily_once
  on public.tutor_reports (teacher_contact_id, report_date) where kind = 'daily';

create table if not exists public.tutor_report_comments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.tutor_reports (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',
  body        text not null check (length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists tutor_report_comments_report_idx
  on public.tutor_report_comments (report_id, created_at);

-- ---------- 權限輔助函式（security definer：老師讀不到 contacts） ----------

-- 這位人物是「我」的老師帳號，且屬於這位家長
create or replace function public.is_my_teacher_contact(p_contact uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts c
    where c.id = p_contact and c.owner_id = p_owner and c.teacher_user_id = auth.uid()
  );
$$;

-- 我是這位家長的家庭老師
create or replace function public.is_home_teacher_for(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts c
    where c.owner_id = p_owner and c.teacher_user_id = auth.uid() and c.tutor_kind = 'home'
  );
$$;

-- 家長是否開放這位專科老師的紀錄給家庭老師
create or replace function public.is_tutor_shared(p_contact uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.tutor_shared from public.contacts c
    where c.id = p_contact
      and (c.owner_id = auth.uid() or public.is_home_teacher_for(c.owner_id))
  ), false);
$$;

-- 回饋摘要必須是自己寫的那則
create or replace function public.is_my_event_note(p_note uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_notes n where n.id = p_note and n.author_id = auth.uid());
$$;

create or replace function public.can_view_tutor_report(p_report uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tutor_reports r
    where r.id = p_report
      and (
        r.owner_id = auth.uid()
        or public.is_my_teacher_contact(r.teacher_contact_id, r.owner_id)
        or (public.is_home_teacher_for(r.owner_id) and public.is_tutor_shared(r.teacher_contact_id))
      )
  );
$$;

-- 留言：家長與那筆的作者
create or replace function public.can_comment_tutor_report(p_report uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tutor_reports r
    where r.id = p_report
      and (r.owner_id = auth.uid() or public.is_my_teacher_contact(r.teacher_contact_id, r.owner_id))
  );
$$;

-- ---------- 觸發器：帶入老師名字、更新時間；留言帶入作者名字 ----------

create or replace function public.tutor_reports_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.name into new.teacher_name from public.contacts c where c.id = new.teacher_contact_id;
  new.teacher_name := coalesce(new.teacher_name, '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    -- 這些欄位建立後不能被改（避免把紀錄改掛到別人名下）
    new.owner_id := old.owner_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists tutor_reports_fill on public.tutor_reports;
create trigger tutor_reports_fill
before insert or update on public.tutor_reports
for each row execute function public.tutor_reports_fill();

-- 刪紀錄（家長或老師）時一併刪掉它寫到行事曆那堂課的回饋摘要，避免仍被算成「有回饋」
create or replace function public.tutor_reports_drop_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.event_note_id is not null then
    delete from public.event_notes where id = old.event_note_id;
  end if;
  return old;
end;
$$;

drop trigger if exists tutor_reports_drop_note on public.tutor_reports;
create trigger tutor_reports_drop_note
after delete on public.tutor_reports
for each row execute function public.tutor_reports_drop_note();

create or replace function public.tutor_comments_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 老師顯示人物名字（＋老師），家長顯示帳號名字
  select coalesce(
    (select c.name || '老師' from public.contacts c where c.teacher_user_id = new.author_id limit 1),
    (select p.display_name from public.profiles p where p.id = new.author_id),
    ''
  ) into new.author_name;
  return new;
end;
$$;

drop trigger if exists tutor_comments_fill on public.tutor_report_comments;
create trigger tutor_comments_fill
before insert on public.tutor_report_comments
for each row execute function public.tutor_comments_fill();

-- ---------- RLS ----------

alter table public.tutor_reports enable row level security;
alter table public.tutor_report_comments enable row level security;

drop policy if exists tutor_reports_select on public.tutor_reports;
create policy tutor_reports_select on public.tutor_reports
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_my_teacher_contact(teacher_contact_id, owner_id)
    or (public.is_home_teacher_for(owner_id) and public.is_tutor_shared(teacher_contact_id))
  );

drop policy if exists tutor_reports_insert on public.tutor_reports;
create policy tutor_reports_insert on public.tutor_reports
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_my_teacher_contact(teacher_contact_id, owner_id)
    and (event_id is null or public.is_event_teacher(event_id))
    and (event_note_id is null or public.is_my_event_note(event_note_id))
  );

-- 修改：同一位老師人物（換了登入帳號也能改舊紀錄）
drop policy if exists tutor_reports_update on public.tutor_reports;
create policy tutor_reports_update on public.tutor_reports
  for update to authenticated
  using (public.is_my_teacher_contact(teacher_contact_id, owner_id))
  with check (
    public.is_my_teacher_contact(teacher_contact_id, owner_id)
    and (event_id is null or public.is_event_teacher(event_id))
    and (event_note_id is null or public.is_my_event_note(event_note_id))
  );

drop policy if exists tutor_reports_delete on public.tutor_reports;
create policy tutor_reports_delete on public.tutor_reports
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_my_teacher_contact(teacher_contact_id, owner_id));

drop policy if exists tutor_comments_select on public.tutor_report_comments;
create policy tutor_comments_select on public.tutor_report_comments
  for select to authenticated
  -- 只有家長與那筆的老師（家庭老師看得到開放的專科紀錄，但看不到雙方的留言）
  using (public.can_comment_tutor_report(report_id));

drop policy if exists tutor_comments_insert on public.tutor_report_comments;
create policy tutor_comments_insert on public.tutor_report_comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_comment_tutor_report(report_id));

drop policy if exists tutor_comments_delete on public.tutor_report_comments;
create policy tutor_comments_delete on public.tutor_report_comments
  for delete to authenticated
  using (author_id = auth.uid());

-- ---------- 老師的基本資料（不含時薪） ----------

create or replace function public.my_tutor_profile()
returns table (
  contact_id uuid,
  contact_name text,
  owner_id uuid,
  tutor_kind text,
  tutor_subjects text[],
  students jsonb
)
language sql stable security definer set search_path = public as $$
  select
    c.id,
    c.name,
    c.owner_id,
    c.tutor_kind,
    c.tutor_subjects,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
      from public.contacts s
      where s.owner_id = c.owner_id and s.is_student
    ), '[]'::jsonb)
  from public.contacts c
  where c.teacher_user_id = auth.uid();
$$;

revoke all on function public.my_tutor_profile() from public, anon;
grant execute on function public.my_tutor_profile() to authenticated;

-- 輔助函式只給登入者
revoke all on function public.is_my_teacher_contact(uuid, uuid) from public, anon;
revoke all on function public.is_home_teacher_for(uuid) from public, anon;
revoke all on function public.is_tutor_shared(uuid) from public, anon;
revoke all on function public.is_my_event_note(uuid) from public, anon;
revoke all on function public.can_view_tutor_report(uuid) from public, anon;
revoke all on function public.can_comment_tutor_report(uuid) from public, anon;
grant execute on function public.is_my_teacher_contact(uuid, uuid) to authenticated;
grant execute on function public.is_home_teacher_for(uuid) to authenticated;
grant execute on function public.is_tutor_shared(uuid) to authenticated;
grant execute on function public.is_my_event_note(uuid) to authenticated;
grant execute on function public.can_view_tutor_report(uuid) to authenticated;
grant execute on function public.can_comment_tutor_report(uuid) to authenticated;

notify pgrst, 'reload schema';
