-- ============================================================
-- 0006_reminders：行程提醒
--   events.reminder_minutes      ：提前幾分鐘提醒（null＝不提醒）
--   events.reminder_email_sent_at：Email 提醒已寄出時間（避免重複寄）
-- 純新增欄位，不影響現有資料。
-- ============================================================
alter table public.events
  add column reminder_minutes       int,
  add column reminder_email_sent_at timestamptz;
