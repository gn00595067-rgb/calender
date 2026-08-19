/**
 * 是否已設定 Supabase 連線環境變數。
 *
 * 注意：`NEXT_PUBLIC_*` 於「建置當下」被寫死進 bundle，之後不會再讀取執行環境。
 * 因此在雲端（如 Vercel）新增變數後，務必觸發一次「不使用 build cache」的重新建置，
 * 舊的建置快取可能仍保留變數尚未設定時的空值。
 */
export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
