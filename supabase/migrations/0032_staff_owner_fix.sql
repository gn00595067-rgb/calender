-- ============================================================
-- 0032 修 0031：員工（家庭老師）讀不到 contacts，policy 裡查人物擁有者會拿到 null，
-- 導致自己的工作紀錄、週報都存不進去。改用 security definer 函式查擁有者。
-- ============================================================

create or replace function public.contact_owner(p_contact uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select owner_id from public.contacts where id = p_contact;
$$;
revoke all on function public.contact_owner(uuid) from public, anon;
grant execute on function public.contact_owner(uuid) to authenticated;

drop policy if exists work_logs_staff_insert on public.work_logs;
create policy work_logs_staff_insert on public.work_logs
  for insert to authenticated
  with check (
    public.is_staff_contact(contact_id)
    and author_id = auth.uid()
    and owner_id = public.contact_owner(contact_id)
  );
drop policy if exists work_logs_staff_update on public.work_logs;
create policy work_logs_staff_update on public.work_logs
  for update to authenticated
  using (public.is_staff_contact(contact_id))
  with check (
    public.is_staff_contact(contact_id)
    and owner_id = public.contact_owner(contact_id)
  );

drop policy if exists weekly_reports_staff on public.weekly_reports;
create policy weekly_reports_staff on public.weekly_reports
  for all to authenticated
  using (public.is_staff_contact(contact_id))
  with check (
    public.is_staff_contact(contact_id)
    and owner_id = public.contact_owner(contact_id)
  );

notify pgrst, 'reload schema';
