-- ============================================================
-- 0010_monthly_salary：收費方案支援「月薪」
--   1. contact_rate_plans.billing_mode 加 'monthly'（每月固定金額，每堂不另計）
--   2. finance_records.salary_month：這筆是某位老師某月的月薪（yyyy-MM）
-- spec：docs/specs/課程收費方案-1對1與1對2.md（月薪章節）
-- ============================================================

alter table public.contact_rate_plans
  drop constraint if exists contact_rate_plans_billing_mode_check;
alter table public.contact_rate_plans
  add constraint contact_rate_plans_billing_mode_check
  check (billing_mode in ('fixed','hourly','monthly'));

alter table public.finance_records
  add column if not exists salary_month text
    check (salary_month ~ '^\d{4}-\d{2}$');

-- 同一位老師同一個月只記一筆月薪
create unique index if not exists finance_salary_month_uniq
  on public.finance_records (contact_id, salary_month)
  where salary_month is not null;
