"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

/**
 * 工作紀錄匯入與效益（測試回饋 #4）：工作分類設定、Excel 匯入、單筆改分類。
 * spec：docs/specs/工作紀錄匯入與效益.md
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^\d{2}:\d{2}$/).nullable();

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, { error: "大項名稱不可空白" }).max(40),
  sub_label: z.string().trim().max(80).nullable(),
  hourly_rate: z.number().int().min(0).max(100000),
  aliases: z.array(z.string().trim().min(1).max(40)).max(50),
});

const setupSchema = z.object({
  contactId: z.uuid(),
  monthlySalary: z.number().int().min(0).max(10000000).nullable(),
  categories: z.array(categorySchema).max(50),
});

/** 儲存某人的月薪與工作分類（清單外的舊分類刪除；已匯入的紀錄會變成未分類） */
export async function saveWorkSetupAction(input: unknown): Promise<ActionResult> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const { error: sErr } = await supabase
      .from("contacts")
      .update({ monthly_salary: d.monthlySalary })
      .eq("id", d.contactId);
    if (sErr) return fail(sErr.message);

    const { data: existing } = await supabase
      .from("work_categories")
      .select("id")
      .eq("contact_id", d.contactId);
    const keep = new Set(d.categories.map((c) => c.id).filter(Boolean));
    const removed = (existing ?? []).map((c) => c.id).filter((id) => !keep.has(id));
    if (removed.length) {
      const { error } = await supabase.from("work_categories").delete().in("id", removed);
      if (error) return fail(error.message);
    }
    for (const [i, c] of d.categories.entries()) {
      const row = {
        name: c.name,
        sub_label: c.sub_label || null,
        hourly_rate: c.hourly_rate,
        aliases: [...new Set(c.aliases)],
        position: i,
      };
      const { error } = c.id
        ? await supabase.from("work_categories").update(row).eq("id", c.id)
        : await supabase
            .from("work_categories")
            .insert({ ...row, owner_id: user.id, contact_id: d.contactId });
      if (error) return fail(error.message);
    }
    revalidatePath("/work");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

const importSchema = z.object({
  contactId: z.uuid(),
  /** 要匯入的月份 yyyy-MM：這些月份原本的紀錄會先清掉再寫入（重複匯入不會變兩倍） */
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).min(1).max(24),
  rows: z
    .array(
      z.object({
        workDate: ymd,
        startTime: hm,
        endTime: hm,
        hours: z.number().min(0).max(24),
        content: z.string().max(1000),
        categoryRaw: z.string().max(200),
        categoryId: z.uuid().nullable(),
      }),
    )
    .max(3000),
  /** 使用者在匯入時指定的「Excel 類別 → 分類」，記成該分類的別名，下次自動對應 */
  aliasAdds: z.array(z.object({ categoryId: z.uuid(), alias: z.string().trim().min(1).max(40) })).max(100),
});

export async function importWorkLogsAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number; replaced: number }>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  const d = parsed.data;
  try {
    const { supabase, user } = await getAuthed();
    const months = new Set(d.months);
    const rows = d.rows.filter((r) => months.has(r.workDate.slice(0, 7)));

    // 先清掉這些月份的舊紀錄（重新匯入同一個月＝以新檔為準）
    let replaced = 0;
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
      const { data: del, error } = await supabase
        .from("work_logs")
        .delete()
        .eq("contact_id", d.contactId)
        .gte("work_date", `${m}-01`)
        .lt("work_date", next)
        .select("id");
      if (error) return fail(error.message);
      replaced += del?.length ?? 0;
    }

    if (rows.length) {
      const { error } = await supabase.from("work_logs").insert(
        rows.map((r) => ({
          owner_id: user.id,
          contact_id: d.contactId,
          work_date: r.workDate,
          start_time: r.startTime,
          end_time: r.endTime,
          hours: r.hours,
          content: r.content || null,
          category_raw: r.categoryRaw || null,
          category_id: r.categoryId,
        })),
      );
      if (error) return fail(error.message);
    }

    // 記住對應（別名）
    const byCat = new Map<string, string[]>();
    for (const a of d.aliasAdds) byCat.set(a.categoryId, [...(byCat.get(a.categoryId) ?? []), a.alias]);
    for (const [catId, aliases] of byCat) {
      const { data: cat } = await supabase
        .from("work_categories")
        .select("aliases")
        .eq("id", catId)
        .single();
      if (!cat) continue;
      await supabase
        .from("work_categories")
        .update({ aliases: [...new Set([...(cat.aliases ?? []), ...aliases])] })
        .eq("id", catId);
    }
    revalidatePath("/work");
    return { ok: true, data: { inserted: rows.length, replaced } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/** 單筆改分類（明細表上手動調整） */
export async function setWorkLogCategoryAction(
  id: string,
  categoryId: string | null,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  if (categoryId && !z.uuid().safeParse(categoryId).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("work_logs")
      .update({ category_id: categoryId })
      .eq("id", id);
    if (error) return fail(error.message);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
