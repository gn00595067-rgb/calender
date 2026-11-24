-- ============================================================
-- 0037 家長（擁有者／編輯者）也能把別人寫的回饋依小孩拆開
--   原本只有回饋作者能拆；Phoenix 11/22 的回饋沒拆到，Peggy 看到「未依小孩拆開」卻無法處理（11/24）。
-- ============================================================
drop policy if exists note_parts_insert on public.note_parts;
create policy note_parts_insert on public.note_parts
  for insert to authenticated
  with check (exists (
    select 1 from public.event_notes n
    join public.events e on e.id = n.event_id
    where n.id = note_id
      and (n.author_id = auth.uid() or public.can_view_finance(e.calendar_id))
  ));

drop policy if exists note_parts_delete on public.note_parts;
create policy note_parts_delete on public.note_parts
  for delete to authenticated
  using (exists (
    select 1 from public.event_notes n
    join public.events e on e.id = n.event_id
    where n.id = note_id
      and (n.author_id = auth.uid() or public.can_view_finance(e.calendar_id))
  ));

notify pgrst, 'reload schema';
