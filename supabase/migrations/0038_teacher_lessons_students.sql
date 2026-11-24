-- ============================================================
-- 0038 老師看到的「課」：主角裡要有上課的學生（is_student；沒設定就用非本人的家人）
--   Jack 11/24 的列表出現「通電話（學生：Peggy姐）」——Peggy 跟老師通電話也被算成課。
-- ============================================================
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
  join public.calendars k on k.id = e.calendar_id
  where e.starts_at < p_to
    and e.ends_at > p_from
    and public.is_event_teacher(e.id)
    and exists (
      select 1 from public.event_contacts s
      join public.contacts sc on sc.id = s.contact_id
      where s.event_id = e.id and s.role = 'subject'
        and (
          sc.is_student
          or (
            not exists (select 1 from public.contacts x where x.owner_id = k.owner_id and x.is_student)
            and sc.is_family and not sc.is_self
          )
        )
    )
  order by e.starts_at;
$$;
revoke all on function public.teacher_lessons(timestamptz, timestamptz) from public, anon;
grant execute on function public.teacher_lessons(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
