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
  // 大項（0031）；未提供＝不動
  group_label: z.string().trim().max(40).nullable().optional(),
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
        ...(c.group_label !== undefined ? { group_label: c.group_label || null } : {}),
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
  /** 要匯入的月份 yyyy-MM（只匯入這些月份的列；檔案裡出現的日期，原本的紀錄會先清掉再寫入） */
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
    // 家長自己匯入，或家庭老師（員工帳號）在「我的工作」匯入自己的（0031；Phoenix 11/23）
    const { data: own } = await supabase
      .from("contacts")
      .select("owner_id")
      .eq("id", d.contactId)
      .eq("owner_id", user.id)
      .maybeSingle();
    let ownerId = own?.owner_id ?? null;
    if (!ownerId) {
      const { data: links } = await supabase.rpc("my_staff_links");
      ownerId = links?.find((l) => l.contact_id === d.contactId)?.owner_id ?? null;
    }
    if (!ownerId) return fail("你沒有權限匯入這位的工作紀錄");
    const isStaff = ownerId !== user.id;
    const months = new Set(d.months);
    const rows = d.rows.filter((r) => months.has(r.workDate.slice(0, 7)));

    // 只替換檔案裡有的那幾天（同一天重新匯入＝以新檔為準）；其他天、手動記的都不動
    // （原本整月清掉：只匯一週會刪掉同月其他天，Phoenix 11/23 要試匯上週）
    let replaced = 0;
    const days = [...new Set(rows.map((r) => r.workDate))];
    for (let i = 0; i < days.length; i += 100) {
      const { data: del, error } = await supabase
        .from("work_logs")
        .delete()
        .eq("contact_id", d.contactId)
        .in("work_date", days.slice(i, i + 100))
        .select("id");
      if (error) return fail(error.message);
      replaced += del?.length ?? 0;
    }

    if (rows.length) {
      const { error } = await supabase.from("work_logs").insert(
        rows.map((r) => ({
          owner_id: ownerId,
          contact_id: d.contactId,
          author_id: user.id,
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

    // 記住對應（別名）：分類只有家長能改，家庭老師匯入時不記
    const byCat = new Map<string, string[]>();
    for (const a of isStaff ? [] : d.aliasAdds) byCat.set(a.categoryId, [...(byCat.get(a.categoryId) ?? []), a.alias]);
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
