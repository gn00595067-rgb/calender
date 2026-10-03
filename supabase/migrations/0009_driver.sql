-- ============================================================
-- 0009_driver：行程司機接送
--   events 加：需要司機、接送方式、去程提早分鐘、上車地點、給司機備註
-- spec：docs/specs/司機接送.md
-- ============================================================

alter table public.events
  add column if not exists needs_driver           boolean not null default false,
  add column if not exists driver_trip            text
    check (driver_trip in ('to','from','round')),
  add column if not exists driver_pickup_minutes  int
    check (driver_pickup_minutes >= 0),
  add column if not exists driver_pickup_location text,
  add column if not exists driver_note            text;

-- 司機時間表：查某區間需要司機的行程
create index if not exists events_needs_driver_idx
  on public.events (starts_at)
  where needs_driver;
