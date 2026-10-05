"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

/** 就地標記一或多筆財務的結清狀態 */
export async function settleFinanceAction(
  ids: string[],
  settled: boolean,
): Promise<ActionResult> {
  const parsed = z.array(z.uuid()).min(1).safeParse(ids);
  if (!parsed.success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("finance_records")
      .update({ is_settled: settled })
      .in("id", parsed.data);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const salarySchema = z.object({
  contactId: z.uuid(),
  /** yyyy-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().int().nonnegative(),
  calendarId: z.uuid(),
  categoryId: z.uuid().optional().nullable(),
  ratePlanId: z.uuid().optional().nullable(),
  lessonLabel: z.string().trim().max(30).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
});

/**
 * 記錄某位月薪制老師某月的月薪（一位老師一個月一筆）。
 * 日期記在該月最後一天；請假等扣款由使用者在金額直接調整。
 */
export async function recordSalaryAction(input: unknown): Promise<ActionResult> {
  const parsed = salarySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const [y, m] = d.month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const { error } = await supabase.from("finance_records").insert({
      owner_id: user.id,
      calendar_id: d.calendarId,
      event_id: null,
      direction: "expense",
      amount: d.amount,
      category_id: d.categoryId ?? null,
      contact_id: d.contactId,
      occurred_on: `${d.month}-${String(lastDay).padStart(2, "0")}`,
      is_settled: false,
      payment_method: "monthly",
      note: d.note || `${y}年${m}月月薪`,
      rate_plan_id: d.ratePlanId ?? null,
      lesson_label: d.lessonLabel ?? null,
      salary_month: d.month,
    });
    if (error) {
      if (error.code === "23505") return fail("這個月的月薪已經記過了");
      if (error.message.includes("salary_month")) {
        return fail("月薪功能需先套用資料庫更新（0010_monthly_salary）");
      }
      return fail(error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
