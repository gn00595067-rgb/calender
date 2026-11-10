-- ============================================================
-- 0026 使用習慣：使用者自己寫的習慣（例：做臉 2 小時），語音新增時交給 AI 優先採用
-- spec：docs/specs/測試回饋第四輪-月曆連續捲動與語音人名.md §三
-- profiles 的 update policy 已限本人（0003），不用另加。
-- ============================================================
alter table public.profiles add column if not exists habits_text text;

notify pgrst, 'reload schema';
