import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CALENDARS } from "@/lib/constants";

/**
 * 首次登入時確保帳號基礎資料到位：
 *  1. profiles 列（若 DB 觸發器已建立則略過）。
 *  2. 四個預設行事曆（本人／小孩／公事／私事）。
 *  3. 回填 calendar_shares.member_id（以 email 比對受邀者）。
 *
 * 具備幂等性，可在每次進入 App 時安全呼叫。
 */
export async function ensureBootstrap(user: User): Promise<void> {
  const supabase = await createClient();
  const displayName =
    (user.user_metadata?.display_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "使用者";

  // 1. profile（upsert 幂等）
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      display_name: displayName,
    },
    { onConflict: "id" },
  );

  // 2. 預設行事曆（僅在完全沒有自己的行事曆時建立）
  const { count } = await supabase
    .from("calendars")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);

  if ((count ?? 0) === 0) {
    await supabase.from("calendars").insert(
      DEFAULT_CALENDARS.map((c) => ({
        owner_id: user.id,
        name: c.name,
        kind: c.kind,
        color: c.color,
        position: c.position,
      })),
    );
  }

  // 3. 回填受邀分享的 member_id
  if (user.email) {
    await supabase
      .from("calendar_shares")
      .update({ member_id: user.id })
      .eq("invited_email", user.email)
      .is("member_id", null);
  }
}
