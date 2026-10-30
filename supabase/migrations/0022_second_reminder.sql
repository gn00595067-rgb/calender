-- ============================================================
-- 0022_second_reminder：第二個提醒（Peggy 10/30：預設活動前 2 小時＋1 天前）
--   events.reminder2_minutes      ：再提醒一次，提前幾分鐘（null＝不提醒）
--   events.reminder2_email_sent_at：第二個提醒 Email 已寄出時間
--   events.reminder2_push_sent_at ：第二個提醒推播已送出時間
-- 純新增欄位，不影響現有資料。
-- ============================================================
alter table public.events
  add column if not exists reminder2_minutes       int,
  add column if not exists reminder2_email_sent_at timestamptz,
  add column if not exists reminder2_push_sent_at  timestamptz;
