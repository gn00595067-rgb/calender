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
  if (!error && data?.length) return "/week-sheet";
  // 只有「只看空檔」身分（秘書）：沒有自己的分類、也沒有其他分享 → 直接進幫排行程（0030）
  const [{ count: own }, { data: shares }] = await Promise.all([
    supabase.from("calendars").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("calendar_shares").select("role").eq("member_id", user.id),
  ]);
  const roles = (shares ?? []).map((s) => s.role);
  if (!own && roles.length > 0 && roles.every((r) => r === "freebusy")) return "/propose";
  return "/calendar";
}
