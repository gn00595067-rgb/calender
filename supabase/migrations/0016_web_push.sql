-- ============================================================
-- 0016_web_push：手機／電腦推播提醒（Web Push）
--   push_subscriptions：每台裝置一筆訂閱（同一人可多台）
--   events.reminder_push_sent_at：推播已送出的旗標（與 Email 分開，互不影響）
-- spec：docs/specs/手機推播提醒.md
-- ============================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- 只能管理自己的裝置；伺服器排程用 service role 讀全部
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.events
  add column if not exists reminder_push_sent_at timestamptz;
