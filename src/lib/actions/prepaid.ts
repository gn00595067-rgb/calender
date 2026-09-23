"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";
import { TIME_ZONE } from "@/lib/constants";

const createSchema = z.object({
  label: z.string().trim().min(1, { error: "請輸入名稱" }).max(60),
  contactId: z.uuid().optional().nullable(),
  calendarId: z.uuid().optional().nullable(),
  kind: z.enum(["deduct", "term"]),
  totalAmount: z.number().int().nonnegative(),
  totalSessions: z.number().int().nonnegative().optional().nullable(),
  categoryId: z.uuid().optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
});

/** 台北曆的今天（yyyy-MM-dd） */
function todayTaipei(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: TIME_ZONE }).slice(0, 10);
}

/**
 * 建立預繳/預付帳戶，並記一筆「儲值」財務（實際付出的錢）。
 * 之後每堂以 covered_by_prepaid 扣抵，不重複計入支出。
 */
export async function createPrepaidAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const { data: acc, error } = await supabase
      .from("prepaid_accounts")
      .insert({
        owner_id: user.id,
        contact_id: d.contactId ?? null,
        calendar_id: d.calendarId ?? null,
        label: d.label,
        kind: d.kind,
        total_amount: d.totalAmount,
        total_sessions: d.totalSessions ?? null,
        note: d.note ?? null,
      })
      .select("id")
      .single();
    if (error || !acc) return fail(error?.message ?? "建立失敗");

    // 儲值本身＝一筆實際支出
    if (d.totalAmount > 0) {
      const { error: finErr } = await supabase.from("finance_records").insert({
        owner_id: user.id,
        calendar_id: d.calendarId ?? null,
        direction: "expense",
        amount: d.totalAmount,
        category_id: d.categoryId ?? null,
        contact_id: d.contactId ?? null,
        occurred_on: todayTaipei(),
        is_settled: true,
        payment_method: d.kind === "deduct" ? "prepaid_deduct" : "prepaid_term",
        prepaid_account_id: acc.id,
        is_prepaid_topup: true,
      });
      if (finErr) return fail(finErr.message);
    }

    revalidatePath("/", "layout");
    return { ok: true, data: { id: acc.id } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 再儲值：加值到既有帳戶並記一筆儲值財務 */
export async function topUpPrepaidAccountAction(
  id: string,
  amount: number,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  if (!Number.isInteger(amount) || amount <= 0) return fail("金額有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data: acc, error: getErr } = await supabase
      .from("prepaid_accounts")
      .select("total_amount, contact_id, calendar_id, kind")
      .eq("id", id)
      .single();
    if (getErr || !acc) return fail(getErr?.message ?? "找不到帳戶");

    const { error: upErr } = await supabase
      .from("prepaid_accounts")
      .update({ total_amount: acc.total_amount + amount, is_active: true })
      .eq("id", id);
    if (upErr) return fail(upErr.message);

    const { error: finErr } = await supabase.from("finance_records").insert({
      owner_id: user.id,
      calendar_id: acc.calendar_id,
      direction: "expense",
      amount,
      contact_id: acc.contact_id,
      occurred_on: todayTaipei(),
      is_settled: true,
      payment_method: acc.kind === "deduct" ? "prepaid_deduct" : "prepaid_term",
      prepaid_account_id: id,
      is_prepaid_topup: true,
    });
    if (finErr) return fail(finErr.message);

    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function setPrepaidActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("prepaid_accounts")
      .update({ is_active: isActive })
      .eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 刪除帳戶（關聯財務的 prepaid_account_id 因 on delete set null 解除連結） */
export async function deletePrepaidAccountAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("prepaid_accounts").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
