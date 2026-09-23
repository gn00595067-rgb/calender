"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthed, fail, type ActionResult } from "./helpers";

const categorySchema = z.object({
  name: z.string().trim().min(1, { error: "請輸入類別名稱" }).max(40),
  groupLabel: z.string().trim().max(20).optional().nullable(),
});

type SupabaseClient = Awaited<ReturnType<typeof getAuthed>>["supabase"];

/**
 * 依名稱找出或建立費用類別，回傳 id。
 * 供新增／編輯行程時把「選單類別」正規化（同名＝同一筆，防呆）。
 */
export async function resolveCategoryId(
  supabase: SupabaseClient,
  ownerId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const n = (name ?? "").trim();
  if (!n) return null;

  const { data: existing } = await supabase
    .from("expense_categories")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("name", n)
    .limit(1);
  if (existing && existing.length) return existing[0].id;

  const { data: created, error } = await supabase
    .from("expense_categories")
    .insert({ owner_id: ownerId, name: n })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

export async function createCategoryAction(
  input: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase, user } = await getAuthed();
    const { data, error } = await supabase
      .from("expense_categories")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        group_label: parsed.data.groupLabel ?? null,
      })
      .select("id, name")
      .single();
    if (error || !data) {
      // 23505 = 唯一鍵衝突（同名已存在）
      if (error?.code === "23505") return fail("已有同名類別");
      return fail(error?.message ?? "建立失敗");
    }
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

export async function updateCategoryAction(
  id: string,
  input: unknown,
): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "輸入有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase
      .from("expense_categories")
      .update({
        name: parsed.data.name,
        group_label: parsed.data.groupLabel ?? null,
      })
      .eq("id", id);
    if (error) {
      if (error.code === "23505") return fail("已有同名類別");
      return fail(error.message);
    }
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}

/**
 * 刪除類別。既有財務紀錄的 category_id 會因 on delete set null 而解除連結
 * （category_label 名稱仍保留，歷史統計不至於全失）。
 */
export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return fail("參數有誤");
  try {
    const { supabase } = await getAuthed();
    const { error } = await supabase.from("expense_categories").delete().eq("id", id);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗");
  }
}
