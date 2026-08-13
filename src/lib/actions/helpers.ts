import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function getAuthed(): Promise<{
  supabase: SupabaseClient<Database>;
  user: User;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("尚未登入");
  return { supabase, user };
}

/** 將 Supabase 錯誤訊息轉為使用者可讀的繁中提示 */
export function humanizeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("row-level security") || m.includes("violates row-level"))
    return "你沒有執行此操作的權限";
  if (m.includes("duplicate key") || m.includes("unique constraint"))
    return "資料重複，請檢查是否已存在";
  if (m.includes("foreign key")) return "關聯資料不存在或已被刪除";
  if (m.includes("check constraint")) return "資料未通過檢查（請確認欄位值）";
  return message || "操作失敗，請稍後再試";
}

export function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: humanizeError(message) };
}
