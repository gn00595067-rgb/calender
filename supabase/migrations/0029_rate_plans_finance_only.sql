-- ============================================================
-- 0029 收費方案只給看得到金額的人讀
-- 0008 的讀取規則是「看得到這位老師就看得到方案」，家庭老師（分享身分 scheduler）、
-- 檢視者只要行事曆裡有這位老師的課，就能直接查到鐘點費。
-- 改成：擁有者，或在擁有者某個行事曆是 owner／editor（can_view_finance）的人才讀得到。
-- 家庭老師排課要的「1對1／1對2」由伺服器代查（src/lib/scheduler-finance.ts），不需要讀這張表。
-- spec：docs/specs/家庭老師排課自動記費用.md
-- ============================================================

drop policy if exists contact_rate_plans_select on public.contact_rate_plans;
create policy contact_rate_plans_select on public.contact_rate_plans
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.calendars cal
      where cal.owner_id = contact_rate_plans.owner_id
        and public.can_view_finance(cal.id)
    )
  );

notify pgrst, 'reload schema';
