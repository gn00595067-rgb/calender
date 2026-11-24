-- ============================================================
-- 0039 成績登記（各科儀表板用；使用者 11/24：成績先由老師或家庭老師填，主要給家長、家庭老師看）
--   家長、家庭老師（老師身分分享／員工帳號／家教填報的家庭老師）：全部可看、可登記、可改刪
--   老師帳號（Jack 等）：可登記，只看得到、改得到自己登記的
-- ============================================================

-- 可以管理這位家長的成績（家長本人、家庭老師）
create or replace function public.can_manage_scores(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()
    or public.is_home_teacher_for(p_owner)
    or exists (select 1 from public.contacts c where c.owner_id = p_owner and c.staff_user_id = auth.uid())
    or exists (
      select 1 from public.calendar_shares s
      join public.calendars k on k.id = s.calendar_id
      where k.owner_id = p_owner and s.member_id = auth.uid() and s.role in ('editor', 'scheduler')
    );
$$;
revoke all on function public.can_manage_scores(uuid) from public, anon;
grant execute on function public.can_manage_scores(uuid) to authenticated;

create table if not exists public.student_scores (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  student_id  uuid not null references public.contacts (id) on delete cascade,
  subject     text not null check (char_length(subject) between 1 and 40),
  test_date   date not null,
  label       text not null default '' check (char_length(label) <= 60),
  score       numeric(6, 1) not null check (score >= 0),
  full_score  numeric(6, 1) not null default 100 check (full_score > 0),
  note        text not null default '' check (char_length(note) <= 500),
  author_id   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists student_scores_owner_idx on public.student_scores (owner_id, student_id, test_date);
alter table public.student_scores enable row level security;

-- 學生必須是這位家長的人物
create or replace function public.score_student_ok(p_owner uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contacts c where c.id = p_student and c.owner_id = p_owner);
$$;

drop policy if exists student_scores_select on public.student_scores;
create policy student_scores_select on public.student_scores
  for select to authenticated
  using (public.can_manage_scores(owner_id) or author_id = auth.uid());

drop policy if exists student_scores_insert on public.student_scores;
create policy student_scores_insert on public.student_scores
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.score_student_ok(owner_id, student_id)
    and (public.can_manage_scores(owner_id) or public.is_teacher_of(owner_id))
  );

drop policy if exists student_scores_update on public.student_scores;
create policy student_scores_update on public.student_scores
  for update to authenticated
  using (public.can_manage_scores(owner_id) or (author_id = auth.uid() and public.is_teacher_of(owner_id)))
  with check (public.score_student_ok(owner_id, student_id)
    and (public.can_manage_scores(owner_id) or (author_id = auth.uid() and public.is_teacher_of(owner_id))));

drop policy if exists student_scores_delete on public.student_scores;
create policy student_scores_delete on public.student_scores
  for delete to authenticated
  using (public.can_manage_scores(owner_id) or (author_id = auth.uid() and public.is_teacher_of(owner_id)));

notify pgrst, 'reload schema';
