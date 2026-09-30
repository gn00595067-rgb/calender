-- ============================================================
-- 0007_contact_roles：人物拆成「主角×相關人物」
--   1. event_contacts 加 role（subject＝誰的行程／participant＝拜訪/參與/對象）
--   2. contacts 加 is_family（可當主角的家人/本人，用來分區選單）
-- 向下相容：既有關聯一律視為 participant（老師/客戶等），免 backfill。
-- ============================================================

alter table public.event_contacts
  add column role text not null default 'participant'
    check (role in ('subject', 'participant'));

-- 依角色查詢用（例：某事件的主角、某人當主角的所有行程）
create index event_contacts_role_idx
  on public.event_contacts (contact_id, role);

alter table public.contacts
  add column is_family boolean not null default false;
