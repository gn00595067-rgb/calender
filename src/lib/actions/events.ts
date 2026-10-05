"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { addDays, addMonths, addWeeks } from "date-fns";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { resolveCategoryId } from "./categories";
import { TIME_ZONE, RECURRENCE_MAX_MONTHS } from "@/lib/constants";
import { tagKey } from "@/lib/tags";

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
    .enum(["monthly", "per_time", "per_time_cash", "prepaid_deduct", "prepaid_term"])
    .optional()
    .nullable(),
  prepaidAccountId: z.uuid().optional().nullable(),
  /** 這堂由預繳帳戶支付（計次數不重複計支出） */
  coveredByPrepaid: z.boolean().optional().default(false),
  /** 收費對象（有收費方案的老師）；未給則取第一位相關人物 */
  contactId: z.uuid().optional().nullable(),
  /** 收費方案快照（1對1／1對2…）；未用方案則全為 null */
  ratePlanId: z.uuid().optional().nullable(),
  lessonLabel: z.string().trim().max(30).optional().nullable(),
  headcount: z.number().int().min(1).max(30).optional().nullable(),
  learnerCount: z.number().int().min(1).max(30).optional().nullable(),
  /** 這堂含的加收（如交通費）快照 */
  extraFee: z.number().int().nonnegative().optional().nullable(),
  extraLabel: z.string().trim().max(20).optional().nullable(),
  /** 月薪制老師的課：金額 0 仍記一筆（計堂數），錢在月底的月薪紀錄 */
  salaried: z.boolean().optional().default(false),
});

type FinanceInput = z.infer<typeof financeSchema>;

/** 收費方案快照欄位（0008 migration 新增） */
function planSnapshot(f: FinanceInput) {
  return {
    rate_plan_id: f.ratePlanId ?? null,
    lesson_label: f.lessonLabel ?? null,
    headcount: f.headcount ?? null,
    learner_count: f.learnerCount ?? null,
    extra_fee: f.extraFee || null,
    extra_label: f.extraFee ? f.extraLabel ?? null : null,
  };
}

const SNAPSHOT_KEYS = [
  "rate_plan_id",
  "lesson_label",
  "headcount",
  "learner_count",
  "extra_fee",
  "extra_label",
] as const;

/** 查無欄位（migration 尚未套用到此庫）的錯誤；預設檢查 0008 方案快照欄位 */
function isMissingColumn(
  err: { code?: string; message?: string } | null,
  keys: readonly string[] = SNAPSHOT_KEYS,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    keys.some((k) => err.message?.includes(k))
  );
}

function withoutSnapshot<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const k of SNAPSHOT_KEYS) delete copy[k];
  return copy as T;
}

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
  // 提前幾分鐘提醒（null＝不提醒）
  reminderMinutes: z.number().int().min(0).max(43200).optional().nullable(),
  // 主角（誰的行程）與相關人物（拜訪／參與／對象）
  subjectIds: z.array(z.uuid()).default([]),
  participantIds: z.array(z.uuid()).default([]),
  tagNames: z.array(z.string().trim().min(1).max(30)).default([]),
  finance: financeSchema.optional().nullable(),
  // 司機接送；null＝不需要司機
  driver: z
    .object({
      trip: z.enum(["to", "from", "round"]),
      pickupMinutes: z.number().int().min(0).max(600),
      pickupLocation: z.string().trim().max(200).optional().nullable(),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .nullable(),
});

/** 司機接送 → events 欄位（0009 migration 新增） */
function driverColumns(drv: z.infer<typeof baseEventSchema>["driver"]) {
  return {
    needs_driver: !!drv,
    driver_trip: drv?.trip ?? null,
    driver_pickup_minutes: drv?.pickupMinutes ?? null,
    driver_pickup_location: drv?.pickupLocation || null,
    driver_note: drv?.note || null,
  };
}

const DRIVER_KEYS = [
  "needs_driver",
  "driver_trip",
  "driver_pickup_minutes",
  "driver_pickup_location",
  "driver_note",
] as const;

function withoutDriver<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const k of DRIVER_KEYS) delete copy[k];
  return copy as T;
}

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
  // 依正規化 key 去重（大小寫/全半形/空白差異視為同一），保留第一個顯示寫法
  const inputByKey = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = tagKey(name);
    if (key && !inputByKey.has(key)) inputByKey.set(key, name);
  }
  if (inputByKey.size === 0) return [];

  // 撈該擁有者所有標籤，以 key 比對既有者（防呆：變體歸到既有，不新建）
  const { data: existing } = await supabase
    .from("tags")
    .select("id, name")
    .eq("owner_id", ownerId);
  const idByKey = new Map<string, string>();
  for (const t of existing ?? []) idByKey.set(tagKey(t.name), t.id);

  const toCreate = [...inputByKey].filter(([key]) => !idByKey.has(key)).map(([, name]) => name);
  if (toCreate.length) {
    const { data: created } = await supabase
      .from("tags")
      .insert(toCreate.map((name) => ({ owner_id: ownerId, name })))
      .select("id, name");
    for (const t of created ?? []) idByKey.set(tagKey(t.name), t.id);
  }
  return [...inputByKey.keys()]
    .map((key) => idByKey.get(key))
    .filter((id): id is string => !!id);
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
        reminder_minutes: d.reminderMinutes ?? null,
        ...driverColumns(d.driver),
      };
    });

    let { data: inserted, error } = await supabase
      .from("events")
      .insert(rows)
      .select("id, starts_at");
    // 線上庫還沒套 0009：去掉司機欄位再存，行程本身不能因此存不進去
    if (isMissingColumn(error, DRIVER_KEYS)) {
      ({ data: inserted, error } = await supabase
        .from("events")
        .insert(rows.map(withoutDriver))
        .select("id, starts_at"));
    }
    if (error) return fail(error.message);
    const events = inserted ?? [];

    // 標籤（find-or-create）
    const tagIds = await resolveTagIds(supabase, user.id, d.tagNames);

    const ecRows = events.flatMap((e) => [
      ...d.subjectIds.map((cid) => ({
        event_id: e.id,
        contact_id: cid,
        role: "subject" as const,
      })),
      ...d.participantIds.map((cid) => ({
        event_id: e.id,
        contact_id: cid,
        role: "participant" as const,
      })),
    ]);
    const etRows = events.flatMap((e) =>
      tagIds.map((tid) => ({ event_id: e.id, tag_id: tid })),
    );
    if (ecRows.length) await supabase.from("event_contacts").insert(ecRows);
    if (etRows.length) await supabase.from("event_tags").insert(etRows);

    // 財務：每個 occurrence 各一筆
    if (d.finance && (d.finance.amount > 0 || d.finance.salaried)) {
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
        // 費用掛「相關人物（收費老師）」，供依老師結月
        contact_id: d.finance!.contactId ?? d.participantIds[0] ?? null,
        ...planSnapshot(d.finance!),
        // occurred_on 取台北曆日（非 UTC 直接切片，避免凌晨行程日期偏移）
        occurred_on: new Date(e.starts_at)
          .toLocaleString("sv-SE", { timeZone: TIME_ZONE })
          .slice(0, 10),
        is_settled: d.finance!.isSettled,
      }));
      let { error: finErr } = await supabase.from("finance_records").insert(finRows);
      // 線上庫還沒套 0008：去掉方案快照欄位再存一次，財務本身不能因此存不進去
      if (isMissingColumn(finErr)) {
        ({ error: finErr } = await supabase
          .from("finance_records")
          .insert(finRows.map(withoutSnapshot)));
      }
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
      reminder_minutes: d.reminderMinutes ?? null,
      // 改動後重置 Email 已寄旗標，讓提醒重新評估
      reminder_email_sent_at: null,
      // 司機設定隨「之後全部」一起套用（例如每週上課都要接送）；沒帶＝不動
      ...(d.driver !== undefined ? driverColumns(d.driver) : {}),
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
      const patch = { ...commonFields, starts_at: startsAt, ends_at: endsAt };
      let { error: upErr } = await supabase.from("events").update(patch).eq("id", t.id);
      // 線上庫還沒套 0009：去掉司機欄位再存
      if (isMissingColumn(upErr, DRIVER_KEYS)) {
        ({ error: upErr } = await supabase
          .from("events")
          .update(withoutDriver(patch))
          .eq("id", t.id));
      }
      if (upErr) return fail(upErr.message);
    }

    // 關聯與財務僅套用於被點擊的該筆（避免批次覆寫語意過重）
    await supabase.from("event_contacts").delete().eq("event_id", current.id);
    await supabase.from("event_tags").delete().eq("event_id", current.id);
    const ecRows = [
      ...d.subjectIds.map((cid) => ({
        event_id: current.id,
        contact_id: cid,
        role: "subject" as const,
      })),
      ...d.participantIds.map((cid) => ({
        event_id: current.id,
        contact_id: cid,
        role: "participant" as const,
      })),
    ];
    if (ecRows.length) {
      await supabase.from("event_contacts").insert(ecRows);
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
      if (d.finance.amount > 0 || d.finance.salaried) {
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
          contact_id: d.finance.contactId ?? d.participantIds[0] ?? null,
          ...planSnapshot(d.finance),
          occurred_on: new Date(newStartUtc)
            .toLocaleString("sv-SE", { timeZone: TIME_ZONE })
            .slice(0, 10),
          is_settled: d.finance.isSettled,
        };
        const write = (payload: typeof finPayload) =>
          existingFin && existingFin.length
            ? supabase.from("finance_records").update(payload).eq("id", existingFin[0].id)
            : supabase.from("finance_records").insert(payload);
        let { error: finErr } = await write(finPayload);
        // 線上庫還沒套 0008：去掉方案快照欄位再存一次
        if (isMissingColumn(finErr)) ({ error: finErr } = await write(withoutSnapshot(finPayload)));
        if (finErr) return fail(finErr.message);
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
