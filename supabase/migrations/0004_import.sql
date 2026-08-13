-- ============================================================
-- 匯入支援：來源 UID（去重）與人物 email
-- ============================================================

-- 行程來源識別（Google .ics 的 UID + occurrence 起始），供重複匯入去重
alter table public.events add column if not exists source_uid text;
create index if not exists events_source_uid_idx on public.events (calendar_id, source_uid, starts_at);

-- 人物 email（與會者匯入時用於比對合併）
alter table public.contacts add column if not exists email text;
create index if not exists contacts_email_idx on public.contacts (owner_id, lower(email));
