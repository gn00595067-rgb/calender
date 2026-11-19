"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { taipeiWallToUtcISO, fmt } from "@/lib/date";
import { driverFromRow } from "@/lib/driver";
import { travelPadding } from "@/lib/availability";
import { getAuthed, fail, type ActionResult } from "./helpers";

/**
 * 只看空檔的人提議行程、擁有者（Peggy）審核。
 * spec：docs/specs/只看空檔與提議行程審核.md
 */

const MISSING_0030 = "資料庫還沒更新（0030），請先套用 migration";
const missing = (msg: string) => /does not exist|Could not find|schema cache/i.test(msg);

const proposeSchema = z.object({
  id: z.uuid().optional(),
  calendarId: z.uuid(),
  title: z.string().trim().min(1, "請填標題").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().trim().max(200).optional().default(""),
  note: z.string().trim().max(1000).optional().default(""),
});

/** 「11/20(五) 14:00–15:00」 */
function whenLabel(startsAt: string, endsAt: string): string {
  return `${fmt(startsAt, "M/d(EEEEE) HH:mm")}–${fmt(endsAt, "HH:mm")}`;
}

export async function submitProposalAction(input: unknown): Promise<ActionResult<{ notified: boolean }>> {
  const p = proposeSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "資料有誤");
  const v = p.data;
  if (v.end <= v.start) return fail("結束時間要晚於開始時間");
  const startsAt = taipeiWallToUtcISO(`${v.date}T${v.start}`);
  const endsAt = taipeiWallToUtcISO(`${v.date}T${v.end}`);
  if (Date.parse(endsAt) <= Date.now()) return fail("這個時間已經過了");

  try {
    const { supabase, user } = await getAuthed();
    const { data: cal } = await supabase
      .from("calendars")
      .select("id, owner_id, name")
      .eq("id", v.calendarId)
      .maybeSingle();
    if (!cal) return fail("找不到這個分類，或你沒有被分享");

    // 畫面可能過期：送出前再查一次那段時間有沒有被排走（含司機車程）
    const { data: busy, error: busyErr } = await supabase.rpc("busy_blocks", {
      p_from: new Date(Date.parse(startsAt) - 3 * 3600_000).toISOString(),
      p_to: new Date(Date.parse(endsAt) + 3 * 3600_000).toISOString(),
    });
    if (busyErr) return fail(missing(busyErr.message) ? MISSING_0030 : busyErr.message);
    const s = Date.parse(startsAt);
    const e = Date.parse(endsAt);
    const clash = (busy ?? []).find((b) => {
      if (b.all_day) return false;
      const pad = travelPadding({ driver: driverFromRow(b) });
      return Date.parse(b.starts_at) - pad.before * 60000 < e && Date.parse(b.ends_at) + pad.after * 60000 > s;
    });
    if (clash) return fail("這段時間已經有行程了，請重新整理後選別的空檔");

    const fields = {
      calendar_id: v.calendarId,
      title: v.title,
      starts_at: startsAt,
      ends_at: endsAt,
      location: v.location || null,
      note: v.note || null,
    };
    const { error } = v.id
      ? await supabase.from("event_proposals").update(fields).eq("id", v.id).select("id").single()
      : await supabase
          .from("event_proposals")
          .insert({ ...fields, owner_id: cal.owner_id, proposer_id: user.id, status: "pending" })
          .select("id")
          .single();
    if (error) {
      if (missing(error.message)) return fail(MISSING_0030);
      if (/row-level security|0 rows|PGRST116/i.test(error.message + (error.code ?? "")))
        return fail("你沒有權限提議到這個分類，或這筆已經審核過了");
      return fail(error.message);
    }

    // 推播失敗不影響送出（Peggy 打開「待審核」一樣看得到）
    let notified = false;
    try {
      const { data: me } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
      notified =
        (await sendPushToUser(createAdminClient(), cal.owner_id, {
          title: `${me?.display_name || "有人"}${v.id ? "修改了" : "提議"}行程，等你審核`,
          body: `${whenLabel(startsAt, endsAt)}｜${v.title}`,
          tag: `proposal-${v.date}`,
          url: "/proposals",
        })) > 0;
    } catch (err) {
      console.error("[proposal push]", err);
    }
    return { ok: true, data: { notified } };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "操作失敗");
  }
}

/** 提議者撤回自己待審核的 */
export async function withdrawProposalAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("資料有誤");
  try {
    const { supabase } = await getAuthed();
    const { data, error } = await supabase.from("event_proposals").delete().eq("id", id).select("id");
    if (error) return fail(missing(error.message) ? MISSING_0030 : error.message);
    if (!data?.length) return fail("已經審核過的不能撤回");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "操作失敗");
  }
}

/** Peggy 審核：核准（行程已用新增表單存好）或退回 */
export async function reviewProposalAction(input: unknown): Promise<ActionResult> {
  const p = z
    .object({
      id: z.uuid(),
      status: z.enum(["approved", "rejected", "pending"]),
      reviewNote: z.string().trim().max(500).optional().default(""),
    })
    .safeParse(input);
  if (!p.success) return fail("資料有誤");
  const v = p.data;
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("event_proposals")
      .update({
        status: v.status,
        review_note: v.status === "rejected" ? v.reviewNote || null : null,
        reviewed_at: v.status === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", v.id)
      .eq("owner_id", user.id)
      .select("proposer_id, title, starts_at, ends_at")
      .maybeSingle();
    if (error) return fail(missing(error.message) ? MISSING_0030 : error.message);
    if (!data) return fail("找不到這筆提議");

    if (v.status !== "pending") {
      try {
        await sendPushToUser(createAdminClient(), data.proposer_id, {
          title: v.status === "approved" ? "你提議的行程已核准" : "你提議的行程被退回",
          body: `${whenLabel(data.starts_at, data.ends_at)}｜${data.title}${
            v.status === "rejected" && v.reviewNote ? `（${v.reviewNote}）` : ""
          }`,
          tag: `proposal-review-${v.id}`,
          url: "/propose",
        });
      } catch (err) {
        console.error("[proposal review push]", err);
      }
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "操作失敗");
  }
}
