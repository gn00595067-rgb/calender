-- ============================================================
-- 0013_plan_extra_fee：收費方案「每次加收」（如交通費 100）
--   每堂金額＝方案金額＋加收；財務存快照，明細可顯示「含交通費 100」。
-- ============================================================

alter table public.contact_rate_plans
  add column if not exists extra_fee   int  not null default 0 check (extra_fee >= 0),
  add column if not exists extra_label text;

alter table public.finance_records
  add column if not exists extra_fee   int check (extra_fee >= 0),
  add column if not exists extra_label text;
