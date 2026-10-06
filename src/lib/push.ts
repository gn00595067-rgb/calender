import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Web Push 寄送（伺服器端）。金鑰設定在 Vercel 環境變數：
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT（mailto:…）
 * spec：docs/specs/手機推播提醒.md
 */
export interface PushPayload {
  title: string;
  body: string;
  /** 同 tag 只留一則通知（用行程 id） */
  tag?: string;
  url?: string;
}

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  ready = true;
}

/**
 * 推給某人所有裝置；裝置已失效（410/404，例如取消通知、刪掉 App）就順手刪除。
 * 回傳成功送達的裝置數。
 */
export async function sendPushToUser(
  // 排程用 service role、測試用登入者的 client；兩者都只用到 push_subscriptions
  sb: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!pushConfigured()) return 0;
  setup();
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  let ok = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 600 },
      );
      ok++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("[push]", code, err);
      }
    }
  }
  return ok;
}
