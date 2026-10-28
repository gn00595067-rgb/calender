-- ============================================================
-- 0020_contact_event_defaults：人物的「排行程預設」（回饋 23）
--   新增行程選到此人（老師）→ 自動帶入分類與標籤；分類不同時提醒。
--   費用類別沿用既有 contacts.default_category_id。
-- ============================================================

alter table public.contacts
  add column if not exists default_calendar_id uuid
    references public.calendars (id) on delete set null,
  add column if not exists default_tag_names text[] not null default '{}';

notify pgrst, 'reload schema';
