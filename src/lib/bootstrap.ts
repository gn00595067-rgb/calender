import "server-only";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_CALENDARS } from "@/lib/constants";

/**
 * 首次登入時確保帳號基礎資料到位：
 *  1. profiles 列（若 DB 觸發器已建立則略過）。
 *  2. 四個預設行事曆（本人／小孩／公事／私事）；被分享當「老師」的人不建。
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

  // 每次進 App 都會跑：四件事互不相依，同時送出（原本依序等，跨區時開頁要多等一秒多）
  const email = (user.email ?? "").toLowerCase();
  const [, { count }, { count: schedulerShares }] = await Promise.all([
    // 1. profile（upsert 幂等）
    supabase.from("profiles").upsert(
      { id: user.id, email: user.email ?? "", display_name: displayName },
      { onConflict: "id" },
    ),
    // 2. 自己的行事曆數（0＝首次登入，要建預設行事曆）
    supabase.from("calendars").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    // 被分享當「老師」的人不建預設行事曆（只用被分享的小孩行事曆，見 0025）
    supabase
      .from("calendar_shares")
      .select("id", { count: "exact", head: true })
      .eq("role", "scheduler")
      .or(`member_id.eq.${user.id},invited_email.eq."${email}"`),
    // 3. 回填受邀分享的 member_id
    user.email
      ? supabase
          .from("calendar_shares")
          .update({ member_id: user.id })
          .eq("invited_email", user.email)
          .is("member_id", null)
      : Promise.resolve(null),
  ]);

  if ((count ?? 0) === 0 && (schedulerShares ?? 0) === 0) {
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
}
