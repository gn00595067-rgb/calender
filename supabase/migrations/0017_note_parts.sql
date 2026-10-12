-- ============================================================
-- 0017_note_parts：學習回饋依小孩拆分
--   1. contacts.aliases：人物別名（英文名等，如 哥哥＝Rick），供 AI 拆分回饋時對應
--   2. note_parts：一則回饋拆出的段落（每個小孩一段；subject_contact_id 為 null＝共同內容）
-- spec：docs/specs/學習回饋-依小孩拆分與統整.md
-- ============================================================

alter table public.contacts
  add column if not exists aliases text[] not null default '{}';

create table if not exists public.note_parts (
  id                 uuid primary key default gen_random_uuid(),
  note_id            uuid not null references public.event_notes (id) on delete cascade,
  subject_contact_id uuid references public.contacts (id) on delete set null,
  content            text not null,
  position           int  not null default 0,
  created_at         timestamptz not null default now()
);
create index if not exists note_parts_note_idx on public.note_parts (note_id, position);
create index if not exists note_parts_subject_idx on public.note_parts (subject_contact_id);

alter table public.note_parts enable row level security;

-- 讀：看得到該回饋的行程即可；寫：只有回饋作者
drop policy if exists note_parts_select on public.note_parts;
create policy note_parts_select on public.note_parts
  for select to authenticated
  using (exists (
    select 1 from public.event_notes n
    where n.id = note_id and public.can_view_event(n.event_id)
  ));

drop policy if exists note_parts_insert on public.note_parts;
create policy note_parts_insert on public.note_parts
  for insert to authenticated
  with check (exists (
    select 1 from public.event_notes n
    where n.id = note_id and n.author_id = auth.uid()
  ));

drop policy if exists note_parts_delete on public.note_parts;
create policy note_parts_delete on public.note_parts
  for delete to authenticated
  using (exists (
    select 1 from public.event_notes n
    where n.id = note_id and n.author_id = auth.uid()
  ));
