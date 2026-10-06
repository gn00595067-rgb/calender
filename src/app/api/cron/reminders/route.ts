import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pushConfigured, sendPushToUser } from "@/lib/push";

/**
 * 行程提醒（由排程每分鐘呼叫；Supabase pg_cron，見 docs/specs/手機推播提醒.md）。
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

  const pushed = await sendDuePushes(sb, now, horizon);

  const { data: events, error } = await sb
    .from("events")
    .select("id, title, starts_at, location, reminder_minutes, calendar_id")
    .not("reminder_minutes", "is", null)
    .is("reminder_email_sent_at", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const due = (events ?? []).filter((e) => {
    const start = new Date(e.starts_at).getTime();
    const fireAt = start - (e.reminder_minutes ?? 0) * 60_000;
    return now.getTime() >= fireAt && now.getTime() < start;
  });
  if (due.length === 0) return NextResponse.json({ sent: 0, pushed });

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
        .update({ reminder_email_sent_at: new Date().toISOString() })
        .eq("id", e.id);
      sent++;
    }
  }

  return NextResponse.json({ sent, due: due.length, pushed });
}

/** 提醒時間到了 → 推播給行事曆擁有者的所有裝置（每筆行程只推一次） */
async function sendDuePushes(sb: SupabaseClient, now: Date, horizon: Date): Promise<number> {
  if (!pushConfigured()) return 0;
  const { data: events, error } = await sb
    .from("events")
    .select("id, title, starts_at, location, reminder_minutes, calendar_id")
    .not("reminder_minutes", "is", null)
    .is("reminder_push_sent_at", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString());
  // 0016 尚未套用（沒有 reminder_push_sent_at）→ 先跳過推播，不影響 Email
  if (error) {
    console.error("[cron/reminders] push query", error.message);
    return 0;
  }
  const due = (events ?? []).filter((e) => {
    const start = new Date(e.starts_at).getTime();
    return now.getTime() >= start - (e.reminder_minutes ?? 0) * 60_000;
  });
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
    const mins = Math.max(0, Math.round((start.getTime() - now.getTime()) / 60_000));
    const hhmm = start.toLocaleTimeString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const n = await sendPushToUser(sb, owner, {
      title: e.title,
      body: `${hhmm} 開始（${mins <= 0 ? "即將開始" : `${mins} 分鐘後`}）${e.location ? ` · ${e.location}` : ""}`,
      tag: e.id,
      url: "/calendar",
    });
    // 沒有任何裝置也標記，避免每分鐘重查同一筆；之後才開通知的裝置只收之後的提醒
    await sb.from("events").update({ reminder_push_sent_at: now.toISOString() }).eq("id", e.id);
    pushed += n;
  }
  return pushed;
}
