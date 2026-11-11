import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * 登入後／打開 App 的第一頁：行事曆主人（人物裡有自己勾「本人」的，如 Peggy）先看週行程表，
 * 其他人（豪哥、家教）照舊看月曆。（Elsa 11/11：Peggy姐開啟第一個頁面要是週行程表）
 */
export async function homePath(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("owner_id", user.id)
    .eq("is_self", true)
    .limit(1);
  // 0015 前沒有 is_self → 照舊月曆
  return !error && data?.length ? "/week-sheet" : "/calendar";
}
