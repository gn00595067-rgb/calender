-- ============================================================
-- 0033 教室資料庫（Elsa 11/19 需求 5）：小孩在外面上的課每間一張卡
--   （補課規則、課程使用期限、聯絡人／電話／地點、費用、備註）。
--   家長與家庭老師（老師身分分享、家教填報家庭老師、員工帳號）都能看、能填。
-- spec：docs/specs/Elsa需求-多人權限與家庭老師報告.md
-- ============================================================

create or replace function public.can_edit_classrooms(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()
    or public.is_home_teacher_for(p_owner)
    or exists (select 1 from public.contacts c where c.owner_id = p_owner and c.staff_user_id = auth.uid())
    or exists (
      select 1 from public.calendar_shares s
      join public.calendars k on k.id = s.calendar_id
      where k.owner_id = p_owner and s.member_id = auth.uid() and s.role in ('scheduler', 'editor')
    );
$$;
revoke all on function public.can_edit_classrooms(uuid) from public, anon;
grant execute on function public.can_edit_classrooms(uuid) to authenticated;

create table if not exists public.classrooms (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  makeup_rules text not null default '' check (char_length(makeup_rules) <= 2000),
  term_rules   text not null default '' check (char_length(term_rules) <= 2000),
  contact      text not null default '' check (char_length(contact) <= 300),
  address      text not null default '' check (char_length(address) <= 300),
  fee          text not null default '' check (char_length(fee) <= 500),
  note         text not null default '' check (char_length(note) <= 2000),
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists classrooms_owner_idx on public.classrooms (owner_id, name);
alter table public.classrooms enable row level security;

drop policy if exists classrooms_all on public.classrooms;
create policy classrooms_all on public.classrooms
  for all to authenticated
  using (public.can_edit_classrooms(owner_id))
  with check (public.can_edit_classrooms(owner_id));

notify pgrst, 'reload schema';
