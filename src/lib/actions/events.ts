"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { resolveCategoryId } from "./categories";
import { TIME_ZONE } from "@/lib/constants";
import { occurrenceDates } from "@/lib/recurrence";
import { tagKey } from "@/lib/tags";
import { applySubjectTitle } from "@/lib/subject-title";

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

/**
 * 查無欄位（migration 尚未套用到此庫）的錯誤；預設檢查 0008 方案快照欄位。
 * 必須同時是「查無欄位」錯誤碼且訊息提到該欄位，避免把檢查約束等其他錯誤誤判後默默略過。
 */
function isMissingColumn(
  err: { code?: string; message?: string } | null,
  keys: readonly string[] = SNAPSHOT_KEYS,
): boolean {
  if (!err) return false;
  const missing = err.code === "PGRST204" || err.code === "42703";
  return missing && keys.some((k) => err.message?.includes(k));
}

/** 司機設定因資料庫未更新而沒存到時，回給前端的警告 */
const DRIVER_NOT_SAVED =
  "行程已儲存，但「需要司機接送」沒有存到：資料庫尚未更新（0009_driver），請通知管理者";
/** 0019（回程下車地點）未套用時的警告 */
const DROPOFF_NOT_SAVED =
  "行程已儲存，但「回程送到」沒有存到：資料庫尚未更新（0019），請通知管理者";

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
  recurrence: z.enum(["none", "daily", "weekly", "biweekly", "monthly", "dates"]),
  recurrenceUntil: dateOnly.optional().nullable(),
  // 「指定日期」：除了開始日以外的其他日期（同一時間、同一系列）
  dates: z.array(dateOnly).max(100).optional().nullable(),
  // 「每週」時可指定重複的星期（0=日..6=六）；空／未給則每週同一天。
  weekdays: z.array(z.number().int().min(0).max(6)).optional().nullable(),
  // 提前幾分鐘提醒（null＝不提醒）
  reminderMinutes: z.number().int().min(0).max(43200).optional().nullable(),
  // 主角（誰的行程）與相關人物（拜訪／參與／對象）
  subjectIds: z.array(z.uuid()).default([]),
  participantIds: z.array(z.uuid()).default([]),
  // 標題後面加「-主角名」；false＝不加（如「0730小游」本人與豪哥一起，只留老師名）
  suffixSubjects: z.boolean().optional().default(true),
  tagNames: z.array(z.string().trim().min(1).max(30)).default([]),
  finance: financeSchema.optional().nullable(),
  // 司機接送；null＝不需要司機
  driver: z
    .object({
      trip: z.enum(["to", "from", "round"]),
      pickupMinutes: z.number().int().min(0).max(600),
      pickupLocation: z.string().trim().max(200).optional().nullable(),
      dropoffLocation: z.string().trim().max(200).optional().nullable(),
      note: z.string().trim().max(500).optional().nullable(),
    })
    .optional()
    .nullable(),
});

type EventInput = z.infer<typeof baseEventSchema>;

/** 司機接送 → events 欄位（0009 migration 新增；回程下車地點 0019） */
function driverColumns(drv: EventInput["driver"]) {
  return {
    needs_driver: !!drv,
    driver_trip: drv?.trip ?? null,
    driver_pickup_minutes: drv?.pickupMinutes ?? null,
    driver_pickup_location: drv?.pickupLocation || null,
    driver_dropoff_location: drv?.dropoffLocation || null,
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

/** 0019 新增的 events 欄位：回程下車地點、修改紀錄 */
const V19_KEYS = ["driver_dropoff_location", "edited_at", "edited_by"] as const;

function omitKeys<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const copy: Record<string, unknown> = { ...row };
  for (const k of keys) delete copy[k];
  return copy as T;
}

type Strip = <T extends Record<string, unknown>>(row: T) => T;

/**
 * 寫入 events；線上庫還沒套 migration 時依序去掉 0019、0009 的欄位再試，
 * 行程本身不能因此存不進去（但要明確警告哪些設定沒存到）。
 */
async function writeEvents<R extends { error: { code?: string; message?: string } | null }>(
  run: (strip: Strip) => PromiseLike<R>,
  drv: EventInput["driver"],
): Promise<{ res: R; warning?: string }> {
  let res = await run((r) => r);
  let warning: string | undefined;
  if (isMissingColumn(res.error, V19_KEYS)) {
    res = await run((r) => omitKeys(r, V19_KEYS));
    if (drv?.dropoffLocation) warning = DROPOFF_NOT_SAVED;
  }
  if (isMissingColumn(res.error, DRIVER_KEYS)) {
    res = await run((r) => omitKeys(r, [...V19_KEYS, ...DRIVER_KEYS]));
    if (drv) warning = DRIVER_NOT_SAVED;
  }
  return { res, warning };
}

function toUtc(wallStr: string): string {
  return fromZonedTime(wallStr, TIME_ZONE).toISOString();
}

/** UTC ISO → 台北曆日 yyyy-MM-dd（非 UTC 直接切片，避免凌晨行程日期偏移） */
function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: TIME_ZONE }).slice(0, 10);
}

type Supa = Awaited<ReturnType<typeof getAuthed>>["supabase"];

/** 找出或建立標籤，回傳 tag id 陣列 */
async function resolveTagIds(
  supabase: Supa,
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

/**
 * 非本人（有主角）的行程標題加「-主角名」；主角改了或拿掉時舊後綴會被換掉。
 * addSuffix=false：只去掉舊的家人名後綴、不加（使用者在表單取消「標題加主角名」）。
 */
async function titleWithSubjects(
  supabase: Supa,
  title: string,
  subjectIds: string[],
  addSuffix = true,
): Promise<string> {
  const { data } = await supabase
    .from("contacts")
    .select("id, name, is_self")
    .eq("is_family", true);
  const family = data ?? [];
  // 本人（is_self）當主角時不加名字
  const subjectNames = addSuffix
    ? subjectIds
        .map((id) => family.find((c) => c.id === id))
        .filter((c) => !!c && !c.is_self)
        .map((c) => c!.name)
    : [];
  return applySubjectTitle(title, subjectNames, family.map((c) => c.name));
}

/** 寫入一批行程的主角／相關人物與標籤（replace＝先清掉舊的） */
async function writeRelations(
  supabase: Supa,
  eventIds: string[],
  subjectIds: string[],
  participantIds: string[],
  tagIds: string[],
  replace: boolean,
) {
  if (eventIds.length === 0) return;
  if (replace) {
    await supabase.from("event_contacts").delete().in("event_id", eventIds);
    await supabase.from("event_tags").delete().in("event_id", eventIds);
  }
  const ecRows = eventIds.flatMap((id) => [
    ...subjectIds.map((cid) => ({ event_id: id, contact_id: cid, role: "subject" as const })),
    ...participantIds.map((cid) => ({
      event_id: id,
      contact_id: cid,
      role: "participant" as const,
    })),
  ]);
  const etRows = eventIds.flatMap((id) => tagIds.map((tid) => ({ event_id: id, tag_id: tid })));
  if (ecRows.length) await supabase.from("event_contacts").insert(ecRows);
  if (etRows.length) await supabase.from("event_tags").insert(etRows);
}

/** 產生財務列的函式（類別只解析一次，再套到每一筆行程） */
async function financeRowMaker(
  supabase: Supa,
  ownerId: string,
  d: Pick<EventInput, "calendarId" | "participantIds">,
  f: FinanceInput,
) {
  const categoryId = f.categoryId ?? (await resolveCategoryId(supabase, ownerId, f.categoryLabel));
  return (eventId: string, startsAt: string, isSettled: boolean) => ({
    owner_id: ownerId,
    calendar_id: d.calendarId,
    event_id: eventId,
    direction: f.direction,
    amount: f.amount,
    category_label: f.categoryLabel ?? null,
    category_id: categoryId,
    payment_method: f.paymentMethod ?? null,
    prepaid_account_id: f.prepaidAccountId ?? null,
    covered_by_prepaid: f.coveredByPrepaid ?? false,
    // 費用掛「相關人物（收費老師）」，供依老師結月
    contact_id: f.contactId ?? d.participantIds[0] ?? null,
    ...planSnapshot(f),
    occurred_on: taipeiDate(startsAt),
    is_settled: isSettled,
  });
}

/** 是否要記財務（金額 > 0，或月薪制記 0 元計堂數） */
function hasFinance(f: FinanceInput | null | undefined): f is FinanceInput {
  return !!f && (f.amount > 0 || f.salaried);
}

/**
 * 依日期建立多筆行程（同一時刻、同一時長），連同人物、標籤、財務。
 * 新增行程與「編輯時加上重複／延長重複」共用。
 */
async function insertOccurrences(
  supabase: Supa,
  userId: string,
  d: Omit<EventInput, "recurrence" | "recurrenceUntil" | "weekdays" | "dates">,
  args: {
    title: string;
    dates: string[];
    startTime: string;
    durationMs: number;
    groupId: string | null;
    rule: string | null;
  },
): Promise<{ error?: string; warning?: string }> {
  const rows = args.dates.map((date) => {
    const startsAt = toUtc(`${date}T${args.startTime}`);
    const endsAt = new Date(new Date(startsAt).getTime() + args.durationMs).toISOString();
    return {
      calendar_id: d.calendarId,
      creator_id: userId,
      title: args.title,
      description: d.description ?? null,
      location: d.location ?? null,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: d.allDay,
      is_important: d.isImportant,
      recurrence_rule: args.rule,
      recurrence_group_id: args.groupId,
      reminder_minutes: d.reminderMinutes ?? null,
      ...driverColumns(d.driver),
    };
  });
  if (rows.length === 0) return {};

  const { res, warning } = await writeEvents(
    (strip) => supabase.from("events").insert(rows.map(strip)).select("id, starts_at"),
    d.driver,
  );
  if (res.error) return { error: res.error.message };
  const events = res.data ?? [];

  const tagIds = await resolveTagIds(supabase, userId, d.tagNames);
  await writeRelations(
    supabase,
    events.map((e) => e.id),
    d.subjectIds,
    d.participantIds,
    tagIds,
    false,
  );

  // 財務：每個 occurrence 各一筆
  if (hasFinance(d.finance)) {
    const f = d.finance;
    const make = await financeRowMaker(supabase, userId, d, f);
    const finRows = events.map((e) => make(e.id, e.starts_at, f.isSettled));
    let { error: finErr } = await supabase.from("finance_records").insert(finRows);
    // 線上庫還沒套 0008：去掉方案快照欄位再存一次，財務本身不能因此存不進去
    if (isMissingColumn(finErr)) {
      ({ error: finErr } = await supabase
        .from("finance_records")
        .insert(finRows.map(withoutSnapshot)));
    }
    if (finErr) return { error: finErr.message, warning };
  }
  return { warning };
}

export async function createEventAction(
  input: unknown,
): Promise<ActionResult<{ groupId: string | null; warning?: string }>> {
  const parsed = baseEventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;

  if (toUtc(d.endWall) < toUtc(d.startWall)) return fail("結束時間不可早於開始時間");

  try {
    const { supabase, user } = await getAuthed();
    const title = await titleWithSubjects(supabase, d.title, d.subjectIds, d.suffixSubjects);

    // 決定所有 occurrence 的起始日（保底至少起始日這一筆）
    const dates = occurrenceDates({
      startDate: d.startWall.slice(0, 10),
      recurrence: d.recurrence,
      until: d.recurrenceUntil,
      weekdays: d.weekdays,
      dates: d.dates,
    });
    const groupId =
      d.recurrence === "none" || dates.length < 2 ? null : crypto.randomUUID();

    const r = await insertOccurrences(supabase, user.id, d, {
      title,
      dates,
      startTime: d.startWall.slice(11),
      durationMs: new Date(toUtc(d.endWall)).getTime() - new Date(toUtc(d.startWall)).getTime(),
      groupId,
      // 指定日期：資料庫的規則只允許 daily/weekly/…，留空但共用群組（可整批改／刪）
      rule: d.recurrence === "none" || d.recurrence === "dates" ? null : d.recurrence,
    });
    if (r.error) return fail(r.error);

    revalidatePath("/", "layout");
    return { ok: true, data: { groupId, warning: r.warning } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const updateSchema = baseEventSchema
  .omit({ recurrence: true, recurrenceUntil: true, weekdays: true, dates: true })
  .extend({
    id: z.uuid(),
    scope: z.enum(["this", "following"]),
    /**
     * 編輯時加上重複（原本單筆）或延長重複：要多建的日期（前端依規則算好）。
     * 新的幾筆用編輯後的內容與時刻，併入同一系列。
     */
    addDates: z.array(dateOnly).max(400).optional().default([]),
    /** 單筆改成重複時的規則（指定日期＝null） */
    recurrenceRule: z.enum(["daily", "weekly", "biweekly", "monthly"]).optional().nullable(),
  });

export async function updateEventAction(
  input: unknown,
): Promise<ActionResult<{ warning?: string; added?: number }>> {
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

    const title = await titleWithSubjects(supabase, d.title, d.subjectIds, d.suffixSubjects);
    const commonFields = {
      calendar_id: d.calendarId,
      title,
      description: d.description ?? null,
      location: d.location ?? null,
      all_day: d.allDay,
      is_important: d.isImportant,
      reminder_minutes: d.reminderMinutes ?? null,
      // 改動後重置 Email 已寄旗標，讓提醒重新評估
      reminder_email_sent_at: null,
      // 「修改紀錄」用（updated_at 會被提醒排程碰到，不能拿來判斷有沒有人改過）
      edited_at: new Date().toISOString(),
      edited_by: user.id,
      // 司機設定隨「之後全部」一起套用（例如每週上課都要接送）；沒帶＝不動
      ...(d.driver !== undefined ? driverColumns(d.driver) : {}),
    };

    // 目標列：this = 僅此筆；following = 此筆與同群組之後全部
    let targets = [current];
    if (d.scope === "following" && current.recurrence_group_id) {
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

    let warning: string | undefined;
    /** 各目標更新後的開始時間（財務的發生日用） */
    const startOf = new Map<string, string>();
    for (const t of targets) {
      let startsAt = t.starts_at;
      let endsAt = t.ends_at;
      if (d.scope === "this" || t.id === current.id) {
        startsAt = newStartUtc;
        endsAt = newEndUtc;
      } else {
        // 後續各筆：沿用其原本台北日期，套用新的時刻與新時長
        startsAt = toUtc(`${taipeiDate(t.starts_at)}T${newStartTime}`);
        endsAt = new Date(new Date(startsAt).getTime() + durationMs).toISOString();
      }
      startOf.set(t.id, startsAt);
      const patch = { ...commonFields, starts_at: startsAt, ends_at: endsAt };
      const w = await writeEvents(
        (strip) => supabase.from("events").update(strip(patch)).eq("id", t.id),
        d.driver,
      );
      if (w.res.error) return fail(w.res.error.message);
      warning = w.warning ?? warning;
    }
    const targetIds = targets.map((t) => t.id);
    // 改過時間 → 推播也要重新提醒（欄位在 0016；未套用時這行失敗不影響存檔）
    await supabase.from("events").update({ reminder_push_sent_at: null }).in("id", targetIds);

    // 人物、標籤、財務跟著套用範圍走：選「此筆與之後全部」就之後每一筆都改
    // （Peggy 回饋：改了 10/6 起的費用，10/13 之後仍是舊金額、報表也沒變）
    const tagIds = await resolveTagIds(supabase, user.id, d.tagNames);
    await writeRelations(supabase, targetIds, d.subjectIds, d.participantIds, tagIds, true);

    if (d.finance) {
      const { data: existingFin } = await supabase
        .from("finance_records")
        .select("id, event_id, is_settled")
        .in("event_id", targetIds);
      const finOf = new Map((existingFin ?? []).map((f) => [f.event_id, f]));
      if (hasFinance(d.finance)) {
        const f = d.finance;
        const make = await financeRowMaker(supabase, user.id, d, f);
        for (const t of targets) {
          const old = finOf.get(t.id);
          // 結清狀態：點開的這筆照表單；之後各筆保留原本（原本沒有財務的照表單）
          const settled = t.id === current.id ? f.isSettled : (old?.is_settled ?? f.isSettled);
          const payload = make(t.id, startOf.get(t.id)!, settled);
          const write = (p: typeof payload) =>
            old
              ? supabase.from("finance_records").update(p).eq("id", old.id)
              : supabase.from("finance_records").insert(p);
          let { error: finErr } = await write(payload);
          // 線上庫還沒套 0008：去掉方案快照欄位再存一次
          if (isMissingColumn(finErr)) ({ error: finErr } = await write(withoutSnapshot(payload)));
          if (finErr) return fail(finErr.message);
        }
      } else if (finOf.size) {
        await supabase
          .from("finance_records")
          .delete()
          .in("id", [...finOf.values()].map((f) => f.id));
      }
    }

    // 編輯時加上重複／延長重複：用編輯後的內容多建幾筆，併入同一系列
    let added = 0;
    const newDate = taipeiDate(newStartUtc);
    let addDates = [...new Set(d.addDates)].filter((ds) => ds !== newDate).sort();
    if (addDates.length) {
      let groupId = current.recurrence_group_id;
      if (groupId) {
        // 系列裡已有的日期不重建
        const { data: existing } = await supabase
          .from("events")
          .select("starts_at")
          .eq("recurrence_group_id", groupId);
        const have = new Set((existing ?? []).map((e) => taipeiDate(e.starts_at)));
        addDates = addDates.filter((ds) => !have.has(ds));
      } else {
        groupId = crypto.randomUUID();
        const { error: gErr } = await supabase
          .from("events")
          .update({ recurrence_group_id: groupId, recurrence_rule: d.recurrenceRule ?? null })
          .eq("id", current.id);
        if (gErr) return fail(gErr.message);
      }
      const r = await insertOccurrences(supabase, user.id, d, {
        title,
        dates: addDates,
        startTime: newStartTime,
        durationMs,
        groupId,
        rule: current.recurrence_group_id ? current.recurrence_rule : (d.recurrenceRule ?? null),
      });
      if (r.error) return fail(r.error);
      warning = r.warning ?? warning;
      added = addDates.length;
    }

    revalidatePath("/", "layout");
    return { ok: true, data: { warning, added } };
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
    // finance_records.event_id 是 on delete set null，不先刪會留下「（無關聯行程）」孤兒費用
    const deleteFinance = async (eventIds: string[]) =>
      eventIds.length === 0
        ? null
        : (await supabase.from("finance_records").delete().in("event_id", eventIds)).error;
    if (scope === "following") {
      const { data: current } = await supabase
        .from("events")
        .select("recurrence_group_id, starts_at")
        .eq("id", id)
        .single();
      if (current?.recurrence_group_id) {
        const { data: targets } = await supabase
          .from("events")
          .select("id")
          .eq("recurrence_group_id", current.recurrence_group_id)
          .gte("starts_at", current.starts_at);
        const finErr = await deleteFinance((targets ?? []).map((t) => t.id));
        if (finErr) return fail(finErr.message);
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
    const finErr = await deleteFinance([id]);
    if (finErr) return fail(finErr.message);
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
