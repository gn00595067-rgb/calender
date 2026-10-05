"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const planSchema = z.object({
  /** 既有方案的 id；新方案不給 */
  id: z.uuid().optional().nullable(),
  label: z.string().trim().min(1, { error: "請輸入方案名稱" }).max(30),
  headcount: z.number().int().min(1).max(30),
  billingMode: z.enum(["fixed", "hourly", "monthly"]),
  rate: z.number().int().nonnegative(),
  /** 適用小孩；空＝不限 */
  subjectIds: z.array(z.uuid()).max(10).default([]),
  /** 每次加收（如交通費） */
  extraFee: z.number().int().nonnegative().default(0),
  extraLabel: z.string().trim().max(20).optional().nullable(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1, { error: "請輸入姓名" }).max(60),
  roleLabel: z.string().trim().max(40).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  // 家人／本人：可當「主角（誰的行程）」
  isFamily: z.boolean().optional(),
  // 收費方案（1對1／1對2…）；未提供＝不動既有方案
  plans: z.array(planSchema).max(10).optional(),
  defaultCategoryId: z.uuid().optional().nullable(),
  defaultDirection: z.enum(["expense", "income"]).optional().nullable(),
  defaultPaymentMethod: z
    .enum(["monthly", "per_time", "per_time_cash", "prepaid_deduct", "prepaid_term"])
    .optional()
    .nullable(),
});

/**
 * 收費欄位 → DB 欄位（create/update 共用）。
 * contacts.billing_mode/default_rate 已由方案表取代，仍同步寫入「人數最少的方案」，
 * 讓 0008 migration 前的庫與舊程式（seed 腳本等）照常運作。
 */
function billingColumns(d: z.infer<typeof contactSchema>) {
  const base = {
    default_category_id: d.defaultCategoryId ?? null,
    default_direction: d.defaultDirection ?? null,
    default_payment_method: d.defaultPaymentMethod ?? null,
  };
  if (!d.plans) return base;
  // contacts 舊欄位只認固定／時薪；月薪方案不寫回（只存在方案表）
  const first = [...d.plans]
    .filter((p) => p.billingMode !== "monthly")
    .sort((a, b) => a.headcount - b.headcount)[0];
  return {
    ...base,
    billing_mode: (first?.billingMode ?? null) as "fixed" | "hourly" | null,
    default_rate: first?.rate ?? null,
  };
}

type Supa = Awaited<ReturnType<typeof getAuthed>>["supabase"];

/**
 * 以表單內容為準同步某人的方案：刪掉不在清單的、更新既有的、新增新的。
 * 刪方案不影響歷史財務（財務存有方案名稱快照，rate_plan_id 會 set null）。
 * 回傳錯誤訊息（null＝成功）。
 */
async function syncPlans(
  supabase: Supa,
  ownerId: string,
  contactId: string,
  plans: z.infer<typeof planSchema>[],
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from("contact_rate_plans")
    .select("id")
    .eq("contact_id", contactId);
  if (error) {
    // 0008 尚未套用：只有單一 1對1 方案時，舊欄位已足以表達，不算失敗
    const onlySimple =
      plans.length === 0 || (plans.length === 1 && plans[0].headcount === 1);
    return onlySimple
      ? null
      : "人物已儲存，但 1對2 等多個方案需先套用資料庫更新（0008_rate_plans）才能保存";
  }
  const keepIds = new Set(plans.map((p) => p.id).filter(Boolean) as string[]);
  const removeIds = (existing ?? []).map((r) => r.id).filter((id) => !keepIds.has(id));
  if (removeIds.length) {
    const { error: delErr } = await supabase
      .from("contact_rate_plans")
      .delete()
      .in("id", removeIds);
    if (delErr) return delErr.message;
  }
  for (const [i, p] of plans.entries()) {
    const row = {
      label: p.label,
      headcount: p.headcount,
      billing_mode: p.billingMode,
      rate: p.rate,
      position: i,
      subject_ids: p.subjectIds,
      extra_fee: p.extraFee,
      extra_label: p.extraLabel || null,
    };
    const isUpdate = !!p.id && (existing ?? []).some((r) => r.id === p.id);
    const write = (r: Partial<typeof row>) =>
      isUpdate
        ? supabase.from("contact_rate_plans").update(r).eq("id", p.id!)
        : supabase
            .from("contact_rate_plans")
            .insert({ ...(r as typeof row), owner_id: ownerId, contact_id: contactId });
    let { error: upErr } = await write(row);
    // 舊庫缺新欄位（0011 subject_ids／0013 extra_fee）：沒用到的欄位去掉重存
    if (
      upErr &&
      /subject_ids|extra_fee|extra_label/.test(upErr.message) &&
      p.subjectIds.length === 0 &&
      p.extraFee === 0
    ) {
      const { subject_ids: _s, extra_fee: _f, extra_label: _l, ...rest } = row;
      void _s;
      void _f;
      void _l;
      ({ error: upErr } = await write(rest));
    }
    if (upErr) {
      if (p.billingMode === "monthly" && upErr.message.includes("billing_mode")) {
        return "月薪方案需先套用資料庫更新（0010_monthly_salary）才能保存";
      }
      if (/extra_fee|extra_label/.test(upErr.message)) {
        return "每次加收需先套用資料庫更新（0013_plan_extra_fee）才能保存";
      }
      if (upErr.message.includes("subject_ids")) {
        return "指定適用小孩需先套用資料庫更新（0011_plan_subjects）才能保存";
      }
      return upErr.message;
    }
  }
  return null;
}

export async function createContactAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string; role_label: string | null }>> {
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        role_label: parsed.data.roleLabel ?? null,
        phone: parsed.data.phone ?? null,
        note: parsed.data.note ?? null,
        is_family: parsed.data.isFamily ?? false,
        ...billingColumns(parsed.data),
      })
      .select("id, name, role_label")
      .single();
    if (error || !data) return fail(error?.message ?? "建立失敗");
    if (parsed.data.plans) {
      const planErr = await syncPlans(supabase, user.id, data.id, parsed.data.plans);
      if (planErr) return fail(planErr);
    }
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function updateContactAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { error } = await supabase
      .from("contacts")
      .update({
        name: parsed.data.name,
        role_label: parsed.data.roleLabel ?? null,
        phone: parsed.data.phone ?? null,
        note: parsed.data.note ?? null,
        is_family: parsed.data.isFamily ?? false,
        ...billingColumns(parsed.data),
      })
      .eq("id", id);
    if (error) return fail(error.message);
    if (parsed.data.plans) {
      const planErr = await syncPlans(supabase, user.id, id, parsed.data.plans);
      if (planErr) return fail(planErr);
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function deleteContactAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
