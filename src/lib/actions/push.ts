"use server";

import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { pushConfigured, sendPushToUser } from "@/lib/push";

const subSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(300).optional(),
});

/** 這台裝置開啟推播：記下訂閱（同一裝置重複開啟只更新） */
export async function savePushSubscriptionAction(input: unknown): Promise<ActionResult> {
  const parsed = subSchema.safeParse(input);
  if (!parsed.success) return fail("訂閱資料有誤");
  const d = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: d.endpoint,
        p256dh: d.keys.p256dh,
        auth: d.keys.auth,
        user_agent: d.userAgent ?? null,
      },
      { onConflict: "endpoint" },
    );
    if (error) {
      if (/push_subscriptions/.test(error.message) && /exist|schema cache/.test(error.message))
        return fail("資料庫尚未更新（0016_web_push），請通知管理者");
      return fail(error.message);
    }
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 這台裝置關閉推播 */
export async function deletePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  try {
    const { supabase } = await getAuthed();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 送一則測試通知到自己的所有裝置 */
export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  if (!pushConfigured()) return fail("伺服器尚未設定推播金鑰（VAPID），請通知管理者");
  try {
    const { supabase, user } = await getAuthed();
    const sent = await sendPushToUser(supabase, user.id, {
      title: "測試通知",
      body: "看到這則就代表手機提醒設定成功 🎉",
      tag: "test",
    });
    if (sent === 0) return fail("沒有送達任何裝置，請先在這台裝置開啟通知");
    return { ok: true, data: { sent } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
