-- ============================================================
-- 0014_contact_routine：人物「固定作息」（不算空檔）
--   例：小孩平日上學 [{label:"上學", days:[1,2,3,4,5], start:"08:00", end:"16:00", enabled:true}]
--   days 為 JS getDay（0=日..6=六）；enabled=false 可在寒暑假暫停。
-- ============================================================

alter table public.contacts
  add column if not exists routine jsonb not null default '[]'::jsonb;
