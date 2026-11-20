-- ============================================================
-- 0034 人物表不讓看不到費用的人讀到費率、月薪
--   原本：看得到行程的人就讀得到整列人物（含 default_rate 鐘點費、monthly_salary 月薪）。
--   改成：整列只給擁有者與「看得到費用」的人（編輯者）；
--         其他人（家庭老師、協作者、檢視者）用 shared_contacts() 拿不含錢的欄位。
-- Elsa 11/20：Phoenix 帳號要確定看不到任何錢的東西。
-- ============================================================

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.event_contacts ec
      join public.events e on e.id = ec.event_id
      where ec.contact_id = contacts.id
        and public.can_view_finance(e.calendar_id)
    )
  );

-- 不含錢的人物資料：自己的、出現在看得到的行程裡的、分享行事曆給我的人的家人
create or replace function public.shared_contacts(p_ids uuid[] default null)
returns table (
  id uuid, owner_id uuid, name text, role_label text, is_family boolean, is_self boolean,
  aliases text[], rules text, routine jsonb, gap_mode text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.owner_id, c.name, c.role_label, c.is_family, c.is_self,
         c.aliases, c.rules, c.routine, c.gap_mode
  from public.contacts c
  where (p_ids is null or c.id = any(p_ids))
    and (
      c.owner_id = auth.uid()
      or exists (
        select 1 from public.event_contacts ec
        join public.events e on e.id = ec.event_id
        where ec.contact_id = c.id and public.has_calendar_access(e.calendar_id)
      )
      or (c.is_family and exists (
        select 1 from public.calendar_shares s
        join public.calendars k on k.id = s.calendar_id
        where k.owner_id = c.owner_id and s.member_id = auth.uid() and s.role <> 'freebusy'
      ))
    );
$$;
revoke all on function public.shared_contacts(uuid[]) from public, anon;
grant execute on function public.shared_contacts(uuid[]) to authenticated;

notify pgrst, 'reload schema';
