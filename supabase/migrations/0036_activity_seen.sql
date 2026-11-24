-- ============================================================
-- 0036 未讀更新：記錄每個人上次看「新增紀錄」的時間（跨裝置同步紅點數字）
--   Peggy 11/24：像 LINE 一樣顯示有幾則新的，點進去逐筆看是誰新增／修改／寫回饋。
-- ============================================================
alter table public.profiles add column if not exists activity_seen_at timestamptz;
notify pgrst, 'reload schema';
