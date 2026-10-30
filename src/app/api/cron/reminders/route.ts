import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pushConfigured, sendPushToUser } from "@/lib/push";

/**
 * 行程提醒（由排程每分鐘呼叫；Supabase pg_cron，見 docs/specs/手機推播提醒.md）。
 * 每筆行程有兩個提醒（reminder_minutes、0022 的 reminder2_minutes），各自獨立送。
 * 找出「提醒時間已到、尚未送出」的行程：
 *   1) 推播到行事曆擁有者的手機／電腦（Web Push），標記 reminder_push_sent_at；
 *   2) 寄 Email 給擁有者，標記 reminder_email_sent_at。
 *
 * 需要的環境變數（Vercel）：
 *   CRON_SECRET               ：呼叫此端點的密鑰（Header: Authorization: Bearer <secret> 或 ?secret=）
 *   SUPABASE_SERVICE_ROLE_KEY ：Supabase service role（已有）
 *   NEXT_PUBLIC_SUPABASE_URL  ：Supabase 專案網址（已有）
 *   RESEND_API_KEY            ：Resend 寄信金鑰
 *   REMINDER_FROM_EMAIL       ：寄件者（預設 onboarding@resend.dev；正式建議用已驗證網域）
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT：推播金鑰
 */
export const dynamic = "force-dynamic";

/** 一個提醒的欄位組：提前幾分鐘、推播已送、Email 已寄 */
const SLOTS = [
  { min: "reminder_minutes", push: "reminder_push_sent_at", email: "reminder_email_sent_at" },
  { min: "reminder2_minutes", push: "reminder2_push_sent_at", email: "reminder2_email_sent_at" },
] as const;
type Slot = (typeof SLOTS)[number];

type DueRow = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  calendar_id: string;
  minutes: number;
};

/** 查某個提醒「時間到了、還沒送」的行程；欄位不存在（0022 未套用）回空 */
async function dueFor(
  sb: SupabaseClient,
  slot: Slot,
  sentCol: string,
  now: Date,
  horizon: Date,
): Promise<DueRow[] | { error: string }> {
  const { data, error } = await sb
    .from("events")
    .select(`id, title, starts_at, location, calendar_id, ${slot.min}`)
    .not(slot.min, "is", null)
    .is(sentCol, null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString());
  if (error) return { error: error.message };
  const rows = ((data ?? []) as unknown as Record<string, unknown>[])
    .map((e) => ({
      id: e.id as string,
      title: e.title as string,
      starts_at: e.starts_at as string,
      location: (e.location as string | null) ?? null,
      calendar_id: e.calendar_id as string,
      minutes: Number(e[slot.min] ?? 0),
    }))
    .filter((e) => now.getTime() >= new Date(e.starts_at).getTime() - e.minutes * 60_000);
  if (slot === SLOTS[0]) return rows;
  // 再提醒一次：時間早就過了（例如晚上的行程下午才建，「1 天前」已過）→ 不補送，直接標記，
  // 避免跟第一個提醒重複
  const stale = rows.filter(
    (e) => now.getTime() - (new Date(e.starts_at).getTime() - e.minutes * 60_000) > 60 * 60_000,
  );
  if (stale.length) {
    await sb.from("events").update({ [sentCol]: now.toISOString() }).in("id", stale.map((e) => e.id));
  }
  return rows.filter((e) => !stale.includes(e));
}

/** 距離開始多久：「35 分鐘後」「約 2 小時後」「明天」 */
function untilText(start: Date, now: Date): string {
  const mins = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
  if (mins <= 0) return "即將開始";
  if (mins < 60) return `${mins} 分鐘後`;
  if (mins < 20 * 60) return `約 ${Math.round(mins / 60)} 小時後`;
  return "明天";
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const qp = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && qp !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    // 只列缺少的變數名稱（不含值），方便排查 Vercel 設定
    const missing = [
      !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
      !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    return NextResponse.json({ error: "supabase not configured", missing }, { status: 500 });
  }
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL || "ExecCal <onboarding@resend.dev>";

  const sb = createClient(supabaseUrl, serviceKey);
  const now = new Date();
  const horizon = new Date(now.getTime() + 25 * 3600 * 1000);

  let pushed = 0;
  let sent = 0;
  let dueCount = 0;
  for (const slot of SLOTS) {
    pushed += await sendDuePushes(sb, slot, now, horizon);
    const due = await dueFor(sb, slot, slot.email, now, horizon);
    if ("error" in due) {
      // 第一個提醒查詢失敗才是真錯；第二個多半是 0022 還沒套用
      if (slot === SLOTS[0]) return NextResponse.json({ error: due.error }, { status: 500 });
      continue;
    }
    dueCount += due.length;
    sent += await sendDueEmails(sb, slot, due, resendKey, from);
  }
  return NextResponse.json({ sent, due: dueCount, pushed });
}

/** 寄 Email 給行事曆擁有者，成功才標記已寄 */
async function sendDueEmails(
  sb: SupabaseClient,
  slot: Slot,
  due: DueRow[],
  resendKey: string | undefined,
  from: string,
): Promise<number> {
  if (due.length === 0) return 0;

  // 擁有者 Email：calendars.owner_id → profiles.email
  const calIds = [...new Set(due.map((e) => e.calendar_id))];
  const { data: cals } = await sb
    .from("calendars")
    .select("id, owner_id")
    .in("id", calIds);
  const ownerByCal = new Map((cals ?? []).map((c) => [c.id, c.owner_id]));
  const ownerIds = [...new Set([...ownerByCal.values()])];
  const { data: profs } = await sb
    .from("profiles")
    .select("id, email")
    .in("id", ownerIds);
  const emailByOwner = new Map((profs ?? []).map((p) => [p.id, p.email]));

  let sent = 0;
  for (const e of due) {
    const owner = ownerByCal.get(e.calendar_id);
    const to = owner ? emailByOwner.get(owner) : null;

    // 未設定寄信服務或找不到收件者 → 不標記，待設定好後再寄
    if (!to || !resendKey) continue;

    const start = new Date(e.starts_at);
    const timeStr = start.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: `⏰ 提醒：${e.title}`,
        html: `<p>你的行程即將開始：</p><p style="font-size:16px"><b>${e.title}</b><br/>${timeStr}${
          e.location ? ` · ${e.location}` : ""
        }</p><p style="color:#888;font-size:12px">— ExecCal 行事曆</p>`,
      }),
    }).catch(() => null);

    if (res && res.ok) {
      await sb
        .from("events")
        .update({ [slot.email]: new Date().toISOString() })
        .eq("id", e.id);
      sent++;
    }
  }

  return sent;
}

/** 提醒時間到了 → 推播給行事曆擁有者的所有裝置（每筆行程只推一次） */
async function sendDuePushes(
  sb: SupabaseClient,
  slot: Slot,
  now: Date,
  horizon: Date,
): Promise<number> {
  if (!pushConfigured()) return 0;
  const due = await dueFor(sb, slot, slot.push, now, horizon);
  // 0016／0022 尚未套用（缺欄位）→ 先跳過推播，不影響 Email
  if ("error" in due) {
    console.error("[cron/reminders] push query", slot.min, due.error);
    return 0;
  }
  if (due.length === 0) return 0;

  const { data: cals } = await sb
    .from("calendars")
    .select("id, owner_id")
    .in("id", [...new Set(due.map((e) => e.calendar_id))]);
  const ownerByCal = new Map((cals ?? []).map((c) => [c.id, c.owner_id as string]));

  let pushed = 0;
  for (const e of due) {
    const owner = ownerByCal.get(e.calendar_id);
    if (!owner) continue;
    const start = new Date(e.starts_at);
    const hhmm = start.toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const n = await sendPushToUser(sb, owner, {
      title: e.title,
      body: `${hhmm} 開始（${untilText(start, now)}）${e.location ? ` · ${e.location}` : ""}`,
      // 兩個提醒用不同 tag，第二則才不會蓋掉第一則
      tag: `${e.id}:${slot.min}`,
      url: "/calendar",
    });
    // 沒有任何裝置也標記，避免每分鐘重查同一筆；之後才開通知的裝置只收之後的提醒
    await sb.from("events").update({ [slot.push]: now.toISOString() }).eq("id", e.id);
    pushed += n;
  }
  return pushed;
}
