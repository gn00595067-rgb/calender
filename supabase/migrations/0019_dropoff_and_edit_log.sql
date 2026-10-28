-- ============================================================
-- 0019_dropoff_and_edit_log
--   1. 回程送到哪（空白＝家）：從公司出發的行程，回程要回家不是回公司（回饋 #14）
--   2. 修改紀錄：誰、什麼時候按過「編輯→儲存」（回饋 10-2）
--      不用 updated_at：提醒排程標記已寄送也會更新它，分不出是人改的
-- ============================================================

alter table public.events
  add column if not exists driver_dropoff_location text,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references public.profiles (id) on delete set null;

create index if not exists events_edited_at_idx
  on public.events (edited_at desc)
  where edited_at is not null;

-- 讓 API 立刻認得新欄位
notify pgrst, 'reload schema';
