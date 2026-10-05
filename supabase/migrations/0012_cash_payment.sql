-- ============================================================
-- 0012_cash_payment：付款方式新增「每次付現」(per_time_cash)
--   原本「每次」只有 LINE Pay；有些老師是當次付現金。
-- ============================================================

alter table public.contacts
  drop constraint if exists contacts_default_payment_method_check;
alter table public.contacts
  add constraint contacts_default_payment_method_check
  check (default_payment_method in ('monthly','per_time','per_time_cash','prepaid_deduct','prepaid_term'));

alter table public.finance_records
  drop constraint if exists finance_records_payment_method_check;
alter table public.finance_records
  add constraint finance_records_payment_method_check
  check (payment_method in ('monthly','per_time','per_time_cash','prepaid_deduct','prepaid_term'));
