-- ============================================================
-- 0035 家庭老師（老師身分 scheduler）可以改、刪分享給她的分類裡的「全部」行程
--   原本只能改／刪自己登錄的；Elsa 用 Peggy 帳號 key 的課 Phoenix 刪不掉（11/23）。
--   費用仍只有擁有者／編輯者看得到；老師改課時，家長手動記的費用不會被動（程式端保護）。
-- ============================================================

create or replace function public.can_edit_event(ev uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
    where e.id = ev
      and public.calendar_role(e.calendar_id) in ('owner','editor','scheduler')
  );
$$;

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (public.can_edit_calendar(calendar_id))
  with check (public.can_edit_calendar(calendar_id));

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated
  using (public.can_edit_calendar(calendar_id));

notify pgrst, 'reload schema';
