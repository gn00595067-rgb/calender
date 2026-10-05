-- ============================================================
-- 0011_plan_subjects：收費方案可指定「適用小孩」
--   同一位老師、同樣 1 位學生，但不同小孩程度不同收費不同
--   （如鋼琴：妹妹 1000/時、哥哥 667/時）。
--   subject_ids 空陣列＝不限小孩（只依人數挑）。
-- ============================================================

alter table public.contact_rate_plans
  add column if not exists subject_ids uuid[] not null default '{}';
