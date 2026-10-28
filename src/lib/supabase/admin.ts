import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 管理金鑰 client（略過 RLS）：只給伺服器端建立／重設老師帳號用。
 * 呼叫前一定要先用一般 client 確認操作者有權限。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("伺服器缺少 SUPABASE_SERVICE_ROLE_KEY，無法建立老師帳號");
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
