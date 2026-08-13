-- ============================================================
-- ExecCal 資料庫 Schema
-- 命名 snake_case；時間欄位 timestamptz；RLS 於 0003 啟用。
-- ============================================================

-- gen_random_uuid() 於 Supabase 內建（pgcrypto）
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- profiles：對應 auth.users
-- ------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- calendars：行事曆分類
-- ------------------------------------------------------------
create table public.calendars (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  kind       text not null check (kind in ('self','child','work','private','other')),
  color      text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now()
);
create index calendars_owner_idx on public.calendars (owner_id, position);

-- ------------------------------------------------------------
-- events：行程
-- ------------------------------------------------------------
create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  calendar_id         uuid not null references public.calendars (id) on delete cascade,
  creator_id          uuid not null references public.profiles (id),
  title               text not null,
  description         text,
  location            text,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  all_day             boolean not null default false,
  is_important        boolean not null default false,
  recurrence_rule     text check (recurrence_rule in ('daily','weekly','biweekly','monthly')),
  recurrence_group_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint events_time_valid check (ends_at >= starts_at)
);
create index events_time_idx on public.events (starts_at, ends_at);
create index events_calendar_idx on public.events (calendar_id);
create index events_recurrence_idx on public.events (recurrence_group_id);

-- ------------------------------------------------------------
-- contacts：人物
-- ------------------------------------------------------------
create table public.contacts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  role_label text,
  phone      text,
  note       text
);
create index contacts_owner_idx on public.contacts (owner_id);

create table public.event_contacts (
  event_id   uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  primary key (event_id, contact_id)
);
create index event_contacts_contact_idx on public.event_contacts (contact_id);

-- ------------------------------------------------------------
-- tags：標籤
-- ------------------------------------------------------------
create table public.tags (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name     text not null,
  unique (owner_id, name)
);

create table public.event_tags (
  event_id uuid not null references public.events (id) on delete cascade,
  tag_id   uuid not null references public.tags (id) on delete cascade,
  primary key (event_id, tag_id)
);
create index event_tags_tag_idx on public.event_tags (tag_id);

-- ------------------------------------------------------------
-- finance_records：財務紀錄
-- ------------------------------------------------------------
create table public.finance_records (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  calendar_id    uuid references public.calendars (id) on delete set null,
  event_id       uuid references public.events (id) on delete set null,
  direction      text not null check (direction in ('expense','income')),
  amount         numeric(12,0) not null check (amount >= 0),
  category_label text,
  contact_id     uuid references public.contacts (id) on delete set null,
  occurred_on    date not null,
  is_settled     boolean not null default false,
  note           text,
  created_at     timestamptz not null default now()
);
create index finance_occurred_idx on public.finance_records (occurred_on);
create index finance_calendar_idx on public.finance_records (calendar_id);
create index finance_event_idx on public.finance_records (event_id);
create index finance_owner_idx on public.finance_records (owner_id);

-- ------------------------------------------------------------
-- event_notes：行程回饋／筆記
-- ------------------------------------------------------------
create table public.event_notes (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  content        text not null,
  progress_label text,
  created_at     timestamptz not null default now()
);
create index event_notes_event_idx on public.event_notes (event_id, created_at);

-- ------------------------------------------------------------
-- calendar_shares：行事曆分享
-- ------------------------------------------------------------
create table public.calendar_shares (
  id            uuid primary key default gen_random_uuid(),
  calendar_id   uuid not null references public.calendars (id) on delete cascade,
  invited_email text not null,
  member_id     uuid references public.profiles (id) on delete set null,
  role          text not null check (role in ('editor','contributor','viewer')),
  created_at    timestamptz not null default now(),
  unique (calendar_id, invited_email)
);
create index calendar_shares_member_idx on public.calendar_shares (member_id);
create index calendar_shares_email_idx on public.calendar_shares (lower(invited_email));
