-- ============================================================
-- Row Level Security
-- 每張表逐一啟用 RLS，SELECT/INSERT/UPDATE/DELETE 各自撰寫 policy。
-- 安全邊界在此；前端隱藏僅為 UX。
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.calendars       enable row level security;
alter table public.events          enable row level security;
alter table public.contacts        enable row level security;
alter table public.event_contacts  enable row level security;
alter table public.tags            enable row level security;
alter table public.event_tags      enable row level security;
alter table public.finance_records enable row level security;
alter table public.event_notes     enable row level security;
alter table public.calendar_shares enable row level security;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_any_calendar(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- calendars
-- ------------------------------------------------------------
create policy calendars_select on public.calendars
  for select to authenticated
  using (public.has_calendar_access(id));

create policy calendars_insert on public.calendars
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy calendars_update on public.calendars
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy calendars_delete on public.calendars
  for delete to authenticated
  using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- events
-- ------------------------------------------------------------
create policy events_select on public.events
  for select to authenticated
  using (public.has_calendar_access(calendar_id));

create policy events_insert on public.events
  for insert to authenticated
  with check (public.can_edit_calendar(calendar_id) and creator_id = auth.uid());

create policy events_update on public.events
  for update to authenticated
  using (public.can_edit_calendar(calendar_id))
  with check (public.can_edit_calendar(calendar_id));

create policy events_delete on public.events
  for delete to authenticated
  using (public.can_edit_calendar(calendar_id));

-- ------------------------------------------------------------
-- contacts（擁有者可寫；被連結到可存取行程者可讀）
-- ------------------------------------------------------------
create policy contacts_select on public.contacts
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.event_contacts ec
      join public.events e on e.id = ec.event_id
      where ec.contact_id = contacts.id
        and public.has_calendar_access(e.calendar_id)
    )
  );

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy contacts_update on public.contacts
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy contacts_delete on public.contacts
  for delete to authenticated
  using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- event_contacts
-- ------------------------------------------------------------
create policy event_contacts_select on public.event_contacts
  for select to authenticated
  using (public.can_view_event(event_id));

create policy event_contacts_insert on public.event_contacts
  for insert to authenticated
  with check (public.can_edit_event(event_id));

create policy event_contacts_delete on public.event_contacts
  for delete to authenticated
  using (public.can_edit_event(event_id));

-- ------------------------------------------------------------
-- tags
-- ------------------------------------------------------------
create policy tags_select on public.tags
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.event_tags et
      join public.events e on e.id = et.event_id
      where et.tag_id = tags.id
        and public.has_calendar_access(e.calendar_id)
    )
  );

create policy tags_insert on public.tags
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy tags_update on public.tags
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy tags_delete on public.tags
  for delete to authenticated
  using (owner_id = auth.uid());

-- ------------------------------------------------------------
-- event_tags
-- ------------------------------------------------------------
create policy event_tags_select on public.event_tags
  for select to authenticated
  using (public.can_view_event(event_id));

create policy event_tags_insert on public.event_tags
  for insert to authenticated
  with check (public.can_edit_event(event_id));

create policy event_tags_delete on public.event_tags
  for delete to authenticated
  using (public.can_edit_event(event_id));

-- ------------------------------------------------------------
-- finance_records（僅 owner 與該行事曆 editor 可見／可寫）
-- ------------------------------------------------------------
create policy finance_select on public.finance_records
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (calendar_id is not null and public.can_view_finance(calendar_id))
  );

create policy finance_insert on public.finance_records
  for insert to authenticated
  with check (
    (calendar_id is not null and public.can_view_finance(calendar_id))
    or (calendar_id is null and owner_id = auth.uid())
  );

create policy finance_update on public.finance_records
  for update to authenticated
  using (
    owner_id = auth.uid()
    or (calendar_id is not null and public.can_view_finance(calendar_id))
  )
  with check (
    owner_id = auth.uid()
    or (calendar_id is not null and public.can_view_finance(calendar_id))
  );

create policy finance_delete on public.finance_records
  for delete to authenticated
  using (
    owner_id = auth.uid()
    or (calendar_id is not null and public.can_view_finance(calendar_id))
  );

-- ------------------------------------------------------------
-- event_notes（可存取行程者可讀；contributor 以上可新增；作者可改／刪自己）
-- ------------------------------------------------------------
create policy event_notes_select on public.event_notes
  for select to authenticated
  using (public.can_view_event(event_id));

create policy event_notes_insert on public.event_notes
  for insert to authenticated
  with check (public.can_note_event(event_id) and author_id = auth.uid());

create policy event_notes_update on public.event_notes
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy event_notes_delete on public.event_notes
  for delete to authenticated
  using (author_id = auth.uid());

-- ------------------------------------------------------------
-- calendar_shares（owner 管理；受邀者可讀自己的邀請並認領 member_id）
-- ------------------------------------------------------------
create policy calendar_shares_select on public.calendar_shares
  for select to authenticated
  using (
    public.is_calendar_owner(calendar_id)
    or member_id = auth.uid()
    or lower(invited_email) = public.auth_email()
  );

create policy calendar_shares_insert on public.calendar_shares
  for insert to authenticated
  with check (public.is_calendar_owner(calendar_id));

-- owner 變更角色
create policy calendar_shares_update_owner on public.calendar_shares
  for update to authenticated
  using (public.is_calendar_owner(calendar_id))
  with check (public.is_calendar_owner(calendar_id));

-- 受邀者首次登入認領（member_id 由 null 設為自己）
create policy calendar_shares_claim on public.calendar_shares
  for update to authenticated
  using (member_id is null and lower(invited_email) = public.auth_email())
  with check (member_id = auth.uid());

create policy calendar_shares_delete on public.calendar_shares
  for delete to authenticated
  using (public.is_calendar_owner(calendar_id));
