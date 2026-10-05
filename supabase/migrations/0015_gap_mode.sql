-- ============================================================
-- 0015_gap_mode：月曆空檔只列指定的人
--   gap_mode：off＝不顯示（預設）／always＝每天／free_days＝只在沒有固定作息的日子（如小孩假日）
--   is_self ：這位就是本人（老闆），其行程與「未指定主角」合併成同一條「本人」空檔
-- ============================================================

alter table public.contacts
  add column if not exists gap_mode text not null default 'off'
    check (gap_mode in ('off','always','free_days')),
  add column if not exists is_self boolean not null default false;
