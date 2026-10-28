-- ============================================================
-- 0021_teacher_feedback：老師自填回饋＋缺回饋不付款（回饋 #22）
--   1. contacts.needs_feedback：這位老師每堂課都要寫回饋（報表檢查缺回饋）
--   2. contacts.teacher_user_id：老師的登入帳號（一個帳號只連一位人物）
--   3. 老師只能透過 teacher_lessons() 看到「相關人物有自己」的課（不含費用）
--   4. 老師可新增／讀／刪自己寫的回饋
-- spec：docs/specs/老師自填回饋與缺回饋不付款.md
-- ============================================================

alter table public.contacts
  add column if not exists needs_feedback boolean not null default false,
  add column if not exists teacher_user_id uuid unique
    references public.profiles (id) on delete set null;

-- 這堂課的相關人物裡，有沒有連到「我」的老師人物
create or replace function public.is_event_teacher(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.event_contacts ec
    join public.contacts c on c.id = ec.contact_id
    where ec.event_id = ev
      and ec.role = 'participant'
      and c.teacher_user_id = auth.uid()
  );
$$;

-- 我是哪幾位人物的老師帳號（登入後判斷要不要進老師頁）
create or replace function public.my_teacher_links()
returns table (contact_id uuid, contact_name text, owner_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, p.display_name
  from public.contacts c
  join public.profiles p on p.id = c.owner_id
  where c.teacher_user_id = auth.uid();
$$;

-- 老師的課：只回傳排課需要的欄位（沒有費用、描述、司機等）
create or replace function public.teacher_lessons(p_from timestamptz, p_to timestamptz)
returns table (
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  all_day boolean,
  location text,
  subject_names text[],
  my_note_count int,
  note_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.title,
    e.starts_at,
    e.ends_at,
    e.all_day,
    e.location,
    coalesce((
      select array_agg(sc.name order by sc.name)
      from public.event_contacts s
      join public.contacts sc on sc.id = s.contact_id
      where s.event_id = e.id and s.role = 'subject'
    ), '{}'),
    (select count(*)::int from public.event_notes n where n.event_id = e.id and n.author_id = auth.uid()),
    (select count(*)::int from public.event_notes n where n.event_id = e.id)
  from public.events e
  where e.starts_at < p_to
    and e.ends_at > p_from
    and public.is_event_teacher(e.id)
  order by e.starts_at;
$$;

revoke all on function public.teacher_lessons(timestamptz, timestamptz) from public, anon;
grant execute on function public.teacher_lessons(timestamptz, timestamptz) to authenticated;
revoke all on function public.my_teacher_links() from public, anon;
grant execute on function public.my_teacher_links() to authenticated;

-- 回饋：原本「看得到行程者可讀、contributor 以上可寫」，再加上「老師寫自己那堂」
drop policy if exists event_notes_select on public.event_notes;
create policy event_notes_select on public.event_notes
  for select to authenticated
  using (
    public.can_view_event(event_id)
    or (author_id = auth.uid() and public.is_event_teacher(event_id))
  );

drop policy if exists event_notes_insert on public.event_notes;
create policy event_notes_insert on public.event_notes
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (public.can_note_event(event_id) or public.is_event_teacher(event_id))
  );

-- 家長讀得到「連到自己人物」的老師帳號名稱（回饋作者顯示用）
drop policy if exists profiles_select_teacher on public.profiles;
create policy profiles_select_teacher on public.profiles
  for select to authenticated
  using (exists (
    select 1 from public.contacts c
    where c.teacher_user_id = profiles.id and c.owner_id = auth.uid()
  ));

notify pgrst, 'reload schema';
