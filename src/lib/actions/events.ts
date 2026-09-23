"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { addDays, addMonths, addWeeks } from "date-fns";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { resolveCategoryId } from "./categories";
import { TIME_ZONE, RECURRENCE_MAX_MONTHS } from "@/lib/constants";

const wall = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, {
  error: "時間格式有誤",
});
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const financeSchema = z.object({
  direction: z.enum(["expense", "income"]),
  amount: z.number().int().nonnegative(),
  categoryLabel: z.string().trim().max(40).optional().nullable(),
  categoryId: z.uuid().optional().nullable(),
  isSettled: z.boolean(),
  paymentMethod: z
    .enum(["monthly", "per_time", "prepaid_deduct", "prepaid_term"])
    .optional()
    .nullable(),
  prepaidAccountId: z.uuid().optional().nullable(),
  /** 這堂由預繳帳戶支付（計次數不重複計支出） */
  coveredByPrepaid: z.boolean().optional().default(false),
});

const baseEventSchema = z.object({
  calendarId: z.uuid(),
  title: z.string().trim().min(1, { error: "請輸入標題" }).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  allDay: z.boolean(),
  startWall: wall,
  endWall: wall,
  isImportant: z.boolean(),
  recurrence: z.enum(["none", "daily", "weekly", "biweekly", "monthly"]),
  recurrenceUntil: dateOnly.optional().nullable(),
  // 「每週」時可指定重複的星期（0=日..6=六）；空／未給則每週同一天。
  weekdays: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  contactIds: z.array(z.uuid()).default([]),
  tagNames: z.array(z.string().trim().min(1).max(30)).default([]),
  finance: financeSchema.optional().nullable(),
});

function toUtc(wallStr: string): string {
  return fromZonedTime(wallStr, TIME_ZONE).toISOString();
}

/** 產生重複日期（台北曆日字串），上限至 recurrenceUntil 或起始日 +6 個月 */
function generateDates(
  startDate: string,
  rule: "daily" | "weekly" | "biweekly" | "monthly",
  until: string | null | undefined,
  weekdays?: number[] | null,
): string[] {
  const anchor = new Date(`${startDate}T12:00:00Z`);
  const hardCap = addMonths(anchor, RECURRENCE_MAX_MONTHS);
  const untilCap = until ? new Date(`${until}T12:00:00Z`) : null;
  const cap =
    untilCap && untilCap < hardCap ? untilCap : hardCap;

  // 每週 + 指定星期（如每週二、四）：逐日掃描，取符合星期者
  if (rule === "weekly" && weekdays && weekdays.length) {
    const set = new Set(weekdays);
    const out: string[] = [];
    let cur = anchor;
    for (let i = 0; i < 400 && cur <= cap; i++) {
      if (set.has(cur.getUTCDay())) out.push(cur.toISOString().slice(0, 10));
      cur = addDays(cur, 1);
    }
    return out;
  }

  const step = (d: Date): Date => {
    switch (rule) {
      case "daily":
        return addDays(d, 1);
      case "weekly":
        return addWeeks(d, 1);
      case "biweekly":
        return addWeeks(d, 2);
      case "monthly":
        return addMonths(d, 1);
    }
  };

  const out: string[] = [];
  let cur = anchor;
  // 安全上限，避免異常輸入產生過多列
  for (let i = 0; i < 400 && cur <= cap; i++) {
    out.push(cur.toISOString().slice(0, 10));
    cur = step(cur);
  }
  return out;
}

/** 找出或建立標籤，回傳 tag id 陣列 */
async function resolveTagIds(
  supabase: Awaited<ReturnType<typeof getAuthed>>["supabase"],
  ownerId: string,
  names: string[],
): Promise<string[]> {
  const uniq = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (uniq.length === 0) return [];

  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .eq("owner_id", ownerId)
    .in("name", uniq);

  const byName = new Map((existing ?? []).map((t) => [t.name, t.id]));
  const toCreate = uniq.filter((n) => !byName.has(n));
  if (toCreate.length) {
    const { data: created } = await supabase
      .from("tags")
      .insert(toCreate.map((name) => ({ owner_id: ownerId, name })))
      .select("id, name");
    for (const t of created ?? []) byName.set(t.name, t.id);
  }
  return uniq.map((n) => byName.get(n)).filter((id): id is string => !!id);
}

export async function createEventAction(input: unknown): Promise<ActionResult<{ groupId: string | null }>> {
  const parsed = baseEventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;

  if (toUtc(d.endWall) < toUtc(d.startWall)) return fail("結束時間不可早於開始時間");

  try {
    const { supabase, user } = await getAuthed();

    const startDate = d.startWall.slice(0, 10);
    const startTime = d.startWall.slice(11);
    const durationMs =
      new Date(toUtc(d.endWall)).getTime() - new Date(toUtc(d.startWall)).getTime();

    // 決定所有 occurrence 的起始日
    let dates =
      d.recurrence === "none"
        ? [startDate]
        : generateDates(startDate, d.recurrence, d.recurrenceUntil, d.weekdays);
    // 保底：任何情況都至少建立起始日這一筆
    if (dates.length === 0) dates = [startDate];

    const groupId =
      d.recurrence === "none" ? null : crypto.randomUUID();

    const rows = dates.map((date) => {
      const startsAt = toUtc(`${date}T${startTime}`);
      const endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
      return {
        calendar_id: d.calendarId,
        creator_id: user.id,
        title: d.title,
        description: d.description ?? null,
        location: d.location ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: d.allDay,
        is_important: d.isImportant,
        recurrence_rule: d.recurrence === "none" ? null : d.recurrence,
        recurrence_group_id: groupId,
      };
    });

    const { data: inserted, error } = await supabase
      .from("events")
      .insert(rows)
      .select("id, starts_at");
    if (error) return fail(error.message);
    const events = inserted ?? [];

    // 標籤（find-or-create）
    const tagIds = await resolveTagIds(supabase, user.id, d.tagNames);

    const ecRows = events.flatMap((e) =>
      d.contactIds.map((cid) => ({ event_id: e.id, contact_id: cid })),
    );
    const etRows = events.flatMap((e) =>
      tagIds.map((tid) => ({ event_id: e.id, tag_id: tid })),
    );
    if (ecRows.length) await supabase.from("event_contacts").insert(ecRows);
    if (etRows.length) await supabase.from("event_tags").insert(etRows);

    // 財務：每個 occurrence 各一筆
    if (d.finance && d.finance.amount > 0) {
      const categoryId =
        d.finance.categoryId ??
        (await resolveCategoryId(supabase, user.id, d.finance.categoryLabel));
      const finRows = events.map((e) => ({
        owner_id: user.id,
        calendar_id: d.calendarId,
        event_id: e.id,
        direction: d.finance!.direction,
        amount: d.finance!.amount,
        category_label: d.finance!.categoryLabel ?? null,
        category_id: categoryId,
        payment_method: d.finance!.paymentMethod ?? null,
        prepaid_account_id: d.finance!.prepaidAccountId ?? null,
        covered_by_prepaid: d.finance!.coveredByPrepaid ?? false,
        contact_id: d.contactIds[0] ?? null,
        // occurred_on 取台北曆日（非 UTC 直接切片，避免凌晨行程日期偏移）
        occurred_on: new Date(e.starts_at)
          .toLocaleString("sv-SE", { timeZone: TIME_ZONE })
          .slice(0, 10),
        is_settled: d.finance!.isSettled,
      }));
      const { error: finErr } = await supabase.from("finance_records").insert(finRows);
      if (finErr) return fail(finErr.message);
    }

    revalidatePath("/", "layout");
    return { ok: true, data: { groupId } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const updateSchema = baseEventSchema
  .omit({ recurrence: true, recurrenceUntil: true, weekdays: true })
  .extend({
    id: z.uuid(),
    scope: z.enum(["this", "following"]),
  });

export async function updateEventAction(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;

  try {
    const { supabase, user } = await getAuthed();

    const { data: current, error: curErr } = await supabase
      .from("events")
      .select("*")
      .eq("id", d.id)
      .single();
    if (curErr || !current) return fail(curErr?.message ?? "找不到行程");

    const newStartUtc = toUtc(d.startWall);
    const newEndUtc = toUtc(d.endWall);
    if (newEndUtc < newStartUtc) return fail("結束時間不可早於開始時間");

    const commonFields = {
      calendar_id: d.calendarId,
      title: d.title,
      description: d.description ?? null,
      location: d.location ?? null,
      all_day: d.allDay,
      is_important: d.isImportant,
    };

    // 目標列：this = 僅此筆；following = 此筆與同群組之後全部
    let targets = [current];
    if (
      d.scope === "following" &&
      current.recurrence_group_id
    ) {
      const { data: later } = await supabase
        .from("events")
        .select("*")
        .eq("recurrence_group_id", current.recurrence_group_id)
        .gte("starts_at", current.starts_at)
        .order("starts_at", { ascending: true });
      if (later && later.length) targets = later;
    }

    const newStartTime = d.startWall.slice(11); // HH:mm
    const durationMs = new Date(newEndUtc).getTime() - new Date(newStartUtc).getTime();

    for (const t of targets) {
      let startsAt = t.starts_at;
      let endsAt = t.ends_at;
      if (d.scope === "this" || t.id === current.id) {
        startsAt = newStartUtc;
        endsAt = newEndUtc;
      } else {
        // 後續各筆：沿用其原本台北日期，套用新的時刻與新時長
        const dateStr = new Date(t.starts_at)
          .toLocaleString("sv-SE", { timeZone: TIME_ZONE })
          .slice(0, 10);
        startsAt = toUtc(`${dateStr}T${newStartTime}`);
        endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
      }
      const { error: upErr } = await supabase
        .from("events")
        .update({ ...commonFields, starts_at: startsAt, ends_at: endsAt })
        .eq("id", t.id);
      if (upErr) return fail(upErr.message);
    }

    // 關聯與財務僅套用於被點擊的該筆（避免批次覆寫語意過重）
    await supabase.from("event_contacts").delete().eq("event_id", current.id);
    await supabase.from("event_tags").delete().eq("event_id", current.id);
    if (d.contactIds.length) {
      await supabase
        .from("event_contacts")
        .insert(d.contactIds.map((cid) => ({ event_id: current.id, contact_id: cid })));
    }
    const tagIds = await resolveTagIds(supabase, user.id, d.tagNames);
    if (tagIds.length) {
      await supabase
        .from("event_tags")
        .insert(tagIds.map((tid) => ({ event_id: current.id, tag_id: tid })));
    }

    // 財務：更新該筆連結的財務（若有提供）
    if (d.finance) {
      const { data: existingFin } = await supabase
        .from("finance_records")
        .select("id")
        .eq("event_id", current.id)
        .limit(1);
      if (d.finance.amount > 0) {
        const categoryId =
          d.finance.categoryId ??
          (await resolveCategoryId(supabase, user.id, d.finance.categoryLabel));
        const finPayload = {
          owner_id: user.id,
          calendar_id: d.calendarId,
          event_id: current.id,
          direction: d.finance.direction,
          amount: d.finance.amount,
          category_label: d.finance.categoryLabel ?? null,
          category_id: categoryId,
          payment_method: d.finance.paymentMethod ?? null,
          prepaid_account_id: d.finance.prepaidAccountId ?? null,
          covered_by_prepaid: d.finance.coveredByPrepaid ?? false,
          contact_id: d.contactIds[0] ?? null,
          occurred_on: new Date(newStartUtc)
            .toLocaleString("sv-SE", { timeZone: TIME_ZONE })
            .slice(0, 10),
          is_settled: d.finance.isSettled,
        };
        if (existingFin && existingFin.length) {
          await supabase.from("finance_records").update(finPayload).eq("id", existingFin[0].id);
        } else {
          await supabase.from("finance_records").insert(finPayload);
        }
      } else if (existingFin && existingFin.length) {
        await supabase.from("finance_records").delete().eq("id", existingFin[0].id);
      }
    }

    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteEventAction(
  id: string,
  scope: "this" | "following",
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    if (scope === "following") {
      const { data: current } = await supabase
        .from("events")
        .select("recurrence_group_id, starts_at")
        .eq("id", id)
        .single();
      if (current?.recurrence_group_id) {
        const { error } = await supabase
          .from("events")
          .delete()
          .eq("recurrence_group_id", current.recurrence_group_id)
          .gte("starts_at", current.starts_at);
        if (error) return fail(error.message);
        revalidatePath("/", "layout");
        return { ok: true, data: undefined };
      }
    }
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
