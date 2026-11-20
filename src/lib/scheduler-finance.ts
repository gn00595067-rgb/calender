import "server-only";
import { formatInTimeZone } from "date-fns-tz";
import { createAdminClient } from "@/lib/supabase/admin";
import { PAYMENT_METHODS, TIME_ZONE } from "@/lib/constants";
import {
  extraLabel,
  isMonthlyPlan,
  looksNonLesson,
  pickPlan,
  planAmount,
  type RatePlan,
} from "@/lib/rate-plans";

/**
 * 家庭老師（行事曆分享身分 scheduler）排的課，自動在家長帳下記費用。
 * 家庭老師看不到金額、也沒有財務表的權限，所以由伺服器用管理金鑰代寫；
 * 金額照家長設定的收費方案算，跟家長自己新增時的預設一致。
 * spec：docs/specs/家庭老師排課自動記費用.md
 */

type Admin = ReturnType<typeof createAdminClient>;

function taipeiDate(iso: string): string {
  return formatInTimeZone(new Date(iso), TIME_ZONE, "yyyy-MM-dd");
}

/** 登入者在這個行事曆是不是「老師」分享身分；是的話回傳行事曆擁有者（家長） */
async function schedulerOwner(admin: Admin, userId: string, calendarId: string) {
  const { data: share } = await admin
    .from("calendar_shares")
    .select("role, calendars!inner(owner_id)")
    .eq("calendar_id", calendarId)
    .eq("member_id", userId)
    .eq("role", "scheduler")
    .maybeSingle();
  const cal = share?.calendars as unknown as { owner_id: string } | null;
  return cal?.owner_id ?? null;
}

interface BillingTeacher {
  id: string;
  name: string;
  default_direction: "expense" | "income" | null;
  default_category_id: string | null;
  default_payment_method: string | null;
  plans: RatePlan[];
}

/** 相關人物中（依選取順序）第一位有收費方案的老師，跟新增行程畫面的判斷一樣 */
async function billingTeacher(
  admin: Admin,
  ownerId: string,
  participantIds: string[],
): Promise<BillingTeacher | null> {
  if (participantIds.length === 0) return null;
  const [{ data: contacts }, { data: plans }] = await Promise.all([
    admin
      .from("contacts")
      .select("id, name, default_direction, default_category_id, default_payment_method")
      .eq("owner_id", ownerId)
      .in("id", participantIds),
    admin.from("contact_rate_plans").select("*").eq("owner_id", ownerId).in("contact_id", participantIds),
  ]);
  for (const id of participantIds) {
    const c = (contacts ?? []).find((x) => x.id === id);
    const ps = (plans ?? [])
      .filter((p) => p.contact_id === id)
      .map((p) => ({
        ...p,
        rate: Number(p.rate),
        subject_ids: p.subject_ids ?? [],
        extra_fee: Number(p.extra_fee ?? 0),
        extra_label: p.extra_label ?? null,
      })) as RatePlan[];
    if (c && ps.length) return { ...c, plans: ps } as BillingTeacher;
  }
  return null;
}

/** 這堂課要記的上課形式；不是上課（整日、談話開會）或沒有收費老師時為 null */
function lessonPlan(
  teacher: BillingTeacher | null,
  subjectIds: string[],
  title: string,
  allDay: boolean,
) {
  if (!teacher || allDay || looksNonLesson(title)) return null;
  return pickPlan(teacher.plans, subjectIds);
}

/**
 * 給家庭老師的畫面用：選了這些人之後，這堂會記成哪位老師的哪種上課形式（不含金額）。
 * 不是 scheduler、沒選老師或不算上課時回 null。
 */
export async function previewSchedulerLesson(
  userId: string,
  input: { calendarId: string; participantIds: string[]; subjectIds: string[]; title: string; allDay: boolean },
): Promise<{ teacher: string; label: string } | null> {
  const admin = createAdminClient();
  const ownerId = await schedulerOwner(admin, userId, input.calendarId);
  if (!ownerId) return null;
  const teacher = await billingTeacher(admin, ownerId, input.participantIds);
  const plan = lessonPlan(teacher, input.subjectIds, input.title, input.allDay);
  return teacher && plan ? { teacher: teacher.name, label: plan.label } : null;
}

/**
 * 家庭老師讀不到家長的人物表（RLS 只開給擁有者），選相關人物時改由這裡給名單。
 * 只回家人與老師（有收費方案或設了老師類型的人）；Peggy 公事的客戶不給。
 * 欄位只有名字、稱謂、是不是家人；電話、備註、費率都不給。
 */
export async function schedulerContacts(userId: string) {
  const admin = createAdminClient();
  const { data: shares } = await admin
    .from("calendar_shares")
    .select("calendars!inner(owner_id)")
    .eq("member_id", userId)
    .eq("role", "scheduler");
  const owners = [
    ...new Set(
      (shares ?? []).map((s) => (s.calendars as unknown as { owner_id: string }).owner_id),
    ),
  ];
  if (owners.length === 0) return [];
  const [{ data }, { data: plans }] = await Promise.all([
    // 用 *：0030 前沒有 rules（老師的規則），列出欄位會查詢失敗
    admin.from("contacts").select("*").in("owner_id", owners),
    admin.from("contact_rate_plans").select("contact_id").in("owner_id", owners),
  ]);
  const billed = new Set((plans ?? []).map((p) => p.contact_id));
  return (data ?? [])
    .filter((c) => c.is_family || billed.has(c.id) || !!c.tutor_kind)
    .map(({ id, name, role_label, is_family, rules }) => ({
      id,
      name,
      role_label,
      is_family,
      rules: rules ?? null,
    }));
}

/** 家長已經結清（付過錢）的那筆不再自動改；「每次付現」這類一建立就結清的照常跟著改 */
function lockedByParent(f: { is_settled: boolean; payment_method: string | null }): boolean {
  if (!f.is_settled) return false;
  const meta = PAYMENT_METHODS.find((p) => p.value === f.payment_method);
  return !meta?.defaultSettled;
}

/**
 * 家庭老師新增／修改行程後呼叫：依行程現在的老師、主角、時長，把每一堂的費用記到家長帳下
 * （沒有就新增、有就更新、已不算上課就刪掉）。不是 scheduler 時什麼都不做。
 * 只處理這位老師自己登錄的行程（scheduler 本來就只能改自己的）。
 */
export async function syncSchedulerFinance(
  userId: string,
  calendarId: string,
  eventIds: string[],
): Promise<string | undefined> {
  if (eventIds.length === 0) return;
  const admin = createAdminClient();
  const ownerId = await schedulerOwner(admin, userId, calendarId);
  if (!ownerId) return;

  const [{ data: events }, { data: links }, { data: existing }] = await Promise.all([
    admin
      .from("events")
      .select("id, title, starts_at, ends_at, all_day, calendar_id, creator_id")
      .in("id", eventIds)
      .eq("creator_id", userId),
    admin.from("event_contacts").select("event_id, contact_id, role").in("event_id", eventIds),
    admin.from("finance_records").select("id, event_id, is_settled, payment_method, rate_plan_id").in("event_id", eventIds),
  ]);

  const ids = (role: string, eventId: string) =>
    (links ?? []).filter((l) => l.event_id === eventId && l.role === role).map((l) => l.contact_id);
  // 同一批（同系列）人物都一樣，老師只查一次
  const participantIds = events?.length ? ids("participant", events[0].id) : [];
  const teacher = await billingTeacher(admin, ownerId, participantIds);

  let categoryName: string | null = null;
  if (teacher?.default_category_id) {
    const { data: cat } = await admin
      .from("expense_categories")
      .select("name")
      .eq("id", teacher.default_category_id)
      .maybeSingle();
    categoryName = cat?.name ?? null;
  }
  const pmMeta = PAYMENT_METHODS.find((p) => p.value === teacher?.default_payment_method);
  let prepaidAccountId: string | null = null;
  if (teacher && pmMeta?.usesPrepaid) {
    const { data: acct } = await admin
      .from("prepaid_accounts")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("contact_id", teacher.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    prepaidAccountId = acct?.id ?? null;
  }

  for (const ev of events ?? []) {
    const subjectIds = ids("subject", ev.id);
    const plan = lessonPlan(teacher, subjectIds, ev.title, ev.all_day);
    const old = (existing ?? []).find((f) => f.event_id === ev.id);
    // 家長手動記的費用（沒有用收費方案，例如 Elsa 用 Peggy 帳號 key 的）一律不動：
    // 行程改成家庭老師登錄後，她改時間或人物也不能把原本的金額蓋掉或刪掉（秘書 11/20）
    if (old && (lockedByParent(old) || !old.rate_plan_id)) continue;

    const minutes = (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000;
    const salaried = isMonthlyPlan(plan);
    const amount = plan ? planAmount(plan, minutes) : 0;
    if (!teacher || !plan || (amount <= 0 && !salaried)) {
      if (old) await admin.from("finance_records").delete().eq("id", old.id);
      continue;
    }

    const row = {
      owner_id: ownerId,
      calendar_id: ev.calendar_id,
      event_id: ev.id,
      direction: teacher.default_direction ?? "expense",
      amount: salaried ? 0 : amount,
      category_id: teacher.default_category_id,
      category_label: categoryName,
      payment_method: (teacher.default_payment_method ?? null) as never,
      prepaid_account_id: prepaidAccountId,
      covered_by_prepaid: !!prepaidAccountId,
      contact_id: teacher.id,
      rate_plan_id: plan.id,
      lesson_label: plan.label,
      headcount: plan.headcount,
      learner_count: subjectIds.length || null,
      extra_fee: plan.extra_fee || null,
      extra_label: plan.extra_fee ? extraLabel(plan) : null,
      occurred_on: taipeiDate(ev.starts_at),
      // 月薪制每堂記 0 元已結清（錢在月底月薪那筆）；其餘照付款方式的預設
      is_settled: salaried ? true : (pmMeta?.defaultSettled ?? false),
    };
    const { error } = old
      ? await admin.from("finance_records").update(row).eq("id", old.id)
      : await admin.from("finance_records").insert(row);
    if (error) return `行程已儲存，但費用沒有記到家長那邊（${error.message}），請通知管理者`;
  }
}

/**
 * 家庭老師刪自己排的課之前呼叫：把系統代記、還沒付款的費用一起刪掉，免得留下「無關聯行程」的費用。
 * 家長已結清的保留（錢已經付了）。
 */
export async function deleteSchedulerFinance(userId: string, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const admin = createAdminClient();
  const { data: events } = await admin
    .from("events")
    .select("id, calendar_id")
    .in("id", eventIds)
    .eq("creator_id", userId);
  const calId = events?.[0]?.calendar_id;
  if (!calId || !(await schedulerOwner(admin, userId, calId))) return;
  const { data: fins } = await admin
    .from("finance_records")
    .select("id, is_settled, payment_method, rate_plan_id")
    .in("event_id", events.map((e) => e.id));
  // 只刪系統依收費方案代記的；家長手動記的留著
  const drop = (fins ?? []).filter((f) => !lockedByParent(f) && !!f.rate_plan_id).map((f) => f.id);
  if (drop.length) await admin.from("finance_records").delete().in("id", drop);
}
