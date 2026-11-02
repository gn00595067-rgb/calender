-- ============================================================
-- 0024_tutor_files_schedule：家教填報第二期
--   1. 照片：私有 bucket tutor-files
--        r/<紀錄 id>/<檔名>   上課附件、給家長的話照片（看得到那筆紀錄的人才看得到）
--        s/<家長 id>/<週一>/<檔名>   週課表圖片（家長與家庭老師）
--   2. 家庭老師週課表 tutor_schedule_items
--   3. 課本單元清單 tutor_units（家長維護、老師讀）
--   4. 待辦「已處理」tutor_todo_done（家長）
--   5. 資料庫強制（觸發器）：新增或改了科目／類型時，檢查老師類型與可填科目；
--      照片路徑必須在這筆紀錄自己的資料夾 r/<id>/
-- spec：docs/specs/家教老師填報.md
-- ============================================================

-- ---------- 輔助函式 ----------

-- 我是這位家長的任一位老師
create or replace function public.is_teacher_of(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts c where c.owner_id = p_owner and c.teacher_user_id = auth.uid()
  );
$$;

-- 週課表：家長或家庭老師
create or replace function public.can_edit_tutor_schedule(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid() or public.is_home_teacher_for(p_owner);
$$;

-- 檔案權限：依路徑判斷（格式不對一律不准）
create or replace function public.tutor_file_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  head text := split_part(p_name, '/', 1);
  id text := split_part(p_name, '/', 2);
begin
  if id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if head = 'r' then
    return case when p_write then public.can_comment_tutor_report(id::uuid)
                else public.can_view_tutor_report(id::uuid) end;
  elsif head = 's' then
    return public.can_edit_tutor_schedule(id::uuid);
  end if;
  return false;
end;
$$;

-- ---------- 1. 照片 bucket ----------

-- 前端一律轉成 JPEG 再傳；HEIC 轉不了就請使用者改傳 JPG（電腦瀏覽器看不了 HEIC）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-files', 'tutor-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists tutor_files_select on storage.objects;
create policy tutor_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'tutor-files' and public.tutor_file_access(name, false));

drop policy if exists tutor_files_insert on storage.objects;
create policy tutor_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tutor-files' and public.tutor_file_access(name, true));

drop policy if exists tutor_files_delete on storage.objects;
create policy tutor_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'tutor-files' and public.tutor_file_access(name, true));

-- ---------- 2. 週課表 ----------

create table if not exists public.tutor_schedule_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  item_date   date not null,
  start_time  time not null,
  end_time    time not null,
  title       text not null check (length(title) between 1 and 200),
  responsible text not null default '',
  tag         text not null default '',
  is_exam     boolean not null default false,
  status      text not null default '' check (status in ('', '請假', '停課')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tutor_schedule_owner_date_idx on public.tutor_schedule_items (owner_id, item_date, start_time);
alter table public.tutor_schedule_items enable row level security;

drop policy if exists tutor_schedule_select on public.tutor_schedule_items;
create policy tutor_schedule_select on public.tutor_schedule_items
  for select to authenticated using (public.can_edit_tutor_schedule(owner_id));
drop policy if exists tutor_schedule_insert on public.tutor_schedule_items;
create policy tutor_schedule_insert on public.tutor_schedule_items
  for insert to authenticated
  with check (public.can_edit_tutor_schedule(owner_id) and created_by = auth.uid());
drop policy if exists tutor_schedule_update on public.tutor_schedule_items;
create policy tutor_schedule_update on public.tutor_schedule_items
  for update to authenticated
  using (public.can_edit_tutor_schedule(owner_id))
  with check (public.can_edit_tutor_schedule(owner_id));
drop policy if exists tutor_schedule_delete on public.tutor_schedule_items;
create policy tutor_schedule_delete on public.tutor_schedule_items
  for delete to authenticated using (public.can_edit_tutor_schedule(owner_id));

-- ---------- 3. 課本單元清單 ----------

create table if not exists public.tutor_units (
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  subject    text not null,
  units      text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (owner_id, subject)
);
alter table public.tutor_units enable row level security;

drop policy if exists tutor_units_select on public.tutor_units;
create policy tutor_units_select on public.tutor_units
  for select to authenticated using (owner_id = auth.uid() or public.is_teacher_of(owner_id));
drop policy if exists tutor_units_write on public.tutor_units;
create policy tutor_units_write on public.tutor_units
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- 4. 待辦已處理 ----------

create table if not exists public.tutor_todo_done (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  key      text not null,
  done_at  timestamptz not null default now(),
  primary key (owner_id, key)
);
alter table public.tutor_todo_done enable row level security;
drop policy if exists tutor_todo_done_owner on public.tutor_todo_done;
create policy tutor_todo_done_owner on public.tutor_todo_done
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- 5. 觸發器：類型／科目、照片路徑 ----------
-- 只在新增、或改了科目／類型時檢查科目（家長事後拿掉某科，老師仍能改舊紀錄）；
-- 老師人物沒設類型時，上課紀錄照舊可填（沿用 0023）。錯誤訊息前綴 TUTOR: 給前端翻譯。

create or replace function public.tutor_reports_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
  bad int;
begin
  select ct.name, ct.tutor_kind, ct.tutor_subjects into c
  from public.contacts ct where ct.id = new.teacher_contact_id;
  new.teacher_name := coalesce(c.name, '');

  if tg_op = 'INSERT' or new.kind is distinct from old.kind or new.subject is distinct from old.subject then
    if new.kind = 'daily' and c.tutor_kind is distinct from 'home' then
      raise exception 'TUTOR:每日回報只有家庭老師可以填';
    end if;
    if new.kind = 'lesson' and c.tutor_kind = 'specialist'
       and cardinality(c.tutor_subjects) > 0 and not (new.subject = any (c.tutor_subjects)) then
      raise exception 'TUTOR:「%」不在您可填的科目裡，請通知家長到人物管理設定', new.subject;
    end if;
  end if;

  -- 照片必須在這筆紀錄自己的資料夾
  select count(*) into bad
  from jsonb_array_elements(coalesce(new.content -> 'photos', '[]'::jsonb)) p
  where coalesce(p ->> 'path', '') not like 'r/' || new.id::text || '/%';
  if bad > 0 then
    raise exception 'TUTOR:照片路徑不正確';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.owner_id := old.owner_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- ---------- 權限：輔助函式只給登入者 ----------

revoke all on function public.is_teacher_of(uuid) from public, anon;
revoke all on function public.can_edit_tutor_schedule(uuid) from public, anon;
revoke all on function public.tutor_file_access(text, boolean) from public, anon;
grant execute on function public.is_teacher_of(uuid) to authenticated;
grant execute on function public.can_edit_tutor_schedule(uuid) to authenticated;
grant execute on function public.tutor_file_access(text, boolean) to authenticated;

notify pgrst, 'reload schema';
